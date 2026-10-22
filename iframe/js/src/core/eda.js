/**
 * @//module/ core/eda
 * @//description/ 取 EDA 宿主环境对象（兼容 window.eda / parent.eda / 无宿主三种情况）
 * @//exports/ NETLIST_KEY, getEda, hasEda
 * @//dependencies/ 无
 * @//example/ const { getEda, hasEda } = await import('./core/eda.js')
 *            if (hasEda()) getEda().sys_Message.showToastMessage('完成', 'success')
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 网表类型标识，对齐嘉立创 EDA 专业版 API 约定
 *
 * @type {string}
 */
export const NETLIST_KEY = 'JLCEDA';

/**
 * 取 EDA 运行环境对象
 *
 * 兼容三种挂载方式：
 * 1. iframe 内 `window.eda`（多数页面）；
 * 2. 父窗口 `parent.eda`（部分页面历史上这样取）；
 * 3. 都不存在（浏览器直开调试）→ 返回 null。
 *
 * 全部包裹 try/catch：跨域访问 `parent` 会抛 SecurityError。
 *
 * @returns {object|null} 宿主环境对象；不可用时为 null
 * @sideEffects 无（只读全局对象）
 */
export function getEda() {
	try {
		if (typeof eda !== 'undefined' && eda) return eda;
	} catch (e) {
		/* ignore */
	}
	try {
		if (globalThis.parent && globalThis.parent !== globalThis && globalThis.parent.eda) return globalThis.parent.eda;
	} catch (e) {
		/* 跨域访问 parent 会抛错，忽略 */
	}
	return globalThis.eda || null;
}

/**
 * EDA 环境是否可用
 *
 * @returns {boolean} 能取到宿主对象即为 true
 * @sideEffects 无
 */
export function hasEda() {
	return !!getEda();
}
