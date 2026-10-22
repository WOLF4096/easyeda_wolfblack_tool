/**
 * 探针 03：网表结构与读接口
 *
 * 验证插件最核心的读路径是否与两版 EDA 对得上：
 *   1. `pcb_ManufactureData.getNetlistFile('JLCEDA')` 能否拿到网表、结构是根对象还是 `{components}` 嵌套；
 *   2. 器件条目里有哪些字段（`props` 里的 Name / Manufacturer / Supplier 等是否齐）；
 *   3. `pcb_Net.getAllNets()` 返回什么（`导出全部网络` 依赖它）；
 *   4. `dmt_SelectControl.getCurrentDocumentInfo()` 的 documentType 取值。
 *
 * 纯读，不写任何文档数据。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const out = { version: eda.sys_Environment.getEditorCurrentVersion() };

// 1) 当前文档信息
try {
	out.docInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
} catch (e) {
	out.docInfo = { error: String(e && e.message) };
}

// 2) 网表
try {
	const file = await eda.pcb_ManufactureData.getNetlistFile('JLCEDA');
	const text = await file.text();
	const json = JSON.parse(text);
	out.netlist = {
		bytes: text.length,
		topKeys: Object.keys(json).slice(0, 8),
		hasComponentsKey: !!json.components,
		componentCount: Object.keys(json.components || json).length,
	};
	// 取第一个器件看字段
	const container = json.components || json;
	const firstName = Object.keys(container)[0];
	const first = container[firstName];
	out.netlist.sampleName = firstName;
	out.netlist.sampleKeys = first ? Object.keys(first) : [];
	out.netlist.sampleProps = first && first.props ? Object.keys(first.props).slice(0, 20) : null;
	// 引脚信息也看一眼（部分功能靠它）
	out.netlist.samplePinKeys = first && first.pinInfoMap ? Object.keys(first.pinInfoMap).slice(0, 5) : null;
} catch (e) {
	out.netlist = { error: String((e && e.stack) || e) };
}

// 3) 全部网络（含长度）
try {
	const nets = await eda.pcb_Net.getAllNets();
	out.allNets = {
		type: Array.isArray(nets) ? 'array' : typeof nets,
		count: Array.isArray(nets) ? nets.length : null,
		sample: Array.isArray(nets) && nets.length ? nets[0] : null,
	};
} catch (e) {
	out.allNets = { error: String(e && e.message) };
}

return out;
