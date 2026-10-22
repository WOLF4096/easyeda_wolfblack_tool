/**
 * @//module/ app/create-footprint/index
 * @//description/ 页面编排：选中图元 → 算原点 → 建库元素 → 生成封装/符号源码 → 放器件 → 删原图元
 * @//exports/ 无
 * @//dependencies/ core/eda, core/version, ui/toast, app/create-footprint/sourceBuilder
 * @//example/ 页面入口，由 iframe/CreateFootprint.html 加载打包产物 app/CreateFootprint.js
 *
 * 只支持 V2.2 客户端：V3 起库源码写入 API 有缺陷，页面整体拦截（原实现同样如此）。
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

	if (pads.length > 1) {
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
		return { originX: (minX + maxX) / 2, originY: (minY + maxY) / 2 };
	}

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
	if (minX === Infinity) {
		minX = 0;
		minY = 0;
		maxX = 0;
		maxY = 0;
	}
	return { originX: (minX + maxX) / 2, originY: (minY + maxY) / 2 };
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
 * 主流程
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（读源码、建库、写源码、放器件、删图元、隐藏面板）、DOM
 */
async function onRunClick() {
	const btn = document.getElementById('runBtn');
	const inputVal = document.getElementById('fooNameInput').value.trim();
	const inputDes = document.getElementById('desNameInput').value.trim();
	const libraryUuid = document.getElementById('libSelect').value;

	if (!libraryUuid) {
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
		// A. 取选中图元并过滤掉器件
		const allSelected = await host.pcb_SelectControl.getAllSelectedPrimitives();
		if (!allSelected || allSelected.length === 0) throw new Error('请先在 PCB 中选中图元！');
		const targets = allSelected.filter((p) => p.primitiveType !== 'Component');
		if (targets.length === 0) throw new Error('未选中有效图元');

		// B. 取源码并按 id 匹配
		const selectedIds = targets.map((p) => p.primitiveId);
		const docSource = await host.sys_FileManager.getDocumentSource();
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
		if (primitives.length === 0) throw new Error('无法在源码中匹配到选中的图元数据');

		// C. 原点与命名
		const { originX, originY } = computeOrigin(primitives);
		const padNumbers = collectPadNumbers(primitives);
		const deviceName = deviceNameOf(inputVal, padNumbers.size);
		const desMatch = inputDes.match(/^[a-zA-Z]+/);
		const finalDesignator = (desMatch ? desMatch[0].toUpperCase() : 'U') + '?';

		// D. 建库元素
		const fpUuid = await host.lib_Footprint.create(libraryUuid, deviceName);
		const symUuid = await host.lib_Symbol.create(libraryUuid, deviceName);
		const devUuid = await host.lib_Device.create(
			libraryUuid,
			deviceName,
			undefined,
			{
				symbolType: 2,
				symbol: { uuid: symUuid, libraryUuid: libraryUuid },
				footprint: { uuid: fpUuid, libraryUuid: libraryUuid },
			},
			undefined,
			{ addIntoBom: true, addIntoPcb: true, designator: finalDesignator, name: deviceName }
		);

		// E/F. 生成并写入封装 / 符号源码
		await host.lib_Footprint.updateDocumentSource(fpUuid, libraryUuid, buildFootprintSource(primitives, { uuid: fpUuid, deviceName: deviceName, originX: originX, originY: originY }));
		await host.lib_Symbol.updateDocumentSource(symUuid, libraryUuid, buildSymbolSource({ deviceName: deviceName, pinNumbers: padNumbers }));

		// G. 放置器件
		// 2.2.43 特有行为：先用 pcb API 建一次再删掉，否则原理图符号会出问题；
		// 判断的是**具体补丁版本**，不能用 isV2() 代替（原实现注释如此）。
		if (getEditorVersion().startsWith('2.2.43')) {
			const created = await host.pcb_PrimitiveComponent.create({ libraryUuid: libraryUuid, uuid: devUuid }, host.EPCB_LayerId ? host.EPCB_LayerId.TOP : 1, originX, originY, 0, false);
			if (created && created.primitiveId) await host.pcb_PrimitiveComponent.delete(created.primitiveId);
		}
		await host.sch_PrimitiveComponent.create({ libraryUuid: libraryUuid, uuid: devUuid }, 0, 0, '', 0, false, true, true);

		// H. 删除原图元（不同类型用不同 delete API；焊盘异形已知不支持删除）
		for (const item of targets) {
			try {
				if (item.primitiveType === 'Pad') await host.pcb_PrimitivePad.delete(item.primitiveId);
				else if (item.primitiveType === 'Polyline') await host.pcb_PrimitivePolyline.delete(item.primitiveId);
				else if (item.primitiveType === 'Region') await host.pcb_PrimitivePour.delete(item.primitiveId);
				else if (item.primitiveType === 'Via') await host.pcb_PrimitiveVia.delete(item.primitiveId);
				else if (item.primitiveType === 'Image') await host.pcb_PrimitiveImage.delete(item.primitiveId);
			} catch (e) {
				console.warn('删除临时图元失败', e);
			}
		}

		if (host.sys_IFrame) host.sys_IFrame.hideIFrame('CreateFootprint');
		document.getElementById('fooNameInput').value = '';
		toast('成功创建封装: ' + deviceName, 'success');
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
