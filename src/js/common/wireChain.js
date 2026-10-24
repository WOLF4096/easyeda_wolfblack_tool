/**
 * 导线（Line / Arc）→ 线条（Polyline）的「链式合并」纯函数
 *
 * 为什么需要：一次框选多段首尾相接的导线（例如一段折线被系统拆成了多根直线），
 * 逐根转成折线会得到一堆只有两点的碎折线；用户期望的是**一条连续折线**。
 * 本模块只做几何拼装，不碰 `eda`，便于单测覆盖。
 *
 * --- 模块边界 ---
 * 输入是已经「归一化」的段数组（坐标/线宽/角度都已按校准倍率换算过），
 * 输出是按 `layer` + `net` + 线宽分组的连续链；调用方负责删除旧图元与创建折线。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/** 端点比较容差（单位与坐标一致，PCB 里是 mil；1e-3 mil ≈ 0.025µm，足够容纳浮点误差） */
const DEFAULT_TOLERANCE = 1e-3;

/** 线宽比较容差：不同线宽的导线不能并成一条折线，否则会改变外观 */
const WIDTH_TOLERANCE = 1e-6;

/**
 * 把一段导线反转方向（用于「接在链头」的场景）
 *
 * 弧线反向时圆心角要取负：同一段圆弧从终点走回起点，扫掠方向相反。
 *
 * @param {object} seg - 段
 * @returns {object} 反转后的新段（不修改入参）
 */
export function reverseSegment(seg) {
	return {
		...seg,
		startX: seg.endX,
		startY: seg.endY,
		endX: seg.startX,
		endY: seg.startY,
		angle: seg.type === 'ARC' ? -seg.angle : seg.angle,
	};
}

/**
 * 判断两段是否属于同一组（可以合并进同一条折线）
 *
 * @param {object} a - 段
 * @param {object} b - 段
 * @returns {boolean}
 */
function sameGroup(a, b) {
	return a.layer === b.layer && (a.net || '') === (b.net || '') && Math.abs(a.width - b.width) <= WIDTH_TOLERANCE;
}

/**
 * 端点是否重合
 *
 * @param {number} ax - 点 A x
 * @param {number} ay - 点 A y
 * @param {number} bx - 点 B x
 * @param {number} by - 点 B y
 * @param {number} tol - 容差
 * @returns {boolean}
 */
function samePoint(ax, ay, bx, by, tol) {
	return Math.abs(ax - bx) <= tol && Math.abs(ay - by) <= tol;
}

/**
 * 段是否有效（坐标有限且长度不为 0）
 *
 * 无效段（NaN 坐标、零长度）不能参与拼链，也不能被删除 —— 调用方应先筛掉再删，
 * 否则会出现「删了但没建成」的丢图元。
 *
 * @param {object} seg - 段
 * @returns {boolean}
 */
export function isValidSegment(seg) {
	const nums = [seg.startX, seg.startY, seg.endX, seg.endY, seg.width];
	if (!nums.every((n) => Number.isFinite(n))) return false;
	if (seg.type === 'ARC' && !Number.isFinite(seg.angle)) return false;
	return !samePoint(seg.startX, seg.startY, seg.endX, seg.endY, 1e-9);
}

/**
 * 在剩余段里找一个能与「锚点」接上的段
 *
 * @param {Array<object>} list - 全部段
 * @param {boolean[]} used - 已使用的标记
 * @param {object} anchor - 锚点段（链尾或链首）
 * @param {'tail'|'head'} mode - tail：接在 anchor 终点之后；head：接在 anchor 起点之前
 * @param {number} tol - 端点容差
 * @returns {{index: number, reverse: boolean}|null} 命中的段下标及是否需要反转
 */
function findConnector(list, used, anchor, mode, tol) {
	for (let j = 0; j < list.length; j++) {
		if (used[j]) continue;
		const seg = list[j];
		if (!sameGroup(anchor, seg)) continue;
		if (mode === 'tail') {
			if (samePoint(anchor.endX, anchor.endY, seg.startX, seg.startY, tol)) return { index: j, reverse: false };
			if (samePoint(anchor.endX, anchor.endY, seg.endX, seg.endY, tol)) return { index: j, reverse: true };
		} else {
			if (samePoint(anchor.startX, anchor.startY, seg.endX, seg.endY, tol)) return { index: j, reverse: false };
			if (samePoint(anchor.startX, anchor.startY, seg.startX, seg.startY, tol)) return { index: j, reverse: true };
		}
	}
	return null;
}

/**
 * 把导线段拼成连续链
 *
 * 贪心算法：从任意未使用的段出发，先向「链尾」方向找能接上的段（起点或终点与链尾重合，
 * 终点对终点时需要反转），再向「链头」方向补；找不到就收工。多分支（三根线交于一点）
 * 时取第一个匹配，剩下的会在下一轮成为独立链 —— 这样不会丢图元。
 *
 * @param {Array<object>} segments - 归一化段数组
 *   `{ type:'L'|'ARC', layer:number, net:string, width:number, startX, startY, endX, endY, angle, item? }`
 * @param {number} [tolerance] - 端点容差
 * @returns {Array<{segments: Array<object>}>} 链数组（每项至少一段）
 */
export function buildWireChains(segments, tolerance = DEFAULT_TOLERANCE) {
	const list = (segments || []).filter(isValidSegment);
	const used = new Array(list.length).fill(false);
	const chains = [];
	const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : DEFAULT_TOLERANCE;

	for (let i = 0; i < list.length; i++) {
		if (used[i]) continue;
		used[i] = true;
		const chain = { segments: [list[i]] };

		// 1. 向链尾延伸
		for (let guard = 0; guard <= list.length; guard++) {
			const tail = chain.segments[chain.segments.length - 1];
			const hit = findConnector(list, used, tail, 'tail', tol);
			if (!hit) break;
			used[hit.index] = true;
			chain.segments.push(hit.reverse ? reverseSegment(list[hit.index]) : list[hit.index]);
		}

		// 2. 向链头延伸（接在链首的那一段，其终点必须落在链首起点上）
		for (let guard = 0; guard <= list.length; guard++) {
			const head = chain.segments[0];
			const hit = findConnector(list, used, head, 'head', tol);
			if (!hit) break;
			used[hit.index] = true;
			chain.segments.unshift(hit.reverse ? reverseSegment(list[hit.index]) : list[hit.index]);
		}

		chains.push(chain);
	}

	return chains;
}

/**
 * 把一条链拼成多边形路径数组（`pcb_MathPolygon.createPolygon` 的入参）
 *
 * 格式（官方：角度制，负值顺时针）：
 *   `[x0, y0, 'L', x1, y1, 'ARC', angle, x2, y2, ...]`
 *
 * @param {Array<object>} chainSegments - 已按顺序排好的段
 * @returns {Array<number|string>}
 */
export function buildPolygonPath(chainSegments) {
	if (!Array.isArray(chainSegments) || chainSegments.length === 0) return [];
	const first = chainSegments[0];
	const path = [first.startX, first.startY];
	for (const seg of chainSegments) {
		if (seg.type === 'ARC') {
			path.push('ARC', seg.angle, seg.endX, seg.endY);
		} else {
			path.push('L', seg.endX, seg.endY);
		}
	}
	return path;
}
