/**
 * @//module/ app/working-hours/views/rhythmPanel
 * @//description/ 节律分析面板：时间范围读取、96 格聚合、极坐标图与图例重绘
 * @//exports/ createRhythmPanel, PRESETS
 * @//dependencies/ app/working-hours/charts/options/rhythm
 * @//example/ const panel = createRhythmPanel({ data, ui, view })
 *            panel.render(); panel.setMode('project')
 *
 * 面板上有两套互斥的筛选控件（「快捷时间段」与「自定义区间」），它们的选中态由
 * `input[name="time-submode"]:checked` 决定 —— 也就是说**DOM 是唯一事实来源**，
 * 不要试图在内存里再存一份，否则点「自定义」时会出现两套状态打架。
 */

import { aggregateRhythm, computeAxisMax, buildRhythmOption } from '../charts/options/rhythm.js';

/** 快捷时间段 → 起始偏移天数（Infinity / 未命中表示不限） */
export const PRESETS = {
	all: null,
	day: 0,
	week: 6,
	month: 29,
	year: 364,
};

/**
 * 读出当前的起止时间（仅「时间维度」下有意义）
 *
 * @param {string} mode 当前维度
 * @param {Date} now 当前时间
 * @returns {{start: number, end: number}} 起止时间戳
 * @sideEffects 无（纯函数，但会读 DOM）
 */
function readRange(mode, now) {
	if (mode !== 'time') return { start: 0, end: Infinity };

	const subModeEl = document.querySelector('input[name="time-submode"]:checked');
	if (subModeEl && subModeEl.value === 'custom') {
		const startStr = document.getElementById('rhythm-start-date').value;
		const endStr = document.getElementById('rhythm-end-date').value;
		return {
			start: startStr ? new Date(startStr + 'T00:00:00').getTime() : 0,
			end: endStr ? new Date(endStr + 'T23:59:59').getTime() : Infinity,
		};
	}

	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
	const presetEl = document.querySelector('input[name="rhythm-time-radio"]:checked');
	const preset = presetEl ? presetEl.value : 'all';
	if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) return { start: 0, end: Infinity };
	const days = PRESETS[preset];
	if (days === null) return { start: 0, end: Infinity };
	return { start: todayStart - days * 24 * 3600 * 1000, end: Infinity };
}

/**
 * 重绘节律图的图例
 *
 * @param {boolean} showWork 是否显示工作
 * @param {boolean} showRest 是否显示空闲
 * @returns {void}
 * @sideEffects 写 DOM
 */
function renderLegend(showWork, showRest) {
	const list = document.getElementById('r-legend-list');
	if (!list) return;
	list.innerHTML = `
					<div class="legend-item ${!showWork ? 'hidden' : ''}" data-name="工作时间">
						<span class="color-block" style="background: linear-gradient(135deg, #007acc, #3ba272);"></span>
						<span style="font-size:11px; font-weight:bold;">工作时间</span>
					</div>
					<div class="legend-item ${!showRest ? 'hidden' : ''}" data-name="空闲时间">
						<span class="color-block" style="background: var(--vscode-chart-rest);"></span>
						<span style="font-size:11px; color:#aaa;">空闲时间</span>
					</div>
				`;
}

/**
 * 创建节律面板控制器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.data 数据集
 * @param {object} ctx.ui 交互状态（rhythmMode / hiddenSeries / rhythmFirstInit / rhythmAgg）
 * @param {object} ctx.view 节律图视图
 * @returns {{render: Function, setMode: Function, selectQuick: Function, selectCustom: Function, updateProjectSelector: Function}} 控制器
 * @sideEffects 无（调用时才重绘）
 */
export function createRhythmPanel(ctx) {
	const data = ctx.data;
	const ui = ctx.ui;
	const view = ctx.view;

	/**
	 * 重绘极坐标图
	 *
	 * @returns {void}
	 * @sideEffects 重绘图表 + 图例
	 */
	function render() {
		if (!view.isReady && !view.init()) return;

		const range = readRange(ui.rhythmMode, new Date());
		const selector = document.getElementById('rhythm-project-select');
		const agg = aggregateRhythm(data.timeline, {
			mode: ui.rhythmMode,
			rangeStart: range.start,
			rangeEnd: range.end,
			targetUuid: selector ? selector.value : null,
		});
		ui.rhythmAgg = agg;

		if (ui.rhythmFirstInit) {
			ui.hiddenSeries.add('空闲时间');
			ui.rhythmFirstInit = false;
		}
		const showWork = !ui.hiddenSeries.has('工作时间');
		const showRest = !ui.hiddenSeries.has('空闲时间');
		renderLegend(showWork, showRest);

		view.setOption(
			buildRhythmOption(
				{
					work: agg.work,
					rest: agg.rest,
					showWork: showWork,
					showRest: showRest,
					axisMax: computeAxisMax(agg.work, agg.rest, showWork, showRest),
				},
				'dark',
				{ makeGradient: (stops) => new echarts.graphic.LinearGradient(0, 0, 0, 1, stops) }
			)
		);
	}

	/**
	 * 切换分析维度
	 *
	 * @param {'time'|'project'} mode 维度
	 * @returns {void}
	 * @sideEffects 改写按钮态 + 重绘
	 */
	function setMode(mode) {
		ui.rhythmMode = mode;
		document.getElementById('rhythm-mode-time').classList.toggle('active', mode === 'time');
		document.getElementById('rhythm-mode-project').classList.toggle('active', mode === 'project');
		render();
	}

	/**
	 * 选中「快捷时间段」并重绘
	 *
	 * @returns {void}
	 * @sideEffects 改写单选 + 重绘
	 */
	function selectQuick() {
		document.querySelector('input[name="time-submode"][value="quick"]').checked = true;
		render();
	}

	/**
	 * 选中「自定义时间段」并重绘
	 *
	 * @returns {void}
	 * @sideEffects 改写单选 + 重绘
	 */
	function selectCustom() {
		document.querySelector('input[name="time-submode"][value="custom"]').checked = true;
		render();
	}

	/**
	 * 刷新工程下拉（按名称中文排序）
	 *
	 * @returns {void}
	 * @sideEffects 写 DOM
	 */
	function updateProjectSelector() {
		const selector = document.getElementById('rhythm-project-select');
		if (!selector) return;
		const currentVal = selector.value;
		selector.innerHTML = '<option value="">-- 请选择工程 --</option>';

		Object.keys(data.projectMeta)
			.sort((a, b) => (data.projectMeta[a] || '').localeCompare(data.projectMeta[b] || '', 'zh'))
			.forEach((uuid) => {
				const opt = document.createElement('option');
				opt.value = uuid;
				opt.innerText = data.projectMeta[uuid];
				if (uuid === currentVal) opt.selected = true;
				selector.appendChild(opt);
			});
	}

	return {
		render: render,
		setMode: setMode,
		selectQuick: selectQuick,
		selectCustom: selectCustom,
		updateProjectSelector: updateProjectSelector,
	};
}
