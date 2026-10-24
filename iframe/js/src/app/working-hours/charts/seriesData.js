/**
 * @//module/ app/working-hours/charts/seriesData
 * @//description/ 把时间轴按聚簇大小压成 custom series 的矩形数据（纯函数）
 * @//exports/ buildClusterSeries, buildHourIntervalFormatter
 * @//dependencies/ 无
 * @//example/ const d = buildClusterSeries(data, { clusterSize: 4, yMax: 3600, filterPid: null })
 *            chart.setOption({ series: [{}, { data: d }] })
 *
 * custom series 的每一条数据是 `[起始格下标, 底部Y, 顶部Y, 工程id, 聚簇宽度]`，
 * 由 renderItem 换算成矩形的像素坐标。这里只负责「算数值」，不碰像素。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 合并一段连续格子的某一侧工时
 *
 * @param {Array<object>} timeline 时间轴
 * @param {number} from 起始下标
 * @param {number} clusterSize 聚簇大小
 * @param {string|null} filterPid 只合并某个工程（null 表示全部）
 * @param {'work'|'rest'} side 哪一侧
 * @returns {Record<string, number>} 工程 id → 秒数
 * @sideEffects 无（纯函数）
 */
function mergeSide(timeline, from, clusterSize, filterPid, side) {
	const merged = {};
	for (let k = 0; k < clusterSize && from + k < timeline.length; k += 1) {
		const bucket = timeline[from + k][side];
		for (const pid in bucket) {
			if (filterPid && pid !== filterPid) continue;
			merged[pid] = (merged[pid] || 0) + bucket[pid];
		}
	}
	return merged;
}

/**
 * 合并一段连续的原始格子
 *
 * @param {Array<object>} timeline 时间轴
 * @param {number} from 起始下标
 * @param {number} clusterSize 聚簇大小
 * @param {string|null} filterPid 只合并某个工程（null 表示全部）
 * @returns {{work: Record<string, number>, rest: Record<string, number>}} 合并结果
 * @sideEffects 无（纯函数）
 */
function mergeRange(timeline, from, clusterSize, filterPid) {
	return {
		work: mergeSide(timeline, from, clusterSize, filterPid, 'work'),
		rest: mergeSide(timeline, from, clusterSize, filterPid, 'rest'),
	};
}

/**
 * 把一个聚簇里的各工程工作时间堆成矩形（从底部往上叠）
 *
 * @param {Array<Array>} out 输出数组
 * @param {object} ctx 上下文
 * @returns {number} 叠完后的底部偏移
 * @sideEffects 追加到 `out`
 */
function appendWorkBlocks(out, ctx) {
	let yOffset = 0;
	for (const pid of ctx.sortedProjectIds) {
		if (ctx.filterPid && pid !== ctx.filterPid) continue;
		if (ctx.hiddenSeries.has(ctx.projectMeta[pid])) continue;
		const val = ctx.work[pid] || 0;
		if (val <= 0) continue;
		if (yOffset >= ctx.yMax) break;

		let height = val;
		let nextOffset = yOffset + height;
		if (nextOffset > ctx.yMax) {
			height = ctx.yMax - yOffset;
			nextOffset = ctx.yMax;
		}
		out.push([ctx.index, yOffset, nextOffset, pid, ctx.clusterSize]);
		yOffset = nextOffset;
	}
	return yOffset;
}

/**
 * 在顶部补一段空闲时间
 *
 * @param {Array<Array>} out 输出数组
 * @param {object} ctx 上下文（含 yOffset / rest）
 * @returns {void}
 * @sideEffects 追加到 `out`
 */
function appendRestBlock(out, ctx) {
	if (ctx.hiddenSeries.has('空闲时间') || ctx.yOffset >= ctx.yMax) return;

	let totalRest = 0;
	for (const pid in ctx.rest) {
		if (ctx.hiddenSeries.has(ctx.projectMeta[pid])) continue;
		totalRest += ctx.rest[pid];
	}
	if (totalRest <= 0) return;

	let height = totalRest;
	let nextOffset = ctx.yOffset + height;
	if (nextOffset > ctx.yMax) {
		height = ctx.yMax - ctx.yOffset;
		nextOffset = ctx.yMax;
	}
	out.push([ctx.index, ctx.yOffset, nextOffset, 'REST', ctx.clusterSize]);
}

/**
 * 生成 custom series 的数据
 *
 * @param {object} data 数据集
 * @param {Array<object>} data.timeline 时间轴
 * @param {string[]} data.sortedProjectIds 按工时排序的工程 id
 * @param {Record<string, string>} data.projectMeta 工程名表
 * @param {Set<string>} data.hiddenSeries 隐藏的 series 名
 * @param {object} opts 参数
 * @param {number} opts.clusterSize 聚簇大小
 * @param {number} opts.yMax 画布上限
 * @param {string|null} opts.filterPid 只看某个工程
 * @returns {Array<Array>} custom series 数据
 * @sideEffects 无（纯函数）
 */
export function buildClusterSeries(data, opts) {
	const out = [];
	const filterPid = opts.filterPid || null;

	for (let i = 0; i < data.timeline.length; i += opts.clusterSize) {
		const merged = mergeRange(data.timeline, i, opts.clusterSize, filterPid);
		let yOffset = 0;
		if (!data.hiddenSeries.has('工作时间')) {
			yOffset = appendWorkBlocks(out, {
				index: i,
				clusterSize: opts.clusterSize,
				yMax: opts.yMax,
				work: merged.work,
				sortedProjectIds: data.sortedProjectIds,
				projectMeta: data.projectMeta,
				hiddenSeries: data.hiddenSeries,
				filterPid: filterPid,
			});
		}
		appendRestBlock(out, {
			index: i,
			clusterSize: opts.clusterSize,
			yMax: opts.yMax,
			yOffset: yOffset,
			rest: merged.rest,
			projectMeta: data.projectMeta,
			hiddenSeries: data.hiddenSeries,
		});
	}
	return out;
}

/**
 * 生成 X 轴刻度间隔判断函数（整点显示，跨度大时按 2/4/6… 小时间隔）
 *
 * @param {number} hourInterval 小时间隔
 * @returns {(index: number, value: number) => boolean} echarts axisLabel.interval
 * @sideEffects 无（纯函数）
 */
export function buildHourIntervalFormatter(hourInterval) {
	return function interval(index, value) {
		const d = new Date(Number(value));
		if (d.getMinutes() !== 0) return false;
		if (d.getHours() === 0) return true;
		return d.getHours() % hourInterval === 0;
	};
}
