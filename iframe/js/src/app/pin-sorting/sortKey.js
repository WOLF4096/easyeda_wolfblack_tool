/**
 * @//module/ app/pin-sorting/sortKey
 * @//description/ 引脚排序键与布局计算：末尾排序的键变换、比较器、按朝向排布坐标
 * @//exports/ normalizeRotation, createTransformKey, createComparator, planLayout
 * @//dependencies/ 无
 * @//example/ const { planLayout } = await import('./sortKey.js')
 *            const plan = planLayout(pins, { spacing: 10, endSort: false, splitSort: true, order: 'asc', prop: 'name' })
 *            plan.targets[0] // { x, y, rotation }
 *
 * 两段「看着像枚举、其实是位运算」的逻辑必须原样保留：
 *   1. 末尾排序的键变换（拆分排序 vs 逐字符颠倒）；
 *   2. 引脚朝向归一化（0/180 → 180，90/270 → 270，规避 EDA 旋转翻转 bug）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 归一化引脚朝向
 *
 * 只允许两个方向：横向 180、纵向 270。EDA 对 0/90 的处理存在翻转问题，所以不保留原值。
 *
 * @param {number|string} rotation 原始角度
 * @returns {180|270} 归一化后的角度
 * @sideEffects 无（纯函数）
 */
export function normalizeRotation(rotation) {
	const deg = (((Number(rotation) || 0) % 360) + 360) % 360;
	return deg === 90 || deg === 270 ? 270 : 180;
}

/**
 * 创建「末尾排序」的键变换函数
 *
 * 勾了拆分排序：先按「字母段/数字段」切分再颠倒段序，段内字符保持原值
 * （`DQ10` → `[DQ,10]` → `10DQ`，保证 DQ6 排在 DQ10 前）。
 * 未勾：整串逐字符颠倒（`UDQS` → `SQDU`）。
 *
 * @param {boolean} useSplitSort 是否拆分排序
 * @returns {(key: string) => string} 键变换函数
 * @sideEffects 无（纯函数）
 */
export function createTransformKey(useSplitSort) {
	return (key) => {
		const text = String(key === null || key === undefined ? '' : key);
		if (!useSplitSort) return text.split('').reverse().join('');
		const chunks = text.match(/\d+|\D+/g);
		return chunks ? chunks.reverse().join('') : text;
	};
}

/**
 * 创建引脚比较器
 *
 * @param {object} options 选项
 * @param {string} options.prop 比较的属性（name / number）
 * @param {boolean} options.endSort 是否末尾排序（先做键变换）
 * @param {boolean} options.splitSort 是否拆分排序（影响键变换与 collator 的 numeric）
 * @param {'asc'|'desc'} options.order 升降序
 * @returns {(a: object, b: object) => number} 比较器
 * @sideEffects 无（纯函数）
 */
export function createComparator(options) {
	const prop = options.prop;
	const endSort = options.endSort;
	const splitSort = options.splitSort;
	const order = options.order;
	const transformKey = createTransformKey(splitSort);
	const collator = new Intl.Collator(undefined, { numeric: splitSort, sensitivity: 'base' });

	return (a, b) => {
		const rawA = (a[prop] || '').toString();
		const rawB = (b[prop] || '').toString();
		const valA = endSort ? transformKey(rawA) : rawA;
		const valB = endSort ? transformKey(rawB) : rawB;
		const result = splitSort ? collator.compare(valA, valB) : valA.localeCompare(valB);
		return order === 'asc' ? result : -result;
	};
}

/**
 * 计算重排后的坐标与朝向
 *
 * 参考原点：X 取最小（最靠左）、Y 取最大（最靠上，JLCEDA 的 Y 轴向上）。
 * 朝向来自**排序后第一个引脚**的归一化结果：
 *   - 180（横向朝向）→ 竖向排布：X 固定、Y 递减；
 *   - 270（竖向朝向）→ 横向排布：Y 固定、X 递增。
 *
 * @param {Array<object>} pins 选中的引脚（不会被修改顺序的原数组副本）
 * @param {object} options 选项
 * @param {number} options.spacing 间距
 * @param {boolean} options.endSort 末尾排序
 * @param {boolean} options.splitSort 拆分排序
 * @param {'asc'|'desc'} options.order 升降序
 * @param {string} options.prop 比较属性
 * @returns {{sorted: Array<object>, targets: Array<{x: number, y: number, rotation: number}>, baseRotation: number, vertical: boolean}} 排布计划
 * @sideEffects 无（纯函数，返回新数组）
 */
export function planLayout(pins, options) {
	const list = Array.isArray(pins) ? pins.slice() : [];
	if (list.length === 0) return { sorted: [], targets: [], baseRotation: 180, vertical: true };

	const spacing = Number(options.spacing);
	const step = Number.isFinite(spacing) && spacing !== 0 ? spacing : 10;

	list.sort(createComparator({ prop: options.prop, endSort: options.endSort, splitSort: options.splitSort, order: options.order }));

	let minX = Infinity;
	let maxY = -Infinity;
	for (const pin of list) {
		if (pin.x < minX) minX = pin.x;
		if (pin.y > maxY) maxY = pin.y;
	}

	const baseRotation = normalizeRotation(list[0].rotation);
	const vertical = baseRotation % 180 === 0;

	const targets = list.map((pin, index) => ({
		x: vertical ? minX : minX + index * step,
		y: vertical ? maxY - index * step : maxY,
		rotation: baseRotation,
	}));

	return { sorted: list, targets: targets, baseRotation: baseRotation, vertical: vertical };
}
