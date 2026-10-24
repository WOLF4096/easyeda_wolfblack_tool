/**
 * @//module/ app/import-bom/bomModel
 * @//description/ BOM 行模型：器件名解引用、行数据构建、分组、排序、粘贴应用、写回网表属性
 * @//exports/ resolveComponentName, buildRows, groupRows, sortGroups, applyPaste, applyToComponent
 * @//dependencies/ core/util
 * @//example/ const { buildRows, groupRows, applyPaste } = await import('./bomModel.js')
 *            const rows = buildRows(componentsContainer)
 *            const stat = applyPaste(rows, parsePaste(clipboardText)) // { updated, missing }
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { naturalCompare } from '../../core/util.js';

/** 参与「改动检测」的字段（与 original 快照一一对应） */
const TRACKED_FIELDS = ['name', 'manufacturerPart', 'manufacturer', 'supplierPart', 'supplier'];

/**
 * 把器件名解引用
 *
 * V4 的 `Name` 可能是模板串 `={Value}`（引用 Value 属性），直接显示会变成字面量。
 * 解析不到才退回原串；再退回 `Value` / `value`。
 *
 * @param {object} props 器件属性
 * @returns {string} 可显示的名称
 * @sideEffects 无（纯函数）
 */
export function resolveComponentName(props) {
	const source = props || {};
	const raw = String(source.Name || '');
	if (/^=\{.*\}$/.test(raw)) return source.Value || source.value || '';
	return raw || source.Value || source.value || '';
}

/**
 * 从组件容器构建 BOM 行
 *
 * @param {object} container 组件容器
 * @returns {Array<object>} 行数据（保留 jsonKey 以便回写）
 * @sideEffects 无（纯函数）
 */
export function buildRows(container) {
	const rows = [];
	if (!container || typeof container !== 'object') return rows;
	for (const [key, component] of Object.entries(container)) {
		if (!component || !component.props) continue;
		rows.push(toRow(key, component.props));
	}
	return rows;
}

/**
 * 缺省空串（等价于原来的 `value || ''`）
 *
 * @param {*} value 任意值
 * @returns {*} 原值，或空串
 * @sideEffects 无（纯函数）
 */
function text(value) {
	return value || '';
}

/**
 * 单个器件 → BOM 行
 *
 * @param {string} key 容器里的 jsonKey
 * @param {object} props 器件属性
 * @returns {object} 行数据
 * @sideEffects 无（纯函数）
 */
function toRow(key, props) {
	const designator = text(props.Designator);
	const name = resolveComponentName(props);
	return {
		jsonKey: key,
		uniqueId: props['Unique ID'],
		designator: designator,
		name: name,
		footprint: props.FootprintName || props.Footprint || '',
		supplier: text(props.Supplier),
		supplierPart: text(props['Supplier Part']),
		manufacturerPart: text(props['Manufacturer Part']),
		manufacturer: text(props.Manufacturer),
		selected: false,
		changed: false,
		original: snapshot(designator, name, props),
	};
}

/**
 * 取行的原始快照
 *
 * @param {string} designator 位号
 * @param {string} name 名称
 * @param {object} props 器件属性
 * @returns {object} 快照
 * @sideEffects 无（纯函数）
 */
function snapshot(designator, name, props) {
	return {
		designator: designator,
		name: name,
		supplier: props.Supplier || '',
		supplierPart: props['Supplier Part'] || '',
		manufacturerPart: props['Manufacturer Part'] || '',
		manufacturer: props.Manufacturer || '',
	};
}

/**
 * 按「除位号外其余字段相同」分组
 *
 * 分组键用 `JSON.stringify` 而不是用 `|` 拼接：字段值本身可能含 `|`（如物料名），
 * 拼接会把不同组合并成一组。
 *
 * @param {Array<object>} rows 行数据
 * @returns {Array<{items: Array<object>, designators: string[], selected: boolean, changed: boolean, original: object}>} 分组
 * @sideEffects 无（纯函数）
 */
export function groupRows(rows) {
	const map = new Map();
	const groups = [];
	for (const item of Array.isArray(rows) ? rows : []) {
		const prefix = String(item.designator || '').replace(/[0-9]+$/, '');
		const key = JSON.stringify([
			prefix,
			item.footprint,
			item.name,
			item.supplier,
			item.supplierPart,
			item.manufacturerPart,
			item.manufacturer,
			item.changed,
			item.original.name,
			item.original.supplier,
			item.original.supplierPart,
			item.original.manufacturerPart,
			item.original.manufacturer,
		]);

		let group = map.get(key);
		if (!group) {
			group = {
				items: [],
				designators: [],
				name: item.name,
				supplier: item.supplier,
				supplierPart: item.supplierPart,
				manufacturerPart: item.manufacturerPart,
				manufacturer: item.manufacturer,
				changed: item.changed,
				original: item.original,
				selected: item.selected,
			};
			map.set(key, group);
			groups.push(group);
		}
		group.items.push(item);
		group.designators.push(item.designator);
		// 组内只要有一个没选中，整组即非全选
		if (!item.selected) group.selected = false;
	}
	return groups;
}

/**
 * 排序分组（不改入参）
 *
 * @param {Array<object>} groups 分组
 * @param {{key: string|null, asc: boolean}} state 排序状态
 * @returns {Array<object>} 排序后的新数组
 * @sideEffects 无（纯函数）
 */
export function sortGroups(groups, state) {
	const list = (Array.isArray(groups) ? groups : []).slice();
	if (!state || !state.key) return list;
	const dir = state.asc === false ? -1 : 1;
	list.sort((a, b) => {
		const valA = state.key === 'designators' ? a.designators.join(', ') : String(a[state.key] || '');
		const valB = state.key === 'designators' ? b.designators.join(', ') : String(b[state.key] || '');
		return dir * naturalCompare(valA, valB);
	});
	return list;
}

/**
 * 把粘贴数据应用到行上
 *
 * 「智能兼容」保留原行为：Excel 里没填供应商、但供应商编号以 `C` 开头时自动补 `LCSC`。
 *
 * @param {Array<object>} rows 行数据
 * @param {Array<object>} pasteItems parsePaste 的结果
 * @returns {{updated: number, missing: string[]}} 改动行数与未匹配到的位号
 * @sideEffects 就地修改命中的行（name / supplier / … / changed / selected）
 */
export function applyPaste(rows, pasteItems) {
	const list = Array.isArray(rows) ? rows : [];
	let updated = 0;
	const missing = [];
	const byDesignator = indexByDesignator(list);

	for (const pasteItem of Array.isArray(pasteItems) ? pasteItems : []) {
		for (const designator of pasteItem.designators) {
			const row = byDesignator.get(designator);
			if (!row) {
				missing.push(designator);
				continue;
			}
			updated += applyPasteRow(row, pasteItem);
		}
	}
	return { updated: updated, missing: missing };
}

/**
 * 建「位号 → 行」索引（同一位号保留首次出现的行）
 *
 * @param {Array<object>} rows 行数据
 * @returns {Map<string, object>} 索引
 * @sideEffects 无（纯函数）
 */
function indexByDesignator(rows) {
	const byDesignator = new Map();
	for (const row of rows) {
		if (!byDesignator.has(row.designator)) byDesignator.set(row.designator, row);
	}
	return byDesignator;
}

/**
 * 供应商推断：Excel 里没填供应商、但供应商编号以 `C` 开头时补 `LCSC`
 *
 * @param {object} pasteItem 粘贴项
 * @returns {string|undefined} 供应商（无则保留粘贴项原值）
 * @sideEffects 无（纯函数）
 */
function resolveSupplier(pasteItem) {
	if (!pasteItem.supplier && isLcscSupplierPart(pasteItem.supplierPart)) return 'LCSC';
	return pasteItem.supplier;
}

/**
 * 供应商编号是否形如立创编号（`C` 开头）
 *
 * @param {string|undefined} supplierPart 供应商编号
 * @returns {boolean} 是否立创编号
 * @sideEffects 无（纯函数）
 */
function isLcscSupplierPart(supplierPart) {
	return Boolean(supplierPart) && supplierPart.trim().toUpperCase().startsWith('C');
}

/**
 * 把单个粘贴项写到命中的行；无实际改动时不碰行
 *
 * @param {object} row 命中的行（就地修改）
 * @param {object} pasteItem 粘贴项
 * @returns {number} 1 表示有改动，0 表示无改动
 * @sideEffects 就地修改 row（name / supplier / … / changed / selected）
 */
function applyPasteRow(row, pasteItem) {
	const next = {
		name: pasteItem.name,
		manufacturerPart: pasteItem.manufacturerPart,
		manufacturer: pasteItem.manufacturer,
		supplierPart: pasteItem.supplierPart,
		supplier: resolveSupplier(pasteItem),
	};
	const hasChanges = TRACKED_FIELDS.some((field) => next[field] !== row.original[field]);
	if (!hasChanges) return 0;
	Object.assign(row, next, { changed: true, selected: true });
	return 1;
}

/**
 * 把行数据写回器件的网表属性
 *
 * V4 画布上的器件值来自 `Value`（`Name` 是 `={Value}` 模板），只写 `Name` 会出现
 * 「提示导入成功但画面没变」，所以两版都写 `Value`；`Name` 仅在它本身是字面值时才覆盖，
 * 避免把模板串改成固定文本。
 *
 * @param {object} row 行数据
 * @param {object} comp 网表器件对象
 * @returns {boolean} 是否写入（器件无 props 时返回 false）
 * @sideEffects 就地修改 `comp.props`
 */
export function applyToComponent(row, comp) {
	if (!comp) return false;
	comp.props = comp.props || {};
	const value = row.name || row.original.name;
	comp.props.Value = value;
	if (!/^=\{.*\}$/.test(String(comp.props.Name || ''))) {
		comp.props.Name = value;
	}
	comp.props.Supplier = row.supplier || row.original.supplier;
	comp.props['Supplier Part'] = row.supplierPart || row.original.supplierPart;
	comp.props['Manufacturer Part'] = row.manufacturerPart || row.original.manufacturerPart;
	comp.props.Manufacturer = row.manufacturer || row.original.manufacturer;

	row.changed = false;
	row.original = snapshot(row.designator, row.name, comp.props);
	return true;
}
