/**
 * 网表解析工具（V2/V3 兼容）
 *
 * 从原理图/PCB/文件网表中提取引脚与网络映射关系，
 * 供「创建导线」功能比对差异、生成缺失网络的导线。
 * 以下函数均为纯函数，不依赖模块级状态，便于单独测试。
 *
 * --- 模块边界 ---
 * 本模块属于「纯解析层」：输入输出全部是字符串 / 普通对象，
 * **不引用 `eda` 全局对象、不发起任何 EDA 调用**，可脱离客户端环境直接测试
 * （见 test/netlistParser.test.mjs）。
 * 「从 EDA 取数」的责任在调用方（autoWire/index.js）与 apiConfig.js。
 *
 * --- 已在网表格式差异上收敛的两个点 ---
 * 1. 组件容器：V3 为 `{ components: {...} }`，V2 为裸对象 `{ [uniqueId]: {...} }`。
 * 2. 引脚结构：V3 为 `pinInfoMap: { pin: { net } }`，V2 为 `pins: { pin: netName }`。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 格式化原理图网表数据（支持 V2 和 V3 格式）
 *
 * 入参 `netlistData` 为网表 JSON **字符串**（不是对象），函数内部自行 parse；
 * `selectedComponents` 允许传单个器件对象或数组，内部统一为数组遍历。
 * 器件在网表中缺失、或缺少 `props` / 引脚数据时只告警跳过，不会抛错。
 *
 * @param {string} netlistData - 网表 JSON 字符串
 * @param {Array|Object} selectedComponents - 选中的器件（单个或数组）
 * @returns {Array<{uniqueId: string, designator: string, pin: string, netName: string}>}
 */
function formatSchematicNetlist(netlistData, selectedComponents) {
	const formatted = [];
	const parsedData = JSON.parse(netlistData);

	// V3 兼容处理：确定组件数据源
	let componentsMap = parsedData;
	let isV3 = false;

	// 如果存在 components 字段，说明是 V3 格式
	if (parsedData.components) {
		componentsMap = parsedData.components;
		isV3 = true;
		console.log('识别为 V3 格式网表');
	} else {
		console.log('识别为 V2 格式网表');
	}

	// 处理单个或多个选中器件
	const componentsArray = Array.isArray(selectedComponents) ? selectedComponents : [selectedComponents];

	for (const component of componentsArray) {
		const uniqueId = component.uniqueId;

		// 直接获取该器件在网表中的数据
		const componentData = componentsMap[uniqueId];

		if (!componentData) {
			console.warn(`⚠️ 未在网表中找到器件 ${uniqueId}`);
			continue;
		}

		const props = componentData.props;
		if (!props) {
			console.warn(`⚠️ 器件 ${uniqueId} 属性数据不完整`);
			continue;
		}

		// 提取引脚数据 - 区分 V2 和 V3 结构
		if (isV3 && componentData.pinInfoMap) {
			// V3 逻辑: 使用 pinInfoMap, 结构为 { "1": { "net": "GND" }, ... }
			const pinEntries = Object.entries(componentData.pinInfoMap);
			for (const [pinNumber, pinInfo] of pinEntries) {
				formatted.push({
					uniqueId: uniqueId,
					designator: props.Designator,
					pin: pinNumber,
					netName: pinInfo && pinInfo.net ? pinInfo.net : '',
				});
			}
		} else if (componentData.pins) {
			// V2 逻辑: 使用 pins, 结构为 { "1": "GND", ... }
			const pinEntries = Object.entries(componentData.pins);
			for (const [pinNumber, netName] of pinEntries) {
				formatted.push({
					uniqueId: uniqueId,
					designator: props.Designator,
					pin: pinNumber,
					netName: netName || '',
				});
			}
		} else {
			console.warn(`⚠️ 器件 ${uniqueId} 没有找到 pins 或 pinInfoMap 数据`);
		}
	}

	console.log(`共提取 ${formatted.length} 个引脚信息`);
	return formatted;
}

/**
 * 格式化 PCB 网表数据
 *
 * 入参是 `pcb_SelectControl` 返回的图元（单个或数组），
 * 仅保留 `primitiveType === 'Component'` 的器件，引脚取自 `component.pads[].num/net`。
 *
 * @param {Array|Object} pcbData - PCB 选中图元（单个或数组）
 * @returns {Array<{uniqueId: string, designator: string, pin: string, netName: string}>}
 */
function formatPCBNetlist(pcbData) {
	const formatted = [];

	// PCB 数据可能是单个器件对象，也可能是数组
	const components = Array.isArray(pcbData) ? pcbData : [pcbData];

	for (const component of components) {
		// 检查是否是器件类型
		if (component.primitiveType !== 'Component') {
			continue;
		}

		// 提取器件基本信息
		const uniqueId = component.uniqueId;
		const designator = component.designator;

		// 处理引脚数据
		if (component.pads && Array.isArray(component.pads)) {
			for (const pad of component.pads) {
				formatted.push({
					uniqueId: uniqueId,
					designator: designator,
					pin: pad.num,
					netName: pad.net || '',
				});
			}
		}
	}

	return formatted;
}

/**
 * 格式化文件网表数据
 *
 * 文件格式与原理图网表格式相同，调用统一处理函数。
 *
 * @param {string} fileData - 网表文件文本内容（JSON 字符串）
 * @param {Array|Object} selectedComponents - 选中的器件（单个或数组）
 * @returns {Array<{uniqueId: string, designator: string, pin: string, netName: string}>}
 */
function formatFileNetlist(fileData, selectedComponents) {
	return formatSchematicNetlist(fileData, selectedComponents);
}

/**
 * 处理网表数据，找出需要放置导线的引脚
 *
 * 比对原理图与 PCB 的引脚网络：若原理图中该引脚无网络而 PCB 中有，
 * 则为该引脚（及其每个图元 ID）生成待放置导线的数据。
 *
 * 判定规则：`!hasSchematicNet && hasPCBNet`，两侧都先 `trim()`，
 * 因此空字符串与纯空格一律视为「无网络」。
 *
 * @param {string[]} componentIds - 同一器件的所有图元 ID（每个 ID 都会产出一条记录）
 * @param {string} uniqueId - 器件唯一 ID
 * @param {string} designator - 位号
 * @param {Array<{uniqueId,designator,pin,netName}>} schematicNetlist - 已格式化的原理图网表
 * @param {Array<{uniqueId,designator,pin,netName}>} pcbNetlist - 已格式化的 PCB 网表
 * @returns {Array<{componentId: string, uniqueId: string, designator: string, pin: string, netName: string}>}
 */
function processNetlistData(componentIds, uniqueId, designator, schematicNetlist, pcbNetlist) {
	const result = [];

	// 只处理当前选中的器件
	const relevantPCBPins = pcbNetlist.filter((item) => item.uniqueId === uniqueId);
	const relevantSchematicPins = schematicNetlist.filter((item) => item.uniqueId === uniqueId);

	for (const pcbPin of relevantPCBPins) {
		// 在原理图网表中查找对应的引脚
		const schematicPin = relevantSchematicPins.find((item) => item.pin === pcbPin.pin);

		// 如果原理图中该引脚没有网络名称，但PCB中有网络名称，则需要放置导线
		const hasSchematicNet = schematicPin && schematicPin.netName && schematicPin.netName.trim() !== '';
		const hasPCBNet = pcbPin.netName && pcbPin.netName.trim() !== '';

		if (!hasSchematicNet && hasPCBNet) {
			// 为每个图元ID都创建引脚数据
			for (const componentId of componentIds) {
				result.push({
					componentId: componentId,
					uniqueId: uniqueId,
					designator: designator,
					pin: pcbPin.pin,
					netName: pcbPin.netName,
				});
			}
		}
	}
	return result;
}

/**
 * 统计网表的规模（器件数 / 引脚数 / 网络数）
 *
 * 只用于「更新网表缓存」后的提示文案：让用户一眼看出这份缓存是空的还是真的有料，
 * 不用去数日志。统计口径与 `formatSchematicNetlist` 一致（V3 取 `components` + `pinInfoMap`，
 * V2 取裸对象 + `pins`），没有 `props` 的键（版本号之类的杂项）不计入器件。
 *
 * 网络数量按**去重后的非空网络名**统计，空网络表示「该引脚未连接」。
 *
 * 一个器件都解析不出来时返回 null：这既可能是 JSON 坏了，也可能是取错了文档
 * （例如把原理图自己的网表当成 PCB 的），两者都不该写进缓存。
 *
 * @param {string} netlistData - 网表 JSON 字符串
 * @returns {{componentCount: number, pinCount: number, netCount: number}|null} 统计结果；
 *          内容不是合法网表 JSON、或没有任何器件时返回 null
 */
function summarizeNetlist(netlistData) {
	let parsedData;
	try {
		parsedData = JSON.parse(netlistData);
	} catch (error) {
		return null;
	}
	const componentsMap = parsedData && parsedData.components ? parsedData.components : parsedData;
	if (!componentsMap || typeof componentsMap !== 'object') return null;

	let componentCount = 0;
	let pinCount = 0;
	const netNames = new Set();

	for (const componentData of Object.values(componentsMap)) {
		if (!componentData || typeof componentData !== 'object' || !componentData.props) continue;
		componentCount++;
		for (const netName of extractPinNets(componentData)) {
			pinCount++;
			const trimmed = typeof netName === 'string' ? netName.trim() : '';
			if (trimmed) netNames.add(trimmed);
		}
	}

	if (componentCount === 0) return null;
	return { componentCount, pinCount, netCount: netNames.size };
}

/**
 * 取一个器件在网表里的所有引脚网络名（只取值，不管引脚号）
 *
 * @param {object} componentData - 网表中的器件节点
 * @returns {Array<string>} 网络名（可能为空串）
 */
function extractPinNets(componentData) {
	if (componentData.pinInfoMap) {
		return Object.values(componentData.pinInfoMap).map((pinInfo) => (pinInfo && pinInfo.net) || '');
	}
	if (componentData.pins) return Object.values(componentData.pins);
	return [];
}

export { formatSchematicNetlist, formatPCBNetlist, formatFileNetlist, processNetlistData, summarizeNetlist };
