/**
 * @//module/ app/modify-net/replacePlan
 * @//description/ 网络名批量替换：解析 TSV 规则、建映射表、按映射改网表并产出逐条日志
 * @//exports/ parseRules, buildReplaceMap, applyRenames, listPinsOf
 * @//dependencies/ core/pins
 * @//example/ const { parseRules, buildReplaceMap, applyRenames } = await import('./replacePlan.js')
 *            const map = buildReplaceMap(parseRules(csvText), true)
 *            const { count, lines } = applyRenames(componentsContainer, map)
 *
 * 原实现把「解析 / 建表 / 两种结构各写一遍遍历」全塞在一个 click 回调里，
 * 连 `isModern()` 都被当成数据结构判断（V2.2 里也可能有 pinInfoMap）。这里改成结构驱动。
 */

import { getPins, setPinNet, sortPinKeys } from '../../core/pins.js';

/**
 * 解析替换规则（制表符分隔：旧网络名 \t 新网络名）
 *
 * @param {string} text 从 Excel 粘贴的文本
 * @returns {Array<{oldName: string, newName: string}>} 规则（空行、缺列、空值都跳过）
 * @sideEffects 无（纯函数）
 */
export function parseRules(text) {
	const rules = [];
	for (const line of String(text || '').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const parts = trimmed.split('\t').map((item) => item.trim());
		if (parts.length < 2) continue;
		const [oldName, newName] = parts;
		if (oldName && newName) rules.push({ oldName, newName });
	}
	return rules;
}

/**
 * 建「旧名（小写）→ 新名」映射
 *
 * 键统一小写：网表里的网络名大小写与 Excel 里不一定一致，匹配时忽略大小写。
 *
 * @param {Array<{oldName: string, newName: string}>} rules 规则
 * @param {boolean} [shouldUpperCase=true] 新名是否转大写（部分 EDA 版本对小写网络名支持不佳）
 * @returns {Map<string, string>} 映射表
 * @sideEffects 无（纯函数）
 */
export function buildReplaceMap(rules, shouldUpperCase = true) {
	const map = new Map();
	for (const rule of Array.isArray(rules) ? rules : []) {
		const newNet = shouldUpperCase ? rule.newName.toUpperCase() : rule.newName;
		map.set(String(rule.oldName).toLowerCase(), newNet);
	}
	return map;
}

/**
 * 按映射改写全部器件引脚的网络名
 *
 * @param {object} container 组件容器
 * @param {Map<string, string>} replaceMap 映射表
 * @returns {{count: number, lines: string[]}} 替换次数与逐条日志（`R1.2 [OLD -> NEW]`）
 * @sideEffects **就地修改** 网表里的引脚网络名
 */
export function applyRenames(container, replaceMap) {
	let count = 0;
	const lines = [];
	for (const key in container) {
		const comp = container[key];
		if (!comp || typeof comp !== 'object') continue;
		const designator = (comp.props && comp.props.Designator) || key;
		const pins = getPins(comp);
		for (const pin of Object.keys(pins).sort(sortPinKeys)) {
			const current = pins[pin];
			const netKey = current ? String(current).toLowerCase() : '';
			if (!netKey || !replaceMap.has(netKey)) continue;
			const next = replaceMap.get(netKey);
			if (setPinNet(comp, pin, next)) {
				lines.push(`替换: ${designator}.${pin} [${current} -> ${next}]`);
				count++;
			}
		}
	}
	return { count: count, lines: lines };
}

/**
 * 列出某器件的全部引脚与网络（供「位号实时查询」用）
 *
 * @param {object} comp 网表器件
 * @returns {Array<{pin: string, net: string}>} 按引脚号排序的引脚列表
 * @sideEffects 无（纯函数）
 */
export function listPinsOf(comp) {
	const pins = getPins(comp);
	return Object.keys(pins)
		.sort(sortPinKeys)
		.map((pin) => ({ pin: pin, net: pins[pin] || '' }));
}
