/**
 * 探针 00：环境体检
 *
 * 回答三个问题：
 *   1. EDA 版本是什么、当前打开的是哪个文档（PCB / 原理图）；
 *   2. 当前文档源码是 V2 数组格式还是 V3/V4 日志格式（决定插件该走哪条分支）；
 *   3. 插件依赖的关键 API 在当前版本是否都存在。
 *
 * 返回值会被 `safeJson` 序列化后回传，长字符串已截断。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const ver = eda.sys_Environment.getEditorCurrentVersion();

let docInfo = null;
try {
	docInfo = await eda.dmt_EditorControl.getCurrentDocumentInfo();
} catch (e) {
	docInfo = { error: String(e && e.message) };
}

// 源码形态：只取头部，避免几 MB 字符串穿过 WebSocket
let source = {};
try {
	const src = await eda.sys_FileManager.getDocumentSource();
	if (typeof src === 'string') {
		const lines = src.split('\n');
		const nonEmpty = lines.filter((l) => l.trim());
		source = {
			length: src.length,
			lines: nonEmpty.length,
			crlf: (src.match(/\r\n/g) || []).length,
			hasDoublePipe: nonEmpty.some((l) => l.includes('||')), // V3/V4 日志格式特征
			firstLineStartsWithBracket: (nonEmpty[0] || '').trimStart().startsWith('['), // V2 数组格式特征
			head: nonEmpty.slice(0, 3).join('\n').slice(0, 600),
		};
	} else {
		source = { type: typeof src };
	}
} catch (e) {
	source = { error: String(e && e.message) };
}

// 关键 API 是否可用（只看 typeof，不调用）
const paths = [
	'pcb_Net.getAllNets',
	'pcb_Net.getAllNetsName',
	'pcb_Net.getNetLength',
	'pcb_SelectControl.getAllSelectedPrimitives',
	'pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId',
	'pcb_SelectControl.getSelectedPrimitives',
	'pcb_ManufactureData.getNetlistFile',
	'sch_ManufactureData.getNetlistFile',
	'pcb_Net.setNetlist',
	'sch_Netlist.setNetlist',
	'sys_FileManager.getDocumentSource',
	'sys_FileManager.setDocumentSource',
	'dmt_EditorControl.getCurrentDocumentInfo',
	'pcb_PrimitiveLine.create',
	'pcb_PrimitiveArc.create',
	'pcb_PrimitivePolyline.create',
	'pcb_PrimitiveVia.create',
	'pcb_PrimitivePad.create',
	'pcb_PrimitiveRegion.create',
	'pcb_Layers.getAllLayers',
	'lib_LibrariesList.getSystemLibraryUuid',
];
const api = {};
for (const p of paths) {
	let cur = eda;
	let bad = null;
	for (const seg of p.split('.')) {
		if (cur === null || cur === undefined || !(seg in Object(cur))) {
			bad = seg;
			break;
		}
		cur = cur[seg];
	}
	api[p] = bad ? 'MISSING@' + bad : typeof cur;
}

// 当前选中集数量（判断「选中类」功能是否有前提）
let selectionCount = null;
try {
	const ids = await eda.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
	selectionCount = ids && typeof ids.length === 'number' ? ids.length : null;
} catch (e) {
	selectionCount = 'error: ' + String(e && e.message);
}

return { ver, docInfo, source, api, selectionCount };
