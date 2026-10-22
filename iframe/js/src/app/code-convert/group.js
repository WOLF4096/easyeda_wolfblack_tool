/**
 * @//module/ app/code-convert/group
 * @//description/ 「元件编码换算」的数据模型：筛器件 → 换算成组 → 唯一 ID 自检 → 批量写回
 * @//exports/ hasUniqueIdProblem, processComponents, groupComponents, applyConversion
 * @//dependencies/ format/componentCode
 * @//example/ const { processComponents, groupComponents, applyConversion } = await import('./group.js')
 *            const groups = groupComponents(processComponents(componentsMap))
 *            const n = applyConversion(groups, componentsMap)
 */

import { convertCodeToValue } from '../../format/componentCode.js';

/** 类型排序权重（R → C → L，其它排最后） */
const TYPE_ORDER = { R: 1, C: 2, L: 3 };

/** 唯一 ID 缺失时的占位串（写回时跳过） */
const EMPTY_ID = '空';

/**
 * 检查唯一 ID 是否为空或重复
 *
 * 原实现写在页面初始化里、变量名还叫 `hasEmptyUniqueId`（其实也在判重复）；
 * 这里改成语义准确的名字，并把「跳到第一处问题就返回」的行为保留。
 *
 * @param {object} componentsMap 组件容器
 * @returns {{empty: boolean, duplicate: boolean, ok: boolean}} 自检结果
 * @sideEffects 无（纯函数）
 */
export function hasUniqueIdProblem(componentsMap) {
	const seen = new Set();
	let empty = false;
	let duplicate = false;
	for (const key in componentsMap) {
		const component = componentsMap[key];
		if (!component || !component.props) continue;
		const uniqueId = component.props['Unique ID'];
		if (!uniqueId) {
			empty = true;
			break;
		}
		if (seen.has(uniqueId)) {
			duplicate = true;
			break;
		}
		seen.add(uniqueId);
	}
	return { empty: empty, duplicate: duplicate, ok: !empty && !duplicate };
}

/**
 * 筛出阻容感器件并换算
 *
 * 过滤条件保留原口径：位号必须以 R/C/L 开头紧跟数字（排除 LED、CON 等），
 * 名称里已带单位的（`10kΩ` / `100nF` / `4.7uH`）不重复换算。
 *
 * @param {object} componentsMap 组件容器
 * @returns {Array<object>} 待分组的数据
 * @sideEffects 无（纯函数）
 */
export function processComponents(componentsMap) {
	const list = [];
	for (const key in componentsMap) {
		const component = componentsMap[key];
		if (!component || !component.props) continue;

		const props = component.props;
		const designator = props.Designator;
		const name = props.Name;
		const uniqueId = props['Unique ID'];
		const footprint = props.FootprintName || '';

		if (!designator || !/^[RCL]\d+/i.test(designator) || /(?:[MK]?Ω|[PNU]?F|[UM]?H|F)/i.test(name)) continue;

		const compType = designator[0].toUpperCase();
		const result = convertCodeToValue(name, compType);
		const isConverted = result.text !== name && result.text !== null;

		list.push({
			uniqueId: uniqueId,
			designator: designator,
			footprint: footprint,
			compType: compType,
			rawValue: result.raw,
			name: name,
			value: result.text,
			shouldModify: isConverted,
			modified: isConverted && Boolean(uniqueId),
		});
	}
	return list;
}

/**
 * 按「名称 + 换算值 + 封装」折叠分组并排序
 *
 * 唯一 ID 为空或重复的组标 `hasError` 且强制取消勾选（写回时会被跳过）。
 *
 * @param {Array<object>} componentsData processComponents 的结果
 * @returns {Array<object>} 分组
 * @sideEffects 无（纯函数）
 */
export function groupComponents(componentsData) {
	const list = Array.isArray(componentsData) ? componentsData : [];
	const groups = [];
	const map = new Map();
	const idCount = countUniqueIds(list);

	for (const component of list) {
		const key = JSON.stringify([component.name, component.value, component.footprint]);
		let group = map.get(key);
		if (!group) {
			group = createGroup(component);
			map.set(key, group);
			groups.push(group);
		}

		if (hasIdError(component, idCount)) {
			group.hasError = true;
			group.modified = false;
		}

		group.uniqueIds.push(component.uniqueId || EMPTY_ID);
		group.designators.push(component.designator);
	}

	groups.sort((a, b) => {
		const typeA = TYPE_ORDER[a.compType] || 99;
		const typeB = TYPE_ORDER[b.compType] || 99;
		if (typeA !== typeB) return typeA - typeB;
		return a.rawValue - b.rawValue;
	});
	return groups;
}

/**
 * 统计每个唯一 ID 出现的次数（空 ID 不计数）
 *
 * @param {Array<object>} list processComponents 的结果
 * @returns {Map<string, number>} 计数表
 * @sideEffects 无（纯函数）
 */
function countUniqueIds(list) {
	const idCount = new Map();
	for (const component of list) {
		if (component.uniqueId) idCount.set(component.uniqueId, (idCount.get(component.uniqueId) || 0) + 1);
	}
	return idCount;
}

/**
 * 该行是否带唯一 ID 问题（为空或重复）
 *
 * @param {object} component 行数据
 * @param {Map<string, number>} idCount 唯一 ID 计数表
 * @returns {boolean} 是否为空或重复
 * @sideEffects 无（纯函数）
 */
function hasIdError(component, idCount) {
	if (!component.uniqueId) return true;
	return idCount.get(component.uniqueId) > 1;
}

/**
 * 由首行数据建一个空分组
 *
 * @param {object} component 首个命中该组的行
 * @returns {object} 分组
 * @sideEffects 无（纯函数）
 */
function createGroup(component) {
	return {
		uniqueIds: [],
		designators: [],
		footprint: component.footprint,
		compType: component.compType,
		rawValue: component.rawValue,
		name: component.name,
		value: component.value,
		shouldModify: component.shouldModify,
		modified: component.modified,
		hasError: false,
	};
}

/**
 * 把勾选的组写回器件属性
 *
 * 原实现对每个唯一 ID 都全量扫一遍组件（O(n²)，上千器件时明显卡）；这里先建索引。
 *
 * @param {Array<object>} groups 分组
 * @param {object} componentsMap 组件容器
 * @returns {number} 实际改动的器件数
 * @sideEffects 就地修改 `component.props.Name` 与 `.Value`
 */
export function applyConversion(groups, componentsMap) {
	const index = indexByUniqueId(componentsMap);

	let count = 0;
	for (const group of Array.isArray(groups) ? groups : []) {
		if (!isApplicable(group)) continue;
		count += applyGroup(group, index);
	}
	return count;
}

/**
 * 建「唯一 ID → 器件」索引（重复 ID 保留首个）
 *
 * @param {object} componentsMap 组件容器
 * @returns {Map<string, object>} 索引
 * @sideEffects 无（纯函数）
 */
function indexByUniqueId(componentsMap) {
	const index = new Map();
	for (const key in componentsMap) {
		const component = componentsMap[key];
		if (!component || !component.props) continue;
		const uniqueId = component.props['Unique ID'];
		if (uniqueId && !index.has(uniqueId)) index.set(uniqueId, component);
	}
	return index;
}

/**
 * 该组是否可写回（勾选、需要改、且无唯一 ID 问题）
 *
 * @param {object} group 分组
 * @returns {boolean} 是否可写回
 * @sideEffects 无（纯函数）
 */
function isApplicable(group) {
	return Boolean(group.modified && group.shouldModify && !group.hasError);
}

/**
 * 把分组值写回组内所有器件
 *
 * @param {object} group 分组
 * @param {Map<string, object>} index 唯一 ID → 器件
 * @returns {number} 实际改动的器件数
 * @sideEffects 就地修改 `component.props.Name` 与 `.Value`
 */
function applyGroup(group, index) {
	let count = 0;
	for (const uniqueId of group.uniqueIds) {
		if (!uniqueId || uniqueId === EMPTY_ID) continue;
		const component = index.get(uniqueId);
		if (!component) continue;
		component.props.Name = group.value;
		component.props.Value = group.value;
		count++;
	}
	return count;
}
