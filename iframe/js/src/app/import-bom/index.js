/**
 * @//module/ app/import-bom/index
 * @//description/ 页面编排：读网表 → 分组渲染 BOM → 粘贴 Excel 覆盖 → 写回网表
 * @//exports/ 无
 * @//dependencies/ core/netlist, core/util, core/version, ui/statusBar, ui/table, app/import-bom/bomModel, app/import-bom/pasteParser
 * @//example/ 页面入口，由 iframe/ImportBom.html 加载打包产物 app/ImportBom.js
 *
 * 只做「取 DOM → 调域模块 → 刷 UI」；分组、排序、粘贴规则都在 bomModel / pasteParser。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getComponentsContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { escapeHtml } from '../../core/util.js';
import { getEditorVersion, getVersionFamily } from '../../core/version.js';
import { createStatusBar } from '../../ui/statusBar.js';
import { nextSortState, selectionSummary, setAllSelected } from '../../ui/table.js';
import { applyPaste, applyToComponent, buildRows, groupRows, sortGroups } from './bomModel.js';
import { parsePaste } from './pasteParser.js';

/* ---------- 状态 ---------- */
let jsonData = {};
let componentsMap = {};
let tableData = [];
let Page = 'PCB';
let sortState = { key: null, asc: true };

/* ---------- DOM ---------- */
const tableBody = document.getElementById('tableBody');
const selectAllBtn = document.getElementById('selectAll');
const pasteBtn = document.getElementById('pasteBtn');
const importBtn = document.getElementById('importBtn');
const masterCheckbox = document.getElementById('masterCheckbox');
const versionTag = document.getElementById('versionTag');
const bar = createStatusBar({ textEl: document.getElementById('statusBar'), baseClass: 'status-bar' });

/**
 * 拼「旧值 → 新值」单元格（innerHTML 用，两个值都转义）
 *
 * @param {string} oldVal 旧值
 * @param {string} newVal 新值
 * @returns {string} HTML 片段
 * @sideEffects 无（纯函数）
 */
function formatCell(oldVal, newVal) {
	if (newVal && newVal !== oldVal) {
		return `${escapeHtml(oldVal || '-')} <span class="change-arrow">→</span> ${escapeHtml(newVal)}`;
	}
	return escapeHtml(oldVal || '-');
}

/**
 * 拼 title 文本（赋给 DOM 属性，不能再 HTML 转义，否则会显示成 &quot;）
 *
 * @param {string} oldVal 旧值
 * @param {string} newVal 新值
 * @returns {string} 纯文本
 * @sideEffects 无（纯函数）
 */
function formatTitle(oldVal, newVal) {
	if (newVal && newVal !== oldVal) return `${oldVal || '-'} → ${newVal}`;
	return String(oldVal || '-');
}

/**
 * 生成一个可显示「改动」的属性单元格
 *
 * 名称 / 制造商编号 / 制造商 / 供应商编号 / 供应商 五列原本各写 4 行同样的代码，
 * 这里收成一个工厂。
 *
 * @param {object} group 分组
 * @param {'name'|'manufacturerPart'|'manufacturer'|'supplierPart'|'supplier'} field 字段
 * @returns {HTMLTableCellElement} 单元格
 * @sideEffects DOM（创建元素）
 */
function createPropCell(group, field) {
	const cell = document.createElement('td');
	const changed = group.changed && group[field] !== group.original[field];
	cell.innerHTML = changed ? formatCell(group.original[field], group[field]) : escapeHtml(group.original[field] || '-');
	cell.title = changed ? formatTitle(group.original[field], group[field]) : group.original[field] || '-';
	return cell;
}

/**
 * 渲染表格
 *
 * @returns {void}
 * @sideEffects DOM
 */
function renderTable() {
	tableBody.innerHTML = '';
	const groups = sortGroups(groupRows(tableData), sortState);

	for (const group of groups) {
		const row = document.createElement('tr');
		if (!group.selected) row.classList.add('disabled-row');

		row.appendChild(createSelectorCell(group, row));

		const designatorCell = document.createElement('td');
		const designators = group.designators.join(', ');
		designatorCell.textContent = designators;
		designatorCell.title = designators;
		row.appendChild(designatorCell);

		row.appendChild(createPropCell(group, 'name'));
		row.appendChild(createPropCell(group, 'manufacturerPart'));
		row.appendChild(createPropCell(group, 'manufacturer'));
		row.appendChild(createPropCell(group, 'supplierPart'));
		row.appendChild(createPropCell(group, 'supplier'));

		tableBody.appendChild(row);
	}
}

/**
 * 生成行首复选框单元格
 *
 * @param {object} group 分组
 * @param {HTMLTableRowElement} row 所在行
 * @returns {HTMLTableCellElement} 单元格
 * @sideEffects DOM、修改分组与行数据的 selected
 */
function createSelectorCell(group, row) {
	const cell = document.createElement('td');
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.className = 'row-selector';
	checkbox.checked = group.selected;
	checkbox.addEventListener('change', () => {
		group.selected = checkbox.checked;
		for (const item of group.items) item.selected = checkbox.checked;
		row.classList.toggle('disabled-row', !checkbox.checked);
		updateMasterCheckbox();
		updateSelectAllButton();
	});
	cell.appendChild(checkbox);
	return cell;
}

/**
 * 更新状态栏（数据就绪提示 + 唯一 ID 自检）
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateStatusBar() {
	const ids = tableData.map((item) => item.uniqueId).filter((id) => id && id !== '');
	const hasEmpty = tableData.some((item) => !item.uniqueId || item.uniqueId === '');
	const hasDuplicate = new Set(ids).size !== ids.length;

	if (hasEmpty || hasDuplicate) {
		let msg = '注意：';
		if (hasEmpty) msg += '存在空的唯一ID; ';
		if (hasDuplicate) msg += '存在重复的唯一ID; ';
		msg += '建议先重置唯一ID，否则可能导致异常。';
		bar.text(msg, 'warning');
	} else {
		bar.text(`数据加载成功 (${(getVersionFamily() || 'V2') + '模式'})，可以粘贴并导入`, 'success');
	}
	importBtn.disabled = false;
}

/**
 * 更新全选按钮文案
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateSelectAllButton() {
	const summary = selectionSummary(tableData, (item) => item.selected);
	selectAllBtn.textContent = summary.isAll ? '全不选' : '全选';
}

/**
 * 更新主复选框三态
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateMasterCheckbox() {
	const summary = selectionSummary(tableData, (item) => item.selected);
	masterCheckbox.checked = summary.isAll;
	masterCheckbox.indeterminate = summary.isIndeterminate;
}

/**
 * 重新加载 BOM 行并重绘
 *
 * @returns {void}
 * @sideEffects DOM、状态栏
 */
function loadBOMData() {
	try {
		tableData = buildRows(componentsMap);
		renderTable();
	} catch (error) {
		console.error('加载BOM数据失败:', error);
		bar.text('加载BOM数据失败: ' + error.message, 'error');
	}
}

/**
 * 粘贴并应用
 *
 * @returns {Promise<void>}
 * @sideEffects 读剪贴板、修改行数据、DOM
 */
async function handlePaste() {
	try {
		const text = await navigator.clipboard.readText();
		const stat = applyPaste(tableData, parsePaste(text));
		renderTable();
		updateMasterCheckbox();
		updateSelectAllButton();

		if (stat.updated > 0) {
			bar.text(`成功匹配并更新了 ${stat.updated} 个组件的属性 (已自动勾选)`, 'success');
		} else {
			bar.text('没有检测到需要更新的属性，或数据无变化', 'warning');
		}
	} catch (error) {
		console.error('粘贴失败:', error);
		bar.text('粘贴失败: ' + error.message, 'error');
	}
}

/**
 * 把勾选的行写回网表
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（写网表）、DOM
 */
async function handleImport() {
	try {
		const selected = tableData.filter((item) => item.selected);
		if (selected.length === 0) {
			bar.text('请至少选择一个项目进行导入', 'warning');
			return;
		}

		let successCount = 0;
		for (const item of selected) {
			if (!item.jsonKey || !componentsMap[item.jsonKey]) continue;
			if (applyToComponent(item, componentsMap[item.jsonKey])) successCount++;
		}

		await setNetlist(Page, JSON.stringify(jsonData, null, 2));
		bar.text(`成功导入并写回了 ${successCount} 个组件的属性`, 'success');
		setTimeout(loadBOMData, 500);
	} catch (error) {
		console.error('导入失败:', error);
		bar.text('导入失败: ' + error.message, 'error');
	}
}

/**
 * 绑定表头排序
 *
 * @returns {void}
 * @sideEffects DOM（注册监听）
 */
function bindSortHeaders() {
	document.querySelectorAll('th.sortable').forEach((th) => {
		th.addEventListener('click', () => {
			sortState = nextSortState(sortState, th.getAttribute('data-key'));
			document.querySelectorAll('th.sortable .sort-arrow').forEach((span) => (span.textContent = ''));
			const arrow = th.querySelector('.sort-arrow');
			if (arrow) arrow.textContent = sortState.asc ? '▲' : '▼';
			renderTable();
		});
	});
}

/**
 * 初始化：版本标签 → 读网表 → 渲染
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function init() {
	try {
		const version = getEditorVersion();
		versionTag.textContent = version ? (getVersionFamily() || 'V2') + '模式' : 'V2模式 (默认)';
	} catch (e) {
		versionTag.textContent = '模式未知';
	}

	try {
		const netlist = await getNetlist('AUTO');
		Page = netlist.page;
		jsonData = netlist.json;
		componentsMap = getComponentsContainer(jsonData);
		loadBOMData();
		updateStatusBar();
	} catch (error) {
		console.error('初始化错误', error);
		bar.text('初始化失败: 未能读取到画布环境数据', 'error');
	}
}

masterCheckbox.addEventListener('change', () => {
	setAllSelected(tableData, (item, value) => (item.selected = value), masterCheckbox.checked);
	renderTable();
	updateSelectAllButton();
});

selectAllBtn.addEventListener('click', () => {
	const summary = selectionSummary(tableData, (item) => item.selected);
	setAllSelected(tableData, (item, value) => (item.selected = value), !summary.isAll);
	renderTable();
	updateMasterCheckbox();
	updateSelectAllButton();
});

pasteBtn.addEventListener('click', handlePaste);
importBtn.addEventListener('click', handleImport);

bindSortHeaders();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
