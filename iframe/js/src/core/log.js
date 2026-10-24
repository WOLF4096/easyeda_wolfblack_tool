/**
 * @//module/ core/log
 * @//description/ 统一日志出口（级别可调、前缀统一、可一键静默）
 * @//exports/ logger
 * @//dependencies/ 无
 * @//example/ const { logger } = await import('./core/log.js')
 *            logger.debug('分批处理', batch)   // 默认不输出
 *            logger.warn('删除失败', err)      // 输出
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 日志级别表：数字越小越详细
 *
 * @type {Readonly<Record<'debug'|'info'|'warn'|'error', number>>}
 */
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** 当前级别：默认 info（debug 静默），排查问题时用 `logger.setLevel('debug')` 打开 */
let currentLogLevel = LOG_LEVELS.info;

/**
 * 按级别输出一条日志
 *
 * 统一在这里兜 try/catch：某些宿主环境控制台对象被裁剪时 `console[method]` 可能不可用。
 *
 * @param {'debug'|'info'|'warn'|'error'} level 级别
 * @param {...*} args 透传给对应 console 方法
 * @returns {void}
 * @sideEffects console（低于当前级别时不输出）
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

/**
 * 统一日志出口
 *
 * @type {{debug: Function, info: Function, warn: Function, error: Function, setLevel: Function}}
 */
export const logger = {
	/**
	 * 调试日志（默认不输出）
	 *
	 * @param {...*} args 日志参数
	 * @returns {void}
	 * @sideEffects console
	 */
	debug: (...args) => logAt('debug', ...args),

	/**
	 * 普通信息
	 *
	 * @param {...*} args 日志参数
	 * @returns {void}
	 * @sideEffects console
	 */
	info: (...args) => logAt('info', ...args),

	/**
	 * 警告
	 *
	 * @param {...*} args 日志参数
	 * @returns {void}
	 * @sideEffects console
	 */
	warn: (...args) => logAt('warn', ...args),

	/**
	 * 错误
	 *
	 * @param {...*} args 日志参数
	 * @returns {void}
	 * @sideEffects console
	 */
	error: (...args) => logAt('error', ...args),

	/**
	 * 调整日志级别
	 *
	 * @param {'debug'|'info'|'warn'|'error'|'off'} level 级别名，`off` 表示全部静默
	 * @returns {void}
	 * @sideEffects 修改模块内的当前级别
	 */
	setLevel: (level) => {
		if (level === 'off') {
			currentLogLevel = Number.POSITIVE_INFINITY;
			return;
		}
		if (LOG_LEVELS[level]) currentLogLevel = LOG_LEVELS[level];
	},
};
