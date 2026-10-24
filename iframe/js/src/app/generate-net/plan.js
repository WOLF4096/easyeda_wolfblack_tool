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
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
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
	const pinsByDesignator = collectPinUpdates(clusters, namer);

	const designatorToCompId = designatorIndex(componentsContainer);

	const operations = [];
	for (const des in pinsByDesignator) {
		const compId = designatorToCompId[des];
		if (!compId) continue;
		const comp = componentsContainer[compId];
		if (!comp) continue;

		pushDesignatorOperations(operations, des, comp, pinsByDesignator[des]);
	}

	return operations;
}

/**
 * 阶段 1：逐分量定名，累积「位号 → {引脚: 网络}」
 *
 * ⚠️ `nameFor` 是按分量顺序消耗名字的，遍历顺序必须与拆分前一致。
 *
 * @param {Record<string, Array<object>>} clusters 连通分量
 * @param {object} namer 定名器
 * @returns {Record<string, Record<string, string>>} 位号 → 引脚 → 网络
 * @sideEffects **就地消耗** `namer` 里的网络名
 */
function collectPinUpdates(clusters, namer) {
	const pinsByDesignator = {};

	for (const rootId of Object.keys(clusters || {})) {
		const group = clusters[rootId];
		if (!hasMultiple(group)) continue;

		const finalNetName = namer.nameFor(voteNets(group));
		mergeGroupUpdates(pinsByDesignator, group, finalNetName);
	}

	return pinsByDesignator;
}

/**
 * 单个分量内：把 PAD 的引脚写到对应位号下
 *
 * @param {Record<string, Record<string, string>>} pinsByDesignator 累积表（就地修改）
 * @param {Array<object>} group 一个连通分量
 * @param {string} finalNetName 该分量的网络名
 * @returns {void}
 * @sideEffects **就地修改** `pinsByDesignator`
 */
function mergeGroupUpdates(pinsByDesignator, group, finalNetName) {
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

/**
 * 阶段 2：位号 → 器件 id
 *
 * @param {object} componentsContainer 网表组件容器
 * @returns {Record<string, string>} 位号 → 器件 id
 * @sideEffects 无（纯函数）
 */
function designatorIndex(componentsContainer) {
	const designatorToCompId = {};
	for (const compId in componentsContainer || {}) {
		const comp = componentsContainer[compId];
		if (comp && comp.props && comp.props.Designator) designatorToCompId[comp.props.Designator] = compId;
	}
	return designatorToCompId;
}

/**
 * 阶段 3：单个位号的引脚更新 → 操作项
 *
 * @param {Array<object>} operations 操作列表（就地追加）
 * @param {string} des 位号
 * @param {object} comp 网表组件
 * @param {Record<string, string>} pinUpdates 引脚 → 新网络
 * @returns {void}
 * @sideEffects **就地追加** `operations`
 */
function pushDesignatorOperations(operations, des, comp, pinUpdates) {
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
			updateCount += applyToPinInfoMap(compData.pinInfoMap, pinUpdates);
			continue;
		}

		updateCount += applyToPins(compData, pinUpdates);
	}

	return updateCount;
}

/**
 * 写 `pinInfoMap` 结构：已存在则改 `net`，不存在则新建一条
 *
 * @param {Record<string, object>} pinInfoMap 引脚信息表（就地修改）
 * @param {Record<string, string>} pinUpdates 引脚 → 新网络
 * @returns {number} 改动数
 * @sideEffects **就地修改** `pinInfoMap`
 */
function applyToPinInfoMap(pinInfoMap, pinUpdates) {
	let count = 0;

	for (const pinNum in pinUpdates) {
		const targetNet = pinUpdates[pinNum];
		const pinKey = String(pinNum);
		if (pinInfoMap[pinKey]) {
			if (pinInfoMap[pinKey].net !== targetNet) {
				pinInfoMap[pinKey].net = targetNet;
				count += 1;
			}
			continue;
		}
		pinInfoMap[pinKey] = { net: targetNet, number: pinKey };
		count += 1;
	}

	return count;
}

/**
 * 写 `pins` 结构（就地修改，缺省时补一个空表）
 *
 * @param {object} compData 网表组件（就地修改）
 * @param {Record<string, string>} pinUpdates 引脚 → 新网络
 * @returns {number} 改动数
 * @sideEffects **就地修改** `compData.pins`
 */
function applyToPins(compData, pinUpdates) {
	if (!compData.pins) compData.pins = {};
	let count = 0;

	for (const pinNum in pinUpdates) {
		const targetNet = pinUpdates[pinNum];
		const pinKey = String(pinNum);
		if (compData.pins[pinKey] !== targetNet) {
			compData.pins[pinKey] = targetNet;
			count += 1;
		}
	}

	return count;
}
