/**
 * @//module/ ui/table
 * @//description/ 表格的纯状态子集：排序状态、排序指示符、行选择汇总与批量选择
 * @//exports/ SORT_INDICATOR, nextSortState, sortIndicatorOf, sortRows, selectionSummary, setAllSelected, invertSelected
 * @//dependencies/ core/util
 * @//example/ const { nextSortState, sortRows, selectionSummary } = await import('./ui/table.js')
 *            state = nextSortState(state, 'designator')
 *            render(sortRows(rows, { key: state.key, asc: state.asc, value: (r, k) => r[k] }))
 *            const { isAll, isIndeterminate } = selectionSummary(rows, (r) => r.selected)
 *
 * 只做「状态与算法」，不碰 DOM：各页面的表格 markup 差异很大（6 个页面 3 种结构），
 * 把渲染留给页面，才能真正复用。行复选框的事件委托在页面侧实现。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { naturalCompare } from '../core/util.js';

/**
 * 排序指示符
 *
 * @type {Readonly<{asc: string, desc: string, none: string}>}
 */
export const SORT_INDICATOR = Object.freeze({ asc: '▲', desc: '▼', none: '' });

/**
 * 计算点击表头后的排序状态
 *
 * 点同一列 → 反转方向；点另一列 → 从升序开始。三个页面各写了一遍这个判断，
 * 且有一处写成了「换列时沿用上一列的方向」，导致点新列先出现降序箭头。
 *
 * @param {{key: string|null, asc: boolean}} state 当前状态
 * @param {string} key 被点击的列
 * @returns {{key: string, asc: boolean}} 新状态
 * @sideEffects 无（纯函数）
 */
export function nextSortState(state, key) {
	const current = state || { key: null, asc: true };
	if (current.key === key) return { key: key, asc: !current.asc };
	return { key: key, asc: true };
}

/**
 * 取某列的排序指示符
 *
 * @param {{key: string|null, asc: boolean}} state 当前排序状态
 * @param {string} key 列名
 * @returns {string} '▲' / '▼' / ''
 * @sideEffects 无（纯函数）
 */
export function sortIndicatorOf(state, key) {
	if (!state || state.key !== key) return SORT_INDICATOR.none;
	return state.asc ? SORT_INDICATOR.asc : SORT_INDICATOR.desc;
}

/**
 * 排序行数据（不改入参）
 *
 * @param {Array<object>} rows 行数据
 * @param {object} spec 排序参数
 * @param {string|null} spec.key 排序列；为空时原样返回副本
 * @param {boolean} [spec.asc=true] 是否升序
 * @param {(row: object, key: string) => *} spec.value 取列值的函数
 * @param {(a: *, b: *) => number} [spec.compare] 比较器，默认位号自然排序
 * @returns {Array<object>} 排序后的新数组
 * @sideEffects 无（纯函数）
 */
export function sortRows(rows, spec) {
	const list = Array.isArray(rows) ? rows.slice() : [];
	const key = spec && spec.key;
	if (!key) return list;
	const getValue = spec.value;
	const compare = typeof spec.compare === 'function' ? spec.compare : naturalCompare;
	const dir = spec.asc === false ? -1 : 1;
	list.sort((a, b) => dir * compare(getValue(a, key), getValue(b, key)));
	return list;
}

/**
 * 汇总行选择状态
 *
 * 用于「全选按钮文案」「主复选框 checked / indeterminate」三处：原先各页各算一遍，
 * 口径容易漂移（漏选一行时主复选框该是 indeterminate 还是 unchecked）。
 *
 * @param {Array<object>} items 行数据
 * @param {(item: object) => boolean} isSelected 判定单行是否选中
 * @returns {{count: number, total: number, isAll: boolean, isIndeterminate: boolean}} 汇总
 * @sideEffects 无（纯函数）
 */
export function selectionSummary(items, isSelected) {
	const list = Array.isArray(items) ? items : [];
	let count = 0;
	for (const item of list) {
		if (isSelected(item)) count++;
	}
	const total = list.length;
	return {
		count: count,
		total: total,
		isAll: total > 0 && count === total,
		isIndeterminate: count > 0 && count < total,
	};
}

/**
 * 批量设置选中/取消选中
 *
 * @param {Array<object>} items 行数据
 * @param {(item: object, value: boolean) => void} setSelected 写入单行状态
 * @param {boolean} value true 全选，false 全清
 * @returns {number} 受影响的行数
 * @sideEffects 修改传入的行对象（由 setSelected 决定）
 */
export function setAllSelected(items, setSelected, value) {
	const list = Array.isArray(items) ? items : [];
	for (const item of list) setSelected(item, !!value);
	return list.length;
}

/**
 * 反选
 *
 * @param {Array<object>} items 行数据
 * @param {(item: object) => boolean} isSelected 读取单行状态
 * @param {(item: object, value: boolean) => void} setSelected 写入单行状态
 * @returns {number} 反选后仍选中的行数
 * @sideEffects 修改传入的行对象（由 setSelected 决定）
 */
export function invertSelected(items, isSelected, setSelected) {
	const list = Array.isArray(items) ? items : [];
	let count = 0;
	for (const item of list) {
		const next = !isSelected(item);
		setSelected(item, next);
		if (next) count++;
	}
	return count;
}
