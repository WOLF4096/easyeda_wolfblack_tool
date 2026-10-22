/**
 * @//module/ app/generate-net/apiWriter
 * @//description/ 通过图元 API 逐条改写网络名（写入方式三选一里的兜底方案）
 * @//exports/ WRITER_MAP, writeNetByApi
 * @//dependencies/ 无
 * @//example/ const { writeNetByApi } = await import('./apiWriter.js')
 *            const ok = await writeNetByApi(eda, op)   // op = { id, type, newNet }
 *
 * ⚠️ 焊盘（PAD）走不通：`pcb_PrimitivePad.modify` 在两版客户端上都有问题，
 * 官方修复前这里直接返回失败（原来那段被注释掉的调用就是它）。
 * 所以「API 方式」只能做兜底，焊盘网络请用源码方式写。
 */

/** 图元类型 → 宿主 API 名（原 switch 改成表，加类型不用再动逻辑） */
export const WRITER_MAP = Object.freeze({
	VIA: 'pcb_PrimitiveVia',
	LINE: 'pcb_PrimitiveLine',
	ARC: 'pcb_PrimitiveArc',
	FILL: 'pcb_PrimitiveFill',
	POLY: 'pcb_PrimitivePolyline',
	POUR: 'pcb_PrimitivePour',
	REGION: 'pcb_PrimitiveFill',
	COPPER_AREA: 'pcb_PrimitivePour',
});

/**
 * 用图元 API 改一条网络
 *
 * @param {object} host 宿主对象（`eda`）
 * @param {{id: string, type: string, newNet: string}} op 操作
 * @returns {Promise<boolean>} 是否成功
 * @sideEffects 调用宿主 API（会改文档）
 */
export async function writeNetByApi(host, op) {
	// 焊盘 API 有已知缺陷，不尝试（避免"看起来成功其实没改"）
	if (op.type === 'PAD') return false;

	const apiName = WRITER_MAP[op.type];
	if (!apiName || typeof host[apiName]?.modify !== 'function') return false;

	try {
		await host[apiName].modify(op.id, { net: op.newNet });
		return true;
	} catch (e) {
		console.error(e);
		return false;
	}
}
