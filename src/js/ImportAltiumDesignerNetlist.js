export async function ImportAltiumDesignerNetlist() {
	// 1. 打开导入窗口，选择 AD 格式网表文件 (.net)
	const listtxt = await eda.sys_FileSystem.openReadFileDialog();
	if (!listtxt) {
		console.log('用户取消了文件选择');
		return;
	}
	let adFileContent = await listtxt.text();

	// 2. 获取当前 PCB 的 JLCEDA 格式网表
	let getNetlist = await eda.pcb_ManufactureData.getNetlistFile('JLCEDA');
	let currentNetlistStr = await getNetlist.text();
	let jlcedaData = JSON.parse(currentNetlistStr);

	// ================= 处理过程开始 =================

	// 步骤 A: 兼容性处理 - 确定组件列表的位置
	let componentList = null;

	// 情况 1: 格式 A (components 包含在对象内)
	if (jlcedaData.components) {
		componentList = jlcedaData.components;
	}
	// 情况 2: 格式 B (根对象即为组件列表，通过检查是否包含 $ 开头的键或 props 属性来判断)
	else {
		componentList = jlcedaData;
	}

	// 步骤 B: 建立索引映射 (Designator -> Component Object)
	let designatorMap = {};
	for (let key in componentList) {
		// 过滤掉非组件的键（例如 "version", "designRule" 等可能存在于根目录的非组件数据）
		if (key === 'version' || key === 'designRule' || key === 'netClass') continue;

		let comp = componentList[key];
		if (comp && comp.props && comp.props.Designator) {
			designatorMap[comp.props.Designator] = comp;
		}
	}

	// 步骤 C: 解析 AD 网表并更新数据
	const netBlocks = adFileContent.match(/\(([\s\S]*?)\)/g);

	if (netBlocks) {
		netBlocks.forEach((block) => {
			let lines = block
				.replace(/^\(|\)$/g, '')
				.trim()
				.split(/\r?\n/);
			lines = lines.map((l) => l.trim()).filter((l) => l);

			if (lines.length > 1) {
				let netName = lines[0]; // 第一行是网络名

				for (let i = 1; i < lines.length; i++) {
					let parts = lines[i].split('-'); // 格式如 Q1-3

					if (parts.length === 2) {
						let refDes = parts[0];
						let pinNo = parts[1];

						if (designatorMap[refDes]) {
							let comp = designatorMap[refDes];

							// 核心兼容逻辑：判断是 pinInfoMap 还是 pins 结构
							if (comp.pinInfoMap) {
								// --- 适配格式 A (Netlist_PCB2) ---
								// 结构: pinInfoMap: { "1": { "net": "..." } }
								if (!comp.pinInfoMap[pinNo]) {
									// 如果引脚对象不存在，初始化它
									comp.pinInfoMap[pinNo] = { name: '', number: pinNo, net: '' };
								}
								comp.pinInfoMap[pinNo].net = netName;
							} else {
								// --- 适配格式 B (Netlist_PCB3) ---
								// 结构: pins: { "1": "..." }
								if (!comp.pins) {
									comp.pins = {};
								}
								comp.pins[pinNo] = netName;
							}
						} else {
							console.warn(`未在 PCB 中找到位号为 ${refDes} 的元件，跳过。`);
						}
					}
				}
			}
		});
	}

	// ================= 处理过程结束 =================

	// 3. 将修改后的 JLCEDA 网表写回编辑器
	const listjson = JSON.stringify(jlcedaData);
	await eda.pcb_Net.setNetlist('JLCEDA', listjson);

	console.log('网表转换并导入完成！支持多版本格式。');
}
