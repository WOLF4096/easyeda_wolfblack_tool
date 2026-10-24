/**
 * @//module/ core/pins
 * @//description/ 统一的引脚网络读取：抹平 `pinInfoMap`（V3/V4）与 `pins`（V2）两种结构
 * @//exports/ getPins, getPinNet, setPinNet, sortPinKeys, collectPinNumbers
 * @//dependencies/ 无
 * @//example/ const { getPins } = await import('./core/pins.js')
 *            const pins = getPins(comp) // { '1': 'NET_A', '2': '' }
 *
 * 项目里原先有 5 处各写一遍「有 pinInfoMap 用它、否则用 pins」的双分支
 * （ModifyNet / InADNetlist / OutPinNet / GenerateNet 读写两侧），且每处都略有差异。
 * 这里收成唯一实现：**只读**，返回新的扁平对象，不改网表。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 把一个引脚的值归一成网络名
 *
 * V3/V4 是 `{ net, name, number }` 对象，V2 是裸字符串；空值统一成空串。
 *
 * @param {*} value 引脚值
 * @returns {string} 网络名
 * @sideEffects 无（纯函数）
 */
function netOf(value) {
	if (value && typeof value === 'object') return value.net || '';
	return String(value || '');
}

/**
 * 读一份「引脚 → 值」映射
 *
 * @param {object} map `pinInfoMap` 或 `pins`
 * @returns {Record<string, string>} 新的扁平对象
 * @sideEffects 无（纯函数）
 */
function readPinMap(map) {
	const out = {};
	for (const [pin, value] of Object.entries(map)) out[pin] = netOf(value);
	return out;
}

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
	if (!comp || typeof comp !== 'object') return {};

	if (comp.pinInfoMap && typeof comp.pinInfoMap === 'object') return readPinMap(comp.pinInfoMap);

	if (comp.pins && typeof comp.pins === 'object') return readPinMap(comp.pins);
	return {};
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
	return Array.from(set).sort(sortPinKeys);
}

/**
 * 取单个引脚的当前网络
 *
 * @param {object} comp 网表器件
 * @param {string} pin 引脚号
 * @returns {string} 网络名（无则空串）
 * @sideEffects 无（纯函数）
 */
export function getPinNet(comp, pin) {
	return getPins(comp)[pin] || '';
}

/**
 * 写 `pinInfoMap`（V3/V4）结构
 *
 * @param {object} comp 网表器件
 * @param {string} pin 引脚号
 * @param {string} net 新网络名
 * @param {boolean} create 允许新增引脚
 * @returns {boolean} 是否写入成功
 * @sideEffects **就地修改** 网表器件
 */
function writePinInfoMap(comp, pin, net, create) {
	if (comp.pinInfoMap[pin]) {
		comp.pinInfoMap[pin].net = net;
		return true;
	}
	if (!create) return false;
	comp.pinInfoMap[pin] = { name: '', number: pin, net: net };
	return true;
}

/**
 * 写 `pins`（V2）结构
 *
 * @param {object} comp 网表器件
 * @param {string} pin 引脚号
 * @param {string} net 新网络名
 * @param {boolean} create 允许新增引脚
 * @returns {boolean} 是否写入成功
 * @sideEffects **就地修改** 网表器件
 */
function writePins(comp, pin, net, create) {
	if (!create && !Object.prototype.hasOwnProperty.call(comp.pins, pin)) return false;
	comp.pins[pin] = net;
	return true;
}

/**
 * 写单个引脚的网络（自动适配两种结构）
 *
 * V3/V4 写 `pinInfoMap[pin].net`，V2 写 `pins[pin]`。
 * 引脚在该结构里不存在时：`create=false` 返回 false（调用方决定怎么处理），
 * `create=true` 则按原结构补一个（`pinInfoMap` 补 `{name,number,net}`；结构都没有就建 `pins`）。
 *
 * @param {object} comp 网表器件
 * @param {string} pin 引脚号
 * @param {string} net 新网络名
 * @param {{create?: boolean}} [options] `create` 为 true 时允许新增引脚
 * @returns {boolean} 是否写入成功
 * @sideEffects **就地修改** 网表器件
 */
export function setPinNet(comp, pin, net, options = {}) {
	if (!comp || typeof comp !== 'object') return false;
	const create = options.create === true;

	if (comp.pinInfoMap && typeof comp.pinInfoMap === 'object') return writePinInfoMap(comp, pin, net, create);

	if (comp.pins && typeof comp.pins === 'object') return writePins(comp, pin, net, create);

	if (!create) return false;
	comp.pins = {};
	comp.pins[pin] = net;
	return true;
}

/**
 * 引脚号排序比较器
 *
 * 两个都是数字时按数值比（`2` 在 `10` 前面），否则按自然序（`A1` / `A2` / `B1`）。
 * 项目里这份三元判断原样抄了 4 遍。
 *
 * @param {string} a 前一个引脚号
 * @param {string} b 后一个引脚号
 * @returns {number} 比较结果
 * @sideEffects 无（纯函数）
 */
export function sortPinKeys(a, b) {
	const na = Number(a);
	const nb = Number(b);
	const aNum = a !== '' && Number.isFinite(na);
	const bNum = b !== '' && Number.isFinite(nb);
	if (aNum && bNum) return na - nb;
	return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}
