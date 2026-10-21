// ---------- 全局变量 ----------
    const WC = window.WolfCommon;
    if (!WC) {
    	(document.body || document.documentElement).innerHTML = '<div style="padding:24px;font:14px/1.6 sans-serif;color:#f28b82">公共模块 common.js 未加载，请重新安装扩展</div>';
    	throw new Error('[狼黑工具] 公共模块 common.js 未加载');
    }
    const { getNetlist, getComponentsContainer } = WC;
    let allComponents = [];              // 存储所有器件（扁平化）
    let sortedPins = [];                 // 所有出现的引脚编号（排序后）
    // let netlistData = null;

    // DOM 元素
    const typeSelect = document.getElementById('typeSelect');
    const propSelect = document.getElementById('propSelect');
    const tableContainer = document.getElementById('tableContainer');
    const netTable = document.getElementById('netTable');
    const exportPinNetBtn = document.getElementById('exportPinNetBtn');
    const exportAllNetBtn = document.getElementById('exportAllNetBtn');

    // ---------- 工具函数：从原始数据构建 allComponents 和 sortedPins ----------
	function buildComponents(componentsDict) {
		const components = [];
		const pinSet = new Set();

		Object.values(componentsDict).forEach(item => {
			const props = item.props || {};
			let pins = {};

			// 优先使用 pinInfoMap (新格式)
			if (item.pinInfoMap) {
				Object.entries(item.pinInfoMap).forEach(([pin, pinInfo]) => {
					const net = pinInfo.net || '';
					pins[pin] = net;
					pinSet.add(pin);
				});
			} else if (item.pins) {
				// 旧格式
				Object.entries(item.pins).forEach(([pin, net]) => {
					pins[pin] = net || '';
					pinSet.add(pin);
				});
			}
			// 若无任何引脚信息，pins 保持空对象

			const comp = {
				...props,
				pins: pins   // 统一为 { pinNumber: net } 格式
			};
			components.push(comp);
		});

		const sorted = Array.from(pinSet).sort((a, b) => parseInt(a) - parseInt(b));
		return { components, sortedPins: sorted };
	}

    // 获取属性下拉的唯一值
    function getUniquePropValues(typeKey) {
        const values = allComponents.map(comp => comp[typeKey]).filter(Boolean);
        return [...new Set(values)].sort();
    }

    // 填充属性下拉
    function populatePropSelect() {
        const typeKey = typeSelect.value;
        const uniqueVals = getUniquePropValues(typeKey);
        const currentVal = propSelect.value;

        propSelect.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = 'ALL';
        allOption.textContent = '所有';
        allOption.title = '所有'; // <--- 新增：悬浮提示
        propSelect.appendChild(allOption);

        uniqueVals.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = val;
            option.title = val; // <--- 新增：悬浮提示
            propSelect.appendChild(option);
        });

        if (currentVal && uniqueVals.includes(currentVal)) {
            propSelect.value = currentVal;
        } else {
            propSelect.value = 'ALL';
        }
        
        // <--- 新增：初始化时同步 select 自身的 title
        propSelect.title = propSelect.value === 'ALL' ? '所有' : propSelect.value;
    }

    // 渲染表格 (左上角显示属性名: DeviceName / FootprintName)
	function renderTable() {
		const typeKey = typeSelect.value;          // "DeviceName" 或 "FootprintName"
		const filterValue = propSelect.value;      // "ALL" 或 具体名称

        // <--- 新增：每次切换属性时，更新下拉框自身的悬浮提示文本
        propSelect.title = filterValue === 'ALL' ? '所有' : filterValue;

		let filtered = allComponents;
		if (filterValue !== 'ALL') {
			filtered = allComponents.filter(comp => comp[typeKey] === filterValue);
		}

		// 按位号排序
		filtered.sort((a, b) => a.Designator?.localeCompare(b.Designator, undefined, { numeric: true }) || 0);

		// 计算当前筛选结果中实际出现的引脚编号（去重、排序）
		const currentPinSet = new Set();
		filtered.forEach(comp => {
			Object.keys(comp.pins).forEach(pin => currentPinSet.add(pin));
		});
		const currentPins = Array.from(currentPinSet).sort((a, b) => parseInt(a) - parseInt(b));

		// 左上角显示内容：属性值（如 C0603）或“所有器件/所有封装”
		let cornerDisplay;
		if (filterValue === 'ALL') {
			cornerDisplay = typeKey === 'DeviceName' ? '所有器件' : '所有封装';
		} else {
			cornerDisplay = filterValue;
		}

		// 构建表头
		let thead = '<thead><tr>';
		thead += `<th>${cornerDisplay}</th>`;
		currentPins.forEach(pin => {
			thead += `<th>${pin}</th>`;
		});
		thead += '</tr></thead>';

		// 构建表格体
		let tbody = '<tbody>';
		if (filtered.length === 0) {
			tbody += `<tr><td colspan="${currentPins.length + 1}" style="text-align:center; padding:40px; color:#7a8aa5;">暂无匹配器件</td></tr>`;
		} else {
			filtered.forEach(comp => {
				tbody += '<tr>';
				tbody += `<td>${comp.Designator || '?'}</td>`;
				currentPins.forEach(pin => {
					const net = comp.pins[pin] || '';
					tbody += `<td>${net}</td>`;
				});
				tbody += '</tr>';
			});
		}
		tbody += '</tbody>';

		netTable.innerHTML = thead + tbody;
	}

    // ---------- 导出引脚网络为CSV (格式: 第一行: 属性名,引脚1,引脚2,...  后续行: 位号,网络,...) ----------
	function exportPinNetAsCSV() {
		const typeKey = typeSelect.value;
		const filterValue = propSelect.value;

		let filtered = allComponents;
		if (filterValue !== 'ALL') {
			filtered = allComponents.filter(comp => comp[typeKey] === filterValue);
		}
		filtered.sort((a, b) => a.Designator?.localeCompare(b.Designator, undefined, { numeric: true }) || 0);

		// 计算当前筛选结果的引脚集合
		const currentPinSet = new Set();
		filtered.forEach(comp => {
			Object.keys(comp.pins).forEach(pin => currentPinSet.add(pin));
		});
		const currentPins = Array.from(currentPinSet).sort((a, b) => parseInt(a) - parseInt(b));

		const rows = [];
		// 标题行：第一列使用属性名（如 FootprintName），后面是引脚编号
		let cornerDisplay;
		if (filterValue === 'ALL') {
			cornerDisplay = typeKey === 'DeviceName' ? '所有器件' : '所有封装';
		} else {
			cornerDisplay = filterValue;
		}
		const header = [cornerDisplay, ...currentPins];
		rows.push(header.join(','));

		// 数据行
		filtered.forEach(comp => {
			const row = [comp.Designator || ''];
			currentPins.forEach(pin => {
				row.push(comp.pins[pin] || '');
			});
			rows.push(row.join(','));
		});

		const csvContent = rows.join('\n');
		const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${filterValue}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

    // 导出全部网络为TXT (每行一个网络名, 去重, 排序)
    function exportAllNetsAsTxt() {
        // 收集所有非空网络名
        const netSet = new Set();
        allComponents.forEach(comp => {
            Object.values(comp.pins).forEach(net => {
                if (net && typeof net === 'string' && net.trim() !== '') {
                    netSet.add(net.trim());
                }
            });
        });

        const sortedNets = Array.from(netSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const content = sortedNets.join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'all_networks.txt';
        a.click();
        URL.revokeObjectURL(url);
    }
	// 导出全部网络为 CSV (新版：包含网络长度)
	async function exportAllNetsAsCSV() {
		try {
			// 使用新 API 获取 PCB 全部网络和长度信息
			const allNets = await eda.pcb_Net.getAllNets();
			
			if (!allNets || allNets.length === 0) {
				eda.sys_Message.showToastMessage("未能获取到网络数据，请确认是否处于 PCB 环境或图纸中是否包含网络", 2);
				return;
			}

			// 按网络名称自然排序，保持与之前版本一致的阅读体验
			allNets.sort((a, b) => a.net.localeCompare(b.net, undefined, { numeric: true }));

			const rows = [];
			// 添加表头格式：网络名称 + 长度(mil) + 长度(mm)
			rows.push("网络名称,长度(mil),长度(mm)");

			// 遍历数据并进行单位转换与格式化
			allNets.forEach(netItem => {
				const netName = netItem.net || "";
				const lenMil = netItem.length || 0;
				
				// 计算并保留小数位数 (1 mil = 0.0254 mm)
				const formattedMil = lenMil.toFixed(2);
				const formattedMm = (lenMil * 0.0254).toFixed(4);

				// 拼接 CSV 行
				rows.push(`${netName},${formattedMil},${formattedMm}`);
			});

			const content = rows.join('\n');
			// 添加 BOM 以便 Excel 正确打开 UTF-8 文件
			const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'all_networks_length.csv'; 
			a.click();
			URL.revokeObjectURL(url);

		} catch (error) {
			console.error("获取网络长度失败:", error);
			eda.sys_Message.showToastMessage("导出网络数据失败：带长度的网络导出仅在 PCB 视图下有效", 2);
		}
	}

    // ---------- 初始化: 获取数据并渲染 ----------
    async function initApp() {
        // 显示加载中
        netTable.innerHTML = `<div class="loading-message">加载网表中...</div>`;
		
		// 与原逻辑一致：PCB 优先、失败回退 SCH；两侧都失败时异常向上抛
		const jsonData = (await getNetlist('AUTO')).json;

		try {
			// 兼容新格式：如果有 components 字段则使用它，否则使用整个 jsonData
			const componentsDict = getComponentsContainer(jsonData);

			// 构建组件列表和引脚
			const { components, sortedPins: pins } = buildComponents(componentsDict);
            allComponents = components;
            sortedPins = pins;

            // 填充下拉
            populatePropSelect();

            // 渲染表格
            renderTable();

            // 添加事件监听 (确保只绑定一次)
            typeSelect.removeEventListener('change', typeChangeHandler);
            propSelect.removeEventListener('change', renderTable);
            typeSelect.addEventListener('change', typeChangeHandler);
            propSelect.addEventListener('change', renderTable);

            // shift+滚轮横向滚动
            tableContainer.addEventListener('wheel', (e) => {
                if (e.shiftKey) {
                    e.preventDefault();
                    tableContainer.scrollLeft += e.deltaY;
                }
            }, { passive: false });

        } catch (error) {
            netTable.innerHTML = `<div class="loading-message" style="color:#b33;">加载失败: ${error.message}</div>`;
            console.error(error);
        }
    }

    // 类型改变时的处理：重新填充属性下拉，再渲染
    function typeChangeHandler() {
        populatePropSelect();
        renderTable();
    }

    // 绑定导出按钮
    exportPinNetBtn.addEventListener('click', () => {
        if (allComponents.length === 0) {
            eda.sys_Message.showToastMessage("网表尚未加载", 2);
            return;
        }
        exportPinNetAsCSV();
    });

    exportAllNetBtn.addEventListener('click', () => {
        if (allComponents.length === 0) {
            eda.sys_Message.showToastMessage("网表尚未加载", 2);
            return;
        }
        exportAllNetsAsCSV();
    });

    // 启动
    initApp();
