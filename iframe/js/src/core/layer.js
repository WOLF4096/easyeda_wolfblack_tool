/**
 * @//module/ core/layer
 * @//description/ PCB 图层常量与铜层/内层判定（官方层表的唯一前端来源）
 * @//exports/ LAYER, isInnerLayer, isCopperLayer, isConductiveLayer
 * @//dependencies/ 无
 * @//example/ const { LAYER, isConductiveLayer } = await import('./core/layer.js')
 *            isConductiveLayer(prim.layer) // true 表示该图元参与电气连通
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
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
