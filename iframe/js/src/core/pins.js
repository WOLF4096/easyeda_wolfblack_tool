/**
 * @//module/ core/pins
 * @//description/ 统一的引脚网络读取：抹平 `pinInfoMap`（V3/V4）与 `pins`（V2）两种结构
 * @//exports/ getPins, collectPinNumbers
 * @//dependencies/ 无
 * @//example/ const { getPins } = await import('./core/pins.js')
 *            const pins = getPins(comp) // { '1': 'NET_A', '2': '' }
 *
 * 项目里原先有 5 处各写一遍「有 pinInfoMap 用它、否则用 pins」的双分支
 * （ModifyNet / InADNetlist / OutPinNet / GenerateNet 读写两侧），且每处都略有差异。
 * 这里收成唯一实现：**只读**，返回新的扁平对象，不改网表。
 */

/**
 * 取一个器件的引脚 → 网络映射
 *
 * V3/V4：`pinInfoMap: { pin: { net, name, number } }`
 * V2：`pins: { pin: 'NET' }`（少数工程里值是对象，也一并兼容）
 *
 * @param {object} comp 网表器件对象
 * @returns {Record<string, string>} `{ 引脚号: 网络名 }`；无引脚信息时为空对象
 * @sideEffects 无（纯函数，返回新对象）
 */
export function getPins(comp) {
	const out = {};
	if (!comp || typeof comp !== 'object') return out;

	if (comp.pinInfoMap && typeof comp.pinInfoMap === 'object') {
		for (const [pin, info] of Object.entries(comp.pinInfoMap)) {
			out[pin] = info && typeof info === 'object' ? info.net || '' : String(info || '');
		}
		return out;
	}

	if (comp.pins && typeof comp.pins === 'object') {
		for (const [pin, net] of Object.entries(comp.pins)) {
			out[pin] = net && typeof net === 'object' ? net.net || '' : String(net || '');
		}
	}
	return out;
}

/**
 * 收集一批器件里出现过的所有引脚号（去重、按数值升序）
 *
 * 引脚号是字符串，直接排序会得到 `1, 10, 2`，必须按数字比。
 *
 * @param {Array<object>} components 器件数组（每项需带引脚信息）
 * @returns {string[]} 引脚号
 * @sideEffects 无（纯函数）
 */
export function collectPinNumbers(components) {
	const set = new Set();
	for (const comp of Array.isArray(components) ? components : []) {
		for (const pin of Object.keys(getPins(comp))) set.add(pin);
	}
	return Array.from(set).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}
