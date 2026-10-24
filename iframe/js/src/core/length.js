/**
 * @//module/ core/length
 * @//description/ 把长度值规整成宿主 API 接受的 number（toFixed 结果必须经此回数字）
 * @//exports/ toApiLength
 * @//dependencies/ 无
 * @//example/ const { toApiLength } = await import('./core/length.js')
 *            pcb_PrimitiveObject.create(layer, x, y, src, toApiLength(w, 2), toApiLength(h, 2))
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 把长度值规整成 EDA API 需要的 **number**
 *
 * EDA 的参数校验是严格类型（V4 尤其明显）：`width`/`height` 声明就是 `number`，
 * 传字符串 `"2275.00"` 会被判成非法值，直接抛
 * `PcbApiError: [VALUE_OUT_OF_RANGE] width: 图像宽度 width=2275.00 必须为正数`。
 * 所以凡是经过 `toFixed()` 的值，传给 `eda.*.create()` 之前必须转回数字。
 *
 * @param {number|string} value 原始长度（mil）
 * @param {number} [digits=2] 保留小数位
 * @returns {number} 规整后的数值；入参无法解析为有限数时返回 `NaN`（调用方需自行校验）
 * @sideEffects 无（纯函数）
 */
export function toApiLength(value, digits = 2) {
	const num = Number(value);
	if (!Number.isFinite(num)) return NaN;
	const rounded = Number(num.toFixed(digits));
	// 极小但非零的值四舍五入后会变成 0，而 0 同样会被 API 判为"非正数" → 回退原值
	if (rounded === 0 && num !== 0) return num;
	return rounded;
}
