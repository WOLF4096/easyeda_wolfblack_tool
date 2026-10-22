/**
 * @//module/ format/componentCode
 * @//description/ 阻容感的编码式命名换算：01C / 104 / 4R7 → 带单位的数值文本
 * @//exports/ convertCodeToValue, formatValue
 * @//dependencies/ 无
 * @//example/ const { convertCodeToValue } = await import('./format/componentCode.js')
 *            convertCodeToValue('01C', 'R') // { text: '10kΩ', raw: 10000 }
 *            convertCodeToValue('104', 'C') // { text: '100nF', raw: 100000 }
 *
 * 全部是纯函数（不碰 DOM / eda / 存储），因此可以直接被 node --test 覆盖。
 * 单位口径：电阻 → Ω，电容 → pF，电感 → uH（与页面上「实际数值」排序一致）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** E96 系列电阻代码映射表（两位代码 → 有效数字） */
const E96_VALUES = {
	'01': 100,
	'02': 102,
	'03': 105,
	'04': 107,
	'05': 110,
	'06': 113,
	'07': 115,
	'08': 118,
	'09': 121,
	10: 124,
	11: 127,
	12: 130,
	13: 133,
	14: 137,
	15: 140,
	16: 143,
	17: 147,
	18: 150,
	19: 154,
	20: 158,
	21: 162,
	22: 165,
	23: 169,
	24: 174,
	25: 178,
	26: 182,
	27: 187,
	28: 191,
	29: 196,
	30: 200,
	31: 205,
	32: 210,
	33: 215,
	34: 221,
	35: 226,
	36: 232,
	37: 237,
	38: 243,
	39: 249,
	40: 255,
	41: 261,
	42: 267,
	43: 274,
	44: 280,
	45: 287,
	46: 294,
	47: 301,
	48: 309,
	49: 316,
	50: 324,
	51: 332,
	52: 340,
	53: 348,
	54: 357,
	55: 365,
	56: 374,
	57: 383,
	58: 392,
	59: 402,
	60: 412,
	61: 422,
	62: 432,
	63: 442,
	64: 453,
	65: 464,
	66: 475,
	67: 487,
	68: 499,
	69: 511,
	70: 523,
	71: 536,
	72: 549,
	73: 562,
	74: 576,
	75: 590,
	76: 604,
	77: 619,
	78: 634,
	79: 649,
	80: 665,
	81: 681,
	82: 698,
	83: 715,
	84: 732,
	85: 750,
	86: 768,
	87: 787,
	88: 806,
	89: 825,
	90: 845,
	91: 866,
	92: 887,
	93: 909,
	94: 931,
	95: 953,
	96: 976,
};

/** E96 乘数字母映射 */
const E96_MULTIPLIERS = { Z: 0.001, Y: 0.01, X: 0.1, A: 1, B: 10, C: 100, D: 1000, E: 10000, F: 100000, G: 1000000 };

/** 无法换算时返回的哨兵值（排序时排在最后） */
const INVALID_RAW = Number.MAX_VALUE;

/**
 * 按类型分发换算
 *
 * @param {string} code 编码名（如 `01C` / `104` / `4R7`）
 * @param {'R'|'C'|'L'} type 元件类型（取位号首字母）
 * @returns {{text: string|null, raw: number}} 展示文本与实际数值（pF / uH / Ω 基准）
 * @sideEffects 无（纯函数）
 */
export function convertCodeToValue(code, type) {
	if (!code || !type) return { text: null, raw: INVALID_RAW };

	const strCode = code.toString().toUpperCase();

	switch (type.toUpperCase()) {
		case 'R':
			return convertResistor(strCode);
		case 'C':
			return convertCapacitor(strCode);
		case 'L':
			return convertInductor(strCode);
		default:
			return { text: code, raw: INVALID_RAW };
	}
}

/**
 * 电阻换算
 *
 * 三种写法：`01C`（E96 三位）、`4R7`/`2K2`（单位内嵌小数点）、`104`（前两位 × 10^末位）。
 *
 * @param {string} code 已大写的编码
 * @returns {{text: string|null, raw: number}} 结果
 * @sideEffects 无（纯函数）
 */
function convertResistor(code) {
	if (code.length === 3 && /^\d{2}[A-Z]$/.test(code)) {
		const digits = code.substring(0, 2);
		const multiplierChar = code.substring(2, 3);
		if (E96_VALUES[digits] && E96_MULTIPLIERS[multiplierChar]) {
			const value = E96_VALUES[digits] * E96_MULTIPLIERS[multiplierChar];
			return { text: formatValue(value, 'R'), raw: value };
		}
	}

	if (/^[0-9.]*[RKM][0-9.]*$/.test(code)) {
		const value = parseResistorWithUnit(code);
		if (value !== null) return { text: formatValue(value, 'R'), raw: value };
	}

	const numericValue = plainCodeToNumber(code, true);
	if (isNaN(numericValue) || numericValue === null) return { text: code, raw: INVALID_RAW };
	return { text: formatValue(numericValue, 'R'), raw: numericValue };
}

/**
 * 电容换算
 *
 * @param {string} code 已大写的编码
 * @returns {{text: string|null, raw: number}} 结果（raw 以 pF 为基准）
 * @sideEffects 无（纯函数）
 */
function convertCapacitor(code) {
	let numericValue;
	if (/^[0-9.]*[PNUM][0-9.]*[F]?$/.test(code)) {
		numericValue = parseCapacitorWithUnit(code);
	} else {
		numericValue = plainCodeToNumber(code, false);
	}
	if (isNaN(numericValue) || numericValue === null) return { text: code, raw: INVALID_RAW };
	return { text: formatValue(numericValue, 'C'), raw: numericValue };
}

/**
 * 电感换算
 *
 * @param {string} code 已大写的编码
 * @returns {{text: string|null, raw: number}} 结果（raw 以 uH 为基准）
 * @sideEffects 无（纯函数）
 */
function convertInductor(code) {
	let numericValue;
	if (/^[0-9.]*[RNUMH][0-9.]*[H]?$/.test(code)) {
		numericValue = parseInductorWithUnit(code);
	} else {
		numericValue = plainCodeToNumber(code, false);
	}
	if (isNaN(numericValue) || numericValue === null) return { text: code, raw: INVALID_RAW };
	return { text: formatValue(numericValue, 'L'), raw: numericValue };
}

/**
 * 纯数字编码 → 数值
 *
 * 3 位（`104`）= 前两位 × 10^末位；4 位（`1002`）只有**电阻**按「前三位 × 10^末位」解释，
 * 电容/电感仍按普通数字（这是原实现的口径差异，不要顺手统一）。
 *
 * @param {string} code 编码
 * @param {boolean} fourDigitRule 是否启用 4 位尾数规则（仅电阻）
 * @returns {number} 数值；无法解析时为 NaN
 * @sideEffects 无（纯函数）
 */
function plainCodeToNumber(code, fourDigitRule) {
	if (/^\d+$/.test(code)) {
		if (code.length === 3) return parseInt(code.substring(0, 2), 10) * Math.pow(10, parseInt(code.substring(2, 3), 10));
		if (code.length === 4 && fourDigitRule) return parseInt(code.substring(0, 3), 10) * Math.pow(10, parseInt(code.substring(3, 4), 10));
	}
	return parseFloat(code);
}

/** 电阻里被视为「零」的写法 */
const ZERO_RESISTOR_CODES = ['0', '00', '000', '0R'];

/** 电阻的内嵌单位 → 倍率 */
const RESISTOR_MULTIPLIERS = { R: 1, K: 1000, M: 1000000 };

/**
 * `R01` 这种「R 开头」写法（R 后面直接是小数部分）
 *
 * @param {string} upper 已大写的编码
 * @returns {number|null} 电阻值；无法解析为 null
 * @sideEffects 无（纯函数）
 */
function parseLeadingR(upper) {
	const numericValue = parseFloat('0.' + upper.substring(1));
	return isNaN(numericValue) ? null : numericValue;
}

/**
 * 把 `4R7` / `2K2` 拆成整数部分、小数部分与单位字符
 *
 * @param {string} upper 已大写的编码
 * @returns {{integerPart: string, decimalPart: string, unitChar: string}|null} 拆分结果；不匹配为 null
 * @sideEffects 无（纯函数）
 */
function splitResistorUnit(upper) {
	const match = upper.match(/^([0-9]*\.?[0-9]*)[RKM]([0-9]*)$/);
	if (!match) return null;

	const integerPart = match[1] || '0';
	const unitChar = upper.includes('K') ? 'K' : upper.includes('M') ? 'M' : 'R';
	const decimalPart = match[2] || '';
	return { integerPart: integerPart, decimalPart: decimalPart, unitChar: unitChar };
}

/**
 * 把拆分结果换算成电阻值（Ω）
 *
 * @param {{integerPart: string, decimalPart: string, unitChar: string}} parts 拆分结果
 * @returns {number|null} 电阻值；无法解析为 null
 * @sideEffects 无（纯函数）
 */
function resistorValueOf(parts) {
	const head = parts.decimalPart ? parseFloat(parts.integerPart + '.' + parts.decimalPart) : parseFloat(parts.integerPart);
	if (isNaN(head)) return null;
	// 0R5 这种「整数部分为 0」的写法按小数处理
	const numericValue = parts.integerPart === '0' && parts.decimalPart ? parseFloat('0.' + parts.decimalPart) : head;

	return numericValue * (RESISTOR_MULTIPLIERS[parts.unitChar] || 1);
}

/**
 * 解析带单位的电阻（`4R7` / `2K2` / `R01` / `0R5`）
 *
 * @param {string} code 编码
 * @returns {number|null} 电阻值（Ω）；无法解析为 null
 * @sideEffects 无（纯函数）
 */
function parseResistorWithUnit(code) {
	const upper = String(code).toUpperCase();
	if (ZERO_RESISTOR_CODES.includes(upper)) return 0;

	// R 开头（R01 = 0.01Ω）
	if (upper.startsWith('R') && upper.length >= 2) return parseLeadingR(upper);

	const parts = splitResistorUnit(upper);
	if (!parts) return parseFloat(upper);
	return resistorValueOf(parts);
}

/**
 * 解析带单位的电容（`4u7` / `100n` / `2M2`）
 *
 * @param {string} code 编码
 * @returns {number|null} 电容值（pF）；无法解析为 null
 * @sideEffects 无（纯函数）
 */
function parseCapacitorWithUnit(code) {
	const upper = String(code).toUpperCase().replace('F', '');
	const match = upper.match(/^([0-9.]*)([PNUM])([0-9.]*)$/);
	if (!match) return parseFloat(upper);

	const numericValue = joinDecimal(match[1], match[3]);
	if (numericValue === null) return null;

	const multipliers = { P: 1, N: 1000, U: 1000000, M: 1000000000 };
	return numericValue * (multipliers[match[2]] || 1);
}

/**
 * 解析带单位的电感（`4u7` / `100n` / `2R2`）
 *
 * @param {string} code 编码
 * @returns {number|null} 电感值（uH）；无法解析为 null
 * @sideEffects 无（纯函数）
 */
function parseInductorWithUnit(code) {
	const upper = String(code).toUpperCase().replace('H', '');

	// R 开头（R01 = 0.01uH）
	if (upper.startsWith('R') && upper.length >= 2) {
		const numericValue = parseFloat('0.' + upper.substring(1));
		return isNaN(numericValue) ? null : numericValue;
	}

	const match = upper.match(/^([0-9.]*)([RNUMH])([0-9.]*)$/);
	if (!match) return parseFloat(upper);

	const numericValue = joinDecimal(match[1], match[3]);
	if (numericValue === null) return null;

	const multipliers = { R: 1, U: 1, N: 0.001, M: 1000, H: 1000000 };
	return numericValue * (multipliers[match[2]] || 1);
}

/**
 * 把「整数部分 + 小数部分」拼成一个数
 *
 * `2` + `2` → 2.2（不是 22）。电容与电感两份解析里原本是这个片段各写了一遍。
 *
 * @param {string} integerPart 整数部分（可能为空）
 * @param {string} decimalPart 小数部分（可能为空）
 * @returns {number|null} 数值；无法解析为 null
 * @sideEffects 无（纯函数）
 */
function joinDecimal(integerPart, decimalPart) {
	const head = integerPart || '0';
	const value = decimalPart ? parseFloat(head + '.' + decimalPart) : parseFloat(head);
	return isNaN(value) ? null : value;
}

/** 各类型的单位阶梯（factor 为该单位换算到基准单位的倍数，从小到大） */
const VALUE_UNITS = {
	R: [
		{ unit: 'mΩ', factor: 0.001 },
		{ unit: 'Ω', factor: 1 },
		{ unit: 'kΩ', factor: 1000 },
		{ unit: 'MΩ', factor: 1000000 },
	],
	C: [
		{ unit: 'pF', factor: 1 },
		{ unit: 'nF', factor: 1000 },
		{ unit: 'uF', factor: 1000000 },
		{ unit: 'mF', factor: 1000000000 },
		{ unit: 'F', factor: 1000000000000 },
	],
	L: [
		{ unit: 'nH', factor: 0.001 },
		{ unit: 'uH', factor: 1 },
		{ unit: 'mH', factor: 1000 },
		{ unit: 'H', factor: 1000000 },
	],
};

/** 零值文案（类型不认识时退回 `'0'`） */
const ZERO_TEXT = { R: '0Ω', C: '0pF', L: '0uH' };

/**
 * 选出「不超过该数值的最大单位」
 *
 * @param {Array<{unit: string, factor: number}>} typeUnits 单位阶梯（从小到大）
 * @param {number} absValue 数值的绝对值
 * @returns {{unit: string, factor: number}} 选中的单位
 * @sideEffects 无（纯函数）
 */
function bestUnitOf(typeUnits, absValue) {
	let bestUnit = typeUnits[0];
	for (let i = typeUnits.length - 1; i >= 0; i--) {
		if (absValue >= typeUnits[i].factor || i === 0) {
			bestUnit = typeUnits[i];
			break;
		}
	}
	return bestUnit;
}

/**
 * 数值 → 带单位的展示文本
 *
 * 选「最大的、不超过该值的单位」；保留 3 位小数后去掉尾随零。
 *
 * @param {number} value 数值（单位基准见各类型）
 * @param {'R'|'C'|'L'} type 元件类型
 * @returns {string|null} 展示文本；非法值为 null
 * @sideEffects 无（纯函数）
 */
export function formatValue(value, type) {
	if (value === undefined || value === null || isNaN(value)) return null;

	if (value === 0) return ZERO_TEXT[type] || '0';

	const typeUnits = VALUE_UNITS[type];
	if (!typeUnits) return value.toString();

	const bestUnit = bestUnitOf(typeUnits, Math.abs(value));
	const displayValue = Number((value / bestUnit.factor).toFixed(3)).toString();
	return displayValue + bestUnit.unit;
}
