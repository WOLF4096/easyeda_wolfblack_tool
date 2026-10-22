/**
 * @//module/ app/generate-net/geometry
 * @//description/ 铜箔图元的几何判定：线段/矩形/多边形/圆/圆弧之间的相接判断 + 空间网格
 * @//exports/ LAYER_MULTI, GRID_SIZE, distToSegmentSquared, isTwoLinesTouching, segmentsIntersect, isLineIntersectRect, isPointInRect, getPolyVertices, lineIntersect, isPointInPoly, getRotatedRectVertices, expandArcLines, getEdges, areLayersConnected, checkConnectivityHighPrecision, getStackIds, getRealLayerIdsFromRange, addToGrid
 * @//dependencies/ core/layer
 * @//example/ const { checkConnectivityHighPrecision } = await import('./geometry.js')
 *            if (checkConnectivityHighPrecision(lineA, lineB)) uf.union(lineA.id, lineB.id)
 *
 * 这是整个项目唯一的算法资产：全部纯函数、零 DOM、零 eda，改这里必须靠单测兜住。
 * 两个「不能简化」的地方（注释已写在对应函数里）：
 *   1. ROUND 用内接正十二边形而不是包围盒四边 —— 否则对角方向会误判相接；
 *   2. ARC 先拆成折线再判 —— 只取弦会差一个矢高（90° 弧约 0.29r）。
 */

import { LAYER } from '../../core/layer.js';

/** 多层（通孔焊盘 / 过孔落在这一层） */
export const LAYER_MULTI = LAYER.MULTI;

/** 空间网格边长（mil）：越小越快但内存越大 */
export const GRID_SIZE = 150;

/**
 * 点到线段的最短距离平方
 *
 * @param {number} px 点 X
 * @param {number} py 点 Y
 * @param {number} x1 线段起点 X
 * @param {number} y1 线段起点 Y
 * @param {number} x2 线段终点 X
 * @param {number} y2 线段终点 Y
 * @returns {number} 距离平方
 * @sideEffects 无（纯函数）
 */
export function distToSegmentSquared(px, py, x1, y1, x2, y2) {
	const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
	if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
	let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
	t = Math.max(0, Math.min(1, t));
	return (px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2;
}

/**
 * 两条有宽度的线段是否相接（端点距离小于半宽之和，或真相交）
 *
 * @param {{x1: number, y1: number, x2: number, y2: number, w: number}} l1 线段一
 * @param {{x1: number, y1: number, x2: number, y2: number, w: number}} l2 线段二
 * @returns {boolean} 是否相接
 * @sideEffects 无（纯函数）
 */
export function isTwoLinesTouching(l1, l2) {
	const threshold = l1.w / 2 + l2.w / 2;
	const distSqLimit = threshold * threshold;
	if (distToSegmentSquared(l1.x1, l1.y1, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
	if (distToSegmentSquared(l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
	if (distToSegmentSquared(l2.x1, l2.y1, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;
	if (distToSegmentSquared(l2.x2, l2.y2, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;
	return segmentsIntersect(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
}

/**
 * 线段 (a,b) 与 (c,d) 是否真正交叉（不含端点接触）
 *
 * @param {number} a 段一 X
 * @param {number} b 段一 Y
 * @param {number} c 段一 X
 * @param {number} d 段一 Y
 * @param {number} p 段二 X
 * @param {number} q 段二 Y
 * @param {number} r 段二 X
 * @param {number} s 段二 Y
 * @returns {boolean} 是否交叉
 * @sideEffects 无（纯函数）
 */
export function segmentsIntersect(a, b, c, d, p, q, r, s) {
	const crossProduct = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
	const d1 = crossProduct(p, q, r, s, a, b);
	const d2 = crossProduct(p, q, r, s, c, d);
	const d3 = crossProduct(a, b, c, d, p, q);
	const d4 = crossProduct(a, b, c, d, r, s);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * 点是否在矩形内
 *
 * @param {number} x 点 X
 * @param {number} y 点 Y
 * @param {{x: number, y: number, w: number, h: number}} rect 矩形（中心 + 宽高）
 * @returns {boolean} 是否在内
 * @sideEffects 无（纯函数）
 */
export function isPointInRect(x, y, rect) {
	return Math.abs(x - rect.x) <= rect.w / 2 && Math.abs(y - rect.y) <= rect.h / 2;
}

/**
 * 线段是否与矩形相交（端点在内，或与四条边交叉）
 *
 * @param {number} x1 起点 X
 * @param {number} y1 起点 Y
 * @param {number} x2 终点 X
 * @param {number} y2 终点 Y
 * @param {{x: number, y: number, w: number, h: number}} rect 矩形
 * @returns {boolean} 是否相交
 * @sideEffects 无（纯函数）
 */
export function isLineIntersectRect(x1, y1, x2, y2, rect) {
	const left = rect.x - rect.w / 2;
	const right = rect.x + rect.w / 2;
	const top = rect.y - rect.h / 2;
	const bottom = rect.y + rect.h / 2;
	if (isPointInRect(x1, y1, rect) || isPointInRect(x2, y2, rect)) return true;
	return (
		segmentsIntersect(x1, y1, x2, y2, left, top, right, top) ||
		segmentsIntersect(x1, y1, x2, y2, left, bottom, right, bottom) ||
		segmentsIntersect(x1, y1, x2, y2, left, top, left, bottom) ||
		segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom)
	);
}

/**
 * 从嵌套路径数组里抽顶点（每段数字里取最后两个当 x/y）
 *
 * @param {Array} shapeData 路径（可能多层嵌套）
 * @returns {Array<{x: number, y: number}>} 顶点
 * @sideEffects 无（纯函数）
 */
export function getPolyVertices(shapeData) {
	const vertices = [];

	const traverse = (node) => {
		if (!Array.isArray(node)) return;
		const numbers = node.filter((n) => typeof n === 'number');
		if (numbers.length >= 4 && numbers.length % 2 === 0) {
			for (let i = 0; i < numbers.length; i += 2) vertices.push({ x: numbers[i], y: numbers[i + 1] });
		} else {
			node.forEach((sub) => Array.isArray(sub) && traverse(sub));
		}
	};

	traverse(shapeData);
	return vertices;
}

/**
 * 两条线段是否相交（含端点，参数式）
 *
 * @param {number} x1 段一 X
 * @param {number} y1 段一 Y
 * @param {number} x2 段一 X
 * @param {number} y2 段一 Y
 * @param {number} x3 段二 X
 * @param {number} y3 段二 Y
 * @param {number} x4 段二 X
 * @param {number} y4 段二 Y
 * @returns {boolean} 是否相交
 * @sideEffects 无（纯函数）
 */
export function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
	const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
	if (denom === 0) return false;
	const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
	const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
	return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

/**
 * 点是否在多边形内（ray casting）
 *
 * @param {number} px 点 X
 * @param {number} py 点 Y
 * @param {Array<{x: number, y: number}>} vertices 多边形顶点
 * @returns {boolean} 是否在内
 * @sideEffects 无（纯函数）
 */
export function isPointInPoly(px, py, vertices) {
	let inside = false;
	for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
		const xi = vertices[i].x;
		const yi = vertices[i].y;
		const xj = vertices[j].x;
		const yj = vertices[j].y;
		const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

/**
 * 旋转矩形的顶点（圆角用圆弧采样近似）
 *
 * @param {number} x 中心 X
 * @param {number} y 中心 Y
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} rotation 旋转角（度）
 * @param {number} [radius=0] 圆角半径
 * @param {number} [segments=6] 每段圆角的采样数
 * @returns {Array<{x: number, y: number}>} 顶点
 * @sideEffects 无（纯函数）
 */
export function getRotatedRectVertices(x, y, w, h, rotation, radius = 0, segments = 6) {
	const rad = ((rotation || 0) * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const maxRadius = Math.min(w, h) / 2;
	const r = Math.max(0, Math.min(radius || 0, maxRadius));

	let offsets = [];
	if (r <= 0) {
		offsets = [
			{ dx: 0, dy: 0 },
			{ dx: w, dy: 0 },
			{ dx: w, dy: -h },
			{ dx: 0, dy: -h },
		];
	} else {
		const addArcPoints = (cx, cy, startAngle, endAngle) => {
			const step = (endAngle - startAngle) / segments;
			for (let i = 0; i <= segments; i++) {
				const theta = startAngle + step * i;
				offsets.push({ dx: cx + r * Math.cos(theta), dy: cy + r * Math.sin(theta) });
			}
		};
		addArcPoints(w - r, -r, Math.PI / 2, 0);
		addArcPoints(w - r, -h + r, 0, -Math.PI / 2);
		addArcPoints(r, -h + r, -Math.PI / 2, -Math.PI);
		addArcPoints(r, -r, Math.PI, Math.PI / 2);
	}

	return offsets.map((p) => ({
		x: x + (p.dx * cos - p.dy * sin),
		y: y + (p.dx * sin + p.dy * cos),
	}));
}

/**
 * 圆弧 → 折线段（约 22.5° 一段）
 *
 * 圆弧只取「弦」会与真实弧差一个矢高（90° 弧 ≈ 0.29r），造成相邻却判不相接 /
 * 隔开却判相接。必须按角度采样。
 *
 * @param {object} prim 弧图元（`x1/y1/x2/y2/angle/w`）
 * @returns {Array<object>} 折线段（`shape: 'line'`）
 * @sideEffects 无（纯函数）
 */
export function expandArcLines(prim) {
	const out = [];
	const x1 = prim.x1;
	const y1 = prim.y1;
	const x2 = prim.x2;
	const y2 = prim.y2;
	const w = prim.w;
	const angle = Number(prim.angle || 0);
	const ch = Math.hypot(x2 - x1, y2 - y1);
	const th = Math.min((Math.abs(angle) * Math.PI) / 180, Math.PI * 2);
	if (!(ch > 1e-9) || !(th > 1e-9)) {
		out.push(prim);
		return out;
	}
	const r = ch / (2 * Math.sin(th / 2));
	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;
	const nx = -(y2 - y1) / ch;
	const ny = (x2 - x1) / ch;
	const h = Math.sqrt(Math.max(0, r * r - (ch / 2) * (ch / 2)));
	const sgn = angle >= 0 ? 1 : -1;
	const cx = mx + nx * h * sgn;
	const cy = my + ny * h * sgn;
	const a0 = Math.atan2(y1 - cy, x1 - cx);
	const sweep = sgn * th;
	const N = Math.max(2, Math.min(12, Math.ceil(Math.abs(sweep) / (Math.PI / 8))));
	let px = x1;
	let py = y1;
	for (let k = 1; k <= N; k++) {
		const a = a0 + sweep * (k / N);
		const qx = cx + r * Math.cos(a);
		const qy = cy + r * Math.sin(a);
		out.push({ id: prim.id + '_' + k, type: 'ARC', net: prim.net, layer: prim.layer, shape: 'line', x1: px, y1: py, x2: qx, y2: qy, w: w });
		px = qx;
		py = qy;
	}
	return out;
}

/**
 * 取图元的边界线段（多边形 / 线段 / 圆 / 矩形）
 *
 * ⚠️ 圆形**不能**用包围盒四边近似：方角在对角方向比真实半径远 √2 倍，
 * 会把「圆心距边界 1.27mm、半径仅 0.955mm」的焊盘判成与覆铜相接 → 不同网络被焊接在一起。
 * 这里用内接正十二边形，顶点严格落在圆周上。
 *
 * @param {object} shape 图元
 * @returns {Array<number[]>} 线段数组 `[x1, y1, x2, y2]`
 * @sideEffects 无（纯函数）
 */
export function getEdges(shape) {
	const lines = [];

	if (shape.shape === 'POLY' || shape.vertices) {
		const v = shape.vertices;
		for (let i = 0; i < v.length; i++) {
			const p1 = v[i];
			const p2 = v[(i + 1) % v.length];
			lines.push([p1.x, p1.y, p2.x, p2.y]);
		}
		return lines;
	}

	if (shape.shape === 'line') {
		lines.push([shape.x1, shape.y1, shape.x2, shape.y2]);
		return lines;
	}

	if (shape.shape === 'ROUND') {
		const r0 = shape.r || 0;
		const N = 12;
		for (let i = 0; i < N; i++) {
			const a1 = (i / N) * Math.PI * 2;
			const a2 = ((i + 1) / N) * Math.PI * 2;
			lines.push([
				shape.x + r0 * Math.cos(a1),
				shape.y + r0 * Math.sin(a1),
				shape.x + r0 * Math.cos(a2),
				shape.y + r0 * Math.sin(a2),
			]);
		}
		return lines;
	}

	const hw = shape.w / 2;
	const hh = shape.h / 2;
	const l = shape.x - hw;
	const r = shape.x + hw;
	const t = shape.y - hh;
	const b = shape.y + hh;
	lines.push([l, t, r, t], [r, t, r, b], [r, b, l, b], [l, b, l, t]);
	return lines;
}

/**
 * 两个图元的层是否相接（多层 / 盲埋孔区间 / 同一层）
 *
 * @param {object} a 图元一
 * @param {object} b 图元二
 * @returns {boolean} 是否可能导通
 * @sideEffects 无（纯函数）
 */
export function areLayersConnected(a, b) {
	const getLayerIds = (obj) => {
		if (obj.blindLayers && obj.blindLayers.length > 0) return obj.blindLayers;
		if (obj.layer === LAYER_MULTI) return 'ALL';
		return [obj.layer];
	};
	const layersA = getLayerIds(a);
	const layersB = getLayerIds(b);
	if (layersA === 'ALL' || layersB === 'ALL') return true;
	return layersA.some((id) => layersB.indexOf(id) !== -1);
}

/**
 * 高精度连通判定（按图元类型分派）
 *
 * 多边形走「边交叉 + 互相包含」，线段走端点距离，圆走圆心距，其余退化为包围盒重叠。
 *
 * @param {object} a 图元一
 * @param {object} b 图元二
 * @returns {boolean} 是否导通
 * @sideEffects 无（纯函数）
 */
export function checkConnectivityHighPrecision(a, b) {
	if (!areLayersConnected(a, b)) return false;

	if (a.shape === 'POLY' || b.shape === 'POLY') return polyTouchesEither(a, b);

	// ⚠️ 顺序不可调换：两条线必须在「线段 + 其他图元」配对之前判定。
	// 否则会落到下面的包围盒兜底（线没有 h → NaN → 恒判不相连）。
	if (a.shape === 'line' && b.shape === 'line') return isTwoLinesTouching(a, b);

	const pair = linePartnerPair(a, b);
	if (pair) return linePartnerTouches(pair.linePrim, pair.otherPrim);

	if (a.shape === 'ROUND' && b.shape === 'ROUND') return roundTouches(a, b);

	return boxTouches(a, b);
}

/**
 * 多边形分支：挑出多边形当主动判定方，另一个当被判定方
 *
 * @param {object} a 图元一
 * @param {object} b 图元二
 * @returns {boolean} 是否相接
 * @sideEffects 无（纯函数）
 */
function polyTouchesEither(a, b) {
	const polyA = a.shape === 'POLY' ? a : b;
	const other = a.shape === 'POLY' ? b : a;
	return polyTouches(polyA, other);
}

/**
 * 取出「线段 + 另一个图元」的配对
 *
 * @param {object} a 图元一
 * @param {object} b 图元二
 * @returns {{linePrim: object, otherPrim: object}|null} 配对；两者都不是线段返回 null
 * @sideEffects 无（纯函数）
 */
function linePartnerPair(a, b) {
	const linePrim = a.shape === 'line' ? a : b.shape === 'line' ? b : null;
	const otherPrim = a.shape === 'line' ? b : b.shape === 'line' ? a : null;
	return linePrim && otherPrim ? { linePrim: linePrim, otherPrim: otherPrim } : null;
}

/**
 * 线段 vs 圆（圆心距）/ 矩形（外扩半宽后求交）
 *
 * 其余形状仍要落到包围盒兜底（与拆分前的行为一致）。
 *
 * @param {object} n 线段图元
 * @param {object} r 另一图元
 * @returns {boolean} 是否相接
 * @sideEffects 无（纯函数）
 */
function linePartnerTouches(n, r) {
	if (r.shape === 'ROUND') {
		const e = distToSegmentSquared(r.x, r.y, n.x1, n.y1, n.x2, n.y2);
		const t = r.r + n.w / 2;
		return e <= t * t;
	}
	if (r.shape === 'RECT') {
		const pad = n.w / 2 + 0.1;
		return isLineIntersectRect(n.x1, n.y1, n.x2, n.y2, { x: r.x, y: r.y, w: r.w + 2 * pad, h: r.h + 2 * pad });
	}
	return boxTouches(n, r);
}

/**
 * 圆 vs 圆：圆心距严格小于半径和
 *
 * @param {object} a 圆一
 * @param {object} b 圆二
 * @returns {boolean} 是否相接
 * @sideEffects 无（纯函数）
 */
function roundTouches(a, b) {
	return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.r + b.r) ** 2;
}

/**
 * 兜底：包围盒重叠
 *
 * @param {object} a 图元一
 * @param {object} b 图元二
 * @returns {boolean} 是否重叠
 * @sideEffects 无（纯函数）
 */
function boxTouches(a, b) {
	return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

/**
 * 多边形与另一个图元的相接判定
 *
 * @param {object} polyA 多边形
 * @param {object} other 另一个图元
 * @returns {boolean} 是否相接
 * @sideEffects 无（纯函数）
 */
function polyTouches(polyA, other) {
	// 三个阶段刻意串行短路：任一段成立即返回，顺序变了判定结果可能变
	if (edgesCross(polyA, other)) return true;

	if (otherInsidePoly(polyA, other)) return true;

	return polyInsideOther(polyA, other);
}

/**
 * 阶段 1：边缘交叉
 *
 * @param {object} polyA 多边形
 * @param {object} other 另一个图元
 * @returns {boolean} 是否有边交叉
 * @sideEffects 无（纯函数）
 */
function edgesCross(polyA, other) {
	const linesA = getEdges(polyA);
	const linesB = getEdges(other);

	for (const la of linesA) {
		for (const lb of linesB) {
			if (lineIntersect(la[0], la[1], la[2], la[3], lb[0], lb[1], lb[2], lb[3])) return true;
		}
	}

	return false;
}

/**
 * 阶段 2：对方在图内（按对方形状选判定点，纯几何图形才用中心点）
 *
 * @param {object} polyA 多边形
 * @param {object} other 另一个图元
 * @returns {boolean} 对方的判定点是否在图内
 * @sideEffects 无（纯函数）
 */
function otherInsidePoly(polyA, other) {
	if (other.vertices) {
		for (const v of other.vertices) if (isPointInPoly(v.x, v.y, polyA.vertices)) return true;
		return false;
	}
	if (other.shape === 'line') {
		if (isPointInPoly(other.x1, other.y1, polyA.vertices)) return true;
		return isPointInPoly(other.x2, other.y2, polyA.vertices);
	}
	return isPointInPoly(other.x, other.y, polyA.vertices);
}

/**
 * 阶段 3：反向包含（多边形的顶点在对方内部）
 *
 * @param {object} polyA 多边形
 * @param {object} other 另一个图元
 * @returns {boolean} 是否被对方包含
 * @sideEffects 无（纯函数）
 */
function polyInsideOther(polyA, other) {
	if (other.vertices) {
		for (const v of polyA.vertices) if (isPointInPoly(v.x, v.y, other.vertices)) return true;
		return false;
	}
	if (other.shape === 'RECT') {
		for (const v of polyA.vertices) if (isPointInRect(v.x, v.y, other)) return true;
	}
	return false;
}

/**
 * 层栈顺序：顶层 → 内层（升序）→ 底层
 *
 * @param {number[]} innerLayerIds 内层 id（会被就地排序）
 * @returns {number[]} 层栈
 * @sideEffects **就地排序**入参数组
 */
export function getStackIds(innerLayerIds) {
	const LAYER_TOP = 1;
	const LAYER_BOTTOM = 2;
	innerLayerIds.sort((a, b) => a - b);
	const uniqueLayers = [...new Set(innerLayerIds)];
	return [LAYER_TOP, ...uniqueLayers, LAYER_BOTTOM];
}

/**
 * 把「第几层到第几层」的区间字符串翻译成真实层 id
 *
 * @param {string} rangeStr 形如 `1-4`
 * @param {number[]} stackIds 层栈
 * @returns {number[]|null} 层 id 列表；无法解析返回 null
 * @sideEffects 无（纯函数）
 */
export function getRealLayerIdsFromRange(rangeStr, stackIds) {
	if (!rangeStr) return null;
	const parts = String(rangeStr).split('-');
	if (parts.length !== 2) return null;
	let startIdx = parseInt(parts[0], 10);
	let endIdx = parseInt(parts[1], 10);
	if (startIdx < 1) startIdx = 1;
	if (endIdx > stackIds.length) endIdx = stackIds.length;

	const resultIds = [];
	for (let i = startIdx; i <= endIdx; i++) {
		const realId = stackIds[i - 1];
		if (realId !== undefined) resultIds.push(realId);
	}
	return resultIds;
}

/**
 * 把图元登记到它覆盖的所有网格单元（外扩 10mil 容差）
 *
 * @param {object} prim 图元
 * @param {number} gridSize 网格边长
 * @param {Record<string, Array<object>>} grid 网格（就地修改）
 * @returns {void}
 * @sideEffects **就地修改** `grid`
 */
export function addToGrid(prim, gridSize, grid) {
	let minX;
	let maxX;
	let minY;
	let maxY;
	const padding = 10;

	if (prim.shape === 'line') {
		const r = prim.w / 2;
		minX = Math.min(prim.x1, prim.x2) - r;
		maxX = Math.max(prim.x1, prim.x2) + r;
		minY = Math.min(prim.y1, prim.y2) - r;
		maxY = Math.max(prim.y1, prim.y2) + r;
	} else {
		minX = prim.x - prim.w / 2;
		maxX = prim.x + prim.w / 2;
		minY = prim.y - prim.h / 2;
		maxY = prim.y + prim.h / 2;
	}

	minX -= padding;
	maxX += padding;
	minY -= padding;
	maxY += padding;

	const startX = Math.floor(minX / gridSize);
	const endX = Math.floor(maxX / gridSize);
	const startY = Math.floor(minY / gridSize);
	const endY = Math.floor(maxY / gridSize);

	for (let x = startX; x <= endX; x++) {
		for (let y = startY; y <= endY; y++) {
			const key = `${x},${y}`;
			if (!grid[key]) grid[key] = [];
			grid[key].push(prim);
		}
	}
}
