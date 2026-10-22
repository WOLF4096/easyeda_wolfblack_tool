/**
 * @//module/ app/generate-net/padReader
 * @//description/ 读画布焊盘并统一成算法图元（形状 / 坐标 / 尺寸 / 异形轮廓）
 * @//exports/ readAllPads, padGeometry
 * @//dependencies/ 无
 * @//example/ const { readAllPads } = await import('./padReader.js')
 *            const pads = await readAllPads(eda)
 *
 * 两个刻意的保守选择（都写死在 padGeometry 里，别改回去）：
 *   1. 圆/近似圆的椭圆 → 半径取宽的一半；
 *   2. **其余一律按「最短边内切圆」处理**，不做 RECT 四角碰撞 ——
 *      API 返回的角度是否可信两版不一致，用外接矩形会把相邻网络误判成导通。
 */

/**
 * 把路径数据里的顶点抽出来（丢弃圆弧的角度/半径参数，只取每段的终点）
 *
 * @param {Array} pathData 路径数组
 * @returns {Array<{x: number, y: number}>} 顶点
 * @sideEffects 无（纯函数）
 */
function polygonVertices(pathData) {
	const vertices = [];
	let j = 0;

	while (j < pathData.length) {
		const buffer = [];
		while (j < pathData.length && typeof pathData[j] === 'number') {
			buffer.push(pathData[j]);
			j++;
		}
		// 每段里最后两个数字才是 x/y（前面可能有角度/半径）
		if (buffer.length >= 2) vertices.push({ x: buffer[buffer.length - 2], y: buffer[buffer.length - 1] });
		if (j < pathData.length && typeof pathData[j] === 'string') j++;
	}

	return vertices;
}

/**
 * 把宿主焊盘对象转成算法图元
 *
 * @param {object} pad 宿主焊盘（`pcb_PrimitivePad.getAll()` 的单项）
 * @returns {object} 算法图元
 * @sideEffects **就地修改** `pad` 的 `x` / `y`（异形焊盘改用真实几何中心）
 */
export function padGeometry(pad) {
	let w = 10;
	let h = 10;
	let shapeType = 'RECT';

	if (pad.pad && pad.pad.length > 1) {
		shapeType = pad.pad[0];
		if (shapeType !== 'POLYGON') {
			w = Number(pad.pad[1]);
			h = Number(pad.pad[2] || w);
		}
	}

	const rawHole = pad.hole && pad.hole.length > 1 ? Number(pad.hole[1]) : 0;

	let algoShape = 'RECT';
	let radius = 0;
	let vertices = null;

	if (shapeType === 'ROUND' || (shapeType === 'ELLIPSE' && Math.abs(w - h) < 0.1)) {
		algoShape = 'ROUND';
		radius = w / 2;
	} else if (shapeType === 'POLYGON' && Array.isArray(pad.pad[1])) {
		// 注意：轮廓点解析失败时会停在 POLY 且 vertices 为空 → 该焊盘不参与连通
		// （比按 10mil 默认圆处理更安全：宁可漏连，不可错连）
		algoShape = 'POLY';
		vertices = polygonVertices(pad.pad[1]);

		if (vertices.length > 0) {
			// 异形焊盘：用真实包围盒替代 API 给的坐标（否则网格加速会漏格）
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
			pad.x = (minX + maxX) / 2;
			pad.y = (minY + maxY) / 2;
			w = maxX - minX;
			h = maxY - minY;
		}
	} else {
		// API 的角度/弧度返回值两版不一致 → 一律按最短边内切圆，杜绝边缘误触
		algoShape = 'ROUND';
		radius = Math.min(w, h) / 2;
	}

	return {
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
		vertices: vertices,
		// 孔直径在源码里单位是 10mil，这里换算成一致量纲
		holeSize: rawHole * 10,
	};
}

/**
 * 读取全部焊盘
 *
 * @param {object} host 宿主对象（`eda`）
 * @returns {Promise<Array<object>>} 算法图元数组；读取失败时返回 `[]`
 * @sideEffects 调用宿主 API；`padGeometry` 会改传入焊盘对象的坐标
 */
export async function readAllPads(host) {
	try {
		const allPads = await host.pcb_PrimitivePad.getAll();
		return allPads.map((pad) => padGeometry(pad));
	} catch (e) {
		console.error('获取焊盘数据失败:', e);
		return [];
	}
}
