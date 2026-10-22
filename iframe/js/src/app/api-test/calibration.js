/**
 * @//module/ app/api-test/calibration
 * @//description/ 校准数学：运算符解析、（含逗号坐标的）整串套用、容差比对、倍率互转
 * @//exports/ MULTIPLIER_MIN, MULTIPLIER_MAX, applyCal, applyCalStr, compare, ratioToCalInput, calToMultiplier
 * @//dependencies/ 无
 * @//example/ const { applyCal, compare } = await import('./calibration.js')
 *            applyCal('2275.00', '*0.5')   // 1137.5
 *            compare('10,20', '10.01,20.02') // true（容差 0.05）
 *
 * 校准值是「运算符 + 数字」的字符串（`*0.5` / `/2` / `+1` / `-1`），空串等价于 `*1`。
 */

/** 允许保存的倍率下界：兜住角度↔弧度换算（0.017453） */
export const MULTIPLIER_MIN = 0.001;

/** 允许保存的倍率上界（57.2958 也要放得下，同时挡住手滑输入的天文数字） */
export const MULTIPLIER_MAX = 1000;

/**
 * 对单个数值套用校准表达式
 *
 * @param {string|number} val 原值
 * @param {string} cal 校准表达式（如 `*0.5`）；空值或非法时返回原值
 * @returns {number|string|undefined} 结果；原值非数字时原样返回
 * @sideEffects 无（纯函数）
 */
export function applyCal(val, cal) {
	const value = parseFloat(val);
	if (isNaN(value) || !cal) return val;
	const op = cal.charAt(0);
	const num = parseFloat(cal.substring(1));
	if (isNaN(num)) return value;
	if (op === '*') return value * num;
	if (op === '/') return value / num;
	if (op === '+') return value + num;
	if (op === '-') return value - num;
	return value;
}

/**
 * 对「可能是 `x,y` 坐标」的字符串整体套用校准
 *
 * @param {string|number} valStr 原值
 * @param {string} calStr 校准表达式
 * @returns {string|number} 结果（坐标格式会被保留，最多 4 位小数）
 * @sideEffects 无（纯函数）
 */
export function applyCalStr(valStr, calStr) {
	if (!calStr) return valStr;
	const text = String(valStr);
	if (!text.includes(',')) return applyCal(valStr, calStr);

	const parts = text.split(',');
	const fmt = (v) => (Number.isInteger(v) ? v : parseFloat(Number(v).toFixed(4)));
	return `${fmt(applyCal(parts[0], calStr))},${fmt(applyCal(parts[1], calStr))}`;
}

/**
 * 带容差的比较（坐标按分量逐项比）
 *
 * @param {string|number} a 期望值
 * @param {string|number} b 实际值
 * @param {number} [tolerance=0.05] 容差
 * @returns {boolean} 是否在容差内一致
 * @sideEffects 无（纯函数）
 */
export function compare(a, b, tolerance = 0.05) {
	const strA = String(a);
	const strB = String(b);
	if (strA.includes(',') || strB.includes(',')) {
		const partsA = strA.split(',');
		const partsB = strB.split(',');
		if (partsA.length !== partsB.length) return false;
		return partsA.every((part, index) => Math.abs(parseFloat(part) - parseFloat(partsB[index])) < tolerance);
	}
	return Math.abs(parseFloat(a) - parseFloat(b)) < tolerance;
}

/**
 * 把「设定值 / 实际值」的比值写成校准表达式
 *
 * 比值接近 1 时返回空串（等价 `*1`），保持界面干净；大于 1 用 `*x`，小于 1 用 `/x`。
 *
 * @param {number} ratio 目标倍率
 * @returns {string} `*x` / `/x` / ''
 * @sideEffects 无（纯函数）
 */
export function ratioToCalInput(ratio) {
	if (!Number.isFinite(ratio) || ratio === 0) return '';
	if (Math.abs(ratio - 1) <= 0.001) return '';
	const rounded = parseFloat(ratio.toFixed(3));
	if (ratio > 1) return `*${rounded}`;
	return `/${parseFloat((1 / ratio).toFixed(3))}`;
}

/**
 * 把校准表达式转成「纯乘数」（用于持久化到扩展配置）
 *
 * 空串 → 1；`*x` → x；`/x` → 1/x；纯数字（用户没写符号）→ 该数字；加减法无法表达为乘数 → 1。
 * 越界（< 0.001 或 > 1000）返回 `NaN`，由调用方决定报错而不是写入存储。
 *
 * @param {string} text 校准表达式
 * @returns {number} 乘数；越界或非法时为 NaN
 * @sideEffects 无（纯函数）
 */
export function calToMultiplier(text) {
	if (!text || text.trim() === '') return 1;

	const op = text.charAt(0);
	const num = parseFloat(text.substring(1));
	if (op === '*' && !isNaN(num)) return roundMultiplier(num);
	if (op === '/' && !isNaN(num) && num !== 0) return roundMultiplier(1 / num);

	const pure = parseFloat(text);
	if (!isNaN(pure) && op !== '+' && op !== '-') return roundMultiplier(pure);
	return 1;
}

/**
 * 倍率取整并检查范围
 *
 * @param {number} value 倍率
 * @returns {number} 最多 6 位小数的倍率；越界为 NaN
 * @sideEffects 无（纯函数）
 */
function roundMultiplier(value) {
	if (!Number.isFinite(value) || value < MULTIPLIER_MIN || value > MULTIPLIER_MAX) return Number.NaN;
	return parseFloat(value.toFixed(6));
}
