/**
 * @//module/ app/pcb-to-sch/index
 * @//description/ 页面入口：解包工程 → 解析 PCB → 查符号 → 构建原理图源码 → 预览表格 → 写入/导出（无导出）
 * @//exports/ 无
 * @//dependencies/ core/version, core/log, core/util, ui/statusBar, ui/progressTicker, ui/download, ui/toast, ui/rewardPrompt, app/pcb-to-sch/model, app/pcb-to-sch/symbolParser, app/pcb-to-sch/sourceBuilder
 * @//example/ 由 iframe/PcbToSch.html 加载（依赖同页的 jszip.min.js 提供全局 JSZip）
 *
 * 写入门禁（2026-10 实测）：`documentType !== 1`（非原理图页）时写入会被系统拦成「格式错误」，
 * 且 V4 的 `setDocumentSource` 可能**返回 true 但器件没生成**（COMPONENT 缺 attrs），
 * 所以写完后必须真的数一遍 `sch_PrimitiveComponent.getAll()`。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { logger } from '../../core/log.js';
import { escapeHtml } from '../../core/util.js';
import { classifyVersionSupport, getEditorVersion, isV2 } from '../../core/version.js';
import { downloadText } from '../../ui/download.js';
import { createProgressTicker } from '../../ui/progressTicker.js';
import { recordUsage } from '../../ui/rewardPrompt.js';
import { createStatusBar } from '../../ui/statusBar.js';
import { toast } from '../../ui/toast.js';
import { enrichWithSymbol, findUuids, mergeComponentsForDisplay, parsePcbContent, pcbFilePath, projectTitleOf, symbolFilePath } from './model.js';
import { buildSchSource } from './sourceBuilder.js';
import { parseSymbolSource } from './symbolParser.js';

// ---------- 状态 ----------
let zip = null;
let projectJson = null;
let components = [];
let mergedRows = [];
let version = '';
let candidateSource = '';
let currentPcbUuid = '';
let symbolPinsDatabase = {};
let currentSchematicUuid = null;

// ---------- DOM ----------
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const versionSpan = document.getElementById('versionDisplay');
const yvalueCheck = document.getElementById('yvalue');
const refreshBtn = document.getElementById('refreshListBtn');
const tableRows = document.getElementById('tableRows');
const buildBtn = document.getElementById('buildBtn');
const writeBtn = document.getElementById('writeBtn');
const genTitleCheck = document.getElementById('genTitle');
const genWireCheck = document.getElementById('genWire');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const errorsCheck = document.getElementById('errors');
const outfile = document.getElementById('outfile');
const exportNetBtn = document.getElementById('exportNetBtn');

const statusBar = createStatusBar({
	textEl: progressText,
	barEl: progressFill,
	baseClass: 'status-text',
	barBaseClass: 'progress-bg',
});

/**
 * 更新进度条
 *
 * @param {number} percent 0~100
 * @param {string} text 状态文字
 * @returns {void}
 * @sideEffects DOM
 */
function updateProgress(percent, text) {
	statusBar.width(percent, '');
	statusBar.text(text);
}

/** 等一会儿，让进度条能画出来 */
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 版本提示的三档文案与配色
 *
 * 适配区间是 2.2.45 ~ 4.*.*（下限改用具体版本号：2.2.45 之前缺本工具依赖的 API）。
 */
const VERSION_HINTS = {
	supported: { text: '功能可用', color: '#8f8' },
	tooOld: { text: '建议更新EDA', color: '#fb8' },
	tooNew: { text: '暂未做适配', color: '#fb8' },
};

/** 版本检测：不在 EDA 环境时禁用全部按钮 */
function initVersion() {
	try {
		version = getEditorVersion();
		if (!version) throw new Error('未检测到 EDA 环境');
		const hint = VERSION_HINTS[classifyVersionSupport(version)];
		// 版本号解析不出来时只显示版本号，不硬贴一个「可用」
		versionSpan.textContent = hint ? `当前EDA版本：${version} ${hint.text}` : `当前EDA版本：${version}`;
		versionSpan.style.color = hint ? hint.color : '#ccc';
		// V2 的电气坐标向上为正，V3/V4 向下为正 → 默认翻转值不同
		yvalueCheck.checked = !isV2();
	} catch (e) {
		versionSpan.textContent = '当前不在EDA环境，当前版本不支持转换';
		versionSpan.style.color = '#f88';
		refreshBtn.disabled = true;
		buildBtn.disabled = true;
		writeBtn.disabled = true;
		exportCsvBtn.disabled = true;
		exportNetBtn.disabled = true;
	}
}

/** 时间戳（`YYYYMMDD_HHMMSS`），用于导出文件名 */
function stamp() {
	const now = new Date();
	const date = `${now.getFullYear()}${('0' + (now.getMonth() + 1)).slice(-2)}${('0' + now.getDate()).slice(-2)}`;
	const time = `${('0' + now.getHours()).slice(-2)}${('0' + now.getMinutes()).slice(-2)}${('0' + now.getSeconds()).slice(-2)}`;
	return `${date}_${time}`;
}

/**
 * 取当前选中的分类方式
 *
 * @returns {string} `ref` / `device` / `pkg` / `coord`
 * @sideEffects 无（读 DOM）
 */
function currentClassify() {
	const radio = document.querySelector('input[name="classify"]:checked');
	return radio ? radio.value : 'ref';
}

/** 读取当前原理图页 → 解包工程 → 解析 PCB → 渲染表格 */
async function onRefresh() {
	try {
		buildBtn.disabled = true;
		writeBtn.disabled = true;
		outfile.disabled = true;
		tableRows.innerHTML = '';
		const startTime = Date.now();

		updateProgress(5, '版本检测');
		await delay(100);

		updateProgress(7, '获取当前原理信息');
		const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		await delay(100);

		// 取工程包是最慢的一步，用「假进度」让用户看到在动
		updateProgress(10, '获取工程文件');
		const ticker = createProgressTicker({
			from: 10,
			to: 40,
			step: 1,
			intervalMs: 1000,
			onTick: (p) => updateProgress(p, `获取工程文件 (${p}%)`),
		});
		ticker.start();

		let epro;
		try {
			epro = await eda.sys_FileManager.getProjectFile('project', undefined, '.epro');
		} finally {
			ticker.stop();
		}

		updateProgress(45, '读取 project.json');
		zip = await JSZip.loadAsync(epro);
		projectJson = JSON.parse(await zip.file('project.json').async('string'));
		await delay(100);

		updateProgress(50, '查找对应的PCB');
		const uuids = findUuids(projectJson, curDoc.uuid);
		currentPcbUuid = projectJson.pcbs[uuids.pcbUuid];
		currentSchematicUuid = uuids.schematicUuid;
		await delay(100);

		updateProgress(55, '读取PCB文件');
		const pcbFile = zip.file(pcbFilePath(uuids.pcbUuid));
		if (!pcbFile) throw new Error(`在压缩包中未找到PCB文件: ${pcbFilePath(uuids.pcbUuid)}`);
		const pcbContent = await pcbFile.async('string');
		await delay(100);

		updateProgress(60, '解析PCB内容');
		components = parsePcbContent(pcbContent);
		await delay(100);

		updateProgress(80, '获取符号信息');
		enrichWithSymbol(components, projectJson);
		mergedRows = mergeComponentsForDisplay(components);
		renderTable(mergedRows);

		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
		updateProgress(100, `元件处理完成，耗时${elapsed}秒`);

		buildBtn.disabled = false;
		exportCsvBtn.disabled = false;
	} catch (error) {
		logger.error('刷新列表失败:', error);
		updateProgress(0, `错误: ${error.message}`);
	}
}

/** 渲染预览表格 */
function renderTable(rows) {
	tableRows.innerHTML = '';
	rows.forEach((group) => {
		const row = document.createElement('div');
		row.className = 'grid-row';
		row.setAttribute('data-group-key', group.key);
		row.innerHTML = `
					<div class="row-cell" title="${escapeHtml(group.designatorDisplay)}">${escapeHtml(group.designatorDisplay)}</div>
					<div class="row-cell" title="${escapeHtml(group.nameDisplay)}">${escapeHtml(group.nameDisplay)}</div>
					<div class="row-cell" title="${escapeHtml(group.footprintName)}">${escapeHtml(group.footprintName)}</div>
					<div class="row-cell" title="${escapeHtml(group.deviceName)}">${escapeHtml(group.deviceName)}</div>
					<div class="row-cell" title="${escapeHtml(group.symbolName)}">${escapeHtml(group.symbolName)}</div>
					<div class="row-cell"><input class="manual-input" type="text" placeholder="指定..." data-group-key="${group.key}" value=""></div>
				`;
		tableRows.appendChild(row);
	});
}

/**
 * 收集「手动指定符号」输入框
 *
 * @returns {Map<string, string>} 分组键 → 输入值
 * @sideEffects 无（读 DOM）
 */
function collectManualInputs() {
	const map = new Map();
	document.querySelectorAll('.manual-input').forEach((input) => {
		const groupKey = input.getAttribute('data-group-key');
		if (groupKey) map.set(groupKey, input.value.trim());
	});
	return map;
}

/** 关键词 → Symbol UUID（用户直接输入中文名时的快捷映射） */
const KEYWORD_TO_SYMBOL = {
	无极电容: '801c26e6ac62427db41c6496435118b6',
	电阻: '9c1d6a5e19e649e888ff79bf9e87b823',
	电感: '3f193864f7264a439d7adc22fdbb5dbf',
};

/**
 * 按标题在工程符号库里找 uuid
 *
 * @param {string} title 符号标题
 * @returns {string|null} uuid
 * @sideEffects 无（纯查询）
 */
function findSymbolUuidByTitle(title) {
	const symbols = (projectJson && projectJson.symbols) || {};
	for (const entry of Object.entries(symbols)) {
		if (entry[1].title === title) return entry[0];
	}
	return null;
}

/**
 * 应用「手动指定符号」：按分组键把组内所有器件改成指定符号（就地修改）
 *
 * @param {Map<string, string>} manualMap 分组键 → 输入值
 * @returns {void}
 * @sideEffects 修改 `components` 的 `symbolUuid` / `symbolName`
 */
function applyManualSymbols(manualMap) {
	for (const [groupKey, inputValue] of manualMap.entries()) {
		if (!inputValue) continue;
		const targetUuid = KEYWORD_TO_SYMBOL[inputValue] || findSymbolUuidByTitle(inputValue);
		if (!targetUuid) continue;

		const group = mergedRows.find((row) => row.key === groupKey);
		if (!group) continue;
		group.componentIndices.forEach((idx) => {
			if (!components[idx]) return;
			components[idx].symbolUuid = targetUuid;
			components[idx].symbolName = inputValue;
		});
	}
}

/**
 * 找出缺符号的行（返回分组的 key，用于标红）
 *
 * @returns {string[]} 分组键
 * @sideEffects 无（纯计算）
 */
function checkMissingSymbols() {
	const missing = new Set();
	components.forEach((comp, idx) => {
		if (comp.symbolUuid) return;
		const group = mergedRows.find((row) => row.componentIndices.includes(idx));
		if (group) missing.add(group.key);
	});
	return Array.from(missing);
}

/**
 * 读符号文件，填充 `symbolPinsDatabase` 并给每个器件标 `partCount`
 *
 * @param {Array<object>} compList 器件列表
 * @returns {Promise<void>}
 * @sideEffects 读 zip、写模块状态
 */
async function enrichPartCounts(compList) {
	symbolPinsDatabase = {};

	for (const comp of compList) {
		if (!comp.symbolUuid) {
			comp.partCount = 1;
			continue;
		}
		if (symbolPinsDatabase[comp.symbolUuid]) {
			comp.partCount = symbolPinsDatabase[comp.symbolUuid].length;
			continue;
		}

		const file = zip.file(symbolFilePath(comp.symbolUuid));
		if (!file) {
			// 符号文件缺失：放一个占位，让排布仍能进行（包围盒走默认值）
			logger.warn(`符号文件不存在: ${symbolFilePath(comp.symbolUuid)}`);
			symbolPinsDatabase[comp.symbolUuid] = [{ pinBbox: null, pins: {} }];
			comp.partCount = 1;
			continue;
		}

		const parts = parseSymbolSource(await file.async('string'));
		symbolPinsDatabase[comp.symbolUuid] = parts;
		comp.partCount = parts.length;
	}
}

/** 构建源码 */
async function onBuild() {
	const yvalue = yvalueCheck.checked;
	const classify = currentClassify();
	const ignoreMissing = errorsCheck.checked;

	try {
		document.querySelectorAll('.grid-row').forEach((row) => row.classList.remove('row-error'));
		const startTime = Date.now();

		if (components && projectJson) enrichWithSymbol(components, projectJson);

		updateProgress(5, '获取指定符号');
		applyManualSymbols(collectManualInputs());
		await delay(100);

		updateProgress(10, '检测符号是否存在');
		const missingSymbols = checkMissingSymbols();
		if (missingSymbols.length > 0) {
			missingSymbols.forEach((groupKey) => {
				const rowElement = document.querySelector(`[data-group-key="${groupKey}"]`);
				if (rowElement) rowElement.classList.add('row-error');
			});
			if (!ignoreMissing) {
				throw new Error('部分元件没有符号！！！解决方法：可忽略错误 或者 在EDA器件标准化面板替换器件');
			}
			logger.debug(`忽略 ${missingSymbols.length} 组缺失符号的元件，它们将不会出现在生成的源码中`);
			updateProgress(10, `忽略 ${missingSymbols.length} 组缺失符号元件`);
		}
		await delay(100);

		// 勾了「忽略符号错误」时，没有符号的器件直接不写进源码
		const componentsToBuild = ignoreMissing ? components.filter((comp) => comp.symbolUuid && comp.symbolUuid.trim() !== '') : components;

		updateProgress(20, '检测多部件符号中');
		await enrichPartCounts(componentsToBuild);
		await delay(100);

		updateProgress(40, '构建源码');
		candidateSource = buildSchSource({
			components: componentsToBuild,
			symbolDb: symbolPinsDatabase,
			format: isV2() ? 'v2' : 'modern',
			options: {
				classify: classify,
				// 只有一个「生成标题」复选框：既决定组标题，也决定是否画框线（原实现两个变量指向同一元素）
				genFrame: genTitleCheck.checked,
				genWire: genWireCheck.checked,
				yvalue: yvalue,
				startX: 200,
				startY: -200,
				colSpacing: 150,
				rowSpacing: 150,
				perRow: 20,
				wireLength: 40,
			},
		});
		await delay(100);

		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
		const lineCount = candidateSource ? candidateSource.split('\n').length : 0;
		updateProgress(100, `构建源码完成，耗时${elapsed}秒，生成了 ${lineCount} 行源码`);

		writeBtn.disabled = false;
		outfile.disabled = false;
		exportNetBtn.disabled = false;
	} catch (error) {
		logger.error('构建源码失败:', error);
		updateProgress(0, `错误: ${error.message}`);
	}
}

/** 写入当前原理图文档 */
async function onWrite() {
	try {
		if (!candidateSource) throw new Error('没有可写入的源码，请先构建');

		const startTime = Date.now();
		updateProgress(90, '正在写入文档...');

		// 写入门禁：PCB 与原理图的源码格式不同，写进错误文档会被系统拦成「格式错误」
		// documentType：1 = 原理图页。这个 iframe 是浮窗，用户可能在生成期间切到别的文档。
		const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		if (!curDoc || curDoc.documentType !== 1) {
			updateProgress(0, '请先切换到原理图页再写入');
			toast('请先切换到原理图页再写入', 'warning');
			return;
		}

		const isSuccess = await eda.sys_FileManager.setDocumentSource(candidateSource);
		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

		// 写入自检：V4 有可能「返回 true 但器件没生成」，必须真的数一遍
		let placedCount = 0;
		try {
			const comps = await eda.sch_PrimitiveComponent.getAll();
			placedCount = Array.isArray(comps) ? comps.length : 0;
		} catch (e) {
			logger.warn('写入后清点器件失败（可忽略）', e);
		}
		logger.debug(`[Debug] 写入返回 ${isSuccess}，当前原理图器件数 ${placedCount}`);

		if (isSuccess && placedCount > 0) {
			updateProgress(100, `写入成功！耗时${elapsed}秒，器件 ${placedCount} 个`);
			toast('写入成功', 'success');

			// 写入文档成功 → 记一次使用（内部吞掉异常，不影响写入结果）
			await recordUsage();
		} else if (isSuccess) {
			updateProgress(100, `源码已写入，但没有生成任何器件（耗时${elapsed}秒）`);
			toast('源码已写入，但器件没有生成：原理图页可能有旧内容，建议新建一个空白原理图页后重新写入', 'error');
		} else {
			updateProgress(100, `写入失败！耗时${elapsed}秒`);
			toast('写入失败', 'error');
		}
	} catch (error) {
		logger.error('写入失败:', error);
		updateProgress(0, `错误: ${error.message}`);
	}
}

/** 导出预览表格为 CSV（直接读 DOM，所以导出的就是用户看到的） */
function onExportCsv() {
	if (!projectJson || !currentPcbUuid) {
		toast('请先刷新列表', 'warning');
		updateProgress(0, '请先加载数据');
		return;
	}

	const headers = Array.from(document.querySelectorAll('.table-header .header-cell')).map((cell) => cell.innerText.trim());
	const rows = [];
	document.querySelectorAll('.grid-row').forEach((row) => {
		const cells = row.querySelectorAll('.row-cell');
		const rowData = [];
		cells.forEach((cell, index) => {
			if (index === cells.length - 1) {
				const input = cell.querySelector('input');
				rowData.push(input ? input.value : '');
			} else {
				rowData.push(cell.innerText.trim());
			}
		});
		rows.push(rowData);
	});

	const csv = [headers, ...rows].map((line) => line.map(csvCell).join(',')).join('\n') + '\n';
	const filename = `${currentPcbUuid}_${stamp()}.csv`;
	updateProgress(100, `导出成功：${filename}`);
	downloadText(filename, csv, { mime: 'text/csv', bom: true });
}

/**
 * CSV 单元格转义（含逗号或引号时整体加引号，内部引号翻倍）
 *
 * @param {*} cell 单元格
 * @returns {string} 转义结果
 * @sideEffects 无（纯函数）
 */
function csvCell(cell) {
	const text = String(cell === null || cell === undefined ? '' : cell);
	if (text.includes(',') || text.includes('"') || text.includes('\n')) return `"${text.replace(/"/g, '""')}"`;
	return text;
}

/** 导出「唯一ID,位号,引脚编号,引脚名称,引脚网络」清单 */
function onExportNet() {
	if (!components || components.length === 0) {
		updateProgress(0, '请先加载数据并构建源码');
		return;
	}
	if (Object.keys(symbolPinsDatabase).length === 0) {
		updateProgress(0, '请先构建源码以获取引脚信息');
		return;
	}

	const lines = ['唯一ID,位号,引脚编号,引脚名称,引脚网络'];

	for (const comp of components) lines.push(...netLinesOf(comp));

	const filename = `${currentPcbUuid || 'netlist'}_${stamp()}_netlist.csv`;
	updateProgress(100, `导出网络成功：${filename}`);
	downloadText(filename, lines.join('\n'), { mime: 'text/csv', bom: true });
}

/**
 * 单个器件的网表行（每个有引脚号的引脚一行）
 *
 * @param {object} comp 器件
 * @returns {string[]} CSV 行
 * @sideEffects 无（纯函数）
 */
function netLinesOf(comp) {
	const lines = [];
	const symbolParts = symbolPinsDatabase[comp.symbolUuid] || [];
	for (const entry of Object.entries(comp.pins || {})) {
		const pinNumber = entry[0];
		if (!pinNumber) continue;
		const pinName = pinNameOf(symbolParts, pinNumber);
		lines.push([comp.uniqueId || '', comp.designator || '', pinNumber, pinName, entry[1] || ''].map(csvCell).join(','));
	}
	return lines;
}

/**
 * 在所有部件里找某个引脚号的引脚名称
 *
 * @param {Array<object>} symbolParts 符号的部件数组
 * @param {string} pinNumber 引脚号
 * @returns {string} 引脚名（找不到为空串）
 * @sideEffects 无（纯函数）
 */
function pinNameOf(symbolParts, pinNumber) {
	for (const part of symbolParts) {
		const pin = (part.pins || {})[pinNumber];
		if (pin && pin.name) return pin.name;
	}
	return '';
}

/** 把源码写回工程包并另存为 `.epro` */
async function onExportProject() {
	if (!zip || !currentSchematicUuid) {
		updateProgress(0, '请先刷新加载数据');
		return;
	}
	if (!candidateSource) {
		updateProgress(0, '没有可导出的源码，请先构建');
		return;
	}

	try {
		updateProgress(30, '准备导出文件...');
		zip.file(`SHEET/${currentSchematicUuid}/1.esch`, candidateSource);

		updateProgress(60, '正在生成工程文件...');
		const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

		const fileName = projectTitleOf(projectJson);
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = fileName;
		link.click();
		URL.revokeObjectURL(link.href);

		updateProgress(100, `导出成功：${fileName}`);
		toast('文件已导出', 'success');

		// 导出文件成功 → 记一次使用（内部吞掉异常，不影响导出结果）
		await recordUsage();
	} catch (error) {
		logger.error('导出失败:', error);
		updateProgress(0, `导出错误: ${error.message}`);
	}
}

initVersion();
refreshBtn.addEventListener('click', onRefresh);
exportCsvBtn.addEventListener('click', onExportCsv);
exportNetBtn.addEventListener('click', onExportNet);
buildBtn.addEventListener('click', onBuild);
writeBtn.addEventListener('click', onWrite);
outfile.addEventListener('click', onExportProject);
