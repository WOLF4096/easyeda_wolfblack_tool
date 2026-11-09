/**
 * @//module/ core/layer
 * @//description/ PCB 图层常量、铜层/内层判定与中文层名（官方层表的唯一前端来源）
 * @//exports/ LAYER, LAYER_LABEL, layerLabel, isInnerLayer, isCopperLayer, isConductiveLayer
 * @//dependencies/ 无
 * @//example/ const { LAYER, isConductiveLayer, layerLabel } = await import('./core/layer.js')
 *            isConductiveLayer(prim.layer) // true 表示该图元参与电气连通
 *            layerLabel(15) // '内层 1'
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * PCB 图层常量（官方层定义，与 src/js/common/pcbConstants.js 保持一致）
 *
 * MULTI(12) 是「多层」，通孔焊盘与过孔都落在这一层；铜层为 TOP/BOTTOM/内层。
 * 后端有同名常量表，两套 bundle 无法共享，改动必须两边同步。
 *
 * @type {Readonly<Record<string, number>>}
 */
export const LAYER = Object.freeze({
	TOP: 1,
	BOTTOM: 2,
	TOP_SILKSCREEN: 3,
	BOTTOM_SILKSCREEN: 4,
	TOP_SOLDER_MASK: 5,
	BOTTOM_SOLDER_MASK: 6,
	TOP_PASTE_MASK: 7,
	BOTTOM_PASTE_MASK: 8,
	TOP_ASSEMBLY: 9,
	BOTTOM_ASSEMBLY: 10,
	BOARD_OUTLINE: 11,
	MULTI: 12, // 多层：通孔焊盘 / 过孔
	DOCUMENT: 13,
	MECHANICAL: 14,
	INNER_1: 15,
	INNER_30: 44,
	HOLE: 47,
	COMPONENT_SHAPE: 48,
	COMPONENT_MARKING: 49,
	CUSTOM_1: 71,
	CUSTOM_30: 100,
});

/** 内层（铜层）区间：官方口径 15~46（45/46 在真实工程里出现过，一并算内层） */
const COPPER_LAYER_MIN = 15;
const COPPER_LAYER_MAX = 46;

/**
 * 是否内层（铜层区间 15~46）
 *
 * @param {number|string} layer 层号
 * @returns {boolean}
 * @sideEffects 无（纯函数）
 */
export function isInnerLayer(layer) {
	const value = Number(layer);
	return value >= COPPER_LAYER_MIN && value <= COPPER_LAYER_MAX;
}

/**
 * 是否铜层（顶层 / 底层 / 内层），不含 MULTI
 *
 * @param {number|string} layer 层号
 * @returns {boolean}
 * @sideEffects 无（纯函数）
 */
export function isCopperLayer(layer) {
	const value = Number(layer);
	return value === LAYER.TOP || value === LAYER.BOTTOM || isInnerLayer(value);
}

/**
 * 是否导电层（铜层 + MULTI 多层）
 *
 * 用于「哪些图元参与电气连通」这类判断。
 *
 * @param {number|string} layer 层号
 * @returns {boolean}
 * @sideEffects 无（纯函数）
 */
export function isConductiveLayer(layer) {
	const value = Number(layer);
	return isCopperLayer(value) || value === LAYER.MULTI;
}

/**
 * 层号 → 中文短名（仅用于界面展示，不参与任何判定）
 *
 * 只收录「画布上真正会放图元、且用户叫得出名字」的层；内层与自定义层按区间批量生成。
 * 这张表是**展示文本**，与 `src/js/common/pcbConstants.js` 的数值层表不必同步
 * （后端不渲染层名，改了也不会漂移）。
 *
 * @type {Readonly<Record<number, string>>}
 */
export const LAYER_LABEL = (() => {
	const label = {
		1: '顶层',
		2: '底层',
		3: '顶层丝印',
		4: '底层丝印',
		5: '顶层阻焊',
		6: '底层阻焊',
		7: '顶层锡膏',
		8: '底层锡膏',
		9: '顶层装配',
		10: '底层装配',
		11: '板框',
		12: '多层',
		13: '文档',
		14: '机械',
		47: '孔层',
		48: '元件外形',
		49: '元件标识',
		50: '引脚焊接',
		51: '引脚悬空',
		52: '元件模型',
		53: '3D 外壳边框',
		54: '3D 外壳顶层',
		55: '3D 外壳底层',
		56: '钻孔图',
		57: '飞线',
		58: '顶层补强',
		59: '底层补强',
	};
	// 内层 15~46：官方表只到 30，实测存在 31/32；按区间生成避免漏项
	for (let id = 15; id <= 46; id++) label[id] = `内层 ${id - 14}`;
	// 自定义层 71~100
	for (let id = 71; id <= 100; id++) label[id] = `自定义 ${id - 70}`;
	return Object.freeze(label);
})();

/**
 * 取层的显示名
 *
 * 取值顺序：内置中文名 → 调用方给的字典（通常是 `pcb_Layer.getAllLayers()` 的
 * `id → name`，用于自定义层或未来的新层号）→ `层 N`。
 *
 * @param {number|string} layer 层号
 * @param {Record<number, string>} [names] 兜底字典（可选）
 * @returns {string} 显示名
 * @sideEffects 无（纯函数）
 */
export function layerLabel(layer, names) {
	const id = Number(layer);
	if (!Number.isFinite(id)) return '未知层';
	if (LAYER_LABEL[id]) return LAYER_LABEL[id];
	if (names && typeof names === 'object' && names[id]) return String(names[id]);
	return `层 ${id}`;
}
