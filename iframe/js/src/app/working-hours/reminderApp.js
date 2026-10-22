/**
 * @//module/ app/working-hours/reminderApp
 * @//description/ 消息提醒规则管理（时长规则 / 间隔规则 / 欢迎与离开文案）
 * @//exports/ createReminderApp
 * @//dependencies/ core/util, core/log, ui/toast, app/working-hours/reminder
 * @//example/ const ReminderApp = createReminderApp()
 *            await ReminderApp.init(); ReminderApp.render()
 *
 * 规则存在 `USER_CONFIG_REMINDERS`：早期版本只存时长规则数组，所以 init 里要兼容
 * 「读到数组当作 durationRules」的老格式，否则升级后用户的规则会整片消失。
 * 页面 HTML 里有 `onclick="ReminderApp.updateRule(...)"` 这类行内调用，
 * 所以本对象必须被挂到 window（见页面入口）。
 *
 * 对象由四组方法拼装而成（状态 / 渲染 / 规则编辑 / 偏好保存）：
 * 单个 135 行的对象字面量过不了「单函数 ≤ 80 行」的门禁，而它本身也没有必要那么长。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { escapeHtml } from '../../core/util.js';
import { logger } from '../../core/log.js';
import { toast } from '../../ui/toast.js';
import { formatMin, parseMin } from './reminder.js';

/** 存储键 */
const STORAGE_KEY = 'USER_CONFIG_REMINDERS';

/** 调试开关的存储键 */
const DEBUG_KEY = 'WORKING_HOURS_DEBUG_ENABLED';

/**
 * 规则的默认值
 *
 * @returns {object} 默认数据
 * @sideEffects 无
 */
function defaultData() {
	return {
		durationRules: [],
		intervalRules: [],
		welcomeEnabled: true,
		idleEnabled: true,
		welcomeText: '距离上次打开EDA经过了<time>',
		idleText: '距离上次离开经过了<time>',
		idleThresholdMin: 10,
		lastHb: 0,
	};
}

/**
 * 状态相关：读存储、回填表单、纯换算
 *
 * @returns {object} 方法集
 * @sideEffects 无
 */
function stateApi() {
	return {
		/**
		 * 从存储读取规则并回填表单
		 *
		 * @returns {Promise<void>}
		 * @sideEffects 读存储 + 写 DOM
		 */
		async init() {
			try {
				const str = await eda.sys_Storage.getExtensionUserConfig(STORAGE_KEY);
				if (str) {
					const parsed = JSON.parse(str);
					if (Array.isArray(parsed)) this.data.durationRules = parsed;
					else this.data = Object.assign(this.data, parsed);
				}
			} catch (e) {
				logger.warn('处理工时记录失败', e);
			}

			document.getElementById('welcome-enabled').checked = !!this.data.welcomeEnabled;
			document.getElementById('idle-enabled').checked = !!this.data.idleEnabled;
			document.getElementById('welcome-text-input').value = this.data.welcomeText || '';
			document.getElementById('idle-text-input').value = this.data.idleText || '';
			document.getElementById('idle-min-input').value = this.data.idleThresholdMin || 10;

			this.render();
		},

		// 纯换算在 ./reminder.js；这里保留同名方法，因为行内 onclick 还在用 ReminderApp.*
		formatMin(m) {
			return formatMin(m);
		},

		parseMin(str) {
			return parseMin(str);
		},

		/**
		 * 取某种规则的数组
		 *
		 * @param {'duration'|'interval'} type 规则类型
		 * @returns {Array<object>} 规则数组
		 * @sideEffects 无
		 */
		rulesOf(type) {
			return type === 'duration' ? this.data.durationRules : this.data.intervalRules;
		},
	};
}

/**
 * 渲染相关
 *
 * @returns {object} 方法集
 * @sideEffects 无
 */
function renderApi() {
	return {
		/**
		 * 重绘两块规则列表
		 *
		 * @returns {void}
		 * @sideEffects 写 DOM
		 */
		render() {
			this.renderList('duration', 'list-duration');
			this.renderList('interval', 'list-interval');
		},

		/**
		 * 渲染一块规则列表
		 *
		 * @param {'duration'|'interval'} type 规则类型
		 * @param {string} containerId 容器 id
		 * @returns {void}
		 * @sideEffects 写 DOM
		 */
		renderList(type, containerId) {
			const container = document.getElementById(containerId);
			container.innerHTML = '';
			const rules = this.rulesOf(type);

			if (rules.length === 0) {
				container.innerHTML = '<div style="text-align:center; color:#666; padding:10px; font-size:11px;">暂无规则</div>';
				return;
			}

			const color = type === 'duration' ? 'var(--vscode-link)' : 'var(--vscode-success-fill)';
			rules.forEach((item, idx) => {
				const div = document.createElement('div');
				div.className = 'reminder-item';
				div.style.padding = '4px 8px';
				div.innerHTML = `
                        <input class="list-input" style="width:55px; color:${color}; font-weight:bold; font-family:Consolas;"
                               value="${this.formatMin(item.m)}" onchange="ReminderApp.updateRule('${type}', ${idx}, 'm', this.value)">
                        <input class="list-input" style="flex:1; margin:0 5px;" value="${escapeHtml(item.msg)}"
                               onchange="ReminderApp.updateRule('${type}', ${idx}, 'msg', this.value)">
                        <div class="stepper" style="height:22px; margin-right:5px;" title="提醒次数：触发时显示几条提醒">
                            <button onclick="ReminderApp.stepRule('${type}', ${idx}, -1)">-</button>
                            <input type="number" value="${item.count || 1}" readonly>
                            <button onclick="ReminderApp.stepRule('${type}', ${idx}, 1)">+</button>
                        </div>
                        <button class="small-btn del" style="padding:0 4px;" onclick="ReminderApp.remove('${type}', ${idx})">×</button>`;
				container.appendChild(div);
			});
		},
	};
}

/**
 * 规则编辑相关
 *
 * @returns {object} 方法集
 * @sideEffects 无
 */
function ruleApi() {
	return {
		/**
		 * 新增一条规则
		 *
		 * @param {'duration'|'interval'} type 规则类型
		 * @returns {Promise<void>}
		 * @sideEffects 写存储 + 重绘
		 */
		async add(type) {
			const prefix = type === 'duration' ? 'dur' : 'int';
			const mVal = document.getElementById(`add-${prefix}-m`).value;
			const msg = document.getElementById(`add-${prefix}-msg`).value.trim();
			const count = parseInt(document.getElementById(`add-${prefix}-c`).value) || 1;

			const m = this.parseMin(mVal);
			if (!m || m <= 0) {
				toast('时间无效', 'error');
				return;
			}
			if (!msg) {
				toast('内容为空', 'error');
				return;
			}

			const rules = this.rulesOf(type);
			rules.push({ m: m, msg: msg, count: count });
			rules.sort((a, b) => a.m - b.m);

			document.getElementById(`add-${prefix}-m`).value = '';
			document.getElementById(`add-${prefix}-msg`).value = '';
			document.getElementById(`add-${prefix}-c`).value = '1';
			await this.save();
		},

		/**
		 * 改一条规则的字段
		 *
		 * @param {'duration'|'interval'} type 规则类型
		 * @param {number} idx 下标
		 * @param {'m'|'msg'} field 字段
		 * @param {string} val 新值
		 * @returns {Promise<void>}
		 * @sideEffects 写存储 + 重绘
		 */
		async updateRule(type, idx, field, val) {
			const rules = this.rulesOf(type);
			if (!rules[idx]) return;
			if (field === 'm') rules[idx].m = this.parseMin(val);
			else if (field === 'msg') rules[idx].msg = val;
			await this.save();
		},

		/**
		 * 调整提醒次数
		 *
		 * @param {'duration'|'interval'} type 规则类型
		 * @param {number} idx 下标
		 * @param {number} delta 增量
		 * @returns {Promise<void>}
		 * @sideEffects 写存储 + 重绘
		 */
		async stepRule(type, idx, delta) {
			const rules = this.rulesOf(type);
			if (!rules[idx]) return;
			rules[idx].count = Math.max(1, (rules[idx].count || 1) + delta);
			await this.save();
		},

		/**
		 * 二次确认后删除一条规则
		 *
		 * @param {'duration'|'interval'} type 规则类型
		 * @param {number} index 下标
		 * @returns {void}
		 * @sideEffects 弹窗 + 可能写存储
		 */
		remove(type, index) {
			eda.sys_Dialog.showConfirmationMessage('确定要删除这条提醒规则吗？', '确认删除', '确认', '取消', async (confirmed) => {
				if (!confirmed) return;
				this.rulesOf(type).splice(index, 1);
				await this.save();
			});
		},
	};
}

/**
 * 偏好保存相关
 *
 * @returns {object} 方法集
 * @sideEffects 无
 */
function prefsApi() {
	return {
		/**
		 * 把表单与规则写入存储
		 *
		 * @returns {Promise<void>}
		 * @sideEffects 写存储 + 重绘
		 */
		async save() {
			this.data.welcomeEnabled = document.getElementById('welcome-enabled').checked;
			this.data.idleEnabled = document.getElementById('idle-enabled').checked;
			this.data.welcomeText = document.getElementById('welcome-text-input').value;
			this.data.idleText = document.getElementById('idle-text-input').value;
			this.data.idleThresholdMin = parseInt(document.getElementById('idle-min-input').value) || 10;

			try {
				await eda.sys_Storage.setExtensionUserConfig(STORAGE_KEY, JSON.stringify(this.data));
				this.render();
				toast('自动保存成功', 'success');
			} catch (e) {
				toast('保存失败:' + e.message, 'error');
			}
		},

		/**
		 * 切换调试日志开关
		 *
		 * @returns {Promise<void>}
		 * @sideEffects 写存储
		 */
		async toggleDebug() {
			const raw = await eda.sys_Storage.getExtensionUserConfig(DEBUG_KEY);
			const isDebug = raw === 'true';
			await eda.sys_Storage.setExtensionUserConfig(DEBUG_KEY, (!isDebug).toString());
			toast(`Debug模式已${!isDebug ? '开启' : '关闭'}，请查看控制台日志`, 'info');
		},
	};
}

/**
 * 创建提醒规则管理器
 *
 * @returns {object} 管理器（方法用 `this` 互相调用，可整体挂 window）
 * @sideEffects 无（调用方法时才读写 DOM / 存储）
 */
export function createReminderApp() {
	return Object.assign({ KEY: STORAGE_KEY, data: defaultData() }, stateApi(), renderApi(), ruleApi(), prefsApi());
}
