/**
 * @//module/ core/util
 * @//description/ 通用小工具（HTML 转义等零依赖纯函数）
 * @//exports/ escapeHtml
 * @//dependencies/ 无
 * @//example/ const { escapeHtml } = await import('./core/util.js')
 *            row.innerHTML = `<td>${escapeHtml(comp.designator)}</td>`
 */

/**
 * HTML 转义（用于拼 innerHTML / 属性值）
 *
 * 覆盖 `& < > " '` 五个字符，既可用于文本节点也可用于属性值。
 * 此前各页面各写了一份，其中 PcbToSch 那份只转义了双引号，`&`/`<`/`>` 会漏，
 * 这里统一为唯一实现。
 *
 * @param {*} value 任意值；null / undefined 返回空字符串
 * @returns {string} 转义后的字符串
 * @sideEffects 无（纯函数）
 */
export function escapeHtml(value) {
	if (value === null || value === undefined) return '';
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
