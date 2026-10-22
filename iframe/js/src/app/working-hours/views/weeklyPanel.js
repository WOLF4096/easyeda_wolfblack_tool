/**
 * @//module/ app/working-hours/views/weeklyPanel
 * @//description/ 周报面板：周次切换、两张图与汇总卡片的渲染
 * @//exports/ createWeeklyPanel
 * @//dependencies/ app/working-hours/time, app/working-hours/charts/options/weekly
 * @//example/ const panel = createWeeklyPanel({ data, ui, barView, pieView })
 *            panel.render(); panel.changeWeek(-1)
 *
 * 两张图用 `setOption(option, true)`（notMerge）—— 周报的 series 数量随「这周有哪些工程」
 * 变化，合并模式下上一周的 series 会残留成幽灵柱。
 */

import { formatDuration } from '../time.js';
import { getWeekInfo, aggregateWeekly, pickTopProject, buildWeeklyBarOption, buildWeeklyPieOption } from '../charts/options/weekly.js';

/**
 * 创建周报面板控制器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.data 数据集
 * @param {object} ctx.ui 交互状态（weeklyOffset 会被改写）
 * @param {object} ctx.barView 柱状图视图
 * @param {object} ctx.pieView 饼图视图
 * @returns {{render: Function, changeWeek: Function}} 控制器
 * @sideEffects 无（调用时才重绘）
 */
export function createWeeklyPanel(ctx) {
	const data = ctx.data;
	const ui = ctx.ui;

	/**
	 * 重绘周报
	 *
	 * @returns {void}
	 * @sideEffects 重绘图表 + 写 DOM
	 */
	function render() {
		ctx.barView.init();
		ctx.pieView.init();

		const info = getWeekInfo(ui.weeklyOffset, Date.now());
		document.getElementById('weekly-range-text').innerText = info.rangeText;

		const agg = aggregateWeekly(data.timeline, info.monday);
		document.getElementById('weekly-total-work').innerText = formatDuration(agg.totalSeconds);
		document.getElementById('weekly-avg-work').innerText = formatDuration(Math.round(agg.totalSeconds / 7));
		document.getElementById('weekly-top-project').innerText = pickTopProject(agg.projectTotals, data.projectMeta);

		ctx.barView.setOption(
			buildWeeklyBarOption(
				{ weekData: agg.weekData, projectMeta: data.projectMeta, pidColorMap: data.pidColorMap, sortedProjectIds: data.sortedProjectIds },
				'dark'
			),
			true
		);
		ctx.pieView.setOption(buildWeeklyPieOption({ projectTotals: agg.projectTotals, projectMeta: data.projectMeta, pidColorMap: data.pidColorMap }, 'dark'), true);
	}

	/**
	 * 切换周次
	 *
	 * @param {number} delta 偏移（-1 上一周 / 1 下一周）
	 * @returns {void}
	 * @sideEffects 重绘
	 */
	function changeWeek(delta) {
		ui.weeklyOffset += delta;
		render();
	}

	return { render: render, changeWeek: changeWeek };
}
