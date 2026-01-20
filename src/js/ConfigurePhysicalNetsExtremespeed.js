// 狼黑工具 - 生成物理网络 (V2/V3 自动适配终极版)
// 开发平台：嘉立创EDA专业版 v2.2.43 - v3.x
// 更新日志：
// - V3 引擎修复：增加对 FILL/REGION/POLY 的支持
// - V3 引擎修复：增加对 path 属性 (嵌套数组) 的深度解析
// - V3 引擎修复：支持旋转矩形与任意多边形的混合解析

// =============================================================
// 模块 1：共享基础算法与工具 (Shared Utils - Advanced Geometry)
// =============================================================

class UnionFind {
	constructor() {
		this.parent = {};
	}
	find(id) {
		if (this.parent[id] === undefined) this.parent[id] = id;
		if (this.parent[id] !== id) this.parent[id] = this.find(this.parent[id]);
		return this.parent[id];
	}
	union(id1, id2) {
		let root1 = this.find(id1);
		let root2 = this.find(id2);
		if (root1 !== root2) this.parent[root1] = root2;
	}
}

// 几何计算 (采用 A.js 的高精度版本)

function areLayersConnected(a, b) {
	const LAYER_MULTI = 12;
	const getLayerIds = (obj) => {
		if (obj.blindLayers && obj.blindLayers.length > 0) return obj.blindLayers;
		if (obj.layer === LAYER_MULTI) return 'ALL';
		return [obj.layer];
	};
	const layersA = getLayerIds(a);
	const layersB = getLayerIds(b);

	if (layersA === 'ALL' || layersB === 'ALL') return true;

	for (let i = 0; i < layersA.length; i++) {
		if (layersB.indexOf(layersA[i]) !== -1) return true;
	}
	return false;
}

// --- 高级几何算法 (处理复杂多边形) ---

function distToSegmentSquared(px, py, x1, y1, x2, y2) {
	let l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
	if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
	let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
	t = Math.max(0, Math.min(1, t));
	return (px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2;
}

function isTwoLinesTouching(l1, l2) {
	let threshold = l1.w / 2 + l2.w / 2;
	let distSqLimit = threshold * threshold;

	if (distToSegmentSquared(l1.x1, l1.y1, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
	if (distToSegmentSquared(l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
	if (distToSegmentSquared(l2.x1, l2.y1, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;
	if (distToSegmentSquared(l2.x2, l2.y2, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;

	return segmentsIntersect(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
}

function segmentsIntersect(a, b, c, d, p, q, r, s) {
	function crossProduct(x1, y1, x2, y2, x3, y3) {
		return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
	}
	let d1 = crossProduct(p, q, r, s, a, b);
	let d2 = crossProduct(p, q, r, s, c, d);
	let d3 = crossProduct(a, b, c, d, p, q);
	let d4 = crossProduct(a, b, c, d, r, s);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function isLineIntersectRect(x1, y1, x2, y2, rect) {
	let left = rect.x - rect.w / 2;
	let right = rect.x + rect.w / 2;
	let top = rect.y - rect.h / 2;
	let bottom = rect.y + rect.h / 2;

	if (isPointInRect(x1, y1, rect) || isPointInRect(x2, y2, rect)) return true;

	return (
		segmentsIntersect(x1, y1, x2, y2, left, top, right, top) ||
		segmentsIntersect(x1, y1, x2, y2, left, bottom, right, bottom) ||
		segmentsIntersect(x1, y1, x2, y2, left, top, left, bottom) ||
		segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom)
	);
}

function isPointInRect(x, y, rect) {
	return Math.abs(x - rect.x) <= rect.w / 2 && Math.abs(y - rect.y) <= rect.h / 2;
}

// 1. 从 JSON 数组中提取多边形顶点
function getPolyVertices(shapeData) {
	let vertices = [];
	function traverse(node) {
		if (!Array.isArray(node)) return;
		let numbers = node.filter((n) => typeof n === 'number');
		// 简单启发式：如果是成对出现的坐标点
		if (numbers.length >= 4 && numbers.length % 2 === 0) {
			for (let i = 0; i < numbers.length; i += 2) {
				vertices.push({ x: numbers[i], y: numbers[i + 1] });
			}
		} else {
			node.forEach((sub) => Array.isArray(sub) && traverse(sub));
		}
	}
	traverse(shapeData);
	return vertices;
}

// 2. 检查线段是否相交 (用于检测多边形边缘交叉)
function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
	let denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
	if (denom === 0) return false;
	let ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
	let ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
	return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

// 3. 检查点是否在多边形内部
function isPointInPoly(px, py, vertices) {
	let inside = false;
	for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
		let xi = vertices[i].x,
			yi = vertices[i].y;
		let xj = vertices[j].x,
			yj = vertices[j].y;

		let intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

// 4. 生成旋转矩形顶点
function getRotatedRectVertices(x, y, w, h, rotation, radius = 0, segments = 6) {
	const rad = (rotation || 0) * (Math.PI / 180);
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
		function addArcPoints(cx, cy, startAngle, endAngle) {
			const step = (endAngle - startAngle) / segments;
			for (let i = 0; i <= segments; i++) {
				const theta = startAngle + step * i;
				offsets.push({ dx: cx + r * Math.cos(theta), dy: cy + r * Math.sin(theta) });
			}
		}
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

function getEdges(shape) {
	let lines = [];
	if (shape.shape === 'POLY' || shape.vertices) {
		let v = shape.vertices;
		for (let i = 0; i < v.length; i++) {
			let p1 = v[i];
			let p2 = v[(i + 1) % v.length];
			lines.push([p1.x, p1.y, p2.x, p2.y]);
		}
	} else if (shape.shape === 'line') {
		lines.push([shape.x1, shape.y1, shape.x2, shape.y2]);
	} else {
		// RECT
		let hw = shape.w / 2,
			hh = shape.h / 2;
		let l = shape.x - hw,
			r = shape.x + hw,
			t = shape.y - hh,
			b = shape.y + hh;
		lines.push([l, t, r, t], [r, t, r, b], [r, b, l, b], [l, b, l, t]);
	}
	return lines;
}

// 核心碰撞检测 (整合了 B 的层判断和 A 的几何判断)
function checkConnectivityHighPrecision(a, b) {
	if (!areLayersConnected(a, b)) return false;

	// === 处理复杂多边形/旋转矩形 (POLY) ===
	if (a.shape === 'POLY' || b.shape === 'POLY') {
		let polyA = a.shape === 'POLY' ? a : b;
		let other = a.shape === 'POLY' ? b : a;

		// 1. 获取两者的边缘线段
		let linesA = getEdges(polyA);
		let linesB = getEdges(other);

		// 2. 检测边缘交叉
		for (let la of linesA) {
			for (let lb of linesB) {
				if (lineIntersect(la[0], la[1], la[2], la[3], lb[0], lb[1], lb[2], lb[3])) {
					return true;
				}
			}
		}

		// 3. 检测包含关系
		if (isPointInPoly(other.x, other.y, polyA.vertices)) return true;
		if (other.vertices) {
			for (let v of other.vertices) {
				if (isPointInPoly(v.x, v.y, polyA.vertices)) return true;
			}
		} else if (other.shape === 'line') {
			if (isPointInPoly(other.x1, other.y1, polyA.vertices)) return true;
			if (isPointInPoly(other.x2, other.y2, polyA.vertices)) return true;
		}

		if (other.vertices) {
			for (let v of polyA.vertices) {
				if (isPointInPoly(v.x, v.y, other.vertices)) return true;
			}
		} else if (other.shape === 'RECT') {
			for (let v of polyA.vertices) {
				if (isPointInRect(v.x, v.y, other)) return true;
			}
		}
		return false;
	}

	// === 简单图形检测 (Line, Round, Rect) ===
	if ('line' === a.shape && 'line' === b.shape) return isTwoLinesTouching(a, b);
	let n = null,
		r = null;
	'line' === a.shape ? ((n = a), (r = b)) : 'line' === b.shape && ((n = b), (r = a));
	if (n && r) {
		if ('ROUND' === r.shape) {
			let e = distToSegmentSquared(r.x, r.y, n.x1, n.y1, n.x2, n.y2),
				t = r.r + n.w / 2;
			return e <= t * t;
		}
		if ('RECT' === r.shape) {
			let e = n.w / 2 + 0.1,
				t = { x: r.x, y: r.y, w: r.w + 2 * e, h: r.h + 2 * e };
			return isLineIntersectRect(n.x1, n.y1, n.x2, n.y2, t);
		}
	}
	if ('ROUND' === a.shape && 'ROUND' === b.shape) {
		let n = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
		return n < (a.r + b.r) ** 2;
	}
	// RECT vs RECT fallback
	let i = a.w,
		o = a.h,
		s = b.w,
		l = b.h;
	return Math.abs(a.x - b.x) < (i + s) / 2 && Math.abs(a.y - b.y) < (o + l) / 2;
}

// 通用API数据获取
async function fetchAllPads() {
	let resultPads = [];
	try {
		let allPads = await eda.pcb_PrimitivePad.getAll();
		console.log(`[系统] API获取到 ${allPads.length} 个焊盘...`);

		allPads.forEach((pad) => {
			let w = 10,
				h = 10;
			let shapeType = 'RECT';
			if (pad.pad && pad.pad.length > 1) {
				shapeType = pad.pad[0];
				w = Number(pad.pad[1]);
				h = Number(pad.pad[2] || w);
			}

			let algoShape = 'RECT';
			let radius = 0;
			if (shapeType === 'ROUND' || (shapeType === 'ELLIPSE' && Math.abs(w - h) < 0.1)) {
				algoShape = 'ROUND';
				radius = w / 2;
			} else {
				algoShape = 'RECT';
				let rot = Math.abs(Number(pad.rotation || 0)) % 180;
				if (Math.abs(rot - 90) < 1.0) {
					let temp = w;
					w = h;
					h = temp;
				} else if (rot > 1.0 && rot < 89.0) {
					let minSide = Math.min(w, h);
					w = minSide;
					h = minSide;
				}
			}

			resultPads.push({
				id: pad.primitiveId,
				type: 'PAD',
				net: pad.net,
				layer: pad.layer,
				shape: algoShape,
				x: Number(pad.x),
				y: Number(pad.y),
				w: w,
				h: h,
				r: radius,
			});
		});
	} catch (e) {
		console.error('获取焊盘数据失败:', e);
	}
	return resultPads;
}

// 辅助：解析层栈
function getStackIds(innerLayerIds) {
	const LAYER_TOP = 1;
	const LAYER_BOTTOM = 2;
	innerLayerIds.sort((a, b) => a - b);
	let uniqueLayers = [...new Set(innerLayerIds)];
	return [LAYER_TOP, ...uniqueLayers, LAYER_BOTTOM];
}

function getRealLayerIdsFromRange(rangeStr, stackIds) {
	if (!rangeStr || rangeStr === '') return null;
	let parts = rangeStr.split('-');
	if (parts.length !== 2) return null;
	let startIdx = parseInt(parts[0]);
	let endIdx = parseInt(parts[1]);
	if (startIdx < 1) startIdx = 1;
	if (endIdx > stackIds.length) endIdx = stackIds.length;
	let resultIds = [];
	for (let i = startIdx; i <= endIdx; i++) {
		let realId = stackIds[i - 1];
		if (realId !== undefined) resultIds.push(realId);
	}
	return resultIds;
}

// =============================================================
// 模块 2：V2 逻辑引擎 (Legacy Array Format)
// =============================================================
async function runLogicV2(rawSource, netlistJson, allPads) {
	console.log('>> 正在使用 V2 (数组格式) 解析引擎...');

	const lines = rawSource.split('\n');
	const compIdToDesignator = {};
	const padIdToPinInfo = {};
	const primitives = [];
	const innerLayerIds = [];
	const allUsedNetNames = new Set();
	const LAYER_MULTI = 12;

	// [Step 1] 解析
	lines.forEach((line) => {
		if (!line.trim() || !line.startsWith('[')) return;
		try {
			let jsonStr = line.replace(/^\\s*/, '');
			let item = JSON.parse(jsonStr);
			let type = item[0];

			if (item[3] && typeof item[3] === 'string' && item[3] !== '') {
				allUsedNetNames.add(item[3]);
			}

			if (type === 'LAYER') {
				let lid = Number(item[1]);
				let status = Number(item[4]);
				if (lid >= 15 && lid <= 46 && status === 3) {
					innerLayerIds.push(lid);
				}
			} else if (type === 'ATTR') {
				let ownerId = item[3];
				let key = item[7];
				let val = item[8];
				if (key === 'Designator' && ownerId && val) {
					compIdToDesignator[ownerId] = val;
				}
			} else if (type === 'PAD_NET') {
				let compId = item[1];
				let pinNum = item[2];
				let padSuffix = item[4];
				padIdToPinInfo[compId + padSuffix] = { compId: compId, pin: pinNum };
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
				let dia = Number(item[8]);
				let viaRangeStr = item[4];
				primitives.push({
					id: item[1],
					type: 'VIA',
					net: item[3],
					layer: LAYER_MULTI,
					_rawRange: viaRangeStr,
					shape: 'ROUND',
					x: Number(item[5]),
					y: Number(item[6]),
					w: dia,
					h: dia,
					r: dia / 2,
				});
			} else if (type === 'ARC') {
				primitives.push({
					id: item[1],
					type: 'ARC',
					net: item[3],
					layer: item[4],
					shape: 'line',
					x1: Number(item[5]),
					y1: Number(item[6]),
					x2: Number(item[7]),
					y2: Number(item[8]),
					w: Number(item[9]),
				});
				// 删除了 type === "POUR" 的判断，并简化了 shapeData 获取逻辑（因为 FILL/POLY 都在索引 7）
			} else if (type === 'FILL' || type === 'POLY') {
				let shapeData = item[7];

				while (Array.isArray(shapeData) && shapeData.length > 0 && Array.isArray(shapeData[0])) {
					if (shapeData[0][0] === 'R' || typeof shapeData[0][0] === 'number') {
						break;
					}
					shapeData = shapeData[0];
				}

				let vertices = [];
				let isValidShape = false;
				let rectData = null;

				if (Array.isArray(shapeData) && shapeData.length > 0) {
					if (Array.isArray(shapeData[0]) && shapeData[0][0] === 'R') {
						rectData = shapeData[0];
					} else if (shapeData[0] === 'R') {
						rectData = shapeData;
					}
				}

				if (rectData) {
					let rx = Number(rectData[1]);
					let ry = Number(rectData[2]);
					let rw = Number(rectData[3]);
					let rh = Number(rectData[4]);
					let rot = Number(rectData[5] || 0);
					let radius = Number(rectData[6] || 0);
					vertices = getRotatedRectVertices(rx, ry, rw, rh, rot, radius);
					isValidShape = true;
				} else {
					vertices = getPolyVertices(shapeData);
					if (vertices.length > 2) isValidShape = true;
				}

				if (isValidShape) {
					let minX = Infinity,
						maxX = -Infinity,
						minY = Infinity,
						maxY = -Infinity;
					vertices.forEach((v) => {
						if (v.x < minX) minX = v.x;
						if (v.x > maxX) maxX = v.x;
						if (v.y < minY) minY = v.y;
						if (v.y > maxY) maxY = v.y;
					});

					primitives.push({
						id: item[1],
						type: type,
						net: item[3],
						layer: item[4],
						shape: 'POLY',
						vertices: vertices,
						x: (minX + maxX) / 2,
						y: (minY + maxY) / 2,
						w: maxX - minX,
						h: maxY - minY,
					});
				}
			}
		} catch (e) {}
	});

	const stackIds = getStackIds(innerLayerIds);
	primitives.forEach((p) => {
		if (p.type === 'VIA' && p._rawRange) {
			p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
		}
	});

	for (let padId in padIdToPinInfo) {
		let info = padIdToPinInfo[padId];
		if (compIdToDesignator[info.compId]) info.des = compIdToDesignator[info.compId];
		else info.des = null;
	}

	allPads.forEach((p) => {
		if (p.net) allUsedNetNames.add(p.net);
	});
	const allPrimitives = primitives.concat(allPads);

	// 执行通用计算
	let netlistUpdates = await performPhysicalCalculation(allPrimitives, padIdToPinInfo, allUsedNetNames);

	// [Step 4] V2 专用网表更新 (compData.pins)
	console.log(`================ 准备写入网表 (V2模式) ================`);
	let updateCount = 0;
	for (let internalId in netlistJson) {
		let compData = netlistJson[internalId];
		if (!compData || !compData.props) continue;
		let des = compData.props.Designator;
		if (!des) continue;
		if (netlistUpdates.hasOwnProperty(des)) {
			let pinUpdates = netlistUpdates[des];
			if (!compData.pins) compData.pins = {};
			for (let pinNum in pinUpdates) {
				let targetNet = pinUpdates[pinNum];
				let pinKey = String(pinNum);
				if (compData.pins[pinKey] !== targetNet) {
					compData.pins[pinKey] = targetNet;
					updateCount++;
				}
			}
		}
	}
	return { count: updateCount, netlist: netlistJson };
}

// =============================================================
// 模块 3：V3 逻辑引擎 (Pipe/Object Format + V2 Compatible)
// =============================================================
async function runLogicV3(rawSource, netlistJson, allPads) {
	console.log('>> 正在使用 V3 (混合/对象格式) 解析引擎...');

	const lines = rawSource.split('\n');
	const compIdToDesignator = {};
	const padIdToPinInfo = {};
	const primitives = [];
	const innerLayerIds = [];
	const allUsedNetNames = new Set();
	const LAYER_MULTI = 12;

	function parseV3LineObjects(line) {
		if (!line.trim()) return [];
		// V2 Array
		if (line.trim().startsWith('[')) {
			try {
				return [JSON.parse(line.replace(/^\\s*/, ''))];
			} catch (e) {
				return [];
			}
		}
		// V3 Object with Pipes
		if (line.trim().startsWith('{')) {
			let results = [];
			let cleanLine = line.trim();
			if (cleanLine.endsWith('|')) cleanLine = cleanLine.slice(0, -1);
			let parts = cleanLine.split('||');
			parts.forEach((part) => {
				try {
					if (part.trim()) results.push(JSON.parse(part));
				} catch (e) {}
			});
			return results;
		}
		return [];
	}

	// [Step 1] 解析
	lines.forEach((line) => {
		let objects = parseV3LineObjects(line);
		if (objects.length === 0) return;

		let mergedItem = {};
		let isV3Array = false;
		if (Array.isArray(objects[0])) {
			mergedItem = objects[0];
			isV3Array = true;
		} else {
			objects.forEach((obj) => {
				Object.assign(mergedItem, obj);
			});
		}

		let type = isV3Array ? mergedItem[0] : mergedItem.type;

		// Layer Logic
		if (type === 'LAYER') {
			let lid = -1;
			let isUsed = false;
			if (isV3Array) {
				lid = Number(mergedItem[1]);
				isUsed = Number(mergedItem[4]) > 0;
			} else {
				if (mergedItem.layerId !== undefined) lid = mergedItem.layerId;
				else {
					try {
						let idArr = typeof mergedItem.id === 'string' ? JSON.parse(mergedItem.id) : mergedItem.id;
						if (Array.isArray(idArr)) lid = idArr[1];
					} catch (e) {}
				}
				isUsed = mergedItem.use === true;
			}
			if (lid >= 15 && lid <= 46 && isUsed && !innerLayerIds.includes(lid)) {
				innerLayerIds.push(lid);
			}
		}

		// Net Name
		let netName = '';
		if (!isV3Array) {
			if (mergedItem.netName) netName = mergedItem.netName;
			if (type === 'PAD_NET' && mergedItem.padNet) netName = mergedItem.padNet;
		} else {
			if (mergedItem[3] && typeof mergedItem[3] === 'string') netName = mergedItem[3];
		}
		if (netName) allUsedNetNames.add(netName);

		// Primitives
		try {
			if (type === 'ATTR') {
				if (!isV3Array) {
					if (mergedItem.key === 'Designator' && mergedItem.value && mergedItem.parentId) {
						compIdToDesignator[mergedItem.parentId] = mergedItem.value;
					}
				} else {
					let ownerId = mergedItem[3];
					let key = mergedItem[7];
					let val = mergedItem[8];
					if (key === 'Designator' && ownerId && val) {
						compIdToDesignator[ownerId] = val;
					}
				}
			} else if (type === 'PAD_NET') {
				if (!isV3Array) {
					let idRaw = mergedItem.id;
					if (typeof idRaw === 'string' && idRaw.startsWith('[')) {
						let idParts = JSON.parse(idRaw);
						if (idParts.length >= 4) {
							let compId = idParts[1];
							let pinNum = idParts[2];
							let padSuffix = idParts[3];
							padIdToPinInfo[compId + padSuffix] = { compId: compId, pin: pinNum };
							padIdToPinInfo[padSuffix] = { compId: compId, pin: pinNum };
						}
					}
				} else {
					let compId = mergedItem[1];
					let pinNum = mergedItem[2];
					let padSuffix = mergedItem[4];
					padIdToPinInfo[compId + padSuffix] = { compId: compId, pin: pinNum };
				}
			} else if (type === 'LINE') {
				if (!isV3Array) {
					primitives.push({
						id: mergedItem.ticket || mergedItem.id,
						type: 'LINE',
						net: mergedItem.netName,
						layer: mergedItem.layerId,
						shape: 'line',
						x1: mergedItem.startX,
						y1: mergedItem.startY,
						x2: mergedItem.endX,
						y2: mergedItem.endY,
						w: mergedItem.width,
					});
				} else {
					primitives.push({
						id: mergedItem[1],
						type: 'LINE',
						net: mergedItem[3],
						layer: mergedItem[4],
						shape: 'line',
						x1: Number(mergedItem[5]),
						y1: Number(mergedItem[6]),
						x2: Number(mergedItem[7]),
						y2: Number(mergedItem[8]),
						w: Number(mergedItem[9]),
					});
				}
			} else if (type === 'VIA') {
				let dia, x, y, net, viaRangeStr;
				if (!isV3Array) {
					dia = mergedItem.viaDiameter;
					x = mergedItem.centerX;
					y = mergedItem.centerY;
					net = mergedItem.netName;
					viaRangeStr = mergedItem.ruleName;
				} else {
					dia = Number(mergedItem[8]);
					viaRangeStr = mergedItem[4];
					x = Number(mergedItem[5]);
					y = Number(mergedItem[6]);
					net = mergedItem[3];
				}
				primitives.push({
					id: !isV3Array ? mergedItem.ticket || mergedItem.id : mergedItem[1],
					type: 'VIA',
					net: net,
					layer: LAYER_MULTI,
					_rawRange: viaRangeStr,
					shape: 'ROUND',
					x: x,
					y: y,
					w: dia,
					h: dia,
					r: dia / 2,
				});
			} else if (type === 'ARC') {
				if (!isV3Array) {
					primitives.push({
						id: mergedItem.ticket || mergedItem.id,
						type: 'ARC',
						net: mergedItem.netName,
						layer: mergedItem.layerId,
						shape: 'line',
						x1: mergedItem.startX,
						y1: mergedItem.startY,
						x2: mergedItem.endX,
						y2: mergedItem.endY,
						w: mergedItem.width,
					});
				} else {
					primitives.push({
						id: mergedItem[1],
						type: 'ARC',
						net: mergedItem[3],
						layer: mergedItem[4],
						shape: 'line',
						x1: Number(mergedItem[5]),
						y1: Number(mergedItem[6]),
						x2: Number(mergedItem[7]),
						y2: Number(mergedItem[8]),
						w: Number(mergedItem[9]),
					});
				}
				// 1. 在判断条件中移除 type === "POUR"
			} else if (type === 'FILL' || type === 'REGION' || type === 'POLY' || type === 'COPPER_AREA') {
				// V3 高级多边形/区域解析逻辑
				// 1. 过滤板框 (BOARD_OUTLINE)
				if (type === 'POLY') {
					// V3 对象格式检查
					if (!isV3Array && mergedItem.polyType === 'BOARD_OUTLINE') return;
				}

				// 2. 过滤 FILL 层的 layerId 12 (通常是多层或机械层)
				if (type === 'FILL') {
					// 兼容数组格式和对象格式获取 LayerID
					let checkLayerId = isV3Array ? Number(mergedItem[4]) : mergedItem.layerId;
					if (checkLayerId === 12) return;
				}
				let shapeData = null;

				if (isV3Array) {
					// 2. 在数据获取逻辑中移除 POUR 的判断，保留 COPPER_AREA
					shapeData = type === 'COPPER_AREA' ? mergedItem[8] : mergedItem[7];
				} else {
					// 优先读取 path (V3 对象模式)，其次 points，最后尝试矩形属性
					if (mergedItem.path) {
						shapeData = mergedItem.path;
					} else if (mergedItem.points) {
						shapeData = mergedItem.points;
					} else if (mergedItem.width && mergedItem.height && mergedItem.x !== undefined) {
						// 构造兼容格式 ["R", x, y, w, h, rot, radius]
						shapeData = [
							'R',
							mergedItem.x,
							mergedItem.y,
							mergedItem.width,
							mergedItem.height,
							mergedItem.rotation || 0,
							mergedItem.cornerRadius || 0,
						];
					}
				}

				// 深度递归获取有效数据 (处理 path: [["R",...]] 这种嵌套)
				let safeCounter = 0;
				while (Array.isArray(shapeData) && shapeData.length > 0 && Array.isArray(shapeData[0])) {
					if (shapeData[0][0] === 'R' || typeof shapeData[0][0] === 'number') {
						break;
					}
					shapeData = shapeData[0];
					safeCounter++;
					if (safeCounter > 5) break;
				}

				let vertices = [];
				let isValidShape = false;
				let rectData = null;

				// [分支A] 参数化矩形
				if (Array.isArray(shapeData) && shapeData.length > 0) {
					if (Array.isArray(shapeData[0]) && shapeData[0][0] === 'R') {
						rectData = shapeData[0];
					} else if (shapeData[0] === 'R') {
						rectData = shapeData;
					}
				}

				if (rectData) {
					let rx = Number(rectData[1]);
					let ry = Number(rectData[2]);
					let rw = Number(rectData[3]);
					let rh = Number(rectData[4]);
					let rot = Number(rectData[5] || 0);
					let radius = Number(rectData[6] || 0);
					vertices = getRotatedRectVertices(rx, ry, rw, rh, rot, radius);
					isValidShape = true;
				}
				// [分支B] 任意多边形 (自动滤除 L/M 等指令)
				else if (shapeData) {
					vertices = getPolyVertices(shapeData);
					if (vertices.length > 2) isValidShape = true;
				}

				if (isValidShape) {
					let minX = Infinity,
						maxX = -Infinity,
						minY = Infinity,
						maxY = -Infinity;
					vertices.forEach((v) => {
						if (v.x < minX) minX = v.x;
						if (v.x > maxX) maxX = v.x;
						if (v.y < minY) minY = v.y;
						if (v.y > maxY) maxY = v.y;
					});

					let layerId = isV3Array ? mergedItem[4] : mergedItem.layerId;
					let netName = isV3Array ? mergedItem[3] : mergedItem.netName || '';
					let pId = isV3Array ? mergedItem[1] : mergedItem.ticket || mergedItem.id;

					primitives.push({
						id: pId,
						type: 'POLY',
						net: netName,
						layer: layerId,
						shape: 'POLY',
						vertices: vertices,
						x: (minX + maxX) / 2,
						y: (minY + maxY) / 2,
						w: maxX - minX,
						h: maxY - minY,
					});
				}
			}
		} catch (e) {}
	});

	const stackIds = getStackIds(innerLayerIds);
	primitives.forEach((p) => {
		if (p.type === 'VIA' && p._rawRange) {
			p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
		}
	});

	for (let padId in padIdToPinInfo) {
		let info = padIdToPinInfo[padId];
		if (compIdToDesignator[info.compId]) info.des = compIdToDesignator[info.compId];
		else info.des = null;
	}

	allPads.forEach((p) => {
		if (p.net) allUsedNetNames.add(p.net);
	});
	const allPrimitives = primitives.concat(allPads);

	// 执行通用计算
	let netlistUpdates = await performPhysicalCalculation(allPrimitives, padIdToPinInfo, allUsedNetNames);

	// [Step 4] V3 专用网表更新 (支持 pinInfoMap)
	console.log(`================ 准备写入网表 (V3模式) ================`);
	let updateCount = 0;

	// V3 的 netlist 结构通常在 components 字段下
	let compSource = netlistJson.components ? netlistJson.components : netlistJson;

	for (let internalId in compSource) {
		let compData = compSource[internalId];
		if (!compData || !compData.props) continue;
		let des = compData.props.Designator;
		if (!des) continue;

		if (netlistUpdates.hasOwnProperty(des)) {
			let pinUpdates = netlistUpdates[des];

			if (compData.pinInfoMap) {
				for (let pinNum in pinUpdates) {
					let targetNet = pinUpdates[pinNum];
					let pinKey = String(pinNum);

					if (compData.pinInfoMap[pinKey]) {
						if (compData.pinInfoMap[pinKey].net !== targetNet) {
							compData.pinInfoMap[pinKey].net = targetNet;
							updateCount++;
						}
					} else {
						compData.pinInfoMap[pinKey] = { 'net': targetNet, 'number': pinKey };
						updateCount++;
					}
				}
			} else {
				if (!compData.pins) compData.pins = {};
				for (let pinNum in pinUpdates) {
					let targetNet = pinUpdates[pinNum];
					let pinKey = String(pinNum);
					if (compData.pins[pinKey] !== targetNet) {
						compData.pins[pinKey] = targetNet;
						updateCount++;
					}
				}
			}
		}
	}
	return { count: updateCount, netlist: netlistJson };
}

// =============================================================
// 模块 4：通用物理计算逻辑 (Physical Calc Core)
// =============================================================
async function performPhysicalCalculation(allPrimitives, padIdToPinInfo, allUsedNetNames) {
	console.log(`[核心计算] 处理 ${allPrimitives.length} 个图元...`);
	let uf = new UnionFind();
	const GRID_SIZE = 150;
	let grid = {};

	function addToGrid(prim) {
		let minX,
			maxX,
			minY,
			maxY,
			padding = 10;
		if (prim.shape === 'line') {
			let r = prim.w / 2;
			minX = Math.min(prim.x1, prim.x2) - r;
			maxX = Math.max(prim.x1, prim.x2) + r;
			minY = Math.min(prim.y1, prim.y2) - r;
			maxY = Math.max(prim.y1, prim.y2) + r;
		} else {
			// POLY 的 w/h 在解析阶段已经计算为包围盒尺寸，因此这里通用兼容
			let halfW = prim.w / 2;
			let halfH = prim.h / 2;
			minX = prim.x - halfW;
			maxX = prim.x + halfW;
			minY = prim.y - halfH;
			maxY = prim.y + halfH;
		}
		minX -= padding;
		maxX += padding;
		minY -= padding;
		maxY += padding;
		let startX = Math.floor(minX / GRID_SIZE);
		let endX = Math.floor(maxX / GRID_SIZE);
		let startY = Math.floor(minY / GRID_SIZE);
		let endY = Math.floor(maxY / GRID_SIZE);
		for (let x = startX; x <= endX; x++) {
			for (let y = startY; y <= endY; y++) {
				let key = `${x},${y}`;
				if (!grid[key]) grid[key] = [];
				grid[key].push(prim);
			}
		}
	}
	allPrimitives.forEach((p) => addToGrid(p));

	let processedPairs = new Set();
	let connectCount = 0;

	for (let key in grid) {
		let cellItems = grid[key];
		if (cellItems.length < 2) continue;
		for (let i = 0; i < cellItems.length; i++) {
			for (let j = i + 1; j < cellItems.length; j++) {
				let a = cellItems[i];
				let b = cellItems[j];
				let pairId = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
				if (processedPairs.has(pairId)) continue;
				processedPairs.add(pairId);

				if (checkConnectivityHighPrecision(a, b)) {
					uf.union(a.id, b.id);
					connectCount++;
				}
			}
		}
	}
	console.log(`[核心计算] 发现 ${connectCount} 处物理连接`);

	let clusters = {};
	allPrimitives.forEach((p) => {
		let root = uf.find(p.id);
		if (!clusters[root]) clusters[root] = [];
		clusters[root].push(p);
	});

	let netCounter = 1;
	let netlistUpdates = {};
	const isGenericNet = (name) => /^NET\d+$/i.test(name);

	for (const rootId of Object.keys(clusters)) {
		let group = clusters[rootId];
		let validPinCount = 0;

		for (const item of group) {
			if (item.type === 'PAD') {
				let pinInfo = padIdToPinInfo[item.id];
				// V3 兼容性增强：尝试后缀匹配
				if (!pinInfo) {
					for (let key in padIdToPinInfo) {
						if (item.id.toString().endsWith(key)) {
							pinInfo = padIdToPinInfo[key];
							break;
						}
					}
				}
				if (pinInfo && pinInfo.des) {
					item._pinInfo = pinInfo;
					validPinCount++;
				}
			}
		}

		let existingNets = new Set();
		group.forEach((p) => {
			if (p.net && p.net !== '' && p.net !== 'null' && p.net !== 'undefined') {
				existingNets.add(p.net);
			}
		});

		let finalNetName = '';
		let isGenerated = false;

		if (existingNets.size > 0) {
			let sortedNets = Array.from(existingNets);
			sortedNets.sort((a, b) => {
				let aGen = isGenericNet(a);
				let bGen = isGenericNet(b);
				if (!aGen && bGen) return -1;
				if (aGen && !bGen) return 1;
				if (a.length !== b.length) return a.length - b.length;
				return a.localeCompare(b);
			});
			finalNetName = sortedNets[0];
		} else {
			isGenerated = true;
			while (true) {
				let candidate = 'NET' + netCounter;
				if (!allUsedNetNames.has(candidate)) {
					finalNetName = candidate;
					allUsedNetNames.add(finalNetName);
					break;
				}
				netCounter++;
			}
		}

		if (validPinCount < 2 && isGenerated) {
			continue;
		}

		for (const item of group) {
			if (item.type === 'PAD' && item._pinInfo) {
				let pinInfo = item._pinInfo;
				if (!netlistUpdates[pinInfo.des]) netlistUpdates[pinInfo.des] = {};
				netlistUpdates[pinInfo.des][pinInfo.pin] = finalNetName;
			}
		}
	}
	return netlistUpdates;
}

// =============================================================
// 模块 5：主入口
// =============================================================

export async function configurePhysicalNets() {
	const startTime = Date.now();
	// console.clear();
	console.log('================ 生成物理网络 (Auto-Merge) ================');

	// 0. 检测版本
	let editorVersion = '2.2.45';
	try {
		editorVersion = eda.sys_Environment.getEditorCurrentVersion() || '2.2.45';
	} catch (e) {}
	console.log(`[系统] 检测到编辑器版本: ${editorVersion}`);

	// 1. 获取通用数据
	let netlistJson = null;
	try {
		// let res = await eda.pcb_Net.getNetlist('JLCEDA');
		const getNetlistFile = await eda.pcb_ManufactureData.getNetlistFile();
		const res = await getNetlistFile.text();
		netlistJson = typeof res === 'string' ? JSON.parse(res) : res;
	} catch (e) {
		console.error('读取网表失败:', e);
		return;
	}

	let rawSource = '';
	try {
		rawSource = await eda.sys_FileManager.getDocumentSource();
		if (typeof rawSource !== 'string') throw new Error('源码获取失败');
	} catch (e) {
		console.error(e);
		return;
	}

	let allPads = await fetchAllPads();

	// 2. 根据版本分发逻辑
	let result = { count: 0, netlist: null };

	// 判断逻辑：如果版本号以 "3." 开头，使用V3引擎；否则使用V2引擎
	if (editorVersion.trim().startsWith('3.')) {
		result = await runLogicV3(rawSource, netlistJson, allPads);
	} else {
		result = await runLogicV2(rawSource, netlistJson, allPads);
	}

	// 3. 写入结果
	if (result.count > 0 && result.netlist) {
		try {
			console.log(`正在写入 ${result.count} 处变更...`);
			let updatedJsonString = JSON.stringify(result.netlist);
			await eda.pcb_Net.setNetlist('JLCEDA', updatedJsonString);
		} catch (e) {
			console.error('网表写入失败:', e);
		}
	} else {
		console.log('未检测到需要更新的网络变化。');
	}

	const endTime = Date.now();
	const duration = ((endTime - startTime) / 1000).toFixed(2);
	console.log(`================ 全部完成 (耗时 ${duration}s) ================`);
	eda.sys_Message.showToastMessage(`分析完成 (耗时 ${duration}秒)\n已更新 ${result.count} 处引脚网络`, 'success');
}
