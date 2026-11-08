/**
 * @//module/ app/eda-bridge/concurrent
 * @//description/ 桥里用到的两个小工具：固定并发度的 map、进度节流
 * @//exports/ mapLimit, throttled
 * @//dependencies/ 无
 * @//example/ await mapLimit(items, 8, async (item) => createOne(item))
 *            const push = throttled((p) => sendProgress(p), 100)
 *
 * 为什么要自己写：EDA 宿主里没有 p-limit 这类库，而导入几十上百个图元时
 * 「串行等每一个」是主要耗时 —— 但也不能无限并发（EDA 主线程扛不住）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 按固定并发度跑完整个列表
 *
 * 结果顺序不重要（失败由回调自己记账），所以这里只保证「全部处理完」。
 * limit 会自动夹到 [1, list.length]，空列表直接返回。
 *
 * @param {Array} list 待处理列表
 * @param {number} limit 并发度
 * @param {(item: *, index: number) => Promise<void>} fn 处理函数
 * @returns {Promise<void>} 全部处理完
 * @sideEffects 由 fn 决定
 */
export async function mapLimit(list, limit, fn) {
	const arr = Array.isArray(list) ? list : [];
	const width = Math.max(1, Math.min(Math.floor(limit) || 1, arr.length || 1));
	let next = 0;
	/**
	 * 一个 worker：不断抢下一个下标，抢不到就退出
	 *
	 * @returns {Promise<void>} 队列取空
	 * @sideEffects 调用 fn
	 */
	const worker = async () => {
		for (;;) {
			const i = next++;
			if (i >= arr.length) return;
			await fn(arr[i], i);
		}
	};
	const workers = [];
	for (let i = 0; i < width; i++) workers.push(worker());
	await Promise.all(workers);
}

/**
 * 进度节流：同一个回调在 gap 毫秒内最多触发一次
 *
 * `force = true` 时强制发出（用于「最后一帧一定要让上层看到 100%」）。
 *
 * @param {(payload: object) => void} cb 回调
 * @param {number} gap 最小间隔（ms）
 * @returns {(payload: object, force?: boolean) => void} 节流后的回调
 * @sideEffects 调用 cb
 */
export function throttled(cb, gap) {
	let last = 0;
	return (payload, force) => {
		if (typeof cb !== 'function') return;
		const now = Date.now();
		if (!force && now - last < gap) return;
		last = now;
		cb(payload);
	};
}
