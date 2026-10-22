/**
 * @//module/ app/pcb-to-sch/layout
 * @//description/ 原理图自动排布：按部件包围盒逐行摆放，超出右边界换行（纯函数）
 * @//exports/ splitParts, bboxOfPart, planCoordLayout, planFlowLayout, layoutGroup, RIGHT_LIMIT, PART_GAP, ROW_GAP, GROUP_GAP, PART_COORD_STEP
 * @//dependencies/ app/pcb-to-sch/symbolParser
 * @//example/ const { layoutGroup } = await import('./layout.js')
 *            const plan = layoutGroup(group, { classify: 'ref', startX: 200, startTopY: -200 }, symbolDb)
 *            plan.parts.forEach((p) => emit(p.comp, p.x, p.y))
 *
 * ⚠️ 这段算法原来是 **V2 分支与 V3/V4 分支各写一遍、近 90 行几乎逐字相同**，
 * 只有「写哪一版源码行」不同。合并到这里以后，两个格式共用同一份坐标计算，
 * 就不会再出现「改了 V2 忘了改 V4」。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { DEFAULT_BBOX } from './symbolParser.js';

/** 原理图右边界（超出就换行），mil */
export const RIGHT_LIMIT = 2560;

/** 同一行相邻部件的间距，mil */
export const PART_GAP = 40;

/** 换行时上下两行的间距，mil */
export const ROW_GAP = 40;

/** 两个分组之间的竖向间距，mil */
export const GROUP_GAP = 200;

/** 坐标布局时同一器件多部件的竖向偏移，mil */
export const PART_COORD_STEP = 10;

/**
 * 把一个分组的器件展开成「器件 × 部件」列表
 *
 * @param {Array<object>} items 分组内的器件
 * @returns {Array<{comp: object, partIdx: number}>} 部件列表
 * @sideEffects 无（纯函数）
 */
export function splitParts(items) {
	const list = [];
	for (const comp of items) {
		const partCount = comp.partCount || 1;
		for (let partIdx = 0; partIdx < partCount; partIdx++) list.push({ comp: comp, partIdx: partIdx });
	}
	return list;
}

/**
 * 取某个部件的引脚包围盒
 *
 * @param {object} comp 器件
 * @param {number} partIdx 部件序号
 * @param {Record<string, Array<object>>} symbolDb 符号引脚库
 * @returns {number[]} `[xmin, ymin, xmax, ymax]`
 * @sideEffects 无（纯函数）
 */
export function bboxOfPart(comp, partIdx, symbolDb) {
	const parts = comp.symbolUuid ? symbolDb[comp.symbolUuid] : null;
	const part = parts && parts[partIdx];
	return (part && part.pinBbox) || DEFAULT_BBOX.slice();
}

/**
 * 包围盒的初始值（求 min/max 用）
 *
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}} 空包围盒
 * @sideEffects 无（纯函数）
 */
function emptyBounds() {
	return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
}

/**
 * 坐标布局：直接用 PCB 上的坐标（多部件竖向错开 `PART_COORD_STEP`）
 *
 * @param {Array<object>} items 分组内器件
 * @param {object} [options] 选项
 * @param {number} [options.step=PART_COORD_STEP] 多部件竖向偏移
 * @returns {{parts: Array<object>, bounds: object}} 布局结果
 * @sideEffects 无（纯函数，不改 `comp.y`）
 */
export function planCoordLayout(items, options = {}) {
	const step = options.step === undefined ? PART_COORD_STEP : options.step;
	const parts = [];
	const bounds = emptyBounds();

	for (const item of splitParts(items)) {
		const comp = item.comp;
		// 注意：原 V3/V4 分支写的是 `comp.y = comp.y + 10`（**改入参**），
		// 每多一个部件就再累加 10，反复构建会让器件一路往上漂。这里改为按部件序号偏移，使用原值。
		const y = comp.y + step * item.partIdx;
		parts.push({ comp: comp, partIdx: item.partIdx, x: comp.x, y: y });

		bounds.minX = Math.min(bounds.minX, comp.x);
		bounds.maxX = Math.max(bounds.maxX, comp.x);
		bounds.minY = Math.min(bounds.minY, comp.y);
		bounds.maxY = Math.max(bounds.maxY, comp.y);
	}

	return { parts: parts, bounds: bounds, nextTopY: bounds.minY - GROUP_GAP };
}

/**
 * 流式布局：从左到右摆放，超出右边界换行，超出组底部再下移
 *
 * @param {Array<object>} items 分组内器件
 * @param {object} options 选项
 * @param {number} options.startX 行首 X
 * @param {number} options.startTopY 本组顶部 Y
 * @param {Record<string, Array<object>>} options.symbolDb 符号引脚库
 * @param {number} [options.rightLimit=RIGHT_LIMIT] 右边界
 * @param {number} [options.partGap=PART_GAP] 同行部件间距
 * @param {number} [options.rowGap=ROW_GAP] 行间距
 * @returns {{parts: Array<object>, bounds: object, nextTopY: number}} 布局结果
 * @sideEffects 无（纯函数）
 */
export function planFlowLayout(items, options) {
	const startX = Number(options.startX);
	const rightLimit = options.rightLimit === undefined ? RIGHT_LIMIT : options.rightLimit;
	const partGap = options.partGap === undefined ? PART_GAP : options.partGap;
	const rowGap = options.rowGap === undefined ? ROW_GAP : options.rowGap;

	const parts = [];
	const bounds = emptyBounds();

	let currentTopY = Number(options.startTopY);
	let lastRight = null;
	let minYThisRow = currentTopY;

	for (const item of splitParts(items)) {
		const bbox = bboxOfPart(item.comp, item.partIdx, options.symbolDb);
		const xmin = bbox[0];
		const ymin = bbox[1];
		const xmax = bbox[2];
		const ymax = bbox[3];

		let compX = lastRight === null ? startX - xmin : lastRight + partGap - xmin;
		const right = compX + xmax;

		if (right > rightLimit) {
			// 换行：本组顶部下移到上一行最下边缘之下
			currentTopY = minYThisRow - rowGap;
			compX = startX - xmin;
			lastRight = compX + xmax;
			minYThisRow = currentTopY;
		} else {
			lastRight = right;
		}

		const compY = currentTopY - ymax;
		minYThisRow = Math.min(minYThisRow, compY + ymin);

		parts.push({ comp: item.comp, partIdx: item.partIdx, x: compX, y: compY });

		bounds.minX = Math.min(bounds.minX, compX + xmin);
		bounds.maxX = Math.max(bounds.maxX, compX + xmax);
		bounds.minY = Math.min(bounds.minY, compY + ymin);
		bounds.maxY = Math.max(bounds.maxY, compY + ymax);
	}

	return { parts: parts, bounds: bounds, nextTopY: bounds.minY - GROUP_GAP };
}

/**
 * 按分类方式与当前顶部位置排布一个分组
 *
 * @param {Array<object>} items 分组内器件
 * @param {object} options 选项
 * @param {string} options.classify 分类方式（`coord` 用原坐标，其余走流式布局）
 * @param {number} options.startX 行首 X
 * @param {number} options.startTopY 本组顶部 Y
 * @param {Record<string, Array<object>>} options.symbolDb 符号引脚库
 * @returns {{parts: Array<object>, bounds: object, nextTopY: number}} 布局结果
 * @sideEffects 无（纯函数）
 */
export function layoutGroup(items, options) {
	if (options.classify === 'coord') return planCoordLayout(items);
	return planFlowLayout(items, options);
}
