/**
 * @//module/ app/working-hours/views/legendPanel
 * @//description/ 三块图例面板的交互：折叠、点击隐藏/显示 series、悬浮显示汇总
 * @//exports/ initLegendPanel
 * @//dependencies/ core/util, app/working-hours/time
 * @//example/ initLegendPanel({ hiddenSeries, projectStats, onSeriesToggled })
 *
 * 三块图例（主图 / 工程管理 / 节律）用的是同一套 DOM 结构（`.legend-item[data-name]`），
 * 所以监听挂在 body 上做事件委托 —— 图例会被整体重绘，逐项绑定必然漏。
 */

import { escapeHtml } from '../../../core/util.js';
import { formatDuration } from '../time.js';

/** 图例详情区的兜底文案 */
const DETAIL_HINT = '把鼠标悬浮在工程上查看详情';

/** 折叠按钮的配置：标题 id / 面板 id / 箭头 id */
const COLLAPSE_TARGETS = [
	['legend-title-main', 'custom-legend', 'legend-toggle-icon'],
	['legend-title-manage', 'manage-custom-legend', 'm-legend-toggle-icon'],
	['legend-title-rhythm', 'rhythm-custom-legend', 'r-legend-toggle-icon'],
];

/**
 * 绑定三块图例的折叠按钮
 *
 * @returns {void}
 * @sideEffects 注册 click 监听
 */
function initCollapseToggles() {
	for (const [titleId, panelId, iconId] of COLLAPSE_TARGETS) {
		const title = document.getElementById(titleId);
		if (!title) continue;
		title.addEventListener('click', () => {
			const panel = document.getElementById(panelId);
			if (!panel) return;
			panel.classList.toggle('collapsed');
			const icon = document.getElementById(iconId);
			if (icon) icon.innerText = panel.classList.contains('collapsed') ? '▶' : '▼';
		});
	}
}

/**
 * 取某个工程的工时（工作或空闲）
 *
 * @param {object} ctx 上下文
 * @param {string|null} uuid 工程 id
 * @param {boolean} isWork true 取工作，false 取空闲
 * @returns {number} 秒数
 * @sideEffects 无（纯函数）
 */
function projectTotal(ctx, uuid, isWork) {
	const p = uuid ? ctx.projectStats[uuid] : null;
	if (!p) return 0;
	return isWork ? p.totalWork : p.totalRest;
}

/**
 * 节律图的工时总和（图里只有「工作/空闲」两条 series）
 *
 * @param {object} ctx 上下文
 * @param {boolean} isWork true 取工作，false 取空闲
 * @returns {number} 秒数
 * @sideEffects 无（纯函数）
 */
function rhythmTotal(ctx, isWork) {
	const agg = ctx.getRhythmAgg();
	if (!agg) return 0;
	const arr = isWork ? agg.work : agg.rest;
	let total = 0;
	for (let i = 0; i < arr.length; i += 1) total += arr[i];
	return total;
}

/**
 * 按当前 tab 汇总「工作时间 / 空闲时间」的总秒数
 *
 * @param {object} ctx 上下文
 * @param {string} name series 名
 * @returns {number} 总秒数
 * @sideEffects 无（纯函数）
 */
function seriesTotal(ctx, name) {
	const isWork = name === '工作时间';
	const tab = ctx.getActiveTab();

	if (tab === 'total') {
		return ctx.sortedProjectIds.reduce((sum, uuid) => sum + projectTotal(ctx, uuid, isWork), 0);
	}
	if (tab === 'rhythm') return rhythmTotal(ctx, isWork);

	const selected = tab === 'project' ? ctx.getSelectedDetailUuid() : tab === 'manage' ? ctx.getSelectedManageUuid() : null;
	return projectTotal(ctx, selected, isWork);
}

/**
 * 生成「工时总和」的详情 HTML
 *
 * @param {object} ctx 上下文
 * @param {string} name series 名
 * @returns {string} HTML
 * @sideEffects 无（纯函数）
 */
function totalDetailHtml(ctx, name) {
	const total = seriesTotal(ctx, name);
	return `<div style="color:#fff;">${escapeHtml(name)}总和：<span style="color:var(--vscode-link); font-weight:bold;">${formatDuration(total)}</span></div>`;
}

/**
 * 生成「某个工程」的详情 HTML
 *
 * @param {object} ctx 上下文
 * @param {string} name 工程名
 * @returns {string} HTML；找不到工程返回空串
 * @sideEffects 无（纯函数）
 */
function projectDetailHtml(ctx, name) {
	let targetUuid = null;
	for (const uuid of ctx.sortedProjectIds) {
		if (ctx.projectMeta[uuid] === name) {
			targetUuid = uuid;
			break;
		}
	}
	if (!targetUuid || !ctx.projectStats[targetUuid]) return '';

	const p = ctx.projectStats[targetUuid];
	return `
                    <div style="color:#e0e0e0; font-weight:bold; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(name)}</div>
                    <div style="margin-top:4px;">
                        工作时间: <span style="color:#fff">${formatDuration(p.totalWork)}</span><br/>
                        空闲时间: <span style="color:#fff">${formatDuration(p.totalRest)}</span>
                    </div>`;
}

/**
 * 初始化图例面板交互
 *
 * @param {object} ctx 上下文
 * @param {Set<string>} ctx.hiddenSeries 隐藏的 series 名（本模块直接增删）
 * @param {Record<string, object>} ctx.projectStats 工程统计
 * @param {string[]} ctx.sortedProjectIds 工程 id
 * @param {Record<string, string>} ctx.projectMeta 工程名表
 * @param {() => object|null} ctx.getRhythmAgg 取节律聚合结果
 * @param {() => string} ctx.getActiveTab 取当前 tab
 * @param {() => string|null} ctx.getSelectedDetailUuid 取「工程详情」选中项
 * @param {() => string|null} ctx.getSelectedManageUuid 取「工程管理」选中项
 * @param {(name: string) => void} ctx.onSeriesToggled 某个 series 的显隐变化后的回调
 * @returns {void}
 * @sideEffects 注册 DOM 监听
 */
export function initLegendPanel(ctx) {
	initCollapseToggles();

	document.body.addEventListener('click', (e) => {
		const item = e.target.closest('.legend-item');
		if (!item) return;
		const seriesName = item.getAttribute('data-name');
		if (ctx.hiddenSeries.has(seriesName)) ctx.hiddenSeries.delete(seriesName);
		else ctx.hiddenSeries.add(seriesName);
		ctx.onSeriesToggled();
	});

	document.body.addEventListener('mouseover', (e) => {
		const item = e.target.closest('.legend-item');
		if (!item) return;
		const panel = item.closest('.legend-panel');
		if (!panel) return;
		const detailEl = panel.querySelector('.legend-detail');
		if (!detailEl) return;

		const seriesName = item.getAttribute('data-name');
		if (seriesName === '工作时间' || seriesName === '空闲时间') {
			detailEl.innerHTML = totalDetailHtml(ctx, seriesName);
			return;
		}
		const html = projectDetailHtml(ctx, seriesName);
		if (html) detailEl.innerHTML = html;
	});

	document.body.addEventListener('mouseout', (e) => {
		const item = e.target.closest('.legend-item');
		if (!item) return;
		const panel = item.closest('.legend-panel');
		if (!panel) return;
		const detailEl = panel.querySelector('.legend-detail');
		if (detailEl) detailEl.innerHTML = DETAIL_HINT;
	});
}
