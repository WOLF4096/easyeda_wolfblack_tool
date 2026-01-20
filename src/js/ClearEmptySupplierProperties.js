export async function ClearEmptySupplierProperties(dataSource = 'PCB') {
	// 弹窗确认
	eda.sys_Dialog.showConfirmationMessage('即将清空供应商为空的多余属性值，是否继续', '清空多余属性', '是', '否', async (mainButtonClicked) => {
		if (mainButtonClicked) {
			try {
				// 1. 版本检测
				let isV3 = false;
				try {
					if (typeof eda !== 'undefined' && eda.sys_Environment && eda.sys_Environment.getEditorCurrentVersion) {
						const version = eda.sys_Environment.getEditorCurrentVersion();
						console.log('当前EDA版本:', version);
						if (version && version.toString().startsWith('3')) {
							isV3 = true;
						}
					}
				} catch (e) {
					console.warn('版本检测失败，默认使用V2模式', e);
				}

				let getNetlist;
				let NetList;
				try {
					getNetlist = await eda.pcb_ManufactureData.getNetlistFile('JLCEDA');
					NetList = await getNetlist.text();
					Page = 'PCB';
				} catch (error) {
					getNetlist = await eda.sch_ManufactureData.getNetlistFile('JLCEDA');
					NetList = await getNetlist.text();
					Page = 'SCH';
				}
				// console.log(NetList);
				jsonData = JSON.parse(NetList);
				// 2. 确定组件遍历的数据源
				// V2: jsonData 直接就是组件Map
				// V3: jsonData.components 才是组件Map
				let componentsMap = jsonData;
				if (isV3 && jsonData.components) {
					componentsMap = jsonData.components;
					console.log('识别为 V3 格式网表');
				} else {
					console.log('识别为 V2 格式网表');
				}

				// 根据数据源定义不同的基础属性列表
				const schematicBaseProperties = [
					'Symbol',
					'Designator',
					'Add into BOM',
					'Convert to PCB',
					'Footprint',
					'Name',
					'Device',
					'Reuse Block',
					'Group ID',
					'Channel ID',
					'Unique ID',
					'FootprintName',
					'DeviceName',
					'SymbolName',
					'Footprint Name',
				];

				const pcbBaseProperties = [
					'Footprint',
					'Designator',
					'Add into BOM',
					'3D Model',
					'3D Model Title',
					'3D Model Transform',
					'Name',
					'Device',
					'Unique ID',
					'FootprintName',
					'DeviceName',
					'Group ID',
					'Channel ID',
					'Reuse Block',
					'Convert to PCB',
				];

				// 根据数据源选择对应的基础属性列表
				const baseProperties = dataSource === 'SCH' ? schematicBaseProperties : pcbBaseProperties;
				console.log(`使用${dataSource}基础属性列表，共${baseProperties.length}个属性`);

				// 处理数据
				let processedCount = 0;

				// 3. 遍历 componentsMap 而不是 jsonData
				for (const key in componentsMap) {
					if (componentsMap.hasOwnProperty(key)) {
						const component = componentsMap[key];

						// 检查是否存在props且Supplier为空
						// 注意：V3结构中非组件节点可能没有props，需要防御性编程
						if (component.props && (!component.props.Supplier || component.props.Supplier === '')) {
							// 遍历所有属性，清空非基础属性的值
							for (const prop in component.props) {
								if (component.props.hasOwnProperty(prop)) {
									// 如果不是基础属性，则清空其值
									if (!baseProperties.includes(prop)) {
										component.props[prop] = ''; // 清空值而不是删除属性
									}
								}
							}

							processedCount++;
						}
					}
				}

				console.log(`处理完成，共处理了 ${processedCount} 个元件`);

				// 写回数据
				// componentsMap 是 jsonData 的引用(V3)或本身(V2)，所以直接序列化 jsonData 即可
				const updatedJsonString = JSON.stringify(jsonData, null, 2);
				let writeSuccess = false;

				try {
					// 根据数据源选择相应的写回方式
					if (dataSource === 'SCH') {
						await eda.sch_Netlist.setNetlist('JLCEDA', updatedJsonString);
					} else {
						await eda.pcb_Net.setNetlist('JLCEDA', updatedJsonString);
					}
					writeSuccess = true;
					console.log(`写回${dataSource}成功`);
				} catch (writeError) {
					console.warn(`写回${dataSource}失败:`, writeError);
				}

				if (writeSuccess) {
					eda.sys_Message.showToastMessage(`成功清空 ${processedCount} 个元件的多余属性值`, 2);
					eda.sys_Log.add(`成功清空 ${processedCount} 个元件的多余属性值 (数据源: ${dataSource}, 版本: ${isV3 ? 'V3' : 'V2'})`, 'info');
					eda.sys_PanelControl.openBottomPanel('log');
				}
			} catch (error) {
				console.error('处理过程中发生未知错误:', error);
				eda.sys_Message.showToastMessage('处理过程中发生错误: ' + error.message, 2);
			}
		} else {
			// 选择否执行
			eda.sys_Message.showToastMessage('已取消操作', 2);
		}
	});
}
