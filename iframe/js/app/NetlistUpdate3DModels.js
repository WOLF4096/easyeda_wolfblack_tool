// 获取 EDA 环境上下文 (适配 iframe)
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
        const { getNetlist, getComponentsContainer } = WC;

        // 全局状态 (默认使用 mm)
        let appState = {
            data: [],          
            unit: 'mm',       
            sortCol: null,     
            sortAsc: true      
        };

        // DOM 元素
        const tbody = document.getElementById('table-body');
        // const unitLabel = document.getElementById('unit-label');
        const btnUnit = document.getElementById('btn-unit');
        const btnUpdate = document.getElementById('btn-update');
        const statusText = document.getElementById('status-text');
        const progressBg = document.getElementById('progressBg');

        // --- 核心业务逻辑 ---
        // 新增：获取当前网表
        // 新增：获取当前网表 (兼容 V2/V3)
        document.getElementById('btn-get-current').addEventListener('click', async () => {
            if (!sys_eda) {
                notice('未检测到 EDA 运行环境');
                mockDataLoad();
                return;
            }

            try {
                statusText.textContent = '正在获取当前PCB网表...';

                // 2. 获取 PCB 网表数据
                let netlistData;
                try {
                    // 只获取 PCB 网表，按照你提供的脚本 API 规范
                    netlistData = (await getNetlist('PCB')).json;
                } catch (apiError) {
                    console.error("API 调用失败:", apiError);
                    throw new Error("无法读取 PCB 网表，请确保当前处于 PCB 编辑页面");
                }

                // 3. 交给已有的解析函数处理 
                // (注：原有的 parseNetlist 函数已经包含了 V2/V3 components 路径的兼容处理)
                parseNetlist(netlistData);
                
                // sys_eda.sys_Message.showToastMessage(`成功获取当前网表 (${isV3 ? 'V3' : 'V2'})`, 'success');

            } catch (error) {
                console.error('获取当前网表失败:', error);
                sys_eda.sys_Message.showToastMessage('获取当前网表失败: ' + error.message, 'error');
                statusText.textContent = '就绪'; // 恢复状态文本
            }
        });

        document.getElementById('btn-load').addEventListener('click', async () => {
            if (!sys_eda) {
                notice('未检测到 EDA 运行环境');
                mockDataLoad(); // 方便浏览器独立调试
                return;
            }

            try {
                const fileResult = await sys_eda.sys_FileSystem.openReadFileDialog();
                if (!fileResult) return;

                let fileContent = typeof fileResult === 'object' && fileResult.text ? await fileResult.text() : fileResult;
                let jsonString = Array.isArray(fileContent) ? fileContent.join('') : fileContent;
                const netlistData = JSON.parse(jsonString.trim());
                
                parseNetlist(netlistData);
            } catch (error) {
                sys_eda.sys_Message.showToastMessage('网表解析失败: ' + error.message, 'error');
            }
        });

        function parseNetlist(netlistData) {
            console.log(netlistData);
            appState.data = [];
            let componentsSource = getComponentsContainer(netlistData);

            for (const key in componentsSource) {
                const component = componentsSource[key];
                if (component && component.props) {
                    const designator = component.props.Designator;
                    
                    // 只要有位号，就将其视为有效器件
                    if (designator) {
                        // 提取属性，如果没有则赋予空字符串或默认值
                        const model3D = component.props['3D Model'] || '';
                        const modelTitle = component.props['3D Model Title'] || '';
                        const transform = component.props['3D Model Transform'] || '0,0,0,0,0,0,0,0,0';
                        
                        // 兼容多种封装字段命名可能 (V2/V3)
                        const footprint = component.props['FootprintName'] || component.props['Footprint Name'] || component.props['Footprint'] || '-'; 

                        const tParts = transform.split(',').map(Number);
                        
                        appState.data.push({
                            id: designator,
                            designator: designator,
                            footprint: footprint,
                            modelTitle: modelTitle || '没有找到 3D 模型',
                            rawModel: model3D,
                            rawTransform: transform,
                            sX: tParts[0] || 0, sY: tParts[1] || 0, sZ: tParts[2] || 0,
                            rZ: tParts[3] || 0, rX: tParts[4] || 0, rY: tParts[5] || 0,
                            oX: tParts[6] || 0, oY: tParts[7] || 0, oZ: tParts[8] || 0,
                            status: model3D ? '待更新' : '无模型', // 区分一下状态
                            primitiveId: null
                        });
                    }
                }
            }
            
            btnUpdate.disabled = appState.data.length === 0;
            statusText.textContent = `成功加载 ${appState.data.length} 个器件`;
            appState.sortCol = 'modelTitle';
            appState.sortAsc = true;
            renderTable();
        }

        // 单位切换及智能数值格式化
        btnUnit.addEventListener('click', () => {
            appState.unit = appState.unit === 'mm' ? 'mil' : 'mm';
            // unitLabel.textContent = `(${appState.unit})`;
            btnUnit.textContent = appState.unit === 'mm' ? '单位切换' : '单位切换';
            // 新增：动态更新表头的大分类单位显示
            document.getElementById('th-size').textContent = `大小 (${appState.unit})`;
            document.getElementById('th-offset').textContent = `偏移 (${appState.unit})`;
            renderTable();
        });

        // 缺省 0 显示的核心处理，利用 Number() 自动丢弃末尾无效 0
        function formatVal(val, isDegree = false) {
            let num = Number(val);
            if (isNaN(num)) return val;

            if (isDegree) {
                return Number(num.toFixed(3)); // 旋转角度不涉转换，仅去多余零
            }
            if (appState.unit === 'mm') {
                return Number((num * 0.0254).toFixed(3)); 
            }
            return Number(num.toFixed(3)); // mil 下同样格式化
        }

        // 处理用户在输入框中的修改
        window.updateParam = function(id, field, value) {
            let item = appState.data.find(d => d.id === id);
            if (!item) return;

            let numVal = Number(value);
            if (isNaN(numVal)) numVal = 0;

            // 转换逻辑：如果是大小或偏移，且当前界面显示的是 mm，则输入的值需要转回 mil 存入底层
            let isDegree = field.startsWith('r');
            if (!isDegree && appState.unit === 'mm') {
                numVal = numVal / 0.0254; 
            }
            
            // 更新该字段的值
            item[field] = numVal;

            // 重新拼接底层所需的 Transform 字符串格式: sX,sY,sZ,rZ,rX,rY,oX,oY,oZ
            // 注意 rZ 对应的索引是 3，rX 是 4，rY 是 5
            let tArray = [
                item.sX, item.sY, item.sZ,
                item.rZ, item.rX, item.rY,
                item.oX, item.oY, item.oZ
            ];
            item.rawTransform = tArray.join(',');
            item.status = '已修改';
        };

        // 重新渲染表格，注入 input
        function renderTable() {
            if (appState.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: #888;">未找到有效的3D模型数据</td></tr>';
                return;
            }

            let renderData = [...appState.data];
            if (appState.sortCol) {
                renderData.sort((a, b) => {
                    let valA = a[appState.sortCol];
                    let valB = b[appState.sortCol];
                    
                    if (typeof valA === 'string') {
                        return appState.sortAsc 
                            ? valA.localeCompare(valB, undefined, {numeric: true}) 
                            : valB.localeCompare(valA, undefined, {numeric: true});
                    }
                    return appState.sortAsc ? valA - valB : valB - valA;
                });
            }

            // 辅助函数：生成 input 标签
            const makeInput = (item, field, isDegree) => {
                let displayVal = formatVal(item[field], isDegree);
                return `<td class="col-xyz"><input class="xyz-input" type="text" value="${displayVal}" onchange="updateParam('${item.id}', '${field}', this.value)"></td>`;
            };

            tbody.innerHTML = renderData.map(item => {
                let statusClass = 'status-ready';
                if (item.status === '成功') statusClass = 'status-success';
                if (item.status === '失败' || item.status === '未找到') statusClass = 'status-error';
                if (item.status === '已修改') statusClass = 'status-success'; // 稍微高亮提示已修改

                let modelTitleHtml = item.modelTitle;
                if (item.modelTitle === '没有找到 3D 模型') {
                    modelTitleHtml = `<span class="text-error">${item.modelTitle}</span>`;
                }

                return `<tr>
                    <td title="${item.designator}">${item.designator}</td>
                    <td title="${item.footprint}">${item.footprint}</td>
                    <td title="${item.modelTitle}">${modelTitleHtml}</td>
                    ${makeInput(item, 'sX', false)} ${makeInput(item, 'sY', false)} ${makeInput(item, 'sZ', false)}
                    ${makeInput(item, 'rX', true)} ${makeInput(item, 'rY', true)} ${makeInput(item, 'rZ', true)}
                    ${makeInput(item, 'oX', false)} ${makeInput(item, 'oY', false)} ${makeInput(item, 'oZ', false)}
                    <td class="${statusClass}" id="status-${item.id}">${item.status}</td>
                </tr>`;
            }).join('');
        }
        
        // 无图标隐式排序逻辑
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', (e) => {
                const col = e.target.getAttribute('data-sort');
                if (!col) return;
                
                if (appState.sortCol === col) {
                    appState.sortAsc = !appState.sortAsc;
                } else {
                    appState.sortCol = col;
                    appState.sortAsc = true; 
                }
                renderTable();
            });
        });

        // 执行批量更新
        btnUpdate.addEventListener('click', async () => {
            if (!sys_eda) return;
            //记录任务开始时间
			const startTime = performance.now();

            btnUpdate.disabled = true;
            document.getElementById('btn-load').disabled = true;
            document.getElementById('btn-unit').disabled = true;
            
            progressBg.style.width = '0%';
            statusText.textContent = '正在获取PCB器件...';
            
            try {
                const pcbComps = await sys_eda.pcb_PrimitiveComponent.getAll();
                const pcbMap = {};
                pcbComps.forEach(comp => {
                    if (comp && comp.designator && comp.primitiveId) {
                        pcbMap[comp.designator] = comp.primitiveId;
                    }
                });

                const total = appState.data.length;
                let successCount = 0;

                for (let i = 0; i < total; i++) {
                    let item = appState.data[i];
                    let primId = pcbMap[item.designator];

                    statusText.textContent = `正在处理: ${item.designator}`;
                    
                    if (!primId) {
                        item.status = '未找到';
                    } 
                    // ===== 新增需求：如果没有模型或 UUID 为空，则拒绝修改 =====
                    else if (!item.rawModel || item.rawModel.trim() === '') {
                        item.status = '跳过';
                    } 
                    // =========================================================
                    else {
                        try {
                            const result = await sys_eda.pcb_PrimitiveComponent.modify(primId, {
                                otherProperty: {
                                    '3D Model': item.rawModel,
                                    '3D Model Title': item.modelTitle,
                                    '3D Model Transform': item.rawTransform,
                                }
                            });
                            
                            // 校验返回值
                            let isSuccess = false;
                            if (result && result.otherProperty) {
                                const retModel = result.otherProperty['3D Model'] || '';
                                const retTitle = result.otherProperty['3D Model Title'] || '';
                                const retTransform = result.otherProperty['3D Model Transform'] || '';
                                
                                // 提取返回值中的实际 UUID (忽略 | 后面的内容)
                                const actualRetModel = retModel.split('|')[0];
                                const targetModel = item.rawModel.split('|')[0]; // 也对输入值做容错处理

                                // 比较核心属性是否一致
                                if (actualRetModel === targetModel && 
                                    retTitle === item.modelTitle && 
                                    retTransform === item.rawTransform) {
                                    isSuccess = true;
                                }
                            }

                            if (isSuccess) {
                                item.status = '成功';
                                successCount++;
                            } else {
                                item.status = '校验失败';
                                console.warn(`更新 ${item.designator} 返回值校验不匹配:`, result);
                            }
                            
                        } catch (err) {
                            item.status = '失败';
                            console.error(`更新 ${item.designator} 失败:`, err);
                        }
                    }

                    // 进度条流畅更新 (合并状态与进度百分比文字)
                    let percent = Math.round(((i + 1) / total) * 100);
                    progressBg.style.width = percent + '%';
                    statusText.textContent = `进度：${i + 1} / ${total} (${percent}%)，正在处理: ${item.designator}`;
                    renderTable();
                    
                    await new Promise(r => setTimeout(r, 10)); 
                }

                // 【新增】：计算耗时（秒）保留两位小数
                const costTime = ((performance.now() - startTime) / 1000).toFixed(2);
                
                // 【修改】：将耗时拼接到状态文本中
                statusText.textContent = `更新完成: 成功 ${successCount}/${total} | 耗时：${costTime}秒`;
                sys_eda.sys_Message.showToastMessage(`批量更新完成`, 'success');

            } catch (error) {
                statusText.textContent = '更新异常中断';
                sys_eda.sys_Message.showToastMessage('发生未预期错误', 'error');
            } finally {
                btnUpdate.disabled = false;
                document.getElementById('btn-load').disabled = false;
                document.getElementById('btn-unit').disabled = false;
            }
        });

        // 开发测试用的 Mock 数据
        function mockDataLoad() {
            const mockJSON = {
                components: {
                    "comp1": { props: { Designator: "R1", "3D Model": "uuid1", "3D Model Title": "RES_0603", "3D Model Transform": "387,200,300,90,0,45.500,10,20.000,0", "Footprint": "R0603" }},
                    "comp2": { props: { Designator: "C1", "3D Model": "uuid2", "3D Model Title": "CAP_0402", "3D Model Transform": "50,50,50,0,0,0,0,0,0", "Footprint": "C0402" }},
                    "comp3": { props: { Designator: "U1", "3D Model": "uuid3", "3D Model Title": "ESP32-WROOM", "3D Model Transform": "700.00,1000,120,0,0,90,-50,20,10", "Footprint": "MODULE-38P" }}
                }
            };
            parseNetlist(mockJSON);
        }
