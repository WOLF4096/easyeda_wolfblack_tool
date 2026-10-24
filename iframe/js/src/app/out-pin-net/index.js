/**
 * @//module/ app/out-pin-net/index
 * @//description/ 页面编排：读网表 → 渲染「器件 × 引脚」矩阵 → 导出引脚矩阵 CSV 与网络长度 CSV
 * @//exports/ 无
 * @//dependencies/ core/eda, core/netlist, core/util, ui/download, ui/toast, app/out-pin-net/matrix
 * @//example/ 页面入口，由 iframe/OutPinNet.html 加载打包产物 app/OutPinNet.js
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../../core/eda.js';
import { getComponentsContainer, getNetlist } from '../../core/netlist.js';
import { escapeHtml } from '../../core/util.js';
import { downloadText, toCsv } from '../../ui/download.js';
import { toast } from '../../ui/toast.js';
import { buildComponents, buildMatrix, toCsvRows, toNetLengthRows } from './matrix.js';

/** CSV 换行沿用原实现的 `\n`（Excel 也能识别），避免导出文件出现肉眼可见的差异 */
const CSV_NEWLINE = '\n';

/* ---------- 状态 ---------- */
let allComponents = [];

/* ---------- DOM ---------- */
const typeSelect = document.getElementById('typeSelect');
const propSelect = document.getElementById('propSelect');
const tableContainer = document.getElementById('tableContainer');
const netTable = document.getElementById('netTable');
const exportPinNetBtn = document.getElementById('exportPinNetBtn');
const exportAllNetBtn = document.getElementById('exportAllNetBtn');

/**
 * 取当前属性类型下出现过的属性值（去重排序）
 *
 * @param {string} typeKey 属性类型
 * @returns {string[]} 属性值
 * @sideEffects 无（纯函数）
 */
function uniquePropValues(typeKey) {
	const values = allComponents.map((comp) => comp[typeKey]).filter(Boolean);
	return [...new Set(values)].sort();
}

/**
 * 重建属性下拉（尽量保留当前选中项）
 *
 * @returns {void}
 * @sideEffects DOM
 */
function populatePropSelect() {
	const typeKey = typeSelect.value;
	const values = uniquePropValues(typeKey);
	const current = propSelect.value;

	propSelect.innerHTML = '';
	propSelect.appendChild(makeOption('ALL', '所有'));
	for (const value of values) propSelect.appendChild(makeOption(value, value));

	propSelect.value = current && values.includes(current) ? current : 'ALL';
	propSelect.title = propSelect.value === 'ALL' ? '所有' : propSelect.value;
}

/**
 * 生成一个 option
 *
 * @param {string} value 值
 * @param {string} text 文案
 * @returns {HTMLOptionElement} option 元素
 * @sideEffects DOM（创建元素）
 */
function makeOption(value, text) {
	const option = document.createElement('option');
	option.value = value;
	option.textContent = text;
	option.title = text;
	return option;
}

/**
 * 渲染矩阵表格
 *
 * @returns {void}
 * @sideEffects DOM
 */
function renderTable() {
	const typeKey = typeSelect.value;
	const filterValue = propSelect.value;
	propSelect.title = filterValue === 'ALL' ? '所有' : filterValue;

	const matrix = buildMatrix(allComponents, typeKey, filterValue);

	let thead = '<thead><tr>';
	thead += `<th>${escapeHtml(matrix.corner)}</th>`;
	for (const pin of matrix.pins) thead += `<th>${escapeHtml(pin)}</th>`;
	thead += '</tr></thead>';

	let tbody = '<tbody>';
	if (matrix.rows.length === 0) {
		tbody += `<tr><td colspan="${matrix.pins.length + 1}" style="text-align:center; padding:40px; color:#7a8aa5;">暂无匹配器件</td></tr>`;
	} else {
		for (const row of matrix.rows) {
			tbody += '<tr>';
			tbody += `<td>${escapeHtml(row.designator)}</td>`;
			for (const cell of row.cells) tbody += `<td>${escapeHtml(cell)}</td>`;
			tbody += '</tr>';
		}
	}
	tbody += '</tbody>';

	netTable.innerHTML = thead + tbody;
}

/**
 * 导出当前筛选的引脚-网络矩阵
 *
 * @returns {void}
 * @sideEffects DOM（下载）
 */
function exportPinNetAsCsv() {
	const matrix = buildMatrix(allComponents, typeSelect.value, propSelect.value);
	downloadText(`${propSelect.value}.csv`, toCsv(toCsvRows(matrix), { newline: CSV_NEWLINE }), { mime: 'text/csv', bom: true });
}

/**
 * 导出全部网络及其长度（仅 PCB 环境有效）
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（pcb_Net.getAllNets）、DOM（下载）、宿主 toast
 */
async function exportAllNetsAsCsv() {
	try {
		const host = getEda();
		const allNets = await host.pcb_Net.getAllNets();
		if (!allNets || allNets.length === 0) {
			toast('未能获取到网络数据，请确认是否处于 PCB 环境或图纸中是否包含网络', 2);
			return;
		}
		downloadText('all_networks_length.csv', toCsv(toNetLengthRows(allNets), { newline: CSV_NEWLINE }), { mime: 'text/csv', bom: true });
	} catch (error) {
		console.error('获取网络长度失败:', error);
		toast('导出网络数据失败：带长度的网络导出仅在 PCB 视图下有效', 2);
	}
}

/**
 * 属性类型切换：重建下拉后重绘
 *
 * @returns {void}
 * @sideEffects DOM
 */
function typeChangeHandler() {
	populatePropSelect();
	renderTable();
}

/**
 * 初始化：读网表 → 建模型 → 渲染 → 绑事件
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function initApp() {
	netTable.innerHTML = '<div class="loading-message">加载网表中...</div>';

	const jsonData = (await getNetlist('AUTO')).json;

	try {
		allComponents = buildComponents(getComponentsContainer(jsonData)).components;
		populatePropSelect();
		renderTable();

		typeSelect.removeEventListener('change', typeChangeHandler);
		propSelect.removeEventListener('change', renderTable);
		typeSelect.addEventListener('change', typeChangeHandler);
		propSelect.addEventListener('change', renderTable);

		// shift + 滚轮 → 横向滚动（大表格必需）
		tableContainer.addEventListener(
			'wheel',
			(e) => {
				if (!e.shiftKey) return;
				e.preventDefault();
				tableContainer.scrollLeft += e.deltaY;
			},
			{ passive: false },
		);
	} catch (error) {
		netTable.innerHTML = `<div class="loading-message" style="color:#b33;">加载失败: ${escapeHtml(error.message)}</div>`;
		console.error(error);
	}
}

/**
 * 导出按钮的公共守卫：网表尚未加载时提示
 *
 * @returns {boolean} 是否已加载
 * @sideEffects 宿主 toast
 */
function ensureLoaded() {
	if (allComponents.length > 0) return true;
	toast('网表尚未加载', 2);
	return false;
}

exportPinNetBtn.addEventListener('click', () => {
	if (ensureLoaded()) exportPinNetAsCsv();
});

exportAllNetBtn.addEventListener('click', () => {
	if (ensureLoaded()) void exportAllNetsAsCsv();
});

void initApp();
