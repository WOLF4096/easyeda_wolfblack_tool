/**
 * @//module/ app/clear-empty-properties/propsModel
 * @//description/ 「清除多余属性」的数据模型：属性分类、行数据构建、按勾选清空（纯逻辑，不碰 DOM）
 * @//exports/ PRESERVE_KEYS, BASE_PROPS, KEY_PROPS, categoryOf, buildRows, clearBySelection, toggleColumn
 * @//dependencies/ 无
 * @//example/ const { buildRows, clearBySelection } = await import('./propsModel.js')
 *            const rows = buildRows(componentsContainer)
 *            const stat = clearBySelection(rows) // { components, props }
 */

/**
 * 受保护属性：这些键永远不参与清空
 *
 * 与 ReplaceComponent 的 `preserveKeys` 有 7 项重叠，但那处是「替换器件时要保留的字段」，
 * 语义不同，暂不合并；合并需要先确认两边名单一致的业务原因。
 *
 * @type {ReadonlyArray<string>}
 */
export const PRESERVE_KEYS = Object.freeze([
	'Convert to PCB',
	'Reuse Block',
	'Group ID',
	'Channel ID',
	'PCB Layer',
	'Device',
	'Footprint',
	'Add into BOM',
	'FootprintName',
	'DeviceName',
	'SymbolName',
]);

/** 基础属性 */
export const BASE_PROPS = Object.freeze(['Name', 'Unique ID', 'Designator', '3D Model', '3D Model Title', '3D Model Transform']);

/** 关键属性（采购/参数相关） */
export const KEY_PROPS = Object.freeze(['Manufacturer', 'Manufacturer Part', 'Supplier', 'Supplier Part', 'Value']);

/**
 * 判断一个属性键属于哪一类
 *
 * 原来是清空循环里的三个 `includes` + 两个布尔组合判断，抽出后可直接单测。
 *
 * @param {string} key 属性键
 * @returns {'preserve'|'base'|'key'|'more'} 分类
 * @sideEffects 无（纯函数）
 */
export function categoryOf(key) {
	if (PRESERVE_KEYS.includes(key)) return 'preserve';
	if (BASE_PROPS.includes(key)) return 'base';
	if (KEY_PROPS.includes(key)) return 'key';
	return 'more';
}

/**
 * 从组件容器构建表格行
 *
 * 只收「有位号」的器件；供应商为空的行默认勾选并预先勾上「更多属性」
 * （历史行为：这类器件通常是「只有基本参数、没有采购信息」的那批）。
 *
 * @param {object} container 组件容器（V2 根对象 / V3-V4 的 components）
 * @returns {Array<object>} 行数据
 * @sideEffects 无（纯函数，返回新数组）
 */
export function buildRows(container) {
	const rows = [];
	if (!container || typeof container !== 'object') return rows;
	for (const key in container) {
		const comp = container[key];
		if (!comp || !comp.props || !comp.props.Designator) continue;
		rows.push(toRow(key, comp.props));
	}
	return rows;
}

/**
 * 单个器件 → 行数据
 *
 * @param {string} key 容器键
 * @param {object} props 器件属性
 * @returns {object} 行数据
 * @sideEffects 无（纯函数）
 */
function toRow(key, props) {
	const supplier = props.Supplier || '';
	const isEmptySupplier = supplier.trim() === '';
	return {
		id: key,
		designator: props.Designator || '',
		name: props.Name || '',
		// 优先读取 FootprintName，没有则降级读取 Footprint
		footprint: props.FootprintName || props.Footprint || '',
		supplier: supplier,
		// UI 勾选状态：Supplier 为空时勾选行与「更多属性」，否则全不选
		selected: isEmptySupplier,
		clearBase: false,
		clearKey: false,
		clearMore: isEmptySupplier,
		refProps: props,
	};
}

/**
 * 按每行的勾选状态清空属性
 *
 * 只处理「行已勾选」且「至少勾了一个分类」的行；已是空字符串的属性不重复计数。
 *
 * @param {Array<object>} rows 行数据
 * @returns {{components: number, props: number}} 实际改动的器件数与属性数
 * @sideEffects **就地修改** 每行 `refProps` 的键值（这正是要写回网表的内容）
 */
export function clearBySelection(rows) {
	const list = Array.isArray(rows) ? rows : [];
	let components = 0;
	let props = 0;

	for (const row of list) {
		if (!isRowActive(row)) continue;
		const cleared = clearRow(row);
		if (cleared > 0) components++;
		props += cleared;
	}

	return { components: components, props: props };
}

/**
 * 行是否参与清空（已勾选且至少勾了一个分类）
 *
 * @param {object} row 行数据
 * @returns {boolean} 是否参与
 * @sideEffects 无（纯函数）
 */
function isRowActive(row) {
	if (!row.selected) return false;
	return Boolean(row.clearBase || row.clearKey || row.clearMore);
}

/**
 * 分类是否被该行勾选
 *
 * @param {'preserve'|'base'|'key'|'more'} category 属性分类
 * @param {object} row 行数据
 * @returns {boolean} 是否清空
 * @sideEffects 无（纯函数）
 */
function shouldClearKey(category, row) {
	if (category === 'base') return Boolean(row.clearBase);
	if (category === 'key') return Boolean(row.clearKey);
	if (category === 'more') return Boolean(row.clearMore);
	return false;
}

/**
 * 清空一行里勾选分类的属性
 *
 * @param {object} row 行数据（就地修改 refProps）
 * @returns {number} 实际清空的属性数
 * @sideEffects 就地修改 `row.refProps` 的键值
 */
function clearRow(row) {
	let cleared = 0;
	const target = row.refProps || {};
	for (const key in target) {
		const category = categoryOf(key);
		if (category === 'preserve') continue;
		if (!shouldClearKey(category, row)) continue;
		if (target[key] === '') continue;
		target[key] = '';
		cleared++;
	}
	return cleared;
}

/**
 * 列级批量勾选/取消
 *
 * 只作用于「行已勾选」的器件；若它们全都已勾选该列则整体取消，否则整体勾上。
 *
 * @param {Array<object>} rows 行数据
 * @param {'clearBase'|'clearKey'|'clearMore'} field 列字段
 * @returns {boolean} 操作后的目标状态（无激活行时返回 false）
 * @sideEffects 就地修改行的字段
 */
export function toggleColumn(rows, field) {
	const active = (Array.isArray(rows) ? rows : []).filter((row) => row.selected);
	if (active.length === 0) return false;
	const targetState = !active.every((row) => row[field]);
	for (const row of active) row[field] = targetState;
	return targetState;
}
