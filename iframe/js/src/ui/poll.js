/**
 * @//module/ ui/poll
 * @//description/ 定时轮询「当前选中对象」等外部状态：带重入锁、变化检测与页面隐藏自动暂停
 * @//exports/ sameIds, createPoll
 * @//dependencies/ 无
 * @//example/ const { createPoll } = await import('./ui/poll.js')
 *            const poll = createPoll({
 *              fetchItems: () => eda.pcb_SelectControl.getAllSelectedPrimitives(),
 *              onItems: (pins) => { countEl.textContent = pins.length },
 *              intervalMs: 200
 *            })
 *            poll.start()
 *
 * 项目里有 5 处「定时取选中集 / 定时取鼠标位置」的实现，问题各不相同且都被踩过：
 *   - PinSorting：`async` 回调无重入保护（宿主慢时请求会叠加）、没有停止条件、无变化检测；
 *   - ImportImage / ImportQrcode：跟手放置各自一套，间隔 50ms / 20ms；
 *   - ReplaceComponent：1s 轮询等用户框选，拿到后靠内部标志位退出；
 *   - EDABridge：100ms 采样 + 500ms 上报（本仓最完整的一份）。
 * 这里统一为一份：**同一时刻只有一个在途请求**、**结果没变不回调**、**页面不可见时跳过**。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 判断两批对象的 id 序列是否完全相同
 *
 * 只比较 id（或 `primitiveId`），避免整对象深比较拖慢 200ms 级的轮询。
 *
 * @param {Array<object|string|number>} a 前一批
 * @param {Array<object|string|number>} b 后一批
 * @returns {boolean} 顺序与内容都相同返回 true
 * @sideEffects 无（纯函数）
 */
export function sameIds(a, b) {
	const listA = Array.isArray(a) ? a : [];
	const listB = Array.isArray(b) ? b : [];
	if (listA.length !== listB.length) return false;
	const ids = new Set(listA.map(idOf));
	for (const item of listB) {
		if (!ids.has(idOf(item))) return false;
	}
	return true;
}

/**
 * 取一个对象的标识
 *
 * @param {object|string|number} item 对象或标量
 * @returns {string|number} `id` / `primitiveId` / 自身
 * @sideEffects 无（纯函数）
 */
function idOf(item) {
	if (item === null || item === undefined) return '';
	if (typeof item === 'object') return item.id ?? item.primitiveId ?? '';
	return item;
}

/**
 * 创建轮询器
 *
 * @param {object} options 选项
 * @param {() => Promise<Array>} options.fetchItems 取当前状态（必须返回 Promise）
 * @param {(items: Array) => void} options.onItems 状态变化时的回调（首次必定触发）
 * @param {number} [options.intervalMs=200] 轮询间隔
 * @param {(a: Array, b: Array) => boolean} [options.isEqual=sameIds] 相等判定
 * @param {boolean} [options.skipWhenHidden=true] 页面不可见时跳过本轮
 * @param {Document} [options.doc=document] 文档对象（读 hidden）
 * @param {{setInterval: Function, clearInterval: Function}} [options.timers] 定时器实现（便于测试）
 * @returns {{start: Function, stop: Function, running: Function, tick: Function}} 控制器
 * @sideEffects 注册/清除定时器；调用 fetchItems 与 onItems
 */
export function createPoll(options = {}) {
	const fetchItems = options.fetchItems;
	const onItems = options.onItems;
	const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 200;
	const isEqual = typeof options.isEqual === 'function' ? options.isEqual : sameIds;
	const skipWhenHidden = options.skipWhenHidden !== false;
	const doc = options.doc || globalThis.document || null;
	// 必须包一层：把 window.setInterval 存进对象再调用，this 不是 window，Chrome 会抛 Illegal invocation
	const timers = options.timers || {
		setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
		clearInterval: (handle) => globalThis.clearInterval(handle),
	};

	let handle = null;
	let busy = false;
	let last = null;
	let stopped = false;

	/**
	 * 本轮是否该直接跳过（重入 / 已停止 / 页面隐藏 / 没有取数函数）
	 *
	 * @returns {boolean} 是否跳过
	 * @sideEffects 无
	 */
	function shouldSkip() {
		if (busy || stopped) return true;
		if (skipWhenHidden && doc && doc.hidden) return true;
		return typeof fetchItems !== 'function';
	}

	/**
	 * 把新一批结果交给回调（结果没变就不回调）
	 *
	 * @param {Array} items 本轮取到的结果
	 * @returns {boolean} 是否真正触发了 onItems
	 * @sideEffects 调用 onItems
	 */
	function applyItems(items) {
		if (stopped) return false;
		if (last !== null && isEqual(items, last)) return false;
		last = items;
		if (typeof onItems === 'function') onItems(items);
		return true;
	}

	/**
	 * 执行一轮
	 *
	 * @returns {Promise<boolean>} 本轮是否真正触发了 onItems
	 * @sideEffects 调用 fetchItems / onItems
	 */
	async function tick() {
		if (shouldSkip()) return false;
		busy = true;
		try {
			const items = await fetchItems();
			return applyItems(items);
		} catch (e) {
			// 宿主在切换文档时偶尔会抛错，轮询不该因此中断
			return false;
		} finally {
			busy = false;
		}
	}

	/**
	 * 启动（重复调用不会叠加定时器）
	 *
	 * @returns {void}
	 * @sideEffects 注册定时器
	 */
	function start() {
		if (handle !== null) return;
		stopped = false;
		handle = timers.setInterval(() => {
			void tick();
		}, intervalMs);
	}

	/**
	 * 停止（幂等）
	 *
	 * @returns {void}
	 * @sideEffects 清除定时器
	 */
	function stop() {
		stopped = true;
		if (handle === null) return;
		timers.clearInterval(handle);
		handle = null;
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

	return { start: start, stop: stop, running: running, tick: tick };
}
