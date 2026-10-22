/**
 * @//module/ app/out-pin-net/matrix
 * @//description/ 「引脚-网络矩阵」的数据模型：扁平化器件、筛选排序、生成表格与导出二维数组
 * @//exports/ buildComponents, filterAndSort, buildMatrix, toCsvRows, toNetLengthRows
 * @//dependencies/ core/pins, core/util
 * @//example/ const { buildComponents, buildMatrix } = await import('./matrix.js')
 *            const { components } = buildComponents(componentsContainer)
 *            const m = buildMatrix(components, 'FootprintName', 'ALL')
 *            // { pins: ['1','2'], rows: [{ designator: 'R1', cells: ['NET1',''] }], corner: '所有封装' }
 *
 * 渲染与导出共用同一份矩阵 —— 原实现里「过滤 + 排序 + 收集引脚 + 角标文案」整块 20 行
 * 在 renderTable 与 exportPinNetAsCSV 里各写了一遍，口径容易漂移。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { collectPinNumbers, getPins } from '../../core/pins.js';
import { naturalCompare } from '../../core/util.js';

/**
 * 把器件容器扁平化成矩阵行所需的数组
 *
 * @param {object} container 组件容器（V2 根对象 / V3-V4 的 components）
 * @returns {{components: Array<object>}} 扁平化后的器件（已把引脚归一为 `pins` 字段）
 * @sideEffects 无（纯函数）
 */
export function buildComponents(container) {
	const components = [];
	if (!container || typeof container !== 'object') return { components: components };
	for (const item of Object.values(container)) {
		if (!item || typeof item !== 'object') continue;
		const props = item.props || {};
		components.push({ ...props, pins: getPins(item) });
	}
	return { components: components };
}

/**
 * 按「属性类型 + 属性值」筛选并按位号排序
 *
 * @param {Array<object>} components buildComponents 的结果
 * @param {string} typeKey 'DeviceName' 或 'FootprintName'
 * @param {string} filterValue 'ALL' 或具体属性值
 * @returns {Array<object>} 筛选排序后的新数组
 * @sideEffects 无（纯函数）
 */
export function filterAndSort(components, typeKey, filterValue) {
	const list = (Array.isArray(components) ? components : []).filter((comp) => filterValue === 'ALL' || comp[typeKey] === filterValue);
	return list.sort((a, b) => naturalCompare(a.Designator || '', b.Designator || ''));
}

/**
 * 生成矩阵（渲染与导出共用）
 *
 * @param {Array<object>} components 全部器件
 * @param {string} typeKey 属性类型
 * @param {string} filterValue 属性值筛选
 * @returns {{pins: string[], rows: Array<{designator: string, cells: string[]}>, corner: string}} 矩阵
 * @sideEffects 无（纯函数）
 */
export function buildMatrix(components, typeKey, filterValue) {
	const filtered = filterAndSort(components, typeKey, filterValue);
	const pins = collectPinNumbers(filtered);
	const rows = filtered.map((comp) => ({
		designator: comp.Designator || '?',
		cells: pins.map((pin) => comp.pins[pin] || ''),
	}));
	const corner = filterValue === 'ALL' ? (typeKey === 'DeviceName' ? '所有器件' : '所有封装') : filterValue;
	return { pins: pins, rows: rows, corner: corner };
}

/**
 * 矩阵 → CSV 二维数组（首行是角标 + 引脚号）
 *
 * @param {{pins: string[], rows: Array<{designator: string, cells: string[]}>, corner: string}} matrix 矩阵
 * @returns {string[][]} 可直接交给 toCsv 的二维数组
 * @sideEffects 无（纯函数）
 */
export function toCsvRows(matrix) {
	const head = [matrix.corner, ...matrix.pins];
	const body = matrix.rows.map((row) => [row.designator === '?' ? '' : row.designator, ...row.cells]);
	return [head, ...body];
}

/**
 * 全部网络 + 长度 → CSV 二维数组
 *
 * @param {Array<{net: string, length: number}>} nets `pcb_Net.getAllNets()` 的返回
 * @returns {string[][]} 含表头的二维数组（长度同时给 mil 与 mm）
 * @sideEffects 无（纯函数）
 */
export function toNetLengthRows(nets) {
	const rows = [['网络名称', '长度(mil)', '长度(mm)']];
	const list = (Array.isArray(nets) ? nets : []).slice().sort((a, b) => naturalCompare(a.net || '', b.net || ''));
	for (const item of list) {
		const lenMil = item.length || 0;
		rows.push([item.net || '', lenMil.toFixed(2), (lenMil * 0.0254).toFixed(4)]);
	}
	return rows;
}
