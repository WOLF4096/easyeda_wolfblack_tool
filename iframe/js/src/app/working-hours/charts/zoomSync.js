/**
 * @//module/ app/working-hours/charts/zoomSync
 * @//description/ dataZoom 事件 → 防抖 → 重算 的联动注册器（主图 / 工程管理图共用）
 * @//exports/ linkZoom
 * @//dependencies/ 无
 * @//example/ const link = linkZoom([{ id: 'main', view, onZoom: handleZoomOrPan }], { sourceId: 'main' })
 *            link.dispose() // 页面卸载 / 图表重建时清理定时器
 *
 * 拆分前主图与工程管理图各自写了一遍「let zoomTimer + clearTimeout + setTimeout(120)」，
 * 重建工程管理图时旧定时器不会被清掉（闭包里的 zoomTimer 随旧实例一起丢弃，但 setTimeout 仍在跑，
 * 回调里去 getOption() 一个已 dispose 的实例）。这里把「一个视图一个防抖槽」收敛到一处，
 * 并在 dispose 时统一切断。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 把窗口同步给同组的其它视图
 *
 * @param {Array<object>} entries 已注册的视图项
 * @param {object} from 触发方
 * @returns {void}
 * @sideEffects 触达其它图表
 */
function mirrorWindow(entries, from) {
	const option = from.view.getOption();
	const dz = option && option.dataZoom && option.dataZoom[0];
	if (!dz || dz.startValue === undefined) return;
	for (const entry of entries) {
		if (entry === from) continue;
		entry.view.dispatchAction({ type: 'dataZoom', startValue: dz.startValue, endValue: dz.endValue });
	}
}

/**
 * 注册 dataZoom 联动
 *
 * @param {Array<{id: string, view: object, onZoom: Function}>} views 视图项（view 需实现 on/getOption/dispatchAction）
 * @param {object} [options] 选项
 * @param {string} [options.sourceId] 源视图 id（mirror 开启时它是唯一不被反向覆盖的视图）
 * @param {boolean} [options.mirror=false] 是否把缩放窗口同步给同组其它视图（默认关闭，保持各图独立缩放）
 * @param {number} [options.delay=120] 防抖毫秒数
 * @returns {{dispose: Function}} 句柄
 * @sideEffects 注册事件监听与定时器
 */
export function linkZoom(views, options) {
	const opts = options || {};
	const delay = opts.delay === undefined ? 120 : opts.delay;
	const mirror = opts.mirror === true;
	const timers = new Map();
	const entries = (views || []).filter((item) => item && item.view);

	for (const entry of entries) {
		entry.view.on('dataZoom', () => {
			const prev = timers.get(entry.id);
			if (prev) clearTimeout(prev);
			timers.set(
				entry.id,
				setTimeout(() => {
					timers.delete(entry.id);
					entry.onZoom();
					if (mirror && entry.id !== opts.sourceId) mirrorWindow(entries, entry);
				}, delay)
			);
		});
	}

	return {
		/**
		 * 切断所有待执行的防抖回调
		 *
		 * @returns {void}
		 * @sideEffects 清理定时器
		 */
		dispose() {
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		},
	};
}
