/**
 * @//module/ app/working-hours/reminder
 * @//description/ 提醒规则里「分钟 ↔ `HH:MM:SS` 文本」的互转（纯函数）
 * @//exports/ formatMin, parseMin
 * @//dependencies/ 无
 * @//example/ const { formatMin, parseMin } = await import('./reminder.js')
 *            formatMin(90)     // '1:30:00'
 *            parseMin('1:30:00') // 90
 *
 * 这两个函数看起来简单，但 `parseMin` 要同时接受 `90`、`1:30`、`1:30:00`、`1::00`
 * 这些用户随手输入的写法，所以单独抽出来用测试锁住。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 分钟数 → 展示文本
 *
 * @param {number} m 分钟
 * @returns {string} 超过 1 小时给 `H:MM:00`，否则给 `MM:00`
 * @sideEffects 无（纯函数）
 */
export function formatMin(m) {
	const h = Math.floor(m / 60);
	const min = m % 60;
	if (h > 0) return `${h}:${min.toString().padStart(2, '0')}:00`;
	return `${min.toString().padStart(2, '0')}:00`;
}

/**
 * 文本 → 分钟数
 *
 * 兼容：纯数字（按分钟）、`HH:MM:SS`、`MM:SS`、含空段（`1::00`）。
 * 解析不出时返回 0（调用方据此判「时间无效」）。
 *
 * @param {string|number} str 用户输入
 * @returns {number} 分钟数
 * @sideEffects 无（纯函数）
 */
export function parseMin(str) {
	if (!str) return 0;
	const text = str.toString().trim();
	if (/^\d+$/.test(text)) return parseInt(text, 10);

	const parts = text
		.split(':')
		.filter((x) => x !== '')
		.map(Number);

	if (parts.length >= 3) return (isNaN(parts[0]) ? 0 : parts[0]) * 60 + (isNaN(parts[1]) ? 0 : parts[1]);
	if (parts.length === 2) return isNaN(parts[0]) ? 0 : parts[0];
	return isNaN(parseInt(text, 10)) ? 0 : parseInt(text, 10);
}
