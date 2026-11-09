/**
 * 探针 26：批量修改线宽的前置事实（只读）
 *
 * 要回答四个问题：
 *   1. `getAll()` 返回的是普通字段还是类实例 getter？（决定 reader 的取值方式）
 *   2. API 的 `primitiveId` 与源码行的 `id` 是否一致？（决定源码模式能否按 id 命中）
 *   3. 源码里 ARC 行的字段名到底是什么（`angle` / `arcAngle` / `width`）？
 *   4. 当前文档有没有铺铜（决定源码模式是否要提示重铺铜）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
const version = eda.sys_Environment.getEditorCurrentVersion();
const lines = await eda.pcb_PrimitiveLine.getAll();
const arcs = await eda.pcb_PrimitiveArc.getAll();

/** 源码行 → { type, id, inner } */
function parseRows(source) {
	const out = { LINE: [], ARC: [] };
	for (const raw of source.split('\n')) {
		const line = raw.trim();
		if (!line.startsWith('{"type"')) continue;
		const hasPipe = line.endsWith('|');
		const parts = (hasPipe ? line.slice(0, -1) : line).split('||');
		if (parts.length !== 2) continue;
		let head;
		let inner;
		try {
			head = JSON.parse(parts[0]);
			inner = JSON.parse(parts[1]);
		} catch {
			continue;
		}
		if (!out[head.type]) continue;
		out[head.type].push({ id: head.id, inner: inner });
	}
	return out;
}

/** 取 id：兼容普通字段与 getter */
function idOf(prim) {
	if (typeof prim.primitiveId === 'string' && prim.primitiveId) return prim.primitiveId;
	return typeof prim.getState_PrimitiveId === 'function' ? prim.getState_PrimitiveId() : '';
}

const src = await eda.sys_FileManager.getDocumentSource();
const rows = parseRows(src);
const apiLineIds = lines.map(idOf);
const apiArcIds = arcs.map(idOf);
const srcLineIds = rows.LINE.map((row) => row.id);
const srcArcIds = rows.ARC.map((row) => row.id);

const hit = (apiIds, srcIds) => apiIds.filter((id) => srcIds.includes(id)).length;

let pours = 'n/a';
try {
	pours = (await eda.pcb_PrimitivePour.getAll()).length;
} catch (e) {
	pours = 'error: ' + e.message;
}

return {
	version: version,
	docKind: src.split('\n')[0].slice(0, 120),
	counts: { apiLines: lines.length, apiArcs: arcs.length, srcLines: rows.LINE.length, srcArcs: rows.ARC.length },
	idMatch: {
		line: `${hit(apiLineIds, srcLineIds)}/${apiLineIds.length}`,
		arc: `${hit(apiArcIds, srcArcIds)}/${apiArcIds.length}`,
		apiLineIds: apiLineIds.slice(0, 3),
		srcLineIds: srcLineIds.slice(0, 3),
		apiArcIds: apiArcIds.slice(0, 3),
		srcArcIds: srcArcIds.slice(0, 3),
	},
	fields: lines[0] ? Object.keys(lines[0]) : [],
	sampleLine: lines[0] || null,
	sampleArc: arcs[0] || null,
	srcLineRow: rows.LINE[0] ? JSON.stringify(rows.LINE[0]).slice(0, 420) : null,
	srcArcRow: rows.ARC[0] ? JSON.stringify(rows.ARC[0]).slice(0, 420) : null,
	pours: pours,
};
