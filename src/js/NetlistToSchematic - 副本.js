export async function placeComponentsEfficiently(viewType = "PCB") {
    // console.log(`当前视图类型: ${viewType}`);
    
    // 全局变量，用于记录跳转前的原理图Tab ID
    let _lastSchematicTabId = null;
    // 1. 版本检测
    let isV3 = false;
    try {
        if (typeof eda !== 'undefined' && eda.sys_Environment && eda.sys_Environment.getEditorCurrentVersion) {
            const version = eda.sys_Environment.getEditorCurrentVersion();
            console.log('当前EDA版本:', version);
            if (version && version.toString().startsWith('3')) {
                isV3 = true;
            }
        }
    } catch (e) {
        console.warn("版本检测忽略", e);
    }

    let jsonObject;
    let netdataa;
    if (viewType === "NET") {
        // 导入网表文件
        const listtxt = await eda.sys_FileSystem.openReadFileDialog();
        let fileContent = await listtxt.text();
        let jsonString;
        if (Array.isArray(fileContent)) {
            jsonString = fileContent.join('');
        } else if (typeof fileContent === 'string') {
            jsonString = fileContent;
        } else {
            eda.sys_Message.showToastMessage("不支持的文件格式", "error");
        }
        netdataa = jsonString.trim();
        
    } else if (viewType === "PCB") {
        // 用户点击"确定"，继续执行
        await switchToPCB();
        eda.sys_Message.showToastMessage('正在获取数据', 2);
        // netdataa = await eda.pcb_Net.getNetlist('JLCEDA');
        const getNetlistFile = await eda.pcb_ManufactureData.getNetlistFile();
        netdataa = await getNetlistFile.text();

        await switchToSchematic();
        // 添加短暂延迟，避免操作过快
        await delay(1000);
    } else {
        eda.sys_Log.add(`不支持的导入方式: ${viewType}`, "error"); // 修复变量名 importMethod -> viewType
        eda.sys_PanelControl.openBottomPanel("log");
        throw new Error(`不支持的导入方式: ${viewType}`);
    }
    // 解析 JSON
    jsonObject = JSON.parse(netdataa);
    
    // 2. 确定组件数据源 (兼容 V2/V3)
    let componentsMap = jsonObject;
    if (isV3 && jsonObject.components) {
        componentsMap = jsonObject.components;
        console.log("识别为 V3 格式网表结构");
    } else {
        console.log("识别为 V2 格式网表结构");
    }
    
    // 初始化变量 - 使用Map提高查找性能
    let cacheHitCount = 0;
    let queryCount = 0;
    
    // 使用Map代替数组，提高查找性能
    const cNumberCache = new Map();     // key: C编号, value: uuid
    const nameExactCache = new Map();   // key: 名称, value: uuid  
    const nameFuzzyCache = new Map();   // key: 名称, value: uuid
    
    const cNumberExactMatch = []; // [唯一ID, C编号, UUID, 位号, 名称Name]
    const nameExactMatch = [];    // [唯一ID, 名称, UUID, 位号, 名称Name]
    const nameFuzzyMatch = [];    // [唯一ID, 名称, UUID, 位号, 名称Name]
    const failedComponents = [];  // 记录失败的器件

    // 延迟函数
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 1. 切换到当前板子对应的PCB界面
    async function switchToPCB() {
        try {
            // A. 记录当前原理图信息 (如果当前是在原理图界面)
            const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
            console.log(curDoc);
            if (curDoc && curDoc.documentType === 1) { // 1 代表原理图
                _lastSchematicTabId = curDoc.uuid + '@' + curDoc.parentProjectUuid;
                console.log(_lastSchematicTabId);
                console.log(curDoc.tabId);
            }

            // B. 获取当前板子对应的 PCB UUID
            const boardInfo = await eda.dmt_Board.getCurrentBoardInfo();
            console.log(boardInfo);
            if (!boardInfo || !boardInfo.pcb) throw new Error("未获取到板子信息");
            const targetPcbUuid = boardInfo.pcb.uuid;

            // C. 在分屏树中查找 匹配该UUID 的 PCB Tab
            const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
            // TabId 通常格式为 "UUID@ProjectID"，所以使用 includes 匹配
            const pcbTab = splitData.tabs.find(tab => tab.tabId.includes(targetPcbUuid));
            console.log(pcbTab);
            if (pcbTab) {
                await eda.dmt_EditorControl.activateDocument(pcbTab.tabId);
            } else {
                await eda.sys_Message.showToastMessage("未找到当前板子对应的PCB窗口，请确认PCB已打开",2);
            }
        } catch (error) {
            console.error("切换PCB失败:", error);
        }
    }

    // 2. 切换回原来的原理图界面
    async function switchToSchematic() {
        try {
            console.log(_lastSchematicTabId);//没有输出
            await eda.dmt_EditorControl.activateDocument(_lastSchematicTabId);//没有跳转回原来的页面
        } catch (error) {
            console.error("切换原理图失败:", error);
        }
    }


    // 获取系统库UUID
    const libUuid = await eda.lib_LibrariesList.getSystemLibraryUuid();
    if (!libUuid) {
        eda.sys_Message.showToastMessage("无法获取系统库UUID", "error");
        return;
    }

    // 创建提示文本
    await createInfoTexts();
    
    // 记录开始时间
    const startTime = Date.now();
    
    // 第一阶段：查找UUID (传入 componentsMap)
    await findUUIDs(componentsMap);
    
    const uuidLookupTime = Date.now();
    
    // 对数组进行排序
    sortArraysByDesignator();
    
    // 第二阶段：放置器件
    await placeComponents();
    
    const endTime = Date.now();
    
    // 显示统计信息
    await showStatistics(startTime, uuidLookupTime, endTime);

    async function createInfoTexts() {
        await eda.sch_PrimitiveText.create(10, 30, 'C编号精确匹配↗', 0, '#00ff00', 'Arial', 20, false, false, false, 0);
        await eda.sch_PrimitiveText.create(-140, 30, '↖名称精确匹配', 0, '#00ff00', 'Arial', 20, false, false, false, 0);
        await eda.sch_PrimitiveText.create(-140, -10, '↙名称模糊匹配\n    需要仔细检查', 0, '#00ff00', 'Arial', 20, false, false, false, 0);
        await eda.sch_PrimitiveText.create(10, -10, '统计信息↘', 0, '#00ff00', 'Arial', 20, false, false, false, 0);
        await eda.sch_PrimitiveText.create(10, -50, '运行过程中不要切换视图，否则会停止放置', 0, '#00ff00', 'Arial', 30, false, false, false, 0);
    }

    async function findUUIDs(componentsMap) {
        const totalComponents = Object.keys(componentsMap).length;
        let processedCount = 0;

        // 添加计时变量
        const uuidLookupStartTime = Date.now();

        const progressText = await eda.sch_PrimitiveText.create(10, -100, '通过API查找器件进度：0/' + totalComponents + '，0%', 0, '#00ff00', 'Arial', 20, false, false, false, 0);
        
        console.log(`开始处理 ${totalComponents} 个器件...`);
        
        // 3. 使用 componentsMap 进行遍历
        for (const [uniqueId, netItem] of Object.entries(componentsMap)) {
            // 防御性检查：确保 props 存在
            if (!netItem || !netItem.props) {
                console.warn(`跳过无效节点: ${uniqueId}`);
                processedCount++; // 跳过也算进度，防止进度条卡住
                continue;
            }

            const designator = netItem.props['Designator'] || '';
            const name = netItem.props['Name'] || '';
            const deviceName = netItem.props['DeviceName'] || '';
            
            let uuid = '';
            let foundInCache = false;
            
            // 1. 先尝试C编号匹配
            const lcscId = netItem.props['Supplier Part'];
            if (lcscId && lcscId.trim() !== '' && lcscId.startsWith('C')) {
                // 从缓存中查找
                if (cNumberCache.has(lcscId)) {
                    cacheHitCount++;
                    uuid = cNumberCache.get(lcscId);
                    foundInCache = true;
                    cNumberExactMatch.push([uniqueId, lcscId, uuid, designator, name]);
                    console.log(`缓存命中 C编号: ${lcscId} -> ${uuid}`);
                } else {
                    // 缓存中没有，进行API查询
                    queryCount++;
                    try {
                        console.log(`查询 C编号: ${lcscId}`);
                        const deviceInfo = await eda.lib_Device.getByLcscIds(lcscId, '', false);
                        if (deviceInfo && deviceInfo[0] && deviceInfo[0].uuid) {
                            uuid = deviceInfo[0].uuid;
                            // 添加到缓存
                            cNumberCache.set(lcscId, uuid);
                            cNumberExactMatch.push([uniqueId, lcscId, uuid, designator, name]);
                            console.log(`查询成功 C编号: ${lcscId} -> ${uuid}`);
                        } else {
                            console.log(`查询失败 C编号: ${lcscId}`);
                        }
                    } catch (error) {
                        console.warn(`C编号查询失败: ${lcscId}`, error);
                    }
                }
            }
            
            if (uuid) {
                processedCount++;
                updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
                continue;
            }
            
            // 2. 尝试DeviceName精确匹配
            if (deviceName && deviceName.trim() !== '' && !uuid) {
                if (nameExactCache.has(deviceName)) {
                    cacheHitCount++;
                    uuid = nameExactCache.get(deviceName);
                    foundInCache = true;
                    nameExactMatch.push([uniqueId, deviceName, uuid, designator, name]);
                    console.log(`缓存命中 DeviceName精确: ${deviceName} -> ${uuid}`);
                }
            }
            
            if (uuid) {
                processedCount++;
                updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
                continue;
            }
            
            // 3. 尝试Name精确匹配
            if (name && name.trim() !== '' && !uuid) {
                if (nameExactCache.has(name)) {
                    cacheHitCount++;
                    uuid = nameExactCache.get(name);
                    foundInCache = true;
                    nameExactMatch.push([uniqueId, name, uuid, designator, name]);
                    console.log(`缓存命中 Name精确: ${name} -> ${uuid}`);
                }
            }
            
            if (uuid) {
                processedCount++;
                updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
                continue;
            }
            
            // 4. 尝试DeviceName模糊匹配
            if (deviceName && deviceName.trim() !== '' && !uuid) {
                if (nameFuzzyCache.has(deviceName)) {
                    cacheHitCount++;
                    uuid = nameFuzzyCache.get(deviceName);
                    foundInCache = true;
                    nameFuzzyMatch.push([uniqueId, deviceName, uuid, designator, name]);
                    console.log(`缓存命中 DeviceName模糊: ${deviceName} -> ${uuid}`);
                }
            }
            
            if (uuid) {
                processedCount++;
                updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
                continue;
            }
            
            // 5. 尝试Name模糊匹配
            if (name && name.trim() !== '' && !uuid) {
                if (nameFuzzyCache.has(name)) {
                    cacheHitCount++;
                    uuid = nameFuzzyCache.get(name);
                    foundInCache = true;
                    nameFuzzyMatch.push([uniqueId, name, uuid, designator, name]);
                    console.log(`缓存命中 Name模糊: ${name} -> ${uuid}`);
                }
            }
            
            if (uuid) {
                processedCount++;
                updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
                continue;
            }
            
            // 6. API查询DeviceName (如果前面都没找到)
            if (deviceName && deviceName.trim() !== '' && !uuid && !foundInCache) {
                queryCount++;
                try {
                    console.log(`API查询 DeviceName: ${deviceName}`);
                    const devices = await eda.lib_Device.search(deviceName);
                    if (devices && devices.length > 0) {
                        uuid = devices[0].uuid;
                        if (devices[0].name === deviceName) {
                            nameExactCache.set(deviceName, uuid);
                            nameExactMatch.push([uniqueId, deviceName, uuid, designator, name]);
                            console.log(`API查询成功 DeviceName精确: ${deviceName} -> ${uuid}`);
                        } else if (devices.length > 1) {
                            nameFuzzyCache.set(deviceName, uuid);
                            nameFuzzyMatch.push([uniqueId, deviceName, uuid, designator, name]);
                            console.log(`API查询成功 DeviceName模糊: ${deviceName} -> ${uuid}`);
                        }
                    } else {
                        console.log(`API查询失败 DeviceName: ${deviceName}`);
                    }
                } catch (error) {
                    console.warn(`DeviceName API查询失败: ${deviceName}`, error);
                }
            }
            
            if (uuid) {
                processedCount++;
                updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
                continue;
            }
            
            // 7. API查询Name (如果前面都没找到)
            if (name && name.trim() !== '' && !uuid && !foundInCache) {
                queryCount++;
                try {
                    console.log(`API查询 Name: ${name}`);
                    const devices = await eda.lib_Device.search(name);
                    if (devices && devices.length > 0) {
                        uuid = devices[0].uuid;
                        if (devices[0].name === name) {
                            nameExactCache.set(name, uuid);
                            nameExactMatch.push([uniqueId, name, uuid, designator, name]);
                            console.log(`API查询成功 Name精确: ${name} -> ${uuid}`);
                        } else if (devices.length > 1) {
                            nameFuzzyCache.set(name, uuid);
                            nameFuzzyMatch.push([uniqueId, name, uuid, designator, name]);
                            console.log(`API查询成功 Name模糊: ${name} -> ${uuid}`);
                        }
                    } else {
                        console.log(`API查询失败 Name: ${name}`);
                    }
                } catch (error) {
                    console.warn(`Name API查询失败: ${name}`, error);
                }
            }
            
            // 记录未找到UUID的器件
            if (!uuid) {
                failedComponents.push([uniqueId, designator, name, deviceName]);
                console.log(`未找到UUID: ${designator} - ${name} - ${deviceName}`);
            }
            
            processedCount++;
            updateProgress(progressText, processedCount, totalComponents, uuidLookupStartTime, queryCount);
            
        }
        
        console.log(`UUID查找完成: 缓存命中 ${cacheHitCount} 次, API查询 ${queryCount} 次`);
    }
    
    function updateProgress(progressText, current, total, startTime, apiCount) {
        const percentage = ((current / total) * 100).toFixed(1);
        const elapsedTime = Date.now() - startTime;
        
        let averageTimePerComponent = 0;
        if (apiCount > 0) {
            averageTimePerComponent = (elapsedTime / apiCount).toFixed(1);
        }
        
        eda.sch_PrimitiveText.modify(progressText.primitiveId, {
            'content': `通过API查找器件进度：${current}/${total}，${percentage}%，平均${averageTimePerComponent}ms/个`
        });
    }
    
    function sortArraysByDesignator() {
        // 按位号排序函数
        const sortByDesignator = (a, b) => {
            const designatorA = a[3] || '';
            const designatorB = b[3] || '';
            return designatorA.localeCompare(designatorB, undefined, { numeric: true });
        };
        
        cNumberExactMatch.sort(sortByDesignator);
        nameExactMatch.sort(sortByDesignator);
        nameFuzzyMatch.sort(sortByDesignator);
    }
    
    async function placeComponents() {
        const placementText = await eda.sch_PrimitiveText.create(10, -120, '放置器件进度：准备中...', 0, '#00ff00', 'Arial', 20, false, false, false, 0);
        
        const totalToPlace = cNumberExactMatch.length + nameExactMatch.length + nameFuzzyMatch.length;
        let placedCount = 0;
        
        // 添加计时变量
        const placementStartTime = Date.now();
        
        const placementPromises = [];
        
        // 放置C编号精确匹配的器件（第一象限）
        placementPromises.push(placeComponentArray(cNumberExactMatch, 100, 100, 1, 1, () => {
            placedCount++;
            updatePlacementProgress(placementText, placedCount, totalToPlace, placementStartTime);
        }));
        
        // 放置名称精确匹配的器件（第二象限）
        placementPromises.push(placeComponentArray(nameExactMatch, -100, 100, -1, 1, () => {
            placedCount++;
            updatePlacementProgress(placementText, placedCount, totalToPlace, placementStartTime);
        }));
        
        // 放置名称模糊匹配的器件（第三象限）
        placementPromises.push(placeComponentArray(nameFuzzyMatch, -100, -100, -1, -1, () => {
            placedCount++;
            updatePlacementProgress(placementText, placedCount, totalToPlace, placementStartTime);
        }));
        
        // 并行执行所有放置操作
        await Promise.all(placementPromises);
    }
    
    function updatePlacementProgress(placementText, current, total, startTime) {
        const percentage = ((current / total) * 100).toFixed(1);
        const elapsedTime = Date.now() - startTime;
        
        let averageTimePerComponent = 0;
        if (current > 0) {
            averageTimePerComponent = (elapsedTime / current).toFixed(1);
        }
        
        eda.sch_PrimitiveText.modify(placementText.primitiveId, {
            'content': `通过API放置器件进度：${current}/${total}，${percentage}%，平均${averageTimePerComponent}ms/个`
        });
    }
    
    async function placeComponentArray(componentArray, startX, startY, xDirection, yDirection, onPlacement) {
        const placementPromises = [];
        let x = startX;
        let y = startY;
        const xStep = 200 * xDirection;
        const yStep = 200 * yDirection;
        let countInRow = 0;
        const maxInRow = 20;
        
        for (const [uniqueId, , uuid, designator, name] of componentArray) {
            if (uuid) {
                const placementPromise = eda.sch_PrimitiveComponent
                    .create({ 'libraryUuid': libUuid, 'uuid': uuid }, x, y, '', 0, false, true, true)
                    .then((result) => {
                        result.setState_UniqueId(uniqueId);
                        result.setState_Designator(designator);
                        result.setState_Name(name);
                        result.done();
                        onPlacement();
                    })
                    .catch(error => {
                        console.error(`放置器件失败: ${designator}`, error);
                        failedComponents.push([uniqueId, designator, name, '放置失败']);
                        onPlacement();
                    });
                
                placementPromises.push(placementPromise);
            }
            
            // 更新坐标
            countInRow++;
            if (countInRow >= maxInRow) {
                countInRow = 0;
                x = startX;
                y += yStep;
            } else {
                x += xStep;
            }
        }
        
        // 等待当前数组的所有放置操作完成
        await Promise.all(placementPromises);
    }
    
    async function showStatistics(startTime, uuidLookupTime, endTime) {
        const totalComponents = Object.keys(componentsMap).length; // 修正为使用 componentsMap 统计
        const successCount = cNumberExactMatch.length + nameExactMatch.length + nameFuzzyMatch.length;
        const failureCount = failedComponents.length;
        const totalTime = (endTime - startTime) / 1000;
        const uuidLookupTimeSec = (uuidLookupTime - startTime) / 1000;
        const placementTimeSec = (endTime - uuidLookupTime) / 1000;
        
        const cacheHitRate = queryCount > 0 ? ((cacheHitCount / (cacheHitCount + queryCount)) * 100).toFixed(2) : '100.00';
        
        const statsText = `
==== 统计信息 ====

总器件数: ${totalComponents}
放置成功: ${successCount}
放置失败: ${failureCount}

查询次数: ${queryCount}
缓存命中: ${cacheHitCount}
缓存命中率: ${cacheHitRate}%

器件查找耗时: ${uuidLookupTimeSec.toFixed(2)}秒
器件放置耗时: ${placementTimeSec.toFixed(2)}秒
总耗时: ${totalTime.toFixed(2)}秒
平均每个器件: ${(totalTime / totalComponents).toFixed(3)}秒

${nameFuzzyMatch.length > 0 ? '如有少量模糊匹配可手动修改\n如果模糊匹配太多，建议先做器件标准化' : '全部器件精确匹配'}

${failureCount > 0 ? '如有少量失败可手动放置\n如果失败太多，建议先做器件标准化' : '所有器件放置成功'}

完成后可手动将此信息删除
        `.trim();
        
        await eda.sch_PrimitiveText.create(10, -160, statsText, 0, failureCount > 0 ? '#ff9900' : '#00ff00', 'Arial', 16, false, false, false, 0);
        
        // 放置失败的器件标记
        if (failedComponents.length > 0) {
            let failX = 300;
            let failY = -200;
            for (const [uniqueId, designator, name] of failedComponents) {
                const failText = `放置失败\n位号:${designator}\n名称:${name}`;
                await eda.sch_PrimitiveText.create(failX, failY, failText, 0, '#ff0000', 'Arial', 20, false, false, false, 0);
                failY -= 60;
                if (failY < -800) {
                    failY = -300;
                    failX += 150;
                }
            }
        }
    }
}