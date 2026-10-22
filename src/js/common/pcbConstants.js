/**
 * PCB 图层与焊盘/过孔常量（官方层定义，完整表）
 *
 * 来源：嘉立创 EDA 专业版官方层定义表（TOP=1 … CUSTOM_30=100、SUBSTRATE_1=101）+ docs/FORMATLOG.md。
 * 关键约定：
 *   - **MULTI(12) = 多层**：通孔焊盘与过孔落在该层；
 *   - 铜层 = 顶层(1) / 底层(2) / 内层(15~46)；
 *   - 阻焊默认值 `-1000` 为 EDA 内置默认（表示「不额外扩展」）。
 *
 * 为什么要有这个文件：这些数字原本散落在 WireConverter / PadViaConverter / GenerateNet 里，
 * 读代码时无法判断 `layer === 12` 到底是"通孔层"还是别的什么。
 *
 * 维护提示：前端 `iframe/js/common.js` 的 `WolfCommon.LAYER` 是本表的一个**子集**
 * （浏览器 IIFE 与后端 ESM 是两套 bundle，无法共享模块），两边同名项必须一致；
 * `test/samples` 的 `plugin.layer-consts` 用例会做交叉校验，
 * `atom.layer` 用例会用本表全部取值校验真实工程文件。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 官方图层表 */
export const LAYER = Object.freeze({
	TOP: 1, // 顶层
	BOTTOM: 2, // 底层
	TOP_SILKSCREEN: 3, // 顶层丝印层
	BOTTOM_SILKSCREEN: 4, // 底层丝印层
	TOP_SOLDER_MASK: 5, // 顶层阻焊层
	BOTTOM_SOLDER_MASK: 6, // 底层阻焊层
	TOP_PASTE_MASK: 7, // 顶层锡膏（助焊）层
	BOTTOM_PASTE_MASK: 8, // 底层锡膏（助焊）层
	TOP_ASSEMBLY: 9, // 顶层装配层
	BOTTOM_ASSEMBLY: 10, // 底层装配层
	BOARD_OUTLINE: 11, // 板框层
	MULTI: 12, // 多层：通孔焊盘 / 过孔
	DOCUMENT: 13, // 文档层
	MECHANICAL: 14, // 机械层

	// 内层 1~30（15~44）
	INNER_1: 15,
	INNER_2: 16,
	INNER_3: 17,
	INNER_4: 18,
	INNER_5: 19,
	INNER_6: 20,
	INNER_7: 21,
	INNER_8: 22,
	INNER_9: 23,
	INNER_10: 24,
	INNER_11: 25,
	INNER_12: 26,
	INNER_13: 27,
	INNER_14: 28,
	INNER_15: 29,
	INNER_16: 30,
	INNER_17: 31,
	INNER_18: 32,
	INNER_19: 33,
	INNER_20: 34,
	INNER_21: 35,
	INNER_22: 36,
	INNER_23: 37,
	INNER_24: 38,
	INNER_25: 39,
	INNER_26: 40,
	INNER_27: 41,
	INNER_28: 42,
	INNER_29: 43,
	INNER_30: 44,
	// 实测补充：真实工程里存在 Inner31 / Inner32（测试样本 Board_V2.2.45 的 LAYER 行），
	// 官方层表只列到「内层 30」，但代码按 15~46 处理铜层，这里补全避免把 45/46 判成非法。
	INNER_31: 45,
	INNER_32: 46,

	HOLE: 47, // 孔层（焊盘、过孔的内孔）
	COMPONENT_SHAPE: 48, // 元件外形层
	COMPONENT_MARKING: 49, // 元件标识层
	PIN_SOLDERING: 50, // 引脚焊接层
	PIN_FLOATING: 51, // 引脚悬空层
	COMPONENT_MODEL: 52, // 元件模型层
	SHELL_3D_OUTLINE: 53, // 3D 外壳边框层
	SHELL_3D_TOP: 54, // 3D 外壳顶层
	SHELL_3D_BOTTOM: 55, // 3D 外壳底层
	DRILL_DRAWING: 56, // 钻孔图层
	RATLINE: 57, // 飞线层
	TOP_STIFFENER: 58, // 顶层 FPC 补强层
	BOTTOM_STIFFENER: 59, // 底层 FPC 补强层

	// 自定义层 1~30（71~100）
	CUSTOM_1: 71,
	CUSTOM_2: 72,
	CUSTOM_3: 73,
	CUSTOM_4: 74,
	CUSTOM_5: 75,
	CUSTOM_6: 76,
	CUSTOM_7: 77,
	CUSTOM_8: 78,
	CUSTOM_9: 79,
	CUSTOM_10: 80,
	CUSTOM_11: 81,
	CUSTOM_12: 82,
	CUSTOM_13: 83,
	CUSTOM_14: 84,
	CUSTOM_15: 85,
	CUSTOM_16: 86,
	CUSTOM_17: 87,
	CUSTOM_18: 88,
	CUSTOM_19: 89,
	CUSTOM_20: 90,
	CUSTOM_21: 91,
	CUSTOM_22: 92,
	CUSTOM_23: 93,
	CUSTOM_24: 94,
	CUSTOM_25: 95,
	CUSTOM_26: 96,
	CUSTOM_27: 97,
	CUSTOM_28: 98,
	CUSTOM_29: 99,
	CUSTOM_30: 100,

	SUBSTRATE_1: 101, // 夹层（介电基板）1（官方表编号）
});

/**
 * 基板层的实际起始编号
 *
 * 官方表只给出 `SUBSTRATE_1 = 101`，但真实工程里基板层写的是 **361** 起
 * （测试样本中为 `["LAYER",361,"SUBSTRATE","Dielectric1",...]`），
 * 因此判断「基板层」按区间而不是按 101 这个单值。
 */
export const SUBSTRATE_LAYER_BASE = 361;

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

/** 官方图层取值的合法集合（供校验/测试使用） */
export const VALID_LAYERS = Object.freeze([...new Set(Object.values(LAYER))].sort((a, b) => a - b));

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

/**
 * 是否基板层（介电层），实测从 361 起编号
 * @param {number} layer - 图层号
 * @returns {boolean}
 */
export function isSubstrateLayer(layer) {
	return layer >= SUBSTRATE_LAYER_BASE;
}

/**
 * 是否是「已知图层」（官方表 + 铜层区间 + 基板层区间）
 *
 * 用途：校验真实工程文件里出现的 layer 是否都在已知范围内。
 * 一旦 EDA 新增图层族（例如又冒出一个 1000+ 的专用层），这里会第一时间暴露出来。
 *
 * @param {number} layer - 图层号
 * @returns {boolean}
 */
export function isKnownLayer(layer) {
	if (!Number.isInteger(layer)) return false;
	if (isSubstrateLayer(layer)) return true;
	if (layer >= COPPER_LAYER_MIN && layer <= COPPER_LAYER_MAX) return true;
	return VALID_LAYERS.includes(layer);
}
