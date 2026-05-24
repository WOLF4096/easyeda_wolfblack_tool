/* eslint-disable complexity */
/**
 * 导线(Primitive Line/Arc) 与 线条(Polyline)/区域(Region) 互转工具 (Refactored)
 * * 核心机制：抛弃硬编码版本判断，通过读取本地存储的 API 校准数据，动态处理坐标系/线宽的缩放。
 * * 功能说明：
 * 1. toWire(): 将选中的 Polyline/Region 转为 Line/Arc (导线)
 * 2. toPolyline(): 将选中的 Line/Arc 转为 Polyline (线条)
 * 3. toggle(): 智能判断，互相转换
 */

// 默认 API 配置兜底（防止解析失败导致崩溃）
const DEFAULT_API_CONFIG = {
    "创建折线": { "坐标": 1, "线宽": 1 },
    "创建直线": { "坐标": 1, "线宽": 1 },
    "创建弧线": { "坐标": 1, "线宽": 1, "圆弧角度": 1 },
    "获取折线": { "坐标": 1, "线宽": 1 },
    "获取直线": { "坐标": 1, "线宽": 1 },
    "获取弧线": { "坐标": 1, "线宽": 1, "圆弧角度": 1 }
};

export const WireConverter = {
    // ================= 公开入口 =================

    async toWire() {
        await this._process(1);
    },

    async toPolyline() {
        await this._process(2);
    },

    async toggle() {
        await this._process(3);
    },

    // ================= 内部调度与通用逻辑 =================

    /**
     * 核心调度器
     * @param {number} mode 1: 转导线, 2: 转线条, 3: 互相转换
     */
    async _process(mode) {
        try {
            const primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
            if (!primitives || primitives.length === 0) return;

            // 获取带详细属性的图元，用于提取 Region 的 Net
            const detailedPrimitives = await eda.pcb_SelectControl.getSelectedPrimitives();
            const netMap = this._buildNetMap(detailedPrimitives);
            const api = await this._getApiConfig();

            for (const item of primitives) {
                if (item.primitiveType === 'Polyline' && item.polygon?.polygon) {
                    if (mode === 1 || mode === 3) await this._convertPolyToWire(item, api);
                } else if (item.primitiveType === 'Region' && item.complexPolygon?.polygon) {
                    if (mode === 1 || mode === 3) await this._convertRegionToWire(item, netMap[item.primitiveId], api);
                } else if (item.primitiveType === 'Line' || item.primitiveType === 'Arc') {
                    if (mode === 2 || mode === 3) await this._convertWireToPoly(item, api);
                }
            }
        } catch (error) {
            console.error('导线互转出错:', error);
        }
    },

    /**
     * 安全获取 API 配置
     */
    async _getApiConfig() {
        let api = DEFAULT_API_CONFIG;
        const rawData = await eda.sys_Storage.getExtensionUserConfig('APITest');
        if (rawData) {
            try {
                api = JSON.parse(rawData);
            } catch (e) {
                console.warn('API 校准数据解析失败，将使用默认比例 1:1', e);
            }
        }
        return api;
    },

    /**
     * 通用倍率提取辅助函数
     * @returns {number} src倍率 * target倍率
     */
    _getScale(api, srcKey, targetKey, prop) {
        const srcScale = api[srcKey]?.[prop] ?? 1;
        const targetScale = api[targetKey]?.[prop] ?? 1;
        return srcScale * targetScale;
    },

    /**
     * 构建图元ID到Net的映射表
     */
    _buildNetMap(detailedPrimitives) {
        const map = {};
        if (Array.isArray(detailedPrimitives)) {
            detailedPrimitives.forEach(p => {
                if (p.globalIndex) map[p.globalIndex] = p.net || '';
            });
        }
        return map;
    },

    /**
     * 检查是否在铜层
     */
    _checkCopperLayer(layer, primitiveId) {
        const isCopper = (layer === 1 || layer === 2) || (layer >= 15 && layer <= 46);
        if (!isCopper) {
            eda.sys_Log.add(`当前图元 ${primitiveId} 不在铜层，不可转为导线`, 'warn');
            eda.sys_PanelControl.openBottomPanel('log');
        }
        return isCopper;
    },

    // ================= 核心转换逻辑 =================

    /**
     * 线条 (Polyline) ⇒ 导线 (Line/Arc)
     */
    async _convertPolyToWire(polyItem, api) {
        if (!this._checkCopperLayer(polyItem.layer, polyItem.primitiveId)) return;

        const arr = polyItem.polygon.polygon;
        if (!arr || arr.length < 2 || typeof arr[0] !== 'number') return;

        // 提取统一的缩放倍率 (假设折线与直线的坐标系倍率一致)
        const coordScale = this._getScale(api, '获取折线', '创建直线', '坐标');
        const widthScale = this._getScale(api, '获取折线', '创建直线', '线宽');
        const angleScale = api["创建弧线"]?.["圆弧角度"] ?? 1;

        const net = polyItem.net || '';
        const layer = polyItem.layer;
        const targetWidth = polyItem.lineWidth * widthScale;

        await eda.pcb_PrimitivePolyline.delete(polyItem.primitiveId);

        let startX = arr[0] * coordScale;
        let startY = arr[1] * coordScale;
        let currentMode = 'L';
        let i = 2;

        while (i < arr.length) {
            const val = arr[i];
            if (typeof val === 'string') {
                currentMode = val;
                i++;
                continue;
            }

            if (currentMode === 'L') {
                const endX = arr[i] * coordScale;
                const endY = arr[i + 1] * coordScale;
                await eda.pcb_PrimitiveLine.create(net, layer, startX, startY, endX, endY, targetWidth, false);
                startX = endX;
                startY = endY;
                i += 2;
            } else if (currentMode === 'ARC' || currentMode === 'CARC') {
                const angle = arr[i] * angleScale;
                const endX = arr[i + 1] * coordScale;
                const endY = arr[i + 2] * coordScale;
                await eda.pcb_PrimitiveArc.create(net, layer, startX, startY, endX, endY, angle, targetWidth, 1, false);
                startX = endX;
                startY = endY;
                i += 3;
            } else {
                i++;
            }
        }
    },

    /**
     * 区域 (Region) ⇒ 导线 (Line/Arc)
     */
    async _convertRegionToWire(regionItem, overrideNet, api) {
        if (!this._checkCopperLayer(regionItem.layer, regionItem.primitiveId)) return;

        const arr = regionItem.complexPolygon.polygon;
        if (!arr || arr.length === 0) return;

        // 获取折线 (作为 Region 的兜底) 到 创建直线的比例
        const coordScale = this._getScale(api, '获取折线', '创建直线', '坐标');
        const widthScale = this._getScale(api, '获取折线', '创建直线', '线宽');
        const angleScale = api["创建弧线"]?.["圆弧角度"] ?? 1;

        const net = overrideNet ?? regionItem.net ?? '';
        const layer = regionItem.layer;
        const targetWidth = regionItem.lineWidth * widthScale;
        const firstVal = arr[0];

        try {
            await eda.pcb_PrimitivePolyline.delete(regionItem.primitiveId);
        } catch (e) {
            console.warn('删除原Region图元失败:', e);
        }

        // --- 场景 A: 通用多边形 ---
        if (typeof firstVal === 'number') {
            if (arr.length < 2) return;
            let startX = arr[0] * coordScale;
            let startY = arr[1] * coordScale;
            let currentMode = 'L';
            let i = 2;

            while (i < arr.length) {
                const val = arr[i];
                if (typeof val === 'string') {
                    currentMode = val;
                    i++;
                    continue;
                }
                if (currentMode === 'L') {
                    const endX = arr[i] * coordScale;
                    const endY = arr[i + 1] * coordScale;
                    await eda.pcb_PrimitiveLine.create(net, layer, startX, startY, endX, endY, targetWidth, false);
                    startX = endX;
                    startY = endY;
                    i += 2;
                } else if (currentMode === 'ARC' || currentMode === 'CARC') {
                    const angle = arr[i] * angleScale;
                    const endX = arr[i + 1] * coordScale;
                    const endY = arr[i + 2] * coordScale;
                    await eda.pcb_PrimitiveArc.create(net, layer, startX, startY, endX, endY, angle, targetWidth, 1, false);
                    startX = endX;
                    startY = endY;
                    i += 3;
                } else {
                    i++;
                }
            }
            return;
        }

        // --- 场景 B: 特殊形状 (圆形/圆角矩形) ---
        const type = firstVal;
        if (type === 'CIRCLE') {
            const cx = arr[1] * coordScale;
            const cy = arr[2] * coordScale;
            const r = arr[3] * coordScale;
            await eda.pcb_PrimitiveArc.create(net, layer, cx - r, cy, cx + r, cy, 180, targetWidth, 1, false);
            await eda.pcb_PrimitiveArc.create(net, layer, cx + r, cy, cx - r, cy, 180, targetWidth, 1, false);
        } 
        else if (type === 'R') {
            const x = arr[1] * coordScale;
            const y = arr[2] * coordScale;
            const w = arr[3] * coordScale;
            const h = arr[4] * coordScale;
            const rot = arr[5] || 0; // 旋转角度不应用坐标倍率
            let r = (arr[6] || 0) * coordScale;
            
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
                return { x: cx + (dx * cos - dy * sin), y: cy + (dx * sin + dy * cos) };
            };

            const p1_start = rotatePoint(x + r, y);
            const p1_end   = rotatePoint(x + w - r, y);
            const p2_end   = rotatePoint(x + w, y - r);
            const p3_end   = rotatePoint(x + w, y + h_vector + r);
            const p4_end   = rotatePoint(x + w - r, y + h_vector);
            const p5_end   = rotatePoint(x + r, y + h_vector);
            const p6_end   = rotatePoint(x, y + h_vector + r);
            const p7_end   = rotatePoint(x, y - r);

            if (w > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p1_start.x, p1_start.y, p1_end.x, p1_end.y, targetWidth, false);
            if (r > 0)     await eda.pcb_PrimitiveArc.create(net, layer, p1_end.x, p1_end.y, p2_end.x, p2_end.y, -90, targetWidth, 1, false);
            if (Math.abs(h_vector) > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p2_end.x, p2_end.y, p3_end.x, p3_end.y, targetWidth, false);
            if (r > 0)     await eda.pcb_PrimitiveArc.create(net, layer, p3_end.x, p3_end.y, p4_end.x, p4_end.y, -90, targetWidth, 1, false);
            if (w > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p4_end.x, p4_end.y, p5_end.x, p5_end.y, targetWidth, false);
            if (r > 0)     await eda.pcb_PrimitiveArc.create(net, layer, p5_end.x, p5_end.y, p6_end.x, p6_end.y, -90, targetWidth, 1, false);
            if (Math.abs(h_vector) > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p6_end.x, p6_end.y, p7_end.x, p7_end.y, targetWidth, false);
            if (r > 0)     await eda.pcb_PrimitiveArc.create(net, layer, p7_end.x, p7_end.y, p1_start.x, p1_start.y, -90, targetWidth, 1, false);
        }
    },

    /**
     * 导线 (Line/Arc) ⇒ 线条 (Polyline)
     */
    async _convertWireToPoly(wireItem, api) {
        const isLine = wireItem.primitiveType === 'Line';
        const sourceKey = isLine ? '获取直线' : '获取弧线';

        // 动态读取缩放倍率
        const coordScale = this._getScale(api, sourceKey, '创建折线', '坐标');
        const widthScale = this._getScale(api, sourceKey, '创建折线', '线宽');
        const angleScale = api["获取弧线"]?.["圆弧角度"] ?? 1; // 仅弧线应用

        const startX = wireItem.startX * coordScale;
        const startY = wireItem.startY * coordScale;
        const endX = wireItem.endX * coordScale;
        const endY = wireItem.endY * coordScale;
        const targetWidth = wireItem.lineWidth * widthScale;

        // 删除旧图元
        if (isLine) {
            await eda.pcb_PrimitiveLine.delete(wireItem.primitiveId);
        } else {
            await eda.pcb_PrimitiveArc.delete(wireItem.primitiveId);
        }

        // 构建数据并生成 Polyline
        let polygonArr = [];
        if (isLine) {
            polygonArr = [startX, startY, 'L', endX, endY];
        } else {
            const angle = wireItem.arcAngle * angleScale;
            polygonArr = [startX, startY, 'ARC', angle, endX, endY];
        }

        const polyObj = eda.pcb_MathPolygon.createPolygon(polygonArr);
        await eda.pcb_PrimitivePolyline.create(wireItem.net || '', wireItem.layer, polyObj, targetWidth, false);
    }
};
