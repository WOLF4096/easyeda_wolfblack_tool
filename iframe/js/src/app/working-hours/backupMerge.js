/**
 * @//module/ app/working-hours/backupMerge
 * @//description/ 把备份里的天数据合并进本地 `STATS_*` 配置：只补不覆盖、重复导入幂等
 * @//exports/ STATS_PREFIX, planMerge, applyMerge
 * @//dependencies/ app/working-hours/backupFormat
 * @//example/ const { updates, stats } = planMerge(await eda.sys_Storage.getExtensionAllUserConfigs(), backup.days)
 *            await applyMerge(updates)
 *
 * 合并规则（三句话）：
 *   1. 同一「天 / 槽位 / 工程」取两边**较大**的那一份 —— 所以同一份文件导入多少次都不会翻倍；
 *   2. 夹到一格 900 秒的物理上限内，且**绝不让本地已有的数字变小**（导错文件也不会丢数据）；
 *   3. 工程名只在本地缺失时补，不覆盖本地已有的名字（本地可能刚改过）。
 *
 * 合并计划是纯计算（`planMerge`），落盘才碰 `eda.sys_Storage`（`applyMerge`），
 * 所以「导入会把数据变成什么样」可以脱离 EDA 单测。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { SLOT_MAX_SECONDS } from './backupFormat.js';

/** 每日配置的键前缀 */
export const STATS_PREFIX = 'STATS_';

/**
 * 宽松取有限数字
 *
 * @param {*} value 任意值
 * @returns {number} 有限数字或 0
 * @sideEffects 无（纯函数）
 */
function toNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 把存储里的原始值解析成单日配置（坏数据当作空天处理，不阻断其它日期）
 *
 * @param {string|object|undefined} raw 存储值
 * @returns {{meta: object, slots: object}} 单日配置
 * @sideEffects 传入对象时会被后续合并**就地修改**
 */
function parseDay(raw) {
	if (raw && typeof raw === 'object') return raw;
	if (typeof raw !== 'string' || raw.length === 0) return { meta: {}, slots: {} };
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : { meta: {}, slots: {} };
	} catch (e) {
		return { meta: {}, slots: {} };
	}
}

/**
 * 合并一格的单个工程记录
 *
 * @param {object} cell 本地该格的 `{ 工程 uuid: [工作秒, 空闲秒] }`（就地修改）
 * @param {string} uuid 工程 id
 * @param {Array} pair 备份里的 `[工作秒, 空闲秒]`
 * @param {{slots: number, workSeconds: number}} delta 累计改动量
 * @returns {boolean} 是否有改动
 * @sideEffects 改写 cell / delta
 */
function mergeCell(cell, uuid, pair, delta) {
	const incoming = Array.isArray(pair) ? pair : [0, 0];
	const current = Array.isArray(cell[uuid]) ? cell[uuid] : [0, 0];
	const currentWork = toNumber(current[0]);
	const currentRest = toNumber(current[1]);

	let work = Math.max(0, Math.min(SLOT_MAX_SECONDS, Math.max(currentWork, toNumber(incoming[0]))));
	let rest = Math.max(0, Math.min(SLOT_MAX_SECONDS - work, Math.max(currentRest, toNumber(incoming[1]))));

	// 只增不减：夹取若让本地数字变小，就整条跳过，保持原样
	if (work < currentWork || rest < currentRest) return false;
	if (work === currentWork && rest === currentRest) return false;

	cell[uuid] = [work, rest];
	delta.slots += 1;
	delta.workSeconds += work - currentWork;
	return true;
}

/**
 * 补齐缺失的工程名（本地已有名字时不覆盖）
 *
 * @param {object} local 本地单日配置（就地修改）
 * @param {object} meta 备份里的工程名表
 * @returns {number} 新增的工程名数量
 * @sideEffects 改写 local.meta
 */
function mergeMeta(local, meta) {
	let added = 0;
	for (const uuid of Object.keys(meta || {})) {
		// 用 hasOwnProperty 判断「已登记」而不是真值判断：工程名可能是空串
		if (Object.prototype.hasOwnProperty.call(local.meta, uuid)) continue;
		local.meta[uuid] = meta[uuid];
		added += 1;
	}
	return added;
}

/**
 * 合并一天的所有槽位
 *
 * @param {object} local 本地单日配置（就地修改）
 * @param {object} slots 备份里的槽位表
 * @param {{slots: number, workSeconds: number}} delta 累计改动量
 * @returns {boolean} 是否有改动
 * @sideEffects 改写 local.slots / delta
 */
function mergeSlots(local, slots, delta) {
	let changed = false;
	for (const slotKey of Object.keys(slots || {})) {
		const incoming = slots[slotKey] || {};
		if (!local.slots[slotKey] || typeof local.slots[slotKey] !== 'object') local.slots[slotKey] = {};
		const cell = local.slots[slotKey];
		for (const uuid of Object.keys(incoming)) {
			if (mergeCell(cell, uuid, incoming[uuid], delta)) changed = true;
		}
	}
	return changed;
}

/**
 * 合并一天
 *
 * @param {object} local 本地单日配置（就地修改）
 * @param {object} day 备份里的单日配置 `{ dateKey, meta, slots }`
 * @returns {{changed: boolean, slots: number, projects: number, workSeconds: number}} 改动量
 * @sideEffects 改写 local
 */
function mergeDay(local, day) {
	const delta = { changed: false, slots: 0, projects: 0, workSeconds: 0 };
	if (!local.meta || typeof local.meta !== 'object') local.meta = {};
	if (!local.slots || typeof local.slots !== 'object') local.slots = {};

	delta.projects = mergeMeta(local, day.meta);
	const slotsChanged = mergeSlots(local, day.slots, delta);
	delta.changed = delta.projects > 0 || slotsChanged;
	return delta;
}

/**
 * 计算合并计划（纯函数）
 *
 * @param {Record<string, string|object>} configs 扩展全部用户配置
 * @param {Array<{dateKey: string, meta: object, slots: object}>} days 备份里的天数据
 * @returns {{updates: Array<{key: string, dayData: object}>, stats: {days: number, projects: number, slots: number, workSeconds: number}}} 计划
 * @sideEffects `configs` 里已是对象的项会被就地修改（调用方通常是刚读出来的快照）
 */
export function planMerge(configs, days) {
	const source = configs || {};
	const updates = [];
	const stats = { days: 0, projects: 0, slots: 0, workSeconds: 0 };

	for (const day of days || []) {
		const key = STATS_PREFIX + day.dateKey;
		const local = parseDay(source[key]);
		const delta = mergeDay(local, day);
		if (!delta.changed) continue;

		updates.push({ key: key, dayData: local });
		stats.days += 1;
		stats.projects += delta.projects;
		stats.slots += delta.slots;
		stats.workSeconds += delta.workSeconds;
	}
	return { updates: updates, stats: stats };
}

/**
 * 把合并计划写回扩展存储
 *
 * @param {Array<{key: string, dayData: object}>} updates 合并计划里的更新项
 * @returns {Promise<number>} 实际写入的天数
 * @sideEffects 写扩展用户配置（逐日）
 */
export async function applyMerge(updates) {
	let written = 0;
	for (const item of updates || []) {
		await eda.sys_Storage.setExtensionUserConfig(item.key, JSON.stringify(item.dayData));
		written += 1;
	}
	return written;
}
