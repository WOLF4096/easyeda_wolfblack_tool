/**
 * @//module/ app/code-convert/index
 * @//description/ 页面编排：读网表 → 筛阻容感 → 换算分组 → 勾选（转换值可手改）写回 Name/Value → 关闭面板
 * @//exports/ 无
 * @//dependencies/ core/eda, core/netlist, core/version, ui/statusBar, ui/table, app/code-convert/group
 * @//example/ 页面入口，由 iframe/CodeConvert.html 加载打包产物 app/CodeConvert.js
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../../core/eda.js';
import { getComponentsContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { getVersionFamily } from '../../core/version.js';
import { createStatusBar } from '../../ui/statusBar.js';
import { selectionSummary, setAllSelected } from '../../ui/table.js';
import { applyConversion, groupComponents, hasUniqueIdProblem, processComponents } from './group.js';

/* ---------- 状态 ---------- */
let jsonData = null;
let componentsMap = null;
let Page = 'PCB';
let grouped = [];

/* ---------- DOM ---------- */
const tableBody = document.getElementById('tableBody');
const selectAllBox = document.getElementById('selectAll');
const executeBtn = document.getElementById('executeBtn');
const versionTag = document.getElementById('versionTag');
const bar = createStatusBar({ textEl: document.getElementById('status'), baseClass: 'status' });

/**
 * 该行是否可被写回：能换算出值（或用户改过值）且唯一 ID 没问题
 *
 * @param {object} group 分组
 * @returns {boolean} 是否可勾选、可写回
 * @sideEffects 无（纯函数）
 */
function isRowModifiable(group) {
	return Boolean(group.shouldModify && !group.hasError);
}

/**
 * 同步「转换值」输入框的视觉状态（绿字 = 执行时会写回）
 *
 * @param {HTMLInputElement} input 输入框
 * @param {object} group 分组
 * @returns {void}
 * @sideEffects DOM（改 class）
 */
function syncValueStyle(input, group) {
	input.classList.toggle('is-modified', group.shouldModify);
}

/**
 * 文本框改动后重算这一行：值与原名不同就算「需要修改」，并自动勾上
 *
 * 这样即使某行原本没换算出来（比如名称是个认不出的写法），手动把值填对也能照样写回。
 *
 * @param {object} group 分组
 * @param {HTMLInputElement} checkbox 该行的「修改」复选框
 * @param {HTMLInputElement} input 该行的「转换值」输入框
 * @returns {void}
 * @sideEffects 就地改 group、DOM
 */
function applyEditedValue(group, checkbox, input) {
	if (!group) return;
	const text = input.value.trim();
	group.value = text;
	group.shouldModify = text !== '' && text !== group.name;
	group.modified = isRowModifiable(group);
	checkbox.disabled = !isRowModifiable(group);
	checkbox.checked = group.modified;
	syncValueStyle(input, group);
	updateSelectAllCheckbox();
}

/**
 * 建「转换值」文本输入框（可改，执行时按框里的值写回）
 *
 * @param {object} group 分组
 * @param {HTMLInputElement} checkbox 该行的「修改」复选框
 * @param {number} index 分组下标
 * @returns {HTMLInputElement} 输入框
 * @sideEffects DOM（创建元素、绑事件）
 */
function createValueInput(group, checkbox, index) {
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'cc-value-input';
	input.spellcheck = false;
	input.value = group.value == null ? '' : group.value;
	input.title = '可以直接改，点「执行」按这里的值写回';
	syncValueStyle(input, group);
	input.addEventListener('input', () => applyEditedValue(grouped[index], checkbox, input));
	return input;
}

/**
 * 建「修改」复选框
 *
 * @param {object} group 分组
 * @param {number} index 分组下标
 * @returns {HTMLInputElement} 复选框
 * @sideEffects DOM（创建元素、绑事件）
 */
function createModifyCheckbox(group, index) {
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = group.modified;
	checkbox.disabled = !isRowModifiable(group);
	checkbox.dataset.index = index;
	checkbox.style.transform = 'scale(1)';
	checkbox.addEventListener('change', () => {
		grouped[index].modified = checkbox.checked;
		updateSelectAllCheckbox();
	});
	return checkbox;
}

/**
 * 渲染折叠后的表格
 *
 * @returns {void}
 * @sideEffects DOM
 */
function renderTable() {
	tableBody.innerHTML = '';

	grouped.forEach((group, index) => {
		const row = document.createElement('tr');

		const modifyCell = document.createElement('td');
		modifyCell.className = 'checkbox-cell';
		const checkbox = createModifyCheckbox(group, index);
		modifyCell.appendChild(checkbox);
		row.appendChild(modifyCell);

		row.appendChild(ellipsisCell(group.designators.join(','), 150));
		row.appendChild(ellipsisCell(group.footprint || '-', 150));

		const nameCell = document.createElement('td');
		nameCell.textContent = group.name;
		row.appendChild(nameCell);

		const valueCell = document.createElement('td');
		valueCell.appendChild(createValueInput(group, checkbox, index));
		row.appendChild(valueCell);

		tableBody.appendChild(row);
	});

	updateSelectAllCheckbox();
}

/**
 * 生成单行省略的单元格
 *
 * @param {string} text 文本
 * @param {number} maxWidth 最大宽度（px）
 * @returns {HTMLTableCellElement} 单元格
 * @sideEffects DOM（创建元素）
 */
function ellipsisCell(text, maxWidth) {
	const cell = document.createElement('td');
	cell.textContent = text;
	cell.title = text;
	cell.style.maxWidth = maxWidth + 'px';
	cell.style.overflow = 'hidden';
	cell.style.textOverflow = 'ellipsis';
	cell.style.whiteSpace = 'nowrap';
	return cell;
}

/**
 * 参与「可换算」判定的分组（有错误或本来不需要换算的排除在外）
 *
 * @returns {Array<object>} 分组
 * @sideEffects 无（纯函数）
 */
function modifiableGroups() {
	return grouped.filter((group) => group.shouldModify && !group.hasError);
}

/**
 * 同步全选复选框三态
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateSelectAllCheckbox() {
	const summary = selectionSummary(modifiableGroups(), (group) => group.modified);
	selectAllBox.checked = summary.isAll;
	selectAllBox.indeterminate = summary.isIndeterminate;
}

/**
 * 全选/取消全选
 *
 * @returns {void}
 * @sideEffects 修改分组状态、DOM
 */
function toggleSelectAll() {
	setAllSelected(modifiableGroups(), (group, value) => (group.modified = value), selectAllBox.checked);
	renderTable();
}

/**
 * 执行转换并关闭面板
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（写网表、关面板）、DOM
 */
async function executeConversion() {
	try {
		applyConversion(grouped, componentsMap);
		await setNetlist(Page, JSON.stringify(jsonData));

		const host = getEda();
		if (host && host.sys_IFrame && typeof host.sys_IFrame.closeIFrame === 'function') {
			host.sys_IFrame.closeIFrame('CodeConvert');
		}
	} catch (error) {
		console.error('执行转换失败:', error);
		bar.text('转换失败: ' + error.message, 'error');
	}
}

/**
 * 初始化：版本标签 → 读网表 → 唯一 ID 自检 → 渲染 → 绑事件
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function initialize() {
	try {
		versionTag.textContent = (getVersionFamily() || 'V2') + '模式';
	} catch (e) {
		versionTag.textContent = 'V2模式';
	}

	try {
		const netlist = await getNetlist('AUTO');
		Page = netlist.page;
		jsonData = netlist.json;
		componentsMap = getComponentsContainer(jsonData);

		const check = hasUniqueIdProblem(componentsMap);
		grouped = groupComponents(processComponents(componentsMap));
		renderTable();

		selectAllBox.addEventListener('change', toggleSelectAll);
		executeBtn.addEventListener('click', executeConversion);

		if (!check.ok) {
			bar.text('部分元件的唯一ID为空/重复，可以在菜单栏-设计-重置唯一ID，否则会出现异常', 'error');
			executeBtn.disabled = true;
		} else {
			bar.text('数据加载成功，请仔细检查后，选择要转换的元件', 'info');
			executeBtn.disabled = false;
		}
	} catch (error) {
		console.error('初始化失败:', error);
		bar.text('数据加载失败: ' + error.message, 'error');
	}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
else initialize();
