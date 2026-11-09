/**
 * @//module/ app/modify-line-width/index
 * @//description/ 页面编排：读导线 → 按线宽分组出表（背景柱状图）→ 按层/单位/写入方式批量改宽或删除
 * @//exports/ 无
 * @//dependencies/ core/eda, core/layer, core/util, core/version, ui/dialogs, ui/statusBar, ui/toast, app/modify-line-width/{reader,stats,writer}
 * @//example/ 页面入口，由 iframe/ModifyLineWidth.html 加载打包产物 app/ModifyLineWidth.js
 *
 * 状态设计：**输入值按图元 id 存在 `pending` 里**，不是按表格行存。
 * 这样切层/切单位重新分组后，同一条导线上的输入不会丢；行文本由 `pending` 反推。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda, hasEda } from '../../core/eda.js';
import { layerLabel } from '../../core/layer.js';
import { escapeHtml } from '../../core/util.js';
import { isV4 } from '../../core/version.js';
import { confirm } from '../../ui/dialogs.js';
import { createStatusBar } from '../../ui/statusBar.js';
import { toast } from '../../ui/toast.js';
import { readPrimitives } from './reader.js';
import { barPercent, formatNumber, formatWidth, groupByWidth, parseWidth, WIDTH_DIGITS } from './stats.js';
import { planChanges, writeByApi, writeBySource } from './writer.js';

/** 与写入器一致的 no-op 判定阈值（mil） */
const SAME_EPS = 1e-6;

/* ---------- 状态 ---------- */
const state = { items: [], rows: [], unit: 'mil', layer: '', layerNames: {}, skipped: 0, busy: false };

/** 图元 id → 目标线宽（mil）；0 表示删除 */
const pending = new Map();

/* ---------- DOM ---------- */
const tbody = document.getElementById('tableBody');
const layerSelect = document.getElementById('layerSelect');
const modeSelect = document.getElementById('modeSelect');
const unitRadios = Array.from(document.querySelectorAll('input[name="lwUnit"]'));
const summaryEl = document.getElementById('summary');
const btnApply = document.getElementById('btnApply');
const btnRefresh = document.getElementById('btnRefresh');
const thWidth = document.getElementById('thWidth');
const thLength = document.getElementById('thLength');
const thExpect = document.getElementById('thExpect');
const bar = createStatusBar({
	textEl: document.getElementById('status'),
	barEl: document.getElementById('progressBar'),
	baseClass: 'status-text',
	barBaseClass: 'progress-fill',
});

/* ---------- 纯展示辅助 ---------- */

/**
 * 取当前单位
 *
 * @returns {'mil'|'mm'} 单位
 * @sideEffects 无（读 DOM）
 */
function currentUnit() {
	const checked = unitRadios.find((el) => el.checked);
	return checked ? checked.value : 'mil';
}

/**
 * 取当前层过滤后的图元
 *
 * @returns {Array<object>} 图元
 * @sideEffects 无（纯函数）
 */
function layerItems() {
	if (state.layer === '') return state.items;
	return state.items.filter((item) => String(item.layer) === state.layer);
}

/**
 * 行上一组图元共同的目标值
 *
 * 同一行的图元一定是一起输入的；只要有一个没填或值不同，就返回 null（显示为空）。
 *
 * @param {object} row 表格行
 * @returns {number|null} 目标线宽（mil）；0 表示删除
 * @sideEffects 无（纯函数）
 */
function pendingOf(row) {
	let value;
	for (const item of row.items) {
		if (!pending.has(item.id)) return null;
		const current = pending.get(item.id);
		if (value === undefined) value = current;
		else if (value !== current) return null;
	}
	return value === undefined ? null : value;
}

/**
 * 按当前输入重算行的目标值
 *
 * @param {object} row 表格行
 * @returns {number|null|NaN} 目标值（mil）/ 留空 / 非法
 * @sideEffects 无（纯函数）
 */
function targetOf(row) {
	return parseWidth(row.input, state.unit);
}

/**
 * 把行的输入同步进 `pending`
 *
 * @param {object} row 表格行
 * @returns {void}
 * @sideEffects **就地修改** `pending`
 */
function syncPending(row) {
	const target = targetOf(row);
	for (const item of row.items) {
		if (target === null || Number.isNaN(target)) pending.delete(item.id);
		else pending.set(item.id, target);
	}
}

/* ---------- 渲染 ---------- */

/**
 * 重建下拉里的层选项（只列真实有导线的层）
 *
 * @returns {void}
 * @sideEffects DOM、`state.layer`
 */
function renderLayerOptions() {
	const layers = Array.from(new Set(state.items.map((item) => item.layer)))
		.filter((id) => Number.isFinite(id))
		.sort((a, b) => a - b);

	const options = layers.map((id) => `<option value="${id}">${escapeHtml(layerLabel(id, state.layerNames))}</option>`);
	layerSelect.innerHTML = '<option value="">全部层</option>' + options.join('');

	state.layer = layers.some((id) => String(id) === state.layer) ? state.layer : '';
	layerSelect.value = state.layer;
}

/**
 * 重新分组（层过滤 + 单位），并把 `pending` 反推成行文本
 *
 * @returns {void}
 * @sideEffects 写 `state.rows`
 */
function rebuildRows() {
	state.rows = groupByWidth(layerItems(), state.unit);
	for (const row of state.rows) {
		const target = pendingOf(row);
		row.input = target === null ? '' : formatWidth(target, state.unit);
	}
}

/**
 * 生成一行的 DOM 字符串
 *
 * @param {object} row 表格行
 * @param {number} index 行号
 * @param {number} maxCount 数量列最大值
 * @param {number} maxLength 长度列最大值
 * @returns {string} `<tr>` 字符串
 * @sideEffects 无（纯函数）
 */
function rowHtml(row, index, maxCount, maxLength) {
	const target = targetOf(row);
	const bad = Number.isNaN(target);
	const isDelete = target === 0;
	const isModify = target !== null && !bad && !isDelete && Math.abs(target - row.widthMil) > SAME_EPS;

	let cls = '';
	if (bad) cls = ' invalid';
	else if (isDelete) cls = ' is-del';
	else if (isModify) cls = ' is-modified';

	const digits = WIDTH_DIGITS[state.unit] || 1;
	const countBar = barPercent(row.count, maxCount);
	const lengthBar = barPercent(row.lengthMil, maxLength);
	const title = isDelete ? '填 0 表示删除该行全部导线' : '输入目标线宽；留空不修改';

	return `<tr${isDelete ? ' class="lw-row-del"' : ''}>
		<td>${escapeHtml(row.key)}</td>
		<td class="num"><div class="lw-bar count" style="width:${countBar}%"></div><span>${formatNumber(row.count, 0)}</span></td>
		<td class="num"><div class="lw-bar len" style="width:${lengthBar}%"></div><span>${formatNumber(row.lengthMil, digits)}</span></td>
		<td><input class="lw-input${cls}" data-row="${index}" value="${escapeHtml(row.input)}" placeholder="${escapeHtml(row.key)}" inputmode="decimal" title="${title}" /></td>
	</tr>`;
}

/**
 * 渲染表体
 *
 * @returns {void}
 * @sideEffects DOM
 */
function renderTable() {
	if (state.rows.length === 0) {
		tbody.innerHTML = '<tr class="empty-row"><td colspan="4">当前 PCB 没有导线</td></tr>';
		return;
	}
	const maxCount = Math.max(...state.rows.map((row) => row.count));
	const maxLength = Math.max(...state.rows.map((row) => row.lengthMil));
	tbody.innerHTML = state.rows.map((row, index) => rowHtml(row, index, maxCount, maxLength)).join('');
}

/**
 * 刷新表头单位与汇总行/按钮状态
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateSummary() {
	const plan = planChanges(state.rows, state.unit);
	const unit = state.unit;
	thWidth.textContent = `线宽 (${unit})`;
	thLength.textContent = `长度 (${unit})`;
	thExpect.textContent = `期望线宽 (${unit})`;

	const layerText = state.layer === '' ? '全部层' : layerLabel(Number(state.layer), state.layerNames);
	const total = layerItems().length;
	const parts = [`层线宽分布表 · ${layerText} · ${state.rows.length} 种 / ${formatNumber(total, 0)} 条`];
	if (plan.invalid.length) parts.push(`${plan.invalid.length} 行输入有误`);
	else if (plan.remove.length || plan.modify.length) {
		parts.push(`待修改 ${formatNumber(plan.modify.length, 0)} 条、待删除 ${formatNumber(plan.remove.length, 0)} 条`);
	}
	summaryEl.textContent = parts.join('　｜　');

	const actionable = plan.invalid.length === 0 && plan.modify.length + plan.remove.length > 0;
	btnApply.disabled = state.busy || !actionable;
}

/**
 * 更新单个输入框的样式（输入过程中不整表重绘，避免丢焦点）
 *
 * @param {HTMLInputElement} input 输入框
 * @param {object} row 表格行
 * @returns {void}
 * @sideEffects DOM
 */
function restyleInput(input, row) {
	const target = targetOf(row);
	const bad = Number.isNaN(target);
	const isDelete = target === 0;
	const isModify = target !== null && !bad && !isDelete && Math.abs(target - row.widthMil) > SAME_EPS;

	input.classList.toggle('invalid', bad);
	input.classList.toggle('is-del', isDelete);
	input.classList.toggle('is-modified', isModify);
	input.closest('tr').classList.toggle('lw-row-del', isDelete);
}

/* ---------- 写入 ---------- */

/**
 * 探测当前文档是否有铺铜（V4 整份写回会清掉铜皮缓存）
 *
 * @param {object} host 宿主对象
 * @returns {Promise<boolean>} 是否有铺铜
 * @sideEffects 调用宿主 API（只读）
 */
async function hasPours(host) {
	try {
		if (!host.pcb_PrimitivePour || typeof host.pcb_PrimitivePour.getAll !== 'function') return false;
		const list = await host.pcb_PrimitivePour.getAll();
		return Array.isArray(list) && list.length > 0;
	} catch (e) {
		console.error('探测铺铜失败:', e);
		return false;
	}
}

/**
 * 写入前确认
 *
 * @param {object} plan 变更计划
 * @param {'source'|'api'} mode 写入方式
 * @param {object} host 宿主对象
 * @returns {Promise<boolean>} 是否继续
 * @sideEffects 弹宿主确认框
 */
async function confirmApply(plan, mode, host) {
	const lines = [`将修改 ${plan.modify.length} 条、删除 ${plan.remove.length} 条导线。`];
	lines.push(`写入方式：${mode === 'api' ? 'API 修改' : '源码更新'}。`);
	if (mode === 'source' && isV4() && (await hasPours(host))) {
		lines.push('V4 整份写回会清除铜皮缓存，写完后需要重新铺铜。');
	}
	return confirm(lines.join('\n'), { title: '确认修改', okText: '开始' });
}

/**
 * 把写入结果翻译成状态栏文案
 *
 * @param {object} result 写入结果
 * @param {'source'|'api'} mode 写入方式
 * @returns {{text: string, level: string}} 文案与级别
 * @sideEffects 无（纯函数）
 */
function describeResult(result, mode) {
	const seconds = ((result.ms || 0) / 1000).toFixed(1);

	if (mode === 'api') {
		const failed = (result.failed || []).length + (result.deleteFailed || []).length;
		if (failed > 0) {
			const sample = (result.failed || []).concat(result.deleteFailed || []).slice(0, 3).join('、');
			return { text: `成功修改 ${result.modified} 条、删除 ${result.deleted} 条；失败 ${failed} 条（${sample}）`, level: 'warning' };
		}
		return { text: `已修改 ${result.modified} 条、删除 ${result.deleted} 条（API，${seconds}s）`, level: 'success' };
	}

	const missing = result.missing ? `，${result.missing} 条未在源码中找到` : '';
	return { text: `已修改 ${result.changed} 条、删除 ${result.deleted} 条（源码，${seconds}s）${missing}`, level: missing ? 'warning' : 'success' };
}

/**
 * 应用前的前置检查
 *
 * @param {object} plan 变更计划
 * @param {object|null} host 宿主对象
 * @returns {{text: string, level: string}|null} 阻止执行的原因；可以继续时返回 null
 * @sideEffects 无（纯函数）
 */
function precheck(plan, host) {
	if (plan.invalid.length) {
		return { text: '有「期望线宽」不是有效数值（需 ≥ 0，填 0 表示删除）', level: 'error' };
	}
	if (plan.modify.length + plan.remove.length === 0) {
		return { text: '没有需要修改的行（留空不修改，填 0 表示删除）', level: 'warning' };
	}
	if (!host) return { text: '未检测到 EDA 运行环境，请在客户端中打开本页面', level: 'error' };
	return null;
}

/**
 * 执行写入并刷新（apply 的主体，拆出来压复杂度）
 *
 * @param {object} host 宿主对象
 * @param {object} plan 变更计划
 * @param {'source'|'api'} mode 写入方式
 * @returns {Promise<void>}
 * @sideEffects 读写文档、DOM
 */
async function runWrite(host, plan, mode) {
	const result =
		mode === 'api'
			? await writeByApi(host, plan, { onProgress: (done, total) => bar.progress(done, total, '修改中', 'info') })
			: await writeBySource(host, plan, { onProgress: (done, total) => bar.text(`正在改写源码 ${done} / ${total} 行…`, 'info') });

	if (!result.ok) {
		bar.text(`写入未完成：${reasonText(result.reason)}`, 'error');
		return;
	}

	pending.clear();
	const info = describeResult(result, mode);
	await refresh(true);
	bar.text(info.text, info.level);
	toast(info.text, info.level === 'success' ? 'success' : 'warning');
}

/**
 * 执行应用
 *
 * @returns {Promise<void>}
 * @sideEffects 读写文档、DOM
 */
async function apply() {
	if (state.busy) return;

	const host = getEda();
	const plan = planChanges(state.rows, state.unit);
	const problem = precheck(plan, host);
	if (problem) {
		bar.text(problem.text, problem.level);
		return;
	}

	const mode = modeSelect.value === 'api' ? 'api' : 'source';
	if (!(await confirmApply(plan, mode, host))) return;

	state.busy = true;
	updateSummary();
	bar.progress(0, 1, '', 'info');

	try {
		await runWrite(host, plan, mode);
	} catch (e) {
		console.error('批量修改线宽失败:', e);
		bar.text('写入失败：' + (e && e.message ? e.message : e), 'error');
		toast('写入失败，详见控制台', 'error');
	} finally {
		state.busy = false;
		updateSummary();
	}
}

/**
 * 失败原因 → 人话
 *
 * @param {string} reason 原因码
 * @returns {string} 文案
 * @sideEffects 无（纯函数）
 */
function reasonText(reason) {
	const map = {
		'empty-source': '读取到的源码为空，请重试或改用 API 修改',
		'read-failed': '读取源码失败，请重试或改用 API 修改',
		'no-match': '源码里没有匹配到这些图元，请改用 API 修改',
		'write-rejected': '写入被拒绝（可重试，或改用 API 修改）',
	};
	return map[reason] || reason || '未知原因';
}

/* ---------- 读取 ---------- */

/**
 * 读取层的显示名（失败不影响主流程）
 *
 * @param {object} host 宿主对象
 * @returns {Promise<Record<number, string>>} 层号 → 名称
 * @sideEffects 调用宿主 API（只读）
 */
async function readLayerNames(host) {
	try {
		if (!host.pcb_Layer || typeof host.pcb_Layer.getAllLayers !== 'function') return {};
		const list = await host.pcb_Layer.getAllLayers();
		const map = {};
		for (const layer of Array.isArray(list) ? list : []) {
			if (layer && layer.id !== undefined && layer.name) map[layer.id] = layer.name;
		}
		return map;
	} catch (e) {
		console.error('读取图层名失败:', e);
		return {};
	}
}

/**
 * 重新读取画布并刷新整页
 *
 * @param {boolean} [silent=false] 静默刷新（不写「正在读取」状态）
 * @returns {Promise<void>}
 * @sideEffects eda API（只读）、DOM
 */
async function refresh(silent = false) {
	const host = getEda();
	if (!host) {
		showNoEda();
		return;
	}

	state.busy = true;
	if (!silent) bar.text('正在读取导线…', 'info');
	updateSummary();

	try {
		const [data, names] = await Promise.all([readPrimitives(host), readLayerNames(host)]);
		state.items = data.items;
		state.skipped = data.skipped;
		state.layerNames = names;
		pending.clear();

		renderLayerOptions();
		rebuildRows();
		renderTable();
		updateSummary();

		const skipped = state.skipped ? `（跳过 ${state.skipped} 条异常图元）` : '';
		bar.text(`已读取 ${formatNumber(state.items.length, 0)} 条导线${skipped}`, 'success');
	} catch (e) {
		console.error('读取导线失败:', e);
		bar.text('读取导线失败：' + (e && e.message ? e.message : e), 'error');
	} finally {
		state.busy = false;
		updateSummary();
	}
}

/**
 * 非 EDA 环境的空态
 *
 * @returns {void}
 * @sideEffects DOM
 */
function showNoEda() {
	state.items = [];
	state.rows = [];
	tbody.innerHTML = '<tr class="empty-row"><td colspan="4">请在嘉立创 EDA 中打开本页面</td></tr>';
	summaryEl.textContent = '层线宽分布表 · 未检测到 EDA 环境';
	bar.text('未检测到 EDA 环境，无法读取导线', 'error');
	btnApply.disabled = true;
	btnRefresh.disabled = true;
}

/* ---------- 事件 ---------- */

/**
 * 表格输入事件（委托）
 *
 * @param {Event} e 事件
 * @returns {void}
 * @sideEffects `pending`、DOM、汇总
 */
function onInput(e) {
	const input = e.target.closest ? e.target.closest('.lw-input') : null;
	if (!input) return;
	const row = state.rows[Number(input.dataset.row)];
	if (!row) return;

	row.input = input.value;
	syncPending(row);
	restyleInput(input, row);
	updateSummary();
}

/**
 * 失焦时把输入格式化回显（0 保留为 0）
 *
 * @param {Event} e 事件
 * @returns {void}
 * @sideEffects DOM
 */
function onBlurInput(e) {
	const input = e.target.closest ? e.target.closest('.lw-input') : null;
	if (!input) return;
	const row = state.rows[Number(input.dataset.row)];
	if (!row) return;

	const target = targetOf(row);
	if (target === null || Number.isNaN(target)) return;

	row.input = target === 0 ? '0' : formatWidth(target, state.unit);
	input.value = row.input;
	restyleInput(input, row);
}

/**
 * 切换单位：重新分组并从 `pending` 反推文本（物理值不变）
 *
 * @returns {void}
 * @sideEffects `state.unit`、DOM
 */
function onUnitChange() {
	state.unit = currentUnit();
	rebuildRows();
	renderTable();
	updateSummary();
}

/**
 * 切换层：本地过滤，不重新读画布
 *
 * @returns {void}
 * @sideEffects `state.layer`、DOM
 */
function onLayerChange() {
	state.layer = layerSelect.value;
	rebuildRows();
	renderTable();
	updateSummary();
}

/**
 * 绑定事件
 *
 * @returns {void}
 * @sideEffects DOM（注册监听）
 */
function bindEvents() {
	btnRefresh.addEventListener('click', () => refresh());
	btnApply.addEventListener('click', apply);
	layerSelect.addEventListener('change', onLayerChange);
	modeSelect.addEventListener('change', updateSummary);
	unitRadios.forEach((el) => el.addEventListener('change', onUnitChange));

	tbody.addEventListener('input', onInput);
	tbody.addEventListener('focusout', onBlurInput);
}

/**
 * 启动
 *
 * 不用「只在 DOMContentLoaded 里绑定」：脚本被动态加载时事件可能已错过，监听就永远不注册。
 *
 * @returns {void}
 * @sideEffects DOM、eda API
 */
function start() {
	bindEvents();
	if (!hasEda()) {
		showNoEda();
		return;
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refresh());
	else refresh();
}

start();
