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
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
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
	const box = padBoxOf(pad);
	const rawHole = pad.hole && pad.hole.length > 1 ? Number(pad.hole[1]) : 0;

	// 形状判定会顺带改写异形焊盘的 `pad.x` / `pad.y`
	const shaped = shapeOfPad(pad, box);

	return {
		id: pad.primitiveId,
		type: 'PAD',
		net: pad.net,
		layer: pad.layer,
		shape: shaped.shape,
		x: Number(pad.x),
		y: Number(pad.y),
		w: shaped.w,
		h: shaped.h,
		r: shaped.radius,
		vertices: shaped.vertices,
		// 孔直径在源码里单位是 10mil，这里换算成一致量纲
		holeSize: rawHole * 10,
	};
}

/**
 * 取焊盘声明的形状类型与标称宽高（POLYGON 不读尺寸，留给轮廓自己算）
 *
 * @param {object} pad 宿主焊盘
 * @returns {{shapeType: string, w: number, h: number}} 形状类型与宽高
 * @sideEffects 无（纯函数）
 */
function padBoxOf(pad) {
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

	return { shapeType: shapeType, w: w, h: h };
}

/**
 * 形状判定：算成哪种算法图元
 *
 * @param {object} pad 宿主焊盘
 * @param {{shapeType: string, w: number, h: number}} box 标称形状与宽高
 * @returns {{shape: string, w: number, h: number, radius: number, vertices: Array<object>|null}} 算法形状
 * @sideEffects **就地修改** `pad` 的 `x` / `y`（仅异形焊盘）
 */
function shapeOfPad(pad, box) {
	if (box.shapeType === 'ROUND' || (box.shapeType === 'ELLIPSE' && Math.abs(box.w - box.h) < 0.1)) {
		return { shape: 'ROUND', w: box.w, h: box.h, radius: box.w / 2, vertices: null };
	}
	if (box.shapeType === 'POLYGON' && Array.isArray(pad.pad[1])) {
		return polyShapeOf(pad, box);
	}
	// API 的角度/弧度返回值两版不一致 → 一律按最短边内切圆，杜绝边缘误触
	return { shape: 'ROUND', w: box.w, h: box.h, radius: Math.min(box.w, box.h) / 2, vertices: null };
}

/**
 * 异形焊盘：解析轮廓，并用真实包围盒替代 API 给的坐标与尺寸
 *
 * 注意：轮廓点解析失败时会停在 POLY 且 vertices 为空 → 该焊盘不参与连通
 * （比按 10mil 默认圆处理更安全：宁可漏连，不可错连）
 *
 * @param {object} pad 宿主焊盘
 * @param {{shapeType: string, w: number, h: number}} box 标称形状与宽高
 * @returns {{shape: string, w: number, h: number, radius: number, vertices: Array<object>}} 算法形状
 * @sideEffects **就地修改** `pad` 的 `x` / `y`
 */
function polyShapeOf(pad, box) {
	const vertices = polygonVertices(pad.pad[1]);
	if (vertices.length === 0) {
		return { shape: 'POLY', w: box.w, h: box.h, radius: 0, vertices: vertices };
	}

	// 异形焊盘：用真实包围盒替代 API 给的坐标（否则网格加速会漏格）
	const bounds = vertexBounds(vertices);
	pad.x = bounds.x;
	pad.y = bounds.y;
	return { shape: 'POLY', w: bounds.w, h: bounds.h, radius: 0, vertices: vertices };
}

/**
 * 顶点包围盒（中心 + 宽高）
 *
 * @param {Array<{x: number, y: number}>} vertices 顶点
 * @returns {{x: number, y: number, w: number, h: number}} 包围盒
 * @sideEffects 无（纯函数）
 */
function vertexBounds(vertices) {
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

	return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
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
