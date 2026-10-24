/**
 * @//module/ app/create-footprint/index
 * @//description/ 页面编排：选中图元 → 算原点 → 建库元素 → 生成封装/符号源码 → 放器件 → 删原图元
 * @//exports/ 无
 * @//dependencies/ core/eda, core/version, ui/toast, app/create-footprint/sourceBuilder
 * @//example/ 页面入口，由 iframe/CreateFootprint.html 加载打包产物 app/CreateFootprint.js
 *
 * 只支持 V2.2.45 客户端：V3 起库源码写入 API 有缺陷，页面整体拦截（原实现同样如此）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../../core/eda.js';
import { getEditorVersion, isModern } from '../../core/version.js';
import { toast } from '../../ui/toast.js';
import { buildFootprintSource, buildSymbolSource, getCoordsFromSource } from './sourceBuilder.js';

/** 允许转成封装的图元类型 */

/**
 * 版本拦截：V3/V4 直接把表单换成提示文字
 *
 * @returns {boolean} true 表示已拦截（后续不应继续执行）
 * @sideEffects DOM
 */
function blockModernClients() {
	try {
		if (!isModern()) return false;
	} catch (e) {
		// 版本检测异常时按原逻辑继续尝试
		return false;
	}
	const container = document.querySelector('.cf-form');
	if (container) container.innerHTML = '<div class="notice-center">此功能只支持 EDA V2.2.45 版本</div>';
	return true;
}

/**
 * 焊盘的包围盒
 *
 * @param {Array<Array>} pads 焊盘图元源码行
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}} 包围盒
 * @sideEffects 无（纯函数）
 */
function padBounds(pads) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const pad of pads) {
		if (pad[6] < minX) minX = pad[6];
		if (pad[6] > maxX) maxX = pad[6];
		if (pad[7] < minY) minY = pad[7];
		if (pad[7] > maxY) maxY = pad[7];
	}
	return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

/**
 * 所有图元坐标的包围盒（无坐标时退化为原点）
 *
 * @param {Array<Array>} primitives 图元源码行
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}} 包围盒
 * @sideEffects 无（纯函数）
 */
function primitiveBounds(primitives) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const item of primitives) {
		const { x, y } = getCoordsFromSource(item);
		if (x === undefined || y === undefined) continue;
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

/**
 * 由选中的图元源码算封装原点
 *
 * 规则与原实现一致：有焊盘时取焊盘包围盒中心（单焊盘取其自身），否则取所有图元坐标的包围盒中心。
 *
 * @param {Array<Array>} primitives 图元源码行
 * @returns {{originX: number, originY: number}} 原点
 * @sideEffects 无（纯函数）
 */
function computeOrigin(primitives) {
	const pads = primitives.filter((item) => item[0] === 'PAD');
	if (pads.length === 1) return { originX: pads[0][6], originY: pads[0][7] };

	const bounds = pads.length > 1 ? padBounds(pads) : primitiveBounds(primitives);
	return { originX: (bounds.minX + bounds.maxX) / 2, originY: (bounds.minY + bounds.maxY) / 2 };
}

/**
 * 收集焊盘号（位号数量 = 引脚数）
 *
 * @param {Array<Array>} primitives 图元源码行
 * @returns {Set<string>} 去重后的焊盘号
 * @sideEffects 无（纯函数）
 */
function collectPadNumbers(primitives) {
	const set = new Set();
	for (const item of primitives) {
		if (item[0] !== 'PAD') continue;
		const num = item[5];
		if (num !== undefined && num !== null && String(num).trim() !== '') set.add(String(num).trim());
	}
	return set;
}

/**
 * 生成默认器件名
 *
 * @param {string} input 用户输入
 * @param {number} pinCount 引脚数
 * @returns {string} 器件名
 * @sideEffects 无（读取当前时间）
 */
function deviceNameOf(input, pinCount) {
	if (input && input.length > 0) return input;
	const now = new Date();
	const hh = now.getHours().toString().padStart(2, '0');
	const mm = now.getMinutes().toString().padStart(2, '0');
	const ss = now.getSeconds().toString().padStart(2, '0');
	return `NEW-${pinCount}Pin_${hh}${mm}${ss}`;
}

/**
 * 读取表单输入（名称 / 位号前缀 / 目标库）
 *
 * @returns {{name: string, des: string, libraryUuid: string}} 表单值
 * @sideEffects DOM（只读）
 */
function readInputs() {
	return {
		name: document.getElementById('fooNameInput').value.trim(),
		des: document.getElementById('desNameInput').value.trim(),
		libraryUuid: document.getElementById('libSelect').value,
	};
}

/**
 * 按 id 从文档源码里挑出选中图元的源码行
 *
 * @param {string} docSource 文档源码
 * @param {string[]} selectedIds 选中图元 id
 * @returns {Array<Array>} 命中的源码行
 * @sideEffects 无（纯函数）
 */
function pickSourceLines(docSource, selectedIds) {
	const primitives = [];
	for (const line of docSource.split('\n')) {
		if (!line.trim()) continue;
		try {
			const arr = JSON.parse(line);
			if (selectedIds.includes(arr[1])) primitives.push(arr);
		} catch (e) {
			// 跳过无法解析的源码行
		}
	}
	return primitives;
}

/**
 * 取选中图元（过滤掉器件）及其源码行
 *
 * @param {object} host EDA 宿主对象
 * @returns {Promise<{targets: Array<object>, primitives: Array<Array>}>} 选中图元与源码行
 * @sideEffects eda API（读选中集、读文档源码）
 */
async function readSelection(host) {
	// A. 取选中图元并过滤掉器件
	const allSelected = await host.pcb_SelectControl.getAllSelectedPrimitives();
	if (!allSelected || allSelected.length === 0) throw new Error('请先在 PCB 中选中图元！');
	const targets = allSelected.filter((p) => p.primitiveType !== 'Component');
	if (targets.length === 0) throw new Error('未选中有效图元');

	// B. 取源码并按 id 匹配
	const selectedIds = targets.map((p) => p.primitiveId);
	const docSource = await host.sys_FileManager.getDocumentSource();
	const primitives = pickSourceLines(docSource, selectedIds);
	if (primitives.length === 0) throw new Error('无法在源码中匹配到选中的图元数据');
	return { targets: targets, primitives: primitives };
}

/**
 * 算原点、焊盘号与器件命名
 *
 * @param {{name: string, des: string}} inputs 表单输入
 * @param {Array<Array>} primitives 图元源码行
 * @returns {{originX: number, originY: number, padNumbers: Set<string>, deviceName: string, finalDesignator: string}} 原点与命名
 * @sideEffects 无（读取当前时间）
 */
function buildNames(inputs, primitives) {
	const { originX, originY } = computeOrigin(primitives);
	const padNumbers = collectPadNumbers(primitives);
	const deviceName = deviceNameOf(inputs.name, padNumbers.size);
	const desMatch = inputs.des.match(/^[a-zA-Z]+/);
	const finalDesignator = (desMatch ? desMatch[0].toUpperCase() : 'U') + '?';
	return { originX: originX, originY: originY, padNumbers: padNumbers, deviceName: deviceName, finalDesignator: finalDesignator };
}

/**
 * 建封装 / 符号 / 器件三个库元素
 *
 * @param {object} host EDA 宿主对象
 * @param {string} libraryUuid 目标库
 * @param {{deviceName: string, finalDesignator: string}} names 命名
 * @returns {Promise<{fpUuid: string, symUuid: string, devUuid: string}>} 三个 uuid
 * @sideEffects eda API（lib_Footprint / lib_Symbol / lib_Device.create）
 */
async function createLibraryElements(host, libraryUuid, names) {
	const fpUuid = await host.lib_Footprint.create(libraryUuid, names.deviceName);
	const symUuid = await host.lib_Symbol.create(libraryUuid, names.deviceName);
	const devUuid = await host.lib_Device.create(
		libraryUuid,
		names.deviceName,
		undefined,
		{
			symbolType: 2,
			symbol: { uuid: symUuid, libraryUuid: libraryUuid },
			footprint: { uuid: fpUuid, libraryUuid: libraryUuid },
		},
		undefined,
		{ addIntoBom: true, addIntoPcb: true, designator: names.finalDesignator, name: names.deviceName },
	);
	return { fpUuid: fpUuid, symUuid: symUuid, devUuid: devUuid };
}

/**
 * 生成并写入封装 / 符号源码
 *
 * @param {object} host EDA 宿主对象
 * @param {string} libraryUuid 目标库
 * @param {Array<Array>} primitives 图元源码行
 * @param {object} names 原点与命名
 * @param {object} created 三个 uuid
 * @returns {Promise<void>}
 * @sideEffects eda API（updateDocumentSource）
 */
async function writeSources(host, libraryUuid, primitives, names, created) {
	await host.lib_Footprint.updateDocumentSource(
		created.fpUuid,
		libraryUuid,
		buildFootprintSource(primitives, { uuid: created.fpUuid, deviceName: names.deviceName, originX: names.originX, originY: names.originY }),
	);
	await host.lib_Symbol.updateDocumentSource(
		created.symUuid,
		libraryUuid,
		buildSymbolSource({ deviceName: names.deviceName, pinNumbers: names.padNumbers }),
	);
}

/**
 * 放置器件
 *
 * @param {object} host EDA 宿主对象
 * @param {string} libraryUuid 目标库
 * @param {string} devUuid 器件 uuid
 * @param {{originX: number, originY: number}} names 原点
 * @returns {Promise<void>}
 * @sideEffects eda API（pcb / sch_PrimitiveComponent.create，2.2.43 下额外建一次并删除）
 */
async function placeDevice(host, libraryUuid, devUuid, names) {
	// G. 放置器件
	// 2.2.43 特有行为：先用 pcb API 建一次再删掉，否则原理图符号会出问题；
	// 判断的是**具体补丁版本**，不能用 isV2() 代替（原实现注释如此）。
	if (getEditorVersion().startsWith('2.2.43')) {
		const created = await host.pcb_PrimitiveComponent.create(
			{ libraryUuid: libraryUuid, uuid: devUuid },
			host.EPCB_LayerId ? host.EPCB_LayerId.TOP : 1,
			names.originX,
			names.originY,
			0,
			false,
		);
		if (created && created.primitiveId) await host.pcb_PrimitiveComponent.delete(created.primitiveId);
	}
	await host.sch_PrimitiveComponent.create({ libraryUuid: libraryUuid, uuid: devUuid }, 0, 0, '', 0, false, true, true);
}

/** 图元类型 → 删除 API（未知类型不删，与原实现一致；焊盘异形已知不支持删除） */
const DELETE_HANDLERS = new Map([
	['Pad', (host, id) => host.pcb_PrimitivePad.delete(id)],
	['Polyline', (host, id) => host.pcb_PrimitivePolyline.delete(id)],
	['Region', (host, id) => host.pcb_PrimitivePour.delete(id)],
	['Via', (host, id) => host.pcb_PrimitiveVia.delete(id)],
	['Image', (host, id) => host.pcb_PrimitiveImage.delete(id)],
]);

/**
 * 删除原图元（逐条容错，单条失败只告警）
 *
 * @param {object} host EDA 宿主对象
 * @param {Array<object>} targets 选中图元
 * @returns {Promise<void>}
 * @sideEffects eda API（各类 delete）、console
 */
async function deleteTargets(host, targets) {
	for (const item of targets) {
		try {
			const remove = DELETE_HANDLERS.get(item.primitiveType);
			if (remove) await remove(host, item.primitiveId);
		} catch (e) {
			console.warn('删除临时图元失败', e);
		}
	}
}

/**
 * 收尾：隐藏面板、清空名称输入、提示成功
 *
 * @param {object} host EDA 宿主对象
 * @param {string} deviceName 器件名
 * @returns {void}
 * @sideEffects eda API（hideIFrame）、DOM、toast
 */
function finishSuccess(host, deviceName) {
	if (host.sys_IFrame) host.sys_IFrame.hideIFrame('CreateFootprint');
	document.getElementById('fooNameInput').value = '';
	toast('成功创建封装: ' + deviceName, 'success');
}

/**
 * 主流程
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（读源码、建库、写源码、放器件、删图元、隐藏面板）、DOM
 */
async function onRunClick() {
	const btn = document.getElementById('runBtn');
	const inputs = readInputs();

	if (!inputs.libraryUuid) {
		toast('请先选择一个目标库！', 'warning');
		return;
	}

	const host = getEda();
	if (!host) {
		toast('未检测到 EDA 运行环境', 'error');
		return;
	}

	if (btn) {
		btn.disabled = true;
		btn.innerText = '处理中...';
	}

	try {
		const { targets, primitives } = await readSelection(host);
		const names = buildNames(inputs, primitives);
		const created = await createLibraryElements(host, inputs.libraryUuid, names);
		await writeSources(host, inputs.libraryUuid, primitives, names, created);
		await placeDevice(host, inputs.libraryUuid, created.devUuid, names);
		await deleteTargets(host, targets);
		finishSuccess(host, names.deviceName);
	} catch (err) {
		console.error('执行错误: ', err);
		toast(err.message, 'error');
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.innerText = '创建封装';
		}
	}
}

/**
 * 加载可选目标库
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function initLibList() {
	const select = document.getElementById('libSelect');
	const runBtn = document.getElementById('runBtn');

	try {
		const host = getEda();
		const libraries = host && host.lib_LibrariesList ? await host.lib_LibrariesList.getAllLibrariesList() : [];
		for (const lib of libraries) {
			const option = document.createElement('option');
			option.value = lib.uuid || lib.id || '';
			option.textContent = lib.name || lib.title || '未命名库';
			select.appendChild(option);
		}
		if (runBtn) runBtn.disabled = false;
	} catch (err) {
		console.warn('版本检测异常，尝试继续执行...', err);
	}
}

if (!blockModernClients()) {
	void initLibList();
	const runBtnEl = document.getElementById('runBtn');
	if (runBtnEl) runBtnEl.addEventListener('click', onRunClick);
}
