/**
 * @//module/ app/replace-component/pastePlan
 * @//description/ 粘贴数据解析与「展平 → 打标 → 重新分组」的纯数据变换
 * @//exports/ parseClipboard, flattenGroups, applyTargetSupplierIds, regroupGroups
 * @//dependencies/ core/util
 * @//example/ const { parseClipboard, flattenGroups, applyTargetSupplierIds, regroupGroups } = await import('./pastePlan.js')
 *            const pasteMap = parseClipboard(await navigator.clipboard.readText())
 *            const items = flattenGroups(groupedData)
 *            applyTargetSupplierIds(items, pasteMap)
 *            groupedData = regroupGroups(items)
 *
 * 为什么要「展平再分组」：粘贴前是按「名称+封装+编号」分组的一行多器件，
 * 新编号是按单个位号给的，同一个分组里的元件可能被拆到不同目标，
 * 所以必须先打散成单个器件、改写目标编号、再按新键重新合并。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { naturalCompare } from '../../core/util.js';

/**
 * 解析剪贴板文本为「位号 → 新立创编号」
 *
 * 支持的行格式（每行至少两段，最后一段是编号）：
 *   - `C106<TAB>C100042`
 *   - `C106 C111   C100042`（空格与 Tab 混用）
 *   - `C106,C111<TAB>C100042`（多个位号映射到同一编号）
 *
 * @param {string} text 剪贴板原文
 * @returns {Map<string, string>} 位号 → 立创编号
 * @sideEffects 无（纯函数）
 */
export function parseClipboard(text) {
	const pasteMap = new Map();
	const lines = String(text === null || text === undefined ? '' : text).split('\n');

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;

		const parts = line.split(/[\t\s]+/);
		if (parts.length < 2) continue;

		// 最后一段是立创编号，前面剩下的全部是位号
		// ⚠️ 原实现用 `parts.join('')` 再按逗号拆：只支持 `C106, C111` 这种「逗号+空格」，
		// 遇到 `R5 R6 C200001`（纯空格分隔的多个位号）会拼成 `R5R6` 这种不存在的位号而静默失效。
		// 这里改用逗号连接再按 `[,\s]+` 拆，两种写法都能正确识别。
		const newSupplierId = parts.pop().trim();
		const designatorsStr = parts.join(',');
		for (const designator of designatorsStr.split(/[,\s]+/)) {
			const d = designator.trim();
			if (d) pasteMap.set(d, newSupplierId);
		}
	}

	return pasteMap;
}

/**
 * 把分组展平成单个器件条目（深拷贝 original/target/options，避免引用污染）
 *
 * @param {Array<object>} groups 分组数据
 * @returns {Array<object>} 单器件条目数组
 * @sideEffects 无（纯函数，内部全部新建对象）
 */
export function flattenGroups(groups) {
	const items = [];
	for (const group of Array.isArray(groups) ? groups : []) {
		group.designators.forEach((designator, index) => {
			items.push({
				designator: designator,
				primitiveId: group.primitiveId[index],
				sourceComp: group.ComponentsSource[index],
				original: { ...group.original },
				target: { ...group.target },
				options: { ...group.options },
				selected: group.selected,
				ComponentsTarget: group.ComponentsTarget,
			});
		});
	}
	return items;
}

/**
 * 按粘贴结果改写单项的目标编号（就地修改）
 *
 * 编号变化时会：自动勾选该项、并清空已缓存的目标名称/封装/uuid
 * （否则会拿旧编号的属性去替换新器件）。
 *
 * @param {Array<object>} items 单器件条目（会被修改）
 * @param {Map<string, string>} pasteMap 位号 → 新编号
 * @returns {number} 实际发生变化的条目数
 * @sideEffects **就地修改** `items` 的 `target` / `selected` / `ComponentsTarget`
 */
export function applyTargetSupplierIds(items, pasteMap) {
	let updateCount = 0;
	for (const item of Array.isArray(items) ? items : []) {
		const newSupplierId = pasteMap.get(item.designator);
		if (!newSupplierId || item.target.supplierId === newSupplierId) continue;

		item.target.supplierId = newSupplierId;
		item.selected = true;
		item.target.name = null;
		item.target.footprint = null;
		item.target.footprintuuid = null;
		item.target.uuid = null;
		item.ComponentsTarget = null;
		updateCount += 1;
	}
	return updateCount;
}

/**
 * 按「原始属性 + 目标编号」重新分组合并
 *
 * 合并键比 `componentReader.buildGroupKey` 多一段 `target.supplierId`：
 * 原始属性相同但目标编号不同的器件必须分行，否则勾选/替换会串在一起。
 *
 * @param {Array<object>} items 单器件条目
 * @returns {Array<object>} 新的分组数组
 * @sideEffects 无（纯函数，位号排序在副本上进行）
 */
export function regroupGroups(items) {
	const groupMap = new Map();

	for (const item of Array.isArray(items) ? items : []) {
		const key = `${item.original.name}|${item.original.footprint}|${item.original.supplierId}|${item.target.supplierId}`;

		if (!groupMap.has(key)) {
			groupMap.set(key, {
				key: key,
				designators: [],
				primitiveId: [],
				original: item.original,
				target: item.target,
				options: item.options,
				selected: item.selected,
				ComponentsSource: [],
				ComponentsTarget: item.ComponentsTarget,
			});
		}

		const group = groupMap.get(key);
		group.designators.push(item.designator);
		group.primitiveId.push(item.primitiveId);
		group.ComponentsSource.push(item.sourceComp);
	}

	const groups = Array.from(groupMap.values());
	for (const group of groups) {
		group.designators.sort(naturalCompare);
	}
	return groups;
}
