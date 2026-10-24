/**
 * 后端（扩展宿主侧）统一日志出口
 *
 * 前端页面用的是 `iframe/js/common.js` 里的 `WolfCommon.logger`；两套 bundle 无法共享代码，
 * 所以这里保持**同名同语义**的另一份实现（级别名、默认级别、前缀都一致）。
 *
 * 用法：
 *   import { logger } from './common/logger.js';
 *   logger.debug('分批处理', batchCount);   // 默认不输出
 *   logger.warn('删除图元失败', err);       // 输出
 *   logger.setLevel('debug');               // 排查问题时打开
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/** 日志级别：数字越小越详细 */
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** 当前级别：默认 info（debug 静默） */
let currentLogLevel = LOG_LEVELS.info;

/**
 * 输出一条日志
 *
 * @param {'debug'|'info'|'warn'|'error'} level - 级别
 * @param {...*} args - 透传给对应 console 方法
 */
function logAt(level, ...args) {
	if ((LOG_LEVELS[level] || 0) < currentLogLevel) return;
	const method = level === 'debug' ? 'log' : level;
	const fn = console[method] || console.log;
	try {
		fn.apply(console, ['[狼黑工具]', ...args]);
	} catch (e) {
		/* 控制台不可用时忽略 */
	}
}

export const logger = {
	debug: (...args) => logAt('debug', ...args),
	info: (...args) => logAt('info', ...args),
	warn: (...args) => logAt('warn', ...args),
	error: (...args) => logAt('error', ...args),
	/**
	 * 调整日志级别
	 * @param {'debug'|'info'|'warn'|'error'|'off'} level - 级别名，`off` 表示全部静默
	 */
	setLevel: (level) => {
		if (level === 'off') {
			currentLogLevel = Number.POSITIVE_INFINITY;
			return;
		}
		if (LOG_LEVELS[level]) currentLogLevel = LOG_LEVELS[level];
	},
};
