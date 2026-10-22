/**
 * @//module/ app/working-hours/aggregate
 * @//description/ 把 `STATS_*` 扩展配置聚合成时间轴 + 工程统计（纯计算，不读存储）
 * @//exports/ buildDataset, getTodayWorkHours, COLOR_PALETTE
 * @//dependencies/ 无
 * @//example/ const { buildDataset } = await import('./aggregate.js')
 *            const ds = buildDataset(allUserConfigs, { currentUuid, currentName })
 *            ds.timeline[0] // { ts, work: {pId: 秒}, rest: {pId: 秒} }
 *
 * 时间轴固定为 15 分钟一格、每天 96 格；所有图表与统计都建立在这条时间轴上，
 * 所以「补齐空白天」「按天对齐缩放」都只需要在这里处理一次。
 */

/** 工程颜色池（按总工时排序后依次分配，超出则循环） */
export const COLOR_PALETTE = Object.freeze([
	'#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc',
	'#16a34a', '#d946ef', '#f59e0b', '#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f43f5e', '#6366f1',
	'#84cc16', '#f97316', '#0ea5e9', '#64748b', '#fbbf24', '#22c55e',
]);

/** 每天的时间格数（15 分钟一格） */
const SLOTS_PER_DAY = 96;

/** 单格时长（毫秒） */
const SLOT_MS = 15 * 60 * 1000;

/**
 * 把 `STATS_YYYY_MM_DD` 的键解析成当天零点时间戳
 *
 * @param {string} dateKey 配置键
 * @returns {number} 时间戳；键不合法返回 NaN
 * @sideEffects 无（纯函数）
 */
function dayTsOf(dateKey) {
	const parts = dateKey.split('_');
	if (parts.length < 4) return NaN;
	return new Date(`${parts[1]}/${parts[2]}/${parts[3]} 00:00:00`).getTime();
}

/**
 * 只取出 `STATS_` 开头的配置，并解析出对象
 *
 * @param {Record<string, string|object>} configs 扩展全部用户配置
 * @returns {Array<{dateKey: string, ts: number, dayData: object}>} 解析结果（解析失败的项已剔除）
 * @sideEffects 无（纯函数）
 */
function collectDayConfigs(configs) {
	const out = [];
	for (const entry of Object.entries(configs || {})) {
		const dateKey = entry[0];
		if (!dateKey.startsWith('STATS_')) continue;

		let dayData;
		try {
			dayData = typeof entry[1] === 'string' ? JSON.parse(entry[1]) : entry[1];
		} catch {
			continue;
		}
		if (!dayData) continue;

		const ts = dayTsOf(dateKey);
		if (Number.isNaN(ts)) continue;
		out.push({ dateKey: dateKey, ts: ts, dayData: dayData });
	}
	return out;
}

/**
 * 生成连续时间轴（从最早到最晚，每天 96 格）
 *
 * @param {number} minTs 最早一天 0 点
 * @param {number} maxTs 最晚一天 0 点
 * @returns {{timeline: Array<object>, tsMap: Map<number, number>}} 时间轴与「时间戳 → 下标」
 * @sideEffects 无（纯函数）
 */
function buildTimeline(minTs, maxTs) {
	const timeline = [];
	const tsMap = new Map();
	let index = 0;

	for (let ts = minTs; ts <= maxTs; ts += 24 * 3600 * 1000) {
		for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
			const slotTs = ts + slot * SLOT_MS;
			timeline.push({ ts: slotTs, work: {}, rest: {} });
			tsMap.set(slotTs, index++);
		}
	}
	return { timeline: timeline, tsMap: tsMap };
}

/**
 * 聚合扩展配置为数据集
 *
 * @param {Record<string, string|object>} configs 扩展全部用户配置（`sys_Storage.getExtensionAllUserConfigs()`）
 * @param {object} [options] 选项
 * @param {string|null} [options.currentUuid=null] 当前工程 uuid（没有历史数据时也会建一行）
 * @param {string} [options.currentName='未命名工程'] 当前工程名
 * @param {Date} [options.now=new Date()] 当前时间（测试注入）
 * @returns {{timeline: Array<object>, tsMap: Map<number, number>, projectMeta: object, projectStats: object, sortedProjectIds: string[], pidColorMap: object, todayTs: number}} 数据集
 * @sideEffects 无（纯函数）
 */
export function buildDataset(configs, options = {}) {
	const currentUuid = options.currentUuid || null;
	const currentName = options.currentName || '未命名工程';
	const now = options.now || new Date();

	const days = collectDayConfigs(configs);
	const projectMeta = {};
	let minTs = Infinity;
	let maxTs = -Infinity;

	for (const day of days) {
		if (day.dayData.meta) Object.assign(projectMeta, day.dayData.meta);
		if (day.ts < minTs) minTs = day.ts;
		if (day.ts > maxTs) maxTs = day.ts;
	}

	const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
	if (minTs === Infinity) {
		minTs = todayTs;
		maxTs = todayTs;
	}
	// 今天一定在时间轴范围内（否则「今日工时」取不到下标）
	if (todayTs < minTs) minTs = todayTs;
	if (todayTs > maxTs) maxTs = todayTs;

	const { timeline, tsMap } = buildTimeline(minTs, maxTs);

	const projectStats = {};
	for (const pId of Object.keys(projectMeta)) {
		projectStats[pId] = { name: projectMeta[pId], uuid: pId, totalWork: 0, totalRest: 0, startTs: Infinity, endTs: -Infinity };
	}
	if (currentUuid && !projectStats[currentUuid]) {
		projectMeta[currentUuid] = currentName;
		projectStats[currentUuid] = {
			name: currentName,
			uuid: currentUuid,
			totalWork: 0,
			totalRest: 0,
			startTs: Infinity,
			endTs: -Infinity,
		};
	}

	for (const day of days) {
		const slots = day.dayData.slots;
		if (!slots) continue;

		for (const slotEntry of Object.entries(slots)) {
			const slotTs = day.ts + parseInt(slotEntry[0], 10) * SLOT_MS;
			const tlIndex = tsMap.get(slotTs);
			if (tlIndex === undefined) continue;

			for (const projEntry of Object.entries(slotEntry[1])) {
				const pId = projEntry[0];
				const wTime = projEntry[1][0] || 0;
				const rTime = projEntry[1][1] || 0;

				timeline[tlIndex].work[pId] = wTime;
				timeline[tlIndex].rest[pId] = rTime;

				const stat = projectStats[pId];
				if (!stat) continue;
				stat.totalWork += wTime;
				stat.totalRest += rTime;
				if (wTime > 0 || rTime > 0) {
					if (slotTs < stat.startTs) stat.startTs = slotTs;
					if (slotTs > stat.endTs) stat.endTs = slotTs;
				}
			}
		}
	}

	const sortedProjectIds = Object.keys(projectMeta).sort((a, b) => projectStats[b].totalWork - projectStats[a].totalWork);
	const pidColorMap = {};
	sortedProjectIds.forEach((pId, idx) => {
		pidColorMap[pId] = COLOR_PALETTE[idx % COLOR_PALETTE.length];
	});

	return {
		timeline: timeline,
		tsMap: tsMap,
		projectMeta: projectMeta,
		projectStats: projectStats,
		sortedProjectIds: sortedProjectIds,
		pidColorMap: pidColorMap,
		todayTs: todayTs,
	};
}

/**
 * 今日工时（小时）
 *
 * @param {Array<object>} timeline 时间轴
 * @param {Map<number, number>} tsMap 时间戳 → 下标
 * @param {number} todayTs 今日零点
 * @param {string|null} [targetUuid=null] 只统计某个工程
 * @returns {number} 小时数
 * @sideEffects 无（纯函数）
 */
export function getTodayWorkHours(timeline, tsMap, todayTs, targetUuid = null) {
	const startIndex = tsMap.get(todayTs);
	if (startIndex === undefined) return 0;

	let totalSeconds = 0;
	for (let i = startIndex; i < startIndex + SLOTS_PER_DAY && i < timeline.length; i++) {
		const slot = timeline[i];
		for (const pid in slot.work) {
			if (!targetUuid || pid === targetUuid) totalSeconds += slot.work[pid];
		}
	}
	return totalSeconds / 3600;
}
