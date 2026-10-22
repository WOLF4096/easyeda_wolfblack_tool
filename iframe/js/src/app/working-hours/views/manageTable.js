/**
 * @//module/ app/working-hours/views/manageTable
 * @//description/ 「工程管理」表格：排序 + 渲染 + 行点击切换工程
 * @//exports/ sortProjectList, renderManageTable
 * @//dependencies/ core/util, app/working-hours/time
 * @//example/ renderManageTable({ projectStats, sortField: 'work', sortOrder: 'desc', selectedUuid, onSelect })
 *
 * 行内的「导出 / 删除」按钮用的是行内 onclick（`exportProjectChart('uuid')`），
 * 打包成 IIFE 后这些函数必须挂在 window 上，见页面入口的 Object.assign(window, ...)。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { escapeHtml } from '../../../core/util.js';
import { formatDuration, formatFullDateTime } from '../time.js';

/** 可排序的列 → 取值函数 */
const SORTERS = {
	name: (a) => a.name,
	start: (a) => a.startTs,
	end: (a) => a.endTs,
	work: (a) => a.totalWork,
	rest: (a) => a.totalRest,
};

/**
 * 按字段排序工程列表（name 用中文排序，其余按数值）
 *
 * @param {Array<object>} list 工程统计列表
 * @param {string} field 排序字段（空串表示不排序）
 * @param {'asc'|'desc'} order 排序方向
 * @returns {Array<object>} 排好序的新数组
 * @sideEffects 无（纯函数）
 */
export function sortProjectList(list, field, order) {
	if (!field) return list.slice();
	const sorted = list.slice();
	const pick = SORTERS[field];
	if (!pick) return sorted;
	if (field === 'name') {
		sorted.sort((a, b) => (order === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));
		return sorted;
	}
	sorted.sort((a, b) => (order === 'desc' ? pick(b) - pick(a) : pick(a) - pick(b)));
	return sorted;
}

/**
 * 更新表头排序箭头
 *
 * @param {string} field 当前排序字段
 * @param {'asc'|'desc'} order 当前排序方向
 * @returns {void}
 * @sideEffects 改写 DOM 文本与颜色
 */
function updateSortIndicators(field, order) {
	['name', 'start', 'end', 'work', 'rest'].forEach((f) => {
		const el = document.getElementById(`sort-${f}`);
		if (!el) return;
		if (field !== f) {
			el.innerText = '';
			return;
		}
		el.innerText = order === 'desc' ? ' ▼' : ' ▲';
		el.style.color = 'var(--vscode-link)';
	});
}

/**
 * 渲染一行
 *
 * @param {object} item 工程统计
 * @param {boolean} active 是否选中
 * @param {(uuid: string) => void} onSelect 选中回调
 * @returns {HTMLTableRowElement} 行元素
 * @sideEffects 创建 DOM 并绑定 click
 */
function createRow(item, active, onSelect) {
	const tr = document.createElement('tr');
	tr.style.cursor = 'pointer';
	tr.dataset.uuid = item.uuid;
	if (active) tr.style.background = 'var(--vscode-active)';

	tr.onclick = () => onSelect(item.uuid);

	// 防御式渲染：利用 escapeHtml 防止名字内的标签注入
	tr.innerHTML = `
                    <td title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</td>
                    <td>${formatFullDateTime(item.startTs)}</td>
                    <td>${formatFullDateTime(item.endTs)}</td>
                    <td style="text-align: center;">${formatDuration(item.totalWork)}</td>
                    <td style="text-align: center;">${formatDuration(item.totalRest)}</td>
                    <td style="text-align: center;" onclick="event.stopPropagation();">
                        <button class="small-btn export" onclick="exportProjectChart('${item.uuid}')">导出</button>
                    </td>
                    <td style="text-align: center;" onclick="event.stopPropagation();">
                        <button class="small-btn del" onclick="confirmDeleteProject('${item.uuid}')">删除</button>
                    </td>
                `;
	return tr;
}

/**
 * 渲染工程管理表格
 *
 * @param {object} options 参数
 * @param {Record<string, object>} options.projectStats 工程统计
 * @param {string} options.sortField 排序字段
 * @param {'asc'|'desc'} options.sortOrder 排序方向
 * @param {string|null} options.selectedUuid 当前选中工程
 * @param {(uuid: string) => void} options.onSelect 行点击回调
 * @param {() => void} options.onNoSelection 没有任何工程时的回调（用于释放管理图）
 * @returns {Array<object>} 渲染后的列表（调用方据此决定默认选中项）
 * @sideEffects 改写表格 DOM
 */
export function renderManageTable(options) {
	const tbody = document.getElementById('project-table-body');
	if (!tbody) return [];
	tbody.innerHTML = '';
	updateSortIndicators(options.sortField, options.sortOrder);

	const list = sortProjectList(Object.values(options.projectStats), options.sortField, options.sortOrder);
	if (list.length === 0) options.onNoSelection();

	for (const item of list) {
		tbody.appendChild(createRow(item, options.selectedUuid === item.uuid, options.onSelect));
	}
	return list;
}
