/**
 * @//module/ app/generate-net/sourceParser
 * @//description/ 把 PCB 源码解析成统一图元（V2 数组格式 / V3V4 日志格式两套）
 * @//exports/ parseV2Primitives, parseV3Primitives
 * @//dependencies/ core/layer, core/log, app/generate-net/geometry
 * @//example/ const { parseV3Primitives } = await import('./sourceParser.js')
 *            const ctx = { allUsedNetNames: new Set(), padIdToPinInfo: {} }
 *            const { primitives, innerLayerIds } = parseV3Primitives(lines, ctx)
 *
 * 两个解析器的产出必须**完全同构**（同样的 primitives / innerLayerIds / padIdToPinInfo 形状），
 * 因为后面的连通分析与定名不区分版本。加新图元类型时两边都要加。
 */

import { isInnerLayer } from '../../core/layer.js';
import { logger } from '../../core/log.js';
import { LAYER_MULTI, expandArcLines, getPolyVertices, getRotatedRectVertices } from './geometry.js';

/**
 * 从路径数据里解析出顶点与包围盒
 *
 * 支持两种写法：
 *   - 矩形 `["R", x, y, w, h, rot, radius]`
 *   - 顶点表（可能多层嵌套，如 `[[x,y], ...]` 或 `["L", x, y, ...]`）
 *
 * @param {Array} shapeData 路径数据
 * @returns {{vertices: Array<{x: number, y: number}>, bounds: object}|null} 解析结果；无法解析返回 null
 * @sideEffects 无（纯函数）
 */
function polyFromShape(shapeData) {
	let data = shapeData;
	// 深挖嵌套：`[[...]]` 这种多包一层的情况在真实工程里很常见
	let safeCounter = 0;
	while (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
		if (data[0][0] === 'R' || typeof data[0][0] === 'number') break;
		data = data[0];
		if (++safeCounter > 5) break;
	}

	if (!Array.isArray(data) || data.length === 0) return null;

	let rectData = null;
	if (Array.isArray(data[0]) && data[0][0] === 'R') rectData = data[0];
	else if (data[0] === 'R') rectData = data;

	let vertices = [];
	if (rectData) {
		const rx = Number(rectData[1]);
		const ry = Number(rectData[2]);
		const rw = Number(rectData[3]);
		const rh = Number(rectData[4]);
		const rot = Number(rectData[5] || 0);
		const radius = Number(rectData[6] || 0);
		vertices = getRotatedRectVertices(rx, ry, rw, rh, rot, radius);
	} else {
		vertices = getPolyVertices(data);
		if (vertices.length <= 2) return null;
	}

	if (vertices.length === 0) return null;

	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const v of vertices) {
		if (v.x < minX) minX = v.x;
		if (v.x > maxX) maxX = v.x;
		if (v.y < minY) minY = v.y;
		if (v.y > maxY) maxY = v.y;
	}

	return {
		vertices: vertices,
		bounds: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY },
	};
}

/**
 * 解析 V2 数组格式源码
 *
 * @param {string[]} lines 按行切分的源码
 * @param {{allUsedNetNames: Set<string>, padIdToPinInfo: Record<string, object>}} ctx 收集器（会被修改）
 * @returns {{primitives: Array<object>, innerLayerIds: number[]}} 解析结果
 * @sideEffects **就地修改** `ctx.allUsedNetNames` 与 `ctx.padIdToPinInfo`
 */
export function parseV2Primitives(lines, ctx) {
	const primitives = [];
	const innerLayerIds = [];

	for (const line of lines) {
		if (!line.trim() || !line.startsWith('[')) continue;
		let item;
		try {
			item = JSON.parse(line.replace(/^\s*/, ''));
		} catch {
			logger.debug('跳过无法解析的源码行');
			continue;
		}

		const type = item[0];
		if (item[3] && typeof item[3] === 'string' && item[3] !== '') ctx.allUsedNetNames.add(item[3]);

		if (type === 'LAYER') {
			if (isInnerLayer(Number(item[1])) && Number(item[4]) === 3) innerLayerIds.push(Number(item[1]));
		} else if (type === 'LINE') {
			primitives.push({
				id: item[1],
				type: 'LINE',
				net: item[3],
				layer: item[4],
				shape: 'line',
				x1: Number(item[5]),
				y1: Number(item[6]),
				x2: Number(item[7]),
				y2: Number(item[8]),
				w: Number(item[9]),
			});
		} else if (type === 'VIA') {
			const dia = Number(item[8]);
			primitives.push({
				id: item[1],
				type: 'VIA',
				net: item[3],
				layer: LAYER_MULTI,
				_rawRange: item[4],
				shape: 'ROUND',
				x: Number(item[5]),
				y: Number(item[6]),
				w: dia,
				h: dia,
				r: dia / 2,
			});
		} else if (type === 'ARC') {
			primitives.push(
				...expandArcLines({
					id: item[1],
					net: item[3],
					layer: item[4],
					x1: Number(item[5]),
					y1: Number(item[6]),
					x2: Number(item[7]),
					y2: Number(item[8]),
					angle: Number(item[9]),
					w: Number(item[10]) || 0.15,
				})
			);
		} else if (type === 'FILL' || type === 'POLY') {
			// 多层（12）的 FILL 是焊盘/过孔内部的填充，不参与连通
			if (type === 'FILL' && item[4] === LAYER_MULTI) continue;
			const poly = polyFromShape(item[7]);
			if (poly) {
				primitives.push({
					id: item[1],
					type: type,
					net: item[3],
					layer: item[4],
					shape: 'POLY',
					vertices: poly.vertices,
					...poly.bounds,
				});
			}
		} else if (type === 'PAD_NET') {
			ctx.padIdToPinInfo[item[1] + item[4]] = { compId: item[1], pin: item[2] };
		}
	}

	return { primitives: primitives, innerLayerIds: innerLayerIds };
}

/**
 * 解析一行 V3/V4 日志格式源码（`{a}||{b}|` 可能含多个对象）
 *
 * @param {string} line 单行
 * @returns {object|null} 合并后的对象；无有效对象返回 null
 * @sideEffects 无（纯函数）
 */
function parseV3LineObjects(line) {
	if (!line.trim()) return null;
	let cleanLine = line.trim();
	if (cleanLine.endsWith('|')) cleanLine = cleanLine.slice(0, -1);

	const merged = {};
	let found = false;
	for (const part of cleanLine.split('||')) {
		if (!part.trim()) continue;
		try {
			Object.assign(merged, JSON.parse(part));
			found = true;
		} catch {
			logger.debug('跳过格式异常的源码行');
		}
	}
	return found ? merged : null;
}

/**
 * 取该行声明的网络名（PAD_NET 用 `padNet`，其余用 `netName`）
 *
 * @param {object} item 合并后的对象
 * @returns {string} 网络名；没有则空串
 * @sideEffects 无（纯函数）
 */
function netNameOf(item) {
	if (item.type === 'PAD_NET' && item.padNet) return item.padNet;
	return item.netName || '';
}

/** LAYER 行：记录实际使用的内层 */
function onLayer(item, state) {
	if (isInnerLayer(item.layerId) && item.use === true && !state.innerLayerIds.includes(item.layerId)) {
		state.innerLayerIds.push(item.layerId);
	}
}

/** ATTR 行：位号 → 器件 id */
function onAttr(item, state) {
	if (item.key === 'Designator' && item.value && item.parentId) {
		state.compIdToDesignator[item.parentId] = item.value;
	}
}

/** COMPONENT 行：也带位号（不同版本写法不同） */
function onComponent(item, state) {
	if (item.id && item.designator) state.compIdToDesignator[item.id] = item.designator;
}

/**
 * PAD_NET 行：`id` 里藏着 `[?, compId, pin, padSuffix]`
 *
 * 同时按「compId+padSuffix」和「padSuffix」两种键登记，因为后面匹配焊盘 id 时
 * 两个版本的 id 形态不一致（有的带前缀、有的不带）。
 */
function onPadNet(item, state) {
	const idRaw = item.id;
	if (typeof idRaw !== 'string' || !idRaw.startsWith('[')) return;
	let idParts;
	try {
		idParts = JSON.parse(idRaw);
	} catch {
		logger.debug('跳过格式异常的源码行');
		return;
	}
	if (!Array.isArray(idParts) || idParts.length < 4) return;

	const pinInfo = { compId: idParts[1], pin: idParts[2] };
	const padSuffix = idParts[3];
	state.padIdToPinInfo[idParts[1] + padSuffix] = pinInfo;
	state.padIdToPinInfo[padSuffix] = pinInfo;
}

/** LINE 行 */
function onLine(item, state) {
	state.primitives.push({
		id: item.id,
		ticket: item.ticket,
		type: 'LINE',
		net: item.netName,
		layer: item.layerId,
		shape: 'line',
		x1: item.startX,
		y1: item.startY,
		x2: item.endX,
		y2: item.endY,
		w: item.width,
	});
}

/** VIA 行 */
function onVia(item, state) {
	state.primitives.push({
		id: item.id,
		ticket: item.ticket,
		type: 'VIA',
		net: item.netName,
		layer: LAYER_MULTI,
		_rawRange: item.ruleName,
		shape: 'ROUND',
		x: item.centerX,
		y: item.centerY,
		w: item.viaDiameter,
		h: item.viaDiameter,
		r: item.viaDiameter / 2,
	});
}

/** ARC 行：拆成折线 */
function onArc(item, state) {
	state.primitives.push(
		...expandArcLines({
			id: item.id,
			net: item.netName,
			layer: item.layerId,
			x1: item.startX,
			y1: item.startY,
			x2: item.endX,
			y2: item.endY,
			angle: item.angle,
			w: item.width,
		})
	);
}

/**
 * FILL / COPPER_AREA 行：转多边形
 *
 * REGION（板框）与 POLY 整类跳过 —— 它们不是铜箔，混进来会把板框当成网络。
 */
function onFill(item, state, netName) {
	if (item.type === 'REGION' || item.type === 'POLY') return;
	if (item.type === 'FILL' && item.layerId === LAYER_MULTI) return;

	let shapeData = null;
	if (item.path) shapeData = item.path;
	else if (item.points) shapeData = item.points;
	else if (item.width && item.height && item.x !== undefined) {
		shapeData = ['R', item.x, item.y, item.width, item.height, item.rotation || 0, item.cornerRadius || 0];
	}

	const poly = polyFromShape(shapeData);
	if (!poly) return;

	state.primitives.push({
		id: item.id,
		ticket: item.ticket,
		type: 'POLY',
		net: netName,
		layer: item.layerId,
		shape: 'POLY',
		vertices: poly.vertices,
		...poly.bounds,
	});
}

/** 类型 → 处理函数（新增图元类型只需在这里加一行） */
const V3_HANDLERS = Object.freeze({
	ATTR: onAttr,
	COMPONENT: onComponent,
	PAD_NET: onPadNet,
	LINE: onLine,
	VIA: onVia,
	ARC: onArc,
	FILL: onFill,
	REGION: onFill,
	POLY: onFill,
	COPPER_AREA: onFill,
});

/**
 * 解析 V3/V4 日志格式源码
 *
 * @param {string[]} lines 按行切分的源码
 * @param {{allUsedNetNames: Set<string>, padIdToPinInfo: Record<string, object>}} ctx 收集器（会被修改）
 * @returns {{primitives: Array<object>, innerLayerIds: number[], compIdToDesignator: object}} 解析结果
 * @sideEffects **就地修改** `ctx.allUsedNetNames` 与 `ctx.padIdToPinInfo`
 */
export function parseV3Primitives(lines, ctx) {
	const state = {
		primitives: [],
		innerLayerIds: [],
		compIdToDesignator: {},
		padSuffixToTicket: {},
		allUsedNetNames: ctx.allUsedNetNames,
		padIdToPinInfo: ctx.padIdToPinInfo,
	};

	for (const line of lines) {
		const item = parseV3LineObjects(line);
		if (!item || item.type === 'IMAGE') continue;

		if (item.type === 'LAYER') {
			onLayer(item, state);
			continue;
		}

		const netName = netNameOf(item);
		if (netName) ctx.allUsedNetNames.add(netName);

		const handler = V3_HANDLERS[item.type];
		if (handler) handler(item, state, netName);
	}

	// 把位号回填进引脚信息（分析定名时需要「位号.引脚」）
	for (const padId in ctx.padIdToPinInfo) {
		const info = ctx.padIdToPinInfo[padId];
		info.des = state.compIdToDesignator[info.compId] || null;
	}

	return {
		primitives: state.primitives,
		innerLayerIds: state.innerLayerIds,
		compIdToDesignator: state.compIdToDesignator,
	};
}
