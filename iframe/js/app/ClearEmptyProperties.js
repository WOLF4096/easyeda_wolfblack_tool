// 获取 EDA 环境上下文
        const sys_eda = window.parent.eda || window.eda;

/**
 * 轻量提示：优先用 EDA 的 toast；不在 EDA 环境（浏览器直开）时退回页面顶部横幅
 * 注意：不能直接调 eda.* —— 这条路径本身就是为了处理「eda 不存在」的情况。
 */
function notice(msg) {
    try {
        if (sys_eda && sys_eda.sys_Message) {
            sys_eda.sys_Message.showToastMessage(msg, 2);
            return;
        }
    } catch (e) {
        /* 忽略：继续走页面提示 */
    }
    let bar = document.getElementById("__wolf_notice");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "__wolf_notice";
        bar.style.cssText = "position:fixed;left:0;right:0;top:0;padding:8px 12px;background:#5a1d1d;color:#fff;font:13px/1.5 sans-serif;z-index:9999";
        document.body.appendChild(bar);
    }
    bar.textContent = msg;
    setTimeout(() => bar.remove(), 3000);
}
        const WC = window.WolfCommon;
        if (!WC) {
        	(document.body || document.documentElement).innerHTML = '<div style="padding:24px;font:14px/1.6 sans-serif;color:#f28b82">公共模块 common.js 未加载，请重新安装扩展</div>';
        	throw new Error('[狼黑工具] 公共模块 common.js 未加载');
        }
        const { getNetlist, setNetlist, getComponentsContainer } = WC;

        // 全局状态
        let rawNetlistData = null; 
        let dataSourceMode = 'PCB'; // 'PCB' 或 'SCH'
        let appData = [];
        let sortCol = null;
        let sortAsc = true;

        // 属性分类定义
        const whitelist = [
            "Convert to PCB", "Reuse Block", "Group ID", "Channel ID", 
            "PCB Layer", "Device", "Footprint", "Add into BOM",
            "FootprintName", "DeviceName", "SymbolName"
        ];
        
        const basePropsList = [
            "Name", "Unique ID", "Designator", "3D Model", 
            "3D Model Title", "3D Model Transform"
        ];
        
        const keyPropsList = [
            "Manufacturer", "Manufacturer Part", "Supplier", 
            "Supplier Part", "Value"
        ];

        // DOM 元素
        const tbody = document.getElementById('tableBody');
        const btnRefresh = document.getElementById('btnRefresh');
        const btnClear = document.getElementById('btnClear');
        const cbAllRows = document.getElementById('cbAllRows');
        
        const thAllBase = document.getElementById('thAllBase');
        const thAllKey = document.getElementById('thAllKey');
        const thAllMore = document.getElementById('thAllMore');

        // 1. 获取网表数据
        async function fetchNetlist() {
            if (!sys_eda) {
                notice('未检测到 EDA 运行环境');
                return;
            }

            try {
                btnRefresh.disabled = true;
                btnRefresh.textContent = "获取中...";
                
                const netlist = await getNetlist('AUTO');
                dataSourceMode = netlist.page;
                rawNetlistData = netlist.json;

                let componentsSource = getComponentsContainer(rawNetlistData);
                
                appData = [];
                for (const key in componentsSource) {
                    const comp = componentsSource[key];
                    if (comp && comp.props && comp.props.Designator) {
                        const supplierVal = comp.props.Supplier || "";
                        const isEmptySupplier = supplierVal.trim() === "";

                        appData.push({
                            id: key,
                            designator: comp.props.Designator || "",
                            name: comp.props.Name || "",
                            // 优先读取 FootprintName，如果没有则降级读取 Footprint
                            footprint: comp.props.FootprintName || comp.props.Footprint || "",
                            supplier: supplierVal,
                            
                            // UI 勾选状态：Supplier为空时勾选行和"更多属性"，否则全不选
                            selected: isEmptySupplier,
                            clearBase: false,
                            clearKey: false,
                            clearMore: isEmptySupplier,
                            
                            refProps: comp.props 
                        });
                    }
                }

                sortCol = 'designator';
                sortAsc = true;
                sortData();
                renderTable();

                sys_eda.sys_Message.showToastMessage(`成功获取 ${appData.length} 个元件数据`, 'success');

            } catch (error) {
                console.error("网表获取失败:", error);
                sys_eda.sys_Message.showToastMessage("获取数据失败: " + error.message, 'error');
            } finally {
                btnRefresh.disabled = false;
                btnRefresh.textContent = "刷新数据";
            }
        }

        // 2. 渲染表格
        function renderTable() {
            if (appData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #888;">未找到组件数据，请检查图纸</td></tr>';
                return;
            }

            tbody.innerHTML = appData.map((item, index) => {
                const rowClass = item.selected ? "" : "disabled-row";
                const disabledAttr = item.selected ? "" : "disabled";
                
                return `
                    <tr class="${rowClass}">
                        <td><input type="checkbox" class="cb-row" data-index="${index}" ${item.selected ? 'checked' : ''}></td>
                        <td title="${item.designator}">${item.designator}</td>
                        <td title="${item.name}">${item.name || '-'}</td>
                        <td title="${item.footprint}">${item.footprint || '-'}</td>
                        <td title="${item.supplier}">${item.supplier || '-'}</td>
                        <td><input type="checkbox" class="cb-base" data-index="${index}" ${item.clearBase ? 'checked' : ''} ${disabledAttr}></td>
                        <td><input type="checkbox" class="cb-key" data-index="${index}" ${item.clearKey ? 'checked' : ''} ${disabledAttr}></td>
                        <td><input type="checkbox" class="cb-more" data-index="${index}" ${item.clearMore ? 'checked' : ''} ${disabledAttr}></td>
                    </tr>
                `;
            }).join('');
            
            updateSelectAllRowState();
        }

        // 3. 排序逻辑
        function sortData() {
            if (!sortCol) return;
            appData.sort((a, b) => {
                let valA = a[sortCol] || "";
                let valB = b[sortCol] || "";
                
                return sortAsc 
                    ? valA.localeCompare(valB, undefined, { numeric: true })
                    : valB.localeCompare(valA, undefined, { numeric: true });
            });
        }

        // 4. 执行清空逻辑
        async function executeClear() {
            if (!sys_eda || !rawNetlistData || appData.length === 0) return;

            const selectedItems = appData.filter(item => item.selected && (item.clearBase || item.clearKey || item.clearMore));
            if (selectedItems.length === 0) {
                sys_eda.sys_Message.showToastMessage("没有勾选需要清空的属性或元件", "warning");
                return;
            }

            try {
                let processCount = 0;

                selectedItems.forEach(item => {
                    let isModified = false;
                    const props = item.refProps;

                    for (const key in props) {
                        if (whitelist.includes(key)) continue;

                        let isBase = basePropsList.includes(key);
                        let isKey = keyPropsList.includes(key);
                        let isMore = !isBase && !isKey;

                        let shouldClear = false;
                        if (isBase && item.clearBase) shouldClear = true;
                        if (isKey && item.clearKey) shouldClear = true;
                        if (isMore && item.clearMore) shouldClear = true;

                        if (shouldClear && props[key] !== "") {
                            props[key] = "";
                            isModified = true;
                        }
                    }

                    if (isModified) processCount++;
                });

                const updatedJsonString = JSON.stringify(rawNetlistData, null, 2);

                await setNetlist(dataSourceMode, updatedJsonString);

                sys_eda.sys_Message.showToastMessage(`成功处理 ${processCount} 个元件`, 'success');
                // await fetchNetlist();

            } catch (error) {
                console.error('写回网表失败:', error);
                sys_eda.sys_Message.showToastMessage('执行失败: ' + error.message, 'error');
            }
        }

        // ================= 事件绑定 =================
        
        btnRefresh.addEventListener('click', fetchNetlist);
        btnClear.addEventListener('click', executeClear);

        // 表格内复选框点击处理
        tbody.addEventListener('change', (e) => {
            const target = e.target;
            if (target.tagName !== 'INPUT' || target.type !== 'checkbox') return;

            const index = parseInt(target.getAttribute('data-index'));
            const item = appData[index];

            if (target.classList.contains('cb-row')) {
                item.selected = target.checked;
                renderTable(); 
            } else if (target.classList.contains('cb-base')) {
                item.clearBase = target.checked;
            } else if (target.classList.contains('cb-key')) {
                item.clearKey = target.checked;
            } else if (target.classList.contains('cb-more')) {
                item.clearMore = target.checked;
            }
        });

        // 表头排序点击
        document.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.getAttribute('data-sort');
                if (sortCol === col) {
                    sortAsc = !sortAsc;
                } else {
                    sortCol = col;
                    sortAsc = true;
                }
                
                document.querySelectorAll('.sort-icon').forEach(icon => icon.textContent = '');
                th.querySelector('.sort-icon').textContent = sortAsc ? '▲' : '▼';
                
                sortData();
                renderTable();
            });
        });

        // 行级全选/反选
        cbAllRows.addEventListener('change', (e) => {
            const checked = e.target.checked;
            appData.forEach(item => item.selected = checked);
            renderTable();
        });

        // 列级点击表头全选/反选逻辑
        const toggleColumnState = (field) => {
            // 仅对当前处于激活（已勾选）状态的行进行操作
            const activeItems = appData.filter(item => item.selected);
            if (activeItems.length === 0) return;

            // 判断是否所有的激活行都已勾选了该属性列
            const isAllChecked = activeItems.every(item => item[field]);
            // 如果全勾选了，目标状态就是取消勾选；反之则全部勾选
            const targetState = !isAllChecked;

            activeItems.forEach(item => item[field] = targetState);
            renderTable();
        };

        thAllBase.addEventListener('click', () => toggleColumnState('clearBase'));
        thAllKey.addEventListener('click', () => toggleColumnState('clearKey'));
        thAllMore.addEventListener('click', () => toggleColumnState('clearMore'));

        // 更新左上角总行多选框状态
        function updateSelectAllRowState() {
            if (appData.length === 0) return;
            const allRowsChecked = appData.every(item => item.selected);
            const someRowsChecked = appData.some(item => item.selected);
            cbAllRows.checked = allRowsChecked;
            cbAllRows.indeterminate = someRowsChecked && !allRowsChecked;
        }

        // 初始化
        document.addEventListener('DOMContentLoaded', () => {
            if (sys_eda) fetchNetlist();
        });
