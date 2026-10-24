/**
 * @//module/ app/working-hours/charts/zoomModel
 * @//description/ dataZoom 窗口 → 聚簇大小 / Y 轴上限 / 刻度间隔 的纯计算
 * @//exports/ computeZoomWindow, computeVisibleMax, finalizeYMax
 * @//dependencies/ 无
 * @//example/ const win = computeZoomWindow(data.timeline, dz)
 *            const visibleMax = computeVisibleMax(data.timeline, { ...win, hiddenSeries })
 *            const yMax = finalizeYMax(visibleMax, win.dataYMax)
 *
 * 这三个数（聚簇大小 clusterSize、画布上限 dataYMax、动态 Y 上限 dynamicYMax）原本混在
 * 一个 70 行的 handleZoomOrPanCore 里，跟 DOM 图例刷新、setOption 缓存判断拧在一起，
 * 导致「缩放后柱子高度不对」这类问题只能靠肉眼复现。抽成纯函数后可以逐条断言。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/** 单格基础容量（秒）：一格 15 分钟 = 900 秒 */
const SLOT_CAPACITY_SEC = 900;

/** 一屏最多显示多少小时，超过就开始聚簇 */
const HOURS_PER_VIEW = 48;

/**
 * 由 dataZoom 窗口算出渲染参数
 *
 * @param {Array<{ts: number}>} timeline 时间轴
 * @param {{startValue?: number, endValue?: number}} dz echarts 的 dataZoom[0]
 * @returns {{startIdx: number, endIdx: number, safeDiffHours: number, clusterSize: number, dataYMax: number, hourInterval: number}} 渲染参数
 * @sideEffects 无（纯函数）
 */
export function computeZoomWindow(timeline, dz) {
	const totalSlots = timeline.length;
	let startIdx = 0;
	let endIdx = totalSlots - 1;

	if (dz && dz.startValue !== undefined) {
		startIdx = Math.max(0, Math.floor(dz.startValue));
		endIdx = Math.min(totalSlots - 1, Math.ceil(dz.endValue));
	}

	const exactDiffHours = (timeline[endIdx].ts - timeline[startIdx].ts) / (3600 * 1000);
	const safeDiffHours = Math.round(exactDiffHours * 10) / 10;
	const clusterSize = Math.max(1, Math.ceil(safeDiffHours / HOURS_PER_VIEW));

	return {
		startIdx: startIdx,
		endIdx: endIdx,
		safeDiffHours: safeDiffHours,
		clusterSize: clusterSize,
		dataYMax: clusterSize * SLOT_CAPACITY_SEC,
		hourInterval: Math.max(2, Math.ceil(safeDiffHours / 24) * 2),
	};
}

/**
 * 按可见工程累加一个时间格里的一侧工时
 *
 * @param {Record<string, number>} map 该格的 work 或 rest
 * @param {{filterPid: string|null, hiddenSeries: Set<string>, projectMeta: Record<string, string>}} ctx 过滤条件
 * @returns {number} 累加秒数
 * @sideEffects 无（纯函数）
 */
function sumVisible(map, ctx) {
	let total = 0;
	for (const pid in map) {
		if (ctx.filterPid && pid !== ctx.filterPid) continue;
		if (ctx.hiddenSeries.has(ctx.projectMeta[pid])) continue;
		total += map[pid];
	}
	return total;
}

/**
 * 计算当前窗口内「单个聚簇柱」的最大可见高度
 *
 * @param {Array<object>} timeline 时间轴
 * @param {object} opts 参数
 * @param {number} opts.startIdx 窗口起始下标
 * @param {number} opts.endIdx 窗口结束下标
 * @param {number} opts.clusterSize 聚簇大小
 * @param {boolean} opts.filterByUuid 是否只统计单个工程
 * @param {string|null} opts.filterUuid 被统计的工程
 * @param {Set<string>} opts.hiddenSeries 隐藏的 series 名
 * @param {Record<string, string>} opts.projectMeta 工程名表
 * @returns {number} 最大可见秒数
 * @sideEffects 无（纯函数）
 */
export function computeVisibleMax(timeline, opts) {
	const ctx = {
		filterPid: opts.filterByUuid ? opts.filterUuid : null,
		hiddenSeries: opts.hiddenSeries,
		projectMeta: opts.projectMeta,
	};
	const showWork = !ctx.hiddenSeries.has('工作时间');
	const showRest = !ctx.hiddenSeries.has('空闲时间');
	const blockStartIdx = Math.floor(opts.startIdx / opts.clusterSize) * opts.clusterSize;

	let visibleMax = 0;
	for (let i = blockStartIdx; i <= opts.endIdx; i += opts.clusterSize) {
		let blockTotal = 0;
		for (let k = 0; k < opts.clusterSize && i + k < timeline.length; k += 1) {
			const slot = timeline[i + k];
			if (showWork) blockTotal += sumVisible(slot.work, ctx);
			if (showRest) blockTotal += sumVisible(slot.rest, ctx);
		}
		if (blockTotal > visibleMax) visibleMax = blockTotal;
	}
	return visibleMax;
}

/**
 * 把可见最大值归整成 Y 轴上限（不足时给一个最小的可视范围，避免柱子顶到天花板）
 *
 * @param {number} visibleMax 可见最大秒数
 * @param {number} dataYMax 画布上限（clusterSize × 900）
 * @returns {number} Y 轴上限
 * @sideEffects 无（纯函数）
 */
export function finalizeYMax(visibleMax, dataYMax) {
	let yMax = Math.ceil(Math.min(visibleMax, dataYMax) / 60) * 60;
	if (yMax <= 0) yMax = Math.max(60, Math.floor(dataYMax / 3 / 60) * 60);
	return Math.min(yMax, dataYMax);
}
