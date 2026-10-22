/**
 * @//module/ app/working-hours/time
 * @//description/ 工时页的三种时间格式（时长 / 中文时长 / 完整日期时间）
 * @//exports/ formatDuration, formatTimeCN, formatFullDateTime
 * @//dependencies/ 无
 * @//example/ const { formatDuration } = await import('./time.js')
 *            formatDuration(3725) // '01:02:05'
 *
 * 导出报告里还有一套内联副本 —— 那是**故意**保留的：报告要能脱离扩展单独打开，
 * 不能依赖这个模块。改这里的格式时，记得同步报告模板里的那三个内联函数。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 秒 → `HH:MM:SS`
 *
 * @param {number} seconds 秒数（0 / null 视为 0）
 * @returns {string} 形如 `01:02:05`
 * @sideEffects 无（纯函数）
 */
export function formatDuration(seconds) {
	if (!seconds) return '00:00:00';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 小时浮点 → `X时Y分`
 *
 * @param {number} hoursFloat 小时数
 * @returns {string} 形如 `2时5分`
 * @sideEffects 无（纯函数）
 */
export function formatTimeCN(hoursFloat) {
	if (isNaN(hoursFloat) || hoursFloat === null) return '0时0分';
	const totalMin = Math.round(hoursFloat * 60);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return `${h}时${m}分`;
}

/**
 * 时间戳 → `YYYY/M/D HH:MM`
 *
 * @param {number} ts 时间戳（毫秒）
 * @returns {string} 形如 `2026/10/22 15:30`；非法值返回「无」
 * @sideEffects 无（纯函数）
 */
export function formatFullDateTime(ts) {
	if (!ts || ts === Infinity || ts === -Infinity) return '无';
	const d = new Date(ts);
	return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
