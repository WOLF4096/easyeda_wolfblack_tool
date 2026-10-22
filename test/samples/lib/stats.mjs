/**
 * 样本统计与图元字段提取
 *
 * 实测结论（写在这里避免以后又猜错）：
 *   V2 数组格式：图元 layer 在 **第 5 个元素（下标 4）**，如
 *     ["LINE","e4",0,"$C1_1",1,120.061,464.142,...]  → layer = 1
 *     ["POLY","e3",0,"",11,10,[...],0]               → layer = 11
 *     ["LAYER",1,"TOP",...]                          → 图层定义行，layer = 下标 1
 *   V3/V4 日志格式：内层字段名是 **layerId**（不是 layer），如 {"layerId":50,...}
 *   坐标字段：V2 是位置数组；V3/V4 有 x/y、startX/startY、centerX/centerY、points[].x/y 等多种
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** V2 中出现图元 layer 的类型（下标 4） */
const V2_GEOMETRY_TYPES = ['LINE', 'POLY', 'FILL', 'PAD', 'VIA', 'ARC', 'CARC', 'REGION', 'SOLIDREGION', 'TEXT'];

/**
 * 从 V2 数组行取 layer
 * @param {Array} arr
 * @returns {number|undefined}
 */
export function findV2Layer(arr) {
	if (!Array.isArray(arr)) return undefined;
	if (arr[0] === 'LAYER' && typeof arr[1] === 'number') return arr[1];
	if (V2_GEOMETRY_TYPES.includes(arr[0]) && typeof arr[4] === 'number') return arr[4];
	return undefined;
}

/**
 * 从 V3/V4 内层对象取 layer
 * @param {Object} inner
 * @returns {number|undefined}
 */
export function findLogLayer(inner) {
	if (!inner || typeof inner !== 'object') return undefined;
	if (typeof inner.layerId === 'number') return inner.layerId;
	if (typeof inner.layer === 'number') return inner.layer;
	return undefined;
}

/**
 * 统一取一行的 layer（不区分格式）
 * @param {{format: 'log'|'array'}} doc
 * @param {Object|Array} payload - log 传 inner 对象，array 传数组
 * @returns {number|undefined}
 */
export function extractLayer(doc, payload) {
	return doc.format === 'log' ? findLogLayer(payload) : findV2Layer(payload);
}

/** 从对象里递归收集数值坐标（限定字段名，避免把宽度/角度算进坐标） */
const LOG_COORD_KEYS = ['x', 'y', 'startX', 'startY', 'endX', 'endY', 'centerX', 'centerY'];

function collectLogCoords(inner, acc) {
	if (!inner || typeof inner !== 'object') return;
	for (const key of LOG_COORD_KEYS) {
		if (typeof inner[key] === 'number') acc.push(Math.abs(inner[key]));
	}
	if (Array.isArray(inner.points)) {
		for (const p of inner.points) {
			if (typeof p?.x === 'number') acc.push(Math.abs(p.x));
			if (typeof p?.y === 'number') acc.push(Math.abs(p.y));
		}
	}
}

/**
 * 采集单个样本的统计信息（只观测，不判定）
 * @param {Object} sample
 * @param {Object} WC - WolfCommon
 * @returns {{docTypes: string[], layers: number[], maxAbsCoord: number|null, missingTrailingPipe: number, primitiveTypes: Object}}
 */
export function collectSampleStats(sample, WC) {
	const layers = new Set();
	const docTypes = new Set();
	const primitiveTypes = {};
	let maxAbsCoord = 0;
	let sawCoord = false;
	let missingTrailingPipe = 0;

	for (const doc of sample.docs) {
		docTypes.add(doc.docType);
		for (const line of doc.lines) {
			let payload = null;

			if (doc.format === 'log') {
				const parsed = WC.splitSourceLine(line.text);
				if (!parsed) continue;
				payload = parsed.rightObj;
				if (!parsed.hasTrailingPipe) missingTrailingPipe++;
				const type = parsed.leftObj.type;
				primitiveTypes[type] = (primitiveTypes[type] || 0) + 1;
				const coords = [];
				collectLogCoords(payload, coords);
				for (const v of coords) {
					sawCoord = true;
					maxAbsCoord = Math.max(maxAbsCoord, v);
				}
			} else {
				try {
					const arr = JSON.parse(line.text);
					if (!Array.isArray(arr) || arr.length === 0) continue;
					primitiveTypes[arr[0]] = (primitiveTypes[arr[0]] || 0) + 1;
					payload = arr;
					for (const v of arr.slice(5)) {
						if (typeof v === 'number') {
							sawCoord = true;
							maxAbsCoord = Math.max(maxAbsCoord, Math.abs(v));
						}
					}
				} catch (e) {
					continue;
				}
			}

			const layer = extractLayer(doc, payload);
			if (typeof layer === 'number') layers.add(layer);
		}
	}

	return {
		docTypes: [...docTypes],
		layers: [...layers].sort((a, b) => a - b),
		maxAbsCoord: sawCoord ? Math.round(maxAbsCoord * 1000) / 1000 : null,
		missingTrailingPipe,
		primitiveTypes,
	};
}
