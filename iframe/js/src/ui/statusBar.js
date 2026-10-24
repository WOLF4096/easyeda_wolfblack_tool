/**
 * @//module/ ui/statusBar
 * @//description/ 状态栏文字 + 进度条的统一操作（百分比计算、语义色、重置）
 * @//exports/ LEVEL_CLASS, percentOf, createStatusBar
 * @//dependencies/ 无
 * @//example/ const { createStatusBar } = await import('./ui/statusBar.js')
 *            const bar = createStatusBar({ textEl: $('#status'), barEl: $('#progressBg') })
 *            bar.progress(3, 10, '当前：C1234', 'info')
 *            bar.text('完成', 'success')
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 语义级别 → CSS 类名后缀
 *
 * 对应 `iframe/css/common.css` 里的 `.status.success/.error/.info/.warning`
 * 与 `.status-bar.accent/.warning/.success/.error`。空字符串表示「无级别」。
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LEVEL_CLASS = Object.freeze({
	'': '',
	info: 'info',
	ok: 'success',
	success: 'success',
	warn: 'warning',
	warning: 'warning',
	err: 'error',
	error: 'error',
});

/** 进度条处于「进行中」时使用的强调类 */
const ACCENT = 'accent';

/**
 * 计算百分比（0~100 的整数）
 *
 * 三个页面各自 `Math.floor(current / total * 100)`，但对 `total=0`、负数、超界都没有防护，
 * 会算出 `NaN%` / `-20%` / `180%` 写进 style。这里统一收口。
 *
 * @param {number} done 已完成数
 * @param {number} total 总数
 * @returns {number} 0~100 的整数；total 非正数时返回 0
 * @sideEffects 无（纯函数）
 */
export function percentOf(done, total) {
	const d = Number(done);
	const t = Number(total);
	if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) return 0;
	return Math.max(0, Math.min(100, Math.floor((d / t) * 100)));
}

/**
 * 组合 className：基础类 + 语义后缀
 *
 * @param {string} base 基础类名（如 'status'）
 * @param {string} [level] 语义级别
 * @returns {string} 组合后的 className
 * @sideEffects 无（纯函数）
 */
function classOf(base, level) {
	const suffix = LEVEL_CLASS[level === undefined ? '' : level];
	if (suffix === undefined) return base;
	return suffix ? base + ' ' + suffix : base;
}

/**
 * 创建状态栏控制器
 *
 * 元素可能不存在（不同页面版式不同），所有方法都做空值保护，调用方不必逐个判空。
 *
 * @param {object} [options] 选项
 * @param {HTMLElement|null} [options.textEl] 文字元素
 * @param {HTMLElement|null} [options.barEl] 进度条元素（改 style.width）
 * @param {string} [options.baseClass='status'] 文字元素的基础类名
 * @param {string} [options.barBaseClass='status-bar'] 进度条基础类名
 * @param {string} [options.widthProp='width'] 进度条宽度写哪个 CSS 属性（部分页面用 transform）
 * @returns {{text: Function, progress: Function, width: Function, reset: Function}} 控制器
 * @sideEffects 无（创建时只捕获引用；方法调用时才写 DOM）
 */
export function createStatusBar(options = {}) {
	const textEl = options.textEl || null;
	const barEl = options.barEl || null;
	const baseClass = options.baseClass || 'status';
	const barBaseClass = options.barBaseClass || 'status-bar';
	const widthProp = options.widthProp || 'width';

	/**
	 * 写文字
	 *
	 * @param {string} message 文案
	 * @param {string} [level] 语义级别（见 LEVEL_CLASS）
	 * @returns {void}
	 * @sideEffects DOM
	 */
	function text(message, level) {
		if (!textEl) return;
		textEl.textContent = message === null || message === undefined ? '' : String(message);
		textEl.className = classOf(baseClass, level);
	}

	/**
	 * 直接设置进度条宽度
	 *
	 * @param {number} percent 0~100
	 * @param {string} [level] 语义级别；不传则保持「进行中」的强调态
	 * @returns {void}
	 * @sideEffects DOM
	 */
	function width(percent, level) {
		if (!barEl) return;
		const p = Math.max(0, Math.min(100, Number(percent) || 0));
		barEl.style[widthProp] = p + '%';
		const suffix = level === undefined ? ACCENT : LEVEL_CLASS[level];
		barEl.className = suffix ? barBaseClass + ' ' + suffix : barBaseClass;
	}

	/**
	 * 一步更新「文字 + 进度条」
	 *
	 * @param {number} done 已完成数
	 * @param {number} total 总数
	 * @param {string} [suffix] 追加在百分比后的说明（如「当前：C1234」）
	 * @param {string} [level] 语义级别
	 * @returns {number} 本次使用的百分比
	 * @sideEffects DOM
	 */
	function progress(done, total, suffix, level) {
		const p = percentOf(done, total);
		text(`${done} / ${total} ${p}%${suffix ? '　' + suffix : ''}`, level);
		width(p, level);
		return p;
	}

	/**
	 * 复位：清空文字与进度条
	 *
	 * @returns {void}
	 * @sideEffects DOM
	 */
	function reset() {
		text('', '');
		width(0, '');
	}

	return { text: text, progress: progress, width: width, reset: reset };
}
