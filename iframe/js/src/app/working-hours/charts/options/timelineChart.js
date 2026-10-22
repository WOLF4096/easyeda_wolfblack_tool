/**
 * @//module/ app/working-hours/charts/options/timelineChart
 * @//description/ 主时间轴图（总趋势 / 工程详情 / 工程管理）的 option 工厂，纯函数
 * @//exports/ buildTimelineOption
 * @//dependencies/ core/util, app/working-hours/time
 * @//example/ view.setOption(buildTimelineOption(data, 'dark', { bounds, isManage: false }))
 *
 * 三个 tab 共用同一套 option（`isManage` 决定 tooltip 取哪套聚簇大小、只看哪个工程），
 * 拆分前这段 107 行嵌在页面入口里，只能靠肉眼确认没改坏 —— 现在给定数据即可断言。
 *
 * `opts` 里的 `getClusterSize` / `getActiveTab` / `getCurrentUuid` 是**取值函数**而不是值：
 * tooltip 是用户悬浮时才执行的，必须读到当下的缩放级别与当前 tab，快照一份就错了。
 */

import { escapeHtml } from '../../../../core/util.js';
import { formatDuration, formatFullDateTime } from '../../time.js';

/** 单格基础容量（秒） */
const SLOT_CAPACITY_SEC = 900;

/**
 * 生成时间格标题（起 ~ 止，止只显示时分）
 *
 * @param {number} startTs 起始时间戳
 * @param {number} size 聚簇格数
 * @returns {string} 标题
 * @sideEffects 无（纯函数）
 */
function blockTitle(startTs, size) {
	const end = new Date(startTs + size * 15 * 60 * 1000);
	return `${formatFullDateTime(startTs)} ~ ${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * 汇总一个聚簇块里的工作 / 空闲
 *
 * @param {Array<object>} timeline 时间轴
 * @param {number} blockStart 起始下标
 * @param {number} size 聚簇格数
 * @param {string|null} specificUuid 只看某个工程
 * @returns {{work: Record<string, number>, rest: number}} 汇总结果
 * @sideEffects 无（纯函数）
 */
function sumBlock(timeline, blockStart, size, specificUuid) {
	const work = {};
	let rest = 0;
	for (let k = 0; k < size && blockStart + k < timeline.length; k += 1) {
		const slot = timeline[blockStart + k];
		for (const pid in slot.work) {
			if (specificUuid && pid !== specificUuid) continue;
			work[pid] = (work[pid] || 0) + slot.work[pid];
		}
		for (const pid in slot.rest) {
			if (specificUuid && pid !== specificUuid) continue;
			rest += slot.rest[pid];
		}
	}
	return { work: work, rest: rest };
}

/**
 * 生成 tooltip 的 formatter
 *
 * @param {object} data 数据集
 * @param {object} opts 参数
 * @returns {Function} formatter
 * @sideEffects 无（纯函数）
 */
function makeTooltipFormatter(data, opts) {
	return function formatter(params) {
		const ts = Number(params[0].axisValue);
		const tlIndex = data.tsMap.get(ts);
		const currentSize = opts.getClusterSize();
		const blockStartIdx = Math.floor(tlIndex / currentSize) * currentSize;
		const block = sumBlock(data.timeline, blockStartIdx, currentSize, opts.specificUuid);

		const startTs = data.timeline[blockStartIdx].ts;
		const title = blockTitle(startTs, currentSize);

		let tooltipHtml = `<b style="font-size:13px; color:#fff;">${title}</b><br/>`;
		let hasData = false;

		if (!data.hiddenSeries.has('工作时间')) {
			const rows = workRows(data, opts, block.work);
			tooltipHtml += rows.html;
			hasData = rows.hasData;
		}

		if (block.rest > 0 && !data.hiddenSeries.has('空闲时间')) {
			tooltipHtml += `<div style="margin: 4px 0; font-size:12px;"><span class="color-block" style="background:var(--vscode-chart-rest);"></span> 空闲时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(block.rest)}</span></div>`;
			hasData = true;
		}
		return hasData ? tooltipHtml : `<b style="font-size:13px; color:#fff;">${title}</b><br/><span style="color:#666;">无活动记录</span>`;
	};
}

/**
 * 取 tooltip 需要遍历的工程 id（管理图只看选中工程，其余按工时倒序）
 *
 * @param {object} data 数据集
 * @param {object} opts 参数
 * @returns {string[]} 工程 id 列表
 * @sideEffects 无（纯函数）
 */
function visiblePids(data, opts) {
	if (opts.isManage && opts.specificUuid) return [opts.specificUuid];
	return data.sortedProjectIds;
}

/**
 * 生成 tooltip 里的工作行（倒序，让最短的排在最上面，视觉上跟柱子的堆叠顺序一致）
 *
 * @param {object} data 数据集
 * @param {object} opts 参数
 * @param {Record<string, number>} work 该块的工作秒数
 * @returns {{html: string, hasData: boolean}} HTML 片段与「是否有行」
 * @sideEffects 无（纯函数）
 */
function workRows(data, opts, work) {
	const list = visiblePids(data, opts);
	const activeTab = opts.getActiveTab();
	const currentUuid = opts.getCurrentUuid();
	const parts = [];

	for (let i = list.length - 1; i >= 0; i -= 1) {
		const pid = list[i];
		if (!opts.isManage && activeTab === 'project' && pid !== currentUuid) continue;
		const name = data.projectMeta[pid];
		if (data.hiddenSeries.has(name)) continue;
		const val = work[pid] || 0;
		if (val <= 0) continue;
		parts.push(`<div style="margin: 4px 0; font-size:12px;"><span class="color-block" style="background:${data.pidColorMap[pid] || 'var(--vscode-link)'};"></span> ${escapeHtml(name)}: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(val)}</span></div>`);
	}
	return { html: parts.join(''), hasData: parts.length > 0 };
}

/**
 * 生成 X 轴刻度格式（整点显示时分，零点显示日期）
 *
 * @param {number} value 时间戳字符串
 * @returns {string} 刻度文本
 * @sideEffects 无（纯函数）
 */
function axisLabelFormatter(value) {
	const d = new Date(Number(value));
	const hh = d.getHours().toString().padStart(2, '0');
	const mm = d.getMinutes().toString().padStart(2, '0');
	if (hh === '00' && mm === '00') return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
	return `${hh}:${mm}`;
}

/**
 * 生成 custom series 的 renderItem
 *
 * @param {object} data 数据集
 * @returns {Function} renderItem
 * @sideEffects 无（纯函数）
 */
function makeRenderItem(data) {
	return function renderItem(params, api) {
		const categoryIndex = api.value(0);
		const startY = api.value(1);
		const endY = api.value(2);
		const pid = api.value(3);
		const cSize = api.value(4) || 1;
		const leftCoord = api.coord([categoryIndex, startY]);
		const rightCoord = api.coord([categoryIndex + cSize - 1, startY]);
		const bandWidth = api.size([1, 0])[0];
		const x = leftCoord[0] - bandWidth / 2;
		const width = rightCoord[0] + bandWidth / 2 - x;
		const y = api.coord([categoryIndex, endY])[1];
		const height = leftCoord[1] - y;
		if (height <= 0) return;
		return {
			type: 'rect',
			shape: { x: x, y: y, width: width, height: height },
			style: api.style({ fill: pid === 'REST' ? '#b0b0b0' : data.pidColorMap[pid] || '#007acc' }),
		};
	};
}

/**
 * 构建时间轴图的 option
 *
 * @param {object} data 数据集（不读模块外部状态）
 * @param {string} theme 主题名（保留参数位，便于与其它工厂签名一致；实际配色由 echarts 主题决定）
 * @param {object} opts 参数
 * @param {{startValue: number, endValue: number}} opts.bounds 初始 dataZoom 窗口
 * @param {boolean} opts.isManage 是否工程管理图
 * @param {string} [opts.specificUuid] 只看某个工程
 * @param {() => number} opts.getClusterSize 取当前聚簇大小
 * @param {() => string} opts.getActiveTab 取当前 tab
 * @param {() => string|null} opts.getCurrentUuid 取当前工程 uuid
 * @returns {object} echarts option
 * @sideEffects 无（纯函数）
 */
export function buildTimelineOption(data, theme, opts) {
	const dummyData = new Float32Array(data.timeline.length).fill(SLOT_CAPACITY_SEC);

	return {
		animation: false,
		backgroundColor: 'transparent',
		tooltip: {
			trigger: 'axis',
			axisPointer: { type: 'shadow' },
			backgroundColor: 'rgba(37, 37, 38, 0.95)',
			borderColor: '#454545',
			borderWidth: 1,
			textStyle: { color: '#cccccc', fontSize: 12 },
			formatter: makeTooltipFormatter(data, opts),
		},
		legend: { show: false },
		grid: { left: 60, right: 20, bottom: 45, top: opts.isManage ? 15 : 20 },
		xAxis: {
			type: 'category',
			data: data.timeline.map((item) => item.ts),
			axisLabel: { hideOverlap: true, rotate: 30, color: '#858585', fontSize: 10, formatter: axisLabelFormatter },
			axisLine: { lineStyle: { color: '#333' } },
		},
		yAxis: {
			type: 'value',
			max: 900,
			axisLabel: { color: '#858585', fontSize: 10, formatter: (value) => formatDuration(value) },
			splitLine: { lineStyle: { color: '#252526' } },
		},
		dataZoom: [
			{
				type: 'inside',
				startValue: opts.bounds.startValue,
				endValue: opts.bounds.endValue,
				zoomOnMouseWheel: true,
				moveOnMouseMove: true,
				moveOnMouseWheel: false,
				filterMode: 'none',
				minValueSpan: 23,
			},
		],
		series: [
			{ type: 'bar', data: Array.from(dummyData), itemStyle: { color: 'rgba(0,0,0,0)' }, barGap: '-100%', large: true, progressive: 0, progressiveThreshold: 999999 },
			{ type: 'custom', clip: true, progressive: 0, progressiveThreshold: 999999, renderItem: makeRenderItem(data), encode: { x: 0, y: [1, 2] }, data: [] },
		],
	};
}
