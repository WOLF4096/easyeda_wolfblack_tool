/**
 * @//module/ app/working-hours/projectSummary
 * @//description/ 工程的一句话摘要（标题栏、图表标题、导出报告标题共用）
 * @//exports/ getProjectTitleString
 * @//dependencies/ core/util, app/working-hours/time
 * @//example/ el.innerText = getProjectTitleString(data, uuid)
 *
 * 同一句话出现在三处（顶部标题、工程管理图标题、导出报告的 pageTitle），
 * 以前是三份拷贝，改一处忘一处就会出现「标题里的时间范围和图不一致」。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { escapeHtml } from '../../core/util.js';
import { formatDuration, formatFullDateTime } from './time.js';

/**
 * 生成工程摘要：「工程：X 、时间：起 ~ 止 、工作：H 、空闲：H」
 *
 * @param {Record<string, {name: string, startTs: number, endTs: number, totalWork: number, totalRest: number}>} projectStats 工程统计
 * @param {string|null} uuid 工程 id
 * @returns {string} 摘要（工程名已转义）；无数据返回「暂无数据」
 * @sideEffects 无（纯函数）
 */
export function getProjectTitleString(projectStats, uuid) {
	if (!uuid || !projectStats[uuid]) return '暂无数据';
	const p = projectStats[uuid];
	return `工程：${escapeHtml(p.name)} 、时间：${formatFullDateTime(p.startTs)} ~ ${formatFullDateTime(p.endTs)} 、工作：${formatDuration(p.totalWork)} 、空闲：${formatDuration(p.totalRest)}`;
}
