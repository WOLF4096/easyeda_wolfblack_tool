// 主函数：从网表文件读取3D模型信息并更新PCB器件
// 有bug，可以修改模型，但"3D Model Title"似乎没变
export async function update3DModelsFromNetlist() {
	try {
		// 版本检测日志
		try {
			if (typeof eda !== 'undefined' && eda.sys_Environment && eda.sys_Environment.getEditorCurrentVersion) {
				const version = eda.sys_Environment.getEditorCurrentVersion();
				console.log('当前EDA版本:', version);
			}
		} catch (e) {
			console.warn('版本检测忽略');
		}

		// 1. 导入网表文件
		console.log('步骤1: 导入网表文件...');
		const netlistData = await importNetlistFile();
		if (!netlistData) return;

		// 2. 创建Designator到3D模型信息的映射
		console.log('步骤2: 解析网表文件...');
		const designator3DMap = parseNetlist3DInfo(netlistData);
		const mapSize = Object.keys(designator3DMap).length;
		console.log(`找到 ${mapSize} 个带3D模型的器件`);

		if (mapSize === 0) {
			eda.sys_Message.showToastMessage('未在网表中找到有效的3D模型数据，请检查网表格式', 'warn');
			return;
		}

		// 3. 获取PCB中所有器件
		console.log('步骤3: 获取PCB器件信息...');
		const pcbComponents = await getAllPCBComponents();
		console.log(`PCB中共有 ${pcbComponents.length} 个器件`);

		// 4. 匹配并更新器件
		console.log('步骤4: 匹配并更新3D模型...');
		const updateResults = await matchAndUpdateComponents(pcbComponents, designator3DMap);

		// 5. 显示结果
		showUpdateResults(updateResults);
	} catch (error) {
		console.error('更新过程中出现错误:', error);
		eda.sys_Message.showToastMessage('更新失败: ' + error.message, 'error');
	}

	// 1. 导入网表文件
	async function importNetlistFile() {
		try {
			const fileResult = await eda.sys_FileSystem.openReadFileDialog();
			if (!fileResult) {
				eda.sys_Message.showToastMessage('未选择文件', 'warn');
				return null;
			}

			let fileContent;
			if (typeof fileResult === 'object' && fileResult.text) {
				fileContent = await fileResult.text();
			} else {
				fileContent = fileResult;
			}

			let jsonString;
			if (Array.isArray(fileContent)) {
				jsonString = fileContent.join('');
			} else if (typeof fileContent === 'string') {
				jsonString = fileContent;
			} else {
				throw new Error('不支持的文件格式');
			}

			// 清理和解析JSON
			jsonString = jsonString.trim();
			const jsonObject = JSON.parse(jsonString);

			eda.sys_Message.showToastMessage('网表文件导入成功', 'success');
			return jsonObject;
		} catch (error) {
			console.error('导入网表文件失败:', error);
			eda.sys_Message.showToastMessage('导入失败: ' + error.message, 'error');
			return null;
		}
	}

	// 2. 解析网表文件中的3D模型信息 (兼容 V2/V3)
	function parseNetlist3DInfo(netlistData) {
		const designator3DMap = {};
		let count = 0;

		// --- 兼容性处理开始 ---
		let componentsSource = netlistData;
		let isV3Data = false;

		// V3 版本的网表，组件信息在 'components' 字段下
		if (netlistData && netlistData.components) {
			componentsSource = netlistData.components;
			isV3Data = true;
			console.log('识别为 V3 格式网表结构');
		} else {
			console.log('识别为 V2 格式网表结构');
		}
		// --- 兼容性处理结束 ---

		for (const key in componentsSource) {
			const component = componentsSource[key];
			// 确保是有效组件对象（V3中可能包含其他元数据，需校验props）
			if (component && component.props) {
				const designator = component.props.Designator;
				const model3D = component.props['3D Model'];
				const modelTitle = component.props['3D Model Title'];
				const modelTransform = component.props['3D Model Transform'];

				// 确保有Designator和3D模型信息
				if (designator && model3D && modelTitle && modelTransform) {
					designator3DMap[designator] = {
						'3D Model': model3D,
						'3D Model Title': modelTitle,
						'3D Model Transform': modelTransform,
					};
					count++;

					// 可选：输出前几个作为示例
					if (count <= 3) {
						console.log(`[解析] 找到器件: ${designator}, 3D模型: ${modelTitle}`);
					}
				}
			}
		}

		return designator3DMap;
	}

	// 3. 获取PCB中所有器件
	async function getAllPCBComponents() {
		try {
			const components = await eda.pcb_PrimitiveComponent.getAll();

			// 过滤出有效的器件（有primitiveId）
			const validComponents = components.filter((comp) => comp && comp.primitiveId && comp.designator);

			return validComponents;
		} catch (error) {
			console.error('获取PCB器件失败:', error);
			throw error;
		}
	}

	// 4. 匹配并更新器件
	async function matchAndUpdateComponents(pcbComponents, designator3DMap) {
		const results = {
			total: 0,
			matched: 0,
			updated: 0,
			failed: 0,
			details: [],
		};

		for (const component of pcbComponents) {
			results.total++;
			const designator = component.designator;
			const primitiveId = component.primitiveId;

			if (!designator || !primitiveId) {
				// console.warn(`器件缺少designator或primitiveId:`, component);
				continue;
			}

			// 检查是否在网表中有匹配的3D模型
			if (designator3DMap[designator]) {
				results.matched++;
				const modelInfo = designator3DMap[designator];

				try {
					// console.log(`正在更新器件 ${designator} (ID: ${primitiveId})`);

					// 更新3D模型信息
					await eda.pcb_PrimitiveComponent.modify(primitiveId, {
						otherProperty: {
							'3D Model': modelInfo['3D Model'],
							'3D Model Title': modelInfo['3D Model Title'],
							'3D Model Transform': modelInfo['3D Model Transform'],
						},
					});

					results.updated++;
					results.details.push({
						designator,
						primitiveId,
						success: true,
						modelTitle: modelInfo['3D Model Title'],
						message: '更新成功',
					});

					// console.log(`✓ ${designator}: 3D模型更新成功`);
				} catch (error) {
					results.failed++;
					results.details.push({
						designator,
						primitiveId,
						success: false,
						modelTitle: modelInfo['3D Model Title'],
						message: error.message || '更新失败',
					});

					console.error(`✗ ${designator}: 更新失败`, error);
				}
			}
		}

		return results;
	}

	// 5. 显示更新结果
	function showUpdateResults(results) {
		eda.sys_Log.add('========== 更新结果汇总 ==========', 'info');
		eda.sys_Log.add(`总共PCB器件: ${results.total}`, 'info');
		eda.sys_Log.add(`匹配到的器件: ${results.matched}`, 'info');
		eda.sys_Log.add(`成功更新: ${results.updated}`, 'info');
		eda.sys_Log.add(`更新失败: ${results.failed}`, 'info');
		eda.sys_Log.add('=================================', 'info');
		eda.sys_PanelControl.openBottomPanel('log');

		// 显示详细信息
		if (results.failed > 0) {
			console.log('失败的器件:');
			results.details
				.filter((item) => !item.success)
				.forEach((item) => {
					console.log(`  ${item.designator}: ${item.message}`);
				});
		}

		// 显示成功的前几个作为示例
		if (results.updated > 0) {
			console.log('成功更新的示例:');
			results.details
				.filter((item) => item.success)
				.slice(0, 5)
				.forEach((item) => {
					console.log(`  ${item.designator}: ${item.modelTitle}`);
				});

			if (results.updated > 5) {
				console.log(`  ...还有 ${results.updated - 5} 个器件`);
			}
		}

		// 显示消息
		const message = `更新完成: 成功 ${results.updated}/${results.matched} 个器件`;
		eda.sys_Message.showToastMessage(message, 'success');
	}
}
