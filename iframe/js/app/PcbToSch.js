// ---------- 全局状态 ----------
		const WC = window.WolfCommon;
		if (!WC) {
			(document.body || document.documentElement).innerHTML = '<div style="padding:24px;font:14px/1.6 sans-serif;color:#f28b82">公共模块 common.js 未加载，请重新安装扩展</div>';
			throw new Error('[狼黑工具] 公共模块 common.js 未加载');
		}
		const { getEditorVersion, isV2, isModern, escapeHtml, createSchWireLines, logger } = WC;

		let zip = null;                  // 解压后的工程文件
		let projectJson = null;          // project.json 内容
		let components = [];             // 原始元件列表（每个元件一条）
		let mergedRows = [];             // 合并后的表格行数据（用于渲染）
		let version = '';                // EDA 版本
		let candidateSource = '';        // 构建出的源码
		let currentPcbUuid = '';		 // 当前PCB的文件名
		let symbolPinsDatabase = {}; 	 // 缓存符号引脚信息
		let currentSchematicUuid = null; // 当前原理图文档的UUID

		// ---------- DOM 元素 ----------
		// const showDisclaimerBtn = document.getElementById('showDisclaimerBtn');
		// const closeModalBtn = document.getElementById('closeModalBtn');
		const progressFill = document.getElementById('progressFill');
		const progressText = document.getElementById('progressText');
		const versionSpan = document.getElementById('versionDisplay');
		const yvalueCheck = document.getElementById('yvalue');
		// const agreeCheck = document.getElementById('agreeCheck');
		const refreshBtn = document.getElementById('refreshListBtn');
		const tableRows = document.getElementById('tableRows');
		const buildBtn = document.getElementById('buildBtn');
		const writeBtn = document.getElementById('writeBtn');
		// const modal = document.getElementById('disclaimerModal');
		// 更多选项复选框
		const genTitleCheck = document.getElementById('genTitle');
		const genFrameCheck = document.getElementById('genTitle');
		const genWireCheck = document.getElementById('genWire');
		const exportCsvBtn = document.getElementById('exportCsvBtn');
		const errorsCheck = document.getElementById('errors');
		const outfile = document.getElementById('outfile');
		const exportNetBtn = document.getElementById('exportNetBtn');

		try {
			version = getEditorVersion();
			// 取不到版本号 = 不在 EDA 环境，抛错交由下方 catch 统一禁用按钮
			if (!version) {
				throw new Error('未检测到 EDA 环境');
			}
			if (isV2()) {
				versionSpan.textContent = `当前EDA版本：${version} 功能可用`;
				yvalueCheck.checked = false;
			}else if(isModern()){
				versionSpan.textContent = `当前EDA版本：${version} 功能可用`;
				yvalueCheck.checked = true;
			}
			versionSpan.style.color = '#8f8';
		} catch (e) {
			versionSpan.textContent = '当前不在EDA环境，当前版本不支持转换';
			versionSpan.style.color = '#f88';
			refreshBtn.disabled = true;
			// agreeCheck.disabled = true;
			buildBtn.disabled = true;
			writeBtn.disabled = true;
			exportCsvBtn.disabled = true;
			exportNetBtn.disabled = true;
		}


		// 关键词 → Symbol UUID 映射（后续可扩展）
		const keywordToSymbolUuid = {
			'无极电容': '801c26e6ac62427db41c6496435118b6',
			'电阻': '9c1d6a5e19e649e888ff79bf9e87b823',
			'电感': '3f193864f7264a439d7adc22fdbb5dbf'
			// 后续可继续添加
		};

		// ---------- 辅助函数：更新进度条 ----------
		function updateProgress(percent, text) {
			progressFill.style.width = percent + '%';
			progressText.innerText = text;
		}

		// ---------- 辅助函数：延时 ----------
		function delay(ms) {
			return new Promise(resolve => setTimeout(resolve, ms));
		}

		// ---------- 按钮启用状态管理 ----------
		// agreeCheck.addEventListener('change', () => {
		// 	refreshBtn.disabled = !agreeCheck.checked;
		// });

		// 免责声明弹窗
		// showDisclaimerBtn.addEventListener('click', (e) => {
		// 	e.preventDefault();
		// 	modal.style.display = 'flex';
		// });
		// closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
		// modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

		// ---------- 获取数据 ----------
		refreshBtn.addEventListener('click', async () => {
			// if (!agreeCheck.checked) {
			// 	updateProgress(0, '请先勾选《免责声明》');
			// 	return;
			// }

			// 获取分类选项
			const classifyRadio = document.querySelector('input[name="classify"]:checked');
			const classify = classifyRadio ? classifyRadio.value : 'ref';
			// 获取复选框状态
			const genTitle = genTitleCheck.checked;
			const genFrame = genFrameCheck.checked;
			const ignoreMissing = errorsCheck.checked;

			try {
				// 初始化按钮状态
				buildBtn.disabled = true;
				writeBtn.disabled = true;
				outfile.disabled = true;
				// 清空表格
				tableRows.innerHTML = '';
				// 记录开始时间
				const startTime = Date.now();

				// 1. 版本检测
				updateProgress(5, '版本检测');
				logger.debug('当前EDA版本:', version);
				await delay(100); // 稍微停顿，让进度条可见

				// 2. 获取当前原理图页信息
				updateProgress(7, '获取当前原理信息');
				const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
				logger.debug('当前文档信息:', curDoc);
				await delay(100);

				// 3. 获取工程文件（最慢步骤，进度缓慢递增）
				updateProgress(10, '获取工程文件');

				let progressInterval = null;
				let currentProgress = 10;
				const maxWaitProgress = 40;
				const progressStep = 1;
				const stepInterval = 1000;

				progressInterval = setInterval(() => {
					if (currentProgress < maxWaitProgress) {
						currentProgress += progressStep;
						updateProgress(currentProgress, `获取工程文件 (${currentProgress}%)`);
					}
					// 达到40%后停止增加，但保持定时器运行（后续会清除）
				}, stepInterval);

				let epro;
				try {
					epro = await eda.sys_FileManager.getProjectFile('project', undefined, '.epro');
				} catch (error) {
					clearInterval(progressInterval);
					throw error; // 错误由外层 catch 处理
				}
				clearInterval(progressInterval);

				// 4. 加载压缩包并读取 project.json
				updateProgress(45, '读取 project.json');
				zip = await JSZip.loadAsync(epro);
				const projectJsonContent = await zip.file('project.json').async('string');
				projectJson = JSON.parse(projectJsonContent);
				logger.debug('Project JSON:', projectJson);
				await delay(100);

				// 5. 查找对应的PCB UUID
				updateProgress(50, '查找对应的PCB');
				const uuids = findUuids(projectJson, curDoc.uuid);
				currentPcbUuid = projectJson.pcbs[uuids.pcbUuid];

				logger.debug(projectJson.pcbs[uuids.pcbUuid],uuids.pcbUuid);

				logger.debug('找到的UUIDs:', uuids);
				currentSchematicUuid = uuids.schematicUuid;   // 存储原理图UUID
				await delay(100);

				// 6. 读取PCB文件
				updateProgress(55, '读取PCB文件');
				const pcbFilePath = `PCB/${uuids.pcbUuid}.epcb`;
				const pcbFile = zip.file(pcbFilePath);
				if (!pcbFile) {
					throw new Error(`在压缩包中未找到PCB文件: ${pcbFilePath}`);
				}
				const pcbContent = await pcbFile.async('string');
				logger.debug('PCB文件内容长度:', pcbContent.length);
				await delay(100);

				// 7. 解析 PCB 内容
				updateProgress(60, '解析PCB内容');
				components = parsePcbContent(pcbContent);
				logger.debug('解析的元件信息:', components);
				await delay(100);

				// 8. 补充 Symbol 信息（从project.json中获取Symbol UUID和名称）
				updateProgress(80, '获取符号信息');
				enrichWithSymbol(components, projectJson);
				logger.debug('补充Symbol后的元件:', components);
				await delay(100);

				// 9. 存储数据表内容（components已包含所有信息）
				// 合并相同封装+器件的行用于渲染
				mergedRows = mergeComponentsForDisplay(components);
				renderTable(mergedRows);

				// 10. 计算耗时
				const endTime = Date.now();
				const elapsed = ((endTime - startTime) / 1000).toFixed(1);
				updateProgress(100, `元件处理完成，耗时${elapsed}秒`);

				// 启用构建源码按钮
				buildBtn.disabled = false;
				exportCsvBtn.disabled = false;

			} catch (error) {
				logger.error('刷新列表失败:', error);
				updateProgress(0, `错误: ${error.message}`);
			}
		});

		// ---------- 导出表格 ----------
		exportCsvBtn.addEventListener('click', () => {
			if (!projectJson || !currentPcbUuid) {
				updateProgress(0, '请先加载数据');
				return;
			}
			if (!projectJson || !currentPcbUuid) {
				eda.sys_Message.showToastMessage('请先刷新列表', 'warning');
				return;
			}
			// 获取表头
			const headers = Array.from(document.querySelectorAll('.table-header .header-cell')).map(cell => cell.innerText.trim());
			// 获取数据行
			const rows = [];
			document.querySelectorAll('.grid-row').forEach(row => {
				const cells = row.querySelectorAll('.row-cell');
				const rowData = [];
				cells.forEach((cell, index) => {
					if (index === cells.length - 1) {
						// 最后一列是输入框
						const input = cell.querySelector('input');
						rowData.push(input ? input.value : '');
					} else {
						rowData.push(cell.innerText.trim());
					}
				});
				rows.push(rowData);
			});

			// 生成CSV内容
			let csvContent = headers.join(',') + '\n';
			rows.forEach(row => {
				csvContent += row.map(cell => {
					// 处理包含逗号或双引号的单元格
					if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))) {
						return `"${cell.replace(/"/g, '""')}"`;
					}
					return cell;
				}).join(',') + '\n';
			});

			// 生成文件名：PCB UUID_日期_时间.csv
			const now = new Date();
			const dateStr = now.getFullYear() + 
							('0' + (now.getMonth()+1)).slice(-2) + 
							('0' + now.getDate()).slice(-2);
			const timeStr = ('0' + now.getHours()).slice(-2) + 
							('0' + now.getMinutes()).slice(-2) + 
							('0' + now.getSeconds()).slice(-2);
			const filename = `${currentPcbUuid}_${dateStr}_${timeStr}.csv`;

			// 下载
			updateProgress(100, `导出成功：${filename}`);
			const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = filename;
			link.click();
			URL.revokeObjectURL(link.href);
		});

		// ---------- 导出网络 ----------
		exportNetBtn.addEventListener('click', () => {
			if (!components || components.length === 0) {
				updateProgress(0, '请先加载数据并构建源码');
				return;
			}
			if (Object.keys(symbolPinsDatabase).length === 0) {
				updateProgress(0, '请先构建源码以获取引脚信息');
				return;
			}

			const csvHeader = '唯一ID,位号,引脚编号,引脚名称,引脚网络';
			const csvRows = [csvHeader];

			components.forEach(comp => {
				const designator = comp.designator || '';
				const uniqueId = comp.uniqueId || '';
				const pins = comp.pins || {};
				const symbolParts = symbolPinsDatabase[comp.symbolUuid] || [];

				Object.entries(pins).forEach(([pinNumber, netName]) => {
					if (!pinNumber) return; // 跳过无效引脚编号
					let pinName = '';
					for (let partIdx = 0; partIdx < symbolParts.length; partIdx++) {
						const partPins = symbolParts[partIdx].pins || {};
						if (partPins[pinNumber] && partPins[pinNumber].name) {
							pinName = partPins[pinNumber].name;
							break;
						}
					}

					const escapeCsv = (val) => {
						if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
							return '"' + val.replace(/"/g, '""') + '"';
						}
						return val;
					};

					csvRows.push([
						escapeCsv(uniqueId),
						escapeCsv(designator),
						escapeCsv(pinNumber),
						escapeCsv(pinName),
						escapeCsv(netName || '')
					].join(','));
				});
			});

			const now = new Date();
			const dateStr = now.getFullYear() +
				('0' + (now.getMonth() + 1)).slice(-2) +
				('0' + now.getDate()).slice(-2);
			const timeStr = ('0' + now.getHours()).slice(-2) +
				('0' + now.getMinutes()).slice(-2) +
				('0' + now.getSeconds()).slice(-2);
			const filename = `${currentPcbUuid || 'netlist'}_${dateStr}_${timeStr}_netlist.csv`;

			updateProgress(100, `导出网络成功：${filename}`);
			const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = filename;
			link.click();
			URL.revokeObjectURL(link.href);
		});

		// ---------- 构建源码 ----------
		buildBtn.addEventListener('click', async () => {
			// if (!agreeCheck.checked) {
			// 	updateProgress(0, '请先勾选《免责声明》');
			// 	return;
			// }

			const yvalue = document.getElementById('yvalue').checked; // 获取翻转状态
			// 获取分类选项
			const classifyRadio = document.querySelector('input[name="classify"]:checked');
			const classify = classifyRadio ? classifyRadio.value : 'ref';
			// 获取复选框状态
			const genTitle = genTitleCheck.checked;
			const genFrame = genFrameCheck.checked;
			const ignoreMissing = errorsCheck.checked;

			try {
				// 清空之前的标红
				document.querySelectorAll('.grid-row').forEach(row => row.classList.remove('row-error'));

				const startTime = Date.now();
				if (components && projectJson) {
					enrichWithSymbol(components, projectJson);
				}
				// 1. 获取手动指定符号映射（基于当前表格输入）
				updateProgress(5, '获取指定符号');
				const manualInputs = collectManualInputs(); // 返回 Map: 分组键 -> 输入值
				applyManualSymbols(manualInputs);           // 修改 components 中的 symbolUuid
				await delay(100);

				// 2. 检测符号是否存在
				updateProgress(10, '检测符号是否存在');
				const missingSymbols = checkMissingSymbols();

				// 决定是否忽略
				const ignoreMissing = errorsCheck.checked; // 获取“忽略符号错误”复选框状态

				if (missingSymbols.length > 0) {
					// 标红对应行
					missingSymbols.forEach(groupKey => {
						const rowElement = document.querySelector(`[data-group-key="${groupKey}"]`);
						if (rowElement) rowElement.classList.add('row-error');
					});

					if (!ignoreMissing) {
						throw new Error(`未生成源码，部分元件格式错误，已标红，需要做完 器件标准化 才能转换！！！`);
					} else {
						logger.debug(`忽略 ${missingSymbols.length} 组缺失符号的元件，它们将不会出现在生成的源码中`);
						updateProgress(10, `忽略 ${missingSymbols.length} 组缺失符号元件`);
					}
				}
				await delay(100);

				// 3. 构建用于源码的元件列表（如果忽略缺失，则过滤无符号元件）
				// 在 buildBtn 监听器中，替换过滤部分
				let componentsToBuild = components;
				if (ignoreMissing) {
					// 过滤掉 symbolUuid 为空或仅空白字符的元件
					componentsToBuild = components.filter(comp => comp.symbolUuid && comp.symbolUuid.trim() !== '');
					logger.debug(`过滤后剩余 ${componentsToBuild.length} 个有符号的元件`);
				}

				// 4. 检测多部件符号（只对有符号的元件进行）
				updateProgress(20, '检测多部件符号中');
				await enrichPartCounts(componentsToBuild);  // 传入过滤后的列表
				logger.debug('符号引脚信息数据库:',symbolPinsDatabase);
				await delay(100);

				// 4. 构建源码
				updateProgress(40, '构建源码');
				candidateSource = buildSchSource(componentsToBuild, version, {
					classify,
					genTitle,
					genFrame,
					genWire: genWireCheck.checked,  // 添加这行
					yvalue,
					startX: 200,
					startY: -200,   
					colSpacing: 150,
					rowSpacing: 150,
					perRow: 20,
					wireLength: 40  // 可以添加，如果需要可配置的话
				});


				// logger.debug('构建的SCH源码:\n', candidateSource);
				await delay(100);

				// 5. 完成
				const endTime = Date.now();
				const elapsed = ((endTime - startTime) / 1000).toFixed(1);
				const lineCount = candidateSource ? candidateSource.split('\n').length : 0;
				updateProgress(100, `构建源码完成，耗时${elapsed}秒，生成了 ${lineCount} 行源码`);
				// updateProgress(100, `构建源码完成，耗时${elapsed}秒，生成了 *** 行源码`);

				// 启用写入按钮
				writeBtn.disabled = false;
				document.getElementById('outfile').disabled = false;
				exportNetBtn.disabled = false;
			} catch (error) {
				logger.error('构建源码失败:', error);
				updateProgress(0, `错误: ${error.message}`);
			}
		});

		// ---------- 写入文档 ----------
		writeBtn.addEventListener('click', async () => {
			// if (!agreeCheck.checked) {
			// 	updateProgress(0, '请先勾选《免责声明》');
			// 	return;
			// }
			try {
				if (!candidateSource) {
					throw new Error('没有可写入的源码，请先构建');
				}

				const startTime = Date.now();
				// 进度条固定在90%
				updateProgress(90, '正在写入文档...');

				// 写入门禁：PCB 与原理图的源码格式不同，写进错误文档会被系统拦截（「格式错误」）。
				// documentType：1 = 原理图页。这个 iframe 是浮窗，用户可能在生成期间切到别的文档。
				const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
				if (!curDoc || curDoc.documentType !== 1) {
					updateProgress(0, '请先切换到原理图页再写入');
					eda.sys_Message.showToastMessage('请先切换到原理图页再写入', 2);
					return;
				}

				const isSuccess = await eda.sys_FileManager.setDocumentSource(candidateSource);

				const endTime = Date.now();
				const elapsed = ((endTime - startTime) / 1000).toFixed(1);

				if (isSuccess) {
					updateProgress(100, `写入成功！耗时${elapsed}秒`);
					eda.sys_Message.showToastMessage('写入成功', 'success');
					// await eda.sch_Document.importChanges();//完成后从PCB导入变更
				} else {
					updateProgress(100, `写入失败！耗时${elapsed}秒`);
					eda.sys_Message.showToastMessage('写入失败', 'error');
				}
			} catch (error) {
				logger.error('写入失败:', error);
				updateProgress(0, `错误: ${error.message}`);
			}
		});

		// 新增导出文件按钮监听器（放在 writeBtn 监听器之后）
		document.getElementById('outfile').addEventListener('click', async () => {
			// if (!agreeCheck.checked) {
			// 	updateProgress(0, '请先勾选《免责声明》');
			// 	return;
			// }
			if (!zip || !currentSchematicUuid) {
				updateProgress(0, '请先刷新加载数据');
				return;
			}
			if (!candidateSource) {
				updateProgress(0, '没有可导出的源码，请先构建');
				return;
			}

			try {
				updateProgress(30, '准备导出文件...');

				// 构造目标路径：SHEET/当前原理图UUID/1.sch
				const filePath = `SHEET/${currentSchematicUuid}/1.esch`;
				// 将源码添加到 zip 中（若已存在则覆盖）
				zip.file(filePath, candidateSource);

				updateProgress(60, '正在生成工程文件...');

				// 生成 zip 文件（Blob）
				const blob = await zip.generateAsync({
					type: 'blob',
					compression: 'DEFLATE',
					compressionOptions: { level: 6 }
				});

				// 确定导出文件名
				let baseName = 'project_PCB_TO_SCH';
				if (projectJson && projectJson.title) {
					baseName = projectJson.title;
				} else if (projectJson && projectJson.name) {
					baseName = projectJson.name;
				}
				// 去除可能存在的 .epro 后缀，避免重复
				baseName = baseName.replace(/\.epro$/i, '');
				const fileName = `${baseName}.epro`;

				// 创建下载链接
				const link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = fileName;
				link.click();
				URL.revokeObjectURL(link.href);

				updateProgress(100, `导出成功：${fileName}`);
				// 可选提示
				eda.sys_Message.showToastMessage('文件已导出', 'success');
			} catch (error) {
				logger.error('导出失败:', error);
				updateProgress(0, `导出错误: ${error.message}`);
			}
		});

		// ---------- 工具函数 ----------
		function findUuids(projectJson, currentSheetUuid) {
			let schematicUuid = null;
			for (const [uuid, schematic] of Object.entries(projectJson.schematics)) {
				const sheet = schematic.sheets.find(s => s.uuid === currentSheetUuid);
				if (sheet) {
					schematicUuid = uuid;
					break;
				}
			}
			if (!schematicUuid) throw new Error('未找到对应原理图UUID');

			let pcbUuid = null;
			for (const [boardName, board] of Object.entries(projectJson.boards)) {
				if (board.schematic === schematicUuid) {
					pcbUuid = board.pcb;
					break;
				}
			}
			if (!pcbUuid) throw new Error('未找到对应PCB UUID');

			return { schematicUuid, pcbUuid };
		}

		function parsePcbContent(pcbContent) {
			const components = new Map();
			const lines = pcbContent.split('\n');

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const data = JSON.parse(line);
					const type = data[0];

					if (type === 'COMPONENT') {
						const compId = data[1];
						const props = data[7] || {};
						const uniqueId = props['Unique ID'] || '';
						const supplierPart = props['Supplier Part'] || ''; 
						const layer = data[3];
						const x = data[4];
						const y = data[5];
						const rotation = data[6];

						components.set(compId, {
							uniqueId,
							supplierPart,
							designator: '',
							name: '',
							deviceUuid: '',
							footprintUuid: '',
							layer,
							x,
							y,
							rotation,
							deviceName: '',
							symbolUuid: '',
							symbolName: '',
							footprintName: '',
							pins: {} // 新增：引脚网络映射
						});
					} else if (type === 'ATTR') {
						const compId = data[3];
						const attrName = data[7];
						const attrValue = data[8];
						const comp = components.get(compId);
						if (comp) {
							switch (attrName) {
								case 'Designator':
									comp.designator = attrValue;
									break;
								case 'Name':
									comp.name = attrValue;
									break;
								case 'Device':
									comp.deviceUuid = attrValue;
									break;
								case 'Footprint':
									comp.footprintUuid = attrValue;
									break;
							}
						}
					} else if (type === 'PAD_NET') { // 新增：解析引脚网络
						const compId = data[1];
						const pinNumber = data[2];
						const netName = data[3]; // 可能为空字符串
						const comp = components.get(compId);
						if (comp) {
							comp.pins[pinNumber] = netName; // 存储网络名（可能为空）
						}
					}
				} catch (e) {
					// 忽略解析错误的行
				}
			}
			return Array.from(components.values());
		}

		function enrichWithSymbol(components, projectJson) {
			for (const comp of components) {
				// 通过 deviceUuid 查找 device 信息，进而获取 Symbol UUID
				if (comp.deviceUuid && projectJson.devices[comp.deviceUuid]) {
					const device = projectJson.devices[comp.deviceUuid];
					comp.deviceName = device.title || '';
					comp.symbolUuid = device.attributes?.Symbol || '';
					// 获取 Symbol 名称
					if (comp.symbolUuid && projectJson.symbols[comp.symbolUuid]) {
						comp.symbolName = projectJson.symbols[comp.symbolUuid].title || '';
					} else {
						comp.symbolName = '';
					}
				} else {
					comp.deviceName = '';
					comp.symbolUuid = '';
					comp.symbolName = '';
				}

				// 通过 footprintUuid 查找 footprint 名称
				if (comp.footprintUuid && projectJson.footprints[comp.footprintUuid]) {
					comp.footprintName = projectJson.footprints[comp.footprintUuid].title || '';
				} else {
					comp.footprintName = '';
				}
			}
		}

		// 合并相同 (footprintUuid, deviceUuid) 的行，用于表格显示
		function mergeComponentsForDisplay(components) {
			const groups = new Map();
			components.forEach((comp, index) => {
				const key = `${comp.footprintUuid}|${comp.deviceUuid}`;
				if (!groups.has(key)) {
					groups.set(key, {
						key,
						footprintName: comp.footprintName,
						deviceName: comp.deviceName,
						symbolName: comp.symbolName,
						designators: [],
						names: [],
						supplierParts: [],      // 新增：记录组内所有供应商编号
						componentIndices: []
					});
				}
				const group = groups.get(key);
				group.designators.push(comp.designator);
				group.names.push(comp.name);
				group.supplierParts.push(comp.supplierPart);  // 新增
				group.componentIndices.push(index);
			});

			return Array.from(groups.values()).map(group => ({
				...group,
				designatorDisplay: group.designators.join(','),
				nameDisplay: [...new Set(group.names)].join(','), // 去重
			})).sort((a, b) => {
				const nameA = (a.footprintName || '').toLowerCase();
				const nameB = (b.footprintName || '').toLowerCase();
				return nameA.localeCompare(nameB);
			});
		}

		// 渲染表格
		function renderTable(mergedRows) {
			tableRows.innerHTML = '';
			mergedRows.forEach(group => {
				// 判断该组是否有符号：检查组内所有元件的 symbolUuid 是否都不为空
				const hasSymbol = group.componentIndices.some(idx => components[idx] && components[idx].symbolUuid);

				// 转义统一走 WolfCommon.escapeHtml（& < > " ' 全转义，属性值与正文都可用）
				const row = document.createElement('div');
				row.className = 'grid-row';
				row.setAttribute('data-group-key', group.key);
                
				// 修改后：前 5 个单元格均加上了 title 属性
				row.innerHTML = `
					<div class="row-cell" title="${escapeHtml(group.designatorDisplay)}">${escapeHtml(group.designatorDisplay)}</div>
					<div class="row-cell" title="${escapeHtml(group.nameDisplay)}">${escapeHtml(group.nameDisplay)}</div>
					<div class="row-cell" title="${escapeHtml(group.footprintName)}">${escapeHtml(group.footprintName)}</div>
					<div class="row-cell" title="${escapeHtml(group.deviceName)}">${escapeHtml(group.deviceName)}</div>
					<div class="row-cell" title="${escapeHtml(group.symbolName)}">${escapeHtml(group.symbolName)}</div>
					<div class="row-cell"><input class="manual-input" type="text" placeholder="指定..." data-group-key="${group.key}" value=""></div>
				`;
				tableRows.appendChild(row);
			});
		}

		// 收集手动输入框的值，返回 Map[groupKey] = inputValue
		function collectManualInputs() {
			const inputs = document.querySelectorAll('.manual-input');
			const map = new Map();
			inputs.forEach(input => {
				const groupKey = input.getAttribute('data-group-key');
				if (groupKey) {
					map.set(groupKey, input.value.trim());
				}
			});
			return map;
		}
		
		// 应用手动指定符号：根据输入的关键词替换对应组内所有元件的 symbolUuid
		function applyManualSymbols(manualMap) {
			for (let [groupKey, inputValue] of manualMap.entries()) {
				if (!inputValue) continue;
				let targetUuid = null;
				// 1. 检查关键词映射
				targetUuid = keywordToSymbolUuid[inputValue];
				// 2. 如果没找到，在符号库中按名称查找
				if (!targetUuid && projectJson && projectJson.symbols) {
					for (const [uuid, sym] of Object.entries(projectJson.symbols)) {
						if (sym.title === inputValue) {
							targetUuid = uuid;
							break;
						}
					}
				}
				if (!targetUuid) continue; // 未找到，忽略

				const group = mergedRows.find(g => g.key === groupKey);
				if (group) {
					group.componentIndices.forEach(idx => {
						if (components[idx]) {
							components[idx].symbolUuid = targetUuid;
							components[idx].symbolName = inputValue; // 更新显示名称
						}
					});
				}
			}
		}

		// 检查哪些元件缺少 symbolUuid，返回缺少的 groupKey 数组
		function checkMissingSymbols() {
			const missingGroups = new Set();
			components.forEach((comp, idx) => {
				if (!comp.symbolUuid) {
					// 找到该元件属于哪个组
					const group = mergedRows.find(g => g.componentIndices.includes(idx));
					if (group) missingGroups.add(group.key);
				}
			});
			return Array.from(missingGroups);
		}

		// 解析符号文件，填充 symbolPinsDatabase，并为每个元件设置 partCount
		async function enrichPartCounts(compList = components) {
			// 清空缓存（每次构建时重新解析）
			symbolPinsDatabase = {};

			for (let comp of compList) {
				if (!comp.symbolUuid) {
					comp.partCount = 1; // 无符号元件默认1，但过滤后不会用到
					continue;
				}

				// 如果缓存中已有该符号信息，直接使用
				if (symbolPinsDatabase[comp.symbolUuid]) {
					comp.partCount = symbolPinsDatabase[comp.symbolUuid].length;
					continue;
				}

				// 从 zip 中读取符号文件
				const symbolPath = `SYMBOL/${comp.symbolUuid}.esym`;
				const symbolFile = zip.file(symbolPath);
				if (!symbolFile) {
					logger.warn(`符号文件不存在: ${symbolPath}`);
					comp.partCount = 1;
					symbolPinsDatabase[comp.symbolUuid] = [{ pinBbox: null, pins: {} }]; // 占位
					continue;
				}

				const content = await symbolFile.async('string');
				const lines = content.split('\n');

				// 解析符号文件，提取部件信息
				const parts = [];
				let currentPart = null;
				let pinById = {}; // 临时存储当前部件的引脚信息，键为引脚ID

				for (let line of lines) {
					if (!line.trim()) continue;
					try {
						const data = JSON.parse(line);
						const type = data[0];

						if (type === 'PART') {
							// 遇到新部件，先保存上一个部件（如果有）
							if (currentPart) {
								// 将引脚ID转换为引脚编号映射，并计算引脚包围盒
								const pinsByNumber = {};
								let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
								let hasPin = false;
								for (let pinId in pinById) {
									const pin = pinById[pinId];
									if (pin.number) {
										pinsByNumber[pin.number] = { x: pin.x, y: pin.y, angle: pin.angle, name: pin.name };
										// 更新包围盒
										if (pin.x < minX) minX = pin.x;
										if (pin.x > maxX) maxX = pin.x;
										if (pin.y < minY) minY = pin.y;
										if (pin.y > maxY) maxY = pin.y;
										hasPin = true;
									}
								}
								currentPart.pins = pinsByNumber;
								// 根据引脚坐标计算包围盒
								if (hasPin) {
									currentPart.pinBbox = [minX-40, minY-40, maxX+40, maxY+40];
								} else {
									currentPart.pinBbox = [-20,-20,20,20];
								}
								parts.push(currentPart);
							}
							// 开始新部件
							const partName = data[1];
							currentPart = { name: partName, pins: {} }; // 不再存储原始BBOX
							pinById = {};
						} else if (type === 'PIN' && currentPart) {
							// 解析 PIN 行
							const pinId = data[1];
							const pinType = data[2]; // 默认为1
							const x = data[4];
							const y = data[5];
							const length = data[6];
							const angle = data[7];
							pinById[pinId] = {
								id: pinId,
								type: pinType,
								x: x,
								y: y,
								length: length,
								angle: angle,
								number: null,
								name: null
							};
						} else if (type === 'ATTR' && currentPart) {
							// 解析 ATTR 行，寻找 NUMBER 属性
							const attrId = data[1];
							const parentId = data[2]; // 引脚ID
							const attrName = data[3];
							const attrValue = data[4];
							if (attrName === 'NUMBER' && pinById[parentId]) {
								pinById[parentId].number = attrValue;
							}
							if (attrName === 'NAME' && pinById[parentId]) {
								pinById[parentId].name = attrValue;
							}
						}
					} catch (e) {
						// 忽略解析错误的行
					}
				}

				// 处理最后一个部件
				if (currentPart) {
					const pinsByNumber = {};
					let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
					let hasPin = false;
					for (let pinId in pinById) {
						const pin = pinById[pinId];
						if (pin.number) {
							pinsByNumber[pin.number] = { x: pin.x, y: pin.y, angle: pin.angle, name: pin.name };
							if (pin.x < minX) minX = pin.x;
							if (pin.x > maxX) maxX = pin.x;
							if (pin.y < minY) minY = pin.y;
							if (pin.y > maxY) maxY = pin.y;
							hasPin = true;
						}
					}
					currentPart.pins = pinsByNumber;
					if (hasPin) {
						currentPart.pinBbox = [minX-40, minY-40, maxX+40, maxY+40];
					} else {
						currentPart.pinBbox = [-20,-20,20,20];
					}
					parts.push(currentPart);
				}

				// 存入缓存
				symbolPinsDatabase[comp.symbolUuid] = parts;
				comp.partCount = parts.length; // 设置部件数
			}
		}

		// 构建源码
		function buildSchSource(components, version, options = {}) {

			const {
				classify = 'ref',
				genTitle = false,
				genFrame = false,
				genWire = false, 
				yvalue = false,
				startX = 100,
				startY = -200,
				colSpacing = 150,
				rowSpacing = 150,
				perRow = 20,
				wireLength = 40   // 导线长度，默认40
			} = options;

			const lines = [];
			let idCounter = 1;

			// 根据分类方式对元件进行分组和排序
			let groups = [];
			if (classify === 'ref') {
				// 按照位号分类
				const refGroups = {};
				components.forEach(comp => {
					// 提取开头的字母部分作为前缀（支持 C?、R? 等形式）
					const match = comp.designator.match(/^([A-Za-z]+)/);
					if (match) {
						const prefix = match[1];
						if (!refGroups[prefix]) refGroups[prefix] = [];
						refGroups[prefix].push(comp);
					} else {
						// 无法提取字母（例如纯数字），放入其他组
						if (!refGroups['其他']) refGroups['其他'] = [];
						refGroups['其他'].push(comp);
					}
				});
				// 对每个组内按数字排序（无数字的元件视为数字0，排在前面）
				Object.keys(refGroups).sort().forEach(prefix => {
					refGroups[prefix].sort((a, b) => {
						const numA = parseInt((a.designator.match(/\d+/) || ['0'])[0]) || 0;
						const numB = parseInt((b.designator.match(/\d+/) || ['0'])[0]) || 0;
						return numA - numB;
					});
					groups.push({
						name: `${prefix}`,
						items: refGroups[prefix]
					});
				});
			} else if (classify === 'device') {
				// 按照器件名称分类
				const deviceGroups = {};
				components.forEach(comp => {
					const deviceName = comp.deviceName || '未知器件';
					if (!deviceGroups[deviceName]) deviceGroups[deviceName] = [];
					deviceGroups[deviceName].push(comp);
				});
				Object.keys(deviceGroups).sort().forEach(name => {
					groups.push({
						name: `${name}`,
						items: deviceGroups[name]
					});
				});
			} else if (classify === 'pkg') {
				// 按照封装名称分类
				const pkgGroups = {};
				components.forEach(comp => {
					const pkgName = comp.footprintName || '未知封装';
					if (!pkgGroups[pkgName]) pkgGroups[pkgName] = [];
					pkgGroups[pkgName].push(comp);
				});
				Object.keys(pkgGroups).sort().forEach(name => {
					groups.push({
						name: `${name}`,
						items: pkgGroups[name]
					});
				});
			} else if (classify === 'coord') {
				// 按照元件坐标布局（直接使用PCB坐标）
				groups = [{
					name: '坐标布局',
					items: components
				}];
				// 注意：坐标布局时，每个元件使用PCB上的原始坐标，不进行网格重排
				// 但为了支持标题和框线，我们仍将元件放入一个组
			}

			// 当前绘制位置
			// let currentY = startY;
			let currentTopY = startY;

			// 生成导线的辅助函数
			function generateWires(comp, compId, compX, compY, version, wireLength, partIdx = 0, yvalue = false) {
				const wireLines = [];
				const symbolParts = symbolPinsDatabase[comp.symbolUuid] || [];
				const symbolPart = symbolParts[partIdx] || symbolParts[0] || { pins: {} };
				const symbolPins = symbolPart.pins || {};

				Object.entries(comp.pins || {}).forEach(([pinNumber, netName]) => {
					if (!netName || netName === '') return;
					const pinInfo = symbolPins[pinNumber];
					if (!pinInfo) return;

					// 计算引脚绝对坐标（原始，未翻转）
					const pinX = compX + pinInfo.x;
					let rawPinY;
					let y;
					if (isV2()) {
						rawPinY = compY + pinInfo.y; // V2版本 Y 坐标（向上为正）
						y = 1;
					} else if (isModern()) {
						rawPinY = compY - pinInfo.y; // V3版本 Y 坐标（向下为正）
						y = -1;
					}
					// 根据引脚角度计算导线终点（基于原始坐标）
					let endX = pinX;
					let rawEndY = rawPinY;
					let netT = 0;
					switch (pinInfo.angle) {
						case 0:   // 朝左
							endX = pinX - wireLength;
							rawEndY = rawPinY;
							netT = 0;
							break;
						case 90:  // 朝上
							endX = pinX;
							rawEndY = rawPinY - wireLength * y;
							netT = 90;
							break;
						case 180: // 朝右
							endX = pinX + wireLength;
							rawEndY = rawPinY;
							netT = 0;
							break;
						case 270: // 朝下
							endX = pinX;
							rawEndY = rawPinY + wireLength * y;
							netT = 90;
							break;
						default:
							endX = pinX - wireLength;
							rawEndY = rawPinY;
							netT = 0;
					}

					// 源码行统一由 WolfCommon.createSchWireLines 发射（与后端 autoWire 同一份规格）
					if (isV2() || isModern()) {
						wireLines.push(
							...createSchWireLines({
								net: netName,
								startX: pinX,
								startY: rawPinY,
								endX: endX,
								endY: rawEndY,
								rotation: netT,
								isModern: !isV2(),
								// 该页面的 id 与 ticket 共用一个计数器（历史行为，保持不变）
								nextRow: () => {
									const n = idCounter++;
									return { id: n, ticket: n };
								},
							}),
						);
					}
				});
				return wireLines;
			}



			if (isV2()) {

				// 头部
				lines.push('["DOCTYPE","SCH","1.1"]');
				lines.push('["HEAD",{"originX":0,"originY":0,"version":"2","maxId":11517}]');
				lines.push('["FONTSTYLE","st1",null,null,null,null,null,null,null,null,null,null]');
				lines.push('["FONTSTYLE","st2",null,null,null,60,null,null,null,null,1,0]');
				lines.push('["LINESTYLE","st3",null,null,null,2,null]');
				lines.push('["LINESTYLE","st4",null,null,null,null,null]');

				groups.forEach(group => {
					const items = group.items;
					if (items.length === 0) return;

					// 记录该组元件的坐标范围（用于框线）
					let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

					if (classify === 'coord') {
						// 坐标布局：直接使用PCB坐标，但需要处理层和旋转
						items.forEach(comp => {
							const partCount = comp.partCount || 1;
							for (let partIdx = 0; partIdx < partCount; partIdx++) {
								const compId = 'e' + (idCounter++);
								const symbolName = comp.symbolName || 'Unknown';
								const compName = symbolPinsDatabase[comp.symbolUuid][partIdx].name;;
								// 使用PCB上的坐标、层、旋转
								// comp.y = comp.y + 10;
								const adjustedY = comp.y + 10 * partIdx;
								const outY = yvalue ? -adjustedY : adjustedY;
								lines.push(`["COMPONENT","${compId}","${compName}",${comp.x},${outY},0,0,{},0]`);
								// lines.push(`["COMPONENT","${compId}","${compName}",${comp.x},${comp.y},0,0,{},0]`);

								// Device
								lines.push(`["ATTR","e${idCounter}","${compId}","Device","${comp.deviceUuid || ''}",0,0,null,null,null,"st1",0]`);
								idCounter++;
								// Symbol
								lines.push(`["ATTR","e${idCounter}","${compId}","Symbol","${comp.symbolUuid || ''}",0,0,null,null,null,"st1",0]`);
								idCounter++;
								// Designator
								lines.push(`["ATTR","e${idCounter}","${compId}","Designator","${comp.designator || ''}",null,0,null,null,null,"st1",0]`);
								idCounter++;
								// Name
								lines.push(`["ATTR","e${idCounter}","${compId}","Name","${comp.name || ''}",null,0,null,null,null,"st1",0]`);
								idCounter++;
								// Unique ID
								lines.push(`["ATTR","e${idCounter}","${compId}","Unique ID","${comp.uniqueId || ''}",0,0,null,null,null,"st1",0]`);
								idCounter++;

								// 在生成完所有属性后，如果启用了导线生成，添加导线
								if (genWire) {
									const wireLines = generateWires(comp, compId, comp.x, outY, version, wireLength, partIdx);
									lines.push(...wireLines);
								}
								// 更新范围
								minX = Math.min(minX, comp.x);
								maxX = Math.max(maxX, comp.x);
								minY = Math.min(minY, comp.y);
								maxY = Math.max(maxY, comp.y);

							}
						});
					} else {
						// 动态布局基于 BBOX（替换原网格布局）
						let currentX = startX;                 // 当前行起始 X
						let lastRight = null;                  // 上一个部件的右边界
						let minYThisRow = currentTopY;         // 当前行最下边缘的绝对Y坐标

						// 将组内所有部件展开为列表（每个部件独立放置）
						const partsList = [];
						items.forEach(comp => {
							const partCount = comp.partCount || 1;
							for (let partIdx = 0; partIdx < partCount; partIdx++) {
								partsList.push({ comp: comp, partIdx: partIdx });
							}
						});

						for (let i = 0; i < partsList.length; i++) {
							const item = partsList[i];
							const comp = item.comp;
							const partIdx = item.partIdx;

							// 获取该部件的 pinBbox（从全局缓存 symbolPinsDatabase 中读取）
							let bbox;
							if (comp.symbolUuid && symbolPinsDatabase[comp.symbolUuid] && symbolPinsDatabase[comp.symbolUuid][partIdx]) {
								bbox = symbolPinsDatabase[comp.symbolUuid][partIdx].pinBbox;
							} else {
								bbox = [-20, -20, 20, 20]; // 默认包围盒
							}
							const xmin = bbox[0];
							const ymin = bbox[1];
							const xmax = bbox[2];
							const ymax = bbox[3];

							// 计算放置 X 坐标
							let compX;
							if (lastRight === null) {
								compX = startX - xmin;                       // 第一个元件左边界对齐 startX
							} else {
								compX = lastRight + 40 - xmin;               // 与前一个元件间隔 40
							}
							const right = compX + xmax;

							// 检查是否需要换行（超出右边界 2560）
							if (right > 2560) {
								// 换行：上边缘下移至上一行最下边缘 - 40
								currentTopY = minYThisRow - 40;
								currentX = startX;
								compX = startX - xmin;
								lastRight = compX + xmax;
								minYThisRow = currentTopY; // 新行重置
							} else {
								lastRight = right;
							}

							// 元件顶部对齐到 currentTopY
							const compY = currentTopY - ymax;
							
							// 更新当前行的最下边缘（Y值越小越在下面）
							const absoluteBottomY = compY + ymin;
							if (absoluteBottomY < minYThisRow) {
								minYThisRow = absoluteBottomY;
							}

							// 生成元件及属性（原代码保持不变）
							const compId = 'e' + (idCounter++);
							const symbolName = comp.symbolName || 'Unknown';
							const compName = symbolPinsDatabase[comp.symbolUuid][partIdx].name;;
							const outY = yvalue ? -compY : compY;

							lines.push(`["COMPONENT","${compId}","${compName}",${compX},${outY},0,0,{},0]`);

							lines.push('["ATTR","e' + idCounter + '","' + compId + '","Device","' + (comp.deviceUuid || '') + '",0,0,null,null,null,"st1",0]');
							idCounter++;
							lines.push('["ATTR","e' + idCounter + '","' + compId + '","Symbol","' + (comp.symbolUuid || '') + '",0,0,null,null,null,"st1",0]');
							idCounter++;
							lines.push('["ATTR","e' + idCounter + '","' + compId + '","Designator","' + (comp.designator || '') + '",null,0,null,null,null,"st1",0]');
							idCounter++;
							lines.push('["ATTR","e' + idCounter + '","' + compId + '","Name","' + (comp.name || '') + '",null,0,null,null,null,"st1",0]');
							idCounter++;
							lines.push('["ATTR","e' + idCounter + '","' + compId + '","Unique ID","' + (comp.uniqueId || '') + '",0,0,null,null,null,"st1",0]');
							idCounter++;

							// 在生成完所有属性后，如果启用了导线生成，添加导线
							if (genWire) {
								const wireLines = generateWires(comp, compId, compX, outY, version, wireLength, partIdx);
								lines.push(...wireLines);
							}

							// 更新整个组的包围盒（用于框线，minY 最终将为该组最大深度的Y值）
							minX = Math.min(minX, compX + xmin);
							maxX = Math.max(maxX, compX + xmax);
							minY = Math.min(minY, compY + ymin);
							maxY = Math.max(maxY, compY + ymax);

						}
					}
						
					// 显示标题与框线
					let padding = 120;
					if (genFrame && minX !== Infinity && yvalue) {
						// lines.push(`["RECT","e${idCounter++}",${minX - padding},${-minY + padding},${maxX + padding},${-maxY - padding},0,0,0,"st3",0]`);
						lines.push(`["TEXT","e${idCounter++}",${minX - padding +10},${-maxY - padding + 30},0,"${group.name}","st2",0]`);
					}else if(genFrame && minX !== Infinity){
						// lines.push(`["RECT","e${idCounter++}",${minX - padding},${minY - padding},${maxX + padding},${maxY + padding},0,0,0,"st3",0]`);
						lines.push(`["TEXT","e${idCounter++}",${minX - padding +10},${maxY + padding - 30},0,"${group.name}","st2",0]`);
					}

					// 当前组结束后，Y坐标移动到下一组的起始位置（如果还有下一组）
					if (classify !== 'coord') {
						// minY 存留了整个组的最下边缘，下一组的上边缘定为上一组下边缘再往下 200
						currentTopY = minY - 200;
					}

					
				});


				return lines.join('\n');

			} else if (isModern()) {
				// V3 版本源码生成
				// 生成唯一 client 和 uuid（保证文件内唯一）
				const uniqueClient = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
				const uniqueUuid = 'uuid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
				const timestamp = Date.now();

				// 头部：DOCHEAD
				lines.push(`{"type":"DOCHEAD"}||{"docType":"SCH_PAGE","client":"${uniqueClient}","uuid":"${uniqueUuid}","updateTime":${timestamp},"version":${timestamp}}|`);
				// CANVAS
				lines.push(`{"type":"CANVAS","ticket":${idCounter++},"id":"CANVAS"}||{"originX":0,"originY":0}|`);

				// 当前绘制位置
				// let currentY = startY;
				let currentTopY = startY;

				groups.forEach(group => {
					const items = group.items;
					if (items.length === 0) return;

					// 记录该组元件的坐标范围（用于框线）
					let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

					if (classify === 'coord') {
						// 坐标布局：直接使用PCB坐标
						items.forEach(comp => {
							const partCount = comp.partCount || 1;
							for (let partIdx = 0; partIdx < partCount; partIdx++) {
								const compTicket = idCounter++;
								const compId = 'e' + compTicket;
								const symbolName = comp.symbolName || 'Unknown';
								const compName = symbolPinsDatabase[comp.symbolUuid][partIdx].name;;
								// COMPONENT 行
								comp.y = comp.y + 10;
								const outY = yvalue ? -comp.y : comp.y;
								lines.push('{"type":"COMPONENT","ticket":' + compTicket + ',"id":"' + compId + '"}||{"partId":"' + compName + '","x":' + comp.x + ',"y":' + outY + ',"rotation":0}|');

								// Device 属性
								lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter-1}"}||{"parentId":"${compId}","key":"Device","value":"${comp.deviceUuid || ''}"}|`);
								// Symbol 属性
								lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter-1}"}||{"parentId":"${compId}","key":"Symbol","value":"${comp.symbolUuid || ''}"}|`);
								// Unique ID 属性
								lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter-1}"}||{"parentId":"${compId}","key":"Unique ID","value":"${comp.uniqueId || ''}"}|`);
								// Designator 属性（带坐标偏移）
								lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter-1}"}||{"parentId":"${compId}","key":"Designator","value":"${comp.designator || ''}","rotation":0}|`);
								// Name 属性（带坐标偏移）
								lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter-1}"}||{"parentId":"${compId}","key":"Name","value":"${comp.name || ''}","rotation":0}|`);
								// 新增：生成导线
								if (genWire) {
									const wireLines = generateWires(comp, compId, comp.x, outY, version, wireLength, partIdx);
									lines.push(...wireLines);
								}
								
								// 更新范围
								minX = Math.min(minX, comp.x);
								maxX = Math.max(maxX, comp.x);
								minY = Math.min(minY, comp.y);
								maxY = Math.max(maxY, comp.y);
							}
						});
					} else {
						// 动态布局基于 BBOX（V3 版本）
						let currentX = startX;
						let lastRight = null;
						let minYThisRow = currentTopY; // 当前行最下边缘

						const partsList = [];
						items.forEach(comp => {
							const partCount = comp.partCount || 1;
							for (let partIdx = 0; partIdx < partCount; partIdx++) {
								partsList.push({ comp: comp, partIdx: partIdx });
							}
						});

						for (let i = 0; i < partsList.length; i++) {
							const item = partsList[i];
							const comp = item.comp;
							const partIdx = item.partIdx;

							let bbox;
							if (comp.symbolUuid && symbolPinsDatabase[comp.symbolUuid] && symbolPinsDatabase[comp.symbolUuid][partIdx]) {
								bbox = symbolPinsDatabase[comp.symbolUuid][partIdx].pinBbox;
							} else {
								bbox = [-20, -20, 20, 20];
							}
							const xmin = bbox[0];
							const ymin = bbox[1];
							const xmax = bbox[2];
							const ymax = bbox[3];

							let compX;
							if (lastRight === null) {
								compX = startX - xmin;
							} else {
								compX = lastRight + 40 - xmin;
							}
							const right = compX + xmax;

							if (right > 2560) {
								currentTopY = minYThisRow - 40;
								currentX = startX;
								compX = startX - xmin;
								lastRight = compX + xmax;
								minYThisRow = currentTopY;
							} else {
								lastRight = right;
							}

							// 顶部对齐
							const compY = currentTopY - ymax;
							
							const absoluteBottomY = compY + ymin;
							if (absoluteBottomY < minYThisRow) {
								minYThisRow = absoluteBottomY;
							}

							// 生成元件（V3 格式）
							const compTicket = idCounter++;
							const compId = 'e' + compTicket;
							const symbolName = comp.symbolName || 'Unknown';
							const compName = symbolPinsDatabase[comp.symbolUuid][partIdx].name;;
							const outY = yvalue ? -compY : compY;
							lines.push('{"type":"COMPONENT","ticket":' + compTicket + ',"id":"' + compId + '"}||{"partId":"' + compName + '","x":' + compX + ',"y":' + outY + ',"rotation":0}|');

							// 属性
							lines.push('{"type":"ATTR","ticket":' + (idCounter++) + ',"id":"e' + (idCounter-1) + '"}||{"parentId":"' + compId + '","key":"Device","value":"' + (comp.deviceUuid || '') + '"}|');
							lines.push('{"type":"ATTR","ticket":' + (idCounter++) + ',"id":"e' + (idCounter-1) + '"}||{"parentId":"' + compId + '","key":"Symbol","value":"' + (comp.symbolUuid || '') + '"}|');
							lines.push('{"type":"ATTR","ticket":' + (idCounter++) + ',"id":"e' + (idCounter-1) + '"}||{"parentId":"' + compId + '","key":"Unique ID","value":"' + (comp.uniqueId || '') + '"}|');
							lines.push('{"type":"ATTR","ticket":' + (idCounter++) + ',"id":"e' + (idCounter-1) + '"}||{"parentId":"' + compId + '","key":"Designator","value":"' + (comp.designator || '') + '","rotation":0}|');
							lines.push('{"type":"ATTR","ticket":' + (idCounter++) + ',"id":"e' + (idCounter-1) + '"}||{"parentId":"' + compId + '","key":"Name","value":"' + (comp.name || '') + '","rotation":0}|');
							
							// 新增：生成导线
							if (genWire) {
								const wireLines = generateWires(comp, compId, compX, outY, version, wireLength, partIdx);
								lines.push(...wireLines);
							}
							// 更新组的包围盒（使用实际坐标）
							minX = Math.min(minX, compX + xmin);
							maxX = Math.max(maxX, compX + xmax);
							minY = Math.min(minY, compY + ymin);
							maxY = Math.max(maxY, compY + ymax);
						}
					}

					// 显示标题与框线
					const padding = 120;
					if (genFrame && minX !== Infinity && yvalue) {
						// const rectTicket = idCounter++;
						// const rectId = 'e' + rectTicket;
						// lines.push(`{"type":"RECT","ticket":${rectTicket},"id":"${rectId}"}||{"dotX1":${minX-padding},"dotY1":${-minY+padding},"dotX2":${maxX+padding},"dotY2":${-maxY-padding},"strokeWidth":2,"radiusX":0,"radiusY":0,"rotation":0}|`);
						const titleTicket = idCounter++;
						const titleId = 'e' + titleTicket;
						lines.push(`{"type":"TEXT","ticket":${titleTicket},"id":"${titleId}"}||{"x":${minX-padding+10},"y":${-maxY- padding+30},"value":"${group.name}","fontSize":60,"align":"LEFT_MIDDLE","rotation":0}|`);
					}else if(genFrame && minX !== Infinity){
						// const rectTicket = idCounter++;
						// const rectId = 'e' + rectTicket;
						// lines.push(`{"type":"RECT","ticket":${rectTicket},"id":"${rectId}"}||{"dotX1":${minX-padding},"dotY1":${minY-padding},"dotX2":${maxX+padding},"dotY2":${maxY+padding},"strokeWidth":2,"radiusX":0,"radiusY":0,"rotation":0}|`);
						const titleTicket = idCounter++;
						const titleId = 'e' + titleTicket;
						lines.push(`{"type":"TEXT","ticket":${titleTicket},"id":"${titleId}"}||{"x":${minX-padding+10},"y":${maxY + padding - 30},"value":"${group.name}","fontSize":60,"align":"LEFT_MIDDLE","rotation":0}|`);
					}

					// 组间空行
					if (classify !== 'coord') {
						// 下一组起点为上一组的最低点往下方 200 个单位
						currentTopY = minY - 200;
					}
				});
				if (lines.length > 0 && lines[lines.length-1].endsWith('|')) {
					lines[lines.length-1] = lines[lines.length-1].slice(0, -1);
				}

				return lines.join('\n');
			}
		}
