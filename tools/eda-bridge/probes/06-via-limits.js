/**
 * 探针 06：过孔内径的下限钳制（**会改动文档，务必先备份**）
 *
 * 背景：写 `VIA create(..., holeD=0.3, outerD=0.6, ...)` 后读回是 `holeDiameter=0.4`。
 * 如果这是平台的最小钻孔限制，那么「焊盘 ⇄ 过孔」转出来的孔会比原焊盘小孔**变大**，
 * 属静默改值——需要确认边界，才能判断要不要在插件里提示用户。
 *
 * 做法：逐个内径创建 → 读回实际值 → 立即删除。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const out = { version: eda.sys_Environment.getEditorCurrentVersion(), rows: [] };

for (const hole of [0.1, 0.2, 0.3, 0.4, 0.5, 0.8, 1.5]) {
	let id = null;
	try {
		const ret = await eda.pcb_PrimitiveVia.create('', 60, 10, hole, 2.0, 0, null, 0, false);
		id = ret && ret.primitiveId;
		const v = id ? await eda.pcb_PrimitiveVia.get(id) : null;
		out.rows.push({ input: hole, actual: v ? v.holeDiameter : null, id });
	} catch (e) {
		out.rows.push({ input: hole, error: String((e && e.message) || e) });
	} finally {
		if (id) {
			try {
				await eda.pcb_PrimitiveVia.delete(id);
			} catch (e) {
				/* 忽略 */
			}
		}
	}
}

// 确认没有留下垃圾
const left = await eda.pcb_PrimitiveVia.getAllPrimitiveId();
out.viaCountAfter = Array.isArray(left) ? left.length : 'n/a';
return out;
