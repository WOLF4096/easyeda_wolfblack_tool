/**
 * @//module/ app/in-ad-netlist/compare
 * @//description/ AD 网表与当前网表的对比行构建、把 AD 映射写进网表副本
 * @//exports/ buildDesignatorMap, buildCompareRows, applyToCopy
 * @//dependencies/ core/util, core/netlist, core/pins
 * @//example/ const { buildCompareRows } = await import('./compare.js')
 *            const rows = buildCompareRows(netMap, detectContainer(netlist))
 *            // [{ refDes: 'U1', pinNo: '3', oldNet: 'Net1', newNet: 'GND', isDiff: true, ... }]
 */

import { detectContainer } from '../../core/netlist.js';
import { getPins, setPinNet } from '../../core/pins.js';
import { naturalCompare } from '../../core/util.js';

/** 引脚无网络时的占位（与页面展示口径一致） */
const NO_NET = '-';

/**
 * 建「位号 → 器件」索引
 *
 * 兼容 `props.Designator` 与少数扁平结构里直接挂在器件上的 `Designator`。
 *
 * @param {object} container 组件容器
 * @returns {Record<string, object>} 位号索引
 * @sideEffects 无（纯函数）
 */
export function buildDesignatorMap(container) {
	const map = {};
	if (!container || typeof container !== 'object') return map;
	for (const key in container) {
		const comp = container[key];
		if (!comp) continue;
		const designator = (comp.props && comp.props.Designator) || comp.Designator;
		if (designator) map[designator] = comp;
	}
	return map;
}

/**
 * 构建对比行（位号自然序 + 引脚自然序）
 *
 * @param {Map<string, string>} netMap `位号|引脚 → 网络名`
 * @param {object} container 当前网表的组件容器
 * @returns {Array<{refDes: string, pinNo: string, oldNet: string, newNet: string, isDiff: boolean, warning: boolean, tooltip: string}>} 对比行
 * @sideEffects 无（纯函数）
 */
export function buildCompareRows(netMap, container) {
	const designators = buildDesignatorMap(container);
	const items = [];
	for (const [key, newNet] of netMap.entries()) {
		const [refDes, pinNo] = key.split('|');
		items.push({ refDes: refDes, pinNo: pinNo, newNet: newNet });
	}
	items.sort((a, b) => naturalCompare(a.refDes, b.refDes) || naturalCompare(a.pinNo, b.pinNo));

	return items.map((item) => toCompareRow(item, designators[item.refDes]));
}

/**
 * 「当前 PCB 里没有该位号」的对比行
 *
 * @param {{refDes: string, pinNo: string, newNet: string}} item 对比项
 * @returns {object} 对比行
 * @sideEffects 无（纯函数）
 */
function missingComponentRow(item) {
	return {
		refDes: item.refDes,
		pinNo: item.pinNo,
		oldNet: '⚠️ 未找到元件',
		newNet: item.newNet,
		isDiff: false,
		warning: true,
		tooltip: `位号 ${item.refDes} 在当前PCB中不存在`,
	};
}

/**
 * 旧网络名：引脚表里有该引脚就取它（空值记占位），否则按有无引脚结构区分
 *
 * @param {object} pins 引脚表
 * @param {string} pinNo 引脚号
 * @param {boolean} hasPin 引脚表里是否有该引脚
 * @param {boolean} hasPinData 器件是否带引脚结构
 * @returns {string} 旧网络名
 * @sideEffects 无（纯函数）
 */
function oldNetOf(pins, pinNo, hasPin, hasPinData) {
	if (hasPin) return pins[pinNo] || NO_NET;
	return hasPinData ? NO_NET : '? 无引脚数据';
}

/**
 * 对比行提示文案
 *
 * @param {{refDes: string, pinNo: string}} item 对比项
 * @param {boolean} unknownShape 引脚结构未知
 * @param {boolean} missingPin 引脚未定义
 * @returns {string} 提示文案（无提示时为空串）
 * @sideEffects 无（纯函数）
 */
function tooltipOf(item, unknownShape, missingPin) {
	if (unknownShape) return `元件 ${item.refDes} 引脚信息结构未知`;
	if (missingPin) return `引脚 ${item.pinNo} 在元件 ${item.refDes} 中未定义`;
	return '';
}

/**
 * 单个对比项 → 对比行
 *
 * @param {{refDes: string, pinNo: string, newNet: string}} item 对比项
 * @param {object|undefined} comp 当前网表里对应的器件
 * @returns {object} 对比行
 * @sideEffects 无（纯函数）
 */
function toCompareRow(item, comp) {
	if (!comp) return missingComponentRow(item);

	const pins = getPins(comp);
	const hasPinData = comp.pinInfoMap || comp.pins;
	const hasPin = Object.prototype.hasOwnProperty.call(pins, item.pinNo);
	const oldNet = oldNetOf(pins, item.pinNo, hasPin, hasPinData);
	const missingPin = hasPinData && !hasPin;
	const unknownShape = !hasPinData;

	return {
		refDes: item.refDes,
		pinNo: item.pinNo,
		oldNet: oldNet,
		newNet: item.newNet,
		isDiff: !missingPin && !unknownShape && oldNet !== item.newNet,
		warning: missingPin || unknownShape,
		tooltip: tooltipOf(item, unknownShape, missingPin),
	};
}

/**
 * 把 AD 映射写进网表**副本**（原对象不动）
 *
 * @param {object} netlistObj 当前网表
 * @param {Map<string, string>} netMap `位号|引脚 → 网络名`
 * @returns {{updatedObj: object, updateCount: number, skippedCount: number}} 副本与统计
 * @sideEffects 无（对入参无影响，只在深拷贝上写）
 */
export function applyToCopy(netlistObj, netMap) {
	const updatedObj = JSON.parse(JSON.stringify(netlistObj || {}));
	const container = detectContainer(updatedObj);
	const designators = buildDesignatorMap(container);

	let updateCount = 0;
	let skippedCount = 0;
	for (const [key, newNet] of netMap.entries()) {
		const [refDes, pinNo] = key.split('|');
		const comp = designators[refDes];
		if (!comp) {
			skippedCount++;
			continue;
		}
		// create: 与原实现一致 —— 引脚不存在时按原结构补一个
		if (setPinNet(comp, pinNo, newNet, { create: true })) updateCount++;
		else skippedCount++;
	}
	return { updatedObj: updatedObj, updateCount: updateCount, skippedCount: skippedCount };
}
