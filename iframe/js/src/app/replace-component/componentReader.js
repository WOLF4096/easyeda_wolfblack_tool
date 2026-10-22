/**
 * @//module/ app/replace-component/componentReader
 * @//description/ 从 PCB 图元里读取器件属性，并统一 V2/V3/V4 的取值差异（纯函数，不碰 eda）
 * @//exports/ pickDevice, pickPrimitiveId, getDeviceUuid, getFootprintUuid, getFootprintName, getDeviceNameJson, resolveDynamicString, extractProps, enrichComponentData, buildGroupKey
 * @//dependencies/ 无
 * @//example/ const { extractProps } = await import('./componentReader.js')
 *            const props = extractProps(comp) // { name, footprint, supplierId }
 *
 * 这个模块集中了「V4 与 V2.2 取值不一样」的全部坑，每个函数上方都写了实测结论。
 * 改动前务必先在两个客户端上对照，不要按类型声明推断。
 */

/**
 * 取 `lib_Device.getByLcscIds()` 的器件
 *
 * 类型声明写的是「传单个编号 → 返回数组」，但 **V4.1.78 实测返回单个器件对象**
 * （传数组才返回数组）。以前写成 `t.length > 0`，V4 下 `length` 是 undefined，
 * 整个分支被跳过 → placeCount 恒为 0 → 报「未能在库中找到对应的器件」。
 *
 * @param {*} result 宿主返回值（数组 / 对象 / undefined）
 * @returns {object|null} 器件对象
 * @sideEffects 无（纯函数）
 */
export function pickDevice(result) {
	return (Array.isArray(result) ? result[0] : result) || null;
}

/**
 * 取 `pcb_PrimitiveComponent.create()` 返回的图元 ID
 *
 * V3/V4 返回图元对象（带 `primitiveId` 或 `getState_PrimitiveId()`），
 * V2 返回 ID 数组或字符串。
 *
 * @param {*} handle 宿主返回值
 * @returns {string|null} 图元 ID
 * @sideEffects 可能调用宿主的 `getState_PrimitiveId()`（只读）
 */
export function pickPrimitiveId(handle) {
	if (!handle) return null;
	if (Array.isArray(handle)) return handle.length ? pickPrimitiveId(handle[0]) : null;
	if (typeof handle === 'string') return handle;
	if (handle.primitiveId) return handle.primitiveId;
	if (typeof handle.getState_PrimitiveId === 'function') return handle.getState_PrimitiveId();
	return null;
}

/**
 * 取器件 UUID（源码 ATTR `Device` 里写的就是这个值）
 *
 * V2：`component.uuid` 是字符串；
 * V4：`component.uuid` 是对象 `{ name, source, uuid }`（外壳是 JSON 化的 DeviceName），
 *     直接写对象会变成 `[object Object]`，必须取里面的 `.uuid`。
 *
 * @param {object} comp PCB 图元（`pcb_PrimitiveComponent.get()` 的返回）
 * @returns {string} 器件 UUID；取不到时为空串
 * @sideEffects 无（纯函数）
 */
export function getDeviceUuid(comp) {
	const u = comp && comp.component ? comp.component.uuid : null;
	if (!u) return '';
	return typeof u === 'string' ? u : u.uuid || '';
}

/**
 * 取封装 UUID（源码 ATTR `Footprint` 写的就是这个值）
 *
 * V4 下 `footprint.uuid` 仍是字符串，这里两种形态都兜住。
 *
 * @param {object} comp PCB 图元
 * @returns {string} 封装 UUID；取不到时为空串
 * @sideEffects 无（纯函数）
 */
export function getFootprintUuid(comp) {
	const f = comp && comp.footprint ? comp.footprint.uuid : null;
	if (!f) return '';
	return typeof f === 'string' ? f : f.uuid || '';
}

/**
 * 取封装名，按 V4（对象）/ V2（字符串或 otherProperty）逐级兜底
 *
 * @param {object} comp PCB 图元
 * @returns {string} 封装名；取不到时为空串
 * @sideEffects 无（纯函数）
 */
export function getFootprintName(comp) {
	if (!comp) return '';
	const f = comp.footprint;
	if (f && typeof f === 'object' && f.name) return f.name;
	if (typeof f === 'string' && f) return f;
	return (comp.otherProperty && comp.otherProperty.Footprint) || '';
}

/**
 * 取 V4 需要的 `DeviceName` 字面量（COMPONENT 行 `attrs.DeviceName` 的字符串形态）
 *
 * V4 源码里器件的**权威引用**在 COMPONENT 行的 `attrs.DeviceName`
 * （`{"name","source","uuid"}` 的 JSON 字符串），ATTR `Device` 只是它的投影。
 * 实测：只改 ATTR `Device` 时，EDA 会把新器件的属性/封装糊上来，但 `component.uuid`
 * 仍是旧器件 —— 器件根本没换，还会留下「器件名与封装对不上」的脏状态。必须两处一起改。
 *
 * @param {object} comp PCB 图元
 * @returns {string|null} V4 返回 JSON 串；V2/V3（`component.uuid` 是字符串）返回 null，表示不需要改这一行
 * @sideEffects 无（纯函数）
 */
export function getDeviceNameJson(comp) {
	const u = comp && comp.component ? comp.component.uuid : null;
	if (!u || typeof u !== 'object') return null;
	return JSON.stringify({ name: u.name || '', source: u.source || '', uuid: u.uuid || '' });
}

/**
 * 解析 `={属性名}` 格式的动态模板字符串，带 Device 兜底
 *
 * 规则：只要原串里出现过模板且**有任何一个**属性取不到值，就整串回退成 `fallbackDevice`。
 * 这是原实现的既定口径（不是最优解，但改了会改变用户看到的器件名，故保持）。
 *
 * @param {string} str 原始串（如 `={Value}` 或 `10K`）
 * @param {object} properties 属性字典
 * @param {string} [fallbackDevice=''] 兜底器件名
 * @returns {string} 解析结果
 * @sideEffects 无（纯函数）
 */
export function resolveDynamicString(str, properties, fallbackDevice = '') {
	if (!str || typeof str !== 'string') return str;

	let hasTemplate = false;
	let hasMissingValue = false;

	const result = str.replace(/=\{([^}]+)\}/g, (match, propName) => {
		hasTemplate = true;
		if (properties[propName] !== undefined && properties[propName] !== '') {
			return properties[propName];
		}
		hasMissingValue = true;
		return match;
	});

	if (hasTemplate && hasMissingValue && fallbackDevice) return fallbackDevice;
	return result;
}

/**
 * 从画布图元中提取「名称 / 封装 / 立创编号」
 *
 * V2.2 器件名在 `otherProperty.Device`；
 * V4 的 `otherProperty` 里没有 `Device`/`DeviceName`，器件名在 `comp.component.uuid.name`。
 *
 * @param {object} comp PCB 图元
 * @returns {{name: string, footprint: string, supplierId: string}} 三个展示字段
 * @sideEffects 无（纯函数）
 */
export function extractProps(comp) {
	const rawName = comp.name || (comp.component && comp.component.name) || '';
	const props = comp.otherProperty || {};

	const deviceFromComponent =
		comp.component && typeof comp.component === 'object'
			? (comp.component.uuid && typeof comp.component.uuid === 'object' && comp.component.uuid.name) ||
			  comp.component.name
			: '';
	const deviceName = props.Device || props.DeviceName || deviceFromComponent || comp.manufacturerId || '';

	// 合并根节点属性与 otherProperty，确保 ={Value} 与 ={manufacturerId} 都能被字典找到
	const mergedProps = { ...comp, ...props };
	const name = resolveDynamicString(rawName, mergedProps, deviceName);

	const footprint =
		(mergedProps && mergedProps.Footprint) ||
		(comp.otherProperty && comp.otherProperty.Footprint) ||
		(comp.footprint && comp.footprint.name) ||
		(typeof comp.footprint === 'string' ? comp.footprint : '') ||
		'';

	const supplierId = comp.supplierId || '';
	return { name: name, footprint: footprint, supplierId: supplierId };
}

/**
 * 把分组键拼出来（名称 + 封装 + 立创编号）
 *
 * 只作为 Map 的键使用，**不做反向解析** —— 所以名称里含 `|` 也不会串组。
 *
 * @param {{name: string, footprint: string, supplierId: string}} props 属性
 * @returns {string} 分组键
 * @sideEffects 无（纯函数）
 */
export function buildGroupKey(props) {
	return `${props.name}|${props.footprint}|${props.supplierId}`;
}

/**
 * 把外部商品接口返回的详尽属性注入图元对象（就地修改）
 *
 * ⚠️ 当前 `fetchProductInfo()` **恒返回 null**（原 HTTP 接口实测不可用，已停用），
 * 所以这个函数在现状下是直通。保留它是为了让接口恢复时不用重写合并逻辑。
 *
 * @param {object} sel 图元对象（会被修改）
 * @param {object|null} pInfo 商品信息
 * @returns {object} 同一个 sel
 * @sideEffects **就地修改** `sel` 的根属性与 `otherProperty`
 */
export function enrichComponentData(sel, pInfo) {
	if (!pInfo || !pInfo.device_info) return sel;

	const attrs = pInfo.device_info.attributes || {};

	sel.manufacturer = pInfo.brandName || attrs.Manufacturer || sel.manufacturer;
	sel.manufacturerId = pInfo.model || attrs['Manufacturer Part'] || sel.manufacturerId;
	sel.supplier = attrs.Supplier || sel.supplier || 'LCSC';
	sel.supplierId = pInfo.code || sel.supplierId;

	sel.otherProperty = sel.otherProperty || {};
	for (const key in attrs) {
		// 跳过系统强关联的结构字段，只合并文本属性
		if (!['Footprint', 'Symbol', '3D Model', 'Designator'].includes(key)) {
			sel.otherProperty[key] = attrs[key];
		}
	}

	const fpInfo = pInfo.device_info.footprint_info;
	if (fpInfo && fpInfo.model_3d) {
		const libUuid = fpInfo.creator ? fpInfo.creator.uuid : '';
		sel.otherProperty['3D Model'] =
			sel.otherProperty['3D Model'] || (libUuid ? `${fpInfo.model_3d.uri}|${libUuid}` : fpInfo.model_3d.uri);
		sel.otherProperty['3D Model Title'] = sel.otherProperty['3D Model Title'] || fpInfo.model_3d.title;
		sel.otherProperty['3D Model Transform'] = sel.otherProperty['3D Model Transform'] || fpInfo.model_3d.transform;
	}

	return sel;
}
