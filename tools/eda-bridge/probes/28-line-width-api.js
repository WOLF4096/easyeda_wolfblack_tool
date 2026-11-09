/**
 * 探针 28：API 方式改线宽 + 删除的实机验证（自建自删）
 *
 * 额外回答一个精度问题：传 7.906 这种三位小数，回读会不会被量化（V4 焊盘是 0.1 mil）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
const log = [];
const temp = { line: null, arc: null };

function farX() {
	return 2000 + Math.floor(Math.random() * 100000);
}

function idOf(prim) {
	if (!prim) return '';
	if (typeof prim.primitiveId === 'string' && prim.primitiveId) return prim.primitiveId;
	return typeof prim.getState_PrimitiveId === 'function' ? prim.getState_PrimitiveId() : '';
}

try {
	const x = farX();
	const y = farX();
	temp.line = await eda.pcb_PrimitiveLine.create('', 1, x, y, x + 600, y, 10, false);
	temp.arc = await eda.pcb_PrimitiveArc.create('', 1, x, y + 300, x + 500, y + 600, 90, 10, 1, false);
	const lineId = idOf(temp.line);
	const arcId = idOf(temp.arc);

	await eda.pcb_PrimitiveLine.modify(lineId, { lineWidth: 7.906 });
	await eda.pcb_PrimitiveArc.modify(arcId, { lineWidth: 12 });

	const afterLine = await eda.pcb_PrimitiveLine.get(lineId);
	const afterArc = await eda.pcb_PrimitiveArc.get(arcId);
	log.push({
		step: 'modify',
		lineWidth: afterLine ? afterLine.lineWidth : 'gone',
		arcWidth: afterArc ? afterArc.lineWidth : 'gone',
		arcAngle: afterArc ? afterArc.arcAngle : 'gone',
	});

	// 字符串参数是否会被拒（预期抛 VALUE_OUT_OF_RANGE）
	let stringResult = 'no-throw';
	try {
		await eda.pcb_PrimitiveLine.modify(lineId, { lineWidth: '6.0' });
	} catch (e) {
		stringResult = String(e.message || e).slice(0, 120);
	}
	log.push({ step: 'string-arg', result: stringResult });

	await eda.pcb_PrimitiveLine.delete([lineId]);
	await eda.pcb_PrimitiveArc.delete([arcId]);
	const linesAfter = await eda.pcb_PrimitiveLine.getAll();
	const arcsAfter = await eda.pcb_PrimitiveArc.getAll();
	log.push({
		step: 'delete',
		lineGone: !linesAfter.some((item) => idOf(item) === lineId),
		arcGone: !arcsAfter.some((item) => idOf(item) === arcId),
	});
} finally {
	for (const entry of [
		['pcb_PrimitiveLine', idOf(temp.line)],
		['pcb_PrimitiveArc', idOf(temp.arc)],
	]) {
		if (!entry[1]) continue;
		try {
			await eda[entry[0]].delete([entry[1]]);
		} catch (e) {
			log.push({ step: 'cleanup', api: entry[0], error: e.message });
		}
	}
}

return { log: log };
