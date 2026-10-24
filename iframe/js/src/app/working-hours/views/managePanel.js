/**
 * @//module/ app/working-hours/views/managePanel
 * @//description/ 「工程管理」面板：表格排序/选中 + 单工程时间轴图的建、销毁、重算
 * @//exports/ createManagePanel
 * @//dependencies/ app/working-hours/{dayRange,projectSummary,runtime}, app/working-hours/views/manageTable, app/working-hours/charts/*
 * @//example/ const panel = createManagePanel({ data, ui, view, zoomer })
 *            panel.refreshTable(); panel.sortTable('work')
 *
 * 这张图是全页唯一「会被反复销毁重建」的图表（每换一个工程就重建一次），
 * 所以 dataZoom 的联动句柄必须跟着一起 dispose，否则旧图表的定时器会去读已销毁的实例。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { buildTimelineOption } from '../charts/options/timelineChart.js';
import { bindRightDrag } from '../charts/rightDrag.js';
import { linkZoom } from '../charts/zoomSync.js';
import { getDayAlignedIndices } from '../dayRange.js';
import { getProjectTitleString } from '../projectSummary.js';
import { chartData, resetChartCache } from '../runtime.js';
import { renderManageTable, sortProjectList } from './manageTable.js';

/**
 * 创建工程管理面板控制器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.data 数据集
 * @param {object} ctx.ui 交互状态
 * @param {object} ctx.view 管理图视图
 * @param {{handleManage: Function}} ctx.zoomer 缩放应用器
 * @returns {{initChart: Function, refreshTable: Function, sortTable: Function}} 控制器
 * @sideEffects 无（调用时才重建图表）
 */
export function createManagePanel(ctx) {
	const data = ctx.data;
	const ui = ctx.ui;
	const view = ctx.view;
	let zoomLink = null;

	/**
	 * 重建管理图
	 *
	 * @param {string} uuid 工程 id
	 * @returns {void}
	 * @sideEffects 销毁旧实例、创建新实例、重绘
	 */
	function initChart(uuid) {
		if (!uuid || !data.projectStats[uuid]) return;
		if (!document.getElementById('manage-chart-container')) return;

		view.destroy();
		if (zoomLink) {
			zoomLink.dispose();
			zoomLink = null;
		}
		if (!view.init()) return;

		resetChartCache('manage');
		const pStat = data.projectStats[uuid];
		view.setOption(
			buildTimelineOption(chartData(), 'dark', {
				bounds: getDayAlignedIndices(pStat.startTs, pStat.endTs, data.timeline, data.tsMap, data.todayTs),
				isManage: true,
				specificUuid: uuid,
				getClusterSize: () => ui.manageClusterSize,
				getActiveTab: () => ui.activeTab,
				getCurrentUuid: () => ui.currentUuid,
			}),
		);
		bindRightDrag(view, { getMaxIndex: () => data.timeline.length - 1 });
		zoomLink = linkZoom([{ id: 'manage', view: view, onZoom: ctx.zoomer.handleManage }], { sourceId: 'manage' });
		ctx.zoomer.handleManage();
	}

	/**
	 * 行点击
	 *
	 * @param {string} uuid 工程 id
	 * @returns {void}
	 * @sideEffects 更新高亮 + 重建图表
	 */
	function onRowSelect(uuid) {
		ui.selectedManageUuid = uuid;
		document.querySelectorAll('#project-table-body tr').forEach((r) => {
			r.style.background = '';
		});
		const row = document.querySelector(`#project-table-body tr[data-uuid="${uuid}"]`);
		if (row) row.style.background = 'var(--vscode-active)';
		document.getElementById('manage-chart-title').innerText = getProjectTitleString(data.projectStats, uuid);
		initChart(uuid);
	}

	/**
	 * 没有任何工程时的收尾
	 *
	 * @returns {void}
	 * @sideEffects 销毁图表
	 */
	function onEmpty() {
		view.destroy();
		document.getElementById('manage-chart-title').innerText = '当前暂无工程数据';
	}

	/**
	 * 重绘表格并同步图表
	 *
	 * @returns {void}
	 * @sideEffects 写 DOM + 重绘图表
	 */
	function refreshTable() {
		const list = sortProjectList(Object.values(data.projectStats), ui.sortField, ui.sortOrder);
		if (!ui.selectedManageUuid && list.length > 0) ui.selectedManageUuid = list[0].uuid;

		renderManageTable({
			projectStats: data.projectStats,
			sortField: ui.sortField,
			sortOrder: ui.sortOrder,
			selectedUuid: ui.selectedManageUuid,
			onSelect: onRowSelect,
			onNoSelection: onEmpty,
		});

		if (!ui.selectedManageUuid) return;
		const active = list.find((item) => item.uuid === ui.selectedManageUuid);
		if (!active) return;
		document.getElementById('manage-chart-title').innerText = getProjectTitleString(data.projectStats, active.uuid);
		initChart(active.uuid);
	}

	/**
	 * 表头点击排序
	 *
	 * @param {string} field 字段名
	 * @returns {void}
	 * @sideEffects 改写排序状态 + 重绘
	 */
	function sortTable(field) {
		if (ui.sortField === field) ui.sortOrder = ui.sortOrder === 'desc' ? 'asc' : 'desc';
		else {
			ui.sortField = field;
			ui.sortOrder = 'desc';
		}
		refreshTable();
	}

	return {
		initChart: initChart,
		refreshTable: refreshTable,
		sortTable: sortTable,
	};
}
