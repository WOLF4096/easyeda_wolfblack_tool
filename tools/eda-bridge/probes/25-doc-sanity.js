/** 探针 25：写回后文档自检（只读）——器件数、PAD_NET 数、是否还能正常读写
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
const src = await eda.sys_FileManager.getDocumentSource();
const lines = src.split('\n');
const count = (t) => lines.filter((l) => l.includes(`"type":"${t}"`)).length;
let comps = 0;
try {
	comps = (await eda.pcb_PrimitiveComponent.getAll()).length;
} catch (e) {
	comps = 'ERR: ' + e.message;
}
const pads = await eda.pcb_PrimitivePad.getAll();
return {
	bytes: src.length,
	componentLines: count('COMPONENT'),
	padNetLines: count('PAD_NET'),
	attrLines: count('ATTR'),
	apiComponents: comps,
	apiPads: pads.length,
	padNets: pads.map((p) => ({ id: p.primitiveId, net: p.net })).slice(0, 6),
};
