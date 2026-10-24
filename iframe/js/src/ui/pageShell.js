/**
 * @//module/ ui/pageShell
 * @//description/ 页面级兜底：整屏错误提示与「宿主环境必需」断言（替代 15 份复制的守卫）
 * @//exports/ showFatal, requireEda
 * @//dependencies/ core/eda
 * @//example/ const { requireEda } = await import('./ui/pageShell.js')
 *            const eda = requireEda()   // 不在 EDA 环境时整屏提示并抛出
 *
 * 历史包袱：18 个页面里有 15 个各复制了一段 8 行的「公共模块未加载」守卫
 * （写红色 innerHTML 再 throw）。模块化之后「公共模块没加载」已不可能发生，
 * 但「不在 EDA 环境里打开」仍会发生，所以保留同等的兜底能力，只收敛成一份。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../core/eda.js';

/** 兜底提示框的固定 id（重复调用时复用同一个节点） */
const FATAL_ID = '__wolf_fatal';

/**
 * 整屏显示一条致命错误
 *
 * 不依赖 common.css（此时可能连样式都没加载），全部内联。
 *
 * @param {string} message 错误文案
 * @param {object} [options] 选项
 * @param {Document} [options.doc=document] 文档对象（便于测试注入）
 * @param {string} [options.hint] 第二行灰色提示
 * @returns {HTMLElement|null} 提示框元素；文档不可用时返回 null
 * @sideEffects DOM（写入 #__wolf_fatal，必要时清空 body）
 */
export function showFatal(message, options = {}) {
	const doc = options.doc || globalThis.document;
	if (!doc || !doc.body || typeof doc.createElement !== 'function') return null;

	let box = doc.getElementById(FATAL_ID);
	if (!box) {
		box = doc.createElement('div');
		box.id = FATAL_ID;
		box.style.cssText = 'padding:24px;font:14px/1.6 sans-serif;color:#f28b82;white-space:pre-wrap';
		doc.body.appendChild(box);
	}
	box.textContent = message + (options.hint ? '\n\n' + options.hint : '');
	return box;
}

/**
 * 断言宿主环境可用
 *
 * @param {object} [options] 选项
 * @param {Document} [options.doc] 文档对象
 * @param {string} [options.message='未检测到 EDA 运行环境，请在嘉立创 EDA 中打开本页'] 提示文案
 * @returns {object} 宿主对象
 * @throws {Error} 取不到宿主时（已先显示整屏提示）
 * @sideEffects DOM（失败时）、读取全局宿主对象
 */
export function requireEda(options = {}) {
	const host = getEda();
	if (host) return host;
	const message = options.message || '未检测到 EDA 运行环境，请在嘉立创 EDA 中打开本页';
	showFatal(message, { doc: options.doc, hint: '若由浏览器直接打开，宿主 API 全部不可用。' });
	throw new Error(message);
}
