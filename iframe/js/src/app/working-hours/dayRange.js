/**
 * @//module/ app/working-hours/dayRange
 * @//description/ 「某段时间 → 时间轴下标窗口」的整日对齐（主图初始窗口、导出范围都用它）
 * @//exports/ getDayAlignedIndices
 * @//dependencies/ 无
 * @//example/ const bounds = getDayAlignedIndices(startTs, endTs)
 *            view.dispatchAction({ type: 'dataZoom', startValue: bounds.startValue, endValue: bounds.endValue })
 *
 * 为什么必须按「整天」对齐：时间轴是 15 分钟一格连续铺开的，若直接用首尾时间戳的比例去算，
 * 缩放窗口会落在半天中间，图上看就是「右边多出半天空白」。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/** 一天的时间格数（15 分钟一格） */
const SLOTS_PER_DAY = 96;

/**
 * 计算整日对齐后的下标窗口
 *
 * @param {number} startTs 起始时间戳（传 Infinity 表示「今天」）
 * @param {number} endTs 结束时间戳（传 -Infinity 表示「今天」）
 * @param {Array<{ts: number}>} timeline 时间轴
 * @param {Map<number, number>} tsMap 时间戳 → 下标
 * @param {number} todayTs 今日零点
 * @returns {{startValue: number, endValue: number}} 下标窗口
 * @sideEffects 无（纯函数）
 */
export function getDayAlignedIndices(startTs, endTs, timeline, tsMap, todayTs) {
	if (startTs === Infinity || endTs === -Infinity) {
		const todayIdx = tsMap.has(todayTs) ? tsMap.get(todayTs) : 0;
		return { startValue: todayIdx, endValue: todayIdx + SLOTS_PER_DAY - 1 };
	}

	const dStart = new Date(startTs);
	const dayStartTs = new Date(dStart.getFullYear(), dStart.getMonth(), dStart.getDate(), 0, 0, 0).getTime();
	const dEnd = new Date(endTs);
	const dayEndTs = new Date(dEnd.getFullYear(), dEnd.getMonth(), dEnd.getDate() + 1, 0, 0, 0).getTime();

	let startValue = 0;
	let endValue = timeline.length - 1;
	if (tsMap.has(dayStartTs)) startValue = tsMap.get(dayStartTs);
	else if (dayStartTs < timeline[0].ts) startValue = 0;

	if (tsMap.has(dayEndTs)) endValue = tsMap.get(dayEndTs);
	else if (dayEndTs > timeline[timeline.length - 1].ts) endValue = timeline.length - 1;

	return { startValue: startValue, endValue: endValue };
}
