const WC = window.WolfCommon;
if (!WC) {
	(document.body || document.documentElement).innerHTML = '<div style="padding:24px;font:14px/1.6 sans-serif;color:#f28b82">公共模块 common.js 未加载，请重新安装扩展</div>';
	throw new Error('[狼黑工具] 公共模块 common.js 未加载');
}
const { getEditorVersion, getVersionFamily, getNetlist, setNetlist, getComponentsContainer } = WC;

			let componentsData = [];
			let groupedComponentsData = [];
			let jsonData = null;
			let componentsMap = null; // 指向实际的组件对象集合（V2指向根，V3指向components属性）
			let Page;

			// E96系列电阻代码映射表 (标准E96系列值)
			const E96_VALUES = {
				'01': 100,
				'02': 102,
				'03': 105,
				'04': 107,
				'05': 110,
				'06': 113,
				'07': 115,
				'08': 118,
				'09': 121,
				'10': 124,
				'11': 127,
				'12': 130,
				'13': 133,
				'14': 137,
				'15': 140,
				'16': 143,
				'17': 147,
				'18': 150,
				'19': 154,
				'20': 158,
				'21': 162,
				'22': 165,
				'23': 169,
				'24': 174,
				'25': 178,
				'26': 182,
				'27': 187,
				'28': 191,
				'29': 196,
				'30': 200,
				'31': 205,
				'32': 210,
				'33': 215,
				'34': 221,
				'35': 226,
				'36': 232,
				'37': 237,
				'38': 243,
				'39': 249,
				'40': 255,
				'41': 261,
				'42': 267,
				'43': 274,
				'44': 280,
				'45': 287,
				'46': 294,
				'47': 301,
				'48': 309,
				'49': 316,
				'50': 324,
				'51': 332,
				'52': 340,
				'53': 348,
				'54': 357,
				'55': 365,
				'56': 374,
				'57': 383,
				'58': 392,
				'59': 402,
				'60': 412,
				'61': 422,
				'62': 432,
				'63': 442,
				'64': 453,
				'65': 464,
				'66': 475,
				'67': 487,
				'68': 499,
				'69': 511,
				'70': 523,
				'71': 536,
				'72': 549,
				'73': 562,
				'74': 576,
				'75': 590,
				'76': 604,
				'77': 619,
				'78': 634,
				'79': 649,
				'80': 665,
				'81': 681,
				'82': 698,
				'83': 715,
				'84': 732,
				'85': 750,
				'86': 768,
				'87': 787,
				'88': 806,
				'89': 825,
				'90': 845,
				'91': 866,
				'92': 887,
				'93': 909,
				'94': 931,
				'95': 953,
				'96': 976,
			};

			// E96乘数字母映射
			const E96_MULTIPLIERS = {
				'Z': 0.001,
				'Y': 0.01,
				'X': 0.1,
				'A': 1,
				'B': 10,
				'C': 100,
				'D': 1000,
				'E': 10000,
				'F': 100000,
				'G': 1000000,
			};

			// 数据处理逻辑，根据是否转换成功决定是否勾选
			function processComponentsData() {
				componentsData = [];

				for (const key in componentsMap) {
					const component = componentsMap[key];

					if (!component.props) continue;

					const designator = component.props.Designator;
					const name = component.props.Name;
					const uniqueId = component.props['Unique ID'];
					const footprint = component.props.FootprintName || ''; // 新增获取封装

					// 增强位号识别：严格匹配 R/C/L 开头且紧接着是数字的元件（防止匹配 LED、CON 等）
					if (designator && /^[RCL]\d+/i.test(designator) && !/(?:[MK]?Ω|[PNU]?F|[UM]?H|F)/i.test(name)) {
						const compType = designator[0].toUpperCase();
						// 拿到转换对象，包含展示文本(text)和实际数值(raw)
						const result = convertCodeToValue(name, compType);
						const convertedValue = result.text;
						const rawValue = result.raw;

						const isConverted = convertedValue !== name && convertedValue !== null;

						componentsData.push({
							uniqueId: uniqueId,
							designator: designator,
							footprint: footprint, // <--- 新增这行
							compType: compType, // 增加类型字段用于排序
							rawValue: rawValue, // 增加实际数值字段用于排序
							name: name,
							value: convertedValue,
							shouldModify: isConverted,
							modified: isConverted && uniqueId && uniqueId !== '',
						});
					}
				}
			}

			// 将相同代码、相同转换值且【相同封装】的数据折叠分组，并进行排序
			function groupComponents() {
				groupedComponentsData = [];
				const groupedMap = {};
				const uniqueIdCount = {};

				componentsData.forEach((component) => {
					if (component.uniqueId && component.uniqueId !== '') {
						uniqueIdCount[component.uniqueId] = (uniqueIdCount[component.uniqueId] || 0) + 1;
					}
				});

				componentsData.forEach((component) => {
					// 【核心修改】：将 footprint 加入分组唯一键，确保不同封装必定独立成行
					const key = component.name + '|' + component.value + '|' + component.footprint;

					if (!groupedMap[key]) {
						groupedMap[key] = {
							uniqueIds: [],
							designators: [],
							footprint: component.footprint, // 同组内的封装是唯一的，直接存字符串即可
							compType: component.compType, 
							rawValue: component.rawValue, 
							name: component.name,
							value: component.value,
							shouldModify: component.shouldModify,
							modified: component.modified,
							hasError: false
						};
						groupedComponentsData.push(groupedMap[key]);
					}

					const isDuplicate = component.uniqueId && component.uniqueId !== '' && uniqueIdCount[component.uniqueId] > 1;
					const isEmpty = !component.uniqueId || component.uniqueId === '';

					if (isDuplicate || isEmpty) {
						groupedMap[key].hasError = true;
						groupedMap[key].modified = false;
					}

					groupedMap[key].uniqueIds.push(component.uniqueId || '空');
					groupedMap[key].designators.push(component.designator);
					// 注意：这里不再需要 push footprint 到数组了
				});

				// 排序功能保持不变
				const typeOrder = { 'R': 1, 'C': 2, 'L': 3 };

				groupedComponentsData.sort((a, b) => {
					const typeA = typeOrder[a.compType] || 99;
					const typeB = typeOrder[b.compType] || 99;

					if (typeA !== typeB) {
						return typeA - typeB;
					}
					return a.rawValue - b.rawValue;
				});
			}

			// 根据位号开头处理 (现返回对象 { text: '转换后文本', raw: 实际数值 })
			function convertCodeToValue(code, type) {
				if (!code || !type) return { text: null, raw: Number.MAX_VALUE };

				const strCode = code.toString().toUpperCase();

				switch (type.toUpperCase()) {
					case 'R':
						return convertResistor(strCode);
					case 'C':
						return convertCapacitor(strCode);
					case 'L':
						return convertInductor(strCode);
					default:
						return { text: code, raw: Number.MAX_VALUE };
				}
			}

			// 电阻转换数值
			function convertResistor(code) {
				if (code.length === 3 && /^\d{2}[A-Z]$/.test(code)) {
					const digits = code.substring(0, 2);
					const multiplierChar = code.substring(2, 3);
					if (E96_VALUES[digits] && E96_MULTIPLIERS[multiplierChar]) {
						const value = E96_VALUES[digits] * E96_MULTIPLIERS[multiplierChar];
						return { text: formatValue(value, 'R'), raw: value };
					}
				}

				if (/^[0-9.]*[RKM][0-9.]*$/.test(code)) {
					const value = parseResistorWithUnit(code);
					if (value !== null) {
						return { text: formatValue(value, 'R'), raw: value };
					}
				}

				let numericValue;
				if (/^\d+$/.test(code)) {
					if (code.length === 3) {
						numericValue = parseInt(code.substring(0, 2)) * Math.pow(10, parseInt(code.substring(2, 3)));
					} else if (code.length === 4) {
						numericValue = parseInt(code.substring(0, 3)) * Math.pow(10, parseInt(code.substring(3, 4)));
					} else {
						numericValue = parseFloat(code);
					}
				} else {
					numericValue = parseFloat(code);
				}

				if (isNaN(numericValue) || numericValue === null) return { text: code, raw: Number.MAX_VALUE };
				return { text: formatValue(numericValue, 'R'), raw: numericValue };
			}

			// 电容转换数值
			function convertCapacitor(code) {
				let numericValue;
				if (/^[0-9.]*[PNUM][0-9.]*[F]?$/.test(code)) {
					numericValue = parseCapacitorWithUnit(code);
				} else if (/^\d+$/.test(code)) {
					if (code.length === 3) {
						numericValue = parseInt(code.substring(0, 2)) * Math.pow(10, parseInt(code.substring(2, 3)));
					} else {
						numericValue = parseFloat(code);
					}
				} else {
					numericValue = parseFloat(code);
				}

				if (isNaN(numericValue) || numericValue === null) return { text: code, raw: Number.MAX_VALUE };
				return { text: formatValue(numericValue, 'C'), raw: numericValue };
			}

			// 电感转换数值
			function convertInductor(code) {
				let numericValue;
				if (/^[0-9.]*[RNUMH][0-9.]*[H]?$/.test(code)) {
					numericValue = parseInductorWithUnit(code);
				} else if (/^\d+$/.test(code)) {
					if (code.length === 3) {
						numericValue = parseInt(code.substring(0, 2)) * Math.pow(10, parseInt(code.substring(2, 3)));
					} else {
						numericValue = parseFloat(code);
					}
				} else {
					numericValue = parseFloat(code);
				}

				if (isNaN(numericValue) || numericValue === null) return { text: code, raw: Number.MAX_VALUE };
				return { text: formatValue(numericValue, 'L'), raw: numericValue };
			}


			// 带单位的电阻解析
			function parseResistorWithUnit(code) {
				code = code.toUpperCase();

				// 处理零值
				if (code === '0' || code === '00' || code === '000' || code === '0R') {
					return 0;
				}

				// 处理 R 开头的情况（如 R01, R10, R005）
				if (code.startsWith('R') && code.length >= 2) {
					const numberPart = code.substring(1);
					const numericValue = parseFloat('0.' + numberPart);
					return isNaN(numericValue) ? null : numericValue;
				}

				// 处理带单位的情况（如 4R7, 2K2, 0R5, 0R05, 3R63）
				const match = code.match(/^([0-9]*\.?[0-9]*)[RKM]([0-9]*)$/);
				if (match) {
					const integerPart = match[1] || '0';
					const unitChar = match[0].includes('K') ? 'K' : match[0].includes('M') ? 'M' : 'R';
					const decimalPart = match[2] || '';

					// 构建完整数值
					let numericValue;
					if (decimalPart) {
						// 如果有小数部分，组合成完整数值
						numericValue = parseFloat(integerPart + '.' + decimalPart);
					} else {
						// 如果没有小数部分，直接使用整数部分
						numericValue = parseFloat(integerPart);
					}

					if (isNaN(numericValue)) return null;

					// 特殊处理：如果整数部分为0且有小数的格式（如0R5）
					if (integerPart === '0' && decimalPart) {
						numericValue = parseFloat('0.' + decimalPart);
					}

					// 应用单位乘数
					switch (unitChar) {
						case 'R':
							return numericValue;
						case 'K':
							return numericValue * 1000;
						case 'M':
							return numericValue * 1000000;
						default:
							return numericValue;
					}
				}

				return parseFloat(code);
			}

			// 带单位的电容解析
			function parseCapacitorWithUnit(code) {
				code = code.toUpperCase().replace('F', '');

				// 匹配数字部分和单位部分
				const match = code.match(/^([0-9.]*)([PNUM])([0-9.]*)$/);
				if (!match) return parseFloat(code);

				const numberPart = match[1] || '0';
				const unitChar = match[2];
				const decimalPart = match[3] || '';

				// 构建完整数值
				let numericValue;
				if (decimalPart) {
					numericValue = parseFloat(numberPart + '.' + decimalPart);
				} else {
					numericValue = parseFloat(numberPart);
				}

				if (isNaN(numericValue)) return null;

				// 根据单位字符应用乘数（转换为pF）
				switch (unitChar) {
					case 'P':
						return numericValue; // pF
					case 'N':
						return numericValue * 1000; // nF -> pF
					case 'U':
						return numericValue * 1000000; // uF -> pF
					case 'M':
						return numericValue * 1000000000; // mF -> pF
					default:
						return numericValue;
				}
			}

			// 带单位的电感解析
			function parseInductorWithUnit(code) {
				code = code.toUpperCase().replace('H', '');

				// 处理类似 R01, R10 的表示法（没有整数部分，2位小数）
				if (code.startsWith('R') && code.length >= 2) {
					const numberPart = code.substring(1);
					const numericValue = parseFloat('0.' + numberPart);
					// 修正：R01 = 0.01uH = 10nH，不是100mH
					return isNaN(numericValue) ? null : numericValue; // 返回uH值
				}

				// 匹配数字部分和单位部分
				const match = code.match(/^([0-9.]*)([RNUMH])([0-9.]*)$/);
				if (!match) return parseFloat(code);

				const numberPart = match[1] || '0';
				const unitChar = match[2];
				const decimalPart = match[3] || '';

				// 构建完整数值
				let numericValue;
				if (decimalPart) {
					numericValue = parseFloat(numberPart + '.' + decimalPart);
				} else {
					numericValue = parseFloat(numberPart);
				}

				if (isNaN(numericValue)) return null;

				// 根据单位字符应用乘数（转换为uH）
				switch (unitChar) {
					case 'R':
					case 'U':
						return numericValue; // uH
					case 'N':
						return numericValue * 0.001; // nH -> uH
					case 'M':
						return numericValue * 1000; // mH -> uH
					case 'H':
						return numericValue * 1000000; // H -> uH
					default:
						return numericValue;
				}
			}

			// 格式化加单位
			function formatValue(value, type) {
				if (value === undefined || value === null || isNaN(value)) return null;

				// 特殊处理零值
				if (value === 0) {
					switch (type) {
						case 'R':
							return '0Ω';
						case 'C':
							return '0pF';
						case 'L':
							return '0uH';
						default:
							return '0';
					}
				}

				const units = {
					'R': [
						{ unit: 'mΩ', factor: 0.001 },
						{ unit: 'Ω', factor: 1 },
						{ unit: 'kΩ', factor: 1000 },
						{ unit: 'MΩ', factor: 1000000 },
					],
					'C': [
						{ unit: 'pF', factor: 1 },
						{ unit: 'nF', factor: 1000 },
						{ unit: 'uF', factor: 1000000 },
						{ unit: 'mF', factor: 1000000000 },
						{ unit: 'F', factor: 1000000000000 },
					],
					'L': [
						{ unit: 'nH', factor: 0.001 },
						{ unit: 'uH', factor: 1 },
						{ unit: 'mH', factor: 1000 },
						{ unit: 'H', factor: 1000000 },
					],
				};

				const typeUnits = units[type];
				if (!typeUnits) return value.toString();

				// 找到最合适的单位
				let bestUnit = typeUnits[0];
				const absValue = Math.abs(value);

				for (let i = typeUnits.length - 1; i >= 0; i--) {
					if (absValue >= typeUnits[i].factor || i === 0) {
						bestUnit = typeUnits[i];
						break;
					}
				}

				const formattedValue = value / bestUnit.factor;

				// 使用Number来去除不必要的尾随零
				const displayValue = Number(formattedValue.toFixed(3)).toString();

				return displayValue + bestUnit.unit;
			}

			// 渲染表格 (改为渲染折叠后的数据)
			function renderTable() {
				const tableBody = document.getElementById('tableBody');
				tableBody.innerHTML = '';

				groupedComponentsData.forEach((group, index) => {
					const row = document.createElement('tr');

					// 修改复选框
					const modifyCell = document.createElement('td');
					modifyCell.className = 'checkbox-cell';
					const modifyCheckbox = document.createElement('input');
					modifyCheckbox.type = 'checkbox';

					modifyCheckbox.checked = group.modified;
					modifyCheckbox.disabled = group.hasError; // 有错误禁用
					modifyCheckbox.dataset.index = index;
					modifyCheckbox.style.transform = 'scale(1)';
					modifyCheckbox.addEventListener('change', function () {
						if (!group.hasError) {
							groupedComponentsData[index].modified = this.checked;
						}
						updateSelectAllCheckbox();
					});
					modifyCell.appendChild(modifyCheckbox);
					row.appendChild(modifyCell);

					// 唯一ID (合并显示)
					// const uniqueIdCell = document.createElement('td');
					// const uniqueIdStr = group.uniqueIds.join(',');
					// uniqueIdCell.textContent = uniqueIdStr;
					// uniqueIdCell.title = uniqueIdStr; // 鼠标悬浮显示完整内容
					// // 样式：防止太长撑爆表格，单行省略
					// uniqueIdCell.style.maxWidth = '120px';
					// uniqueIdCell.style.overflow = 'hidden';
					// uniqueIdCell.style.textOverflow = 'ellipsis';
					// uniqueIdCell.style.whiteSpace = 'nowrap';

					// if (group.hasError) {
					// 	uniqueIdCell.style.color = 'red';
					// 	uniqueIdCell.style.fontWeight = 'bold';
					// 	uniqueIdCell.title = '此项包含空或重复的唯一ID: ' + uniqueIdStr;
					// }
					// row.appendChild(uniqueIdCell);

					// 位号 (合并显示)
					const designatorCell = document.createElement('td');
					const desStr = group.designators.join(',');
					designatorCell.textContent = desStr;
					designatorCell.title = desStr;
					designatorCell.style.maxWidth = '150px';
					designatorCell.style.overflow = 'hidden';
					designatorCell.style.textOverflow = 'ellipsis';
					designatorCell.style.whiteSpace = 'nowrap';
					row.appendChild(designatorCell);

					// --- 封装 (单独显示) ---
                    const footprintCell = document.createElement('td');
                    const footStr = group.footprint || '-'; 
                    footprintCell.textContent = footStr;
                    footprintCell.title = footStr;
                    footprintCell.style.maxWidth = '150px';
                    footprintCell.style.overflow = 'hidden';
                    footprintCell.style.textOverflow = 'ellipsis';
                    footprintCell.style.whiteSpace = 'nowrap';
                    row.appendChild(footprintCell);

					// 代码/名称
					const nameCell = document.createElement('td');
					nameCell.textContent = group.name;
					row.appendChild(nameCell);

					// 转换值
					const valueCell = document.createElement('td');
					valueCell.textContent = group.value;
					if (group.shouldModify) {
						valueCell.style.color = '#4CAF50';
						valueCell.style.fontWeight = 'bold';
					}
					row.appendChild(valueCell);

					tableBody.appendChild(row);
				});

				updateSelectAllCheckbox();
			}

			// 全选/取消全选
			function toggleSelectAll() {
				const selectAll = document.getElementById('selectAll').checked;
				groupedComponentsData.forEach((group) => {
					if (group.shouldModify && !group.hasError) {
						group.modified = selectAll;
					}
				});
				renderTable();
			}

			// 更新全选复选框状态
			function updateSelectAllCheckbox() {
				const selectAllCheckbox = document.getElementById('selectAll');
				const modifiableGroups = groupedComponentsData.filter((g) => g.shouldModify && !g.hasError);
				const selectedGroups = modifiableGroups.filter((g) => g.modified);

				if (modifiableGroups.length === 0) {
					selectAllCheckbox.checked = false;
					selectAllCheckbox.indeterminate = false;
					return;
				}

				if (selectedGroups.length === 0) {
					selectAllCheckbox.checked = false;
					selectAllCheckbox.indeterminate = false;
				} else if (selectedGroups.length === modifiableGroups.length) {
					selectAllCheckbox.checked = true;
					selectAllCheckbox.indeterminate = false;
				} else {
					selectAllCheckbox.checked = false;
					selectAllCheckbox.indeterminate = true;
				}
			}

			// 执行转换 (适配折叠后的数据)
			async function executeConversion() {
				try {
					let modifiedCount = 0;

					// 遍历折叠后的数据组
					for (const group of groupedComponentsData) {
						if (group.modified && group.shouldModify && !group.hasError) {
							// 遍历该组内的所有唯一ID，执行批量修改
							for (const uId of group.uniqueIds) {
								if (!uId || uId === '空') continue;

								for (const key in componentsMap) {
									const mapComponent = componentsMap[key];
									if (mapComponent && mapComponent.props && mapComponent.props['Unique ID'] === uId) {
										mapComponent.props.Name = group.value;
										mapComponent.props.Value = group.value;
										modifiedCount++;
										break;
									}
								}
							}
						}
					}

					const listjson = JSON.stringify(jsonData);

					await setNetlist(Page, listjson);

					eda.sys_IFrame.closeIFrame('CodeConvert');
				} catch (error) {
					console.error('执行转换失败:', error);
					showStatus('转换失败: ' + error.message, 'error');
				}
			}

			// 显示状态信息
			function showStatus(message, type) {
				const statusElement = document.getElementById('status');
				statusElement.textContent = message;
				statusElement.className = 'status ' + type;
			}

			// 初始化函数
			async function initialize() {
				const verTag = document.getElementById('versionTag');

				// 检测版本
				try {
					const version = getEditorVersion();
					console.log('当前EDA版本:', version);
					verTag.textContent = (getVersionFamily() || 'V2') + '模式';
				} catch (e) {
					console.warn('版本检测失败，默认使用V2模式', e);
					verTag.textContent = 'V2模式';
				}

				try {
					const netlist = await getNetlist('AUTO');
					Page = netlist.page;
					jsonData = netlist.json;
					console.log(jsonData);

					// 关键点：确定组件数据源（V3 在 components 内，V2 直接用根对象）
					componentsMap = getComponentsContainer(jsonData);

					// 改进的检查唯一ID是否为空或者重复的代码
					let hasEmptyUniqueId = false;
					const seenIds = {};

					// 使用 componentsMap 进行检查
					for (const key in componentsMap) {
						const component = componentsMap[key];
						if (!component.props) continue; // 跳过非组件项

						const uniqueId = component.props['Unique ID'];

						// 检查是否为空
						if (!uniqueId || uniqueId === '') {
							hasEmptyUniqueId = true;
							break;
						}

						// 检查是否重复（非空的情况下）
						if (uniqueId && uniqueId !== '') {
							if (seenIds[uniqueId]) {
								hasEmptyUniqueId = true;
								break;
							} else {
								seenIds[uniqueId] = true;
							}
						}
					}

					// 处理数据并显示表格
					processComponentsData();
					groupComponents();
					renderTable();

					// 绑定事件
					document.getElementById('selectAll').addEventListener('change', toggleSelectAll);
					document.getElementById('executeBtn').addEventListener('click', executeConversion);

					if (hasEmptyUniqueId) {
						showStatus('部分元件的唯一ID为空/重复，可以在菜单栏-设计-重置唯一ID，否则会出现异常', 'error');
						document.getElementById('executeBtn').disabled = true; // <--- 新增：存在异常时禁用按钮
					} else {
						showStatus(`数据加载成功，请仔细检查后，选择要转换的元件`, 'info');
						document.getElementById('executeBtn').disabled = false; // <--- 确保正常时按钮可用
					}
				} catch (error) {
					console.error('初始化失败:', error);
					showStatus('数据加载失败: ' + error.message, 'error');
				}
			}

			// 页面加载完成后初始化
			document.addEventListener('DOMContentLoaded', async function () {
				await initialize();
			});
