/**
 * @//module/ app/replace-component/index
 * @//description/ 批量替换器件页面入口：读画布 → 取库器件 → 改源码 → 同步 3D/网表（加载即绑定事件，无导出）
 * @//exports/ 无
 * @//dependencies/ core/eda, core/netlist, core/version, core/log, core/concurrency, core/util, ui/statusBar, ui/table, app/replace-component/componentReader, app/replace-component/pastePlan, app/replace-component/sourceRewrite, app/replace-component/netlistSync
 * @//example/ 由 iframe/ReplaceComponent.html 以 <script src="/iframe/js/app/ReplaceComponent.js"></script> 加载
 *
 * ⚠️ 三条平台约束（来自 V2.2 / V4 实测，改顺序会写坏用户文档）：
 *   1. **先写源码、后删临时器件** —— V4 删临时器件会连带销毁器件定义，
 *      顺序反了会让源码里的 DeviceName 指向不存在的 uuid；
 *   2. V4 只改 ATTR `Device` 换不掉器件，必须同时改 COMPONENT 行 `attrs.DeviceName`；
 *   3. 写回失败也必须清理临时器件，否则 (-10000,-10000) 会堆垃圾。
 */

import { hasEda } from '../../core/eda.js';
import { getNetlist, setNetlist, getComponentsContainer } from '../../core/netlist.js';
import { isModern } from '../../core/version.js';
import { logger } from '../../core/log.js';
import { naturalCompare } from '../../core/util.js';
import { mapInChunks, DEFAULT_CHUNK_SIZE } from '../../core/concurrency.js';
import { createStatusBar } from '../../ui/statusBar.js';
import { nextSortState, sortIndicatorOf, sortRows, selectionSummary } from '../../ui/table.js';
import {
	buildGroupKey,
	enrichComponentData,
	extractProps,
	getDeviceNameJson,
	getDeviceUuid,
	getFootprintName,
	getFootprintUuid,
	pickDevice,
	pickPrimitiveId,
	resolveDynamicString,
} from './componentReader.js';
import { applyTargetSupplierIds, flattenGroups, parseClipboard, regroupGroups } from './pastePlan.js';
import { rewriteSource } from './sourceRewrite.js';
import { applyTargetProps } from './netlistSync.js';

/** 临时器件投放点（画布外，用户看不见） */
const TEMP_X = -10000;
const TEMP_Y = -10000;

/** 分组数据（页面级状态） */
let groupedData = [];

/**
 * 为「读属性」而临时放到 (-10000,-10000) 的器件 ID
 * @type {string[]}
 */
let pendingTempIds = [];

/** 排序状态 */
const sortState = { key: null, asc: true };

/** 阶段 2 的轮询定时器 */
let fetchPollInterval = null;

/** 轮询重入锁：宿主慢时防止两轮叠在一起 */
let pollBusy = false;

/** 各列的取值器（代替原来的 switch，新增列只需加一行） */
const SORT_VALUE = {
	designator: (group) => group.designators[0] || '',
	name: (group) => group.target.name || group.original.name || '',
	footprint: (group) => group.target.footprint || group.original.footprint || '',
	supplierId: (group) => group.target.supplierId || group.original.supplierId || '',
};

// 注意：必须显式传 baseClass / barBaseClass —— createStatusBar 会覆写 className，
// 用默认的 'status' 会把 #statusText 上的 `status-text` 抹掉，样式直接失效。
const statusBar = createStatusBar({
	textEl: document.getElementById('statusText'),
	barEl: document.getElementById('progressBg'),
	baseClass: 'status-text',
	barBaseClass: 'progress-bg',
});

const status = {
	reset: () => {
		statusBar.reset();
		statusBar.text('准备就绪，待粘贴数据，格式：位号|C编号（必须从Excel复制粘贴）');
	},
	readyToReplace: (costTime) => {
		statusBar.width(0, '');
		statusBar.text(costTime ? `获取数据完成，耗时${costTime}秒，待替换` : '获取数据完成，待替换');
	},
	setProgress: (current, total, supplierId) => {
		const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
		statusBar.text(`器件总数：${current} / ${total} ${percent}%，当前获取：${supplierId}`);
		statusBar.width(percent, '');
	},
};

/**
 * 取某列参与排序的值
 *
 * @param {object} row 分组行
 * @param {string} key 列名
 * @returns {string} 取值（缺失为空串）
 * @sideEffects 无（纯函数）
 */
function sortValueOf(row, key) {
	return SORT_VALUE[key] ? SORT_VALUE[key](row) : '';
}

/**
 * 普通字符串比较（与原实现一致：不做本地化、不识别数字）
 *
 * 只有位号列用自然排序（`C2` 在 `C10` 前），其余列保持原始比较口径，
 * 避免重构顺手改了用户的排序习惯。
 *
 * @param {string} a 左值
 * @param {string} b 右值
 * @returns {number} 比较结果
 * @sideEffects 无（纯函数）
 */
function plainCompare(a, b) {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/**
 * 点击表头排序
 *
 * @param {string} key 列名
 * @returns {void}
 * @sideEffects 修改排序状态、重绘表格
 */
function handleSort(key) {
	const next = nextSortState(sortState, key);
	sortState.key = next.key;
	sortState.asc = next.asc;

	groupedData = sortRows(groupedData, {
		key: key,
		asc: next.asc,
		value: sortValueOf,
		compare: key === 'designator' ? naturalCompare : plainCompare,
	});

	document.querySelectorAll('.sortable-header .sort-icon').forEach((icon) => {
		icon.textContent = '';
	});
	const activeIcon = document.querySelector(`.sortable-header[data-sort="${key}"] .sort-icon`);
	if (activeIcon) activeIcon.textContent = sortIndicatorOf(sortState, key);

	renderTable();
}

/**
 * 删除为「读属性」而临时放置的器件
 *
 * 同时按坐标兜底：源码写回后 EDA 会重建文档，图元 id 有可能变，
 * 只按 id 删会漏（漏了就在 (-10000,-10000) 留一堆垃圾器件）。
 *
 * @returns {Promise<void>}
 * @sideEffects eda 图元删除
 */
async function cleanupTempComponents() {
	const ids = pendingTempIds.slice();
	pendingTempIds = [];

	// 不因 ids 为空而跳过：源码写回可能改了图元 id，坐标兜底是唯一的兜网
	const targets = new Set(ids);
	try {
		const all = await eda.pcb_PrimitiveComponent.getAll();
		for (const comp of all) {
			if (Math.round(comp.x) === TEMP_X && Math.round(comp.y) === TEMP_Y) targets.add(comp.primitiveId);
		}
		if (targets.size > 0) await eda.pcb_PrimitiveComponent.delete(Array.from(targets));
	} catch (err) {
		logger.warn('清理临时器件失败（画布 (-10000,-10000) 附近可能残留）', err);
	}
}

/**
 * 把一批图元按「名称+封装+编号」分组
 *
 * @param {Array<object>} rawComponents 画布图元
 * @returns {Array<object>} 分组数据
 * @sideEffects 无（纯函数）
 */
function groupComponents(rawComponents) {
	const groupMap = new Map();

	for (const comp of rawComponents) {
		if (!comp.designator) continue; // 忽略没有位号的图元
		const props = extractProps(comp);
		const key = buildGroupKey(props);

		if (!groupMap.has(key)) {
			groupMap.set(key, {
				key: key,
				designators: [],
				primitiveId: [],
				original: props,
				target: { name: null, footprint: null, supplierId: null },
				options: { preserveName: true, preserveFootprint: true, preserve3D: true },
				selected: false,
				ComponentsSource: [],
			});
		}

		const group = groupMap.get(key);
		group.designators.push(comp.designator);
		group.primitiveId.push(comp.primitiveId);
		group.ComponentsSource.push(comp);
	}

	const groups = Array.from(groupMap.values());
	for (const group of groups) group.designators.sort(naturalCompare);
	return groups;
}

/** 初始化：读画布图元并分组渲染 */
async function initData() {
	try {
		if (!hasEda()) {
			logger.warn('[Debug] 未检测到 eda 对象，等待环境注入或在独立浏览器中运行...');
			return;
		}
		const rawComponents = await eda.pcb_PrimitiveComponent.getAll();
		groupedData = groupComponents(rawComponents);
		renderTable();
	} catch (error) {
		logger.error('[Debug] 初始化数据失败:', error);
	}
}

/** 粘贴剪贴板数据并重新分组 */
async function handlePaste() {
	let text;
	try {
		text = await navigator.clipboard.readText();
	} catch (err) {
		logger.error('[Debug] 读取剪贴板失败:', err);
		logger.debug('读取剪贴板失败，请检查浏览器权限或确认是否在安全上下文(https)中！');
		return;
	}

	const pasteMap = parseClipboard(text);
	if (pasteMap.size === 0) return;

	const items = flattenGroups(groupedData);
	const updateCount = applyTargetSupplierIds(items, pasteMap);
	groupedData = regroupGroups(items);
	logger.debug(`[Debug] 匹配并更新了 ${updateCount} 条记录的立创编号`);

	if (updateCount > 0) document.getElementById('btnFetch').disabled = false;
	renderTable();
}

/**
 * 把某个目标编号的取回结果写到所有匹配的分组上
 *
 * @param {string} supplierId 立创编号
 * @param {object} payload 目标属性
 * @returns {void}
 * @sideEffects 修改 `groupedData` 中的 target / ComponentsTarget
 */
function applyFetchedTarget(supplierId, payload) {
	for (const group of groupedData) {
		if (!group.selected || group.target.supplierId !== supplierId) continue;
		group.target.name = payload.name;
		group.target.footprint = payload.footprint;
		group.target.footprintuuid = payload.footprintuuid;
		group.target.uuid = payload.uuid;
		group.ComponentsTarget = payload.comp;
	}
}

/**
 * 从临时器件算出「名称 / 封装 / uuid」
 *
 * @param {object} sel 临时器件图元
 * @param {object|null} pInfo 商品信息（现状恒为 null）
 * @returns {{name: string, footprint: string, footprintuuid: string, uuid: string, comp: object}} 目标属性
 * @sideEffects 可能经 `enrichComponentData` 就地修改 `sel`
 */
function resolveTargetProps(sel, pInfo) {
	enrichComponentData(sel, pInfo);

	const rawName =
		(pInfo && pInfo.device_info && pInfo.device_info.attributes && pInfo.device_info.attributes.Name) ||
		sel.name ||
		(sel.component && sel.component.name) ||
		'';
	const props = sel.otherProperty || {};
	const mergedProps = { ...sel, ...props };
	const fallbackDevice = props.Device || props['Manufacturer Part'] || sel.manufacturerId || '';

	let finalName = resolveDynamicString(rawName, mergedProps, fallbackDevice);
	if (String(finalName).includes('={')) finalName = props.Value || sel.manufacturerId || finalName;

	const fpInfo = pInfo ? pInfo.device_info.footprint_info : null;
	const finalFootprint = (fpInfo && (fpInfo.display_title || fpInfo.title)) || getFootprintName(sel) || '未知封装';

	return {
		name: finalName,
		footprint: finalFootprint,
		footprintuuid: getFootprintUuid(sel),
		uuid: getDeviceUuid(sel),
		comp: sel,
	};
}

/**
 * 商品信息接口（已停用）
 *
 * 原实现走 `POST /api/v2/eda/product/search`，实测在插件 iframe（blob 文档）里不可用，
 * 全部代码已注释掉并恒返回 null —— 保留下游合并逻辑（`enrichComponentData`）以备恢复。
 *
 * @param {string} supplierId 立创编号
 * @returns {Promise<null>} 恒为 null
 * @sideEffects 无（不发请求）
 */
async function fetchProductInfo(supplierId) {
	void supplierId;
	return null;
}

/**
 * 阶段 0：把待取器的器件先放到画布外，再从图元上读回真实属性
 *
 * @param {Array<string>} supplierIds 待放置的立创编号
 * @param {string} sysLibUuid 系统库 uuid
 * @returns {Promise<{autoFetchMap: Map<string, string>, manualPendingIds: Set<string>, placeCount: number}>} 结果
 * @sideEffects 创建画布图元、更新状态栏
 */
async function placeTempComponents(supplierIds, sysLibUuid) {
	const autoFetchMap = new Map();
	const manualPendingIds = new Set();
	let placeCount = 0;

	statusBar.width(0, '');

	await mapInChunks(
		supplierIds,
		DEFAULT_CHUNK_SIZE,
		async (supplierId) => {
			try {
				// V4：单个编号返回的是器件对象而不是数组，必须用 pickDevice 归一
				const dev = pickDevice(await eda.lib_Device.getByLcscIds(supplierId));
				if (dev && dev.uuid) {
					const handle = await eda.pcb_PrimitiveComponent.create(
						{ libraryUuid: sysLibUuid, uuid: dev.uuid },
						1,
						TEMP_X,
						TEMP_Y,
						0,
						false
					);
					const createdId = pickPrimitiveId(handle);
					if (createdId) autoFetchMap.set(supplierId, createdId);
					else manualPendingIds.add(supplierId);
					placeCount += 1;
				}
			} catch (err) {
				logger.warn(`预载器件 ${supplierId} 失败，转为手动兜底`, err);
				manualPendingIds.add(supplierId);
				placeCount += 1;
			}
		},
		{ onProgress: (done, total, supplierId) => status.setProgress(done, total, supplierId) }
	);

	return { autoFetchMap: autoFetchMap, manualPendingIds: manualPendingIds, placeCount: placeCount };
}

/**
 * 阶段 1：从自动放置的临时器件读属性
 *
 * @param {Map<string, string>} autoFetchMap 立创编号 → 图元 ID
 * @returns {Promise<void>}
 * @sideEffects 修改分组数据、重绘表格、更新状态栏；V2 下直接删除临时器件
 */
async function readAutoFetched(autoFetchMap) {
	if (autoFetchMap.size === 0) return;

	const entries = Array.from(autoFetchMap.entries());
	const toDeleteIds = [];
	statusBar.width(0, '');

	await mapInChunks(
		entries,
		DEFAULT_CHUNK_SIZE,
		async (entry) => {
			const supplierId = entry[0];
			const primitiveId = entry[1];
			try {
				const sel = await eda.pcb_PrimitiveComponent.get(primitiveId).catch(() => null);
				if (sel) {
					applyFetchedTarget(supplierId, resolveTargetProps(sel, await fetchProductInfo(supplierId)));
					toDeleteIds.push(primitiveId);
				}
			} catch (getErr) {
				logger.warn('读取器件属性失败，已跳过该器件', getErr);
			}
		},
		{ onProgress: (done, total, entry) => status.setProgress(done, total, `获取属性: ${entry[0]}`) }
	);

	// V3/V4：器件定义跟着临时器件走，先留着，等源码写回后再删（见文件头约束 1）
	if (isModern()) pendingTempIds.push(...toDeleteIds);
	else if (toDeleteIds.length > 0) {
		try {
			await eda.pcb_PrimitiveComponent.delete(toDeleteIds);
		} catch (delErr) {
			logger.error('批量删除原器件失败，可能残留旧器件', delErr);
		}
	}

	renderTable();
	statusBar.width(0, '');
}

/**
 * 阶段 2：V2 下拿不到图元 ID 的器件，让用户框选后从选区读属性
 *
 * @param {Set<string>} manualPendingIds 待手动处理的编号
 * @param {number} fetchStart 流程起点（`performance.now()`），用于算总耗时
 * @returns {void}
 * @sideEffects 启动 1s 轮询；命中后删除临时器件、更新状态栏
 */
function pollManualSelection(manualPendingIds, fetchStart) {
	logger.debug(`由于API限制，有 ${manualPendingIds.size} 种器件需要手动辅助。\n请在画布中将它们【全部框选】，工具将自动提取参数并删除！`);
	statusBar.text(
		`由于API限制，需手动辅助，请在画布(-10000,-10000)中【框选】新增的 ${manualPendingIds.size} 个器件，工具将自动提取参数并删除！`
	);

	fetchPollInterval = setInterval(async () => {
		if (pollBusy) return;
		pollBusy = true;
		try {
			const selectedItems = (await eda.pcb_SelectControl.getAllSelectedPrimitives()) || [];
			if (selectedItems.length !== manualPendingIds.size) return;

			const done = await applyManualSelection(selectedItems, manualPendingIds, fetchStart);
			if (!done) return;

			clearInterval(fetchPollInterval);
			fetchPollInterval = null;
		} finally {
			pollBusy = false;
		}
	}, 1000);
}

/**
 * 把用户框选的器件写进分组，并在全部命中后收尾
 *
 * @param {Array<object>} selectedItems 框选的图元
 * @param {Set<string>} manualPendingIds 待手动处理的编号
 * @param {number} fetchStart 流程起点
 * @returns {Promise<boolean>} 是否已完成（全部命中且已清理）
 * @sideEffects 修改分组数据、删除临时器件、更新状态栏
 */
async function applyManualSelection(selectedItems, manualPendingIds, fetchStart) {
	let hasUpdate = false;
	let validMatchCount = 0;

	await mapInChunks(selectedItems, DEFAULT_CHUNK_SIZE, async (sel) => {
		const selSupplierId =
			sel.supplierId ||
			(sel.otherProperty && (sel.otherProperty['Supplier Part'] || sel.otherProperty.supplierId)) ||
			'';
		if (!selSupplierId || !manualPendingIds.has(selSupplierId)) return;

		validMatchCount += 1;
		applyFetchedTarget(selSupplierId, resolveTargetProps(sel, await fetchProductInfo(selSupplierId)));
		manualPendingIds.delete(selSupplierId);
		hasUpdate = true;
	});

	if (!(validMatchCount === selectedItems.length && hasUpdate)) return false;

	const toDeleteIds = selectedItems.map((item) => item.primitiveId).filter((id) => id);
	if (toDeleteIds.length > 0) {
		if (isModern()) pendingTempIds.push(...toDeleteIds);
		else {
			try {
				await eda.pcb_PrimitiveComponent.delete(toDeleteIds);
			} catch (delErr) {
				logger.error('批量删除原器件失败，可能残留旧器件', delErr);
			}
		}
	}
	renderTable();

	const costTime = ((performance.now() - fetchStart) / 1000).toFixed(2);
	statusBar.width(0, '');
	statusBar.text(`获取完成，耗时${costTime}秒 (已自动删除临时器件)`);
	setTimeout(() => status.readyToReplace(costTime), 3000);
	return true;
}

/** 获取新器件数据（阶段 0 → 1 → 2） */
async function handleFetch() {
	const fetchStart = performance.now();
	statusBar.text('正在检查待获取器件...');

	if (fetchPollInterval) {
		clearInterval(fetchPollInterval);
		fetchPollInterval = null;
	}

	const sysLibUuid = await eda.lib_LibrariesList.getSystemLibraryUuid();

	const pendingSupplierIds = new Set();
	for (const group of groupedData) {
		if (group.selected && group.target.supplierId && !group.target.uuid) pendingSupplierIds.add(group.target.supplierId);
	}

	if (pendingSupplierIds.size === 0) {
		statusBar.text('数据已获取');
		setTimeout(() => status.readyToReplace(), 3000);
		return;
	}

	const { autoFetchMap, manualPendingIds, placeCount } = await placeTempComponents(
		Array.from(pendingSupplierIds),
		sysLibUuid
	);

	if (placeCount === 0) {
		statusBar.text('未能在库中找到对应的器件');
		setTimeout(() => status.readyToReplace(), 3000);
		return;
	}

	await readAutoFetched(autoFetchMap);

	if (manualPendingIds.size === 0) {
		const costTime = ((performance.now() - fetchStart) / 1000).toFixed(2);
		statusBar.text(`获取完成，耗时${costTime}秒`);
		document.getElementById('btnReplace').disabled = false;
		setTimeout(() => status.readyToReplace(costTime), 3000);
		logger.debug(`[性能打点] 🎉 handleFetch 完整生命周期 总耗时: ${costTime} 秒`);
		return;
	}

	pollManualSelection(manualPendingIds, fetchStart);
}

/**
 * 收集「图元 ID → 替换动作」
 *
 * @returns {Map<string, object>} 替换动作表
 * @sideEffects 无（纯函数，只读 groupedData）
 */
function buildTargetMap() {
	const targetMap = new Map();

	for (const group of groupedData) {
		if (!group.selected || !group.ComponentsTarget) continue;
		group.primitiveId.forEach((primitiveId, index) => {
			const sourceComp = group.ComponentsSource[index];
			const targetComp = group.ComponentsTarget;

			targetMap.set(primitiveId, {
				preserveName: group.options.preserveName,
				preserveFootprint: group.options.preserveFootprint,
				preserve3D: group.options.preserve3D,
				sourceComp: sourceComp,
				targetComp: targetComp,
				targetDeviceUuid: getDeviceUuid(targetComp),
				targetDeviceNameJson: getDeviceNameJson(targetComp),
				sourceName: sourceComp.name || '',
				targetName: group.target.name || targetComp.name || '',
				sourceFootprintUuid: getFootprintUuid(sourceComp),
				targetFootprintUuid: getFootprintUuid(targetComp),
				designator: group.designators[index],
				sourceFootprintName: getFootprintName(sourceComp),
			});
		});
	}

	return targetMap;
}

/**
 * 按「是否保留 3D」把 3D 模型属性写回图元
 *
 * @param {Map<string, object>} targetMap 替换动作表
 * @returns {Promise<void>}
 * @sideEffects eda 图元属性修改
 */
async function sync3DModels(targetMap) {
	for (const entry of targetMap.entries()) {
		const primitiveId = entry[0];
		const action = entry[1];
		const modelSource = action.preserve3D ? action.sourceComp : action.targetComp;
		const props = (modelSource && modelSource.otherProperty) || {};

		const rawUri = props['3D Model'] || '';
		// 存的是 `uri|libUuid`，属性里只写 uri
		const modelUri = rawUri.includes('|') ? rawUri.split('|')[0] : rawUri;

		await eda.pcb_PrimitiveComponent.modify(primitiveId, {
			otherProperty: {
				'3D Model': modelUri,
				'3D Model Title': props['3D Model Title'] || '',
				'3D Model Transform': props['3D Model Transform'] || '',
			},
		});
	}
}

/**
 * 把目标器件属性同步进网表
 *
 * @param {Map<string, object>} targetMap 替换动作表
 * @returns {Promise<void>}
 * @sideEffects 读/写网表
 */
async function syncNetlist(targetMap) {
	const desigMap = new Map();
	for (const action of targetMap.values()) desigMap.set(action.designator, action);

	// 已知缺陷（V2.2 平台）：替换后 getNetlist 可能返回 {} → 这里失败只记日志，不影响替换结果
	const jsonData = (await getNetlist('PCB')).json;
	applyTargetProps(getComponentsContainer(jsonData), desigMap);
	await setNetlist('PCB', JSON.stringify(jsonData, null, 2));
	logger.debug('[Debug] 网表同步更新完成！');
}

/** 执行替换：改源码 → 删临时器件 → 同步 3D → 同步网表 */
async function executeReplace() {
	const startTime = performance.now();
	statusBar.text('正在执行替换...');

	const targetMap = buildTargetMap();
	if (targetMap.size === 0) {
		logger.warn('[Debug] 没有需要替换的有效图元，请检查是否勾选并成功获取了目标数据');
		return;
	}

	try {
		const rawSource = await eda.sys_FileManager.getDocumentSource();
		await eda.sys_FileManager.setDocumentSource(rewriteSource(rawSource, targetMap));

		// 源码写成功后目标器件已被正式引用，这时才能删临时器件（约束 1）
		await cleanupTempComponents();

		await sync3DModels(targetMap);
		try {
			await syncNetlist(targetMap);
		} catch (netErr) {
			logger.error('[Debug] 网表更新阶段发生异常:', netErr);
		}

		const costTime = ((performance.now() - startTime) / 1000).toFixed(2);
		logger.debug(`[Debug] 替换完成，共处理 ${targetMap.size} 个图元。耗时 ${costTime} 秒`);
		statusBar.text(`替换完成，耗时${costTime}秒`);
		setTimeout(() => status.reset(), 3000);
	} catch (err) {
		logger.error('[Debug] 替换过程中发生致命错误:', err);
		statusBar.text('替换失败，请查看控制台日志');
		// 写回失败也要清理临时器件，否则会一直躺在 (-10000,-10000)（约束 3）
		await cleanupTempComponents();
	}
}

/** 表格渲染 */
function renderTable() {
	const tbody = document.getElementById('tableBody');
	tbody.innerHTML = '';

	groupedData.forEach((group, index) => {
		const tr = document.createElement('tr');
		if (!group.selected) tr.classList.add('disabled-row');

		const designatorText = group.designators.join('、');
		tr.innerHTML = `
                    <td><input type="checkbox" class="row-selector" data-index="${index}" ${group.selected ? 'checked' : ''}></td>
                    
                    <td title="${safeTitle(designatorText)}">${designatorText}</td>
                    
                    <td title="${safeTitle(formatTitle(group.original.name, group.target.name))}">${formatCell(group.original.name, group.target.name)}</td>
                    
                    <td title="${safeTitle(formatTitle(group.original.footprint, group.target.footprint))}">${formatCell(group.original.footprint, group.target.footprint)}</td>
                    
                    <td title="${safeTitle(formatTitle(group.original.supplierId, group.target.supplierId))}">${formatCell(group.original.supplierId, group.target.supplierId)}</td>
                    
                    <td><input type="checkbox" class="opt-cb" data-index="${index}" data-key="preserveName" ${group.options.preserveName ? 'checked' : ''} ${!group.selected ? 'disabled' : ''}></td>
                    <td><input type="checkbox" class="opt-cb" data-index="${index}" data-key="preserveFootprint" ${group.options.preserveFootprint ? 'checked' : ''} ${!group.selected ? 'disabled' : ''}></td>
                    <td><input type="checkbox" class="opt-cb" data-index="${index}" data-key="preserve3D" ${group.options.preserve3D ? 'checked' : ''} ${!group.selected ? 'disabled' : ''}></td>
                `;
		tbody.appendChild(tr);
	});

	syncSelectAllState();
}

/**
 * 单元格内容（有变化时带绿色箭头）
 *
 * @param {string} oldVal 原值
 * @param {string} newVal 目标值
 * @returns {string} HTML 片段
 * @sideEffects 无（纯函数）
 */
function formatCell(oldVal, newVal) {
	if (newVal && newVal !== oldVal) return `${oldVal || '-'} <span class="change-arrow">→</span> ${newVal}`;
	return oldVal || '-';
}

/**
 * 悬浮提示文本（纯文本，不含 HTML 标签）
 *
 * @param {string} oldVal 原值
 * @param {string} newVal 目标值
 * @returns {string} 提示文本
 * @sideEffects 无（纯函数）
 */
function formatTitle(oldVal, newVal) {
	if (newVal && newVal !== oldVal) return `${oldVal || '-'} → ${newVal}`;
	return String(oldVal || '-');
}

/**
 * 转义双引号，防止名称里有 `"` 截断 HTML 属性
 *
 * @param {string} str 原文
 * @returns {string} 转义结果
 * @sideEffects 无（纯函数）
 */
function safeTitle(str) {
	return String(str).replace(/"/g, '&quot;');
}

/** 同步全选框的 checked / indeterminate */
function syncSelectAllState() {
	const selectAllCb = document.getElementById('selectAll');
	const summary = selectionSummary(groupedData, (group) => group.selected);
	selectAllCb.checked = summary.isAll;
	selectAllCb.indeterminate = summary.isIndeterminate;
}

/** 绑定事件 */
function bindEvents() {
	const tbody = document.getElementById('tableBody');
	const selectAllCb = document.getElementById('selectAll');

	document.getElementById('btnPaste').addEventListener('click', handlePaste);
	document.getElementById('btnFetch').addEventListener('click', handleFetch);
	document.getElementById('btnReplace').addEventListener('click', executeReplace);

	document.querySelectorAll('.sortable-header').forEach((header) => {
		header.addEventListener('click', () => handleSort(header.getAttribute('data-sort')));
	});

	// 表格内复选框（事件委托）
	tbody.addEventListener('change', (event) => {
		const target = event.target;
		if (target.type !== 'checkbox') return;

		const group = groupedData[parseInt(target.getAttribute('data-index'), 10)];
		if (!group) return;

		if (target.classList.contains('row-selector')) {
			group.selected = target.checked;
			renderTable(); // 重绘以更新置灰与禁用状态
		} else if (target.classList.contains('opt-cb')) {
			// 只改数据，不必重绘
			group.options[target.getAttribute('data-key')] = target.checked;
		}
	});

	selectAllCb.addEventListener('change', (event) => {
		const isChecked = event.target.checked;
		groupedData.forEach((group) => {
			group.selected = isChecked;
		});
		renderTable();
	});

	// 表头可点击列：批量切换保留选项（只影响已勾选的行）
	document.querySelectorAll('.clickable-header').forEach((header) => {
		header.addEventListener('click', () => {
			const key = header.getAttribute('data-key');
			const activeGroups = groupedData.filter((group) => group.selected);
			if (activeGroups.length === 0) return;

			const targetState = !activeGroups.every((group) => group.options[key]);
			activeGroups.forEach((group) => {
				group.options[key] = targetState;
			});
			renderTable();
		});
	});
}

document.addEventListener('DOMContentLoaded', () => {
	bindEvents();
	initData();
});

// 兜底：用户在「获取数据」之后直接关掉插件（没点替换）时，别把临时器件留在画布上
window.addEventListener('pagehide', () => {
	if (pendingTempIds.length > 0) cleanupTempComponents();
});
