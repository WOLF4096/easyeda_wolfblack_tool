/**
 * @//module/ app/replace-component/netlistSync
 * @//description/ 替换完成后把目标器件属性合并进网表（就地修改组件容器）
 * @//exports/ PRESERVE_KEYS, applyTargetProps
 * @//dependencies/ 无
 * @//example/ const { applyTargetProps } = await import('./netlistSync.js')
 *            const { json } = await getNetlist('PCB')
 *            applyTargetProps(getComponentsContainer(json), desigMap)
 *            await setNetlist('PCB', JSON.stringify(json, null, 2))
 *
 * 为什么写回源码之后还要动网表：源码只决定「哪个器件」，器件的可见属性（参数、厂家、
 * 供应商编号）在网表里，不改就会出现「封装换了、参数还是旧的」。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 受保护的属性名：这些由源码/替换流程自己负责，不能被目标器件的属性覆盖
 *
 * 含 `Designator`（位号必须保留）、`Footprint`/`Device`（源码里已改）、
 * `3D Model*`（单独按「是否保留 3D」决定）等。
 */
export const PRESERVE_KEYS = Object.freeze([
	'Footprint',
	'Designator',
	'Add into BOM',
	'3D Model',
	'3D Model Title',
	'3D Model Transform',
	'Device',
	'Unique ID',
	'Reuse Block',
	'Group ID',
	'Channel ID',
	'Convert to PCB',
]);

/** @type {Set<string>} 查找用的集合视图 */
const PRESERVE_SET = new Set(PRESERVE_KEYS);

/**
 * 把单个目标器件的属性合并进网表 props（就地修改）
 *
 * @param {object} props 网表器件属性（会被修改）
 * @param {object} action 替换动作
 * @returns {void}
 * @sideEffects **就地修改** `props`
 */
function mergeIntoProps(props, action) {
	const targetComp = action.targetComp || {};

	mergeOtherProperties(props, targetComp.otherProperty);
	mergeSupplierFields(props, targetComp);

	props.Name = action.preserveName ? action.sourceName : action.targetName;
	props.FootprintName = action.preserveFootprint ? action.sourceFootprintName : targetComp.footprint ? targetComp.footprint.name : '';
	props.DeviceName = targetComp.manufacturerId || '';
}

/**
 * 合并目标器件的文本属性（受保护键除外）
 *
 * @param {object} props 网表器件属性（会被修改）
 * @param {object} otherProperty 目标图元的属性字典
 * @returns {void}
 * @sideEffects **就地修改** `props`
 */
function mergeOtherProperties(props, otherProperty) {
	if (!otherProperty) return;

	for (const key in otherProperty) {
		if (!PRESERVE_SET.has(key)) props[key] = otherProperty[key];
	}
}

/**
 * 合并供应商 / 厂家字段（取到值才覆盖）
 *
 * @param {object} props 网表器件属性（会被修改）
 * @param {object} targetComp 目标图元
 * @returns {void}
 * @sideEffects **就地修改** `props`
 */
function mergeSupplierFields(props, targetComp) {
	if (targetComp.supplier) props.Supplier = targetComp.supplier;
	if (targetComp.supplierId) props['Supplier Part'] = targetComp.supplierId;
	if (targetComp.manufacturer) props.Manufacturer = targetComp.manufacturer;
	if (targetComp.manufacturerId) props['Manufacturer Part'] = targetComp.manufacturerId;
}

/**
 * 按位号把替换结果合并进组件容器
 *
 * 容器的取得方式由调用方决定（V3/V4 在 `components` 下，V2 根节点即容器，
 * 用 `core/netlist.getComponentsContainer()` 统一）。
 *
 * @param {object} componentsNode 组件容器（会被修改）
 * @param {Map<string, object>} desigMap 位号 → 替换动作
 * @returns {number} 实际改写的器件数
 * @sideEffects **就地修改** `componentsNode` 内各器件的 `props`
 */
export function applyTargetProps(componentsNode, desigMap) {
	if (!componentsNode || typeof componentsNode !== 'object') return 0;

	let count = 0;
	for (const compKey in componentsNode) {
		const compItem = componentsNode[compKey];
		// 防御性拦截：V2 根节点里混着元数据，只处理有 props 的项
		if (!compItem || typeof compItem !== 'object' || !compItem.props) continue;
		if (!compItem.props.Designator) continue;

		const action = desigMap.get(compItem.props.Designator);
		if (!action) continue;

		mergeIntoProps(compItem.props, action);
		count += 1;
	}
	return count;
}
