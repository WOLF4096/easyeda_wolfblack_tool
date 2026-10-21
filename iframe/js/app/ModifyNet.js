(function() {
        const WC = window.WolfCommon;
        if (!WC) {
        	(document.body || document.documentElement).innerHTML = '<div style="padding:24px;font:14px/1.6 sans-serif;color:#f28b82">公共模块 common.js 未加载，请重新安装扩展</div>';
        	throw new Error('[狼黑工具] 公共模块 common.js 未加载');
        }
        const { hasEda, getVersionFamily, isModern, getNetlist, setNetlist, getComponentsContainer } = WC;

        const resultOutput = document.getElementById('resultOutput');
        const executeBtn = document.getElementById('executeBtn');
        const csvInput = document.getElementById('csvInput');
        const designatorInput = document.getElementById('designatorInput');
        const status = document.getElementById('status');
        const verLabel = document.getElementById('verLabel');
        // 「转大写」复选框：部分 EDA 版本对小写网络名支持不友好，默认勾选
        const toUpperCheckbox = document.getElementById('toUpper');

        let cachedNetlistData = null;

        // 初始化：获取网表并存储
        async function initNetlistData() {
            try {
                status.className = 'status';
                if (hasEda()) {
                    try {
                        // 显示实际版本族：V2.2 / V3 / V4
                        verLabel.textContent = (getVersionFamily() || 'V2.2') + '模式';
                    } catch (e) {
                        verLabel.textContent = 'Error';
                    }

                    const { json } = await getNetlist('PCB');
                    cachedNetlistData = json;

                    status.textContent = '✅ 网表已加载，可直接输入位号查询或粘贴数据替换。';
                    status.className = 'status info';
                    console.log('网表已缓存', getVersionFamily() || 'V2');
                } else {
                    status.textContent = '⚠️ 未检测到EDA环境，请在嘉立创EDA中运行。';
                    status.className = 'status error';
                }
            } catch (error) {
                console.error('初始化网表失败:', error);
                status.textContent = '❌ 初始化失败: ' + error.message;
                status.className = 'status error';
            }
        }

        // --- 功能1：实时查询器件引脚 ---
        designatorInput.addEventListener('input', function () {
            const query = this.value.trim().toUpperCase();

            if (!query) {
                resultOutput.value = '';
                return;
            }

            if (!cachedNetlistData) {
                resultOutput.value = '错误：网表数据未加载，请重新打开插件。';
                return;
            }

            let foundComponent = null;
            let outputLines = [];

            // 查找组件（V3 在 components 容器内，V2 直接是根对象）
            const componentContainer = getComponentsContainer(cachedNetlistData);
            for (const key in componentContainer) {
                const comp = componentContainer[key];
                if (comp && comp.props && comp.props.Designator && comp.props.Designator.toUpperCase() === query) {
                    foundComponent = comp;
                    break;
                }
            }

            // 格式化输出
            if (foundComponent) {
                if (isModern()) {
                    if (foundComponent.pinInfoMap) {
                        const pinKeys = Object.keys(foundComponent.pinInfoMap).sort((a, b) => {
                            return isNaN(a) || isNaN(b) ? a.localeCompare(b) : parseInt(a) - parseInt(b);
                        });

                        for (const pinKey of pinKeys) {
                            const info = foundComponent.pinInfoMap[pinKey];
                            const netName = info.net || '';
                            outputLines.push(`${pinKey}\t${netName}`);
                        }
                    }
                } else {
                    if (foundComponent.pins) {
                        const pinKeys = Object.keys(foundComponent.pins).sort((a, b) => {
                            return isNaN(a) || isNaN(b) ? a.localeCompare(b) : parseInt(a) - parseInt(b);
                        });

                        for (const pinKey of pinKeys) {
                            const netName = foundComponent.pins[pinKey] || '';
                            outputLines.push(`${pinKey}\t${netName}`);
                        }
                    }
                }
                resultOutput.value = outputLines.join('\n');
            } else {
                resultOutput.value = `未找到位号为 "${query}" 的器件。`;
            }
        });

        // --- 功能2：批量替换执行 ---
        executeBtn.addEventListener('click', async function () {
            executeBtn.disabled = true;
            executeBtn.textContent = '处理中...';
            resultOutput.value = '';
            status.className = 'status';

            try {
                const content = csvInput.value.trim();
                if (!content) throw new Error('请从 Excel 复制粘贴替换规则');

                const { json: jsonData } = await getNetlist('PCB');
                cachedNetlistData = jsonData;

                // 强制使用制表符分隔
                const separator = '\t';
                const lines = content.split('\n');
                const replaceRules = [];

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine) {
                        const parts = trimmedLine.split(separator).map((item) => item.trim());
                        if (parts.length >= 2) {
                            const oldName = parts[0];
                            const newName = parts[1];
                            if (oldName && newName) replaceRules.push({ oldName, newName });
                        }
                    }
                }

                if (replaceRules.length === 0) throw new Error('未找到有效的替换规则 (请确保使用Tab分隔)');

                resultOutput.value += `找到 ${replaceRules.length} 条替换规则\n\n`;

                const replaceMap = new Map();
                const shouldUpperCase = toUpperCheckbox ? toUpperCheckbox.checked : true;
                for (const rule of replaceRules) {
                    // key 统一小写：匹配时忽略大小写（网表里的网络名大小写和 Excel 里不一定一致）
                    const newNet = shouldUpperCase ? rule.newName.toUpperCase() : rule.newName;
                    replaceMap.set(rule.oldName.toLowerCase(), newNet);
                }

                let totalReplacements = 0;

                if (isModern()) {
                    const componentContainer = getComponentsContainer(jsonData);
                    for (const componentKey in componentContainer) {
                        const component = componentContainer[componentKey];
                        const designator = component.props ? component.props.Designator : componentKey;

                        if (component.pinInfoMap) {
                            for (const pinKey in component.pinInfoMap) {
                                const pinInfo = component.pinInfoMap[pinKey];
                                const netKey = pinInfo && pinInfo.net ? pinInfo.net.toLowerCase() : '';
                                if (netKey && replaceMap.has(netKey)) {
                                    const newNet = replaceMap.get(netKey);
                                    resultOutput.value += `替换: ${designator}.${pinKey} [${pinInfo.net} -> ${newNet}]\n`;
                                    pinInfo.net = newNet;
                                    totalReplacements++;
                                }
                            }
                        }
                    }
                } else {
                    const componentContainer = getComponentsContainer(jsonData);
                    for (const componentKey in componentContainer) {
                        const component = componentContainer[componentKey];
                        if (component.pins) {
                            const designator = component.props ? component.props.Designator : 'Unknown';
                            for (const pinKey in component.pins) {
                                const currentNet = component.pins[pinKey];
                                const netKey = currentNet ? String(currentNet).toLowerCase() : '';
                                if (netKey && replaceMap.has(netKey)) {
                                    const newNet = replaceMap.get(netKey);
                                    resultOutput.value += `替换: ${designator}.${pinKey} [${currentNet} -> ${newNet}]\n`;
                                    component.pins[pinKey] = newNet;
                                    totalReplacements++;
                                }
                            }
                        }
                    }
                }

                resultOutput.value += `\n完成 ${totalReplacements} 次替换`;

                const updatedJsonString = JSON.stringify(jsonData, null, 2);
                await setNetlist('PCB', updatedJsonString);

                cachedNetlistData = jsonData;

                status.textContent = `✅ 成功替换 ${totalReplacements} 处`;
                status.className = 'status success';
            } catch (error) {
                console.error('Error:', error);
                status.textContent = `❌ 出错: ${error.message}`;
                status.className = 'status error';
                resultOutput.value += `\n错误: ${error.message}`;
            } finally {
                executeBtn.disabled = false;
                executeBtn.textContent = '执行替换';
            }
        });

        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(initNetlistData, 500);
        });
    })();
