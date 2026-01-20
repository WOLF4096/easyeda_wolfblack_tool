export async function placeComponentsEfficiently(viewType = 'PCB') {
	// ================= 全局配置 =================
	const CONFIG = {
		// 布局参数
		originX: 0,
		originY: 0,
		spacingX: 200, // X轴间距
		spacingY: 200, // Y轴间距
		itemsPerRow: 20, // 每行多少个

		// 字体配置
		progressFont: '宋体', // 进度条专用字体 (等宽显示进度块)
		defaultFont: 'Arial', // 其他文本默认字体
		fontSize: 14, // 默认字号

		// 颜色配置
		uuidFontColor: '#00FF00', // 成功颜色 (绿)
		errorFontColor: '#ff0000', // 失败颜色 (红)
		infoFontColor: '#00FF00', // 进度条颜色 (黄)
		statsFontColor: '#00FF00', // 统计颜色 (白)
	};

	// ================= 状态变量 =================
	let _lastSchematicTabId = null;
	let isV3 = false;

	// 统计计数器
	let stats = {
		queryCount: 0,
		cacheHitCount: 0,
		lookupStartTime: 0,
		lookupEndTime: 0,
		placeStartTime: 0,
		placeEndTime: 0,
	};

	// 1. 版本检测
	try {
		if (typeof eda !== 'undefined' && eda.sys_Environment && eda.sys_Environment.getEditorCurrentVersion) {
			const version = eda.sys_Environment.getEditorCurrentVersion();
			console.log('当前EDA版本:', version);
			if (version && version.toString().startsWith('3')) {
				isV3 = true;
			}
		}
	} catch (e) {
		console.warn('版本检测忽略', e);
	}

	// ================= 数据准备 =================
	let jsonObject;
	let netdataa;
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	try {
		if (viewType === 'NET') {
			const listtxt = await eda.sys_FileSystem.openReadFileDialog();
			let fileContent = await listtxt.text();
			let jsonString = Array.isArray(fileContent) ? fileContent.join('') : fileContent;
			netdataa = jsonString.trim();
		} else if (viewType === 'PCB') {
			await switchToPCB();
			eda.sys_Message.showToastMessage('正在获取数据...', 2);
			const getNetlistFile = await eda.pcb_ManufactureData.getNetlistFile();
			netdataa = await getNetlistFile.text();
			await switchToSchematic();
			await delay(500);
		} else {
			throw new Error(`不支持的导入方式: ${viewType}`);
		}

		if (!netdataa) throw new Error('网表数据为空');
		jsonObject = JSON.parse(netdataa);
	} catch (err) {
		eda.sys_Message.showToastMessage(err.message, 'error');
		console.error(err);
		return;
	}

	// 2. 数据标准化
	let componentsMap = jsonObject;
	if (isV3 && jsonObject.components) {
		componentsMap = jsonObject.components;
	}

	// 获取系统库UUID
	let libUuid = '';
	try {
		libUuid = await eda.lib_LibrariesList.getSystemLibraryUuid();
	} catch (e) {
		console.warn('获取库UUID失败', e);
	}

	// ================= 核心逻辑 =================

	const successList = [];
	const failList = [];
	const cNumberCache = new Map(); // key: C编号, value: uuid (or null)

	// 提取所有组件
	const allComponents = Object.entries(componentsMap).map(([key, val]) => {
		return {
			uniqueId: key,
			designator: val.props['Designator'] || 'Unknown',
			name: val.props['Name'] || '',
			cNumber: (val.props['Supplier Part'] || '').trim().toUpperCase(),
		};
	});

	// 创建UI提示 (使用默认字体)
	await createInfoTexts();

	// 创建进度条文本对象 (使用宋体!!)
	const lookupProgressText = await eda.sch_PrimitiveText.create(
		10,
		-50,
		'查找器件：等待开始...',
		0,
		CONFIG.infoFontColor,
		CONFIG.progressFont,
		16,
		false,
		false,
		false,
		0,
	);
	const placeProgressText = await eda.sch_PrimitiveText.create(
		10,
		-70,
		'放置器件：等待开始...',
		0,
		CONFIG.infoFontColor,
		CONFIG.progressFont,
		16,
		false,
		false,
		false,
		0,
	);

	// --- 阶段一：查找 UUID ---
	stats.lookupStartTime = Date.now();
	let processedCount = 0;
	const total = allComponents.length;

	// 初始化进度条
	updateProgressBar(lookupProgressText, '查找器件', 0, total);
	updateProgressBar(placeProgressText, '放置器件', 0, 0);

	for (const comp of allComponents) {
		processedCount++;
		// 每5个或最后一个更新一次UI，避免过于频繁
		if (processedCount % 5 === 0 || processedCount === total) {
			updateProgressBar(lookupProgressText, '查找器件', processedCount, total);
		}

		const { cNumber } = comp;

		// 1. 检查 C 编号格式
		if (!cNumber || !cNumber.startsWith('C')) {
			failList.push({ ...comp, reason: 'C编号为空' });
			continue;
		}

		// 2. 检查缓存
		if (cNumberCache.has(cNumber)) {
			stats.cacheHitCount++;
			const cachedUuid = cNumberCache.get(cNumber);
			if (cachedUuid) {
				successList.push({ ...comp, uuid: cachedUuid });
			} else {
				failList.push({ ...comp, reason: 'C编号查找异常' });
			}
			continue;
		}

		// 3. API 查询
		try {
			stats.queryCount++;
			const result = await eda.lib_Device.getByLcscIds(cNumber, '', false);
			if (result && result.length > 0 && result[0].uuid) {
				const foundUuid = result[0].uuid;
				cNumberCache.set(cNumber, foundUuid);
				successList.push({ ...comp, uuid: foundUuid });
			} else {
				cNumberCache.set(cNumber, null); // 标记无效
				failList.push({ ...comp, reason: 'C编号查找异常' });
			}
		} catch (error) {
			console.error(`API fail: ${cNumber}`, error);
			failList.push({ ...comp, reason: 'API请求超时' });
		}
	}
	stats.lookupEndTime = Date.now();
	// 强制更新到100%
	updateProgressBar(lookupProgressText, '查找器件', total, total);

	// --- 阶段二：排序 ---
	const sortFn = (a, b) => a.designator.localeCompare(b.designator, undefined, { numeric: true, sensitivity: 'base' });
	successList.sort(sortFn);
	failList.sort(sortFn);

	// --- 阶段三：放置 ---
	stats.placeStartTime = Date.now();

	// 3.1 放置成功 (右上)
	await placeBatch(successList, 100, 100, 1, 1, 'component', placeProgressText, total);

	// 3.2 放置失败 (左上)
	await placeBatch(failList, -100, 100, -1, 1, 'text', placeProgressText, total);

	stats.placeEndTime = Date.now();

	// 强制更新到100%
	updateProgressBar(placeProgressText, '放置器件', total, total);

	// --- 阶段四：统计 ---
	await showFinalStatistics(total, successList.length, failList.length);

	// ================= 内部功能函数 =================

	// 进度条渲染函数
	function updateProgressBar(textObj, label, current, total) {
		if (!textObj) return;

		// 计算进度
		const percent = total > 0 ? current / total : 0;
		const percentInt = Math.floor(percent * 100);

		// 绘制条形 (总长20个字符)
		const barLength = 20;
		const fillCount = Math.floor(barLength * percent);
		const emptyCount = barLength - fillCount;
		const barStr = '█'.repeat(fillCount) + '—'.repeat(emptyCount);

		// 格式: 查找器件：██████████———— 70%  (70/100)
		const content = `${label}：${barStr} ${percentInt}%  (${current}/${total})`;

		eda.sch_PrimitiveText.modify(textObj.primitiveId, { 'content': content });
	}

	async function placeBatch(list, startX, startY, dirX, dirY, type, progressObj, totalItems) {
		let x = startX;
		let y = startY;
		let countRow = 0;

		// 获取当前全局已处理数量（如果是第二批failList，需要加上successList的长度）
		let processedOffset = type === 'text' ? successList.length : 0;

		const promises = [];

		for (let i = 0; i < list.length; i++) {
			const item = list[i];

			// 更新进度条
			if (i % 10 === 0 || i === list.length - 1) {
				updateProgressBar(progressObj, '放置器件', processedOffset + i + 1, totalItems);
			}

			if (type === 'component') {
				const p = eda.sch_PrimitiveComponent
					.create({ 'libraryUuid': libUuid, 'uuid': item.uuid }, x, y, '', 0, false, true, true)
					.then((compInst) => {
						if (compInst) {
							compInst.setState_UniqueId(item.uniqueId);
							compInst.setState_Designator(item.designator);
							compInst.setState_Name(item.name);
							compInst.done();
						}
					})
					.catch((e) => console.error('Place error', e));
				promises.push(p);
			} else {
				// 放置失败文本，格式：
				// '位号：C22\n名称：Name\nID：[唯一ID]\n失败：C编号为空'
				const content = `位号：${item.designator}\n名称：${item.name}\n唯一ID：${item.uniqueId}\n失败原因：${item.reason}`;

				// 使用默认字体(Arial)放置失败文本，颜色红色
				const p = eda.sch_PrimitiveText.create(
					x,
					y,
					content,
					0,
					CONFIG.errorFontColor,
					CONFIG.defaultFont,
					CONFIG.fontSize,
					false,
					false,
					false,
					0,
				);
				promises.push(p);
			}

			// 坐标计算
			countRow++;
			if (countRow >= CONFIG.itemsPerRow) {
				countRow = 0;
				x = startX;
				y += CONFIG.spacingY * dirY;
			} else {
				x += CONFIG.spacingX * dirX;
			}

			// 并发控制
			if (promises.length >= 100) {
				await Promise.all(promises);
				promises.length = 0;
			}
		}
		await Promise.all(promises);
	}

	async function showFinalStatistics(total, success, fail) {
		const lookupTime = (stats.lookupEndTime - stats.lookupStartTime) / 1000;
		const placeTime = (stats.placeEndTime - stats.placeStartTime) / 1000;
		const totalTime = ((stats.placeEndTime - stats.lookupStartTime) / 1000).toFixed(2);
		const avgTime = total > 0 ? (totalTime / total).toFixed(3) : 0;

		const hitRate =
			stats.queryCount + stats.cacheHitCount > 0 ? ((stats.cacheHitCount / (stats.queryCount + stats.cacheHitCount)) * 100).toFixed(2) : '0.00';

		const report = `
==== 统计信息 ====

总器件数: ${total}
放置成功: ${success}
放置失败: ${fail}

查询次数: ${stats.queryCount}
缓存命中: ${stats.cacheHitCount}
缓存命中率: ${hitRate}%

器件查找耗时: ${lookupTime.toFixed(2)}秒
器件放置耗时: ${placeTime.toFixed(2)}秒
总耗时: ${totalTime}秒
平均每个器件: ${avgTime}秒
`.trim();

		// 创建统计文本 (在进度条下方，使用默认字体)
		await eda.sch_PrimitiveText.create(10, -100, report, 0, CONFIG.statsFontColor, CONFIG.defaultFont, 16, false, false, false, 0);

		eda.sys_Message.showToastMessage(`完成! 成功:${success}, 失败:${fail}`, 'success');
	}

	async function createInfoTexts() {
		// 使用默认字体
		await eda.sch_PrimitiveText.create(10, 30, '匹配成功 ↗', 0, CONFIG.uuidFontColor, CONFIG.defaultFont, 24, true, false, false, 0);
		await eda.sch_PrimitiveText.create(-120, 30, '↖ 匹配失败', 0, CONFIG.errorFontColor, CONFIG.defaultFont, 24, true, false, false, 0);
		await eda.sch_PrimitiveText.create(
			10,
			-10,
			'放置过程中不要做其他操作',
			0,
			CONFIG.uuidFontColor,
			CONFIG.defaultFont,
			24,
			true,
			false,
			false,
			0,
		);
	}

	async function switchToPCB() {
		const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		if (curDoc && curDoc.documentType === 1) {
			_lastSchematicTabId = curDoc.uuid + '@' + curDoc.parentProjectUuid;
		}
		const boardInfo = await eda.dmt_Board.getCurrentBoardInfo();
		if (!boardInfo || !boardInfo.pcb) throw new Error('未找到板子信息');
		const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
		const pcbTab = splitData.tabs.find((tab) => tab.tabId.includes(boardInfo.pcb.uuid));
		if (pcbTab) {
			await eda.dmt_EditorControl.activateDocument(pcbTab.tabId);
		} else {
			throw new Error('请先打开对应的PCB文件');
		}
	}

	async function switchToSchematic() {
		if (_lastSchematicTabId) {
			await eda.dmt_EditorControl.activateDocument(_lastSchematicTabId);
		}
	}
}
