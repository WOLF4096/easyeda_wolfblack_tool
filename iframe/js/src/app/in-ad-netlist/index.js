/**
 * @//module/ app/in-ad-netlist/index
 * @//description/ 页面编排：读当前网表 → 导入 AD 网表（文件/剪贴板）→ 差异对比表 → 写回并刷新
 * @//exports/ 无
 * @//dependencies/ core/eda, core/netlist, ui/toast, app/in-ad-netlist/adParser, app/in-ad-netlist/compare
 * @//example/ 页面入口，由 iframe/InADNetlist.html 加载打包产物 app/InADNetlist.js
 */

import { hasEda } from '../../core/eda.js';
import { detectContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { escapeHtml } from '../../core/util.js';
import { toast } from '../../ui/toast.js';
import { parseADNetlist } from './adParser.js';
import { applyToCopy, buildCompareRows } from './compare.js';

/* ---------- 状态 ---------- */
let currentNetlistRaw = null;
let adNetMap = new Map();

/* ---------- DOM ---------- */
const selectFileBtn = document.getElementById('selectFileBtn');
const pasteNetlistBtn = document.getElementById('pasteNetlistBtn');
const writeNetlistBtn = document.getElementById('writeNetlistBtn');
const tableBody = document.getElementById('tableBody');
const adStatusSpan = document.getElementById('adStatus');
const parseFeedbackSpan = document.getElementById('parseFeedback');

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.net, .txt, .asc, */*';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

/**
 * 显示一条解析反馈（可选自动清除）
 *
 * @param {string} message 文案
 * @param {string} [color] 颜色（'#6fcf97' 成功 / '#f28b82' 失败 / '#f5a97f' 警告）
 * @param {number} [clearMs] 多少毫秒后清空；不传则常驻
 * @returns {void}
 * @sideEffects DOM
 */
function feedback(message, color, clearMs) {
	if (!parseFeedbackSpan) return;
	parseFeedbackSpan.innerText = message;
	parseFeedbackSpan.style.color = color || '';
	if (clearMs) {
		setTimeout(() => {
			if (parseFeedbackSpan) parseFeedbackSpan.innerText = '';
		}, clearMs);
	}
}

/**
 * 读取当前 PCB 网表（深拷贝一份，改动只在副本上做）
 *
 * @returns {Promise<boolean>} 是否成功
 * @sideEffects eda API（读网表）、DOM
 */
async function loadCurrentNetlist() {
	try {
		if (!hasEda()) throw new Error('当前未检测到嘉立创EDA环境，请确保在JLCEDA插件/扩展中运行');
		const { json } = await getNetlist('PCB');
		currentNetlistRaw = JSON.parse(JSON.stringify(json));
		return true;
	} catch (err) {
		console.error('加载PCB网表失败:', err);
		feedback(`加载网表失败: ${err.message}`, '#f28b82');
		return false;
	}
}

/**
 * 渲染差异对比表
 *
 * @returns {void}
 * @sideEffects DOM
 */
function renderCompareTable() {
	const rows = currentNetlistRaw && adNetMap.size > 0 ? buildCompareRows(adNetMap, detectContainer(currentNetlistRaw)) : [];

	if (rows.length === 0) {
		const message =
			currentNetlistRaw && adNetMap.size > 0
				? '解析后的AD网表无有效引脚连接，请检查文件内容'
				: '暂无网表对比数据，请先选择或粘贴AD格式网表';
		tableBody.innerHTML = `<tr class="empty-table-msg"><td colspan="4">${message}</td></tr>`;
		adStatusSpan.innerText = adNetMap.size === 0 ? '未导入AD网表' : 'AD网表无有效连接';
		return;
	}

	tableBody.innerHTML = rows
		.map((row) => {
			const badge = row.isDiff ? '<span class="diff-badge">→ 变更</span>' : '';
			const tooltip = row.tooltip || (row.isDiff ? '网络将变更' : '');
			return `
					<tr class="${row.warning ? 'warning-row' : ''}" title="${escapeHtml(tooltip)}">
						<td><strong>${escapeHtml(row.refDes)}</strong></td>
						<td>${escapeHtml(row.pinNo)}</td>
						<td class="old-net">${escapeHtml(row.oldNet)} ${badge}</td>
						<td class="new-net">${escapeHtml(row.newNet)}</td>
					</tr>
				`;
		})
		.join('');
	adStatusSpan.innerText = 'AD网表已导入';
}

/**
 * 处理 AD 网表文本（文件或剪贴板共用）
 *
 * @param {string} adContent 文本内容
 * @returns {boolean} 是否解析出有效连接
 * @sideEffects DOM（清空/重绘表格）、修改 adNetMap
 */
function processAdContent(adContent) {
	if (!adContent || adContent.trim() === '') {
		feedback('网表内容为空，请检查文件或剪贴板', '#f28b82');
		return false;
	}

	const { netMap, errors } = parseADNetlist(adContent);
	if (errors.length > 0) feedback(errors.slice(0, 2).join('; '), '#f5a97f');
	else feedback(`解析成功 ${netMap.size} 个引脚`, '#6fcf97');

	if (netMap.size === 0) {
		adNetMap = new Map();
		adStatusSpan.innerText = 'AD网表无有效连接';
		tableBody.innerHTML = '<tr class="empty-table-msg"><td colspan="4">未解析到任何引脚-网络关系，请确认网表格式（括号分段，位号-引脚）</td></tr>';
		return false;
	}

	adNetMap = netMap;
	renderCompareTable();
	return true;
}

/**
 * 写回网表
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（写/读网表）、DOM
 */
async function writeNetlistToPCB() {
	if (adNetMap.size === 0) {
		feedback('没有可写入的AD网表数据，请先导入AD网表', '#f28b82', 2000);
		return;
	}
	if (!currentNetlistRaw) {
		feedback('当前PCB网表未加载，请刷新重试');
		return;
	}

	try {
		const { updatedObj } = applyToCopy(currentNetlistRaw, adNetMap);
		await setNetlist('PCB', JSON.stringify(updatedObj));
		// 写入成功后保留原反馈文字、只把它染绿（与原实现一致），随后清空
		if (parseFeedbackSpan) parseFeedbackSpan.style.color = '#6fcf97';
		// 重新读一遍，让「旧网络」列显示成刚写进去的值
		await loadCurrentNetlist();
		renderCompareTable();
		setTimeout(() => {
			if (parseFeedbackSpan) parseFeedbackSpan.innerText = '';
		}, 3000);
	} catch (err) {
		console.error('写入网表失败:', err);
		feedback(`写入网表失败: ${err.message || err}`, '#f28b82', 4000);
	}
}

/**
 * 从剪贴板读取
 *
 * @returns {Promise<void>}
 * @sideEffects 读剪贴板、DOM
 */
async function pasteFromClipboard() {
	try {
		if (!navigator.clipboard) {
			feedback('当前浏览器不支持剪贴板读取，请手动选择文件');
			return;
		}
		const text = await navigator.clipboard.readText();
		if (!text.trim()) {
			feedback('剪贴板内容为空');
			return;
		}
		processAdContent(text);
	} catch (err) {
		console.error('读取剪贴板失败:', err);
		feedback(`读取剪贴板失败: ${err.message}，请尝试选择文件`, '#f28b82');
	}
}

fileInput.onchange = async (e) => {
	const file = e.target.files[0];
	if (!file) return;
	try {
		processAdContent(await file.text());
	} catch (err) {
		feedback(`读取文件失败: ${err.message}`, '#f28b82');
	} finally {
		fileInput.value = '';
	}
};

/**
 * 初始化：加载当前网表 → 渲染空态 → 绑事件
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function init() {
	if (!hasEda()) {
		feedback('未检测到嘉立创EDA运行环境，演示模式仅限UI，无法读写真实网表');
		console.warn('未检测到 EDA 环境');
		currentNetlistRaw = { components: {} };
	} else if (!(await loadCurrentNetlist())) {
		feedback('加载PCB网表失败，请检查权限或重新打开插件');
	}

	renderCompareTable();

	selectFileBtn.addEventListener('click', () => fileInput.click());
	pasteNetlistBtn.addEventListener('click', pasteFromClipboard);
	writeNetlistBtn.addEventListener('click', async () => {
		if (adNetMap.size === 0) {
			feedback('请先导入AD网表（选择文件或粘贴）再执行写入', '#f5a97f', 1800);
			return;
		}
		if (!hasEda()) {
			feedback('当前环境不支持写入网表(eda.pcb_Net不可用)');
			toast('当前环境不支持写入网表', 2);
			return;
		}
		await writeNetlistToPCB();
	});
}

void init();
