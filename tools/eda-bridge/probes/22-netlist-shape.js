/**
 * 探针 22：网表取法的真实返回（只读）
 *
 * `GenerateNet` 的网表模式与 `ReplaceComponent` 都依赖 `getNetlist('PCB')`，
 * 而 V4 与 V2 的根对象形状不同。这里把原始返回与解析后的形状都打出来。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
const out = {};

const raw = await eda.pcb_ManufactureData.getNetlistFile('PCB');
out.rawType = typeof raw;
out.rawKeys = raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 10) : null;
out.rawHead = typeof raw === 'string' ? raw.slice(0, 300) : JSON.stringify(raw).slice(0, 300);

let obj = null;
try {
	obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch (e) {
	out.parseError = e.message;
}

if (obj) {
	out.rootKeys = Object.keys(obj).slice(0, 12);
	out.version = obj.version;
	out.hasComponents = !!obj.components;
	const container = obj.components || obj;
	const keys = Object.keys(container);
	out.containerKeysSample = keys.slice(0, 4);
	const first = container[keys[0]];
	out.firstComp = first
		? {
				keys: Object.keys(first).slice(0, 8),
				propsKeys: first.props ? Object.keys(first.props).slice(0, 10) : null,
				designator: first.props && first.props.Designator,
				hasPins: !!first.pins,
				hasPinInfoMap: !!first.pinInfoMap,
				pinInfoSample: first.pinInfoMap ? Object.keys(first.pinInfoMap).slice(0, 3) : null,
			}
		: null;
}

// 图元 API 是否可用（GenerateNet 的 API 写入方式要用）
out.apis = {
	getAllPads: typeof eda.pcb_PrimitivePad?.getAll,
	getAllNets: typeof eda.pcb_Net?.getAllNets,
	lineModify: typeof eda.pcb_PrimitiveLine?.modify,
	viaModify: typeof eda.pcb_PrimitiveVia?.modify,
	schComponents: typeof eda.sch_PrimitiveComponent?.getAll,
};

return out;
