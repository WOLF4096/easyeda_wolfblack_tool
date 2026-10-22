/**
 * @//module/ app/working-hours/charts/options/weekly
 * @//description/ 周报（每日堆叠柱状 + 项目占比饼图）：周区间计算、聚合与 option 工厂，纯函数
 * @//exports/ getWeekInfo, aggregateWeekly, pickTopProject, buildWeeklyBarOption, buildWeeklyPieOption
 * @//dependencies/ app/working-hours/time
 * @//example/ const info = getWeekInfo(-1, Date.now())
 *            const agg = aggregateWeekly(timeline, info.monday)
 *            barView.setOption(buildWeeklyBarOption({ ...agg, ...data }, 'dark', {}), true)
 *
 * 周区间以「周一 00:00」为锚点：JS 的 getDay() 里周日是 0，这里 `|| 7` 把它归一成 7，
 * 否则周日会被算到下一周的第一天。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { formatDuration } from '../../time.js';

/** 一天毫秒数 */
const DAY_MS = 24 * 3600 * 1000;

/** 周内天数 */
const WEEK_DAYS = 7;

/** 周内中文标签 */
const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 计算某一周的起止与展示文案
 *
 * @param {number} offset 0 是本周，-1 是上周
 * @param {number} nowTs 当前时间戳（测试可注入）
 * @returns {{monday: number, sunday: number, rangeText: string}} 周信息
 * @sideEffects 无（纯函数）
 */
export function getWeekInfo(offset, nowTs) {
	const now = new Date(nowTs);
	const day = now.getDay() || WEEK_DAYS;
	const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);

	const monday = new Date(thisMonday.getTime() + offset * WEEK_DAYS * DAY_MS);
	const sunday = new Date(monday.getTime() + (WEEK_DAYS - 1) * DAY_MS);

	const startOfYear = new Date(monday.getFullYear(), 0, 1);
	const weekNum = Math.ceil(((monday - startOfYear) / 86400000 + startOfYear.getDay() + 1) / WEEK_DAYS);

	return {
		monday: monday.getTime(),
		sunday: sunday.getTime(),
		rangeText: `${monday.getFullYear()} 第 ${weekNum} 周 (${monday.getMonth() + 1}.${monday.getDate()} - ${sunday.getMonth() + 1}.${sunday.getDate()})`,
	};
}

/**
 * 聚合一周的每日工时
 *
 * @param {Array<object>} timeline 时间轴
 * @param {number} mondayTs 周一 00:00 的时间戳
 * @returns {{weekData: Array<{work: Record<string, number>, totalWork: number}>, projectTotals: Record<string, number>, totalSeconds: number}} 聚合结果
 * @sideEffects 无（纯函数）
 */
export function aggregateWeekly(timeline, mondayTs) {
	const weekData = Array.from({ length: WEEK_DAYS }, () => ({ work: {}, totalWork: 0 }));
	const projectTotals = {};
	let totalSeconds = 0;

	for (const slot of timeline) {
		if (slot.ts < mondayTs || slot.ts >= mondayTs + WEEK_DAYS * DAY_MS) continue;
		const dayIdx = Math.floor((slot.ts - mondayTs) / DAY_MS);
		if (dayIdx < 0 || dayIdx >= WEEK_DAYS) continue;

		for (const pid in slot.work) {
			const sec = slot.work[pid];
			weekData[dayIdx].work[pid] = (weekData[dayIdx].work[pid] || 0) + sec;
			weekData[dayIdx].totalWork += sec;
			projectTotals[pid] = (projectTotals[pid] || 0) + sec;
			totalSeconds += sec;
		}
	}

	return { weekData: weekData, projectTotals: projectTotals, totalSeconds: totalSeconds };
}

/**
 * 找出本周投入最多的工程
 *
 * @param {Record<string, number>} projectTotals 工程总秒数
 * @param {Record<string, string>} projectMeta 工程名表
 * @returns {string} 工程名；没有数据返回 '--'
 * @sideEffects 无（纯函数）
 */
export function pickTopProject(projectTotals, projectMeta) {
	let topPid = '--';
	let maxSec = 0;
	for (const pid in projectTotals) {
		if (projectTotals[pid] <= maxSec) continue;
		maxSec = projectTotals[pid];
		topPid = projectMeta[pid] || pid;
	}
	return topPid;
}

/**
 * 构建周报堆叠柱状图 option
 *
 * @param {object} data 数据
 * @param {object[]} data.weekData 每日聚合
 * @param {Record<string, string>} data.projectMeta 工程名表
 * @param {Record<string, string>} data.pidColorMap 工程颜色
 * @param {string[]} data.sortedProjectIds 按总工时排序的工程 id
 * @param {string} theme 主题名（保留参数位以统一工厂签名）
 * @returns {object} echarts option
 * @sideEffects 无（纯函数）
 */
export function buildWeeklyBarOption(data, theme) {
	const series = data.sortedProjectIds
		.map((pid) => ({
			name: data.projectMeta[pid],
			type: 'bar',
			stack: 'total',
			data: data.weekData.map((d) => d.work[pid] || 0),
			itemStyle: { color: data.pidColorMap[pid] },
		}))
		.filter((s) => s.data.some((v) => v > 0));

	return {
		backgroundColor: 'transparent',
		tooltip: {
			trigger: 'axis',
			backgroundColor: 'rgba(37, 37, 38, 0.95)',
			borderColor: '#454545',
			borderWidth: 1,
			textStyle: { color: '#cccccc', fontSize: 12 },
			formatter: (params) => {
				let h = `<b style="color:#fff;">${params[0].name}</b><br/>`;
				params.forEach((p) => {
					if (p.value > 0) h += `${p.marker} ${p.seriesName}: <span style="float:right; font-weight:bold; margin-left:15px; color:#fff;">${formatDuration(p.value)}</span><br/>`;
				});
				return h;
			},
		},
		grid: { top: 30, left: 70, right: 10, bottom: 30 },
		xAxis: { type: 'category', data: DAY_LABELS, axisLabel: { color: '#858585' } },
		yAxis: { type: 'value', axisLabel: { color: '#858585', formatter: (value) => formatDuration(value) }, splitLine: { lineStyle: { color: '#333' } } },
		series: series,
	};
}

/**
 * 构建周报项目占比饼图 option
 *
 * @param {object} data 数据
 * @param {Record<string, number>} data.projectTotals 工程总秒数
 * @param {Record<string, string>} data.projectMeta 工程名表
 * @param {Record<string, string>} data.pidColorMap 工程颜色
 * @param {string} theme 主题名（保留参数位以统一工厂签名）
 * @returns {object} echarts option
 * @sideEffects 无（纯函数）
 */
export function buildWeeklyPieOption(data, theme) {
	const pieData = Object.keys(data.projectTotals)
		.map((pid) => ({
			name: data.projectMeta[pid] || pid,
			value: data.projectTotals[pid],
			itemStyle: { color: data.pidColorMap[pid] },
		}))
		.sort((a, b) => b.value - a.value);

	return {
		backgroundColor: 'transparent',
		tooltip: {
			trigger: 'item',
			backgroundColor: 'rgba(37, 37, 38, 0.95)',
			borderColor: '#454545',
			borderWidth: 1,
			textStyle: { color: '#cccccc', fontSize: 12 },
			formatter: (params) => {
				return `<b style="color:#fff;">${params.name}</b><br/>
                                时间: <span style="float:right; font-weight:bold; margin-left:15px; color:#fff;">${formatDuration(params.value)}</span><br/>
                                占比: <span style="float:right; font-weight:bold; margin-left:15px; color:#fff;">${params.percent}%</span>`;
			},
		},
		series: [
			{
				type: 'pie',
				radius: ['35%', '60%'],
				center: ['50%', '55%'],
				avoidLabelOverlap: true,
				data: pieData,
				label: { show: false },
				labelLine: { show: false },
				emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
			},
		],
	};
}
