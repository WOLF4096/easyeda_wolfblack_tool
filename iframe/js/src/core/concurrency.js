/**
 * @//module/ core/concurrency
 * @//description/ 分片并发执行并主动让出主线程（长任务不卡 UI，进度条能重绘）
 * @//exports/ mapInChunks, DEFAULT_CHUNK_SIZE, DEFAULT_YIELD_MS
 * @//dependencies/ 无
 * @//example/ const { mapInChunks } = await import('./core/concurrency.js')
 *            await mapInChunks(ids, 10, (id) => placeTempComponent(id), { onProgress: (done, total) => bar.progress(done, total) })
 *
 * 为什么需要：批量替换器件时一次要放置上百个临时器件。宿主 API 是跨 iframe 的同步调用，
 * 直接 `Promise.all` 铺满会把主线程占死 —— 进度条一格都不动，用户会以为插件卡死。
 * 分片 + 每片结束后 `setTimeout(…, 0)` 让出一次，浏览器才有机会重绘。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 默认每片并发数 */
export const DEFAULT_CHUNK_SIZE = 10;

/** 默认每片结束后的让出时长（毫秒）。0 表示不让出（仅测试用） */
export const DEFAULT_YIELD_MS = 10;

/**
 * 分片并发执行
 *
 * 语义要点：
 *   - **片内并发、片间串行**：保证同一时刻在飞的宿主调用不超过 `size` 个；
 *   - `mapper` 抛错会中断整批（调用方若需「单项失败继续」必须自己 try/catch）；
 *   - `onProgress` 在 finally 里调用，即使 mapper 抛错也已经计过一次进度。
 *
 * @param {Array} items 待处理项
 * @param {number} size 每片并发数（≤0 或非数字时用默认值）
 * @param {(item: *, index: number) => *} mapper 单项处理函数，可返回 Promise
 * @param {object} [options] 选项
 * @param {number} [options.yieldMs=10] 每片结束后的让出时长（毫秒）
 * @param {(done: number, total: number, item: *) => void} [options.onProgress] 进度回调
 * @returns {Promise<Array>} 与入参同序的结果数组
 * @sideEffects 定时器；`mapper` 与 `onProgress` 自身的副作用
 */
export async function mapInChunks(items, size, mapper, options = {}) {
	const list = Array.isArray(items) ? items : [];
	const chunkSize = Math.max(1, Number(size) || DEFAULT_CHUNK_SIZE);
	const yieldMs = options.yieldMs === undefined ? DEFAULT_YIELD_MS : Number(options.yieldMs) || 0;
	const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

	const results = new Array(list.length);
	let done = 0;

	for (let start = 0; start < list.length; start += chunkSize) {
		const chunk = list.slice(start, start + chunkSize);
		await Promise.all(
			chunk.map(async (item, offset) => {
				try {
					results[start + offset] = await mapper(item, start + offset);
				} finally {
					done += 1;
					if (onProgress) onProgress(done, list.length, item);
				}
			})
		);

		if (yieldMs > 0) {
			await new Promise((resolve) => globalThis.setTimeout(resolve, yieldMs));
		}
	}

	return results;
}
