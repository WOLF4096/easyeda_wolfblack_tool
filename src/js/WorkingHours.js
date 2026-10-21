import { logger } from './common/logger.js';

export function WorkingHours() {
	// ==========================================
	// 1. 全局配置项
	// ==========================================
	const CONFIG = {
		interval: 2000, // 主循环检测间隔ms
		idleThreshold: 20, // 闲置阈值s
		saveInterval: 60, // 自动保存间隔s
		reminderKey: 'USER_CONFIG_REMINDERS',
	};

	// [新增] 记录脚本本次启动的绝对时间
	// 用于防止后台挂机苏醒后，回溯填充时间超过了脚本启动的时间点
	const SESSION_START_TIME = Date.now();

	// ==========================================
	// 2. 存储管理模块
	// ==========================================
	const StorageManager = {
		_isSaving: false, // 简单的并发锁，防止单窗口内的异步重叠

		getDateKey: (d) => {
			const Y = d.getFullYear();
			const M = (d.getMonth() + 1).toString().padStart(2, '0');
			const D = d.getDate().toString().padStart(2, '0');
			return `STATS_${Y}_${M}_${D}`;
		},

		getSlotIndex: (d) => {
			const h = d.getHours();
			const m = d.getMinutes();
			return h * 4 + Math.floor(m / 15);
		},

		calculateTodayWorkSeconds: async () => {
			const key = StorageManager.getDateKey(new Date());
			try {
				let rawData = await eda.sys_Storage.getExtensionUserConfig(key);
				if (!rawData) return 0;
				let data = JSON.parse(rawData);
				let totalSeconds = 0;
				for (let slotKey in data.slots) {
					const slotObj = data.slots[slotKey];
					for (let uuid in slotObj) totalSeconds += slotObj[uuid][0];
				}
				return totalSeconds;
			} catch (e) {
				return 0;
			}
		},

		save: async (uuid, friendlyName, workInc, fishInc) => {
			if (!uuid || (workInc <= 0 && fishInc <= 0)) return;

			// 简单的防冲突锁（防止同窗口多次调用）
			if (StorageManager._isSaving) return;
			StorageManager._isSaving = true;

			try {
				let currentTime = new Date();
				let loopCount = 0;
				const MAX_LOOPS = 200;
				let currentKey = null;
				let currentData = null;
				let isDirty = false;

				// 循环分配：只要还有剩余时间需保存
				while ((workInc > 0 || fishInc > 0) && loopCount < MAX_LOOPS) {
					loopCount++;

					// [核心控制] 如果回溯时间早于脚本启动时间，强制丢弃剩余数据，停止填充
					// 这保证了后台挂起再久，也不会改写启动之前的数据
					if (currentTime.getTime() < SESSION_START_TIME) {
						// console.warn("回溯触及启动时间边界，停止填充");
						break;
					}

					let targetKey = StorageManager.getDateKey(currentTime);
					let slotIdx = StorageManager.getSlotIndex(currentTime);

					// 切换日期文件逻辑
					if (targetKey !== currentKey) {
						if (currentKey && currentData && isDirty) {
							try {
								await eda.sys_Storage.setExtensionUserConfig(currentKey, JSON.stringify(currentData));
							} catch (error) {
								console.error('保存历史分片失败:', error);
							}
						}
						let raw = await eda.sys_Storage.getExtensionUserConfig(targetKey);
						try {
							currentData = raw ? JSON.parse(raw) : { meta: {}, slots: {} };
						} catch(e) {
							currentData = { meta: {}, slots: {} };
						}

						// 确保核心结构存在
						if (!currentData.slots) currentData.slots = {};
						if (!currentData.meta) currentData.meta = {};

						currentData.meta[uuid] = friendlyName;
						currentKey = targetKey;
						isDirty = false;
					}

					// 确保槽位存在
					if (!currentData.slots[slotIdx]) currentData.slots[slotIdx] = {};
					if (!currentData.slots[slotIdx][uuid]) currentData.slots[slotIdx][uuid] = [0, 0];

					const MAX_SLICE = 15 * 60; // 900秒上限

					// 读取当前槽位已有的数据（可能是其他窗口写入的）
					let currentWork = currentData.slots[slotIdx][uuid][0];
					let currentFish = currentData.slots[slotIdx][uuid][1];
					let currentTotal = currentWork + currentFish;

					// 计算该槽位还能塞多少东西 (物理剩余空间)
					let absoluteFree = MAX_SLICE - currentTotal;

					if (absoluteFree > 0) {
						// ----------------------------------------------------
						// [关键算法] 合并与优先级逻辑
						// ----------------------------------------------------

						// 1. 尝试填入工作时间
						let wAdd = Math.min(workInc, absoluteFree);
						currentData.slots[slotIdx][uuid][0] += wAdd;
						workInc -= wAdd;

						// 更新中间变量
						currentWork += wAdd;
						absoluteFree -= wAdd;
						if (wAdd > 0) isDirty = true;

						// 2. 尝试填入摸鱼时间
						// 只有当还有物理空间时，才允许填入摸鱼时间
						if (absoluteFree > 0 && fishInc > 0) {
							let fAdd = Math.min(fishInc, absoluteFree);
							currentData.slots[slotIdx][uuid][1] += fAdd;
							fishInc -= fAdd;
							// currentFish += fAdd; // 变量更新可选，用于调试
							if (fAdd > 0) isDirty = true;
						}
					}

					// ----------------------------------------------------
					// [再次校验] 确保符合：工作 <= 15m 且 (工作+摸鱼) <= 15m
					// 这里的校验是为了处理多窗口并发写入时的边界情况
					// ----------------------------------------------------
					let finalWork = currentData.slots[slotIdx][uuid][0];
					let finalFish = currentData.slots[slotIdx][uuid][1];

					// 规则 A: 工作时间如果溢出，强制截断为 900
					if (finalWork > MAX_SLICE) {
						currentData.slots[slotIdx][uuid][0] = MAX_SLICE;
						finalWork = MAX_SLICE;
						isDirty = true;
					}

					// 规则 B: 摸鱼时间 = 剩余空间。如果 Work 占满了，Fish 必须让位归零
					if (finalWork + finalFish > MAX_SLICE) {
						currentData.slots[slotIdx][uuid][1] = Math.max(0, MAX_SLICE - finalWork);
						isDirty = true;
					}

					// 时间倒流 15 分钟，准备处理剩下的 workInc/fishInc
					if (workInc > 0 || fishInc > 0) {
						currentTime = new Date(currentTime.getTime() - 15 * 60 * 1000);
					}
				}

				// 保存最后持有的数据
				if (currentKey && currentData && isDirty) {
					if (globalThis.__WORKING_HOURS_DEBUG__) {
						console.log(`[工作时间统计-DEBUG] 准备保存数据至 ${currentKey}:`, currentData);
					}
					// 在特定版本EDA会出现BUG，表现为无法保存，系API变更导致
					try {
						const save = await eda.sys_Storage.setExtensionUserConfig(currentKey, JSON.stringify(currentData));// 持久化存储
						if (globalThis.__WORKING_HOURS_DEBUG__) {
							console.log(`[工作时间统计-DEBUG] 保存结果: ${save ? '成功' : '失败'}`);
						}
					} catch (error) {
						eda.sys_Message.showToastMessage('保存失败', 'error');
						if (error.includes("Cannot create property")) {
							eda.sys_Message.showToastMessage('EDA底层数据写入异常，无法保存，建议重启EDA', 'error');
						}
					}
				}
			} catch (e) {
				console.error('[工作时间统计] 存储失败:', e);
			} finally {
				StorageManager._isSaving = false;
			}
		},
	};

	// ==========================================
	// 3. 消息提醒 & 状态变量
	// ==========================================
	const ReminderManager = {
		data: {
			durationRules: [],
			intervalRules: [],
			welcomeEnabled: true,
			idleEnabled: true,
			welcomeText: "距离上次打开EDA经过了<time>",
			idleText: "距离上次离开经过了<time>",
			idleThresholdMin: 10,
			lastHb: 0
		},
		lastTriggeredMin: -1,
		lastIntervalTriggered: {}, // 记录每个规则上次触发的绝对分钟数
		isLastTickIdle: false, // 记录上一次检测是否处于闲置状态

		reload: async () => {
			try {
				const str = await eda.sys_Storage.getExtensionUserConfig(CONFIG.reminderKey);
				if (str) {
					const parsed = JSON.parse(str);
					if (Array.isArray(parsed)) {
						ReminderManager.data.durationRules = parsed;
					} else {
						ReminderManager.data = Object.assign(ReminderManager.data, parsed);
					}
				}
				// 强制加固数据结构
				if (!Array.isArray(ReminderManager.data.durationRules)) ReminderManager.data.durationRules = [];
				if (!Array.isArray(ReminderManager.data.intervalRules)) ReminderManager.data.intervalRules = [];
			} catch (e) {
				ReminderManager.data.durationRules = [];
				ReminderManager.data.intervalRules = [];
			}
		},

		formatTimeStr: (ms) => {
			const totalSec = Math.floor(ms / 1000);
			const h = Math.floor(totalSec / 3600);
			const m = Math.floor((totalSec % 3600) / 60);
			const s = totalSec % 60;
			let res = "";
			if (h > 0) res += `${h}时`;
			if (m > 0 || h > 0) res += `${m}分`;
			res += `${s}秒`;
			return res;
		},

		triggerToast: (msg, count = 1) => {
			for(let i=0; i<count; i++) {
				setTimeout(() => eda.sys_Message.showToastMessage(msg, 'info'), i * 150);
			}
		},

		check: (totalWorkSeconds, isCurrentlyIdle) => {
			// 安全性检查：如果数据还未加载或被意外清空
			if (!ReminderManager.data || !ReminderManager.data.durationRules) return;

			const nowTs = Date.now();
			const upTimeMin = Math.floor((nowTs - SESSION_START_TIME) / 60000);
			const workTodayMin = Math.floor(totalWorkSeconds / 60);

			// 1. 工作时长提醒 (每日累计)
			if (workTodayMin !== ReminderManager.lastTriggeredMin) {
				const matches = ReminderManager.data.durationRules.filter(r => r.m === workTodayMin);
				if (globalThis.__WORKING_HOURS_DEBUG__ && matches.length > 0) {
					console.log(`[工作时间统计-DEBUG] 触发工作时长提醒: ${workTodayMin}m`, matches);
				}
				matches.forEach(r => ReminderManager.triggerToast(r.msg, r.count));
				ReminderManager.lastTriggeredMin = workTodayMin;
			}

			// 2. 固定间隔提醒 (启动后循环)
			ReminderManager.data.intervalRules.forEach(rule => {
				if (upTimeMin > 0 && upTimeMin % rule.m === 0) {
					if (ReminderManager.lastIntervalTriggered[rule.m] !== upTimeMin) {
						if (globalThis.__WORKING_HOURS_DEBUG__) {
							console.log(`[工作时间统计-DEBUG] 触发固定间隔提醒: ${rule.m}m`, rule);
						}
						ReminderManager.triggerToast(rule.msg, rule.count);
						ReminderManager.lastIntervalTriggered[rule.m] = upTimeMin;
					}
				}
			});

			// 3. 挂机返回提醒
			if (ReminderManager.data.idleEnabled && ReminderManager.isLastTickIdle && !isCurrentlyIdle) {
				const idleMs = Date.now() - session.lastMoveTime;
				if (idleMs > (ReminderManager.data.idleThresholdMin || 10) * 60000) {
					const template = ReminderManager.data.idleText || "距离上次离开经过了<time>";
					const msg = template.replace("<time>", ReminderManager.formatTimeStr(idleMs));
					eda.sys_Message.showToastMessage(msg, 'success');
				}
			}
			ReminderManager.isLastTickIdle = isCurrentlyIdle;
		},

		updateHeartbeat: async () => {
			ReminderManager.data.lastHb = Date.now();
			try {
				await eda.sys_Storage.setExtensionUserConfig(CONFIG.reminderKey, JSON.stringify(ReminderManager.data));
			} catch(e) {
				logger.warn('保存提醒配置失败', e);
			}
		},

		showWelcome: () => {
			// 只有明确开启且有历史记录才显示
			if (!ReminderManager.data.welcomeEnabled || !ReminderManager.data.lastHb) return;

			const diffMs = Date.now() - ReminderManager.data.lastHb;
			// 保护机制：离开时间少于 1 分钟不显示（防止刷新插件时弹出）
			if (diffMs < 60000) return;

			const template = ReminderManager.data.welcomeText || "距离上次打开EDA已经经过了<time>";
			const msg = template.replace("<time>", ReminderManager.formatTimeStr(diffMs));

			// 延迟 2 秒弹出，确保 EDA UI 完全加载
			setTimeout(() => {
				eda.sys_Message.showToastMessage(msg, 'success');
			}, 2000);
		}
	};

	let session = {
		workBuffer: 0,
		fishBuffer: 0,
		lastMoveTime: Date.now(),
		lastPcb: 'init',
		lastSch: 'init',
		currentUuid: null,
		currentName: '未获取',
		lastTick: Date.now(),
		totalWorkToday: 0,
	};

	let mainTimer = null;
	let lastSaveTime = Date.now();

	async function updateProjectInfo() {
		try {
			const info = await eda.dmt_Project.getCurrentProjectInfo();
			if (info && info.uuid) {
				session.currentUuid = info.uuid;
				session.currentName = info.friendlyName || '未命名工程';
			}
		} catch (e) {
			logger.debug('读取工程信息失败（不影响计时）', e);
		}
	}

	function checkActivity(apiObj, type) {
		if (!apiObj) return;

		// 只监测坐标，提高灵敏度
		apiObj.getCurrentMousePosition().then((pos) => {
			if (!pos) return;
			const posStr = JSON.stringify(pos);
			const lastKey = type === 'pcb' ? 'lastPcb' : 'lastSch';

			// 如果坐标变了，视为在操作
			if (posStr !== session[lastKey]) {
				if (globalThis.__WORKING_HOURS_DEBUG__) {
					console.log(`[工作时间统计-DEBUG] 检测到活动(${type}): 坐标=${posStr}`);
				}
				session.lastMoveTime = Date.now();
				session[lastKey] = posStr;
			}
		}).catch(() => {});
	}

	// ==========================================
	// 4. 主循环逻辑 (去中心化：每个窗口独立统计)
	// ==========================================
	mainTimer = setInterval(async () => {
		// [Debug] 同步 Debug 标志
		try {
			const debugFlag = await eda.sys_Storage.getExtensionUserConfig('WORKING_HOURS_DEBUG_ENABLED');
			globalThis.__WORKING_HOURS_DEBUG__ = (debugFlag === 'true');
		} catch(e) {
			logger.debug('读取调试开关失败', e);
		}

		let now = Date.now();
		let delta = (now - session.lastTick) / 1000;
		session.lastTick = now;

		// 如果后台挂起超过1小时，delta 会很大。
		// 但我们在 Save 里有 SESSION_START_TIME 保护，所以这里稍微放宽限制，
		// 允许记录后台挂机的时间（算作摸鱼），但防止天文数字
		if (delta > 3600 * 72) delta = 0; // 只有超过72小时才视为异常清零

		if (typeof eda !== 'undefined') {
			if (eda.pcb_SelectControl) checkActivity(eda.pcb_SelectControl, 'pcb');
			if (eda.sch_SelectControl) checkActivity(eda.sch_SelectControl, 'sch');
		}

		let diff = (Date.now() - session.lastMoveTime) / 1000;
		const isCurrentlyIdle = diff > CONFIG.idleThreshold;

		// 判定状态 (阈值10秒)
		if (isCurrentlyIdle) {
			session.fishBuffer += delta;
		} else {
			session.workBuffer += delta;
			session.totalWorkToday += delta;
		}

		ReminderManager.check(session.totalWorkToday, isCurrentlyIdle);

		// 保存检查
		if (now - lastSaveTime >= CONFIG.saveInterval * 1000) {
			lastSaveTime = now;

			await ReminderManager.reload();
			await ReminderManager.updateHeartbeat(); // 更新心跳时间
			await updateProjectInfo();

			if (session.currentUuid && (session.workBuffer > 0 || session.fishBuffer > 0)) {
				const workToSave = Math.round(session.workBuffer);
				const fishToSave = Math.round(session.fishBuffer);
				// console.log(workToSave,fishToSave);
				session.workBuffer -= workToSave;
				session.fishBuffer -= fishToSave;

				if (workToSave > 0 || fishToSave > 0) {
					await StorageManager.save(session.currentUuid, session.currentName, workToSave, fishToSave);
				}
			}
		}
	}, CONFIG.interval);

	// ==========================================
	// 5. 初始化
	// ==========================================
	(async function init() {
		try {
			await updateProjectInfo();
			await ReminderManager.reload();
			ReminderManager.showWelcome(); // 显示欢迎语
			const historySeconds = await StorageManager.calculateTodayWorkSeconds();
			session.totalWorkToday = historySeconds;
			console.log(`======= 启动工作时间统计成功 =======`);
			console.log(`[工作时间统计] 启动时间: ${new Date(SESSION_START_TIME).toLocaleTimeString()}`);
		} catch (e) {
			console.error('[工作时间统计] 启动失败', e);
		}
	})();
}
