/**
 * @//module/ app/working-hours/charts/options/rhythm
 * @//description/ 节律分析极坐标图：96 格聚合 + option 工厂，纯函数
 * @//exports/ aggregateRhythm, buildRhythmOption, computeAxisMax
 * @//dependencies/ app/working-hours/time
 * @//example/ const agg = aggregateRhythm(timeline, { mode: 'time', rangeStart, rangeEnd })
 *            view.setOption(buildRhythmOption({ ...agg, showWork: true, showRest: false }, 'dark', { makeGradient }))
 *
 * 96 格 = 24 小时 × 4 个 15 分钟。极坐标里每个格是一根柱子，工作与空闲在同一个 stack 上叠高，
 * 所以 `axisMax` 必须按「两者之和的最大值」等比放大，否则柱子会溢出到环外。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { formatDuration } from '../../time.js';

/** 每格分钟数 */
const SLOT_MINUTES = 15;

/** 一天的总格数 */
const SLOT_COUNT = (24 * 60) / SLOT_MINUTES;

/**
 * 把时间戳换算成 96 格里的下标
 *
 * @param {number} ts 时间戳
 * @returns {number} 下标（0..95）
 * @sideEffects 无（纯函数）
 */
function slotIndexOf(ts) {
	const d = new Date(ts);
	return d.getHours() * (60 / SLOT_MINUTES) + Math.floor(d.getMinutes() / SLOT_MINUTES);
}

/**
 * 把某个时间格的全部工程累加进对应格
 *
 * @param {Float64Array} work 工作聚合
 * @param {Float64Array} rest 空闲聚合
 * @param {number} index 格下标
 * @param {object} slot 时间格
 * @returns {void}
 * @sideEffects 改写 `work` / `rest`
 */
function addAll(work, rest, index, slot) {
	for (const pid in slot.work) work[index] += slot.work[pid];
	for (const pid in slot.rest) rest[index] += slot.rest[pid];
}

/**
 * 该时间格是否落在统计窗口内（「工程」维度不按时间过滤）
 *
 * @param {number} ts 时间戳
 * @param {boolean} isTime 是否时间维度
 * @param {{start: number, end: number}} range 窗口
 * @returns {boolean} 在窗口内返回 true
 * @sideEffects 无（纯函数）
 */
function inWindow(ts, isTime, range) {
	if (!isTime) return true;
	return ts >= range.start && ts <= range.end;
}

/**
 * 把某个工程的工时累加进对应格
 *
 * @param {Float64Array} work 工作聚合
 * @param {Float64Array} rest 空闲聚合
 * @param {number} index 格下标
 * @param {object} slot 时间格
 * @param {string} uuid 工程 id
 * @returns {void}
 * @sideEffects 改写 `work` / `rest`
 */
function addOne(work, rest, index, slot, uuid) {
	work[index] += slot.work[uuid] || 0;
	rest[index] += slot.rest[uuid] || 0;
}

/**
 * 把时间轴压进 96 个格
 *
 * @param {Array<object>} timeline 时间轴
 * @param {object} opts 参数
 * @param {'time'|'project'} opts.mode 分析维度
 * @param {number} [opts.rangeStart=0] 起始时间戳（仅 time 模式）
 * @param {number} [opts.rangeEnd=Infinity] 结束时间戳（仅 time 模式）
 * @param {string|null} [opts.targetUuid=null] 只看某个工程（仅 project 模式）
 * @returns {{work: Float64Array, rest: Float64Array}} 96 格的聚合结果
 * @sideEffects 无（纯函数）
 */
export function aggregateRhythm(timeline, opts) {
	const isTime = opts.mode !== 'project';
	const range = {
		start: opts.rangeStart === undefined ? 0 : opts.rangeStart,
		end: opts.rangeEnd === undefined ? Infinity : opts.rangeEnd,
	};
	const targetUuid = opts.targetUuid || null;
	const work = new Float64Array(SLOT_COUNT).fill(0);
	const rest = new Float64Array(SLOT_COUNT).fill(0);

	for (const slot of timeline) {
		if (!inWindow(slot.ts, isTime, range)) continue;
		const index = slotIndexOf(slot.ts);
		if (isTime) addAll(work, rest, index, slot);
		else if (targetUuid) addOne(work, rest, index, slot, targetUuid);
	}

	return { work: work, rest: rest };
}

/**
 * 计算极坐标半径上限（留 4% 余量，视觉上柱子不会顶满）
 *
 * @param {Float64Array} work 工作时间聚合
 * @param {Float64Array} rest 空闲时间聚合
 * @param {boolean} showWork 是否显示工作
 * @param {boolean} showRest 是否显示空闲
 * @returns {number} 半径上限
 * @sideEffects 无（纯函数）
 */
export function computeAxisMax(work, rest, showWork, showRest) {
	let maxTotal = 0;
	for (let i = 0; i < work.length; i += 1) {
		let total = 0;
		if (showWork) total += work[i];
		if (showRest) total += rest[i];
		if (total > maxTotal) maxTotal = total;
	}
	return maxTotal > 0 ? maxTotal / 0.96 : 100;
}

/**
 * 生成 96 个类目标签（00:00 / 00:15 / …）
 *
 * @returns {string[]} 标签
 * @sideEffects 无（纯函数）
 */
function buildCategories() {
	const categories = [];
	for (let h = 0; h < 24; h += 1) {
		for (let m = 0; m < 60; m += SLOT_MINUTES) {
			categories.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
		}
	}
	return categories;
}

/**
 * 生成极坐标图 tooltip
 *
 * @param {object} params echarts tooltip 参数
 * @returns {string} HTML
 * @sideEffects 无（纯函数）
 */
function rhythmTooltip(params) {
	const startTime = params[0].name;
	const timeParts = startTime.split(':').map(Number);
	let endH = timeParts[0];
	let endM = timeParts[1] + SLOT_MINUTES;
	if (endM >= 60) {
		endM = 0;
		endH += 1;
	}
	const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

	let html = `<b style="font-size:13px; color:#fff;">${startTime} ~ ${endTime}</b><br/>`;
	let hasData = false;
	params.forEach((p) => {
		if (p.value <= 0) return;
		const blockColor = typeof p.color === 'string' ? p.color : p.color && p.color.colorStops ? p.color.colorStops[0].color : '#007acc';
		html += `<div style="margin: 4px 0; font-size:12px;"><span class="color-block" style="background:${blockColor};"></span> ${p.seriesName}: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(p.value)}</span></div>`;
		hasData = true;
	});
	return hasData ? html : html + '<span style="color:#666;">无活动记录</span>';
}

/**
 * 构建节律极坐标图的 option
 *
 * @param {object} data 聚合结果与显示开关
 * @param {Float64Array} data.work 工作时间聚合
 * @param {Float64Array} data.rest 空闲时间聚合
 * @param {boolean} data.showWork 是否显示工作
 * @param {boolean} data.showRest 是否显示空闲
 * @param {number} data.axisMax 半径上限（computeAxisMax 的结果）
 * @param {string} theme 主题名（保留参数位以统一工厂签名）
 * @param {object} opts 参数
 * @param {(stops: Array<{offset: number, color: string}>) => object} opts.makeGradient 渐变构造器（由页面侧注入 echarts.graphic）
 * @returns {object} echarts option
 * @sideEffects 无（纯函数）
 */
export function buildRhythmOption(data, theme, opts) {
	const zero = () => new Float64Array(SLOT_COUNT).fill(0);

	return {
		backgroundColor: 'transparent',
		tooltip: {
			trigger: 'axis',
			axisPointer: { type: 'cross' },
			backgroundColor: 'rgba(37, 37, 38, 0.95)',
			borderColor: '#454545',
			textStyle: { color: '#cccccc', fontSize: 12 },
			formatter: rhythmTooltip,
		},
		angleAxis: {
			type: 'category',
			data: buildCategories(),
			startAngle: 90,
			clockwise: true,
			axisLine: { lineStyle: { color: 'var(--vscode-border)' } },
			splitLine: { show: true, lineStyle: { color: 'var(--vscode-border)', type: 'solid' } },
			axisLabel: {
				interval: 3,
				color: '#CCCCCC',
				fontSize: 12,
				textShadowColor: 'rgba(0,0,0,0.8)',
				textShadowBlur: 3,
				formatter: function formatter(value) {
					return value.endsWith(':00') ? value.split(':')[0] : '';
				},
			},
			axisPointer: { label: { backgroundColor: '#1E1F20', color: '#D0DFDF' } },
		},
		radiusAxis: {
			max: data.axisMax,
			axisLabel: { show: false, color: '#999999', fontSize: 10, formatter: (v) => (v === 0 ? '' : formatDuration(v)) },
			axisLine: { show: false },
			splitLine: { lineStyle: { color: 'var(--vscode-border)', type: 'dashed' } },
			axisPointer: { label: { formatter: (params) => formatDuration(params.value) } },
		},
		polar: { center: ['50%', '50%'], radius: '76%' },
		series: [
			{
				type: 'bar',
				data: data.showWork ? Array.from(data.work) : zero(),
				coordinateSystem: 'polar',
				name: '工作时间',
				stack: 'time-stack',
				barCategoryGap: '0%',
				itemStyle: {
					color: opts.makeGradient([
						{ offset: 0, color: '#007acc' },
						{ offset: 1, color: '#3ba272' },
					]),
				},
			},
			{
				type: 'bar',
				data: data.showRest ? Array.from(data.rest) : zero(),
				coordinateSystem: 'polar',
				name: '空闲时间',
				stack: 'time-stack',
				barCategoryGap: '0%',
				itemStyle: { color: '#666666' },
			},
		],
	};
}
