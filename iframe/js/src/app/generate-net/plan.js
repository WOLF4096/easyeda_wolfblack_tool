/**
 * @//module/ app/generate-net/plan
 * @//description/ 把连通分量翻译成「待执行操作列表」（网表模式 / 图元模式两套）
 * @//exports/ planPrimitiveOperations, planNetlistOperations, applyPinUpdates
 * @//dependencies/ core/pins, app/generate-net/netNamer
 * @//example/ const { planNetlistOperations } = await import('./plan.js')
 *            const ops = planNetlistOperations(clusters, usedNames, getComponentsContainer(netlist))
 *            // [{ des: 'R1', pin: '1', oldNet: '—', newNet: 'GND', status: 'pending' }]
 *
 * 两个模式的区别只在「操作对象」：
 *   - 网表模式：操作对象是「位号 + 引脚号」，写回网表的 pinInfoMap / pins；
 *   - 图元模式：操作对象是「图元 id」，写回源码或调图元 API。
 * 定名规则完全一致（见 netNamer），所以两块共用同一个 namer。
 */

import { getPinNet } from '../../core/pins.js';
import { createNetNamer, voteNets } from './netNamer.js';

/** 单元素分量没有第二个图元可比，跳过（它们本来就是孤立图元） */
function hasMultiple(group) {
	return group && group.length > 1;
}

/**
 * 图元模式：生成「图元 id → 新网络名」操作列表
 *
 * @param {Record<string, Array<object>>} clusters 连通分量
 * @param {Set<string>} allUsedNetNames 已占用的网络名（就地修改）
 * @returns {Array<object>} 操作列表
 * @sideEffects **就地修改** `allUsedNetNames`
 */
export function planPrimitiveOperations(clusters, allUsedNetNames) {
	const namer = createNetNamer(allUsedNetNames);
	const operations = [];

	for (const rootId of Object.keys(clusters || {})) {
		const group = clusters[rootId];
		if (!hasMultiple(group)) continue;

		const finalNetName = namer.nameFor(voteNets(group));
		for (const item of group) {
			if (item.net === finalNetName) continue;
			operations.push({
				id: item.id,
				ticket: item.ticket,
				type: item.type,
				oldNet: item.net || '—',
				newNet: finalNetName,
				status: 'pending',
			});
		}
	}

	return operations;
}

/**
 * 网表模式：生成「位号 + 引脚号」操作列表
 *
 * @param {Record<string, Array<object>>} clusters 连通分量
 * @param {Set<string>} allUsedNetNames 已占用的网络名（就地修改）
 * @param {object} componentsContainer 网表组件容器（`getComponentsContainer(json)`）
 * @returns {Array<object>} 操作列表
 * @sideEffects **就地修改** `allUsedNetNames`
 */
export function planNetlistOperations(clusters, allUsedNetNames, componentsContainer) {
	const namer = createNetNamer(allUsedNetNames);
	const pinsByDesignator = {};

	for (const rootId of Object.keys(clusters || {})) {
		const group = clusters[rootId];
		if (!hasMultiple(group)) continue;

		const finalNetName = namer.nameFor(voteNets(group));
		const updates = {};
		for (const item of group) {
			if (item.type !== 'PAD' || !item._pinInfo) continue;
			const pinInfo = item._pinInfo;
			if (!updates[pinInfo.des]) updates[pinInfo.des] = {};
			updates[pinInfo.des][pinInfo.pin] = finalNetName;
		}
		for (const des in updates) {
			pinsByDesignator[des] = Object.assign(pinsByDesignator[des] || {}, updates[des]);
		}
	}

	const designatorToCompId = {};
	for (const compId in componentsContainer || {}) {
		const comp = componentsContainer[compId];
		if (comp && comp.props && comp.props.Designator) designatorToCompId[comp.props.Designator] = compId;
	}

	const operations = [];
	for (const des in pinsByDesignator) {
		const compId = designatorToCompId[des];
		if (!compId) continue;
		const comp = componentsContainer[compId];
		if (!comp) continue;

		const pinUpdates = pinsByDesignator[des];
		for (const pin in pinUpdates) {
			const newNet = pinUpdates[pin];
			const oldNet = getPinNet(comp, pin);
			if (oldNet === newNet) continue;
			operations.push({
				des: des,
				pin: pin,
				oldNet: oldNet || '—',
				newNet: newNet,
				status: 'pending',
			});
		}
	}

	return operations;
}

/**
 * 把「位号 → {引脚: 网络}」写进网表组件（两种引脚结构都支持）
 *
 * @param {object} componentsContainer 网表组件容器（就地修改）
 * @param {Map<string, object>} pinUpdatesByDesignator 位号 → {引脚: 网络}
 * @returns {number} 实际改动的引脚数
 * @sideEffects **就地修改** `componentsContainer`
 */
export function applyPinUpdates(componentsContainer, pinUpdatesByDesignator) {
	let updateCount = 0;

	for (const compId in componentsContainer || {}) {
		const compData = componentsContainer[compId];
		if (!compData || !compData.props) continue;
		const des = compData.props.Designator;
		if (!des) continue;

		const pinUpdates = pinUpdatesByDesignator.get(des);
		if (!pinUpdates) continue;

		if (compData.pinInfoMap) {
			for (const pinNum in pinUpdates) {
				const targetNet = pinUpdates[pinNum];
				const pinKey = String(pinNum);
				if (compData.pinInfoMap[pinKey]) {
					if (compData.pinInfoMap[pinKey].net !== targetNet) {
						compData.pinInfoMap[pinKey].net = targetNet;
						updateCount += 1;
					}
				} else {
					compData.pinInfoMap[pinKey] = { net: targetNet, number: pinKey };
					updateCount += 1;
				}
			}
			continue;
		}

		if (!compData.pins) compData.pins = {};
		for (const pinNum in pinUpdates) {
			const targetNet = pinUpdates[pinNum];
			const pinKey = String(pinNum);
			if (compData.pins[pinKey] !== targetNet) {
				compData.pins[pinKey] = targetNet;
				updateCount += 1;
			}
		}
	}

	return updateCount;
}
