/**
 * 探针 27：源码方式改线宽 + 删行的实机验证（会建/删临时图元，结束前自行清理）
 *
 * 步骤：
 *   1. 在空白坐标建 3 个临时图元：直线 L1(10)、直线 L2(6)、圆弧 A1(10)；
 *   2. 读整份源码，按 id 改 L1→8、A1→12，整行删掉 L2（与页面的 rewriteWidths 同算法）；
 *   3. setDocumentSource 写回，等 400ms，再 getAll 回读；
 *   4. 清理剩下的 L1 / A1（API 删除），报告每一步结果。
 *
 * 只碰自己建的图元，不动画布上已有内容；文档没有铺铜时才跑（避免触发 POURED 丢失）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
const log = [];
const temp = { line1: null, line2: null, arc1: null };

/** 随机远坐标，避免与画布已有图元重叠 */
function farX() {
	return 2000 + Math.floor(Math.random() * 100000);
}

/** 取 id（兼容 getter） */
function idOf(prim) {
	if (!prim) return '';
	if (typeof prim.primitiveId === 'string' && prim.primitiveId) return prim.primitiveId;
	return typeof prim.getState_PrimitiveId === 'function' ? prim.getState_PrimitiveId() : '';
}

/** 按 id 改 width / 删行（与 app/modify-line-width/sourceWidthWriter 同算法） */
function rewrite(source, widthMap, deleteIds) {
	const out = [];
	let changed = 0;
	let deleted = 0;
	const hit = new Set();

	for (const raw of source.split('\n')) {
		const line = raw.trim();
		if (!line.startsWith('{"type"')) {
			out.push(raw);
			continue;
		}
		const hasPipe = line.endsWith('|');
		const parts = (hasPipe ? line.slice(0, -1) : line).split('||');
		if (parts.length !== 2) {
			out.push(raw);
			continue;
		}
		let head;
		let inner;
		try {
			head = JSON.parse(parts[0]);
			inner = JSON.parse(parts[1]);
		} catch {
			out.push(raw);
			continue;
		}
		const id = head.id;
		const writable = head.type === 'LINE' || head.type === 'ARC';
		if (writable && deleteIds.has(id)) {
			deleted += 1;
			hit.add(id);
			continue;
		}
		if (writable && widthMap.has(id)) {
			inner.width = widthMap.get(id);
			changed += 1;
			hit.add(id);
			out.push(parts[0] + '||' + JSON.stringify(inner) + (hasPipe ? '|' : ''));
			continue;
		}
		out.push(raw);
	}

	return { text: out.join('\n'), changed: changed, deleted: deleted, hit: hit };
}

try {
	const pours = await eda.pcb_PrimitivePour.getAll();
	if (pours.length > 0) return { skipped: '当前文档有铺铜，跳过写盘测试', pours: pours.length };

	const x = farX();
	const y = farX();
	temp.line1 = await eda.pcb_PrimitiveLine.create('', 1, x, y, x + 600, y, 10, false);
	temp.line2 = await eda.pcb_PrimitiveLine.create('', 1, x, y + 100, x + 600, y + 100, 6, false);
	temp.arc1 = await eda.pcb_PrimitiveArc.create('', 1, x, y + 300, x + 500, y + 600, 90, 10, 1, false);

	const ids = { line1: idOf(temp.line1), line2: idOf(temp.line2), arc1: idOf(temp.arc1) };
	log.push({ step: 'create', ids: ids });

	const source = await eda.sys_FileManager.getDocumentSource();
	const result = rewrite(source, new Map([[ids.line1, 8], [ids.arc1, 12]]), new Set([ids.line2]));
	log.push({ step: 'rewrite', changed: result.changed, deleted: result.deleted, missing: 3 - result.hit.size });

	let wrote = await eda.sys_FileManager.setDocumentSource(result.text);
	if (!wrote) {
		await new Promise((r) => setTimeout(r, 300));
		wrote = await eda.sys_FileManager.setDocumentSource(result.text);
	}
	log.push({ step: 'setDocumentSource', wrote: wrote });

	await new Promise((r) => setTimeout(r, 600));

	const afterLines = await eda.pcb_PrimitiveLine.getAll();
	const afterArcs = await eda.pcb_PrimitiveArc.getAll();
	const findLine = (id) => afterLines.find((item) => idOf(item) === id);
	const findArc = (id) => afterArcs.find((item) => idOf(item) === id);
	log.push({
		step: 'readback',
		line1Width: findLine(ids.line1) ? findLine(ids.line1).lineWidth : 'gone',
		line2Exists: !!findLine(ids.line2),
		arc1Angle: findArc(ids.arc1) ? findArc(ids.arc1).arcAngle : 'gone',
		arc1Width: findArc(ids.arc1) ? findArc(ids.arc1).lineWidth : 'gone',
	});
} finally {
	// 清理：只删自己建的临时图元，逐条 try（重复删除会抛错，不能挡后面的清理）
	const ids = { line1: idOf(temp.line1), line2: idOf(temp.line2), arc1: idOf(temp.arc1) };
	for (const entry of [
		['pcb_PrimitiveLine', ids.line1],
		['pcb_PrimitiveLine', ids.line2],
		['pcb_PrimitiveArc', ids.arc1],
	]) {
		if (!entry[1]) continue;
		try {
			await eda[entry[0]].delete([entry[1]]);
		} catch (e) {
			log.push({ step: 'cleanup', api: entry[0], id: entry[1], error: e.message });
		}
	}
	log.push({ step: 'cleanup', ids: ids });
}

return { log: log };
