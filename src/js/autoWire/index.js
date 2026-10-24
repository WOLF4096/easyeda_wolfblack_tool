/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
//
// 此代码已兼容 V2 和 V3 版本
//
// 「创建导线」主逻辑（菜单：来自PCB / 来自网表）
// 职责：编排选中器件 → 获取网表（PCB 选中 / 网表缓存）→ 比对差异 → 生成导线源码 → 批量写入
// 依赖：performanceMonitor.js（性能统计）、netlistParser.js（网表解析）、
//       docSwitch.js（原理图⇄PCB 切页）、netlistCache.js（网表缓存读取）
//
// --- 模块边界 ---
// 本文件是「编排层 + EDA 调用层」：所有 `eda.*` 调用都集中在这里，
// 因此不做单元测试，由 test/edaParams.test.mjs 覆盖被调用的底层图元 API 契约。
//
//   netlistParser.js  → 纯解析/比对，不依赖 eda，可直接测
//   common/apiConfig.js → 读校准配置，依赖 eda（mock 测）
//   autoWire/index.js → 编排 + EDA 调用，不测
//
// 导入路径统一带 `.js` 后缀，以便 Node 原生 ESM（node --test）能直接解析。
//
import { logger } from '../common/logger.js';
import { createSchWireLines } from '../common/sourceEmitter.js';
import { switchToPCB, switchToSchematic } from './docSwitch.js';
import { describeCacheMeta, loadNetlistCache } from './netlistCache.js';
import { formatFileNetlist, formatPCBNetlist, formatSchematicNetlist, processNetlistData } from './netlistParser.js';
import { PerformanceMonitor } from './performanceMonitor.js';

// 导线长度
const WIRE_LENGTH = 40;

// 创建全局性能监控实例
const perfMonitor = new PerformanceMonitor();
// 获取客户端版本
let currentVersion = eda.sys_Environment.getEditorCurrentVersion();

// 放置导线主功能
export async function placeWires(importMethod) {
	perfMonitor.start();
	try {
		// 版本检测日志
		try {
			if (typeof eda !== 'undefined' && currentVersion) {
				logger.debug('当前EDA版本:', currentVersion);
			}
		} catch (e) {
			logger.debug('版本检测跳过');
		}

		// 1. 获取选中的器件
		const selectedComponents = await getSelectedComponent();

		if (!selectedComponents) {
			await eda.sys_Message.showToastMessage('请先在原理图中选择一个器件', 2);
			throw new Error('未选中任何器件');
		}
		// 2. 获取原理图网表
		const schematicNetlist = await getSchematicNetlist();

		let pcbNetlist;

		// 3. 根据导入方式获取PCB网表
		if (importMethod === 'PCB') {
			await switchToPCB();
			eda.sys_Message.showToastMessage('正在获取数据', 2);
			const pcbData = await getPCBSelection();
			await switchToSchematic();
			pcbNetlist = formatPCBNetlist(pcbData);
			// 添加短暂延迟，避免操作过快
			await delay(1000);
		} else if (importMethod === 'NET') {
			// 网表来源改为「用户配置里的缓存」：只读不弹框，缓存由菜单里的
			// 「从PCB更新网表缓存」「从文件更新网表缓存」两个入口维护（两个来源只存一份）
			const cachedNetlist = await loadNetlistCache();
			if (!cachedNetlist) {
				await eda.sys_Message.showToastMessage('网表缓存是空的，请先执行「创建导线 → 从PCB更新网表缓存」或「从文件更新网表缓存」', 2);
				throw new Error('网表缓存为空');
			}
			eda.sys_Log.add(`使用网表缓存（${describeCacheMeta(cachedNetlist.meta)}）`, 'info');
			pcbNetlist = formatFileNetlist(cachedNetlist.text, selectedComponents);
		} else {
			eda.sys_Log.add(`不支持的导入方式: ${importMethod}`, 'error');
			eda.sys_PanelControl.openBottomPanel('log');
			throw new Error(`不支持的导入方式: ${importMethod}`);
		}

		// 格式化网表数据 (这里包含了 V2/V3 的兼容处理)
		const formattedSchematicNetlist = formatSchematicNetlist(schematicNetlist, selectedComponents);

		// 处理单个或多个器件
		const componentsArray = Array.isArray(selectedComponents) ? selectedComponents : [selectedComponents];

		const allResults = [];

		// ---- 使用源码构建的方式批量写入 ----

		// 获取当前原理图的完整源码
		eda.sys_Message.showToastMessage('正在构建导线网络...', 2);
		let documentSource = await eda.sys_FileManager.getDocumentSource();
		if (!documentSource) {
			throw new Error('无法获取原理图源码');
		}

		// 解析当前的最大 ID
		const { maxId, maxTicket } = getMaxIdFromSource(documentSource);
		let idCounter = { val: maxId + 1 };
		let ticketCounter = { val: maxTicket + 1 }; // 新增 ticket 计数器

		let allSourceLines = [];

		// 4. 对每个器件分别处理引脚数据
		for (const selectedComponent of componentsArray) {
			const { componentIds, uniqueId, designator } = selectedComponent;

			// 处理网表数据
			const processedData = processNetlistData(componentIds, uniqueId, designator, formattedSchematicNetlist, pcbNetlist);

			if (processedData.length === 0) continue;

			// 生成导线源码片段
			const { results: drawResults, sourceLines } = await drawWiresForPins(processedData, idCounter, ticketCounter);

			// 收集要写入的源码
			allSourceLines.push(...sourceLines);

			drawResults.forEach((result) => {
				perfMonitor.addWire(result.success);
			});

			allResults.push({
				designator: designator,
				uniqueId: uniqueId,
				componentIds: componentIds,
				results: drawResults,
				successCount: drawResults.filter((r) => r.success).length,
				totalCount: drawResults.length,
			});
		}

		// 5. 批量写入源码
		if (allSourceLines.length > 0) {
			if (currentVersion.startsWith('2.')) {
				// V2 修复 header 中的 maxId
				documentSource = documentSource.replace(/"maxId":\d+/, `"maxId":${idCounter.val}`);
				// 拼接新的图元
				documentSource += '\n' + allSourceLines.join('\n');
			} else {
				// V3 拼接处理
				// 1. 确保原源码末尾有 "|"（如果非空且不以|结尾）
				if (documentSource.length > 0 && !documentSource.endsWith('|')) {
					documentSource += '|';
				}
				// 2. 确保末尾有换行符，以便拼接新行
				if (!documentSource.endsWith('\n')) {
					documentSource += '\n';
				}
				// 3. 拼接新生成的导线行（每行已自带末尾的 "|"）
				documentSource += allSourceLines.join('\n');
				// 4. 移除整个文档末尾多余的 "|"（保持最后一行不以 "|" 结尾）
				if (documentSource.endsWith('|')) {
					documentSource = documentSource.slice(0, -1);
				}
			}

			// 写入前自检：PCB 与原理图的源码格式不同，写错文档会被系统拦截（「格式错误」）。
			// 这里用 documentType 兜底（1 = 原理图），切换失败/分屏异常时不会误写。
			const curDocInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
			if (!curDocInfo || curDocInfo.documentType !== 1) {
				await eda.sys_Message.showToastMessage('当前文档不是原理图，已中止写入', 2);
				return {
					success: false,
					message: '当前文档不是原理图，已中止写入',
				};
			}

			// 写入回编辑器
			await eda.sys_FileManager.setDocumentSource(documentSource);
		}

		// 5. 汇总结果
		const performanceStats = perfMonitor.end();
		const totalSuccess = allResults.reduce((sum, result) => sum + result.successCount, 0);

		if (allResults.length === 0) {
			await eda.sys_Message.showToastMessage('没有需要放置导线的引脚', 2);
			return {
				success: true,
				data: [],
				message: '没有需要放置导线的引脚',
			};
		}

		// 修改消息内容，添加性能统计
		const message =
			componentsArray.length > 1
				? `成功为 ${componentsArray.length} 个器件的 ${totalSuccess} 个引脚放置导线，总耗时: ${performanceStats.totalTime.toFixed(2)}s，平均一条导线耗时: ${performanceStats.avgTimePerWire.toFixed(2)}ms`
				: `成功为器件 ${componentsArray[0].designator} 的 ${totalSuccess} 个引脚放置导线，总耗时: ${performanceStats.totalTime.toFixed(2)}s，平均一条导线耗时: ${performanceStats.avgTimePerWire.toFixed(2)}ms`;

		eda.sys_Message.showToastMessage('完成', 3);
		eda.sys_Log.add(message, 'info');

		return {
			success: true,
			data: allResults,
			message: message,
			performance: performanceStats, // 添加性能数据
		};
	} catch (error) {
		const performanceStats = perfMonitor.end();
		logger.error('放置导线失败:', error);
		// 失败原因要让用户在界面上看得到（此前只写控制台，表现为「点了没反应」）
		await eda.sys_Message.showToastMessage('放置导线失败：' + ((error && error.message) || error), 2);
		return {
			success: false,
			message: error.message,
			performance: performanceStats, // 添加性能数据
		};
	}
}

// 原理图 ⇄ PCB 的页签切换在 docSwitch.js（「从PCB更新网表缓存」也用它）

// 获取原理图网表
async function getSchematicNetlist() {
	try {
		let getNetlistFile = await eda.sch_ManufactureData.getNetlistFile('JLCEDA');
		return await getNetlistFile.text();
	} catch (error) {
		eda.sys_Log.add('获取原理图网表失败', 'error');
		eda.sys_PanelControl.openBottomPanel('log');
		logger.error('获取原理图网表失败:', error);
		throw new Error('获取原理图网表失败');
	}
}

// 获取SCH选中的器件信息 (已更新适配 V2/V3 API)
async function getSelectedComponent() {
	try {
		let primitives;
		// 1. 版本检测
		if (currentVersion && currentVersion.startsWith('2.2.45')) {
			primitives = await eda.sch_SelectControl.getSelectedPrimitives();
		} else {
			primitives = await eda.sch_SelectControl.getAllSelectedPrimitives();
		}

		// 过滤出类型为Component的图元
		const components = primitives.filter((item) => item.primitiveType === 'Component');

		if (components.length === 0) {
			return null;
		}

		// 按唯一ID分组，收集所有图元ID
		const componentMap = new Map();

		for (const component of components) {
			// 兼容性处理变量提取
			let uniqueId, designator, componentId;

			// V3 结构: 直接在根对象中
			if (component.uniqueId && component.primitiveId) {
				uniqueId = component.uniqueId;
				designator = component.designator;
				componentId = component.primitiveId;
			}
			// V2 结构: 在 param 对象中
			else if (component.param && component.id) {
				uniqueId = component.param.uniqueId;
				designator = component.param.designator;
				componentId = component.id;
			} else {
				logger.warn('未识别的组件结构', component);
				continue;
			}

			if (!componentMap.has(uniqueId)) {
				componentMap.set(uniqueId, {
					componentIds: [],
					uniqueId: uniqueId,
					designator: designator,
				});
			}

			componentMap.get(uniqueId).componentIds.push(componentId);
		}

		const uniqueComponents = Array.from(componentMap.values());

		// 如果只有一个器件，直接返回
		if (uniqueComponents.length === 1) {
			const component = uniqueComponents[0];
			return {
				componentIds: component.componentIds,
				uniqueId: component.uniqueId,
				designator: component.designator,
			};
		}

		// 返回所有器件信息
		return uniqueComponents.map((comp) => ({
			componentIds: comp.componentIds,
			uniqueId: comp.uniqueId,
			designator: comp.designator,
		}));
	} catch (error) {
		eda.sys_Log.add('获取选中器件失败', 'error');
		eda.sys_PanelControl.openBottomPanel('log');
		logger.error('获取选中器件失败:', error);
		throw new Error('获取选中器件失败');
	}
}

// 获取PCB选中的器件信息
async function getPCBSelection() {
	try {
		const pcbData = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		// PCB接口可能返回数组或单个对象
		if (Array.isArray(pcbData)) {
			// 过滤出器件类型
			return pcbData.filter((item) => item.primitiveType === 'Component');
		} else if (pcbData.primitiveType === 'Component') {
			// 单个器件对象
			return [pcbData];
		} else {
			eda.sys_Log.add('PCB中未选中任何器件', 'error');
			eda.sys_PanelControl.openBottomPanel('log');
			throw new Error('PCB中未选中任何器件');
		}
	} catch (error) {
		eda.sys_Log.add('获取PCB选中信息失败', 'error');
		logger.error('获取PCB选中信息失败:', error);
		throw new Error('获取PCB选中信息失败');
	}
}

// 从文件读网表已移到 netlistSync.js（「从文件更新网表缓存」），本文件只从缓存取

// 批量获取多个引脚的位置信息
async function getMultiplePinPositions(pinsData) {
	const positions = {};
	const componentPinsMap = {};

	// 按器件图元ID和引脚分组
	for (const pinData of pinsData) {
		const { componentId, pin } = pinData;
		if (!componentPinsMap[componentId]) {
			componentPinsMap[componentId] = [];
		}
		componentPinsMap[componentId].push(pin);
	}

	// 为每个图元ID批量获取引脚信息
	for (const [componentId, pins] of Object.entries(componentPinsMap)) {
		try {
			const pinsData = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentId);
			for (const pinNumber of pins) {
				const pinInfo = pinsData.find((pin) => pin.pinNumber === pinNumber);
				if (pinInfo) {
					const angle = pinInfo.rotation;
					const positionKey = `${componentId}_${pinNumber}`;
					positions[positionKey] = {
						x: pinInfo.x,
						y: pinInfo.y,
						angle: angle,
						rotation: pinInfo.rotation,
						pinName: pinInfo.pinName,
					};
				} else {
					eda.sys_Log.add(`在图元 ${componentId} 中未找到引脚 ${pinNumber}`);
					eda.sys_PanelControl.openBottomPanel('log');
					logger.warn(`在图元 ${componentId} 中未找到引脚 ${pinNumber}`);
				}
			}
		} catch (error) {
			eda.sys_Log.add(`获取图元 ${componentId} 引脚信息失败:`, 'error');
			eda.sys_PanelControl.openBottomPanel('log');
			logger.error(`获取图元 ${componentId} 引脚信息失败:`, error);
		}
	}

	return positions;
}

// 为引脚生成导线源码
async function drawWiresForPins(pinsData, idCounter, ticketCounter) {
	const results = [];
	const sourceLines = [];

	// 获取所有引脚的位置信息
	const pinPositions = await getMultiplePinPositions(pinsData);

	for (const pinData of pinsData) {
		try {
			const { componentId, pin, netName } = pinData;
			const pinInfo = pinPositions[`${componentId}_${pin}`];

			if (!pinInfo) {
				logger.warn(`未找到引脚 ${pin} 的位置信息`);
				results.push({ componentId, pin, netName, success: false });
				continue;
			}

			// 生成当前引脚的源码片段
			const wireLines = generateWireSource(pinInfo, netName, idCounter, ticketCounter);
			sourceLines.push(...wireLines);

			results.push({
				componentId: componentId,
				pin: pin,
				netName: netName,
				success: true,
			});
		} catch (error) {
			results.push({ componentId: pinData.componentId, pin: pinData.pin, netName: pinData.netName, success: false });
		}
	}
	return { results, sourceLines };
}

// 弃用 API 绘制，改为生成单根导线的源码片段
//
// 源码行由 `common/sourceEmitter.js` 统一发射（与前端 PcbToSch 同一份规格），
// 这里只负责几何：按引脚朝向算终点，Y 轴方向按版本翻转。
function generateWireSource(pinInfo, netName, idCounter, ticketCounter) {
	const { x, y, angle } = pinInfo;
	const startX = x;
	const startY = -y; // API获取的坐标Y值与源码相反
	let endX;
	let endY;
	let netT;
	const y1 = currentVersion.startsWith('2.') ? 1 : -1;
	const isV2 = currentVersion.startsWith('2.');

	switch (angle) {
		case 0:
			endX = startX + WIRE_LENGTH;
			endY = startY;
			netT = 0;
			break;
		case 90:
			endX = startX;
			endY = startY + WIRE_LENGTH * y1;
			netT = 90;
			break;
		case 180:
			endX = startX - WIRE_LENGTH;
			endY = startY;
			netT = 0;
			break;
		case 270:
			endX = startX;
			endY = startY - WIRE_LENGTH * y1;
			netT = 90;
			break;
		default:
			endX = startX + WIRE_LENGTH;
			endY = startY;
			netT = 0;
	}

	return createSchWireLines({
		net: netName,
		startX: startX,
		startY: startY,
		endX: endX,
		endY: endY,
		rotation: netT,
		isModern: !isV2,
		// V2 的 ATTR 用 st2（历史样式名，与 PcbToSch 的 st1 不同）
		attrStyle: isV2 ? 'st2' : 'st1',
		// id 走 maxId+1、ticket 走 maxTicket+1，两个计数器独立
		nextRow: () => ({
			id: idCounter.val++,
			ticket: isV2 ? 0 : ticketCounter.val++,
		}),
	});
}

// 延迟函数
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从原理图源码中提取最大图元ID（e数字）和最大ticket（V3专用）
 * @param {string} source - 原理图完整源码
 * @returns {{ maxId: number, maxTicket: number }}
 */
function getMaxIdFromSource(source) {
	let maxId = 0;
	let maxTicket = 0;

	// 1. 提取所有 "e数字" 中的数字（V2/V3 通用）
	const idRegex = /"e(\d+)"/g;
	let match;
	while ((match = idRegex.exec(source)) !== null) {
		const val = parseInt(match[1], 10);
		if (val > maxId) maxId = val;
	}

	// 2. 提取所有 "ticket":数字 中的数字（仅 V3 存在，V2 无此字段）
	const ticketRegex = /"ticket":(\d+)/g;
	while ((match = ticketRegex.exec(source)) !== null) {
		const val = parseInt(match[1], 10);
		if (val > maxTicket) maxTicket = val;
	}

	return { maxId, maxTicket };
}
