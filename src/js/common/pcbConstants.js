/**
 * PCB 图层与焊盘/过孔常量（官方定义）
 *
 * 来源：
 * 1. 嘉立创 EDA 专业版官方层定义表（TOP=1 … CUSTOM_30=100、SUBSTRATE_1=101）；
 * 2. 官方约定：**MULTI(12) = 多层**，通孔焊盘与过孔就落在该层；
 * 3. 官方约定：铜层 = 顶层(1) / 底层(2) / 内层(15~46)；
 * 4. 阻焊默认值 `-1000` 为 EDA 内置默认（表示「不额外扩展」）。
 *
 * 为什么要有这个文件：这些数字原本散落在 WireConverter / PadViaConverter 里，
 * 读代码时无法判断 `layer === 12` 到底是"通孔层"还是别的什么。
 *
 * 注意：前端 `iframe/js/common.js` 里有一份同义常量（浏览器 IIFE 与后端 ESM
 * 是两套 bundle，无法直接共享模块），改动时两边要一起改。
 */

/** 常用图层（完整表见 docs/FORMATLOG.md 与官方层定义） */
export const LAYER = Object.freeze({
	TOP: 1, // 顶层
	BOTTOM: 2, // 底层
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
	INNER_1: 15, // 内层 1（首个内层）
	INNER_30: 44, // 内层 30（官方表最后一个内层）
	HOLE: 47, // 孔层（焊盘、过孔的内孔）
	COMPONENT_SHAPE: 48,
	COMPONENT_MARKING: 49,
	DRILL_DRAWING: 56,
	RATLINE: 57,
	CUSTOM_1: 71,
	CUSTOM_30: 100,
	SUBSTRATE_1: 101,
});

/**
 * 铜层区间
 *
 * 官方口径为 `15~46`（官方层表把 15~44 定义为内层 1~30，45~46 为保留区间）。
 * 这里沿用 15~46 与既有行为一致，避免把保留区间的图元判成非铜层。
 */
export const COPPER_LAYER_MIN = 15;
export const COPPER_LAYER_MAX = 46;

/** 阻焊 / 锡膏默认扩展值（EDA 内置默认） */
export const MASK_DEFAULT_EXPANSION = -1000;

/**
 * 是否铜层（顶层 / 底层 / 内层）
 * @param {number} layer - 图层号
 * @returns {boolean}
 */
export function isCopperLayer(layer) {
	return layer === LAYER.TOP || layer === LAYER.BOTTOM || (layer >= COPPER_LAYER_MIN && layer <= COPPER_LAYER_MAX);
}

/**
 * 是否内层（不含顶层/底层）
 * @param {number} layer - 图层号
 * @returns {boolean}
 */
export function isInnerLayer(layer) {
	return layer >= COPPER_LAYER_MIN && layer <= COPPER_LAYER_MAX;
}

/**
 * 是否通孔层（MULTI）—— 通孔焊盘与过孔所在的层
 * @param {number} layer - 图层号
 * @returns {boolean}
 */
export function isThroughHoleLayer(layer) {
	return layer === LAYER.MULTI;
}
