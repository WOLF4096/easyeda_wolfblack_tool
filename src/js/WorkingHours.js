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
							await eda.sys_Storage.setExtensionUserConfig(currentKey, JSON.stringify(currentData));
						}
						let raw = await eda.sys_Storage.getExtensionUserConfig(targetKey);
						currentData = raw ? JSON.parse(raw) : { meta: {}, slots: {} };
						currentData.meta[uuid] = friendlyName;
						currentKey = targetKey;
						isDirty = false;
					}

					// 初始化槽位
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
					await eda.sys_Storage.setExtensionUserConfig(currentKey, JSON.stringify(currentData));
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
		rules: [],
		lastTriggeredMin: -1,
		reload: async () => {
			try {
				const str = await eda.sys_Storage.getExtensionUserConfig(CONFIG.reminderKey);
				if (str) ReminderManager.rules = JSON.parse(str);
			} catch (e) {}
		},
		check: (totalWorkSeconds) => {
			const currentMin = Math.floor(totalWorkSeconds / 60);
			if (currentMin === ReminderManager.lastTriggeredMin) return;
			const matches = ReminderManager.rules.filter((rule) => rule.m === currentMin);
			if (matches.length > 0) {
				matches.forEach((rule) => eda.sys_Message.showToastMessage(rule.msg, 'info'));
			}
			ReminderManager.lastTriggeredMin = currentMin;
		},
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
		} catch (e) {}
	}

	function checkActivity(apiObj, type) {
		if (!apiObj) return;
		apiObj
			.getCurrentMousePosition()
			.then((res) => {
				if (!res) return;
				let str = JSON.stringify(res);
				let lastKey = type === 'pcb' ? 'lastPcb' : 'lastSch';
				if (str !== session[lastKey]) {
					session.lastMoveTime = Date.now();
					session[lastKey] = str;
				}
			})
			.catch(() => {});
	}

	// ==========================================
	// 4. 主循环逻辑 (去中心化：每个窗口独立统计)
	// ==========================================
	mainTimer = setInterval(async () => {
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

		// 判定状态 (阈值10秒)
		if (diff > CONFIG.idleThreshold) {
			session.fishBuffer += delta;
		} else {
			session.workBuffer += delta;
			session.totalWorkToday += delta;
			ReminderManager.check(session.totalWorkToday);
		}

		// 保存检查
		if (now - lastSaveTime >= CONFIG.saveInterval * 1000) {
			lastSaveTime = now;

			await ReminderManager.reload();
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
			const historySeconds = await StorageManager.calculateTodayWorkSeconds();
			session.totalWorkToday = historySeconds;
			console.log(`======= 启动工作时间统计成功 =======`);
			console.log(`[工作时间统计] 启动时间: ${new Date(SESSION_START_TIME).toLocaleTimeString()}`);
		} catch (e) {
			console.error('[工作时间统计] 启动失败', e);
		}
	})();
}
