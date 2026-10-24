/**
 * @//module/ app/working-hours/exportPayload
 * @//description/ 导出报告的 payload 组装（单工程量 / 全量趋势），纯函数
 * @//exports/ buildProjectPayload, buildTotalTrendPayload, collectHeatmapForExport, findDataRange
 * @//dependencies/ core/util, app/working-hours/time, app/working-hours/projectSummary, app/working-hours/charts/options/heatmap
 * @//example/ const payload = buildProjectPayload(data, uuid, bounds)
 *            if (payload) await triggerSecureExport(payload, '工程耗时图_X')
 *
 * 导出的 payload 结构必须与 reportTemplate 里的内联脚本严格对齐（`baseTs` + `totalSlots` +
 * `data: [[相对下标, work, rest]]`），所以这里只做数据组装，不做任何 UI 动作。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { collectDaily } from './charts/options/heatmap.js';
import { getProjectTitleString } from './projectSummary.js';
import { formatDuration, formatFullDateTime } from './time.js';

/**
 * 导出用的热力图数据（不含隐藏过滤，去掉空白天）
 *
 * @param {Array<object>} timeline 时间轴
 * @param {string|null} filterUuid 只统计某个工程
 * @returns {Array<[string, number, number]>} `[日期, 工作秒, 空闲秒]`
 * @sideEffects 无（纯函数）
 */
export function collectHeatmapForExport(timeline, filterUuid) {
	return collectDaily(timeline, { filterUuid: filterUuid || null, includeEmpty: false });
}

/**
 * 找出第一个 / 最后一个有记录的时间格下标
 *
 * @param {Array<object>} timeline 时间轴
 * @returns {{minIdx: number, maxIdx: number}} 下标（全空返回 -1）
 * @sideEffects 无（纯函数）
 */
export function findDataRange(timeline) {
	let minIdx = -1;
	let maxIdx = -1;
	for (let i = 0; i < timeline.length; i += 1) {
		const slot = timeline[i];
		if (Object.keys(slot.work).length === 0 && Object.keys(slot.rest).length === 0) continue;
		if (minIdx === -1) minIdx = i;
		maxIdx = i;
	}
	return { minIdx: minIdx, maxIdx: maxIdx };
}

/**
 * 组装「单个工程」的导出 payload
 *
 * @param {object} data 数据集
 * @param {string} uuid 工程 id
 * @param {{startValue: number, endValue: number}} bounds 整日对齐后的下标窗口
 * @returns {object} 导出 payload
 * @sideEffects 无（纯函数）
 */
export function buildProjectPayload(data, uuid, bounds) {
	const pStat = data.projectStats[uuid];
	const baseTs = data.timeline[bounds.startValue].ts;
	const timeData = [];

	for (let i = bounds.startValue; i <= bounds.endValue; i += 1) {
		const w = data.timeline[i].work[uuid] || 0;
		const r = data.timeline[i].rest[uuid] || 0;
		if (w > 0 || r > 0) timeData.push([i - bounds.startValue, { [uuid]: w }, { [uuid]: r }]);
	}

	return {
		pageTitle: getProjectTitleString(data.projectStats, uuid),
		baseTs: baseTs,
		totalSlots: bounds.endValue - bounds.startValue + 1,
		projectMeta: { [uuid]: { name: pStat.name, color: data.pidColorMap[uuid] || '#007acc' } },
		data: timeData,
		heatmapData: collectHeatmapForExport(data.timeline, uuid),
	};
}

/**
 * 组装「全部工程趋势」的导出 payload
 *
 * @param {object} data 数据集
 * @returns {object|null} 导出 payload；全空返回 null
 * @sideEffects 无（纯函数）
 */
export function buildTotalTrendPayload(data) {
	const range = findDataRange(data.timeline);
	if (range.minIdx === -1) return null;

	const baseTs = data.timeline[range.minIdx].ts;
	const endTs = data.timeline[range.maxIdx].ts + 15 * 60 * 1000;
	const timeData = [];
	let rangeWork = 0;
	let rangeRest = 0;

	for (let i = range.minIdx; i <= range.maxIdx; i += 1) {
		const wObj = {};
		const rObj = {};
		for (const uid in data.timeline[i].work) {
			wObj[uid] = data.timeline[i].work[uid];
			rangeWork += wObj[uid];
		}
		for (const uid in data.timeline[i].rest) {
			rObj[uid] = data.timeline[i].rest[uid];
			rangeRest += rObj[uid];
		}
		if (Object.keys(wObj).length === 0 && Object.keys(rObj).length === 0) continue;
		timeData.push([i - range.minIdx, wObj, rObj]);
	}

	const projectMeta = {};
	data.sortedProjectIds.forEach((uid) => {
		projectMeta[uid] = { name: data.projectMeta[uid], color: data.pidColorMap[uid] };
	});

	return {
		pageTitle:
			'全部工程时间总趋势 、时间：' +
			formatFullDateTime(baseTs) +
			' ~ ' +
			formatFullDateTime(endTs) +
			' 、工作：' +
			formatDuration(rangeWork) +
			' 、空闲：' +
			formatDuration(rangeRest),
		baseTs: baseTs,
		totalSlots: range.maxIdx - range.minIdx + 1,
		projectMeta: projectMeta,
		data: timeData,
		heatmapData: collectHeatmapForExport(data.timeline, null),
	};
}
