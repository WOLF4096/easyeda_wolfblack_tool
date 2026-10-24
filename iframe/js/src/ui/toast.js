/**
 * @//module/ ui/toast
 * @//description/ 统一轻提示：优先走宿主 toast，不在 EDA 环境时降级为页面顶栏（3 秒自动消失）
 * @//exports/ TOAST_LEVEL, normalizeLevel, toast
 * @//dependencies/ core/eda
 * @//example/ const { toast } = await import('./ui/toast.js')
 *            toast('已写入 12 个网络', 'success')
 *            toast('网表为空', 'error')
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../core/eda.js';

/**
 * 提示级别
 *
 * 宿主 `showToastMessage(msg, type)` 同时接受字符串与数字（2 是历史遗留的「警告」）。
 *
 * @type {Readonly<Record<string, string|number>>}
 */
export const TOAST_LEVEL = Object.freeze({
	info: 'info',
	success: 'success',
	warn: 'warning',
	error: 'error',
	warning: 'warning',
	legacy: 2,
});

/** 降级横幅的固定 id（同一时刻只保留一条，避免叠成一片） */
const BANNER_ID = '__wolf_notice';

/**
 * 把各种历史写法归一成宿主认识的值
 *
 * 页面里同时存在 `showToastMessage(msg, 2)`、`(msg, 'success')`、`(msg, 'info')` 三种调用，
 * 归一后行为一致；无法识别的值原样透传（宿主将来可能支持更多类型）。
 *
 * @param {string|number|undefined} level 级别
 * @returns {string|number} 归一后的级别
 * @sideEffects 无（纯函数）
 */
export function normalizeLevel(level) {
	if (typeof level === 'number') return Number.isFinite(level) ? level : TOAST_LEVEL.info;
	if (typeof level !== 'string') return TOAST_LEVEL.info;
	const key = level.trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(TOAST_LEVEL, key) ? TOAST_LEVEL[key] : level;
}

/**
 * 在页面顶部显示一条降级提示
 *
 * 不在 EDA 环境（浏览器直接打开调试）时使用：不依赖 common.css，位置固定在顶部。
 *
 * @param {Document} doc 文档对象
 * @param {string} text 文案
 * @param {number} timeoutMs 自动移除延时（毫秒）
 * @returns {boolean} 是否成功显示
 * @sideEffects DOM（创建/更新/移除 #__wolf_notice）
 */
function banner(doc, text, timeoutMs) {
	if (!doc || !doc.body || typeof doc.createElement !== 'function') return false;
	let bar = doc.getElementById(BANNER_ID);
	if (!bar) {
		bar = doc.createElement('div');
		bar.id = BANNER_ID;
		bar.style.cssText =
			'position:fixed;left:0;right:0;top:0;padding:8px 12px;background:#5a1d1d;color:#fff;font:13px/1.5 sans-serif;z-index:9999';
		doc.body.appendChild(bar);
	}
	bar.textContent = text;
	setTimeout(() => {
		if (typeof bar.remove === 'function') bar.remove();
	}, timeoutMs);
	return true;
}

/**
 * 尝试走宿主 toast
 *
 * 宿主缺失、字段缺失、或调用本身抛错，都算「没走通」，由调用方降级为页面横幅。
 *
 * @param {object|null} host 宿主对象
 * @param {string} text 文案
 * @param {string|number} type 归一后的级别
 * @returns {boolean} 是否已交给宿主显示
 * @sideEffects eda API（sys_Message.showToastMessage）
 */
function showOnHost(host, text, type) {
	try {
		if (!host || !host.sys_Message || typeof host.sys_Message.showToastMessage !== 'function') return false;
		host.sys_Message.showToastMessage(text, type);
		return true;
	} catch (e) {
		/* 宿主 toast 不可用 → 走页面横幅 */
		return false;
	}
}

/**
 * 显示一条轻提示
 *
 * @param {string} message 文案（非字符串会被 String 化）
 * @param {string|number} [level='info'] 级别，见 TOAST_LEVEL
 * @param {object} [opts] 选项
 * @param {Document} [opts.doc=document] 文档对象（便于测试注入）
 * @param {object|null} [opts.host] 宿主对象（默认走 core/eda 的 getEda）
 * @param {number} [opts.timeoutMs=3000] 降级横幅的存活时间
 * @returns {'host'|'dom'|'none'} 实际使用的通道：宿主 toast / 页面横幅 / 无处可显示
 * @sideEffects eda API（sys_Message.showToastMessage）或 DOM
 */
export function toast(message, level = TOAST_LEVEL.info, opts = {}) {
	const doc = opts.doc || globalThis.document;
	const host = opts.host === undefined ? getEda() : opts.host;
	const text = message === null || message === undefined ? '' : String(message);

	if (showOnHost(host, text, normalizeLevel(level))) return 'host';

	return banner(doc, text, opts.timeoutMs === undefined ? 3000 : opts.timeoutMs) ? 'dom' : 'none';
}
