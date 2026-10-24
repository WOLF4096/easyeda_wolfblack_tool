/**
 * @//module/ app/working-hours/views/tabRouter
 * @//description/ 七个 tab 的路由：侧边栏高亮、视图显隐、切 tab 后的重绘、顶部标题、工程下拉
 * @//exports/ createTabRouter
 * @//dependencies/ core/log, app/working-hours/time, app/working-hours/projectSummary, app/working-hours/dayRange
 * @//example/ const router = createTabRouter(ctx)
 *            await router.switchTab('manage')
 *
 * 拆分前 `switchTab` 是一个 74 行、复杂度 30 的函数：侧边栏、视图显隐、
 * 「切到某 tab 之后还要做什么」三件事糊在一起，新增一个 tab 就得往里塞第 8 个 else-if。
 * 这里把第三件事抽成 `TAB_EFFECTS` 分派表，前两件事各自独立成函数。
 *
 * 本模块全是模块级函数 + 显式 `ctx`（而不是闭包），这样每个函数都能守住 80 行上限。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { logger } from '../../../core/log.js';
import { getDayAlignedIndices } from '../dayRange.js';
import { getProjectTitleString } from '../projectSummary.js';
import { formatTimeCN } from '../time.js';

/** tab → 视图容器 id */
const VIEW_ID = {
	total: 'view-chart',
	project: 'view-chart',
	weekly: 'view-weekly',
	manage: 'view-manage',
	rhythm: 'view-rhythm',
	reminder: 'view-reminder',
	more: 'view-more',
};

/** 侧边栏顺序（`window.event` 不可用时按它定位） */
const SIDEBAR_ORDER = ['total', 'project', 'weekly', 'manage', 'rhythm', 'reminder', 'more'];

/**
 * 高亮当前 tab 的侧边栏项
 *
 * @param {string} tab tab 名
 * @returns {void}
 * @sideEffects 改写 class
 */
function highlightSidebar(tab) {
	document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));

	// 行内 onclick 触发时宿主会提供 window.event，直接用事件源，避免顺序猜错
	if (window.event && window.event.currentTarget) {
		window.event.currentTarget.classList.add('active');
		return;
	}
	const items = document.querySelectorAll('.sidebar-item');
	const idx = SIDEBAR_ORDER.indexOf(tab);
	if (items[idx]) items[idx].classList.add('active');
}

/**
 * 生成顶部统计信息（标题 + 右侧提示）
 *
 * @param {object} ctx 上下文
 * @param {string} tab 当前 tab
 * @returns {void}
 * @sideEffects 写 DOM
 */
function renderHeader(ctx, tab) {
	const titleEl = document.getElementById('page-title');
	const scopeEl = document.getElementById('headerScope');
	const valEl = document.getElementById('headerVal');

	const todayWork = () => formatTimeCN(ctx.getTodayWorkHours(null));

	const HEADERS = {
		total: () => {
			titleEl.innerText = '全部工程时间总趋势';
			scopeEl.innerText = '今日总计已工作:';
			valEl.innerText = todayWork();
		},
		project: () => {
			titleEl.innerText = ctx.ui.selectedDetailUuid ? getProjectTitleString(ctx.data.projectStats, ctx.ui.selectedDetailUuid) : '请选择工程';
			scopeEl.innerText = '';
			valEl.innerText = '';
		},
		manage: () => {
			titleEl.innerText = '工程耗时管理';
			scopeEl.innerText = '本地记录工程项目总数:';
			valEl.innerText = `${Object.keys(ctx.data.projectStats).length} 个`;
		},
		reminder: () => {
			titleEl.innerText = '时限触发器规则设定';
			scopeEl.innerText = '今日总计已工作:';
			valEl.innerText = todayWork();
		},
		more: () => {
			titleEl.innerText = '更多选项';
			scopeEl.innerText = '';
			valEl.innerText = '';
		},
		rhythm: () => {
			titleEl.innerText = '节律分析 (活动钟)';
			scopeEl.innerText = '';
			valEl.innerText = '';
		},
		weekly: () => {
			titleEl.innerText = '工程开发周报';
			scopeEl.innerText = '';
			valEl.innerText = '';
		},
	};

	const handler = HEADERS[tab];
	if (handler) handler();
}

/**
 * 切到「工程详情」时同步宿主当前工程
 *
 * @param {object} ctx 上下文
 * @returns {Promise<void>}
 * @sideEffects 可能写数据集与下拉
 */
async function syncCurrentProject(ctx) {
	try {
		const info = await eda.dmt_Project.getCurrentProjectInfo();
		if (info && info.uuid) {
			ctx.ui.currentUuid = info.uuid;
			ctx.ui.currentName = info.friendlyName || '未命名工程';
			if (!ctx.data.projectMeta[ctx.ui.currentUuid]) {
				ctx.data.projectMeta[ctx.ui.currentUuid] = ctx.ui.currentName;
				ctx.data.projectStats[ctx.ui.currentUuid] = {
					name: ctx.ui.currentName,
					uuid: ctx.ui.currentUuid,
					totalWork: 0,
					totalRest: 0,
					startTs: Infinity,
					endTs: -Infinity,
				};
			}
		}
	} catch (e) {
		logger.warn('处理工时记录失败', e);
	}
	if (!ctx.ui.selectedDetailUuid) ctx.ui.selectedDetailUuid = ctx.ui.currentUuid;
	updateProjectSelector(ctx);
}

/**
 * 取主图的整日对齐窗口（工程模式下按该工程的工作区间）
 *
 * @param {object} ctx 上下文
 * @returns {{startValue: number, endValue: number}} 下标窗口
 * @sideEffects 无
 */
function timelineBounds(ctx) {
	const stats = ctx.data.projectStats[ctx.ui.selectedDetailUuid];
	const useProject = ctx.ui.activeTab === 'project' && ctx.ui.selectedDetailUuid && stats && stats.startTs !== Infinity;
	if (useProject) return getDayAlignedIndices(stats.startTs, stats.endTs, ctx.data.timeline, ctx.data.tsMap, ctx.data.todayTs);
	return getDayAlignedIndices(ctx.data.todayTs, ctx.data.todayTs, ctx.data.timeline, ctx.data.tsMap, ctx.data.todayTs);
}

/**
 * 主图区（总趋势 / 工程详情）的显示与重绘
 *
 * @param {object} ctx 上下文
 * @returns {void}
 * @sideEffects 写 DOM + 重绘图表
 */
function showTimelineView(ctx) {
	if (ctx.ui.activeTab === 'project' && !ctx.ui.selectedDetailUuid) {
		const emptyTip = document.getElementById('project-empty-tip');
		emptyTip.innerHTML = '<b>当前未打开工程</b><small>当前视图不包含任何数据。请在顶部下拉菜单中选择一个项目。</small>';
		emptyTip.classList.remove('hidden');
		return;
	}

	document.getElementById('view-chart').classList.remove('hidden');
	ctx.resetMainCache();
	if (!ctx.mainChart.isReady) return;

	ctx.mainChart.resize();
	const bounds = timelineBounds(ctx);
	ctx.mainChart.dispatchAction({ type: 'dataZoom', startValue: bounds.startValue, endValue: bounds.endValue });
	ctx.handleZoomOrPan();
	ctx.renderHeatmap();
}

/** tab 切过去之后的附加动作（分派表，新增 tab 只加一行） */
const TAB_EFFECTS = {
	total: showTimelineView,
	project: showTimelineView,
	weekly: (ctx) => setTimeout(() => ctx.renderWeeklyReport(), 50),
	manage: (ctx) => {
		ctx.renderManageTable();
		ctx.resizeManageChart();
	},
	rhythm: (ctx) => {
		ctx.updateRhythmProjectSelector();
		// 首次进入强制渲染一次（canvas 尺寸在 hidden 容器里是 0）
		setTimeout(() => ctx.renderRhythmChart(), 50);
		ctx.resizeRhythmChart();
	},
	reminder: (ctx) => ctx.renderReminder(),
	// 个人信息卡在这里才首次加载头像（其余 tab 不产生外网请求）
	more: (ctx) => {
		if (ctx.renderProfile) ctx.renderProfile();
	},
};

/**
 * 切换 tab
 *
 * @param {object} ctx 上下文
 * @param {string} tab tab 名
 * @returns {Promise<void>}
 * @sideEffects 写 DOM + 触发各图重绘
 */
async function switchTab(ctx, tab) {
	ctx.ui.activeTab = tab;
	if (tab === 'project') await syncCurrentProject(ctx);

	highlightSidebar(tab);

	document.querySelectorAll('.view-container').forEach((el) => el.classList.add('hidden'));
	// 非图表类 tab 先显示容器再渲染：hidden 容器里 canvas 量到的尺寸是 0，
	// 先渲染后显示会导致图表按 0 尺寸初始化（原本各分支里的 remove('hidden') 就是这个顺序）
	if (tab !== 'total' && tab !== 'project') {
		const view = VIEW_ID[tab] ? document.getElementById(VIEW_ID[tab]) : null;
		if (view) view.classList.remove('hidden');
	}
	document.getElementById('project-empty-tip').classList.add('hidden');

	const selector = document.getElementById('project-selector');
	if (selector) selector.style.display = tab === 'project' ? 'inline-block' : 'none';
	renderHeader(ctx, tab);

	const effect = TAB_EFFECTS[tab];
	if (effect) effect(ctx);
}

/**
 * 刷新顶部「工程详情」下拉
 *
 * @param {object} ctx 上下文
 * @returns {void}
 * @sideEffects 写 DOM
 */
function updateProjectSelector(ctx) {
	const selector = document.getElementById('project-selector');
	if (!selector) return;
	selector.innerHTML = '';

	if (!ctx.ui.selectedDetailUuid) {
		const opt = document.createElement('option');
		opt.value = '';
		opt.innerText = '-- 请选择工程 --';
		selector.appendChild(opt);
	}

	Object.keys(ctx.data.projectMeta)
		.sort((a, b) => (ctx.data.projectMeta[a] || '').localeCompare(ctx.data.projectMeta[b] || '', 'zh'))
		.forEach((uuid) => {
			const opt = document.createElement('option');
			opt.value = uuid;
			opt.innerText = ctx.data.projectMeta[uuid];
			if (uuid === ctx.ui.selectedDetailUuid) opt.selected = true;
			selector.appendChild(opt);
		});

	// 同步更新节律面板的工程下拉单
	const rhythmSelector = document.getElementById('rhythm-project-select');
	if (rhythmSelector) rhythmSelector.innerHTML = selector.innerHTML;
}

/**
 * 顶部下拉切换后的重绘
 *
 * @param {object} ctx 上下文
 * @returns {void}
 * @sideEffects 写 DOM + 重绘图表
 */
function onProjectSelectorChange(ctx) {
	const selector = document.getElementById('project-selector');
	if (!selector) return;
	ctx.ui.selectedDetailUuid = selector.value || null;
	renderHeader(ctx, ctx.ui.activeTab);
	ctx.resetMainCache();

	if (!ctx.ui.selectedDetailUuid) {
		document.getElementById('view-chart').classList.add('hidden');
		const tip = document.getElementById('project-empty-tip');
		tip.innerHTML =
			'<div style="margin-bottom:8px; font-weight: bold; color:#e0e0e0;">当前未打开工程</div><div style="font-size:11px; color:#666;">当前视图不包含任何数据。请在顶部下拉菜单中选择一个项目。</div>';
		tip.classList.remove('hidden');
		return;
	}

	document.getElementById('project-empty-tip').classList.add('hidden');
	document.getElementById('view-chart').classList.remove('hidden');
	if (!ctx.mainChart.isReady) return;

	ctx.mainChart.resize();
	const bounds = timelineBounds(ctx);
	ctx.mainChart.dispatchAction({ type: 'dataZoom', startValue: bounds.startValue, endValue: bounds.endValue });
	ctx.handleZoomOrPan();
	ctx.renderHeatmap();
}

/**
 * 创建 tab 路由器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.ui 交互状态
 * @param {object} ctx.data 数据集
 * @param {(uuid: string|null) => number} ctx.getTodayWorkHours 今日工时（小时）
 * @param {() => void} ctx.renderHeatmap 重绘热力图
 * @param {() => void} ctx.handleZoomOrPan 按当前窗口重算主图
 * @param {() => void} ctx.resetMainCache 清主图渲染缓存
 * @param {object} ctx.mainChart 主图视图（需实现 resize / dispatchAction / isReady）
 * @param {() => void} ctx.renderRhythmChart 重绘节律图
 * @param {() => void} ctx.resizeRhythmChart 重设节律图尺寸
 * @param {() => void} ctx.updateRhythmProjectSelector 刷新节律图工程下拉
 * @param {() => void} ctx.renderWeeklyReport 重绘周报
 * @param {() => void} ctx.renderManageTable 重绘管理表格
 * @param {() => void} ctx.resizeManageChart 重设管理图尺寸
 * @param {() => void} ctx.renderReminder 重绘提醒规则
 * @returns {{switchTab: Function, updateHeaderStats: Function, updateProjectSelector: Function, onProjectSelectorChange: Function}} 路由器
 * @sideEffects 无（调用时才产生副作用）
 */
export function createTabRouter(ctx) {
	return {
		switchTab: (tab) => switchTab(ctx, tab),
		updateHeaderStats: () => renderHeader(ctx, ctx.ui.activeTab),
		updateProjectSelector: () => updateProjectSelector(ctx),
		onProjectSelectorChange: () => onProjectSelectorChange(ctx),
	};
}
