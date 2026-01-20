//
// 此代码已更新以兼容 V2 和 V3 版本
//
// 导线长度
const WIRE_LENGTH = 40;

// 性能监控
class PerformanceMonitor {
	constructor() {
		this.startTime = 0;
		this.endTime = 0;
		this.totalWires = 0;
		this.successWires = 0;
	}

	start() {
		this.startTime = performance.now();
		this.totalWires = 0;
		this.successWires = 0;
		console.log(`性能监控开始: ${new Date().toLocaleTimeString()}`);
	}

	end() {
		this.endTime = performance.now();
		const totalTime = (this.endTime - this.startTime) / 1000;
		const avgTimePerWire = totalTime > 0 && this.successWires > 0 ? (totalTime * 1000) / this.successWires : 0;

		console.log(`性能统计:
成功放置导线数量: ${this.successWires}
总耗时: ${totalTime.toFixed(2)}s
平均一条导线耗时: ${avgTimePerWire.toFixed(2)}ms`);

		return {
			totalWires: this.totalWires,
			successWires: this.successWires,
			totalTime: totalTime,
			avgTimePerWire: avgTimePerWire,
		};
	}

	addWire(success = true) {
		this.totalWires++;
		if (success) {
			this.successWires++;
		}
	}
}

// 创建全局性能监控实例
const perfMonitor = new PerformanceMonitor();

// 放置导线主功能
export async function placeWires(importMethod) {
	perfMonitor.start();
	try {
		// 版本检测日志
		try {
			if (typeof eda !== 'undefined' && eda.sys_Environment && eda.sys_Environment.getEditorCurrentVersion) {
				console.log('当前EDA版本:', eda.sys_Environment.getEditorCurrentVersion());
			}
		} catch (e) {
			console.log('版本检测跳过');
		}

		// console.log("开始执行放置导线功能，导入方式:", importMethod);

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
			const fileData = await importNetlistFromFile();
			pcbNetlist = formatFileNetlist(fileData, selectedComponents);
		} else {
			eda.sys_Log.add(`不支持的导入方式: ${importMethod}`, 'error');
			eda.sys_PanelControl.openBottomPanel('log');
			throw new Error(`不支持的导入方式: ${importMethod}`);
		}

		// 格式化网表数据 (这里包含了 V2/V3 的兼容处理)
		const formattedSchematicNetlist = formatSchematicNetlist(schematicNetlist, selectedComponents);

		// 处理单个或多个器件
		const componentsArray = Array.isArray(selectedComponents) ? selectedComponents : [selectedComponents];
		// console.log("处理的器件列表:", componentsArray);

		const allResults = [];

		// 4. 对每个器件分别处理引脚数据
		for (const selectedComponent of componentsArray) {
			const { componentIds, uniqueId, designator } = selectedComponent;

			// 处理网表数据（每个器件单独处理）
			const processedData = processNetlistData(componentIds, uniqueId, designator, formattedSchematicNetlist, pcbNetlist);

			if (processedData.length === 0) {
				// console.log(`器件 ${designator} 没有需要放置导线的引脚`);
				continue;
			}

			// 绘制导线（每个器件单独处理）
			const drawResults = await drawWiresForPins(processedData);

			// 统计这个器件的导线数量
			const successCount = drawResults.filter((r) => r.success).length;
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
		console.error('放置导线失败:', error);
		// eda.sys_Log.add("放置导线失败", "error");
		// await eda.sys_Message.showToastMessage(`操作失败: ${error.message}`, 1);
		return {
			success: false,
			message: error.message,
			performance: performanceStats, // 添加性能数据
		};
	}
}

// 全局变量，用于记录跳转前的原理图Tab ID
let _lastSchematicTabId = null;

// 1. 切换到当前板子对应的PCB界面
async function switchToPCB() {
	try {
		// A. 记录当前原理图信息 (如果当前是在原理图界面)
		const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		console.log(curDoc);
		if (curDoc && curDoc.documentType === 1) {
			// 1 代表原理图
			_lastSchematicTabId = curDoc.uuid + '@' + curDoc.parentProjectUuid;
			console.log(_lastSchematicTabId);
			console.log(curDoc.tabId);
		}

		// B. 获取当前板子对应的 PCB UUID
		const boardInfo = await eda.dmt_Board.getCurrentBoardInfo();
		console.log(boardInfo);
		if (!boardInfo || !boardInfo.pcb) throw new Error('未获取到板子信息');
		const targetPcbUuid = boardInfo.pcb.uuid;

		// C. 在分屏树中查找 匹配该UUID 的 PCB Tab
		const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
		// TabId 通常格式为 "UUID@ProjectID"，所以使用 includes 匹配
		const pcbTab = splitData.tabs.find((tab) => tab.tabId.includes(targetPcbUuid));
		console.log(pcbTab);
		if (pcbTab) {
			await eda.dmt_EditorControl.activateDocument(pcbTab.tabId);
		} else {
			await eda.sys_Message.showToastMessage('未找到当前板子对应的PCB窗口，请确认PCB已打开', 2);
		}
	} catch (error) {
		console.error('切换PCB失败:', error);
	}
}

// 2. 切换回原来的原理图界面
async function switchToSchematic() {
	try {
		console.log(_lastSchematicTabId); //没有输出
		await eda.dmt_EditorControl.activateDocument(_lastSchematicTabId); //没有跳转回原来的页面
	} catch (error) {
		console.error('切换原理图失败:', error);
	}
}

// 获取原理图网表
async function getSchematicNetlist() {
	try {
		let getNetlistFile = await eda.sch_ManufactureData.getNetlistFile('JLCEDA');
		return await getNetlistFile.text();
	} catch (error) {
		eda.sys_Log.add('获取原理图网表失败', 'error');
		eda.sys_PanelControl.openBottomPanel('log');
		console.error('获取原理图网表失败:', error);
		throw new Error('获取原理图网表失败');
	}
}

// 获取SCH选中的器件信息 (已更新适配 V2/V3 API)
async function getSelectedComponent() {
	try {
		let primitives;
		// 1. 版本检测
		const currentVersion = eda.sys_Environment.getEditorCurrentVersion();
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
				console.warn('未识别的组件结构', component);
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
		console.error('获取选中器件失败:', error);
		throw new Error('获取选中器件失败');
	}
}

// 获取PCB选中的器件信息
async function getPCBSelection() {
	try {
		const pcbData = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		// console.log(pcbData);
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
		console.error('获取PCB选中信息失败:', error);
		throw new Error('获取PCB选中信息失败');
	}
}

// 从文件导入网表
async function importNetlistFromFile() {
	try {
		const fileData = await eda.sys_FileSystem.openReadFileDialog(['.enet'], false);

		if (!fileData) {
			throw new Error('未选择文件');
		}
		const fileContent = await readFileAsText(fileData);
		return fileContent;
	} catch (error) {
		console.error('导入网表文件失败:', error);
		throw new Error('导入网表文件失败');
	}
}

// 读取File对象为文本字符串
function readFileAsText(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = function (event) {
			resolve(event.target.result);
		};
		reader.onerror = function (error) {
			reject(error);
		};
		reader.readAsText(file);
	});
}

// 格式化原理图网表数据 (支持 V2 和 V3 格式)
function formatSchematicNetlist(netlistData, selectedComponents) {
	const formatted = [];
	const parsedData = JSON.parse(netlistData);

	// V3 兼容处理：确定组件数据源
	let componentsMap = parsedData;
	let isV3 = false;

	// 如果存在 components 字段，说明是 V3 格式
	if (parsedData.components) {
		componentsMap = parsedData.components;
		isV3 = true;
		console.log('识别为 V3 格式网表');
	} else {
		console.log('识别为 V2 格式网表');
	}

	// 处理单个或多个选中器件
	const componentsArray = Array.isArray(selectedComponents) ? selectedComponents : [selectedComponents];

	// console.log("=== 开始格式化网表数据 ===");

	for (const component of componentsArray) {
		const uniqueId = component.uniqueId;

		// console.log(`处理选中器件: ${component.designator} (${uniqueId})`);

		// 直接获取该器件在网表中的数据
		const componentData = componentsMap[uniqueId];

		if (!componentData) {
			console.warn(`⚠️ 未在网表中找到器件 ${uniqueId}`);
			continue;
		}

		// console.log("网表中的器件数据:", componentData);

		const props = componentData.props;
		if (!props) {
			console.warn(`⚠️ 器件 ${uniqueId} 属性数据不完整`);
			continue;
		}

		// 提取引脚数据 - 区分 V2 和 V3 结构
		if (isV3 && componentData.pinInfoMap) {
			// V3 逻辑: 使用 pinInfoMap, 结构为 { "1": { "net": "GND" }, ... }
			const pinEntries = Object.entries(componentData.pinInfoMap);
			for (const [pinNumber, pinInfo] of pinEntries) {
				formatted.push({
					uniqueId: uniqueId,
					designator: props.Designator,
					pin: pinNumber,
					netName: pinInfo && pinInfo.net ? pinInfo.net : '',
				});
			}
		} else if (componentData.pins) {
			// V2 逻辑: 使用 pins, 结构为 { "1": "GND", ... }
			const pinEntries = Object.entries(componentData.pins);
			for (const [pinNumber, netName] of pinEntries) {
				formatted.push({
					uniqueId: uniqueId,
					designator: props.Designator,
					pin: pinNumber,
					netName: netName || '',
				});
			}
		} else {
			console.warn(`⚠️ 器件 ${uniqueId} 没有找到 pins 或 pinInfoMap 数据`);
		}
	}

	console.log(`共提取 ${formatted.length} 个引脚信息`);
	return formatted;
}

// 格式化PCB网表数据
function formatPCBNetlist(pcbData) {
	const formatted = [];

	// PCB数据可能是单个器件对象，也可能是数组
	const components = Array.isArray(pcbData) ? pcbData : [pcbData];

	for (const component of components) {
		// 检查是否是器件类型
		if (component.primitiveType !== 'Component') {
			continue;
		}

		// 提取器件基本信息
		const uniqueId = component.uniqueId;
		const designator = component.designator;

		// 处理引脚数据
		if (component.pads && Array.isArray(component.pads)) {
			for (const pad of component.pads) {
				formatted.push({
					uniqueId: uniqueId,
					designator: designator,
					pin: pad.num,
					netName: pad.net || '',
				});
			}
		}
	}

	return formatted;
}

// 格式化文件网表数据
function formatFileNetlist(fileData, selectedComponents) {
	// 文件格式与原理图网表格式相同，调用统一处理函数
	return formatSchematicNetlist(fileData, selectedComponents);
}

// 处理网表数据，找出需要放置导线的引脚
function processNetlistData(componentIds, uniqueId, designator, schematicNetlist, pcbNetlist) {
	const result = [];

	// 只处理当前选中的器件
	const relevantPCBPins = pcbNetlist.filter((item) => item.uniqueId === uniqueId);
	const relevantSchematicPins = schematicNetlist.filter((item) => item.uniqueId === uniqueId);

	for (const pcbPin of relevantPCBPins) {
		// 在原理图网表中查找对应的引脚
		const schematicPin = relevantSchematicPins.find((item) => item.pin === pcbPin.pin);

		// 如果原理图中该引脚没有网络名称，但PCB中有网络名称，则需要放置导线
		const hasSchematicNet = schematicPin && schematicPin.netName && schematicPin.netName.trim() !== '';
		const hasPCBNet = pcbPin.netName && pcbPin.netName.trim() !== '';

		if (!hasSchematicNet && hasPCBNet) {
			// 为每个图元ID都创建引脚数据
			for (const componentId of componentIds) {
				result.push({
					componentId: componentId,
					uniqueId: uniqueId,
					designator: designator,
					pin: pcbPin.pin,
					netName: pcbPin.netName,
				});
			}
		}
	}
	return result;
}

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
					console.warn(`在图元 ${componentId} 中未找到引脚 ${pinNumber}`);
				}
			}
		} catch (error) {
			eda.sys_Log.add(`获取图元 ${componentId} 引脚信息失败:`, 'error');
			eda.sys_PanelControl.openBottomPanel('log');
			console.error(`获取图元 ${componentId} 引脚信息失败:`, error);
		}
	}

	return positions;
}

// 为引脚绘制导线
async function drawWiresForPins(pinsData) {
	const results = [];

	// 先批量获取所有引脚的位置信息，提高效率
	const pinPositions = await getMultiplePinPositions(pinsData);

	for (const pinData of pinsData) {
		try {
			const { componentId, pin, netName } = pinData;

			// 从预获取的位置信息中查找
			const pinInfo = pinPositions[`${componentId}_${pin}`];

			if (!pinInfo) {
				eda.sys_Log.add(`未找到引脚 ${pin} 的位置信息`, 'warn');
				eda.sys_PanelControl.openBottomPanel('log');
				console.warn(`未找到引脚 ${pin} 的位置信息`);
				results.push({
					componentId: componentId,
					pin: pin,
					netName: netName,
					success: false,
					error: '未找到引脚位置',
				});
				continue;
			}

			// 绘制导线
			const drawResult = await drawSingleWire(pinInfo, netName);

			results.push({
				componentId: componentId,
				pin: pin,
				netName: netName,
				pinName: pinInfo.pinName,
				success: !!drawResult,
				wireId: drawResult?.primitiveId,
				coordinates: {
					start: { x: pinInfo.x, y: pinInfo.y },
					angle: pinInfo.angle,
				},
			});

			// 添加短暂延迟，避免操作过快
			// await delay(100);
		} catch (error) {
			console.error(`为引脚 ${pinData.pin} 绘制导线失败:`, error);
			results.push({
				componentId: pinData.componentId,
				pin: pinData.pin,
				netName: pinData.netName,
				success: false,
				error: error.message,
			});
		}
	}

	return results;
}

// 绘制单根导线
async function drawSingleWire(pinInfo, netName) {
	const { x, y, angle } = pinInfo;
	// console.log(x, y, angle);
	let startX, startY, endX, endY;

	switch (angle) {
		case 0:
			startX = x;
			startY = y;
			endX = startX + WIRE_LENGTH;
			endY = startY;
			break;
		case 90:
			startX = x;
			startY = y;
			endX = startX;
			endY = startY - WIRE_LENGTH;
			break;
		case 180:
			startX = x;
			startY = y;
			endX = startX - WIRE_LENGTH;
			endY = startY;
			break;
		case 270:
			startX = x;
			startY = y;
			endX = startX;
			endY = startY + WIRE_LENGTH;
			break;
		default:
			// 默认向右
			startX = x;
			startY = y;
			endX = startX + WIRE_LENGTH;
			endY = startY;
			console.warn(`未知的角度 ${angle}，使用默认方向`);
	}

	try {
		const result = await eda.sch_PrimitiveWire.create([startX, startY, endX, endY], netName);
		// console.log("导线绘制成功:", result);
		return result;
	} catch (error) {
		eda.sys_Log.add('绘制导线失败', 'error');
		console.log([startX, startY, endX, endY], netName);
		eda.sys_PanelControl.openBottomPanel('log');
		throw error;
	}
}

// 延迟函数
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
