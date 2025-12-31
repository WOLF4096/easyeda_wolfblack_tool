/**
 * 导线(Primitive Line/Arc) 与 线条(Polyline)/区域(Region) 互转工具 v2
 * * 功能说明：
 * 1. toWire(): 将选中的 Polyline/Region 转为 Line/Arc (导线)
 * 2. toPolyline(): 将选中的 Line/Arc 转为 Polyline (线条)
 * 3. toggle(): 智能判断，互相转换
 * * * 更新说明：
 * - 增加对 Region (圆形、矩形、圆角矩形) 转导线的支持
 * 
 * 已知矩形转换为导线，网络会消失，原因：api未返回网络值
 * 已知V3版本转换圆形为导线，会只剩下个半圆，解决方法：在圆形上随便放点东西
 * 通过api获取的线宽异常，需要x10倍才是正确的值
 * 
 */

export const WireConverter = {

    /**
     * 入口 1: 转为导线 (Polyline/Region -> Line/Arc)
     */
    toWire: async function() {
        const primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
        console.log(primitives);
        if (!primitives || primitives.length === 0) return;

        eda.sys_Log.add("开始转换 轮廓对象 ⇒ 导线");
        
        for (let item of primitives) {
            // 处理 Polyline
            if (item.primitiveType === "Polyline" && item.polygon && item.polygon.polygon) {
                await this._convertPolyToWire(item);
            }
            // 处理 Region (新增)
            else if (item.primitiveType === "Region" && item.complexPolygon && item.complexPolygon.polygon) {
                await this._convertRegionToWire(item);
            }
        }
        eda.sys_Log.add("转换完成");
        eda.sys_PanelControl.openBottomPanel("log");
    },

    /**
     * 入口 2: 转为线条 (Line/Arc -> Polyline)
     */
    toPolyline: async function() {
        const primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
        console.log(primitives);
        if (!primitives || primitives.length === 0) return;

        eda.sys_Log.add("开始转换 导线 ⇒ 轮廓对象");

        for (let item of primitives) {
            // 只处理 Line 和 Arc 类型
            if (item.primitiveType === "Line" || item.primitiveType === "Arc") {
                await this._convertWireToPoly(item);
            }
        }
        eda.sys_Log.add("转换完成");
        eda.sys_PanelControl.openBottomPanel("log");
    },

    /**
     * 入口 3: 互相转换 (自动识别类型)
     */
    toggle: async function() {
        const primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
        console.log(primitives);
        if (!primitives || primitives.length === 0) return;

        eda.sys_Log.add("开始转换 导线 ⇄ 线条");

        for (let item of primitives) {
            if (item.primitiveType === "Polyline") {
                await this._convertPolyToWire(item);
            } 
            else if (item.primitiveType === "Region") {
                await this._convertRegionToWire(item);
            }
            else if (item.primitiveType === "Line" || item.primitiveType === "Arc") {
                await this._convertWireToPoly(item);
            }
        }
        eda.sys_Log.add("转换完成");
        eda.sys_PanelControl.openBottomPanel("log");
    },

    // ================= 内部逻辑方法 =================

    /**
     * 辅助方法：检查铜层
     */
    _checkCopperLayer: function(layer, primitiveId) {
        // Top:1, Bottom:2, Inner:15-46
        const isTopOrBottom = (layer === 1 || layer === 2);
        const isInnerLayer = (layer >= 15 && layer <= 46);
        
        if (!isTopOrBottom && !isInnerLayer) {
            eda.sys_Log.add(`当前图元 ${primitiveId} 不在铜层，不可转为导线`, "warn");
            eda.sys_PanelControl.openBottomPanel("log");
            return false;
        }
        return true;
    },

    /**
     * 核心逻辑 1：将 Polyline 拆解并创建对应的 Line/Arc
     */
    _convertPolyToWire: async function(polyItem) {
        if (!this._checkCopperLayer(polyItem.layer, polyItem.primitiveId)) return;

        const arr = polyItem.polygon.polygon;
        const net = polyItem.net || "";
        const layer = polyItem.layer;
        const width = polyItem.lineWidth * 10;// 对bug的针对性修复，获取到的线宽比实际小10倍

        // 数据合法性检查
        if (!arr || arr.length < 2 || typeof arr[0] !== 'number') return;

        let startX = arr[0];
        let startY = arr[1];
        let currentMode = 'L'; 
        let i = 2;

        // 先删除原图元，避免新创建的图元相交自动拆分后无法删除的情况
        await eda.pcb_PrimitivePolyline.delete(polyItem.primitiveId);

        while (i < arr.length) {
            const val = arr[i];

            if (typeof val === 'string') {
                currentMode = val;
                i++;
                continue;
            }

            if (currentMode === 'L') {
                const endX = arr[i];
                const endY = arr[i + 1];
                await eda.pcb_PrimitiveLine.create(net, layer, startX, startY, endX, endY, width, false);
                startX = endX;
                startY = endY;
                i += 2;
            } 
            else if (currentMode === 'ARC' || currentMode === 'CARC') {
                const angle = arr[i];
                const endX = arr[i + 1];
                const endY = arr[i + 2];
                await eda.pcb_PrimitiveArc.create(net, layer, startX, startY, endX, endY, angle, width, 1, false);
                startX = endX;
                startY = endY;
                i += 3;
            } 
            else {
                i++; 
            }
        }
    },

    /**
     * 核心逻辑 2：将 Region (Circle/Rect/Polygon) 拆解为 Line/Arc
     * 支持：CIRCLE, R, 以及通用多边形数据(以坐标开头)
     */
    _convertRegionToWire: async function(regionItem) {
        // 1. 检查铜层
        if (!this._checkCopperLayer(regionItem.layer, regionItem.primitiveId)) return;

        const arr = regionItem.complexPolygon.polygon;
        const net = regionItem.net || ""; 
        const layer = regionItem.layer;
        const width = regionItem.lineWidth * 10; 
        
        if (!arr || arr.length === 0) return;

        // 获取第一个元素来判断类型
        const firstVal = arr[0];

        // 删除原 Region 图元
        try {
             await eda.pcb_PrimitivePolyline.delete(regionItem.primitiveId);
        } catch (e) {
            console.warn("删除 Region 失败", e);
        }

        // ==========================================
        // 情况 A: 通用多边形 Region (以数字坐标开头)
        // 对应您提供的 "Fill Region" 数据
        // ==========================================
        if (typeof firstVal === 'number') {
            if (arr.length < 2) return;

            let startX = arr[0];
            let startY = arr[1];
            let currentMode = 'L'; // 默认为直线，除非遇到 keyword
            let i = 2;

            while (i < arr.length) {
                const val = arr[i];

                // 切换模式检测
                if (typeof val === 'string') {
                    currentMode = val;
                    i++;
                    continue;
                }

                if (currentMode === 'L') {
                    // 直线: x, y
                    const endX = arr[i];
                    const endY = arr[i + 1];
                    await eda.pcb_PrimitiveLine.create(net, layer, startX, startY, endX, endY, width, false);
                    
                    startX = endX;
                    startY = endY;
                    i += 2;
                } 
                else if (currentMode === 'ARC' || currentMode === 'CARC') {
                    // 圆弧: angle, endX, endY
                    const angle = arr[i];
                    const endX = arr[i + 1];
                    const endY = arr[i + 2];
                    await eda.pcb_PrimitiveArc.create(net, layer, startX, startY, endX, endY, angle, width, 1, false);
                    
                    startX = endX;
                    startY = endY;
                    i += 3;
                }
                else {
                    // 未知命令，跳过防止死循环
                    i++;
                }
            }
            return; // 处理完毕，直接返回
        }

        // ==========================================
        // 情况 B: 特殊形状 (CIRCLE / R)
        // ==========================================
        const type = firstVal; // 此时 type 为 string

        // === 处理圆形 (CIRCLE) ===
        if (type === "CIRCLE") {
            const cx = arr[1];
            const cy = arr[2];
            const r = arr[3];

            // 拆分为两个 180 度圆弧
            await eda.pcb_PrimitiveArc.create(net, layer, cx - r, cy, cx + r, cy, 180, width, 1, false);
            await eda.pcb_PrimitiveArc.create(net, layer, cx + r, cy, cx - r, cy, 180, width, 1, false);
        }

        // === 处理矩形/圆角矩形 (R) ===
        else if (type === "R") {
            const x = arr[1];
            const y = arr[2];
            const w = arr[3];
            const h = arr[4];
            const rot = arr[5] || 0; 
            let r = arr[6] || 0;

            const h_vector = -h; 
            const minSideHalf = Math.min(w, Math.abs(h_vector)) / 2;
            if (r > minSideHalf) r = minSideHalf;

            const cx = x;
            const cy = y;
            const rad = rot * (Math.PI / 180);
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            const rotatePoint = (px, py) => {
                const dx = px - cx;
                const dy = py - cy;
                return {
                    x: cx + (dx * cos - dy * sin),
                    y: cy + (dx * sin + dy * cos)
                };
            };

            // 矩形点位计算 (复用之前的逻辑)
            const p1_start = rotatePoint(x + r, y);
            const p1_end   = rotatePoint(x + w - r, y);
            const p2_start = p1_end; 
            const p2_end   = rotatePoint(x + w, y - r);
            const p3_start = p2_end;
            const p3_end   = rotatePoint(x + w, y + h_vector + r);
            const p4_start = p3_end;
            const p4_end   = rotatePoint(x + w - r, y + h_vector);
            const p5_start = p4_end;
            const p5_end   = rotatePoint(x + r, y + h_vector);
            const p6_start = p5_end;
            const p6_end   = rotatePoint(x, y + h_vector + r);
            const p7_start = p6_end;
            const p7_end   = rotatePoint(x, y - r);
            const p8_start = p7_end;
            const p8_end   = p1_start;

            // 生成图元
            if (w > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p1_start.x, p1_start.y, p1_end.x, p1_end.y, width, false);
            if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p2_start.x, p2_start.y, p2_end.x, p2_end.y, -90, width, 1, false);
            if (Math.abs(h_vector) > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p3_start.x, p3_start.y, p3_end.x, p3_end.y, width, false);
            if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p4_start.x, p4_start.y, p4_end.x, p4_end.y, -90, width, 1, false);
            if (w > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p5_start.x, p5_start.y, p5_end.x, p5_end.y, width, false);
            if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p6_start.x, p6_start.y, p6_end.x, p6_end.y, -90, width, 1, false);
            if (Math.abs(h_vector) > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p7_start.x, p7_start.y, p7_end.x, p7_end.y, width, false);
            if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p8_start.x, p8_start.y, p8_end.x, p8_end.y, -90, width, 1, false);
        }
    },
    

    /**
     * 核心逻辑 3：将 Line/Arc 转换为 Polyline
     */
    _convertWireToPoly: async function(wireItem) {
        let polygonArr = [];

        // 先删除原图元，避免新创建的图元相交自动拆分后无法删除的情况
        if (wireItem.primitiveType === "Line") {
            await eda.pcb_PrimitiveLine.delete(wireItem.primitiveId);
        } else {
            await eda.pcb_PrimitiveArc.delete(wireItem.primitiveId);
        }

        if (wireItem.primitiveType === "Line") {
            polygonArr = [wireItem.startX, wireItem.startY, 'L', wireItem.endX, wireItem.endY];
        } 
        else if (wireItem.primitiveType === "Arc") {
            polygonArr = [wireItem.startX, wireItem.startY, 'ARC', wireItem.arcAngle, wireItem.endX, wireItem.endY];
        }

        const polyObj = eda.pcb_MathPolygon.createPolygon(polygonArr);

        await eda.pcb_PrimitivePolyline.create(
            wireItem.net || "", 
            wireItem.layer, 
            polyObj, 
            wireItem.lineWidth, 
            false
        );
    }
};

// ================= 使用示例 =================
// 菜单按钮1：转为导线
// await WireConverter.toWire();

// 菜单按钮2：转为线条
// await WireConverter.toPolyline();

// 菜单按钮3：互转
// await WireConverter.toggle();