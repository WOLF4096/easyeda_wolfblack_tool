// 狼黑工具 - 生成物理网络 (V2/V3 自动适配版)
// 开发平台：嘉立创EDA专业版 v2.2.43 v3.2.69
// 功能：根据EDA版本自动切换解析引擎，合并了V2的高效与V3的兼容性修复

// =============================================================
// 模块 1：共享基础算法与工具 (Shared Utils)
// =============================================================

class UnionFind {
    constructor() { this.parent = {}; }
    find(id) {
        if (this.parent[id] === undefined) this.parent[id] = id;
        if (this.parent[id] !== id) this.parent[id] = this.find(this.parent[id]);
        return this.parent[id];
    }
    union(id1, id2) {
        let root1 = this.find(id1);
        let root2 = this.find(id2);
        if (root1 !== root2) this.parent[root1] = root2;
    }
}

// 几何计算 (采用 V3 的高精度版本)
function areLayersConnected(a, b) {
    const LAYER_MULTI = 12;
    const getLayerIds = (obj) => {
        if (obj.blindLayers && obj.blindLayers.length > 0) return obj.blindLayers;
        if (obj.layer === LAYER_MULTI) return "ALL";
        return [obj.layer];
    };
    const layersA = getLayerIds(a);
    const layersB = getLayerIds(b);

    if (layersA === "ALL" || layersB === "ALL") return true;

    for (let i = 0; i < layersA.length; i++) {
        if (layersB.indexOf(layersA[i]) !== -1) return true;
    }
    return false;
}

function checkConnectivityHighPrecision(a, b) {
    if (!areLayersConnected(a, b)) return false;

    // 几何预检与计算 (V3 精度)
    const epsilon = 0.001;
    let aw_half = a.w / 2 + epsilon, ah_half = a.h / 2 + epsilon;
    let bw_half = b.w / 2 + epsilon, bh_half = b.h / 2 + epsilon;
    
    if (a.shape === 'line' && b.shape === 'line') return isTwoLinesTouching(a, b);

    let lineObj = null, shapeObj = null;
    if (a.shape === 'line') { lineObj = a; shapeObj = b; }
    else if (b.shape === 'line') { lineObj = b; shapeObj = a; }
    
    if (lineObj && shapeObj) {
        if (shapeObj.shape === 'ROUND') {
            let distSq = distToSegmentSquared(shapeObj.x, shapeObj.y, lineObj.x1, lineObj.y1, lineObj.x2, lineObj.y2);
            let threshold = shapeObj.r + (lineObj.w / 2);
            return distSq <= ((threshold + 0.01) ** 2);
        }
        if (shapeObj.shape === 'RECT') {
            let inflation = (lineObj.w / 2) + 0.01; 
            let rect = {
                x: shapeObj.x, y: shapeObj.y, 
                w: shapeObj.w + inflation * 2, h: shapeObj.h + inflation * 2
            };
            return isLineIntersectRect(lineObj.x1, lineObj.y1, lineObj.x2, lineObj.y2, rect);
        }
    }

    if (a.shape === 'ROUND' && b.shape === 'ROUND') {
         let d2 = (a.x - b.x)**2 + (a.y - b.y)**2;
         let rSum = a.r + b.r;
         return d2 < (rSum * rSum + 0.01); 
    }

    return Math.abs(a.x - b.x) < (aw_half + bw_half) && Math.abs(a.y - b.y) < (ah_half + bh_half);
}

function distToSegmentSquared(px, py, l1x, l1y, l2x, l2y) {
    let l2 = (l2x - l1x) ** 2 + (l2y - l1y) ** 2;
    if (l2 === 0) return (px - l1x) ** 2 + (py - l1y) ** 2;
    let t = ((px - l1x) * (l2x - l1x) + (py - l1y) * (l2y - l1y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (px - (l1x + t * (l2x - l1x))) ** 2 + (py - (l1y + t * (l2y - l1y))) ** 2;
}

function isTwoLinesTouching(l1, l2) {
    let minDistSq = (l1.w/2 + l2.w/2) ** 2;
    minDistSq = (Math.sqrt(minDistSq) + 0.01) ** 2; 
    if (distToSegmentSquared(l1.x1, l1.y1, l2.x1, l2.y1, l2.x2, l2.y2) <= minDistSq) return true;
    if (distToSegmentSquared(l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2) <= minDistSq) return true;
    if (distToSegmentSquared(l2.x1, l2.y1, l1.x1, l1.y1, l1.x2, l1.y2) <= minDistSq) return true;
    if (distToSegmentSquared(l2.x2, l2.y2, l1.x1, l1.y1, l1.x2, l1.y2) <= minDistSq) return true;
    if (segmentsIntersect(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2)) return true;
    return false;
}

function isLineIntersectRect(x1, y1, x2, y2, rect) {
    let rx = rect.x - rect.w/2; let ry = rect.y - rect.h/2;
    let rw = rect.w; let rh = rect.h;
    if (isPointInRect(x1, y1, rect) || isPointInRect(x2, y2, rect)) return true;
    if (segmentsIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry)) return true;
    if (segmentsIntersect(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh)) return true;
    if (segmentsIntersect(x1, y1, x2, y2, rx, ry, rx, ry + rh)) return true;
    if (segmentsIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh)) return true;
    return false;
}

function isPointInRect(px, py, rect) { return Math.abs(px - rect.x) <= rect.w/2 && Math.abs(py - rect.y) <= rect.h/2; }

function segmentsIntersect(a_x, a_y, a_x2, a_y2, b_x, b_y, b_x2, b_y2) {
    function ccw(p1x, p1y, p2x, p2y, p3x, p3y) { return (p2x - p1x) * (p3y - p1y) - (p2y - p1y) * (p3x - p1x); }
    let d1 = ccw(a_x, a_y, a_x2, a_y2, b_x, b_y); let d2 = ccw(a_x, a_y, a_x2, a_y2, b_x2, b_y2);
    let d3 = ccw(b_x, b_y, b_x2, b_y2, a_x, a_y); let d4 = ccw(b_x, b_y, b_x2, b_y2, a_x2, a_y2);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function getBoundingBox(shapeData) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let found = false;
    function scan(data) {
        if (Array.isArray(data)) {
            if (data[0] === "R" && typeof data[1] === 'number') {
                let x = data[1], y = data[2], w = data[3], h = data[4];
                minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y + h);
                found = true;
            } else { data.forEach(d => scan(d)); }
        }
    }
    scan(shapeData);
    if (!found) return null;
    return { x: (minX+maxX)/2, y: (minY+maxY)/2, w: maxX-minX, h: maxY-minY };
}

// 通用API数据获取
async function fetchAllPads() {
    let resultPads = [];
    try {
        let allPads = await eda.pcb_PrimitivePad.getAll();
        console.log(`[系统] API获取到 ${allPads.length} 个焊盘...`);

        allPads.forEach(pad => {
            let w = 10, h = 10;
            let shapeType = "RECT"; 
            if (pad.pad && pad.pad.length > 1) {
                shapeType = pad.pad[0]; 
                w = Number(pad.pad[1]);
                h = Number(pad.pad[2] || w); 
            }

            let algoShape = "RECT";
            let radius = 0;
            if (shapeType === "ROUND" || (shapeType === "ELLIPSE" && Math.abs(w - h) < 0.1)) {
                algoShape = "ROUND";
                radius = w / 2;
            } else {
                algoShape = "RECT";
                let rot = Math.abs(Number(pad.rotation || 0)) % 180;
                if (Math.abs(rot - 90) < 1.0) { let temp = w; w = h; h = temp; } 
                else if (rot > 1.0 && rot < 89.0) { let minSide = Math.min(w, h); w = minSide; h = minSide; }
            }

            resultPads.push({
                id: pad.primitiveId, type: "PAD", net: pad.net,
                layer: pad.layer, shape: algoShape, 
                x: Number(pad.x), y: Number(pad.y), w: w, h: h, r: radius
            });
        });
    } catch (e) { console.error("获取焊盘数据失败:", e); }
    return resultPads;
}

// 辅助：解析层栈
function getStackIds(innerLayerIds) {
    const LAYER_TOP = 1;
    const LAYER_BOTTOM = 2;
    innerLayerIds.sort((a, b) => a - b);
    let uniqueLayers = [...new Set(innerLayerIds)];
    return [LAYER_TOP, ...uniqueLayers, LAYER_BOTTOM];
}

function getRealLayerIdsFromRange(rangeStr, stackIds) {
    if (!rangeStr || rangeStr === "") return null; 
    let parts = rangeStr.split('-');
    if (parts.length !== 2) return null;
    let startIdx = parseInt(parts[0]);
    let endIdx = parseInt(parts[1]);
    if (startIdx < 1) startIdx = 1;
    if (endIdx > stackIds.length) endIdx = stackIds.length;
    let resultIds = [];
    for (let i = startIdx; i <= endIdx; i++) {
        let realId = stackIds[i-1]; 
        if (realId !== undefined) resultIds.push(realId);
    }
    return resultIds;
}

// =============================================================
// 模块 2：V2 逻辑引擎 (Legacy Array Format)
// =============================================================
async function runLogicV2(rawSource, netlistJson, allPads) {
    console.log(">> 正在使用 V2 (数组格式) 解析引擎...");
    
    const lines = rawSource.split('\n');
    const compIdToDesignator = {}; 
    const padIdToPinInfo = {};     
    const primitives = [];
    const innerLayerIds = []; 
    const allUsedNetNames = new Set();
    const LAYER_MULTI = 12; 

    // [Step 1] 解析
    lines.forEach(line => {
        if (!line.trim() || !line.startsWith('[')) return;
        try {
            let jsonStr = line.replace(/^\\s*/, '');
            let item = JSON.parse(jsonStr);
            let type = item[0];

            if (item[3] && typeof item[3] === 'string' && item[3] !== "") {
                allUsedNetNames.add(item[3]);
            }

            if (type === "LAYER") {
                let lid = Number(item[1]);
                let status = Number(item[4]); 
                if (lid >= 15 && lid <= 46 && status === 3) {
                    innerLayerIds.push(lid);
                }
            } else if (type === "ATTR") {
                let ownerId = item[3]; let key = item[7]; let val = item[8];     
                if (key === "Designator" && ownerId && val) { compIdToDesignator[ownerId] = val; }
            } else if (type === "PAD_NET") {
                let compId = item[1]; let pinNum = item[2]; let padSuffix = item[4]; 
                padIdToPinInfo[compId + padSuffix] = { compId: compId, pin: pinNum };
            } else if (type === "LINE") {
                primitives.push({
                    id: item[1], type: "LINE", net: item[3], layer: item[4],
                    shape: "line", x1: Number(item[5]), y1: Number(item[6]), x2: Number(item[7]), y2: Number(item[8]), w: Number(item[9])
                });
            } else if (type === "VIA") {
                let dia = Number(item[8]);
                let viaRangeStr = item[4]; 
                primitives.push({
                    id: item[1], type: "VIA", net: item[3], layer: LAYER_MULTI,
                    _rawRange: viaRangeStr,
                    shape: "ROUND", x: Number(item[5]), y: Number(item[6]), w: dia, h: dia, r: dia / 2
                });
            } else if (type === "ARC") {
                primitives.push({
                    id: item[1], type: "ARC", net: item[3], layer: item[4],
                    shape: "line", x1: Number(item[5]), y1: Number(item[6]), x2: Number(item[7]), y2: Number(item[8]), w: Number(item[9])
                });
            } else if (type === "FILL" || type === "POUR" || type === "POLY") {
                let shapeData = (type === "POUR") ? item[8] : item[7];
                for(let k=item.length-1; k>=0; k--) { 
                    if(Array.isArray(item[k])) { shapeData = item[k]; break; } 
                }
                let bounds = getBoundingBox(shapeData);
                if (bounds) {
                    primitives.push({
                        id: item[1], type: type, net: item[3], layer: item[4],
                        shape: "RECT", x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h
                    });
                }
            }
        } catch (e) {}
    });

    const stackIds = getStackIds(innerLayerIds);
    primitives.forEach(p => {
        if (p.type === "VIA" && p._rawRange) {
            p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
        }
    });

    for (let padId in padIdToPinInfo) {
        let info = padIdToPinInfo[padId];
        if (compIdToDesignator[info.compId]) info.des = compIdToDesignator[info.compId];
        else info.des = null; 
    }

    allPads.forEach(p => { if (p.net) allUsedNetNames.add(p.net); });
    const allPrimitives = primitives.concat(allPads);
    
    // 执行通用计算
    let netlistUpdates = await performPhysicalCalculation(allPrimitives, padIdToPinInfo, allUsedNetNames);

    // [Step 4] V2 专用网表更新 (compData.pins)
    console.log(`================ 准备写入网表 (V2模式) ================`);
    let updateCount = 0;
    for (let internalId in netlistJson) {
        let compData = netlistJson[internalId];
        if (!compData || !compData.props) continue;
        let des = compData.props.Designator;
        if (!des) continue; 
        if (netlistUpdates.hasOwnProperty(des)) {
            let pinUpdates = netlistUpdates[des];
            if (!compData.pins) compData.pins = {};
            for (let pinNum in pinUpdates) {
                let targetNet = pinUpdates[pinNum];
                let pinKey = String(pinNum); 
                if (compData.pins[pinKey] !== targetNet) {
                    compData.pins[pinKey] = targetNet;
                    updateCount++;
                }
            }
        }
    }
    return { count: updateCount, netlist: netlistJson };
}

// =============================================================
// 模块 3：V3 逻辑引擎 (Pipe/Object Format + V2 Compatible)
// =============================================================
async function runLogicV3(rawSource, netlistJson, allPads) {
    console.log(">> 正在使用 V3 (混合/对象格式) 解析引擎...");

    const lines = rawSource.split('\n');
    const compIdToDesignator = {}; 
    const padIdToPinInfo = {};     
    const primitives = [];
    const innerLayerIds = []; 
    const allUsedNetNames = new Set();
    const LAYER_MULTI = 12;

    function parseV3LineObjects(line) {
        if (!line.trim()) return [];
        // V2 Array
        if (line.trim().startsWith('[')) {
            try { return [JSON.parse(line.replace(/^\\s*/, ''))]; } 
            catch(e) { return []; }
        }
        // V3 Object with Pipes
        if (line.trim().startsWith('{')) {
            let results = [];
            let cleanLine = line.trim();
            if (cleanLine.endsWith('|')) cleanLine = cleanLine.slice(0, -1);
            let parts = cleanLine.split('||');
            parts.forEach(part => {
                try { if(part.trim()) results.push(JSON.parse(part)); } catch(e) {}
            });
            return results;
        }
        return [];
    }

    // [Step 1] 解析
    lines.forEach(line => {
        let objects = parseV3LineObjects(line);
        if (objects.length === 0) return;

        let mergedItem = {};
        let isV3Array = false;
        if (Array.isArray(objects[0])) {
            mergedItem = objects[0]; isV3Array = true;
        } else {
            objects.forEach(obj => { Object.assign(mergedItem, obj); });
        }

        let type = isV3Array ? mergedItem[0] : mergedItem.type;

        // Layer Logic
        if (type === "LAYER") {
            let lid = -1; let isUsed = false;
            if (isV3Array) {
                lid = Number(mergedItem[1]); isUsed = (Number(mergedItem[4]) > 0);
            } else {
                if (mergedItem.layerId !== undefined) lid = mergedItem.layerId;
                else {
                    try { let idArr = typeof mergedItem.id === 'string' ? JSON.parse(mergedItem.id) : mergedItem.id; if (Array.isArray(idArr)) lid = idArr[1]; } catch(e){}
                }
                isUsed = (mergedItem.use === true);
            }
            if (lid >= 15 && lid <= 46 && isUsed && !innerLayerIds.includes(lid)) {
                innerLayerIds.push(lid);
            }
        }

        // Net Name
        let netName = "";
        if (!isV3Array) {
            if (mergedItem.netName) netName = mergedItem.netName;
            if (type === "PAD_NET" && mergedItem.padNet) netName = mergedItem.padNet;
        } else {
            if (mergedItem[3] && typeof mergedItem[3] === 'string') netName = mergedItem[3];
        }
        if (netName) allUsedNetNames.add(netName);

        // Primitives
        try {
            if (type === "ATTR") {
                if (!isV3Array) {
                    if (mergedItem.key === "Designator" && mergedItem.value && mergedItem.parentId) {
                        compIdToDesignator[mergedItem.parentId] = mergedItem.value;
                    }
                } else {
                    let ownerId = mergedItem[3]; let key = mergedItem[7]; let val = mergedItem[8];     
                    if (key === "Designator" && ownerId && val) { compIdToDesignator[ownerId] = val; }
                }
            } else if (type === "PAD_NET") {
                if (!isV3Array) {
                    let idRaw = mergedItem.id;
                    if (typeof idRaw === 'string' && idRaw.startsWith('[')) {
                        let idParts = JSON.parse(idRaw); 
                        if (idParts.length >= 4) {
                            let compId = idParts[1]; let pinNum = idParts[2]; let padSuffix = idParts[3]; 
                            padIdToPinInfo[compId + padSuffix] = { compId: compId, pin: pinNum };
                            padIdToPinInfo[padSuffix] = { compId: compId, pin: pinNum };
                        }
                    }
                } else {
                    let compId = mergedItem[1]; let pinNum = mergedItem[2]; let padSuffix = mergedItem[4]; 
                    padIdToPinInfo[compId + padSuffix] = { compId: compId, pin: pinNum };
                }
            } else if (type === "LINE") {
                if (!isV3Array) {
                    primitives.push({
                        id: mergedItem.ticket || mergedItem.id, type: "LINE", net: mergedItem.netName, layer: mergedItem.layerId,
                        shape: "line", x1: mergedItem.startX, y1: mergedItem.startY, x2: mergedItem.endX, y2: mergedItem.endY, w: mergedItem.width
                    });
                } else {
                    primitives.push({
                        id: mergedItem[1], type: "LINE", net: mergedItem[3], layer: mergedItem[4],
                        shape: "line", x1: Number(mergedItem[5]), y1: Number(mergedItem[6]), x2: Number(mergedItem[7]), y2: Number(mergedItem[8]), w: Number(mergedItem[9])
                    });
                }
            } else if (type === "VIA") {
                let dia, x, y, net, viaRangeStr;
                if (!isV3Array) {
                    dia = mergedItem.viaDiameter; x = mergedItem.centerX; y = mergedItem.centerY;
                    net = mergedItem.netName; viaRangeStr = mergedItem.ruleName;
                } else {
                    dia = Number(mergedItem[8]); viaRangeStr = mergedItem[4]; 
                    x = Number(mergedItem[5]); y = Number(mergedItem[6]); net = mergedItem[3];
                }
                primitives.push({
                    id: !isV3Array ? (mergedItem.ticket || mergedItem.id) : mergedItem[1], 
                    type: "VIA", net: net, layer: LAYER_MULTI, _rawRange: viaRangeStr,
                    shape: "ROUND", x: x, y: y, w: dia, h: dia, r: dia / 2
                });
            } else if (type === "ARC") {
                 if (!isV3Array) {
                    primitives.push({
                        id: mergedItem.ticket || mergedItem.id, type: "ARC", net: mergedItem.netName, layer: mergedItem.layerId,
                        shape: "line", x1: mergedItem.startX, y1: mergedItem.startY, x2: mergedItem.endX, y2: mergedItem.endY, w: mergedItem.width
                    });
                } else {
                    primitives.push({
                        id: mergedItem[1], type: "ARC", net: mergedItem[3], layer: mergedItem[4],
                        shape: "line", x1: Number(mergedItem[5]), y1: Number(mergedItem[6]), x2: Number(mergedItem[7]), y2: Number(mergedItem[8]), w: Number(mergedItem[9])
                    });
                }
            }
        } catch(e) {}
    });

    const stackIds = getStackIds(innerLayerIds);
    primitives.forEach(p => {
        if (p.type === "VIA" && p._rawRange) {
            p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
        }
    });

    for (let padId in padIdToPinInfo) {
        let info = padIdToPinInfo[padId];
        if (compIdToDesignator[info.compId]) info.des = compIdToDesignator[info.compId];
        else info.des = null; 
    }

    allPads.forEach(p => { if (p.net) allUsedNetNames.add(p.net); });
    const allPrimitives = primitives.concat(allPads);

    // 执行通用计算
    let netlistUpdates = await performPhysicalCalculation(allPrimitives, padIdToPinInfo, allUsedNetNames);

    // [Step 4] V3 专用网表更新 (支持 pinInfoMap)
    console.log(`================ 准备写入网表 (V3模式) ================`);
    let updateCount = 0;
    
    // V3 的 netlist 结构通常在 components 字段下
    let compSource = netlistJson.components ? netlistJson.components : netlistJson;

    for (let internalId in compSource) { 
        let compData = compSource[internalId];
        if (!compData || !compData.props) continue;
        let des = compData.props.Designator;
        if (!des) continue; 
        
        if (netlistUpdates.hasOwnProperty(des)) {
            let pinUpdates = netlistUpdates[des];
            
            if (compData.pinInfoMap) {
                 for (let pinNum in pinUpdates) {
                    let targetNet = pinUpdates[pinNum];
                    let pinKey = String(pinNum);
                    
                    if (compData.pinInfoMap[pinKey]) {
                        if (compData.pinInfoMap[pinKey].net !== targetNet) {
                            compData.pinInfoMap[pinKey].net = targetNet;
                            updateCount++;
                        }
                    } else {
                        compData.pinInfoMap[pinKey] = { "net": targetNet, "number": pinKey };
                        updateCount++;
                    }
                 }
            } else {
                if (!compData.pins) compData.pins = {};
                for (let pinNum in pinUpdates) {
                    let targetNet = pinUpdates[pinNum];
                    let pinKey = String(pinNum); 
                    if (compData.pins[pinKey] !== targetNet) {
                        compData.pins[pinKey] = targetNet;
                        updateCount++;
                    }
                }
            }
        }
    }
    return { count: updateCount, netlist: netlistJson };
}

// =============================================================
// 模块 4：通用物理计算逻辑 (Physical Calc Core)
// =============================================================
async function performPhysicalCalculation(allPrimitives, padIdToPinInfo, allUsedNetNames) {
    console.log(`[核心计算] 处理 ${allPrimitives.length} 个图元...`);
    let uf = new UnionFind();
    const GRID_SIZE = 150; 
    let grid = {};

    function addToGrid(prim) {
        let minX, maxX, minY, maxY, padding = 10;
        if (prim.shape === "line") {
            let r = prim.w / 2;
            minX = Math.min(prim.x1, prim.x2) - r; maxX = Math.max(prim.x1, prim.x2) + r;
            minY = Math.min(prim.y1, prim.y2) - r; maxY = Math.max(prim.y1, prim.y2) + r;
        } else { 
            let halfW = prim.w / 2; let halfH = prim.h / 2;
            minX = prim.x - halfW; maxX = prim.x + halfW;
            minY = prim.y - halfH; maxY = prim.y + halfH;
        }
        minX -= padding; maxX += padding; minY -= padding; maxY += padding;
        let startX = Math.floor(minX / GRID_SIZE); let endX = Math.floor(maxX / GRID_SIZE);
        let startY = Math.floor(minY / GRID_SIZE); let endY = Math.floor(maxY / GRID_SIZE);
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                let key = `${x},${y}`;
                if (!grid[key]) grid[key] = [];
                grid[key].push(prim);
            }
        }
    }
    allPrimitives.forEach(p => addToGrid(p));

    let processedPairs = new Set();
    let connectCount = 0;
    
    for (let key in grid) {
        let cellItems = grid[key];
        if (cellItems.length < 2) continue;
        for (let i = 0; i < cellItems.length; i++) {
            for (let j = i + 1; j < cellItems.length; j++) {
                let a = cellItems[i];
                let b = cellItems[j];
                let pairId = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
                if (processedPairs.has(pairId)) continue;
                processedPairs.add(pairId);
                
                if (checkConnectivityHighPrecision(a, b)) {
                    uf.union(a.id, b.id);
                    connectCount++;
                }
            }
        }
    }
    console.log(`[核心计算] 发现 ${connectCount} 处物理连接`);

    let clusters = {};
    allPrimitives.forEach(p => {
        let root = uf.find(p.id);
        if (!clusters[root]) clusters[root] = [];
        clusters[root].push(p);
    });

    let netCounter = 1;
    let netlistUpdates = {}; 
    const isGenericNet = (name) => /^NET\d+$/i.test(name);

    for (const rootId of Object.keys(clusters)) {
        let group = clusters[rootId];
        let validPinCount = 0;
        
        for (const item of group) {
            if (item.type === "PAD") {
                let pinInfo = padIdToPinInfo[item.id];
                // V3 兼容性增强：尝试后缀匹配
                if (!pinInfo) {
                    for (let key in padIdToPinInfo) {
                        if (item.id.toString().endsWith(key)) {
                            pinInfo = padIdToPinInfo[key];
                            break;
                        }
                    }
                }
                if (pinInfo && pinInfo.des) {
                    item._pinInfo = pinInfo; 
                    validPinCount++;
                }
            }
        }

        let existingNets = new Set();
        group.forEach(p => {
            if (p.net && p.net !== "" && p.net !== "null" && p.net !== "undefined") {
                existingNets.add(p.net);
            }
        });

        let finalNetName = "";
        let isGenerated = false;

        if (existingNets.size > 0) {
            let sortedNets = Array.from(existingNets);
            sortedNets.sort((a,b) => {
                let aGen = isGenericNet(a); let bGen = isGenericNet(b);
                if (!aGen && bGen) return -1; if (aGen && !bGen) return 1;
                if (a.length !== b.length) return a.length - b.length; 
                return a.localeCompare(b);
            });
            finalNetName = sortedNets[0]; 
        } else {
            isGenerated = true;
            while (true) {
                let candidate = "NET" + netCounter;
                if (!allUsedNetNames.has(candidate)) {
                    finalNetName = candidate;
                    allUsedNetNames.add(finalNetName);
                    break;
                }
                netCounter++;
            }
        }

        if (validPinCount < 2 && isGenerated) { continue; }

        for (const item of group) {
            if (item.type === "PAD" && item._pinInfo) {
                let pinInfo = item._pinInfo;
                if (!netlistUpdates[pinInfo.des]) netlistUpdates[pinInfo.des] = {};
                netlistUpdates[pinInfo.des][pinInfo.pin] = finalNetName;
            }
        }
    }
    return netlistUpdates;
}


// =============================================================
// 模块 5：主入口
// =============================================================

export async function configurePhysicalNets() {
    const startTime = Date.now();
    // console.clear();
    console.log("================ 生成物理网络 (Auto-Merge) ================");

    // 0. 检测版本
    let editorVersion = "2.0.0";
    try {
        editorVersion = eda.sys_Environment.getEditorCurrentVersion() || "2.0.0";
    } catch(e) {}
    console.log(`[系统] 检测到编辑器版本: ${editorVersion}`);

    // 1. 获取通用数据
    let netlistJson = null;
    try {
        // let res = await eda.pcb_Net.getNetlist('JLCEDA');
        const getNetlistFile = await eda.pcb_ManufactureData.getNetlistFile();
        const res = await getNetlistFile.text();
        netlistJson = (typeof res === 'string') ? JSON.parse(res) : res;
    } catch(e) { console.error("读取网表失败:", e); return; }

    let rawSource = "";
    try {
        rawSource = await eda.sys_FileManager.getDocumentSource();
        if (typeof rawSource !== 'string') throw new Error("源码获取失败");
    } catch (e) { console.error(e); return; }

    let allPads = await fetchAllPads();

    // 2. 根据版本分发逻辑
    let result = { count: 0, netlist: null };
    
    // 判断逻辑：如果版本号以 "3." 开头，使用V3引擎；否则使用V2引擎
    if (editorVersion.trim().startsWith('3.')) {
        result = await runLogicV3(rawSource, netlistJson, allPads);
    } else {
        // 对于2.x版本，如果遇到非数组格式的源码，也尝试用V3逻辑解析（V3兼容性更好）
        // 但根据需求严格区分，默认走V2
        result = await runLogicV2(rawSource, netlistJson, allPads);
    }

    // 3. 写入结果
    if (result.count > 0 && result.netlist) {
        try {
            console.log(`正在写入 ${result.count} 处变更...`);
            let updatedJsonString = JSON.stringify(result.netlist);
            await eda.pcb_Net.setNetlist('JLCEDA', updatedJsonString);
        } catch (e) { console.error("网表写入失败:", e); }
    } else {
        console.log("未检测到需要更新的网络变化。");
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`================ 全部完成 (耗时 ${duration}s) ================`);
    eda.sys_Message.showToastMessage(`分析完成 (耗时 ${duration}秒)\n已更新 ${result.count} 处引脚网络`, "success");
}