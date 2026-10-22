/**
 * @//module/ app/netlist-3d/transform
 * @//description/ 3D 模型参数模型：Transform 九参数解析/重建、mm↔mil 换算、写回校验、状态样式
 * @//exports/ DEFAULT_TRANSFORM, STATUS_CLASS, parseTransform, composeTransform, toDisplay, toRaw, applyInput, buildRows, isModelMatch
 * @//dependencies/ core/netlist
 * @//example/ const { parseTransform, toDisplay } = await import('./transform.js')
 *            parseTransform('387,200,300,90,0,45.5,10,20,0') // { sX: 387, sY: 200, ... rZ: 90, ... }
 *            toDisplay(387, 'mm', false) // 9.8298（mil → mm）
 *
 * `3D Model Transform` 的存储顺序是 `sX,sY,sZ,rZ,rX,rY,oX,oY,oZ`，
 * 而界面输入顺序是 `X,Y,Z` 两组，注意 rZ 在数组里的位置比 rX 前 —— 原实现靠注释提醒，
 * 这里收成 `parseTransform` / `composeTransform` 一对函数，避免下标再被抄错。
 */

import { getComponentsContainer } from '../../core/netlist.js';

/** 没有 3D 变换时的默认串 */
export const DEFAULT_TRANSFORM = '0,0,0,0,0,0,0,0,0';

/** 1 mil = 0.0254 mm */
const MIL_TO_MM = 0.0254;

/**
 * 状态 → 单元格 CSS 类
 *
 * 原实现只映射了 成功/失败/未找到/已修改，`跳过` 与 `校验失败` 会落到默认的 `status-ready`（看起来像还没处理）。
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_CLASS = Object.freeze({
	待更新: 'status-ready',
	已修改: 'status-success',
	成功: 'status-success',
	跳过: 'status-ready',
	未找到: 'status-error',
	失败: 'status-error',
	校验失败: 'status-error',
	无模型: 'status-ready',
});

/**
 * 解析 Transform 串
 *
 * @param {string} transform 形如 `sX,sY,sZ,rZ,rX,rY,oX,oY,oZ`
 * @returns {{sX: number, sY: number, sZ: number, rX: number, rY: number, rZ: number, oX: number, oY: number, oZ: number}} 九参数
 * @sideEffects 无（纯函数）
 */
export function parseTransform(transform) {
	const parts = String(transform || '')
		.split(',')
		.map(Number);
	const at = (index) => (Number.isFinite(parts[index]) ? parts[index] : 0);
	return {
		sX: at(0),
		sY: at(1),
		sZ: at(2),
		rZ: at(3),
		rX: at(4),
		rY: at(5),
		oX: at(6),
		oY: at(7),
		oZ: at(8),
	};
}

/**
 * 按存储顺序重新拼 Transform 串
 *
 * @param {object} item 含九参数的对象
 * @returns {string} 可直接写回 `3D Model Transform` 的字符串
 * @sideEffects 无（纯函数）
 */
export function composeTransform(item) {
	return [item.sX, item.sY, item.sZ, item.rZ, item.rX, item.rY, item.oX, item.oY, item.oZ].join(',');
}

/**
 * 内部值（mil）→ 界面显示值
 *
 * @param {number|string} value 原始值
 * @param {string} unit 当前单位（'mm' | 'mil'）
 * @param {boolean} [isDegree=false] 是否角度（角度不做单位换算）
 * @returns {number|string} 显示值；非数字原样返回
 * @sideEffects 无（纯函数）
 */
export function toDisplay(value, unit, isDegree = false) {
	const num = Number(value);
	if (isNaN(num)) return value;
	if (isDegree) return Number(num.toFixed(3));
	if (unit === 'mm') return Number((num * MIL_TO_MM).toFixed(3));
	return Number(num.toFixed(3));
}

/**
 * 界面输入值 → 内部值（mil）
 *
 * @param {number|string} value 输入框里的值
 * @param {string} unit 当前单位
 * @param {boolean} isDegree 是否角度
 * @returns {number} 内部值（非数字按 0）
 * @sideEffects 无（纯函数）
 */
export function toRaw(value, unit, isDegree) {
	const num = Number(value);
	if (isNaN(num)) return 0;
	if (isDegree) return num;
	return unit === 'mm' ? num / MIL_TO_MM : num;
}

/**
 * 把一个输入框的改动写进行数据
 *
 * @param {object} item 行数据（就地修改）
 * @param {string} field 字段名（sX/sY/sZ/rX/rY/rZ/oX/oY/oZ）
 * @param {string|number} value 新值（界面单位）
 * @param {string} unit 当前单位
 * @returns {object} 同一个 item（便于链式断言）
 * @sideEffects **就地修改** item 的字段、rawTransform 与 status
 */
export function applyInput(item, field, value, unit) {
	const isDegree = field.startsWith('r');
	item[field] = toRaw(value, unit, isDegree);
	item.rawTransform = composeTransform(item);
	item.status = '已修改';
	return item;
}

/**
 * 从网表容器构建表格行
 *
 * @param {object} netlist 网表对象
 * @returns {Array<object>} 行数据（只收有位号的器件）
 * @sideEffects 无（纯函数）
 */
export function buildRows(netlist) {
	const rows = [];
	const container = getComponentsContainer(netlist);
	for (const key in container) {
		const component = container[key];
		if (!component || !component.props) continue;
		const row = toRow(component.props);
		if (row) rows.push(row);
	}
	return rows;
}

/**
 * 按顺序取第一个真值（等价于原来的 `a || b || c || fallback` 链）
 *
 * @param {Array<*>} values 候选值
 * @param {*} fallback 全为空时的兜底
 * @returns {*} 第一个真值，或 fallback
 * @sideEffects 无（纯函数）
 */
function firstFilled(values, fallback) {
	for (const value of values) {
		if (value) return value;
	}
	return fallback;
}

/**
 * 单个器件 → 行数据（无位号返回 null，由调用方跳过）
 *
 * @param {object} props 器件属性
 * @returns {object|null} 行数据
 * @sideEffects 无（纯函数）
 */
function toRow(props) {
	const designator = props.Designator;
	if (!designator) return null;

	const rawModel = props['3D Model'] || '';
	const transform = props['3D Model Transform'] || DEFAULT_TRANSFORM;
	return {
		id: designator,
		designator: designator,
		footprint: firstFilled([props.FootprintName, props['Footprint Name'], props.Footprint], '-'),
		modelTitle: props['3D Model Title'] || '没有找到 3D 模型',
		rawModel: rawModel,
		rawTransform: transform,
		...parseTransform(transform),
		status: rawModel ? '待更新' : '无模型',
		primitiveId: null,
	};
}

/**
 * 校验 `modify` 的返回值是否真的写进去了
 *
 * 器件 `3D Model` 实参形如 `uuid|其它信息`，比较时只取 `|` 前的 UUID。
 *
 * @param {{rawModel: string, modelTitle: string, rawTransform: string}} item 行数据
 * @param {object} result `pcb_PrimitiveComponent.modify` 的返回
 * @returns {boolean} 三个字段是否都一致
 * @sideEffects 无（纯函数）
 */
export function isModelMatch(item, result) {
	if (!result || !result.otherProperty) return false;
	const ret = result.otherProperty;
	const retModel = String(ret['3D Model'] || '').split('|')[0];
	const targetModel = String(item.rawModel || '').split('|')[0];
	return retModel === targetModel && (ret['3D Model Title'] || '') === item.modelTitle && (ret['3D Model Transform'] || '') === item.rawTransform;
}
