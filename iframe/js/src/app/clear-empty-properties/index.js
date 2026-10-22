/**
 * @//module/ app/clear-empty-properties/index
 * @//description/ 页面编排：读取网表 → 渲染「器件 × 属性分类」表格 → 按勾选清空属性并写回
 * @//exports/ 无
 * @//dependencies/ core/eda, core/netlist, core/util, ui/toast, ui/table, app/clear-empty-properties/propsModel
 * @//example/ 页面入口，由 iframe/ClearEmptyProperties.html 加载打包产物 app/ClearEmptyProperties.js
 *
 * 只做「取 DOM → 调域模块 → 刷 UI」，属性分类与清空规则都在 propsModel.js。
 */

import { hasEda } from '../../core/eda.js';
import { getComponentsContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { escapeHtml } from '../../core/util.js';
import { nextSortState, selectionSummary, setAllSelected, sortRows } from '../../ui/table.js';
import { toast } from '../../ui/toast.js';
import { buildRows, clearBySelection, toggleColumn } from './propsModel.js';

/* ---------- 状态 ---------- */
let rawNetlistData = null;
let dataSourceMode = 'PCB'; // 'PCB' 或 'SCH'
let rows = [];
let sortState = { key: null, asc: true };

/* ---------- DOM ---------- */
const tbody = document.getElementById('tableBody');
const btnRefresh = document.getElementById('btnRefresh');
const btnClear = document.getElementById('btnClear');
const cbAllRows = document.getElementById('cbAllRows');
const thAllBase = document.getElementById('thAllBase');
const thAllKey = document.getElementById('thAllKey');
const thAllMore = document.getElementById('thAllMore');

/**
 * 取某行的排序列值（缺失按空串参与排序）
 *
 * @param {object} row 行数据
 * @param {string} key 列名
 * @returns {string} 列值
 * @sideEffects 无（纯函数）
 */
function cellOf(row, key) {
	return row[key] || '';
}

/**
 * 渲染表格
 *
 * 列结构与勾选类名（`cb-row` / `cb-base` / `cb-key` / `cb-more`、`data-index`）
 * 与重构前完全一致，事件处理依赖这些名字，改名前请先改监听。
 *
 * @returns {void}
 * @sideEffects DOM
 */
function renderTable() {
	if (rows.length === 0) {
		tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #888;">未找到组件数据，请检查图纸</td></tr>';
		return;
	}

	tbody.innerHTML = rows
		.map((item, index) => {
			const rowClass = item.selected ? '' : 'disabled-row';
			const disabledAttr = item.selected ? '' : 'disabled';
			return `
					<tr class="${rowClass}">
						<td><input type="checkbox" class="cb-row" data-index="${index}" ${item.selected ? 'checked' : ''}></td>
						<td title="${escapeHtml(item.designator)}">${escapeHtml(item.designator)}</td>
						<td title="${escapeHtml(item.name)}">${escapeHtml(item.name || '-')}</td>
						<td title="${escapeHtml(item.footprint)}">${escapeHtml(item.footprint || '-')}</td>
						<td title="${escapeHtml(item.supplier)}">${escapeHtml(item.supplier || '-')}</td>
						<td><input type="checkbox" class="cb-base" data-index="${index}" ${item.clearBase ? 'checked' : ''} ${disabledAttr}></td>
						<td><input type="checkbox" class="cb-key" data-index="${index}" ${item.clearKey ? 'checked' : ''} ${disabledAttr}></td>
						<td><input type="checkbox" class="cb-more" data-index="${index}" ${item.clearMore ? 'checked' : ''} ${disabledAttr}></td>
					</tr>
				`;
		})
		.join('');

	updateSelectAllRowState();
}

/**
 * 同步左上角「全选」复选框的三态
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateSelectAllRowState() {
	if (rows.length === 0) return;
	const summary = selectionSummary(rows, (item) => item.selected);
	cbAllRows.checked = summary.isAll;
	cbAllRows.indeterminate = summary.isIndeterminate;
}

/**
 * 排序并重绘
 *
 * @returns {void}
 * @sideEffects 修改 rows 的引用、DOM
 */
function sortAndRender() {
	rows = sortRows(rows, { key: sortState.key, asc: sortState.asc, value: cellOf });
	renderTable();
}

/**
 * 获取网表并刷新表格
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（读网表）、DOM、宿主 toast
 */
async function fetchData() {
	if (!hasEda()) {
		toast('未检测到 EDA 运行环境', 2);
		return;
	}

	try {
		btnRefresh.disabled = true;
		btnRefresh.textContent = '获取中...';

		const netlist = await getNetlist('AUTO');
		dataSourceMode = netlist.page;
		rawNetlistData = netlist.json;
		rows = buildRows(getComponentsContainer(rawNetlistData));

		sortState = { key: 'designator', asc: true };
		sortAndRender();

		toast(`成功获取 ${rows.length} 个元件数据`, 'success');
	} catch (error) {
		console.error('网表获取失败:', error);
		toast('获取数据失败: ' + error.message, 'error');
	} finally {
		btnRefresh.disabled = false;
		btnRefresh.textContent = '刷新数据';
	}
}

/**
 * 执行清空并写回网表
 *
 * @returns {Promise<void>}
 * @sideEffects 就地修改网表对象、eda API（写网表）、宿主 toast
 */
async function executeClear() {
	if (!rawNetlistData || rows.length === 0) return;

	const pending = rows.filter((item) => item.selected && (item.clearBase || item.clearKey || item.clearMore));
	if (pending.length === 0) {
		toast('没有勾选需要清空的属性或元件', 'warning');
		return;
	}

	try {
		const stat = clearBySelection(rows);
		const updatedJsonString = JSON.stringify(rawNetlistData, null, 2);
		await setNetlist(dataSourceMode, updatedJsonString);
		toast(`成功处理 ${stat.components} 个元件`, 'success');
	} catch (error) {
		console.error('写回网表失败:', error);
		toast('执行失败: ' + error.message, 'error');
	}
}

/**
 * 绑定事件
 *
 * @returns {void}
 * @sideEffects DOM（注册监听）
 */
function bindEvents() {
	btnRefresh.addEventListener('click', fetchData);
	btnClear.addEventListener('click', executeClear);

	tbody.addEventListener('change', (e) => {
		const target = e.target;
		if (target.tagName !== 'INPUT' || target.type !== 'checkbox') return;

		const item = rows[parseInt(target.getAttribute('data-index'), 10)];
		if (!item) return;

		if (target.classList.contains('cb-row')) {
			item.selected = target.checked;
			renderTable();
		} else if (target.classList.contains('cb-base')) {
			item.clearBase = target.checked;
		} else if (target.classList.contains('cb-key')) {
			item.clearKey = target.checked;
		} else if (target.classList.contains('cb-more')) {
			item.clearMore = target.checked;
		}
	});

	document.querySelectorAll('th.sortable').forEach((th) => {
		th.addEventListener('click', () => {
			sortState = nextSortState(sortState, th.getAttribute('data-sort'));
			document.querySelectorAll('.sort-icon').forEach((icon) => (icon.textContent = ''));
			const icon = th.querySelector('.sort-icon');
			if (icon) icon.textContent = sortState.asc ? '▲' : '▼';
			sortAndRender();
		});
	});

	cbAllRows.addEventListener('change', (e) => {
		setAllSelected(rows, (item, value) => (item.selected = value), e.target.checked);
		renderTable();
	});

	thAllBase.addEventListener('click', () => applyColumnToggle('clearBase'));
	thAllKey.addEventListener('click', () => applyColumnToggle('clearKey'));
	thAllMore.addEventListener('click', () => applyColumnToggle('clearMore'));
}

/**
 * 列级切换并重绘
 *
 * @param {'clearBase'|'clearKey'|'clearMore'} field 列字段
 * @returns {void}
 * @sideEffects 修改行状态、DOM
 */
function applyColumnToggle(field) {
	toggleColumn(rows, field);
	renderTable();
}

/**
 * 启动：立即绑定事件（脚本在 body 末尾，元素必然已存在），再按就绪状态决定何时拉数据
 *
 * 不用「只在 DOMContentLoaded 里绑定」——若脚本被动态加载、事件已错过，监听就永远不会注册。
 *
 * @returns {void}
 * @sideEffects DOM、eda API
 */
function start() {
	bindEvents();
	if (!hasEda()) return;
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fetchData);
	else fetchData();
}

start();
