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
 * 合并所有天里的工程元数据（后出现的覆盖先出现的）
 *
 * @param {Array<{dayData: object}>} days 已解析的天配置
 * @returns {Record<string, string>} `{ 工程 uuid: 工程名 }`
 * @sideEffects 无（纯函数）
 */
function collectProjectMeta(days) {
	const projectMeta = {};
	for (const day of days) {
		if (day.dayData.meta) Object.assign(projectMeta, day.dayData.meta);
	}
	return projectMeta;
}

/**
 * 算出时间轴覆盖的天区间，并保证「今天」一定在范围内
 *
 * @param {Array<{ts: number}>} days 已解析的天配置
 * @param {number} todayTs 今日零点
 * @returns {{minTs: number, maxTs: number}} 最早 / 最晚一天 0 点
 * @sideEffects 无（纯函数）
 */
function dayRange(days, todayTs) {
	let minTs = Infinity;
	let maxTs = -Infinity;

	for (const day of days) {
		if (day.ts < minTs) minTs = day.ts;
		if (day.ts > maxTs) maxTs = day.ts;
	}

	if (minTs === Infinity) {
		minTs = todayTs;
		maxTs = todayTs;
	}
	// 今天一定在时间轴范围内（否则「今日工时」取不到下标）
	if (todayTs < minTs) minTs = todayTs;
	if (todayTs > maxTs) maxTs = todayTs;
	return { minTs: minTs, maxTs: maxTs };
}

/**
 * 造一条空的工程统计
 *
 * @param {string} name 工程名
 * @param {string} uuid 工程 uuid
 * @returns {object} 统计对象
 * @sideEffects 无（纯函数）
 */
function emptyStat(name, uuid) {
	return { name: name, uuid: uuid, totalWork: 0, totalRest: 0, startTs: Infinity, endTs: -Infinity };
}

/**
 * 初始化每个工程的统计（当前工程即使没有历史数据也建一行）
 *
 * @param {Record<string, string>} projectMeta 工程元数据（会被补上当前工程）
 * @param {string|null} currentUuid 当前工程 uuid
 * @param {string} currentName 当前工程名
 * @returns {object} `{ 工程 uuid: 统计对象 }`
 * @sideEffects **就地修改** projectMeta
 */
function initProjectStats(projectMeta, currentUuid, currentName) {
	const projectStats = {};
	for (const pId of Object.keys(projectMeta)) projectStats[pId] = emptyStat(projectMeta[pId], pId);

	if (currentUuid && !projectStats[currentUuid]) {
		projectMeta[currentUuid] = currentName;
		projectStats[currentUuid] = emptyStat(currentName, currentUuid);
	}
	return projectStats;
}

/**
 * 把一格的数据累加到工程统计上
 *
 * @param {object|undefined} stat 工程统计
 * @param {number} slotTs 该格时间戳
 * @param {number} wTime 该格工作时长（秒）
 * @param {number} rTime 该格休息时长（秒）
 * @returns {void}
 * @sideEffects **就地修改** stat
 */
function tallyProject(stat, slotTs, wTime, rTime) {
	if (!stat) return;
	stat.totalWork += wTime;
	stat.totalRest += rTime;
	if (wTime > 0 || rTime > 0) {
		if (slotTs < stat.startTs) stat.startTs = slotTs;
		if (slotTs > stat.endTs) stat.endTs = slotTs;
	}
}

/**
 * 把一天的某一格写进时间轴，并累加各工程统计
 *
 * @param {object} slot 该格的 `{ 工程 uuid: [工作秒, 休息秒] }`
 * @param {number} slotTs 该格时间戳
 * @param {Array<object>} timeline 时间轴
 * @param {Map<number, number>} tsMap 时间戳 → 下标
 * @param {object} projectStats 工程统计表
 * @returns {void}
 * @sideEffects **就地修改** timeline 与 projectStats
 */
function applySlot(slot, slotTs, timeline, tsMap, projectStats) {
	const tlIndex = tsMap.get(slotTs);
	if (tlIndex === undefined) return;
	const cell = timeline[tlIndex];

	for (const projEntry of Object.entries(slot)) {
		const pId = projEntry[0];
		const wTime = projEntry[1][0] || 0;
		const rTime = projEntry[1][1] || 0;

		cell.work[pId] = wTime;
		cell.rest[pId] = rTime;
		tallyProject(projectStats[pId], slotTs, wTime, rTime);
	}
}

/**
 * 把每一天的每一格填进时间轴
 *
 * @param {Array<{ts: number, dayData: object}>} days 已解析的天配置
 * @param {Array<object>} timeline 时间轴
 * @param {Map<number, number>} tsMap 时间戳 → 下标
 * @param {object} projectStats 工程统计表
 * @returns {void}
 * @sideEffects **就地修改** timeline 与 projectStats
 */
function fillTimeline(days, timeline, tsMap, projectStats) {
	for (const day of days) {
		const slots = day.dayData.slots;
		if (!slots) continue;

		for (const slotEntry of Object.entries(slots)) {
			const slotTs = day.ts + parseInt(slotEntry[0], 10) * SLOT_MS;
			applySlot(slotEntry[1], slotTs, timeline, tsMap, projectStats);
		}
	}
}

/**
 * 按总工时排序结果分配颜色
 *
 * @param {string[]} sortedProjectIds 按总工时降序的工程 uuid
 * @returns {Record<string, string>} `{ 工程 uuid: 颜色 }`
 * @sideEffects 无（纯函数）
 */
function buildColorMap(sortedProjectIds) {
	const pidColorMap = {};
	sortedProjectIds.forEach((pId, idx) => {
		pidColorMap[pId] = COLOR_PALETTE[idx % COLOR_PALETTE.length];
	});
	return pidColorMap;
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
	const projectMeta = collectProjectMeta(days);
	const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();

	const { minTs, maxTs } = dayRange(days, todayTs);
	const { timeline, tsMap } = buildTimeline(minTs, maxTs);

	const projectStats = initProjectStats(projectMeta, currentUuid, currentName);
	fillTimeline(days, timeline, tsMap, projectStats);

	const sortedProjectIds = Object.keys(projectMeta).sort((a, b) => projectStats[b].totalWork - projectStats[a].totalWork);
	const pidColorMap = buildColorMap(sortedProjectIds);

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
