/**
 * 探针 05：图元写入 / 读回 / 删除往返（**会改动文档，务必先备份**）
 *
 * 验证的是插件最底层的写契约：`create → get → delete` 能否闭环，参数顺序是否与
 * 我们代码里的调用一致（Line 8 参、Arc 10 参、Via 9 参）。
 *
 * 做法：先记下当前图元 id 集合，create 后取差集拿到新 id，读回字段，再删除并确认 id 消失。
 * 任何一步失败都会把已创建的图元删掉，避免留下垃圾。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const out = { version: eda.sys_Environment.getEditorCurrentVersion(), steps: [] };
const created = [];

const ids = async (ns) => {
	const arr = await eda[ns].getAllPrimitiveId();
	return Array.isArray(arr) ? arr : Array.from(arr || []);
};
const diff = (before, after) => after.filter((id) => !before.includes(id));

async function attempt(label, fn, ns) {
	const before = await ids(ns);
	let newIds = [];
	try {
		const ret = await fn();
		const after = await ids(ns);
		newIds = diff(before, after);
		created.push({ ns, ids: newIds });
		const sample = newIds.length ? await eda[ns].get(newIds[0]) : null;
		out.steps.push({
			label,
			ok: true,
			returnValue: ret === undefined ? 'undefined' : JSON.parse(JSON.stringify(ret ?? null)),
			newIds,
			readBack: sample ? JSON.parse(JSON.stringify(sample)) : null,
		});
	} catch (e) {
		out.steps.push({ label, ok: false, error: String((e && e.message) || e) });
	}
}

// 1) 直线：create(net, layer, x1, y1, x2, y2, width, locked)
await attempt(
	'LINE create(8 参)',
	() => eda.pcb_PrimitiveLine.create('', 1, 10, 10, 20, 10, 6, false),
	'pcb_PrimitiveLine',
);

// 2) 圆弧：create(net, layer, x1, y1, x2, y2, angle, width, arcType, locked)
await attempt(
	'ARC create(10 参)',
	() => eda.pcb_PrimitiveArc.create('', 1, 20, 10, 30, 10, -90, 6, 1, false),
	'pcb_PrimitiveArc',
);

// 3) 过孔：create(net, x, y, holeD, outerD, viaType, designRule, solderMask, locked)
await attempt(
	'VIA create(9 参)',
	() => eda.pcb_PrimitiveVia.create('', 40, 10, 0.3, 0.6, 0, null, 0, false),
	'pcb_PrimitiveVia',
);

// 4) 全部删除，并确认 id 已消失
const cleanup = [];
for (const { ns, ids: list } of created) {
	for (const id of list) {
		try {
			await eda[ns].delete(id);
			const still = await eda[ns].get(id);
			cleanup.push({ ns, id, deleted: !still });
		} catch (e) {
			cleanup.push({ ns, id, error: String((e && e.message) || e) });
		}
	}
}
out.cleanup = cleanup;
out.remainingIds = Object.fromEntries(
	await Promise.all(
		['pcb_PrimitiveLine', 'pcb_PrimitiveArc', 'pcb_PrimitiveVia'].map(async (ns) => [ns, (await ids(ns)).length]),
	),
);

return out;
