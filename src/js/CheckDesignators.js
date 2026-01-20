// 位号查重
export async function checkDuplicateDesignators() {
	try {
		// 使用接口获取器件全部信息
		let components = await eda.pcb_PrimitiveComponent.getAll();

		// 使用接口获取pcbid信息
		let pcbInfo = await eda.dmt_Pcb.getCurrentPcbInfo();
		const pcbid = pcbInfo.uuid + '@' + pcbInfo.parentProjectUuid;

		// 用于存储位号和对应primitiveId的映射
		const designatorMap = {};

		// 遍历所有器件，按位号分组
		for (let i = 0; i < components.length; i++) {
			const component = components[i];
			const designator = component.designator;
			const primitiveId = component.primitiveId;

			if (designator) {
				const upperDesignator = designator.toUpperCase();
				if (!designatorMap[upperDesignator]) {
					designatorMap[upperDesignator] = [];
				}
				designatorMap[upperDesignator].push({
					designator: designator,
					primitiveId: primitiveId,
				});
			}
		}

		// 检查重复位号并输出
		let hasDuplicates = false;

		for (const [upperDesignator, items] of Object.entries(designatorMap)) {
			if (items.length > 1) {
				hasDuplicates = true;
				const duplicateList = items
					.map(
						(item) =>
							`<span class="link" data-log-find-id="${item.primitiveId}" data-log-find-pcbid="${pcbid}" data-log-find-path="">${item.designator}(${item.primitiveId})</span>`,
					)
					.join('、');

				// 在日志中输出警告信息
				eda.sys_Log.add(`重复位号：${duplicateList}`, 'warn');
			}
		}

		if (!hasDuplicates) {
			eda.sys_Log.add('未发现重复位号', 'info');
		}
		eda.sys_PanelControl.openBottomPanel('log');
	} catch (error) {
		console.error('位号查重失败:', error);
		eda.sys_Log.add('位号查重失败：' + error.message, 'error');
		eda.sys_PanelControl.openBottomPanel('log');
	}
}
