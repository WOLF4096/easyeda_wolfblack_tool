/**
 * @//module/ app/working-hours/charts/options/heatmap
 * @//description/ 年度热力图（日历坐标系）的 option 工厂，纯函数
 * @//exports/ buildHeatmapOption, collectDaily, dayKey
 * @//dependencies/ app/working-hours/time
 * @//example/ view.setOption(buildHeatmapOption(data, 'dark', { nowTs: Date.now(), filterUuid: null }))
 *
 * 热力图的数据是「按天聚合」而不是原始 15 分钟格，所以单独一条聚合路径；
 * 它与导出报告里的 heatmapData 用的是同一套口径（`collectDaily` 直接被导出复用）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { formatDuration } from '../../time.js';

/** 一天的毫秒数 */
const DAY_MS = 24 * 3600 * 1000;

/** 热力图覆盖的天数（约一年） */
const SPAN_DAYS = 365;

/** 热力图配色分档（工作秒数） */
const PIECES = [
	{ min: 21601, color: '#56D364' },
	{ min: 14401, max: 21600, color: '#2EA043' },
	{ min: 7021, max: 14400, color: '#196C2E' },
	{ min: 1, max: 7200, color: '#033A16' },
];

/**
 * 把时间戳格式化成 `YYYY-MM-DD`
 *
 * @param {number} ts 时间戳
 * @returns {string} 日期串
 * @sideEffects 无（纯函数）
 */
export function dayKey(ts) {
	const d = new Date(ts);
	return [d.getFullYear(), (d.getMonth() + 1).toString().padStart(2, '0'), d.getDate().toString().padStart(2, '0')].join('-');
}

/**
 * 判断某个工程在这一侧的工时应否计入热力图
 *
 * @param {string} pid 工程 id
 * @param {object} ctx 过滤条件
 * @param {string} side '工作时间' 或 '空闲时间'
 * @returns {boolean} 计入返回 true
 * @sideEffects 无（纯函数）
 */
function counts(pid, ctx, side) {
	if (ctx.filterUuid && pid !== ctx.filterUuid) return false;
	if (ctx.hiddenSeries.has(side)) return false;
	return !ctx.hiddenSeries.has(ctx.projectMeta[pid]);
}

/**
 * 累加一个时间格到日统计
 *
 * @param {{work: number, rest: number}} dayStat 当天统计
 * @param {object} slot 时间格
 * @param {object} ctx 过滤条件
 * @returns {void}
 * @sideEffects 改写 `dayStat`
 */
function addSlot(dayStat, slot, ctx) {
	for (const pid in slot.work) {
		if (counts(pid, ctx, '工作时间')) dayStat.work += slot.work[pid];
	}
	for (const pid in slot.rest) {
		if (counts(pid, ctx, '空闲时间')) dayStat.rest += slot.rest[pid];
	}
}

/**
 * 按天聚合热力图数据
 *
 * @param {Array<object>} timeline 时间轴
 * @param {object} opts 参数
 * @param {string|null} [opts.filterUuid=null] 只统计某个工程
 * @param {Set<string>} [opts.hiddenSeries] 隐藏的 series 名（不传表示不过滤）
 * @param {Record<string, string>} [opts.projectMeta={}] 工程名表
 * @param {number} [opts.fromTs=0] 起始时间戳（早于它的格子跳过）
 * @param {boolean} [opts.includeEmpty=true] 是否保留「工作与空闲都为 0」的日子
 *        （图上保留，日历才有连续的底色；导出报告里去掉，省体积）
 * @returns {Array<[string, number, number]>} `[日期, 工作秒, 空闲秒]`
 * @sideEffects 无（纯函数）
 */
export function collectDaily(timeline, opts) {
	const ctx = {
		filterUuid: opts.filterUuid || null,
		hiddenSeries: opts.hiddenSeries || new Set(),
		projectMeta: opts.projectMeta || {},
	};
	const fromTs = opts.fromTs || 0;
	const includeEmpty = opts.includeEmpty !== false;
	const daily = new Map();

	for (const slot of timeline) {
		if (slot.ts < fromTs) continue;
		const key = dayKey(slot.ts);
		if (!daily.has(key)) daily.set(key, { work: 0, rest: 0 });
		addSlot(daily.get(key), slot, ctx);
	}

	const out = [];
	daily.forEach((stat, key) => {
		if (!includeEmpty && stat.work === 0 && stat.rest === 0) return;
		out.push([key, stat.work, stat.rest]);
	});
	return out;
}

/**
 * 构建热力图 option
 *
 * @param {Array<object>} data 时间轴
 * @param {string} theme 主题名（保留参数位以统一工厂签名）
 * @param {object} opts 参数
 * @param {number} opts.nowTs 当前时间戳（决定日历范围，测试可注入）
 * @param {string|null} [opts.filterUuid=null] 只统计某个工程
 * @param {Set<string>} [opts.hiddenSeries] 隐藏的 series 名
 * @param {Record<string, string>} [opts.projectMeta={}] 工程名表
 * @returns {object} echarts option
 * @sideEffects 无（纯函数）
 */
export function buildHeatmapOption(data, theme, opts) {
	const now = new Date(opts.nowTs);
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
	const startTs = todayStart - SPAN_DAYS * DAY_MS;

	const rows = collectDaily(data, {
		filterUuid: opts.filterUuid,
		hiddenSeries: opts.hiddenSeries,
		projectMeta: opts.projectMeta,
		fromTs: startTs,
	});

	return {
		backgroundColor: 'transparent',
		tooltip: {
			appendToBody: true,
			backgroundColor: 'rgba(37, 37, 38, 0.95)',
			borderColor: '#454545',
			borderWidth: 1,
			textStyle: { color: '#cccccc', fontSize: 12 },
			formatter: function formatter(p) {
				return `<b style="font-size:13px; color:#fff;">${p.value[0]}</b><br/>
                                <div style="margin-top:6px; font-size:12px;"><span class="color-block" style="background:#39d353;"></span> 工作时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(p.value[1] || 0)}</span></div>
                                <div style="margin-top:4px; font-size:12px;"><span class="color-block" style="background:#b0b0b0;"></span> 空闲时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(p.value[2] || 0)}</span></div>`;
			},
		},
		visualMap: {
			type: 'piecewise',
			show: false,
			dimension: 1,
			pieces: PIECES,
			outOfRange: { color: '#151B23' },
		},
		calendar: {
			top: 25,
			left: 45,
			right: 25,
			bottom: 15,
			range: [dayKey(startTs), dayKey(todayStart)],
			cellSize: ['auto', 14],
			itemStyle: { color: '#151B23', borderWidth: 4, borderColor: '#1e1e1e', borderRadius: 2 },
			yearLabel: { show: false },
			dayLabel: { color: '#858585', nameMap: 'ZH', fontSize: 10 },
			monthLabel: { color: '#858585', nameMap: 'ZH', fontSize: 10 },
			splitLine: { show: false },
		},
		series: { type: 'heatmap', coordinateSystem: 'calendar', data: rows, itemStyle: { borderRadius: 2 } },
	};
}
