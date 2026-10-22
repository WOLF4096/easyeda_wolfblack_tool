/**
 * @//module/ app/working-hours/index
 * @//description/ 工时页入口：读配置 → 聚合 → 6 个图表视图编排 → 导出（本文件无导出）
 * @//exports/ 无
 * @//dependencies/ core/log, app/working-hours/{runtime,aggregate,dayRange,reminderApp,exportReport}, app/working-hours/charts*, app/working-hours/views*
 * @//example/ 由 iframe/WorkingHours.html 加载（同页需先加载 echarts.min.js / fflate.js）
 *
 * 职责边界：本文件只做「取数据 → 建视图 → 绑事件 → 刷文本」。
 * 所有 option 由 charts/options/* 的纯函数产出、所有缩放计算在 charts/zoomModel.js、
 * 各面板的重绘逻辑在 views/*Panel.js，所以图表的可视结果能脱离浏览器断言。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { logger } from '../../core/log.js';
import { buildDataset, getTodayWorkHours as todayWorkHours } from './aggregate.js';
import { data, ui, chartData, applyDataset, resetChartCache } from './runtime.js';
import { getDayAlignedIndices } from './dayRange.js';
import { createReminderApp } from './reminderApp.js';
import { createExporter } from './exportReport.js';
import { createChartView } from './charts/chartView.js';
import { bindRightDrag } from './charts/rightDrag.js';
import { linkZoom } from './charts/zoomSync.js';
import { createZoomApplier } from './charts/zoomApply.js';
import { buildTimelineOption } from './charts/options/timelineChart.js';
import { buildHeatmapOption } from './charts/options/heatmap.js';
import { initLegendPanel } from './views/legendPanel.js';
import { createManagePanel } from './views/managePanel.js';
import { createRhythmPanel } from './views/rhythmPanel.js';
import { createWeeklyPanel } from './views/weeklyPanel.js';
import { createTabRouter } from './views/tabRouter.js';
import { createDataAdmin } from './views/dataAdmin.js';
import { exportWeeklyReport } from './views/weeklyExport.js';

// ==========================================
// [1] 六个图表视图（统一生命周期，见 charts/chartView.js）
// ==========================================
const mainView = createChartView({ el: 'chart-container' });
const manageView = createChartView({ el: 'manage-chart-container' });
const heatmapView = createChartView({ el: 'heatmap-container' });
const rhythmView = createChartView({ el: 'rhythm-chart-container' });
const weeklyBarView = createChartView({ el: 'weekly-bar-chart' });
const weeklyPieView = createChartView({ el: 'weekly-pie-chart' });
const ALL_VIEWS = [mainView, manageView, heatmapView, rhythmView, weeklyBarView, weeklyPieView];

// ==========================================
// [2] 面板控制器（缩放 / 管理 / 节律 / 周报）
// ==========================================
const zoomer = createZoomApplier({ data: data, ui: ui, mainView: mainView, manageView: manageView });
const managePanel = createManagePanel({ data: data, ui: ui, view: manageView, zoomer: zoomer });
const rhythmPanel = createRhythmPanel({ data: data, ui: ui, view: rhythmView });
const weeklyPanel = createWeeklyPanel({ data: data, ui: ui, barView: weeklyBarView, pieView: weeklyPieView });

// ==========================================
// [3] 数据加载
// ==========================================

/**
 * 今日工时（小时）
 *
 * @param {string|null} [targetUuid=null] 只统计某个工程
 * @returns {number} 小时数
 * @sideEffects 无
 */
function getTodayWorkHours(targetUuid) {
	return todayWorkHours(data.timeline, data.tsMap, data.todayTs, targetUuid || null);
}

/**
 * 从扩展配置重新加载全部数据
 *
 * @returns {Promise<void>}
 * @sideEffects 改写 runtime.data
 */
async function loadAllData() {
	try {
		const info = await eda.dmt_Project.getCurrentProjectInfo();
		if (info) {
			ui.currentUuid = info.uuid;
			ui.currentName = info.friendlyName || '未命名工程';
		}
	} catch (e) {
		logger.info('当前未在有效的工程上下文中');
	}

	let allConfigs = {};
	try {
		allConfigs = (await eda.sys_Storage.getExtensionAllUserConfigs()) || {};
	} catch (e) {
		logger.error('扩展数据配置读取失败', e);
	}

	applyDataset(buildDataset(allConfigs, { currentUuid: ui.currentUuid, currentName: ui.currentName }));
	router.updateHeaderStats();
}

// ==========================================
// [4] 热力图
// ==========================================

/**
 * 热力图点击：把主图缩放到那一天
 *
 * @param {object} params echarts 事件参数
 * @returns {void}
 * @sideEffects 派发 dataZoom + 重算主图
 */
function onHeatmapClick(params) {
	const targetTs = new Date(String(params.value[0]).replace(/-/g, '/') + ' 00:00:00').getTime();
	const bounds = getDayAlignedIndices(targetTs, targetTs, data.timeline, data.tsMap, data.todayTs);
	if (!mainView.isReady) return;
	mainView.dispatchAction({ type: 'dataZoom', startValue: bounds.startValue, endValue: bounds.endValue });
	zoomer.handleMain();
}

/**
 * 重绘热力图（首次会创建实例并绑定点击）
 *
 * @returns {void}
 * @sideEffects 重绘热力图
 */
function renderHeatmap() {
	if (!heatmapView.isReady) {
		if (!heatmapView.init()) return;
		heatmapView.on('click', onHeatmapClick);
	}
	heatmapView.setOption(
		buildHeatmapOption(data.timeline, 'dark', {
			nowTs: Date.now(),
			filterUuid: ui.activeTab === 'project' ? ui.selectedDetailUuid : null,
			hiddenSeries: ui.hiddenSeries,
			projectMeta: data.projectMeta,
		})
	);
}

// ==========================================
// [5] 主图 + 图例
// ==========================================

/**
 * 图例点击后的重绘分派
 *
 * @returns {void}
 * @sideEffects 重绘对应视图
 */
function onSeriesToggled() {
	resetChartCache('main');
	resetChartCache('manage');

	if (ui.activeTab === 'manage' && ui.selectedManageUuid) zoomer.handleManage();
	else if (ui.activeTab === 'rhythm') rhythmPanel.render();
	else {
		zoomer.handleMain();
		renderHeatmap();
	}
}

/**
 * 初始化主图与图例交互
 *
 * @returns {void}
 * @sideEffects 创建实例、绑定事件、首屏渲染
 */
function initChartCore() {
	initLegendPanel({
		hiddenSeries: ui.hiddenSeries,
		projectStats: data.projectStats,
		sortedProjectIds: data.sortedProjectIds,
		projectMeta: data.projectMeta,
		getRhythmAgg: () => ui.rhythmAgg,
		getActiveTab: () => ui.activeTab,
		getSelectedDetailUuid: () => ui.selectedDetailUuid,
		getSelectedManageUuid: () => ui.selectedManageUuid,
		onSeriesToggled: onSeriesToggled,
	});

	if (!mainView.init()) return;
	mainView.setOption(
		buildTimelineOption(chartData(), 'dark', {
			bounds: getDayAlignedIndices(data.todayTs, data.todayTs, data.timeline, data.tsMap, data.todayTs),
			isManage: false,
			getClusterSize: () => ui.mainClusterSize,
			getActiveTab: () => ui.activeTab,
			getCurrentUuid: () => ui.currentUuid,
		})
	);
	bindRightDrag(mainView, { getMaxIndex: () => data.timeline.length - 1 });
	linkZoom([{ id: 'main', view: mainView, onZoom: zoomer.handleMain }], { sourceId: 'main' });
	zoomer.handleMain();
	renderHeatmap();
}

// ==========================================
// [6] 组装：路由器 / 导出器 / 危险操作 / 提醒规则
// ==========================================
const reminderApp = createReminderApp();
const exporter = createExporter({ ui: ui, data: data });

const router = createTabRouter({
	ui: ui,
	data: data,
	getTodayWorkHours: getTodayWorkHours,
	renderHeatmap: renderHeatmap,
	handleZoomOrPan: zoomer.handleMain,
	resetMainCache: () => resetChartCache('main'),
	mainChart: mainView,
	renderRhythmChart: rhythmPanel.render,
	resizeRhythmChart: () => rhythmView.resize(),
	updateRhythmProjectSelector: rhythmPanel.updateProjectSelector,
	renderWeeklyReport: weeklyPanel.render,
	renderManageTable: managePanel.refreshTable,
	resizeManageChart: () => manageView.resize(),
	renderReminder: () => reminderApp.render(),
});

const admin = createDataAdmin({
	ui: ui,
	data: data,
	hooks: {
		reloadData: loadAllData,
		switchTab: router.switchTab,
		// 注意：重建图表要用模板方法（bind），不能直接传 panel 上的方法引用
		renderManageTable: () => managePanel.refreshTable(),
		initManageChart: (uuid) => managePanel.initChart(uuid),
		disposeManageChart: () => manageView.destroy(),
		updateProjectSelector: router.updateProjectSelector,
		onProjectSelectorChange: router.onProjectSelectorChange,
	},
});

// ==========================================
// [7] 生命周期
// ==========================================
window.addEventListener('resize', () => {
	for (const view of ALL_VIEWS) view.resize();
});

(async function main() {
	try {
		// 让主线程喘口气，先把 loading 动画渲染出来（否则大工程会白屏几秒）
		await new Promise((resolve) => setTimeout(resolve, 50));

		await loadAllData();
		initChartCore();
		await reminderApp.init();

		document.getElementById('loading-mask').style.display = 'none';
		router.switchTab('total');
	} catch (e) {
		const mask = document.getElementById('loading-mask');
		mask.innerText = '内核渲染矩阵加载失败: ' + e.message;
		logger.error('工时页初始化失败', e);
	}
})();

const exportWeeklyReportImage = () => exportWeeklyReport({ barView: weeklyBarView, pieView: weeklyPieView });

// ==========================================
// [8] 行内事件契约
// ==========================================
// 这些函数/对象被 WorkingHours.html 的行内 onclick 直接引用。
// 打包成 IIFE 后它们不再是全局的，必须显式挂到 window，否则按钮会静默失效。
// 只暴露 HTML 真正用到的那几个，其余仍留在模块作用域内。
Object.assign(window, {
	// 下面两个只出现在「表格行」的 innerHTML 里（不是静态 HTML），漏了按钮就点不动
	exportProjectChart: exporter.exportProjectChart,
	confirmDeleteProject: admin.confirmDeleteProject,
	switchTab: router.switchTab,
	sortTable: managePanel.sortTable,
	changeWeek: weeklyPanel.changeWeek,
	clearAllDataConfirm: admin.clearAllDataConfirm,
	exportAllDataJson: exporter.exportAllDataJson,
	exportTotalChart: exporter.exportTotalChart,
	exportWeeklyReport: exportWeeklyReportImage,
	onCustomDateChange: rhythmPanel.selectCustom,
	onProjectSelectorChange: router.onProjectSelectorChange,
	onQuickTimeChange: rhythmPanel.selectQuick,
	renderRhythmChart: rhythmPanel.render,
	setRhythmMode: rhythmPanel.setMode,
	ReminderApp: reminderApp,
});
