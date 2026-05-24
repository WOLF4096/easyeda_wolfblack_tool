export async function RefreshNetlist(Page = 'PCB') {
	try {
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
		
		console.log("原始 NetList:", NetList);

		if (NetList) {
			try {
				let netlistObj = JSON.parse(NetList);

				// 兼容两种网表结构：
				// 1. 新版/完整版：组件包裹在 components 对象中 (netlistObj.components)
				// 2. 简版/旧版：组件直接作为根节点的属性 (netlistObj 就是包含 ggeX 的对象)
				let componentsTarget = netlistObj.components ? netlistObj.components : netlistObj;

				// 遍历目标对象中的所有键
				for (let key in componentsTarget) {
					let comp = componentsTarget[key];
					
					// 安全检查：确保当前遍历到的是一个包含 props 的组件对象
					if (comp && typeof comp === 'object' && comp.props) {
						let props = comp.props;
						
						if (props.Name) {
							// 使用正则匹配 "={xxx}" 格式
							let match = props.Name.match(/^=\{([^}]+)\}$/);
							if (match && match[1]) {
								let targetKey = match[1]; // 提取键名，例如 "Value" 或 "Manufacturer Part"
								
								// 如果 props 中存在这个对应的键，则将其值赋给 Name
								if (props[targetKey] !== undefined) {
									props.Name = props[targetKey];
								}
							}
						}
					}
				}

				// 将修改后的 JSON 对象重新转回字符串，由于是引用修改，netlistObj 已经是最新的状态
				NetList = JSON.stringify(netlistObj, null, 4);
				console.log("处理后的 NetList:", NetList);

			} catch (parseError) {
				console.error("解析或处理 NetList JSON 失败:", parseError);
				eda.sys_Message.showToastMessage('JSON 数据解析失败，请检查数据格式', 2);
				return; // 解析失败则终止写回
			}
		}

		let writeSuccess = false;

		try {
			// 根据数据源选择相应的写回方式
			if (Page === 'SCH') {
				await eda.sch_Netlist.setNetlist('JLCEDA', NetList);
			} else {
				await eda.pcb_Net.setNetlist('JLCEDA', NetList);
			}
			writeSuccess = true;
			console.log(`写回${Page}成功`);
		} catch (writeError) {
			console.warn(`写回${Page}失败:`, writeError);
		}

	} catch (error) {
		console.error('处理过程中发生未知错误:', error);
		eda.sys_Message.showToastMessage('处理过程中发生错误: ' + error.message, 2);
	}
}
