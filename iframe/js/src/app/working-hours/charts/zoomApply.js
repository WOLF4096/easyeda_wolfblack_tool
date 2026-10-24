/**
 * @//module/ app/working-hours/charts/zoomApply
 * @//description/ 把「dataZoom 窗口」落到图表上：算参数 → 刷图例 → 按缓存决定要不要 setOption
 * @//exports/ createZoomApplier
 * @//dependencies/ app/working-hours/charts/{zoomModel,seriesData,legendHtml}
 * @//example/ const zoomer = createZoomApplier({ data, ui })
 *            zoomer.apply(mainView, { key: 'main', filterByUuid: false, legendListId: 'legend-list' })
 *
 * 这里读 `ui` / `data` 的运行态（不是纯函数），但**所有数值**都来自 zoomModel 的纯函数，
 * 所以「缩放后柱子高度不对」仍然可以在 node 里逐条断言（见 test/workingHoursCharts.test.mjs）。
 *
 * 缓存判断的两段是分开的：聚簇/刻度变了才重建 series 数据，只有 Y 上限变了就单独 setOption，
 * 否则每次缩放都要重算整条 custom series（大工程里这是肉眼可见的卡顿）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { chartData } from '../runtime.js';
import { buildLegendHtml } from './legendHtml.js';
import { buildClusterSeries, buildHourIntervalFormatter } from './seriesData.js';
import { computeVisibleMax, computeZoomWindow, finalizeYMax } from './zoomModel.js';

/**
 * 创建缩放应用器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.data 数据集（timeline / projectMeta）
 * @param {object} ctx.ui 交互状态（clusterSize 与 chartCache 会被改写）
 * @returns {{apply: Function, handleMain: Function, handleManage: Function}} 应用器
 * @sideEffects 无（调用时才重绘）
 */
export function createZoomApplier(ctx) {
	const data = ctx.data;
	const ui = ctx.ui;

	/**
	 * 应用一次缩放
	 *
	 * @param {object} view 图表视图
	 * @param {object} opts 参数
	 * @param {'main'|'manage'} opts.key 缓存键
	 * @param {boolean} opts.filterByUuid 是否只统计单个工程
	 * @param {string|null} opts.filterUuid 被统计的工程
	 * @param {string} opts.legendListId 图例容器 id
	 * @returns {void}
	 * @sideEffects 重绘图表 + 改写图例 DOM
	 */
	function apply(view, opts) {
		const option = view.getOption();
		if (!option || !option.dataZoom || !option.dataZoom[0]) return;

		const win = computeZoomWindow(data.timeline, option.dataZoom[0]);
		if (opts.key === 'main') ui.mainClusterSize = win.clusterSize;
		else ui.manageClusterSize = win.clusterSize;

		refreshLegend(opts, win);
		const dynamicYMax = updateSeries(view, opts, win);

		const cache = ui.chartCache[opts.key];
		if (dynamicYMax !== cache.lastDynamicYMax) {
			view.setOption({ yAxis: { max: dynamicYMax } });
			cache.lastDynamicYMax = dynamicYMax;
		}
	}

	/**
	 * 重画图例（主图按 tab 决定是否只看当前工程，管理图只看选中工程）
	 *
	 * @param {object} opts 参数
	 * @param {object} win computeZoomWindow 的结果
	 * @returns {void}
	 * @sideEffects 写 DOM
	 */
	function refreshLegend(opts, win) {
		const targetUuid = opts.key === 'main' ? (ui.activeTab === 'project' ? ui.selectedDetailUuid : null) : ui.selectedManageUuid;
		const legendEl = document.getElementById(opts.legendListId);
		if (legendEl) legendEl.innerHTML = buildLegendHtml(chartData(), { startIdx: win.startIdx, endIdx: win.endIdx, targetUuid: targetUuid });
	}

	/**
	 * 按缓存决定是否重建 series，并返回新的 Y 轴上限
	 *
	 * @param {object} view 图表视图
	 * @param {object} opts 参数
	 * @param {object} win computeZoomWindow 的结果
	 * @returns {number} Y 轴上限
	 * @sideEffects 可能 setOption
	 */
	function updateSeries(view, opts, win) {
		const cache = ui.chartCache[opts.key];
		const changed = win.clusterSize !== cache.lastClusterSize || win.dataYMax !== cache.lastYMax || win.hourInterval !== cache.lastHourInterval;

		if (changed) {
			view.setOption({
				xAxis: { axisLabel: { interval: buildHourIntervalFormatter(win.hourInterval) } },
				series: [
					{},
					{
						data: buildClusterSeries(chartData(), {
							clusterSize: win.clusterSize,
							yMax: win.dataYMax,
							filterPid: opts.filterByUuid ? opts.filterUuid : null,
						}),
					},
				],
			});
			cache.lastClusterSize = win.clusterSize;
			cache.lastYMax = win.dataYMax;
			cache.lastHourInterval = win.hourInterval;
		}

		const visibleMax = computeVisibleMax(data.timeline, {
			startIdx: win.startIdx,
			endIdx: win.endIdx,
			clusterSize: win.clusterSize,
			filterByUuid: opts.filterByUuid,
			filterUuid: opts.filterUuid,
			hiddenSeries: ui.hiddenSeries,
			projectMeta: data.projectMeta,
		});
		return finalizeYMax(visibleMax, win.dataYMax);
	}

	return {
		apply: apply,

		/**
		 * 主图的重算入口
		 *
		 * @returns {void}
		 * @sideEffects 重绘主图
		 */
		handleMain() {
			apply(ctx.mainView, {
				key: 'main',
				filterByUuid: ui.activeTab === 'project',
				filterUuid: ui.selectedDetailUuid,
				legendListId: 'legend-list',
			});
		},

		/**
		 * 工程管理图的重算入口
		 *
		 * @returns {void}
		 * @sideEffects 重绘工程管理图
		 */
		handleManage() {
			apply(ctx.manageView, {
				key: 'manage',
				filterByUuid: true,
				filterUuid: ui.selectedManageUuid,
				legendListId: 'm-legend-list',
			});
		},
	};
}
