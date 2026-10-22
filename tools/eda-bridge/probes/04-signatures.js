/**
 * 探针 04：API 形参个数契约（只读）
 *
 * 用 `Function.prototype.length` 读声明形参个数，与我们实际调用时传的实参个数比对。
 * 这是**不写文档**就能发现「API 签名变了」的办法：
 *   - 声明 8 个而代码传 10 个 → 多传的会被忽略（或抛错），图形参数错位；
 *   - 声明 17 个而代码传 15 个 → 后两个参数为 undefined，可能把阻焊/焊盘类型写错。
 *
 * 插件内部的调用契约（后端 src/js 与前端 iframe/js）见 `test/edaParams.test.mjs`。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const TARGETS = [
	'pcb_PrimitiveVia.create',
	'pcb_PrimitivePad.create',
	'pcb_PrimitiveLine.create',
	'pcb_PrimitiveArc.create',
	'pcb_PrimitivePolyline.create',
	'pcb_PrimitiveFill.create',
	'pcb_PrimitiveRegion.create',
	'pcb_PrimitiveImage.create',
	'pcb_PrimitiveObject.create',
	'pcb_PrimitiveComponent.create',
	'pcb_PrimitiveLine.modify',
	'pcb_PrimitiveArc.modify',
	'pcb_PrimitiveVia.modify',
	'pcb_PrimitivePad.modify',
	'sys_FileManager.setDocumentSource',
	'sys_FileManager.getDocumentSource',
	'pcb_Net.setNetlist',
	'pcb_ManufactureData.getNetlistFile',
	'dmt_EditorControl.activateDocument',
	'sys_IFrame.openIFrame',
];

const resolve = (p) => {
	let cur = typeof eda !== 'undefined' ? eda : null;
	for (const seg of p.split('.')) {
		if (cur === null || cur === undefined || !(seg in Object(cur))) return { ok: false, at: seg };
		cur = cur[seg];
	}
	return { ok: true, value: cur };
};

const out = { version: eda.sys_Environment.getEditorCurrentVersion(), arity: {}, missing: [] };
for (const p of TARGETS) {
	const r = resolve(p);
	if (!r.ok) {
		out.missing.push(p + ' (缺 ' + r.at + ')');
		continue;
	}
	if (typeof r.value !== 'function') {
		out.arity[p] = 'not-a-function:' + typeof r.value;
		continue;
	}
	out.arity[p] = r.value.length;
}

return out;
