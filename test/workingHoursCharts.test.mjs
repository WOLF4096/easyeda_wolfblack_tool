/**
 * 「工时统计」图表层单测：option 工厂 / 缩放计算 / 聚簇数据 / 图例 / 导出 payload
 *
 * 守的是什么：任务3 把 1736 行的页面入口拆成「纯函数 option 工厂 + 面板控制器」，
 * 拆分的**唯一**风险是图表看着一样但数值变了（少一个 series、yAxis 上限差一格、
 * dataZoom 窗口偏一天）。浏览器里肉眼看不出来，所以这里对关键字段逐项断言。
 *
 * 另外，拆分前定下的验收条件是：拆分前后要对 6 个 echarts 实例的
 * `getOption()` 做深度比对。那份比对是用 headless Chrome 拍的快照做的（结论：完全一致），
 * 这组用例是它的**长期替代品** —— 快照脚本是一次性的，这些断言会一直跑。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDataset } from '../iframe/js/src/app/working-hours/aggregate.js';
import { getDayAlignedIndices } from '../iframe/js/src/app/working-hours/dayRange.js';
import { buildTimelineOption } from '../iframe/js/src/app/working-hours/charts/options/timelineChart.js';
import { buildHeatmapOption, collectDaily, dayKey } from '../iframe/js/src/app/working-hours/charts/options/heatmap.js';
import { aggregateRhythm, computeAxisMax, buildRhythmOption } from '../iframe/js/src/app/working-hours/charts/options/rhythm.js';
import { getWeekInfo, aggregateWeekly, pickTopProject, buildWeeklyBarOption, buildWeeklyPieOption } from '../iframe/js/src/app/working-hours/charts/options/weekly.js';
import { computeZoomWindow, computeVisibleMax, finalizeYMax } from '../iframe/js/src/app/working-hours/charts/zoomModel.js';
import { buildClusterSeries, buildHourIntervalFormatter } from '../iframe/js/src/app/working-hours/charts/seriesData.js';
import { buildLegendHtml } from '../iframe/js/src/app/working-hours/charts/legendHtml.js';
import { buildTotalTrendPayload, collectHeatmapForExport, findDataRange } from '../iframe/js/src/app/working-hours/exportPayload.js';
import { stripProjectFromDay } from '../iframe/js/src/app/working-hours/views/dataAdmin.js';

const NOW = new Date(2026, 9, 22, 10, 30, 0).getTime();
const DAY_MS = 24 * 3600 * 1000;

/**
 * 造一份固定数据集：10-19 ~ 10-21 三天，p1 / p2 两个工程
 *
 * @returns {object} buildDataset 的返回值
 * @sideEffects 无
 */
function makeDataset() {
	const configs = {};
	[
		[2026, 9, 19],
		[2026, 9, 20],
		[2026, 9, 21],
	].forEach(([y, m, d], di) => {
		const key = `STATS_${y}_${String(m + 1).padStart(2, '0')}_${String(d).padStart(2, '0')}`;
		const slots = {};
		/* 09:00 ~ 12:00 共 12 格：p1 工作 600s / p2 工作 300s + 空闲 120s */
		for (let s = 36; s < 48; s += 1) {
			slots[String(s)] = { p1: [600 + di * 60, 0], p2: [300, 120] };
		}
		configs[key] = JSON.stringify({ meta: { p1: '主控板', p2: '电源模块' }, slots: slots });
	});
	return buildDataset(configs, { currentUuid: 'p1', currentName: '主控板', now: new Date(NOW) });
}

const DS = makeDataset();

/**
 * 组装工厂需要的 data 包
 *
 * @param {Set<string>} [hidden] 隐藏的 series
 * @returns {object} 数据包
 * @sideEffects 无
 */
function dataBundle(hidden) {
	return {
		timeline: DS.timeline,
		tsMap: DS.tsMap,
		projectMeta: DS.projectMeta,
		projectStats: DS.projectStats,
		sortedProjectIds: DS.sortedProjectIds,
		pidColorMap: DS.pidColorMap,
		todayTs: DS.todayTs,
		hiddenSeries: hidden || new Set(),
	};
}

describe('工时图表：时间轴 option（总趋势 / 工程详情 / 工程管理）', () => {
	const bounds = { startValue: 0, endValue: 95 };
	const opts = {
		bounds: bounds,
		isManage: false,
		getClusterSize: () => 1,
		getActiveTab: () => 'total',
		getCurrentUuid: () => 'p1',
	};

	it('两条 series：占位柱 + custom 矩形', () => {
		const option = buildTimelineOption(dataBundle(), 'dark', opts);
		assert.equal(option.series.length, 2);
		assert.equal(option.series[0].type, 'bar');
		assert.equal(option.series[1].type, 'custom');
		// 占位柱与时间轴等长（custom 的 x 轴需要一根等宽的底柱来换算 band）
		assert.equal(option.series[0].data.length, DS.timeline.length);
		assert.deepEqual(option.series[1].data, []);
	});

	it('X 轴是完整时间轴，dataZoom 用传入的窗口', () => {
		const option = buildTimelineOption(dataBundle(), 'dark', opts);
		assert.equal(option.xAxis.data.length, DS.timeline.length);
		assert.equal(option.dataZoom[0].startValue, 0);
		assert.equal(option.dataZoom[0].endValue, 95);
		assert.equal(option.dataZoom[0].type, 'inside');
	});

	it('yAxis 初始上限固定 900（=15 分钟一格），管理图 grid.top 更小', () => {
		assert.equal(buildTimelineOption(dataBundle(), 'dark', opts).yAxis.max, 900);
		const manage = buildTimelineOption(dataBundle(), 'dark', { ...opts, isManage: true, specificUuid: 'p1' });
		assert.equal(manage.grid.top, 15);
		assert.equal(buildTimelineOption(dataBundle(), 'dark', opts).grid.top, 20);
	});

	it('tooltip 只列有工时的工程，并给出该块的起止时刻', () => {
		const option = buildTimelineOption(dataBundle(), 'dark', opts);
		const ts = DS.timeline[40].ts; // 10:00 那一格
		const html = option.tooltip.formatter([{ axisValue: ts }]);
		assert.match(html, /主控板/);
		assert.match(html, /电源模块/);
		assert.match(html, /空闲时间/);
		assert.match(html, /10:00/);
	});

	it('tooltip 在没有任何记录的时间格里给出「无活动记录」', () => {
		const option = buildTimelineOption(dataBundle(), 'dark', opts);
		const ts = DS.timeline[2].ts; // 00:30，种子数据里是空的
		assert.match(option.tooltip.formatter([{ axisValue: ts }]), /无活动记录/);
	});

	it('隐藏「空闲时间」后 tooltip 不再出现空闲行', () => {
		const option = buildTimelineOption(dataBundle(new Set(['空闲时间'])), 'dark', opts);
		const ts = DS.timeline[40].ts;
		assert.equal(/空闲时间/.test(option.tooltip.formatter([{ axisValue: ts }])), false);
	});

	it('renderItem 产出矩形（高度为 0 时返回 undefined 而不报错）', () => {
		const option = buildTimelineOption(dataBundle(), 'dark', opts);
		const api = {
			value: (i) => [0, 100, 500, 'p1', 1][i],
			coord: (pair) => [pair[0] * 10 + pair[1] / 100, 200 - pair[1] / 10],
			size: () => [10, 0],
			style: (s) => s,
		};
		const rect = option.series[1].renderItem({}, api);
		assert.equal(rect.type, 'rect');
		assert.equal(rect.style.fill, DS.pidColorMap.p1);
		assert.equal(option.series[1].renderItem({}, { ...api, value: () => 0, coord: () => [0, 0] }), undefined);
	});
});

describe('工时图表：热力图 option', () => {
	it('日历坐标 + 4 档配色 + 按天聚合的数据', () => {
		const option = buildHeatmapOption(DS.timeline, 'dark', { nowTs: NOW, projectMeta: DS.projectMeta });
		assert.equal(option.series.type, 'heatmap');
		assert.equal(option.series.coordinateSystem, 'calendar');
		assert.equal(option.visualMap.pieces.length, 4);
		assert.equal(option.series.data.length, 4); // 10-19 ~ 10-22（今天无记录也算一天）
		assert.deepEqual(option.calendar.range, [dayKey(new Date(2025, 9, 22).getTime()), '2026-10-22']);
	});

	it('只要某一天没有记录，热力图仍保留这一格（日历底色才连续）', () => {
		const rows = collectDaily(DS.timeline, { includeEmpty: true });
		const today = rows.find((r) => r[0] === '2026-10-22');
		assert.ok(today);
		assert.deepEqual(today, ['2026-10-22', 0, 0]);
	});

	it('导出用的热力图去掉空白天', () => {
		const rows = collectHeatmapForExport(DS.timeline, null);
		assert.equal(rows.length, 3);
		assert.equal(rows.some((r) => r[0] === '2026-10-22'), false);
	});

	it('只看某个工程时只统计该工程', () => {
		const rows = collectDaily(DS.timeline, { filterUuid: 'p2', includeEmpty: false });
		assert.equal(rows.length, 3);
		assert.deepEqual(rows[0], ['2026-10-19', 12 * 300, 12 * 120]);
	});
});

describe('工时图表：节律极坐标', () => {
	it('96 格聚合：工作时间按格子累加', () => {
		const agg = aggregateRhythm(DS.timeline, { mode: 'time' });
		assert.equal(agg.work.length, 96);
		/* 三天 × 每天 12 格，每格 p1 600/p2 300，但 p1 每天 +di*60 递增 */
		const slot36 = (600 + 0) + 300 + (600 + 60) + 300 + (600 + 120) + 300;
		assert.equal(agg.work[36], slot36);
		assert.equal(agg.rest[36], 3 * 12 * 120 / 12);
	});

	it('时间窗口之外的格子不计入', () => {
		const firstDay = new Date(2026, 9, 20, 0, 0, 0).getTime();
		const agg = aggregateRhythm(DS.timeline, { mode: 'time', rangeStart: firstDay });
		assert.equal(agg.work[10], 0);
		assert.ok(agg.work[36] > 0);
	});

	it('工程维度只取该工程；没有选中工程时全为 0', () => {
		const one = aggregateRhythm(DS.timeline, { mode: 'project', targetUuid: 'p2' });
		assert.equal(one.work[36], 3 * 300);
		const none = aggregateRhythm(DS.timeline, { mode: 'project' });
		assert.equal(none.work.reduce((a, b) => a + b, 0), 0);
	});

	it('半径上限按「工作+空闲」叠加后的最大值等比放大，留 4% 余量', () => {
		const work = new Float64Array(96).fill(0);
		const rest = new Float64Array(96).fill(0);
		work[0] = 100;
		rest[0] = 50;
		assert.equal(computeAxisMax(work, rest, true, true), 150 / 0.96);
		assert.equal(computeAxisMax(work, rest, true, false), 100 / 0.96);
		assert.equal(computeAxisMax(new Float64Array(96), new Float64Array(96), true, true), 100);
	});

	it('option：96 个类目、两根堆叠柱、隐藏的 series 用 0 填充', () => {
		const work = new Float64Array(96).fill(10);
		const rest = new Float64Array(96).fill(5);
		const option = buildRhythmOption(
			{ work: work, rest: rest, showWork: true, showRest: false, axisMax: 20 },
			'dark',
			{ makeGradient: (stops) => ({ gradient: stops }) }
		);
		assert.equal(option.angleAxis.data.length, 96);
		assert.equal(option.angleAxis.data[0], '00:00');
		assert.equal(option.angleAxis.data[95], '23:45');
		assert.equal(option.series.length, 2);
		assert.equal(option.series[0].data[0], 10);
		assert.equal(option.series[1].data[0], 0);
		assert.equal(option.radiusAxis.max, 20);
		assert.deepEqual(option.series[0].itemStyle.color.gradient, [
			{ offset: 0, color: '#007acc' },
			{ offset: 1, color: '#3ba272' },
		]);
	});
});

describe('工时图表：周报', () => {
	it('周区间以周一为锚点（周日 getDay()=0 不能算成下一周）', () => {
		/* 2026-10-22 是周四 → 本周一是 10-19 */
		const info = getWeekInfo(0, NOW);
		assert.equal(new Date(info.monday).getDate(), 19);
		assert.equal(new Date(info.sunday).getDate(), 25);
		assert.match(info.rangeText, /2026 第 \d+ 周 \(10\.19 - 10\.25\)/);
		assert.equal(new Date(getWeekInfo(-1, NOW).monday).getDate(), 12);
	});

	it('聚合：7 天数组、按工程与总计分别累加', () => {
		const info = getWeekInfo(0, NOW);
		const agg = aggregateWeekly(DS.timeline, info.monday);
		assert.equal(agg.weekData.length, 7);
		assert.equal(agg.weekData[0].work.p1, 12 * 600); // 周一：12 格 × 600
		assert.equal(agg.weekData[0].totalWork, 12 * 600 + 12 * 300);
		assert.equal(agg.projectTotals.p1, 12 * (600 + 660 + 720));
		assert.equal(agg.totalSeconds, agg.projectTotals.p1 + agg.projectTotals.p2);
	});

	it('本周之外的记录不计入', () => {
		const info = getWeekInfo(1, NOW);
		assert.equal(aggregateWeekly(DS.timeline, info.monday).totalSeconds, 0);
	});

	it('工时最多的工程', () => {
		assert.equal(pickTopProject({ p1: 10, p2: 90 }, { p1: 'A', p2: 'B' }), 'B');
		assert.equal(pickTopProject({}, {}), '--');
	});

	it('柱状图：没有工时的工程不出 series；饼图按工时倒序', () => {
		const info = getWeekInfo(0, NOW);
		const agg = aggregateWeekly(DS.timeline, info.monday);
		const bundle = { weekData: agg.weekData, projectMeta: DS.projectMeta, pidColorMap: DS.pidColorMap, sortedProjectIds: DS.sortedProjectIds };

		const bar = buildWeeklyBarOption(bundle, 'dark');
		assert.equal(bar.series.length, 2);
		assert.equal(bar.series[0].stack, 'total');
		assert.equal(bar.xAxis.data.length, 7);
		assert.equal(bar.xAxis.data[0], '周一');

		const empty = buildWeeklyBarOption({ ...bundle, sortedProjectIds: ['nobody'] }, 'dark');
		assert.equal(empty.series.length, 0);

		const pie = buildWeeklyPieOption({ projectTotals: { p1: 10, p2: 90 }, projectMeta: DS.projectMeta, pidColorMap: DS.pidColorMap }, 'dark');
		assert.equal(pie.series[0].data[0].name, '电源模块');
		assert.equal(pie.series[0].data[0].value, 90);
	});
});

describe('工时图表：缩放计算', () => {
	const timeline = DS.timeline;

	it('一天窗口 → 不聚簇，画布上限 900', () => {
		const win = computeZoomWindow(timeline, { startValue: 288, endValue: 383 });
		assert.equal(win.startIdx, 288);
		assert.equal(win.endIdx, 383);
		assert.equal(win.clusterSize, 1);
		assert.equal(win.dataYMax, 900);
		assert.equal(win.hourInterval, 2);
	});

	it('整条时间轴（首尾 95.8 小时）→ 聚簇 2 格，刻度 8 小时', () => {
		const win = computeZoomWindow(timeline, { startValue: 0, endValue: timeline.length - 1 });
		assert.equal(win.safeDiffHours, 95.8);
		assert.equal(win.clusterSize, 2);
		assert.equal(win.dataYMax, 1800);
		assert.equal(win.hourInterval, 8);
	});

	it('没有 dataZoom 时退化成全窗口', () => {
		const win = computeZoomWindow(timeline, {});
		assert.equal(win.startIdx, 0);
		assert.equal(win.endIdx, timeline.length - 1);
	});

	it('可见最大值只统计窗口内、可见的工程', () => {
		const base = { startIdx: 36, endIdx: 47, clusterSize: 1, hiddenSeries: new Set(), projectMeta: DS.projectMeta };
		/* 窗口 36~47 只覆盖首日：工作 600 + 300、空闲 120 → 1020 */
		assert.equal(computeVisibleMax(timeline, { ...base, filterByUuid: false }), 1020);
		assert.equal(computeVisibleMax(timeline, { ...base, filterByUuid: true, filterUuid: 'p2' }), 420);
		assert.equal(computeVisibleMax(timeline, { ...base, filterByUuid: false, hiddenSeries: new Set(['空闲时间']) }), 900);
		assert.equal(computeVisibleMax(timeline, { ...base, filterByUuid: false, hiddenSeries: new Set(['工作时间']) }), 120);
		assert.equal(computeVisibleMax(timeline, { ...base, filterByUuid: false, hiddenSeries: new Set(['工作时间', '空闲时间']) }), 0);
	});

	it('Y 上限归整到分钟并对齐画布上限', () => {
		assert.equal(finalizeYMax(893, 900), 900);
		assert.equal(finalizeYMax(0, 900), 300);
		assert.equal(finalizeYMax(5000, 1800), 1800);
	});
});

describe('工时图表：聚簇数据', () => {
	it('按工程从下往上叠', () => {
		const rows = buildClusterSeries(dataBundle(), { clusterSize: 1, yMax: 900, filterPid: null });
		assert.equal(rows.length, 12 * 3 * 2); // 每天 12 格 × 3 天 × 2 个工程
		assert.deepEqual(rows[0], [36, 0, 600, 'p1', 1]);
		assert.deepEqual(rows[1], [36, 600, 900, 'p2', 1]);
		assert.deepEqual(rows[2], [37, 0, 600, 'p1', 1]);
	});

	it('画布还有空间时补一段 REST（顶到上限就不画了）', () => {
		const rows = buildClusterSeries(dataBundle(), { clusterSize: 1, yMax: 2000, filterPid: null });
		assert.deepEqual(rows[2], [36, 900, 1020, 'REST', 1]);
		/* yMax 恰好等于工作总和时，REST 被夹掉 —— 与拆分前一致 */
		const tight = buildClusterSeries(dataBundle(), { clusterSize: 1, yMax: 900, filterPid: null });
		assert.equal(tight.some((r) => r[3] === 'REST'), false);
	});

	it('超出画布上限时被夹住，不会画出轴外', () => {
		const rows = buildClusterSeries(dataBundle(), { clusterSize: 1, yMax: 500, filterPid: null });
		const workRow = rows.find((r) => r[3] === 'p1');
		assert.deepEqual(workRow, [36, 0, 500, 'p1', 1]);
		assert.equal(rows.some((r) => r[3] === 'p2'), false);
		assert.equal(rows.some((r) => r[3] === 'REST'), false);
	});

	it('只看单个工程', () => {
		const rows = buildClusterSeries(dataBundle(), { clusterSize: 1, yMax: 900, filterPid: 'p2' });
		assert.deepEqual(rows[0], [36, 0, 300, 'p2', 1]);
		assert.equal(rows.some((r) => r[3] === 'p1'), false);
	});

	it('X 轴刻度：整点才显示，跨度大时按间隔跳', () => {
		const every2h = buildHourIntervalFormatter(2);
		const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
		assert.equal(every2h(0, at(0, 0)), true, '零点总是显示');
		assert.equal(every2h(0, at(10, 0)), true);
		assert.equal(every2h(0, at(11, 0)), false);
		assert.equal(every2h(0, at(10, 15)), false);
	});
});

describe('工时图表：图例', () => {
	it('只列窗口里出现过的工程；有工作时间才追加「工作时间」', () => {
		const html = buildLegendHtml(dataBundle(), { startIdx: 36, endIdx: 47, targetUuid: null });
		assert.match(html, /主控板/);
		assert.match(html, /电源模块/);
		assert.match(html, /工作时间/);
		assert.match(html, /空闲时间/);
	});

	it('隐藏状态体现为 hidden 类', () => {
		const html = buildLegendHtml(dataBundle(new Set(['主控板', '空闲时间'])), { startIdx: 36, endIdx: 47, targetUuid: null });
		assert.match(html, /legend-item hidden" data-name="主控板"/);
		assert.match(html, /legend-item hidden" data-name="空闲时间"/);
	});

	it('窗口里没有任何记录时给出提示而不是空串', () => {
		const html = buildLegendHtml(dataBundle(), { startIdx: 0, endIdx: 3, targetUuid: null });
		assert.equal(html, '<div style="color:#666; font-size:11px;">当前区间无记录</div>');
	});

	it('只看单个工程时只输出该工程', () => {
		const html = buildLegendHtml(dataBundle(), { startIdx: 36, endIdx: 47, targetUuid: 'p2' });
		assert.match(html, /电源模块/);
		assert.equal(html.includes('主控板'), false);
	});
});

describe('工时图表：整日对齐 / 导出 payload / 存储清洗', () => {
	it('「今天」窗口止于明天零点（有时间轴末日数据时）', () => {
		const bounds = getDayAlignedIndices(DS.todayTs, DS.todayTs, DS.timeline, DS.tsMap, DS.todayTs);
		assert.equal(bounds.startValue, DS.tsMap.get(DS.todayTs));
		/* 10-22 是时间轴最后一天，没有 10-23 的数据 → 止于末尾 */
		assert.equal(bounds.endValue, DS.timeline.length - 1);
	});

	it('工程窗口覆盖它自己的首尾整天', () => {
		const p1 = DS.projectStats.p1;
		const bounds = getDayAlignedIndices(p1.startTs, p1.endTs, DS.timeline, DS.tsMap, DS.todayTs);
		assert.equal(bounds.startValue, DS.tsMap.get(new Date(2026, 9, 19, 0, 0, 0).getTime()));
		assert.equal(bounds.endValue, DS.tsMap.get(new Date(2026, 9, 22, 0, 0, 0).getTime()));
	});

	it('全量趋势 payload：baseTs/totalSlots 与 timeData 相对下标一致', () => {
		const payload = buildTotalTrendPayload(dataBundle());
		assert.equal(payload.baseTs, new Date(2026, 9, 19, 9, 0, 0).getTime());
		/* 首格 09:00（下标 36）→ 末格 10-21 20:45（下标 239），共 204 格 */
		assert.equal(payload.totalSlots, 204);
		assert.deepEqual(payload.data[0][0], 0);
		assert.equal(payload.data[0][1].p1, 600);
		assert.equal(payload.heatmapData.length, 3);
		assert.deepEqual(Object.keys(payload.projectMeta).sort(), ['p1', 'p2']);
	});

	it('全空数据不产出 payload', () => {
		const empty = buildDataset({}, { now: new Date(NOW) });
		assert.equal(buildTotalTrendPayload({ ...empty, hiddenSeries: new Set() }), null);
		assert.deepEqual(findDataRange(empty.timeline), { minIdx: -1, maxIdx: -1 });
	});

	it('删除工程：清掉 slots 里该工程，空掉的时间格整个删除', () => {
		const day = { meta: { p1: 'A', p2: 'B' }, slots: { 36: { p1: [1, 0], p2: [2, 0] }, 37: { p1: [3, 0] } } };
		assert.equal(stripProjectFromDay(day, 'p1'), true);
		assert.deepEqual(day.slots[36], { p2: [2, 0] });
		assert.equal('37' in day.slots, false);
		assert.deepEqual(day.meta, { p2: 'B' });
	});

	it('删除工程：没命中时返回 false（避免无谓写盘）', () => {
		const day = { meta: { p2: 'B' }, slots: { 36: { p2: [2, 0] } } };
		assert.equal(stripProjectFromDay(day, 'p9'), false);
	});
});
