/**
 * @//module/ ui/progressTicker
 * @//description/ 「假进度」定时器：耗时操作期间把进度条缓慢推到某个上限，收尾时停掉
 * @//exports/ advanceProgress, createProgressTicker
 * @//dependencies/ 无
 * @//example/ const { createProgressTicker } = await import('./ui/progressTicker.js')
 *            const t = createProgressTicker({ from: 80, to: 99, step: 1, intervalMs: 1000 })
 *            t.start()
 *            // …写入完成后
 *            t.stop()
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 推进一步（不越过上限）
 *
 * @param {number} value 当前值
 * @param {object} opts 参数
 * @param {number} opts.to 上限
 * @param {number} [opts.step=1] 步进
 * @returns {number} 新值（已夹到上限）
 * @sideEffects 无（纯函数）
 */
export function advanceProgress(value, opts) {
	const to = Number(opts && opts.to);
	const step = Number(opts && opts.step);
	const next = Number(value) + (Number.isFinite(step) && step > 0 ? step : 1);
	if (!Number.isFinite(to)) return next;
	return Math.min(to, next);
}

/**
 * 创建进度推进器
 *
 * 为什么要「假进度」：取工程包、逐件写图元这些操作无法拿到真实进度，
 * 界面完全不动会让用户以为卡死。做法是定时把进度从 from 缓慢推到 to（永不到 100），
 * 真正的完成信号由调用方在收尾时给出。
 *
 * @param {object} [options] 选项
 * @param {number} [options.from=0] 起始值
 * @param {number} [options.to=99] 上限（不会自动越过）
 * @param {number} [options.step=1] 每次步进
 * @param {number} [options.intervalMs=1000] 间隔
 * @param {(value: number) => void} [options.onTick] 每次推进后的回调
 * @param {{setInterval: Function, clearInterval: Function}} [options.timers] 定时器实现（便于测试）
 * @returns {{start: Function, stop: Function, value: Function, running: Function}} 控制器
 * @sideEffects 启动后注册定时器；stop 后清除
 */
export function createProgressTicker(options = {}) {
	// 必须包一层：把 window.setInterval 存进对象再调用，this 不是 window，Chrome 会抛 Illegal invocation
	const timers = options.timers || {
		setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
		clearInterval: (handle) => globalThis.clearInterval(handle),
	};
	const to = Number.isFinite(Number(options.to)) ? Number(options.to) : 99;
	const step = Number.isFinite(Number(options.step)) ? Number(options.step) : 1;
	const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 1000;
	const onTick = typeof options.onTick === 'function' ? options.onTick : null;
	let current = Number.isFinite(Number(options.from)) ? Number(options.from) : 0;
	let handle = null;

	/**
	 * 启动（重复调用不会叠加定时器）
	 *
	 * @returns {void}
	 * @sideEffects 注册定时器
	 */
	function start() {
		if (handle !== null) return;
		handle = timers.setInterval(() => {
			const next = advanceProgress(current, { to: to, step: step });
			// 已到上限：值没变就不再回调，避免每秒对它重复写一次同样的宽度
			if (next === current) return;
			current = next;
			if (onTick) onTick(current);
		}, intervalMs);
	}

	/**
	 * 停止并清除定时器（幂等）
	 *
	 * @returns {void}
	 * @sideEffects 清除定时器
	 */
	function stop() {
		if (handle === null) return;
		timers.clearInterval(handle);
		handle = null;
	}

	/**
	 * 当前值
	 *
	 * @returns {number} 当前进度
	 * @sideEffects 无
	 */
	function value() {
		return current;
	}

	/**
	 * 是否在跑
	 *
	 * @returns {boolean} 是否已启动且未停止
	 * @sideEffects 无
	 */
	function running() {
		return handle !== null;
	}

	return { start: start, stop: stop, value: value, running: running };
}
