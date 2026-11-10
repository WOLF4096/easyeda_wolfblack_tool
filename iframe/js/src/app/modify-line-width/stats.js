/**
 * @//module/ app/modify-line-width/stats
 * @//description/ 线宽统计的纯函数层：单位换算、格式化/解析、按线宽分组、背景柱占比
 * @//exports/ MM_PER_MIL, MIL_PER_MM, WIDTH_DIGITS, MAX_WIDTH_MIL, BAR_MIN_PERCENT, convertLength, formatNumber, formatWidth, formatLength, parseWidth, groupByWidth, barPercent
 * @//dependencies/ 无
 * @//example/ const { formatWidth, formatLength, parseWidth, groupByWidth } = await import('./stats.js')
 *            formatWidth(6.000000000000001, 'mil') // '6.0'
 *            formatLength(8115, 'mm')              // '206.121'（mil → mm 后再格式化）
 *            parseWidth('0', 'mil')                 // 0（删除）
 *            groupByWidth(items, 'mil')             // [{ key:'6.0', count:130, lengthMil:2000, … }]
 *
 * 三条口径写死在这里，页面与写入器都不许各算一套：
 *   1. **显示精度**：mil 1 位、mm 3 位小数（需求原话：6.000000000000001 → 6.0）；
 *   2. **分组键** = 当前单位下格式化后的字符串 —— 浮点噪声天然合并，切单位则重算；
 *   3. **输入三态**：`null`（留空不改）/ `0`（删除）/ `>0`（目标 mil）/ `NaN`（非法）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/** 1 mil = 0.0254 mm（唯一定义点，别处不许写 39.37 之类的近似值） */
export const MM_PER_MIL = 0.0254;

/** 1 mm = 39.37007874015748 mil */
export const MIL_PER_MM = 1 / MM_PER_MIL;

/** 各单位的显示小数位 */
export const WIDTH_DIGITS = Object.freeze({ mil: 1, mm: 3 });

/** 线宽上限（mil）：100000 mil ≈ 2540 mm，超过按非法输入处理 */
export const MAX_WIDTH_MIL = 100000;

/** 背景柱最小可见百分比 */
export const BAR_MIN_PERCENT = 2;

/**
 * 长度单位换算
 *
 * @param {number|string} value 数值
 * @param {'mil'|'mm'} from 原单位
 * @param {'mil'|'mm'} to 目标单位
 * @returns {number} 换算结果；入参非有限数时返回 `NaN`
 * @sideEffects 无（纯函数）
 */
export function convertLength(value, from, to) {
	const num = Number(value);
	if (!Number.isFinite(num)) return NaN;
	if (from === to) return num;
	return from === 'mil' ? num * MM_PER_MIL : num * MIL_PER_MM;
}

/**
 * 定点格式化 + 千分位
 *
 * `-0.04` 保留 1 位会得到 `"-0.0"`，这里统一去掉负零；整数部分每三位加逗号。
 *
 * @param {number|string} value 数值
 * @param {number} [digits=0] 小数位（0~6）
 * @returns {string} 格式化文本；入参非有限数时返回空串
 * @sideEffects 无（纯函数）
 */
export function formatNumber(value, digits = 0) {
	const num = Number(value);
	if (!Number.isFinite(num)) return '';
	const places = Math.max(0, Math.min(6, Math.trunc(digits) || 0));
	const fixed = num.toFixed(places);
	const normalized = /^-0(\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed;
	const dot = normalized.indexOf('.');
	const intPart = dot === -1 ? normalized : normalized.slice(0, dot);
	const frac = dot === -1 ? '' : normalized.slice(dot);
	return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
}

/**
 * 把 mil 数值按当前单位格式化（线宽与长度共用的内核）
 *
 * @param {number|string} milValue 数值（mil）
 * @param {'mil'|'mm'} unit 显示单位
 * @returns {string} 显示文本；入参非有限数时返回空串
 * @sideEffects 无（纯函数）
 */
function formatMil(milValue, unit) {
	const num = Number(milValue);
	if (!Number.isFinite(num)) return '';
	const value = unit === 'mm' ? num * MM_PER_MIL : num;
	return formatNumber(value, WIDTH_DIGITS[unit] || WIDTH_DIGITS.mil);
}

/**
 * 线宽 → 显示文本（按单位选精度）
 *
 * @param {number|string} widthMil 线宽（mil）
 * @param {'mil'|'mm'} unit 显示单位
 * @returns {string} 显示文本；入参非有限数时返回空串
 * @sideEffects 无（纯函数）
 */
export function formatWidth(widthMil, unit) {
	return formatMil(widthMil, unit);
}

/**
 * 长度 → 显示文本（先换算单位再格式化）
 *
 * ⚠️ 统计里的 `lengthMil` **永远是 mil**，切到 mm 时必须先乘 0.0254，
 * 只改小数位数会显示成「长度 (mm) 8,115.0」这种错值。
 *
 * @param {number|string} lengthMil 长度（mil）
 * @param {'mil'|'mm'} unit 显示单位
 * @returns {string} 显示文本；入参非有限数时返回空串
 * @sideEffects 无（纯函数）
 */
export function formatLength(lengthMil, unit) {
	return formatMil(lengthMil, unit);
}

/**
 * 解析「目标线宽」输入（三态）
 *
 * - 留空 → `null`（不修改）
 * - `0` → `0`（删除该行导线）
 * - 正数 → 目标线宽（mil）
 * - 负数 / 非数字 / 超上限 → `NaN`
 *
 * 允许千分位逗号（表格里显示的就是 `1,000.0`，用户也可能从 Excel 粘贴）。
 * 用正则先拦掉 `1e5`、`0x10`、`Infinity` 这类 `Number()` 会接受但业务上没意义的写法。
 *
 * @param {string|null|undefined} text 输入文本
 * @param {'mil'|'mm'} unit 输入单位
 * @returns {number|null} 目标线宽（mil）/ `null` / `0` / `NaN`
 * @sideEffects 无（纯函数）
 */
export function parseWidth(text, unit) {
	if (text === null || text === undefined) return null;
	const raw = String(text).replace(/,/g, '').trim();
	if (raw === '') return null;
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return NaN;

	const num = Number(raw);
	if (!Number.isFinite(num) || num < 0) return NaN;
	const mil = unit === 'mm' ? num * MIL_PER_MM : num;
	if (mil > MAX_WIDTH_MIL) return NaN;
	return mil === 0 ? 0 : mil;
}

/**
 * 按「当前单位下格式化后的线宽」分组
 *
 * 行对象里的 `widthMil` 由 `key` 反解，也就是**实际会写入的规整值**；
 * 不要把第一条图元的原始 `lineWidth`（可能是 6.000000000000001）存进去。
 *
 * @param {Array<{id: string, kind: string, layer: number, widthMil: number, lengthMil: number}>} items 图元
 * @param {'mil'|'mm'} unit 显示单位
 * @returns {Array<{key: string, widthMil: number, count: number, lengthMil: number, items: Array<object>}>} 行（按线宽升序）
 * @sideEffects 无（纯函数）
 */
export function groupByWidth(items, unit) {
	const list = Array.isArray(items) ? items : [];
	const map = new Map();

	for (const item of list) {
		const key = formatWidth(item.widthMil, unit);
		if (!key) continue;
		let row = map.get(key);
		if (!row) {
			row = { key: key, widthMil: parseWidth(key, unit), count: 0, lengthMil: 0, items: [] };
			map.set(key, row);
		}
		row.count += 1;
		row.lengthMil += Number(item.lengthMil) || 0;
		row.items.push({ id: item.id, kind: item.kind, layer: item.layer });
	}

	return [...map.values()].sort((a, b) => a.widthMil - b.widthMil);
}

/**
 * 背景柱宽度百分比（以列内最大值为 100%）
 *
 * @param {number} value 当前值
 * @param {number} max 列内最大值
 * @returns {number} 0~100 的百分比（保留 1 位）；0 或非法值返回 0
 * @sideEffects 无（纯函数）
 */
export function barPercent(value, max) {
	const v = Number(value);
	const m = Number(max);
	if (!Number.isFinite(v) || !Number.isFinite(m) || v <= 0 || m <= 0) return 0;
	if (v >= m) return 100;
	return Math.max(BAR_MIN_PERCENT, Math.round((v / m) * 1000) / 10);
}
