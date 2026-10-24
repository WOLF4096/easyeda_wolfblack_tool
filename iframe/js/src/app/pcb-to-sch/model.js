/**
 * @//module/ app/pcb-to-sch/model
 * @//description/ 工程数据模型：定位 UUID、解析 PCB 源码、补符号信息、合并显示行（全部纯函数）
 * @//exports/ findUuids, parsePcbContent, enrichWithSymbol, mergeComponentsForDisplay, projectTitleOf, pcbFilePath, symbolFilePath
 * @//dependencies/ 无
 * @//example/ const { findUuids, parsePcbContent } = await import('./model.js')
 *            const { pcbUuid, schematicUuid } = findUuids(projectJson, sheetUuid)
 *            const comps = parsePcbContent(pcbSource)
 *
 * 这里只做「数据 → 数据」，不读 zip、不碰 DOM、不写文档 —— 所以可以被 `node --test` 直接跑。
 * 取文件、解压、写盘一律留在页面入口。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 在 project.json 里定位当前页对应的原理图 uuid 与 PCB uuid
 *
 * @param {object} projectJson project.json 内容
 * @param {string} sheetUuid 当前文档 uuid
 * @returns {{schematicUuid: string, pcbUuid: string}} 两个 uuid
 * @throws {Error} 找不到原理图或 PCB 时抛出（消息直接显示给用户）
 * @sideEffects 无（纯函数）
 */
export function findUuids(projectJson, sheetUuid) {
	let schematicUuid = null;
	for (const entry of Object.entries(projectJson.schematics || {})) {
		const uuid = entry[0];
		const sheets = entry[1].sheets || [];
		if (sheets.some((sheet) => sheet.uuid === sheetUuid)) {
			schematicUuid = uuid;
			break;
		}
	}
	if (!schematicUuid) throw new Error('未找到对应原理图UUID');

	let pcbUuid = null;
	for (const entry of Object.entries(projectJson.boards || {})) {
		const board = entry[1];
		if (board.schematic === schematicUuid) {
			pcbUuid = board.pcb;
			break;
		}
	}
	if (!pcbUuid) throw new Error('未找到对应PCB UUID');

	return { schematicUuid: schematicUuid, pcbUuid: pcbUuid };
}

/**
 * 压缩包内的 PCB 文件路径
 *
 * @param {string} pcbUuid PCB uuid
 * @returns {string} 相对路径
 * @sideEffects 无（纯函数）
 */
export function pcbFilePath(pcbUuid) {
	return `PCB/${pcbUuid}.epcb`;
}

/**
 * 压缩包内的符号文件路径
 *
 * @param {string} symbolUuid 符号 uuid
 * @returns {string} 相对路径
 * @sideEffects 无（纯函数）
 */
export function symbolFilePath(symbolUuid) {
	return `SYMBOL/${symbolUuid}.esym`;
}

/**
 * 把 ATTR 行里的属性名映射到器件字段
 *
 * 只需关心这四个；其余属性（Value/Supplier…）原理图重建时用不到。
 * @type {Readonly<Record<string, string>>}
 */
const ATTR_FIELD = {
	Designator: 'designator',
	Name: 'name',
	Device: 'deviceUuid',
	Footprint: 'footprintUuid',
};

/**
 * 解析 `.epcb` 源码，得到器件列表
 *
 * 三类行：
 *   - `COMPONENT`：器件本体（层 / 坐标 / 旋转 / 属性表）
 *   - `ATTR`：位号、名称、器件 uuid、封装 uuid
 *   - `PAD_NET`：引脚网络（`[compId, pinNumber, netName]`）
 *
 * @param {string} pcbContent `.epcb` 文本
 * @returns {Array<object>} 器件数组（按出现顺序）
 * @sideEffects 无（纯函数）
 */
export function parsePcbContent(pcbContent) {
	const map = new Map();
	const lines = String(pcbContent || '').split('\n');

	for (const line of lines) {
		if (!line.trim()) continue;
		let data;
		try {
			data = JSON.parse(line);
		} catch {
			continue; // 忽略解析错误的行
		}
		if (!Array.isArray(data)) continue;

		applyPcbLine(map, data);
	}

	return Array.from(map.values());
}

/**
 * 把一行 PCB 源码作用到器件表上（就地修改）
 *
 * @param {Map<string, object>} map 器件表
 * @param {Array} data 解析后的一行
 * @returns {void}
 * @sideEffects **就地修改** `map`
 */
function applyPcbLine(map, data) {
	const type = data[0];

	if (type === 'COMPONENT') {
		const props = data[7] || {};
		map.set(data[1], {
			uniqueId: props['Unique ID'] || '',
			supplierPart: props['Supplier Part'] || '',
			designator: '',
			name: '',
			deviceUuid: '',
			footprintUuid: '',
			layer: data[3],
			x: data[4],
			y: data[5],
			rotation: data[6],
			deviceName: '',
			symbolUuid: '',
			symbolName: '',
			footprintName: '',
			pins: {},
		});
		return;
	}

	if (type === 'ATTR') {
		const comp = map.get(data[3]);
		const field = ATTR_FIELD[data[7]];
		if (comp && field) comp[field] = data[8];
		return;
	}

	if (type === 'PAD_NET') {
		const comp = map.get(data[1]);
		// 网络名允许为空字符串（表示未连接）
		if (comp) comp.pins[data[2]] = data[3];
	}
}

/**
 * 用 project.json 补全器件的器件名 / 符号 / 封装信息（就地修改）
 *
 * @param {Array<object>} components 器件数组
 * @param {object} projectJson project.json 内容
 * @returns {void}
 * @sideEffects **就地修改** `components`
 */
export function enrichWithSymbol(components, projectJson) {
	const devices = projectJson.devices || {};
	const symbols = projectJson.symbols || {};
	const footprints = projectJson.footprints || {};

	for (const comp of components) {
		applyDeviceFields(comp, devices, symbols);
		comp.footprintName = footprintTitleOf(comp.footprintUuid, footprints);
	}
}

/**
 * 按器件 uuid 补 `deviceName` / `symbolUuid` / `symbolName`（就地修改）
 *
 * @param {object} comp 器件
 * @param {object} devices 器件库
 * @param {object} symbols 符号库
 * @returns {void}
 * @sideEffects **就地修改** `comp`
 */
function applyDeviceFields(comp, devices, symbols) {
	const device = comp.deviceUuid ? devices[comp.deviceUuid] : null;
	if (!device) {
		comp.deviceName = '';
		comp.symbolUuid = '';
		comp.symbolName = '';
		return;
	}

	comp.deviceName = device.title || '';
	comp.symbolUuid = (device.attributes && device.attributes.Symbol) || '';
	comp.symbolName = symbolTitleOf(comp.symbolUuid, symbols);
}

/**
 * 取符号标题（找不到时为空串）
 *
 * @param {string} symbolUuid 符号 uuid
 * @param {object} symbols 符号库
 * @returns {string} 标题
 * @sideEffects 无（纯函数）
 */
function symbolTitleOf(symbolUuid, symbols) {
	const symbol = symbolUuid ? symbols[symbolUuid] : null;
	return symbol ? symbol.title || '' : '';
}

/**
 * 取封装标题（找不到时为空串）
 *
 * @param {string} footprintUuid 封装 uuid
 * @param {object} footprints 封装库
 * @returns {string} 标题
 * @sideEffects 无（纯函数）
 */
function footprintTitleOf(footprintUuid, footprints) {
	const footprint = footprintUuid ? footprints[footprintUuid] : null;
	return footprint ? footprint.title || '' : '';
}

/**
 * 合并「封装 uuid + 器件 uuid」相同的器件，用于表格显示
 *
 * @param {Array<object>} components 器件数组
 * @returns {Array<object>} 显示行（按封装名排序）
 * @sideEffects 无（纯函数）
 */
export function mergeComponentsForDisplay(components) {
	const groups = new Map();

	components.forEach((comp, index) => {
		const key = `${comp.footprintUuid}|${comp.deviceUuid}`;
		if (!groups.has(key)) {
			groups.set(key, {
				key: key,
				footprintName: comp.footprintName,
				deviceName: comp.deviceName,
				symbolName: comp.symbolName,
				designators: [],
				names: [],
				supplierParts: [],
				componentIndices: [],
			});
		}
		const group = groups.get(key);
		group.designators.push(comp.designator);
		group.names.push(comp.name);
		group.supplierParts.push(comp.supplierPart);
		group.componentIndices.push(index);
	});

	return Array.from(groups.values())
		.map((group) => ({
			...group,
			designatorDisplay: group.designators.join(','),
			nameDisplay: [...new Set(group.names)].join(','),
		}))
		.sort((a, b) => (a.footprintName || '').toLowerCase().localeCompare((b.footprintName || '').toLowerCase()));
}

/**
 * 取导出工程文件用的基础名
 *
 * @param {object|null} projectJson project.json 内容
 * @returns {string} 文件名（含 `.epro`）
 * @sideEffects 无（纯函数）
 */
export function projectTitleOf(projectJson) {
	let baseName = 'project_PCB_TO_SCH';
	if (projectJson && projectJson.title) baseName = projectJson.title;
	else if (projectJson && projectJson.name) baseName = projectJson.name;
	// 去掉可能已存在的 .epro 后缀，避免 `xxx.epro.epro`
	return `${String(baseName).replace(/\.epro$/i, '')}.epro`;
}
