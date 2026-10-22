/**
 * @//module/ core/util
 * @//description/ 通用小工具（HTML 转义、位号自然排序等零依赖纯函数）
 * @//exports/ escapeHtml, naturalCompare
 * @//dependencies/ 无
 * @//example/ const { escapeHtml, naturalCompare } = await import('./core/util.js')
 *            row.innerHTML = `<td>${escapeHtml(comp.designator)}</td>`
 *            ['R10', 'R2'].sort(naturalCompare) // ['R2', 'R10']
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
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

/**
 * 自然排序比较器（位号/引脚号专用）
 *
 * 位号是「字母前缀 + 数字」，字典序会把 `R10` 排在 `R2` 前面，必须按数字大小比。
 * 项目里原有 4 份写法（`localeCompare numeric` / `parseInt` 差值 / `isNaN` 三元），
 * 行为各不相同；这里收敛为一份：**按数字段比较、大小写不敏感**。
 *
 * 固定用 `en` locale：不同运行环境的默认 locale 不同，固定后结果可复现。
 *
 * @param {string|number} a 前一个值
 * @param {string|number} b 后一个值
 * @returns {number} 负数表示 a 在前，正数表示 b 在前，0 表示相等
 * @sideEffects 无（纯函数）
 */
export function naturalCompare(a, b) {
	const sa = a === null || a === undefined ? '' : String(a);
	const sb = b === null || b === undefined ? '' : String(b);
	return sa.localeCompare(sb, 'en', { numeric: true, sensitivity: 'base' });
}
