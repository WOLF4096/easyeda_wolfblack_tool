/**
 * @//module/ app/netlist-3d/index
 * @//description/ 页面编排：读 PCB 网表 → 表格改 3D 参数（mm/mil）→ 批量 modify 并回读校验
 * @//exports/ 无
 * @//dependencies/ core/eda, core/netlist, ui/toast, app/netlist-3d/transform
 * @//example/ 页面入口，由 iframe/NetlistUpdate3DModels.html 加载打包产物 app/NetlistUpdate3DModels.js
 *
 * 注意：表格里的输入框用**内联 onchange** 调 `updateParam(...)`，所以下面必须显式把它挂到
 * `window` 上 —— 打包成 IIFE 后，函数声明不再自动成为全局。这是本页唯一对外暴露的契约。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { getEda } from '../../core/eda.js';
import { getNetlist } from '../../core/netlist.js';
import { toast } from '../../ui/toast.js';
import { STATUS_CLASS, applyInput, buildRows, isModelMatch, toDisplay } from './transform.js';

/* ---------- 状态 ---------- */
const appState = { data: [], unit: 'mm', sortCol: null, sortAsc: true };

/* ---------- DOM ---------- */
const tbody = document.getElementById('table-body');
const btnUnit = document.getElementById('btn-unit');
const btnLoad = document.getElementById('btn-load');
const btnUpdate = document.getElementById('btn-update');
const statusText = document.getElementById('status-text');
const progressBg = document.getElementById('progressBg');

/**
 * 渲染表格
 *
 * @returns {void}
 * @sideEffects DOM
 */
function renderTable() {
	if (appState.data.length === 0) {
		tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: #888;">未找到有效的3D模型数据</td></tr>';
		return;
	}

	const renderData = sortRows(appState.data);
	const makeInput = (item, field, isDegree) => {
		const display = toDisplay(item[field], appState.unit, isDegree);
		return `<td class="col-xyz"><input class="xyz-input" type="text" value="${display}" onchange="updateParam('${item.id}', '${field}', this.value)"></td>`;
	};

	tbody.innerHTML = renderData
		.map((item) => {
			const statusClass = STATUS_CLASS[item.status] || 'status-ready';
			const title =
				item.modelTitle === '没有找到 3D 模型' ? `<span class="text-error">${item.modelTitle}</span>` : item.modelTitle;
			return `<tr>
					<td title="${item.designator}">${item.designator}</td>
					<td title="${item.footprint}">${item.footprint}</td>
					<td title="${item.modelTitle}">${title}</td>
					${makeInput(item, 'sX', false)} ${makeInput(item, 'sY', false)} ${makeInput(item, 'sZ', false)}
					${makeInput(item, 'rX', true)} ${makeInput(item, 'rY', true)} ${makeInput(item, 'rZ', true)}
					${makeInput(item, 'oX', false)} ${makeInput(item, 'oY', false)} ${makeInput(item, 'oZ', false)}
					<td class="${statusClass}" id="status-${item.id}">${item.status}</td>
				</tr>`;
		})
		.join('');
}

/**
 * 按当前排序状态返回副本（字符串走自然序，数字走差值）
 *
 * @param {Array<object>} rows 行数据
 * @returns {Array<object>} 排序后的新数组
 * @sideEffects 无（纯函数）
 */
function sortRows(rows) {
	const list = rows.slice();
	if (!appState.sortCol) return list;
	const col = appState.sortCol;
	const dir = appState.sortAsc ? 1 : -1;
	list.sort((a, b) => {
		const valA = a[col];
		const valB = b[col];
		if (typeof valA === 'string' || typeof valB === 'string') {
			return dir * String(valA).localeCompare(String(valB), undefined, { numeric: true });
		}
		return dir * (valA - valB);
	});
	return list;
}

/**
 * 解析网表并重绘
 *
 * @param {object} netlistData 网表对象
 * @returns {void}
 * @sideEffects DOM
 */
function parseNetlist(netlistData) {
	appState.data = buildRows(netlistData);
	btnUpdate.disabled = appState.data.length === 0;
	statusText.textContent = `成功加载 ${appState.data.length} 个器件`;
	appState.sortCol = 'modelTitle';
	appState.sortAsc = true;
	renderTable();
}

/**
 * 浏览器直开时的假数据（原实现保留，便于独立调试）
 *
 * @returns {void}
 * @sideEffects DOM
 */
function mockDataLoad() {
	parseNetlist({
		components: {
			comp1: { props: { Designator: 'R1', '3D Model': 'uuid1', '3D Model Title': 'RES_0603', '3D Model Transform': '387,200,300,90,0,45.500,10,20.000,0', Footprint: 'R0603' } },
			comp2: { props: { Designator: 'C1', '3D Model': 'uuid2', '3D Model Title': 'CAP_0402', '3D Model Transform': '50,50,50,0,0,0,0,0,0', Footprint: 'C0402' } },
			comp3: { props: { Designator: 'U1', '3D Model': 'uuid3', '3D Model Title': 'ESP32-WROOM', '3D Model Transform': '700.00,1000,120,0,0,90,-50,20,10', Footprint: 'MODULE-38P' } },
		},
	});
}

/**
 * 从当前 PCB 读取网表
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM、宿主 toast
 */
async function loadFromCurrent() {
	const host = getEda();
	if (!host) {
		toast('未检测到 EDA 运行环境', 2);
		mockDataLoad();
		return;
	}

	try {
		statusText.textContent = '正在获取当前PCB网表...';
		let netlistData;
		try {
			netlistData = (await getNetlist('PCB')).json;
		} catch (apiError) {
			console.error('API 调用失败:', apiError);
			throw new Error('无法读取 PCB 网表，请确保当前处于 PCB 编辑页面');
		}
		parseNetlist(netlistData);
	} catch (error) {
		console.error('获取当前网表失败:', error);
		toast('获取当前网表失败: ' + error.message, 'error');
		statusText.textContent = '就绪';
	}
}

/**
 * 从本地文件读取网表
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（文件对话框）、DOM、宿主 toast
 */
async function loadFromFile() {
	const host = getEda();
	if (!host) {
		toast('未检测到 EDA 运行环境', 2);
		mockDataLoad();
		return;
	}

	try {
		const fileResult = await host.sys_FileSystem.openReadFileDialog();
		if (!fileResult) return;
		const fileContent = typeof fileResult === 'object' && fileResult.text ? await fileResult.text() : fileResult;
		const jsonString = Array.isArray(fileContent) ? fileContent.join('') : fileContent;
		parseNetlist(JSON.parse(String(jsonString).trim()));
	} catch (error) {
		toast('网表解析失败: ' + error.message, 'error');
	}
}

/**
 * 切换单位并重绘
 *
 * @returns {void}
 * @sideEffects DOM
 */
function toggleUnit() {
	appState.unit = appState.unit === 'mm' ? 'mil' : 'mm';
	document.getElementById('th-size').textContent = `大小 (${appState.unit})`;
	document.getElementById('th-offset').textContent = `偏移 (${appState.unit})`;
	renderTable();
}

/**
 * 更新单个器件（写 3D 三字段 + 回读校验）
 *
 * @param {object} host 宿主对象
 * @param {object} item 行数据
 * @param {string} primId 图元 id
 * @returns {Promise<'成功'|'校验失败'|'失败'>} 处理结果
 * @sideEffects eda API（pcb_PrimitiveComponent.modify）
 */
async function updateOne(host, item, primId) {
	try {
		const result = await host.pcb_PrimitiveComponent.modify(primId, {
			otherProperty: {
				'3D Model': item.rawModel,
				'3D Model Title': item.modelTitle,
				'3D Model Transform': item.rawTransform,
			},
		});
		if (isModelMatch(item, result)) return '成功';
		console.warn(`更新 ${item.designator} 返回值校验不匹配:`, result);
		return '校验失败';
	} catch (err) {
		console.error(`更新 ${item.designator} 失败:`, err);
		return '失败';
	}
}

/**
 * 建「位号 → 图元 id」索引
 *
 * @param {Array<object>} pcbComps `pcb_PrimitiveComponent.getAll()` 的返回
 * @returns {Record<string, string>} 位号索引
 * @sideEffects 无（纯函数）
 */
function buildPcbMap(pcbComps) {
	const pcbMap = {};
	for (const comp of pcbComps) {
		if (comp && comp.designator && comp.primitiveId) pcbMap[comp.designator] = comp.primitiveId;
	}
	return pcbMap;
}

/**
 * 算出单个器件本轮的处置结果（只算不改状态列）
 *
 * @param {object} host 宿主对象
 * @param {object} item 行数据
 * @param {string} primId 图元 id（可能不存在）
 * @returns {Promise<'成功'|'校验失败'|'失败'|'未找到'|'跳过'>} 新状态
 * @sideEffects eda API（经由 updateOne 写图元）
 */
async function resolveStatus(host, item, primId) {
	if (!primId) return '未找到';
	if (!item.rawModel || item.rawModel.trim() === '') return '跳过';
	return await updateOne(host, item, primId);
}

/**
 * 批量更新
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM、宿主 toast
 */
async function batchUpdate() {
	const host = getEda();
	if (!host) return;

	const startTime = performance.now();
	btnUpdate.disabled = true;
	btnLoad.disabled = true;
	btnUnit.disabled = true;
	progressBg.style.width = '0%';
	statusText.textContent = '正在获取PCB器件...';

	try {
		const pcbMap = buildPcbMap(await host.pcb_PrimitiveComponent.getAll());
		const total = appState.data.length;
		let successCount = 0;

		for (let i = 0; i < total; i++) {
			const item = appState.data[i];
			item.status = await resolveStatus(host, item, pcbMap[item.designator]);
			if (item.status === '成功') successCount++;

			const percent = Math.round(((i + 1) / total) * 100);
			progressBg.style.width = percent + '%';
			statusText.textContent = `进度：${i + 1} / ${total} (${percent}%)，正在处理: ${item.designator}`;
			renderTable();
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		const costTime = ((performance.now() - startTime) / 1000).toFixed(2);
		statusText.textContent = `更新完成: 成功 ${successCount}/${total} | 耗时：${costTime}秒`;
		toast('批量更新完成', 'success');
	} catch (error) {
		statusText.textContent = '更新异常中断';
		toast('发生未预期错误', 'error');
	} finally {
		btnUpdate.disabled = false;
		btnLoad.disabled = false;
		btnUnit.disabled = false;
	}
}

/**
 * 供内联 onchange 调用的输入处理（**显式对外暴露的唯一函数**）
 *
 * @param {string} id 位号
 * @param {string} field 字段名
 * @param {string|number} value 输入值（界面单位）
 * @returns {void}
 * @sideEffects 修改行数据；状态列由调用方随后重绘
 */
window.updateParam = function updateParam(id, field, value) {
	const item = appState.data.find((row) => row.id === id);
	if (!item) return;
	applyInput(item, field, value, appState.unit);
};

document.getElementById('btn-get-current').addEventListener('click', loadFromCurrent);
btnLoad.addEventListener('click', loadFromFile);
btnUnit.addEventListener('click', toggleUnit);
btnUpdate.addEventListener('click', batchUpdate);

document.querySelectorAll('th[data-sort]').forEach((th) => {
	th.addEventListener('click', () => {
		const col = th.getAttribute('data-sort');
		if (!col) return;
		if (appState.sortCol === col) appState.sortAsc = !appState.sortAsc;
		else {
			appState.sortCol = col;
			appState.sortAsc = true;
		}
		renderTable();
	});
});
