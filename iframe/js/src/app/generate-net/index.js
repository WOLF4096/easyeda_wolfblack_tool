/**
 * @//module/ app/generate-net/index
 * @//description/ 页面入口：计算铜箔拓扑 → 生成待改网络 → 按「网表 / 源码 / API」三种方式写回（无导出）
 * @//exports/ 无
 * @//dependencies/ core/version, core/log, core/netlist, ui/statusBar, app/generate-net/padReader, app/generate-net/sourceParser, app/generate-net/connectivity, app/generate-net/plan, app/generate-net/sourceRewrite, app/generate-net/apiWriter
 * @//example/ 由 iframe/GenerateNet.html 加载
 *
 * 三种写入方式的取舍（都在实机上验证过）：
 *   - `netlist` 最快也最安全（只改网表，不动文档源码）；
 *   - `source`  最完整（连图元网络一起改），但会整份重写文档源码；
 *   - `api`     逐图元调 API，焊盘改不了，只作兜底。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getComponentsContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { getEditorVersion, isModern, isV2 } from '../../core/version.js';
import { createStatusBar } from '../../ui/statusBar.js';
import { writeNetByApi } from './apiWriter.js';
import { computeClusters } from './connectivity.js';
import { readAllPads } from './padReader.js';
import { applyPinUpdates, planNetlistOperations, planPrimitiveOperations } from './plan.js';
import { parseV2Primitives, parseV3Primitives } from './sourceParser.js';
import { createLineRewriter } from './sourceRewrite.js';

// ---------- 状态 ----------
let g_pendingOperations = [];
let g_isAnalyzing = false;
let g_isExecuting = false;
let g_currentMethod = 'netlist';
let g_netlistOps = [];
let g_sourceOps = [];
let loadingTimeout = null;
let netlistData = null;
let rawSource = null;
let writeTimer = null;

const statusBar = createStatusBar({
	textEl: document.getElementById('status-left'),
	barEl: document.getElementById('progress-bar'),
	// #status-left 没有类名；#progress-bar 的 `gn-progress-fill` 必须保住（createStatusBar 会覆写 className）
	baseClass: '',
	barBaseClass: 'gn-progress-fill',
});

/** 写右侧的计数（`3 / 20`） */
function setRightText(text) {
	const rightTxt = document.getElementById('status-right');
	if (rightTxt) rightTxt.innerText = text;
}

/**
 * 更新底部状态栏
 *
 * @param {number} current 已完成
 * @param {number} total 总数（0 表示复位）
 * @param {string|null} [message=null] 自定义文案
 * @returns {void}
 * @sideEffects DOM
 */
function updateFooterStatus(current, total, message = null) {
	if (total === 0) {
		statusBar.width(0, '');
		statusBar.text(message || '就绪');
		setRightText('-- / --');
		return;
	}

	const percentage = Math.min(100, Math.round((current / total) * 100));
	statusBar.width(percentage, '');

	if (current === 0) statusBar.text(message || `发现 ${total} 个待更新项`);
	else if (current === total) statusBar.text(message || '执行完毕');
	else statusBar.text(message || `执行中 ${percentage}%`);

	setRightText(`${current} / ${total}`);
}

/** 让出一次主线程，容器才有机会重绘进度条 */
function yieldToUi() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 刷新按钮可用状态 */
function updateButtonState() {
	const execBtn = document.getElementById('btn-execute');
	const refreshBtn = document.getElementById('btn-refresh');
	if (!execBtn || !refreshBtn) return;

	execBtn.disabled = g_isAnalyzing || g_isExecuting || g_pendingOperations.length === 0;
	refreshBtn.disabled = g_isAnalyzing || g_isExecuting;
}

/**
 * 显示/隐藏遮罩
 *
 * @param {boolean} isLoading 是否显示
 * @param {string} [text] 文案
 * @returns {void}
 * @sideEffects DOM + 定时器
 */
function setLoading(isLoading, text) {
	const mask = document.getElementById('loading-mask');
	const loadText = document.getElementById('loading-text');

	if (loadingTimeout) {
		clearTimeout(loadingTimeout);
		loadingTimeout = null;
	}

	if (!isLoading) {
		mask.style.display = 'none';
		updateButtonState();
		return;
	}

	mask.style.display = 'flex';
	loadText.innerText = text;
	document.getElementById('btn-execute').disabled = true;
	document.getElementById('btn-refresh').disabled = true;

	// 分析大板可能真的要很久，20 秒后给一句提示，避免用户以为卡死
	if (text === '分析物理拓扑中…') {
		loadingTimeout = setTimeout(() => {
			if (mask.style.display === 'flex' && loadText.innerText === '分析物理拓扑中…') {
				loadText.innerText = '计算时间比以往要久，建议重新打开工程重试';
			}
			loadingTimeout = null;
		}, 20000);
	}
}

/** 启动「写入中」的假进度（80% → 99%） */
function startWriteProgress() {
	if (writeTimer) clearInterval(writeTimer);
	let progress = 80;
	writeTimer = setInterval(() => {
		if (progress >= 99) return;
		progress += 1;
		statusBar.width(progress, '');
		statusBar.text(`写入中 ${progress}%`);
	}, 1000);
}

/**
 * 停止假进度
 *
 * @param {boolean} success 成功写 100%，失败写 0%
 * @returns {void}
 * @sideEffects 清除定时器 + DOM
 */
function stopWriteProgress(success = true) {
	if (writeTimer) {
		clearInterval(writeTimer);
		writeTimer = null;
	}
	statusBar.width(success ? 100 : 0, '');
	statusBar.text(success ? '写入完成' : '写入失败');
}

/** 当前方法对应的操作列表 */
function currentOps() {
	return g_currentMethod === 'netlist' ? g_netlistOps : g_sourceOps;
}

/** 重绘表格（方法切换时用） */
function rerenderTable() {
	renderTable(currentOps());
}

/**
 * 渲染结果表
 *
 * @param {Array<object>} ops 操作列表
 * @returns {void}
 * @sideEffects DOM + 全局状态
 */
function renderTable(ops) {
	const container = document.getElementById('result-list');
	const header = document.getElementById('grid-header');
	g_currentMethod = document.getElementById('method-select').value;

	header.innerHTML =
		g_currentMethod === 'netlist'
			? '<div>位号</div><div>编号</div><div>旧网络</div><div>新网络</div><div>状态</div>'
			: '<div>图元ID</div><div>类型</div><div>旧网络</div><div>新网络</div><div>状态</div>';

	container.innerHTML = '';
	if (!ops || ops.length === 0) {
		container.innerHTML = `
				<div class="empty-state">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
						<polyline points="22 4 12 14.01 9 11.01"></polyline>
					</svg>
					<div>请点击“计算拓扑”按钮生成待更新项</div>
				</div>`;
		g_pendingOperations = [];
		updateFooterStatus(0, 0);
		updateButtonState();
		return;
	}

	g_pendingOperations = ops;

	ops.forEach((op, index) => {
		const row = document.createElement('div');
		row.className = 'row-item grid-row-layout';
		row.id = `row-${index}`;
		row.innerHTML = rowHtml(g_currentMethod, op, index);
		container.appendChild(row);
	});

	updateFooterStatus(0, ops.length);
	updateButtonState();
}

/**
 * 单行 HTML
 *
 * @param {string} method 当前方法
 * @param {object} op 操作
 * @param {number} index 行号
 * @returns {string} HTML
 * @sideEffects 无（纯函数）
 */
function rowHtml(method, op, index) {
	const firstCells =
		method === 'netlist'
			? `<div class="cell-truncate" title="${op.des}">${op.des}</div>
					<div class="cell-truncate">${op.pin}</div>`
			: `<div class="cell-truncate" title="${op.id}">${op.id}</div>
					<div class="cell-truncate">${op.type}</div>`;

	return `${firstCells}
					<div class="cell-truncate" title="${op.oldNet}">${op.oldNet}</div>
					<div class="cell-truncate new-net" title="${op.newNet}">${op.newNet}</div>
					<div><span class="st-pending" id="status-${index}">待处理</span></div>`;
}

/**
 * 把表格里前 n 行标成完成
 *
 * @param {number} total 行数
 * @returns {void}
 * @sideEffects DOM
 */
function markAllDone(total) {
	for (let i = 0; i < total; i++) {
		const span = document.getElementById(`status-${i}`);
		if (span) {
			span.innerText = '完成';
			span.className = 'st-done';
		}
		const rowDiv = document.getElementById(`row-${i}`);
		if (rowDiv) rowDiv.classList.add('active');
	}
}

/** 取当前 PCB 源码 */
async function readSource() {
	rawSource = await eda.sys_FileManager.getDocumentSource();
	return rawSource;
}

/**
 * 解析源码并求连通分量
 *
 * @returns {Promise<{clusters: object, allUsedNetNames: Set<string>}>} 分析结果
 * @sideEffects 读画布焊盘与源码
 */
async function analyzePcb() {
	const allPads = await readAllPads(eda);
	const allUsedNetNames = new Set();
	for (const p of allPads) if (p.net) allUsedNetNames.add(p.net);

	const padIdToPinInfo = {};
	const lines = rawSource.split('\n');
	const parseResult = isModern()
		? parseV3Primitives(lines, { allUsedNetNames: allUsedNetNames, padIdToPinInfo: padIdToPinInfo })
		: parseV2Primitives(lines, { allUsedNetNames: allUsedNetNames, padIdToPinInfo: padIdToPinInfo });

	const clusters = computeClusters(parseResult.primitives, allPads, parseResult.innerLayerIds, padIdToPinInfo);
	return { clusters: clusters, allUsedNetNames: allUsedNetNames };
}

/** 计算拓扑，生成待执行操作 */
async function computeTopology() {
	if (g_isExecuting || g_isAnalyzing) return;
	g_isAnalyzing = true;
	setLoading(true, '分析物理拓扑中…');

	const method = document.getElementById('method-select').value;

	try {
		g_netlistOps = [];
		g_sourceOps = [];

		updateFooterStatus(0, 0, '获取版本号');
		getEditorVersion();

		updateFooterStatus(0, 0, '获取源码');
		await readSource();

		if (method === 'netlist') {
			updateFooterStatus(0, 0, '获取网表');
			netlistData = await fetchNetlist();
			const { clusters, allUsedNetNames } = await analyzePcb();
			const container = getComponentsContainer(netlistData || {});
			g_netlistOps = planNetlistOperations(clusters, allUsedNetNames, container);
		} else {
			// source 与 api 共用同一套分析结果
			const { clusters, allUsedNetNames } = await analyzePcb();
			g_sourceOps = planPrimitiveOperations(clusters, allUsedNetNames);
		}
	} catch (e) {
		console.error(e);
	}

	rerenderTable();
	setLoading(false);
	g_isAnalyzing = false;
	updateButtonState();
}

/**
 * 取网表（失败只记日志，返回 null）
 *
 * @returns {Promise<object|null>} 网表对象
 * @sideEffects 读网表文件
 */
async function fetchNetlist() {
	try {
		updateFooterStatus(0, 0, '获取网表');
		return (await getNetlist('PCB')).json;
	} catch (e) {
		console.error('获取网表失败', e);
		return null;
	}
}

/**
 * 方式一：写网表
 *
 * @param {number} total 操作数
 * @param {number} startTime 起点时间
 * @returns {Promise<void>}
 * @sideEffects 改网表文件 + DOM
 */
async function writeNetlist(total, startTime) {
	setLoading(true, '正在写入网表...');

	const netlistJson = typeof netlistData === 'string' ? JSON.parse(netlistData) : netlistData;
	const compSource = getComponentsContainer(netlistJson);

	const pinUpdatesByDesignator = new Map();
	for (const op of g_pendingOperations) {
		if (!pinUpdatesByDesignator.has(op.des)) pinUpdatesByDesignator.set(op.des, {});
		pinUpdatesByDesignator.get(op.des)[op.pin] = op.newNet;
	}

	applyPinUpdates(compSource, pinUpdatesByDesignator);
	markAllDone(total);
	statusBar.width(80, '');
	statusBar.text('修改完成');
	setRightText(`${total} / ${total}`);

	startWriteProgress();
	const duration = ((Date.now() - startTime) / 1000).toFixed(2);
	const startTimeApi = Date.now();

	await setNetlist('PCB', JSON.stringify(netlistJson));

	stopWriteProgress(true);
	const durationApi = ((Date.now() - startTimeApi) / 1000).toFixed(2);
	updateFooterStatus(total, total, `写入完成，修改耗时 ${duration} 秒，写入耗时 ${durationApi} 秒`);
}

/**
 * 方式二：改源码（逐行改写，每 10% 让出一次主线程）
 *
 * @param {number} total 操作数
 * @param {number} startTime 起点时间
 * @returns {Promise<void>}
 * @sideEffects 改文档源码 + DOM
 */
async function writeSource(total, startTime) {
	setLoading(true, '正在修改源码...');

	const netMap = new Map();
	for (const op of g_pendingOperations) netMap.set(op.id, op.newNet);

	const rewrite = createLineRewriter(netMap, isV2());
	const lines = (rawSource || '').split('\n');
	const out = [];
	let modifiedCount = 0;
	let lastPercent = -1;

	for (const line of lines) {
		const result = rewrite(line);
		out.push(result.line);
		if (!result.changedId) continue;

		modifiedCount += 1;
		// 修改阶段占 0% → 80%，每跨过一个 10% 才动一次 DOM + 让出一次
		const currentPercent = (modifiedCount / total) * 80;
		const bucket = Math.floor(currentPercent / 10) * 10;
		if (bucket <= lastPercent) continue;

		lastPercent = bucket;
		const percentStr = currentPercent.toFixed(1);
		statusBar.width(Number(percentStr), '');
		statusBar.text(`修改中 ${percentStr}%`);
		setRightText(`${modifiedCount} / ${total}`);
		await yieldToUi();
	}

	statusBar.width(80, '');
	statusBar.text('修改完成，写入源码中...');

	setLoading(true, '正在写入源码...');
	startWriteProgress();
	const duration = ((Date.now() - startTime) / 1000).toFixed(2);
	const startTimeApi = Date.now();

	await eda.sys_FileManager.setDocumentSource(out.join('\n'));

	stopWriteProgress(true);
	const durationApi = ((Date.now() - startTimeApi) / 1000).toFixed(2);
	updateFooterStatus(total, total, `写入完成，修改耗时 ${duration}秒，写入耗时 ${durationApi}秒`);

	// 注意：`sys_Window.redraw` 在两版客户端上都不存在，别调
	markAllDone(total);
}

/**
 * 方式三：逐图元调 API（160 条一批让出主线程）
 *
 * @param {number} total 操作数
 * @param {number} startTime 起点时间
 * @returns {Promise<void>}
 * @sideEffects 改图元 + DOM
 */
async function writeByApi(total, startTime) {
	const BATCH_SIZE = 192;

	for (let i = 0; i < total; i++) {
		const op = g_pendingOperations[i];
		const success = await writeNetByApi(eda, op);
		markRowResult(i, success);

		const percent = (((i + 1) / total) * 100).toFixed(1);
		statusBar.width(Number(percent), '');
		statusBar.text(`修改中 ${percent}%`);
		setRightText(`${i + 1} / ${total}`);

		const rowDiv = document.getElementById(`row-${i}`);
		if (rowDiv) rowDiv.scrollIntoView({ block: 'center' });
		if (i > 0) {
			const prev = document.getElementById(`row-${i - 1}`);
			if (prev) prev.classList.remove('active');
		}

		if ((i + 1) % BATCH_SIZE === 0 && i + 1 < total) await yieldToUi();
	}

	const duration = ((Date.now() - startTime) / 1000).toFixed(2);
	updateFooterStatus(total, total, `API更新完成，耗时 ${duration}秒，修改焊盘API存在Bug，待官方修复后启用`);
}

/**
 * 单行结果
 *
 * @param {number} index 行号
 * @param {boolean} success 是否成功
 * @returns {void}
 * @sideEffects DOM
 */
function markRowResult(index, success) {
	const span = document.getElementById(`status-${index}`);
	const rowDiv = document.getElementById(`row-${index}`);
	if (span) {
		span.innerText = success ? '完成' : '错误';
		span.className = success ? 'st-done' : 'st-err';
	}
	if (rowDiv) rowDiv.classList.add('active');
}

/** 执行写入（按当前方法分派） */
async function writeChanges() {
	if (g_isAnalyzing || g_pendingOperations.length === 0 || g_isExecuting) return;

	g_isExecuting = true;
	updateButtonState();

	const total = g_pendingOperations.length;
	const startTime = Date.now();

	try {
		if (g_currentMethod === 'netlist') await writeNetlist(total, startTime);
		else if (g_currentMethod === 'source') await writeSource(total, startTime);
		else await writeByApi(total, startTime);
	} catch (e) {
		console.error(e);
		stopWriteProgress(false);
		updateFooterStatus(0, total, `${g_currentMethod === 'api' ? 'API' : '源码'}写入失败`);
	} finally {
		setLoading(false);
	}

	g_isExecuting = false;
	updateButtonState();
	const lastRow = document.getElementById(`row-${total - 1}`);
	if (lastRow) lastRow.classList.remove('active');
}

window.onload = async function () {
	document.getElementById('btn-refresh').addEventListener('click', computeTopology);
	document.getElementById('btn-execute').addEventListener('click', writeChanges);
	document.getElementById('method-select').addEventListener('change', () => {
		const method = document.getElementById('method-select').value;
		const warningSpan = document.getElementById('api-warning');
		warningSpan.style.display = method === 'api' ? 'inline' : 'none';

		g_netlistOps = [];
		g_sourceOps = [];
		g_pendingOperations = [];
		renderTable([]);
		updateFooterStatus(0, 0);
		updateButtonState();
	});

	renderTable([]);
};
