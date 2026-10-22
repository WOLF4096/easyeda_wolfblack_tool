/**
 * @//module/ pcb/placement
 * @//description/ 「跟随鼠标」放置控制器：按固定间隔取鼠标位置并交给调用方移动图元
 * @//exports/ createFollowPlacer
 * @//dependencies/ 无
 * @//example/ const { createFollowPlacer } = await import('./pcb/placement.js')
 *            const placer = createFollowPlacer({ getPoint: () => eda.pcb_SelectControl.getCurrentMousePosition() })
 *            placer.start(async (pt) => eda.pcb_PrimitiveObject.modify(id, { topLeftX: pt.x, topLeftY: pt.y }))
 *            …
 *            placer.stop()
 *
 * 两个放置类页面（导入图片 / 导入二维码）各写过一份 setInterval 跟随，间隔 50ms / 20ms 不同，
 * **取消语义也不一致**（图片页把 `window.onblur` 当"落地提交"，二维码页只是"停止跟随"）。
 * 这里只收敛"跟随"这一半：怎么定位、什么时候提交由调用方决定。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 创建跟随器
 *
 * @param {object} options 选项
 * @param {() => Promise<{x: number, y: number}|null>} options.getPoint 取当前鼠标位置（宿主 API）
 * @param {number} [options.intervalMs=20] 刷新间隔
 * @param {{setInterval: Function, clearInterval: Function}} [options.timers] 定时器实现（便于测试）
 * @returns {{start: Function, stop: Function, running: Function}} 控制器
 * @sideEffects start 后注册定时器并周期调用 getPoint / apply
 */
export function createFollowPlacer(options = {}) {
	// 必须包一层：把 window.setInterval 存进对象再调用，this 不是 window，Chrome 会抛 Illegal invocation
	const timers = options.timers || {
		setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
		clearInterval: (handle) => globalThis.clearInterval(handle),
	};
	const getPoint = options.getPoint;
	const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 20;
	let handle = null;
	let busy = false;

	/**
	 * 开始跟随（重复调用会先停掉旧的）
	 *
	 * @param {(point: {x: number, y: number}) => Promise<void>|void} apply 收到新位置后如何移动图元
	 * @returns {boolean} 是否成功启动
	 * @sideEffects 注册定时器；异常时自动停止
	 */
	function start(apply) {
		stop();
		if (typeof getPoint !== 'function' || typeof apply !== 'function') return false;
		handle = timers.setInterval(async () => {
			if (busy) return;
			busy = true;
			try {
				const point = await getPoint();
				if (point) await apply(point);
			} catch (e) {
				// 图元被删/文档切换时宿主会抛错，此时停止跟随而不是无脑重试
				stop();
			} finally {
				busy = false;
			}
		}, intervalMs);
		return true;
	}

	/**
	 * 停止跟随（幂等）
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
	 * 是否在跟随
	 *
	 * @returns {boolean} 是否已启动且未停止
	 * @sideEffects 无
	 */
	function running() {
		return handle !== null;
	}

	return { start: start, stop: stop, running: running };
}
