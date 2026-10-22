/**
 * @//module/ app/generate-net/connectivity
 * @//description/ 空间网格 + 并查集求铜箔连通分量，并把焊盘与引脚信息关联上（纯计算）
 * @//exports/ applyBlindLayers, computeClusters
 * @//dependencies/ core/layer, core/unionFind, app/generate-net/geometry
 * @//example/ const { computeClusters } = await import('./connectivity.js')
 *            const clusters = computeClusters(primitives, allPads, innerLayerIds, padIdToPinInfo)
 *            Object.values(clusters) // 每个连通分量里的图元
 *
 * 复杂度要点：图元两两比对是 O(n²)，先用 150mil 的网格把候选对压到「同格或邻格」，
 * 再用 `processedPairs` 去重，否则 5000 个图元会有 1200 万次几何判定。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { isConductiveLayer } from '../../core/layer.js';
import { UnionFind } from '../../core/unionFind.js';
import { GRID_SIZE, addToGrid, checkConnectivityHighPrecision, getRealLayerIdsFromRange, getStackIds } from './geometry.js';

/**
 * 给盲埋孔过孔补上真实跨越的层 id
 *
 * @param {Array<object>} primitives 图元（VIA 会被就地修改）
 * @param {number[]} innerLayerIds 内层 id
 * @returns {void}
 * @sideEffects **就地修改** `primitives` 里 VIA 的 `blindLayers`
 */
export function applyBlindLayers(primitives, innerLayerIds) {
	const stackIds = getStackIds(innerLayerIds);
	for (const p of primitives) {
		if (p.type === 'VIA' && p._rawRange) p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
	}
}

/**
 * 把网格里相邻的图元合并成连通分量
 *
 * @param {Array<object>} copperPrimitives 导电层图元（含焊盘）
 * @returns {Record<string, Array<object>>} 根 id → 该分量的图元
 * @sideEffects 无（纯函数，内部结构全部新建）
 */
function clusterByGrid(copperPrimitives) {
	const uf = new UnionFind();
	const grid = {};
	for (const p of copperPrimitives) addToGrid(p, GRID_SIZE, grid);

	const processedPairs = new Set();
	for (const key in grid) {
		const cellItems = grid[key];
		if (cellItems.length < 2) continue;
		linkCellPairs(cellItems, uf, processedPairs);
	}

	const clusters = {};
	for (const p of copperPrimitives) {
		const root = uf.find(p.id);
		if (!clusters[root]) clusters[root] = [];
		clusters[root].push(p);
	}
	return clusters;
}

/**
 * 同一格内的图元两两判定并合并
 *
 * @param {Array<object>} cellItems 该格的图元
 * @param {UnionFind} uf 并查集（就地修改）
 * @param {Set<string>} processedPairs 已判定过的图元对（就地修改）
 * @returns {void}
 * @sideEffects **就地修改** `uf` 与 `processedPairs`
 */
function linkCellPairs(cellItems, uf, processedPairs) {
	for (let i = 0; i < cellItems.length; i++) {
		for (let j = i + 1; j < cellItems.length; j++) {
			const a = cellItems[i];
			const b = cellItems[j];
			const pairId = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
			if (processedPairs.has(pairId)) continue;
			processedPairs.add(pairId);
			if (checkConnectivityHighPrecision(a, b)) uf.union(a.id, b.id);
		}
	}
}

/**
 * 给焊盘补上「位号 + 引脚号」
 *
 * 焊盘 id 与 PAD_NET 里的键不一定完全相等（前者可能带前缀），
 * 所以先精确查，查不到再用「后缀匹配」兜底。
 *
 * @param {Array<object>} group 一个连通分量的图元
 * @param {Record<string, object>} padIdToPinInfo 焊盘 id → 引脚信息
 * @returns {void}
 * @sideEffects **就地修改** PAD 图元的 `_pinInfo`
 */
function attachPinInfo(group, padIdToPinInfo) {
	for (const item of group) {
		if (item.type !== 'PAD') continue;

		const pinInfo = padIdToPinInfo[item.id] || findPinInfoBySuffix(String(item.id), padIdToPinInfo);
		if (pinInfo) item._pinInfo = pinInfo;
	}
}

/**
 * 后缀兜底查找：焊盘 id 可能带前缀，用「以查找键结尾」匹配
 *
 * 返回第一个命中的键（`for...in` 顺序与原实现一致，别改成先收集再挑）。
 *
 * @param {string} idText 焊盘 id 文本
 * @param {Record<string, object>} padIdToPinInfo 焊盘 id → 引脚信息
 * @returns {object|null} 引脚信息；没命中返回 null
 * @sideEffects 无（纯函数）
 */
function findPinInfoBySuffix(idText, padIdToPinInfo) {
	for (const key in padIdToPinInfo) {
		if (idText.endsWith(key)) return padIdToPinInfo[key];
	}
	return null;
}

/**
 * 计算连通分量
 *
 * @param {Array<object>} primitives 源码解析出的图元（会被就地补 `blindLayers`）
 * @param {Array<object>} allPads 焊盘图元
 * @param {number[]} innerLayerIds 内层 id
 * @param {Record<string, object>} padIdToPinInfo 焊盘 id → 引脚信息
 * @returns {Record<string, Array<object>>} 根 id → 分量图元
 * @sideEffects **就地修改** `primitives` 的 VIA，以及分量内 PAD 的 `_pinInfo`
 */
export function computeClusters(primitives, allPads, innerLayerIds, padIdToPinInfo) {
	applyBlindLayers(primitives, innerLayerIds);

	const allPrimitives = primitives.concat(allPads);
	const copperPrimitives = allPrimitives.filter((p) => isConductiveLayer(Number(p.layer)));

	const clusters = clusterByGrid(copperPrimitives);
	for (const rootId in clusters) attachPinInfo(clusters[rootId], padIdToPinInfo);

	return clusters;
}
