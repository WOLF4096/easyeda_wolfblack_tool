// ========================= 1. 全局变量 =========================
    const {
        getEditorVersion,
        isV2,
        isModern,
        getNetlist,
        setNetlist,
        getComponentsContainer,
        isInnerLayer,
        isConductiveLayer,
        splitSourceLine,
        joinSourceLine,
    } = window.WolfCommon;

    let g_pendingOperations = [];       // 当前待执行的操作列表
    let g_isAnalyzing = false;
    let g_isExecuting = false;
    let g_currentMethod = 'netlist';    // 当前选中的方法
    let g_editorVersion = 'Null';       // 编辑器版本号
	let g_cachedNetlist = null;  	   	// 缓存的网表数据
	let g_netlistOps = [];      	   	// 网表模式操作列表
	let g_sourceOps = [];       	   	// 源码/API模式操作列表
	let loadingTimeout = null;  		// 定时器ID
	let netlistData = null;				// 网表数据
	let rawSource = null;				// 源码数据

    // ========================= 2. 算法工具类与几何函数 =========================
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

    function distToSegmentSquared(px, py, x1, y1, x2, y2) {
        let l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
        let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
        t = Math.max(0, Math.min(1, t));
        return (px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2;
    }

    function isTwoLinesTouching(l1, l2) {
        let threshold = (l1.w / 2 + l2.w / 2);
        let distSqLimit = threshold * threshold;
        if (distToSegmentSquared(l1.x1, l1.y1, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
        if (distToSegmentSquared(l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
        if (distToSegmentSquared(l2.x1, l2.y1, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;
        if (distToSegmentSquared(l2.x2, l2.y2, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;
        return segmentsIntersect(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
    }

    function segmentsIntersect(a, b, c, d, p, q, r, s) {
        function crossProduct(x1, y1, x2, y2, x3, y3) {
            return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
        }
        let d1 = crossProduct(p, q, r, s, a, b);
        let d2 = crossProduct(p, q, r, s, c, d);
        let d3 = crossProduct(a, b, c, d, p, q);
        let d4 = crossProduct(a, b, c, d, r, s);
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
               ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    }

    function isLineIntersectRect(x1, y1, x2, y2, rect) {
        let left   = rect.x - rect.w / 2;
        let right  = rect.x + rect.w / 2;
        let top    = rect.y - rect.h / 2;
        let bottom = rect.y + rect.h / 2;
        if (isPointInRect(x1, y1, rect) || isPointInRect(x2, y2, rect)) return true;
        return segmentsIntersect(x1, y1, x2, y2, left, top, right, top) ||
               segmentsIntersect(x1, y1, x2, y2, left, bottom, right, bottom) ||
               segmentsIntersect(x1, y1, x2, y2, left, top, left, bottom) ||
               segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom);
    }

    function isPointInRect(x, y, rect) {
        return Math.abs(x - rect.x) <= rect.w / 2 && Math.abs(y - rect.y) <= rect.h / 2;
    }

    function getPolyVertices(shapeData) {
        let vertices = [];
        function traverse(node) {
            if (!Array.isArray(node)) return;
            let numbers = node.filter(n => typeof n === 'number');
            if (numbers.length >= 4 && numbers.length % 2 === 0) {
                for (let i = 0; i < numbers.length; i += 2) {
                    vertices.push({ x: numbers[i], y: numbers[i+1] });
                }
            } else {
                node.forEach(sub => Array.isArray(sub) && traverse(sub));
            }
        }
        traverse(shapeData);
        return vertices;
    }

    function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
        let denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (denom === 0) return false;
        let ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        let ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
        return (ua >= 0 && ua <= 1) && (ub >= 0 && ub <= 1);
    }

    function isPointInPoly(px, py, vertices) {
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            let xi = vertices[i].x, yi = vertices[i].y;
            let xj = vertices[j].x, yj = vertices[j].y;
            let intersect = ((yi > py) !== (yj > py)) &&
                            (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function getRotatedRectVertices(x, y, w, h, rotation, radius = 0, segments = 6) {
        const rad = (rotation || 0) * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const maxRadius = Math.min(w, h) / 2;
        const r = Math.max(0, Math.min(radius || 0, maxRadius));
        let offsets = [];
        if (r <= 0) {
            offsets = [
                { dx: 0, dy: 0 },
                { dx: w, dy: 0 },
                { dx: w, dy: -h },
                { dx: 0, dy: -h },
            ];
        } else {
            function addArcPoints(cx, cy, startAngle, endAngle) {
                const step = (endAngle - startAngle) / segments;
                for (let i = 0; i <= segments; i++) {
                    const theta = startAngle + step * i;
                    offsets.push({ dx: cx + r * Math.cos(theta), dy: cy + r * Math.sin(theta) });
                }
            }
            addArcPoints(w - r, -r, Math.PI / 2, 0);
            addArcPoints(w - r, -h + r, 0, -Math.PI / 2);
            addArcPoints(r, -h + r, -Math.PI / 2, -Math.PI);
            addArcPoints(r, -r, Math.PI, Math.PI / 2);
        }
        return offsets.map(p => ({
            x: x + (p.dx * cos - p.dy * sin),
            y: y + (p.dx * sin + p.dy * cos)
        }));
    }

    /** 圆弧 → 折线段（约 22.5° 一段）。
     *  圆弧只取「弦」会与真实弧差一个矢高（90° 弧 ≈ 0.29r），造成相邻却判不相接 / 隔开却判相接。*/
    function expandArcLines(prim) {
        const out = [];
        const x1 = prim.x1, y1 = prim.y1, x2 = prim.x2, y2 = prim.y2, w = prim.w;
        const angle = Number(prim.angle || 0);
        const ch = Math.hypot(x2 - x1, y2 - y1);
        const th = Math.min(Math.abs(angle) * Math.PI / 180, Math.PI * 2);
        if (!(ch > 1e-9) || !(th > 1e-9)) { out.push(prim); return out; }
        const r = ch / (2 * Math.sin(th / 2));
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const nx = -(y2 - y1) / ch, ny = (x2 - x1) / ch;
        const h = Math.sqrt(Math.max(0, r * r - (ch / 2) * (ch / 2)));
        const sgn = angle >= 0 ? 1 : -1;
        const cx = mx + nx * h * sgn, cy = my + ny * h * sgn;
        const a0 = Math.atan2(y1 - cy, x1 - cx);
        const sweep = sgn * th;
        const N = Math.max(2, Math.min(12, Math.ceil(Math.abs(sweep) / (Math.PI / 8))));
        let px = x1, py = y1;
        for (let k = 1; k <= N; k++) {
            const a = a0 + sweep * (k / N);
            const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
            out.push({ id: prim.id + '_' + k, type: 'ARC', net: prim.net, layer: prim.layer, shape: 'line', x1: px, y1: py, x2: qx, y2: qy, w: w });
            px = qx; py = qy;
        }
        return out;
    }

    function getEdges(shape) {
        let lines = [];
        if (shape.shape === "POLY" || shape.vertices) {
            let v = shape.vertices;
            for(let i=0; i<v.length; i++) {
                let p1 = v[i];
                let p2 = v[(i+1)%v.length];
                lines.push([p1.x, p1.y, p2.x, p2.y]);
            }
        } else if (shape.shape === "line") {
            lines.push([shape.x1, shape.y1, shape.x2, shape.y2]);
        } else if (shape.shape === 'ROUND') {
            // ⚠️ 圆形不能用「包围盒四边」近似：方角在对角方向比真实半径远 √2 倍，
            //    会把「圆心距边界 1.27mm、半径仅 0.955mm」的焊盘判成与覆铜相接 →
            //    不同网络被焊接在一起。改用内接正十二边形，顶点严格落在圆周上。
            let r0 = shape.r || 0, N = 12;
            for (let i = 0; i < N; i++) {
                let a1 = i / N * Math.PI * 2, a2 = (i + 1) / N * Math.PI * 2;
                lines.push([
                    shape.x + r0 * Math.cos(a1), shape.y + r0 * Math.sin(a1),
                    shape.x + r0 * Math.cos(a2), shape.y + r0 * Math.sin(a2)
                ]);
            }
        } else {
            let hw = shape.w/2, hh = shape.h/2;
            let l=shape.x-hw, r=shape.x+hw, t=shape.y-hh, b=shape.y+hh;
            lines.push([l,t,r,t], [r,t,r,b], [r,b,l,b], [l,b,l,t]);
        }
        return lines;
    }

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
        if (a.shape === "POLY" || b.shape === "POLY") {
            let polyA = a.shape === "POLY" ? a : b;
            let other = a.shape === "POLY" ? b : a;
            let linesA = getEdges(polyA);
            let linesB = getEdges(other);
            
            // 1. 边缘交叉检测
            for (let la of linesA) {
                for (let lb of linesB) {
                    if (lineIntersect(la[0], la[1], la[2], la[3], lb[0], lb[1], lb[2], lb[3])) return true;
                }
            }
            
            // 2. 包含检测 (修复中心点误判漏洞)
            if (other.vertices) {
                // 如果对方也是多边形，只判断其顶点是否在内部
                for (let v of other.vertices) if (isPointInPoly(v.x, v.y, polyA.vertices)) return true;
            } else if (other.shape === "line") {
                 // 如果对方是线段，判断端点
                 if (isPointInPoly(other.x1, other.y1, polyA.vertices)) return true;
                 if (isPointInPoly(other.x2, other.y2, polyA.vertices)) return true;
            } else {
                 // 仅对 ROUND(过孔) 等没有顶点数组的纯几何图形，才用中心点判断
                 if (isPointInPoly(other.x, other.y, polyA.vertices)) return true;
            }

            // 3. 反向包含检测
            if (other.vertices) {
                for (let v of polyA.vertices) if (isPointInPoly(v.x, v.y, other.vertices)) return true;
            } else if (other.shape === "RECT") {
                 for (let v of polyA.vertices) if (isPointInRect(v.x, v.y, other)) return true;
            }
            return false;
        }
        if ("line" === a.shape && "line" === b.shape) return isTwoLinesTouching(a, b);
        let n = null, r = null;
        "line" === a.shape ? (n = a, r = b) : "line" === b.shape && (n = b, r = a);
        if (n && r) {
            if ("ROUND" === r.shape) {
                let e = distToSegmentSquared(r.x, r.y, n.x1, n.y1, n.x2, n.y2), t = r.r + n.w / 2;
                return e <= t * t;
            }
            if ("RECT" === r.shape) {
                let e = n.w / 2 + 0.1, t = { x: r.x, y: r.y, w: r.w + 2 * e, h: r.h + 2 * e };
                return isLineIntersectRect(n.x1, n.y1, n.x2, n.y2, t);
            }
        }
        if ("ROUND" === a.shape && "ROUND" === b.shape) {
            let n = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
            return n < (a.r + b.r) ** 2;
        }
        let i = a.w, o = a.h, s = b.w, l = b.h;
        return Math.abs(a.x - b.x) < (i + s) / 2 && Math.abs(a.y - b.y) < (o + l) / 2;
    }

    // 层栈辅助函数
    function getStackIds(innerLayerIds) {
        const LAYER_TOP = 1, LAYER_BOTTOM = 2;
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

    // 空间网格辅助函数
    function addToGrid(prim, GRID_SIZE, grid) {
        let minX, maxX, minY, maxY, padding = 10;
        if (prim.shape === 'line') {
            let r = prim.w / 2;
            minX = Math.min(prim.x1, prim.x2) - r;
            maxX = Math.max(prim.x1, prim.x2) + r;
            minY = Math.min(prim.y1, prim.y2) - r;
            maxY = Math.max(prim.y1, prim.y2) + r;
        } else {
            let halfW = prim.w / 2, halfH = prim.h / 2;
            minX = prim.x - halfW;
            maxX = prim.x + halfW;
            minY = prim.y - halfH;
            maxY = prim.y + halfH;
        }
        minX -= padding; maxX += padding; minY -= padding; maxY += padding;
        let startX = Math.floor(minX / GRID_SIZE), endX = Math.floor(maxX / GRID_SIZE);
        let startY = Math.floor(minY / GRID_SIZE), endY = Math.floor(maxY / GRID_SIZE);
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                let key = `${x},${y}`;
                if (!grid[key]) grid[key] = [];
                grid[key].push(prim);
            }
        }
    }

    // ========================= 3. 核心逻辑：数据获取与连通分量分析 =========================
    // 3.1 获取所有焊盘（统一格式）
    async function fetchAllPads() {
        let resultPads = [];
        try {
            updateFooterStatus(0, 0, "获取所有焊盘");
            let allPads = await eda.pcb_PrimitivePad.getAll();
            // console.log(allPads);
            allPads.forEach(pad => {
                let w = 10, h = 10;
                let shapeType = "RECT";
                
                // 判断焊盘形状并提取宽高（如果是非异形）
                if (pad.pad && pad.pad.length > 1) {
                    shapeType = pad.pad[0];
                    if (shapeType !== "POLYGON") {
                        w = Number(pad.pad[1]); 
                        h = Number(pad.pad[2] || w);
                    }
                }
                
                let rawHole = (pad.hole && pad.hole.length > 1) ? Number(pad.hole[1]) : 0;
                let realHoleSize = rawHole * 10;
                let algoShape = "RECT";
                let radius = 0;
                let vertices = null;

                // 形状映射与几何数据解析
                if (shapeType === "ROUND" || (shapeType === "ELLIPSE" && Math.abs(w - h) < 0.1)) {
                    algoShape = "ROUND"; radius = w / 2;
                } else if (shapeType === "POLYGON" && Array.isArray(pad.pad[1])) {
                    // --- 异形焊盘处理逻辑 ---
                    algoShape = "POLY";
                    let pathData = pad.pad[1];
                    vertices = [];
                    
                    // 修复：智能解析路径指令，丢弃 ARC 的角度/半径参数，只提取每段指令最后的 (x, y) 目标坐标
                    let j = 0;
                    while (j < pathData.length) {
                        let numBuffer = [];
                        
                        // 收集相邻的所有连续数字
                        while (j < pathData.length && typeof pathData[j] === 'number') {
                            numBuffer.push(pathData[j]);
                            j++;
                        }
                        
                        // 提取最后两个数字作为有效的 x, y 坐标（过滤掉前面可能的角度参数）
                        if (numBuffer.length >= 2) {
                            vertices.push({ 
                                x: numBuffer[numBuffer.length - 2], 
                                y: numBuffer[numBuffer.length - 1] 
                            });
                        }
                        
                        // 跳过当前的字符串指令 (如 "L", "ARC")，准备进入下一组坐标
                        if (j < pathData.length && typeof pathData[j] === 'string') {
                            j++;
                        }
                    }
                    
                    // 重新计算异形焊盘的真实包围盒（Bounding Box），用于空间网格加速
                    if (vertices.length > 0) {
                        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                        vertices.forEach(v => {
                            if (v.x < minX) minX = v.x;
                            if (v.x > maxX) maxX = v.x;
                            if (v.y < minY) minY = v.y;
                            if (v.y > maxY) maxY = v.y;
                        });
                        pad.x = (minX + maxX) / 2; // 覆盖坐标为真实几何中心
                        pad.y = (minY + maxY) / 2;
                        w = maxX - minX;
                        h = maxY - minY;
                    }
				} else {
                    // 应对 API 角度/弧度返回值不可信的问题：
                    // 放弃 RECT 的四角碰撞检测，一律按最短边的“内切圆”计算连通性。
                    // 这样无论焊盘怎么旋转，碰撞判定区都在绝对安全范围内，杜绝边缘误触。
                    algoShape = "ROUND";
                    radius = Math.min(w, h) / 2;
                }
                resultPads.push({
                    id: pad.primitiveId, type: "PAD", net: pad.net,
                    layer: pad.layer, shape: algoShape,
                    x: Number(pad.x), y: Number(pad.y), w: w, h: h, r: radius,
                    vertices: vertices, // 传入异形焊盘轮廓点阵
                    holeSize: realHoleSize
                });
            });
        } catch (e) { console.error("获取焊盘数据失败:", e); }
        return resultPads;
    }

	// 获取网表
	async function fetchNetlist() {
		try {
			updateFooterStatus(0, 0, "获取网表");
			return (await getNetlist('PCB')).json;
		} catch(e) {
			console.error("获取网表失败", e);
			return null;
		}
	}

    // 3.2 解析 V2 源码（返回图元、内层列表、引脚映射）
    function parseV2Primitives(lines, allUsedNetNames, padIdToPinInfo) {
        const primitives = [];
        const innerLayerIds = [];
        const LAYER_MULTI = 12;

		updateFooterStatus(0, 0, "解析 V2.2 源码");
        lines.forEach(line => {
            if (!line.trim() || !line.startsWith('[')) return;
            try {
                let item = JSON.parse(line.replace(/^\s*/, ''));
                let type = item[0];
                if (item[3] && typeof item[3] === 'string' && item[3] !== "") allUsedNetNames.add(item[3]);
                if (type === "LAYER") {
                    let lid = Number(item[1]), status = Number(item[4]);
                    if (isInnerLayer(lid) && status === 3) innerLayerIds.push(lid);
                } else if (type === "LINE") {
                    primitives.push({ id: item[1], type: "LINE", net: item[3], layer: item[4], shape: "line", x1: Number(item[5]), y1: Number(item[6]), x2: Number(item[7]), y2: Number(item[8]), w: Number(item[9]) });
                } else if (type === "VIA") {
                    let dia = Number(item[8]);
                    primitives.push({ id: item[1], type: "VIA", net: item[3], layer: LAYER_MULTI, _rawRange: item[4], shape: "ROUND", x: Number(item[5]), y: Number(item[6]), w: dia, h: dia, r: dia / 2 });
                } else if (type === "ARC") {
                    primitives.push.apply(primitives, expandArcLines({ id: item[1], net: item[3], layer: item[4], x1: Number(item[5]), y1: Number(item[6]), x2: Number(item[7]), y2: Number(item[8]), angle: Number(item[9]), w: Number(item[10]) || 0.15 }));
                } else if (type === "FILL" || type === "POLY") {
					if (type === "FILL" && item[4] === 12) return;
                    let shapeData = item[7];
                    while(Array.isArray(shapeData) && shapeData.length > 0 && Array.isArray(shapeData[0])) {
                        if (shapeData[0][0] === "R" || typeof shapeData[0][0] === "number") break;
                        shapeData = shapeData[0];
                    }
                    let vertices = [];
                    let isValidShape = false;
                    let rectData = null;
                    if (Array.isArray(shapeData) && shapeData.length > 0) {
                        if (Array.isArray(shapeData[0]) && shapeData[0][0] === "R") rectData = shapeData[0];
                        else if (shapeData[0] === "R") rectData = shapeData;
                    }
                    if (rectData) {
                        let rx = Number(rectData[1]), ry = Number(rectData[2]), rw = Number(rectData[3]), rh = Number(rectData[4]), rot = Number(rectData[5] || 0), radius = Number(rectData[6] || 0);
                        vertices = getRotatedRectVertices(rx, ry, rw, rh, rot, radius);
                        isValidShape = true;
                    } else {
                        vertices = getPolyVertices(shapeData);
                        if (vertices.length > 2) isValidShape = true;
                    }
                    if (isValidShape) {
                        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                        vertices.forEach(v => {
                            if(v.x < minX) minX = v.x; if(v.x > maxX) maxX = v.x;
                            if(v.y < minY) minY = v.y; if(v.y > maxY) maxY = v.y;
                        });
                        primitives.push({ id: item[1], type: type, net: item[3], layer: item[4], shape: "POLY", vertices: vertices, x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY });
                    }
                } else if (type === "PAD_NET") {
                    let compId = item[1];
                    let pinNum = item[2];
                    let padSuffix = item[4];
                    padIdToPinInfo[compId + padSuffix] = { compId: compId, pin: pinNum };
                }
            } catch (e) {}
        });
        return { primitives, innerLayerIds };
    }

	// 3.3 解析 V3 源码（返回图元、内层列表、引脚映射）
	function parseV3Primitives(lines, allUsedNetNames, padIdToPinInfo) {
		const LAYER_MULTI = 12;
		const primitives = [];
		const innerLayerIds = [];
		const compIdToDesignator = {};
		const padSuffixToPadNetId = {};   // 可选，用于 PAD_NET 映射
		const linesData = [];              // 新增：存储每行的解析结果
		const padSuffixToTicket = {};

		updateFooterStatus(0, 0, "解析 V3 源码");
		// 辅助：解析一行可能包含多个对象（用 || 分隔）
		function parseV3LineObjects(line) {
			if (!line.trim()) return [];
			let cleanLine = line.trim();
			if (cleanLine.endsWith('|')) cleanLine = cleanLine.slice(0, -1);
			const parts = cleanLine.split('||');
			const objects = [];
			for (let part of parts) {
				if (!part.trim()) continue;
				try {
					objects.push(JSON.parse(part));
				} catch (e) {}
			}
			return objects;
		}

		for (let line of lines) {
			const objects = parseV3LineObjects(line);
			if (objects.length === 0) continue;

			// 合并同一行的多个对象
			let mergedItem = {};
			objects.forEach(obj => Object.assign(mergedItem, obj));
			const type = mergedItem.type;

			if (type === 'IMAGE') continue;

			// ---------- LAYER ----------
			if (type === 'LAYER') {
				const lid = mergedItem.layerId;
				const isUsed = mergedItem.use === true;
				if (isInnerLayer(lid) && isUsed && !innerLayerIds.includes(lid)) {
					innerLayerIds.push(lid);
				}
				continue;
			}

			// ---------- 网络名 ----------
			let netName = '';
			if (type === 'PAD_NET' && mergedItem.padNet) {
				netName = mergedItem.padNet;
			} else if (mergedItem.netName) {
				netName = mergedItem.netName;
			}
			if (netName) allUsedNetNames.add(netName);

			// ---------- ATTR（位号映射）----------
			if (type === 'ATTR') {
				if (mergedItem.key === 'Designator' && mergedItem.value && mergedItem.parentId) {
					compIdToDesignator[mergedItem.parentId] = mergedItem.value;
				}
				continue;
			}

			// ---------- COMPONENT（位号映射）----------
			if (type === 'COMPONENT') {
				const id = mergedItem.id;
				const des = mergedItem.designator;
				if (id && des) compIdToDesignator[id] = des;
				continue;
			}

			// ---------- PAD_NET（引脚映射）----------
			if (type === 'PAD_NET') {
				let idRaw = mergedItem.id;
				if (typeof idRaw === 'string' && idRaw.startsWith('[')) {
					try {
						let idParts = JSON.parse(idRaw);
						if (idParts.length >= 4) {
							let compId = idParts[1];
							let pinNum = idParts[2];
							let padSuffix = idParts[3];
							// 存储引脚信息
							let pinInfo = { compId, pin: pinNum };
							padIdToPinInfo[compId + padSuffix] = pinInfo;
							padIdToPinInfo[padSuffix] = pinInfo;
						}
					} catch (e) {}
				}
				continue;
			}

			// ---------- LINE ----------
			if (type === 'LINE') {
				primitives.push({
					id: mergedItem.id,           // 直接使用对象的 id 字段
					ticket: mergedItem.ticket,
					type: 'LINE',
					net: mergedItem.netName,
					layer: mergedItem.layerId,
					shape: 'line',
					x1: mergedItem.startX,
					y1: mergedItem.startY,
					x2: mergedItem.endX,
					y2: mergedItem.endY,
					w: mergedItem.width,
				});
				continue;
			}

			// ---------- VIA ----------
			if (type === 'VIA') {
				primitives.push({
					id: mergedItem.id,
					ticket: mergedItem.ticket,
					type: 'VIA',
					net: mergedItem.netName,
					layer: LAYER_MULTI,
					_rawRange: mergedItem.ruleName,
					shape: 'ROUND',
					x: mergedItem.centerX,
					y: mergedItem.centerY,
					w: mergedItem.viaDiameter,
					h: mergedItem.viaDiameter,
					r: mergedItem.viaDiameter / 2,
				});
				continue;
			}

			// ---------- ARC ----------
			if (type === 'ARC') {
				primitives.push.apply(primitives, expandArcLines({
					id: mergedItem.id,
					net: mergedItem.netName,
					layer: mergedItem.layerId,
					x1: mergedItem.startX,
					y1: mergedItem.startY,
					x2: mergedItem.endX,
					y2: mergedItem.endY,
					angle: mergedItem.angle,
					w: mergedItem.width
				}));
				continue;
			}

			// ---------- FILL / REGION / POLY / COPPER_AREA ----------
			if (type === 'FILL' || type === 'REGION' || type === 'POLY' || type === 'COPPER_AREA') {
				// 过滤板框和无关层
				if (type === 'REGION') continue;
				if (type === 'POLY') continue;
				if (type === 'FILL' && mergedItem.layerId === 12) continue;

				let shapeData = null;
				if (mergedItem.path) shapeData = mergedItem.path;
				else if (mergedItem.points) shapeData = mergedItem.points;
				else if (mergedItem.width && mergedItem.height && mergedItem.x !== undefined) {
					shapeData = ['R', mergedItem.x, mergedItem.y, mergedItem.width, mergedItem.height,
								mergedItem.rotation || 0, mergedItem.cornerRadius || 0];
				}

				// 深度提取有效数据（处理嵌套）
				let safeCounter = 0;
				while (Array.isArray(shapeData) && shapeData.length > 0 && Array.isArray(shapeData[0])) {
					if (shapeData[0][0] === 'R' || typeof shapeData[0][0] === 'number') break;
					shapeData = shapeData[0];
					if (++safeCounter > 5) break;
				}

				let vertices = [];
				let isValidShape = false;
				let rectData = null;

				// 矩形格式 ["R", x, y, w, h, rot, radius]
				if (Array.isArray(shapeData) && shapeData.length > 0) {
					if (Array.isArray(shapeData[0]) && shapeData[0][0] === 'R') rectData = shapeData[0];
					else if (shapeData[0] === 'R') rectData = shapeData;
				}
				if (rectData) {
					let rx = Number(rectData[1]), ry = Number(rectData[2]), rw = Number(rectData[3]),
						rh = Number(rectData[4]), rot = Number(rectData[5] || 0), radius = Number(rectData[6] || 0);
					vertices = getRotatedRectVertices(rx, ry, rw, rh, rot, radius);
					isValidShape = true;
				} else if (shapeData) {
					vertices = getPolyVertices(shapeData);
					if (vertices.length > 2) isValidShape = true;
				}

				if (isValidShape) {
					let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
					vertices.forEach(v => {
						if (v.x < minX) minX = v.x;
						if (v.x > maxX) maxX = v.x;
						if (v.y < minY) minY = v.y;
						if (v.y > maxY) maxY = v.y;
					});
					primitives.push({
						id: mergedItem.id,
						ticket: mergedItem.ticket,
						type: 'POLY',
						net: netName,
						layer: mergedItem.layerId,
						shape: 'POLY',
						vertices: vertices,
						x: (minX + maxX) / 2,
						y: (minY + maxY) / 2,
						w: maxX - minX,
						h: maxY - minY,
					});
				}
				continue;
			}
		}

		// 将位号映射填充到 padIdToPinInfo 中
		for (let padId in padIdToPinInfo) {
			let info = padIdToPinInfo[padId];
			if (compIdToDesignator[info.compId]) info.des = compIdToDesignator[info.compId];
			else info.des = null;
		}

		return { primitives, innerLayerIds, compIdToDesignator, padSuffixToTicket };
	}
	
    // 3.4 通用连通分量分析（返回 clusters, allUsedNetNames）
    async function computeClustersFromPrimitives(primitives, allPads, innerLayerIds, padIdToPinInfo) {
		updateFooterStatus(0, 0, "连通分量分析");
        const stackIds = getStackIds(innerLayerIds);
        primitives.forEach(p => {
            if (p.type === "VIA" && p._rawRange) {
                p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
            }
        });

        const allPrimitives = primitives.concat(allPads);
        const copperPrimitives = allPrimitives.filter(p => {
            const lid = Number(p.layer);
            return isConductiveLayer(lid);
        });

        let uf = new UnionFind();
        const GRID_SIZE = 150;
        let grid = {};
        copperPrimitives.forEach(p => addToGrid(p, GRID_SIZE, grid));

        let processedPairs = new Set();
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
                    }
                }
            }
        }

        let clusters = {};
        copperPrimitives.forEach(p => {
            let root = uf.find(p.id);
            if (!clusters[root]) clusters[root] = [];
            clusters[root].push(p);
        });

        // 为焊盘补充引脚信息
        for (let rootId in clusters) {
            let group = clusters[rootId];
            for (let item of group) {
                if (item.type === 'PAD') {
                    let pinInfo = padIdToPinInfo[item.id];
                    if (!pinInfo) {
                        for (let key in padIdToPinInfo) {
                            if (item.id.toString().endsWith(key)) {
                                pinInfo = padIdToPinInfo[key];
                                break;
                            }
                        }
                    }
                    if (pinInfo) item._pinInfo = pinInfo;
                }
            }
        }

        return clusters;
    }

    // 3.5 获取焊盘与源码并返回连通分量（供源码/API模式使用）
    async function analyzePcbCore() {
        let padIdToPinInfo = {};
        try {
            if (typeof rawSource !== 'string') throw new Error("源码获取失败");

            let allPads = await fetchAllPads();
            let allUsedNetNames = new Set();
            allPads.forEach(p => { if(p.net) allUsedNetNames.add(p.net); });

            const lines = rawSource.split('\n');
            let parseResult;
            if (isModern()) {
                parseResult = parseV3Primitives(lines, allUsedNetNames, padIdToPinInfo);
            } else if (isV2()) {
                parseResult = parseV2Primitives(lines, allUsedNetNames, padIdToPinInfo);
            }
            let primitives = parseResult.primitives;
            let innerLayerIds = parseResult.innerLayerIds;

            const clusters = await computeClustersFromPrimitives(primitives, allPads, innerLayerIds, padIdToPinInfo);
            return { clusters, allUsedNetNames };
        } catch (e) {
            console.error(e);
            return { clusters: {}, allUsedNetNames: new Set() };
        }
    }

    // 3.7 根据当前方法生成操作列表
	async function generateOperations(method, netlistData = null) {
		updateFooterStatus(0, 0, "生成操作列表");
		if (method === 'netlist') {

			if (!netlistData) {
				console.error("网表数据为空");
				return [];
			}

			let allPads = await fetchAllPads();
			let padIdToPinInfo = {};
			let compIdToDesignator = {};
			let primitives = [];
			let innerLayerIds = [];
			let allUsedNetNames = new Set();
			const lines = rawSource.split('\n');

			if (isModern()) {
				const parseRes = parseV3Primitives(lines, allUsedNetNames, padIdToPinInfo);
				primitives = parseRes.primitives;
				innerLayerIds = parseRes.innerLayerIds;
				compIdToDesignator = parseRes.compIdToDesignator;
			} else if (isV2()) {
				// V2 解析
				const parseRes = parseV2Primitives(lines, allUsedNetNames, padIdToPinInfo);
				primitives = parseRes.primitives;
				innerLayerIds = parseRes.innerLayerIds;

				// 解析 COMPONENT 和 ATTR 条目获取位号映射
				lines.forEach(line => {
					if (!line.trim() || !line.startsWith('[')) return;
					try {
						let item = JSON.parse(line.replace(/^\s*/, ''));
						if (item[0] === "COMPONENT") {
							// V3 模式下可能用到，保留
							let id = item[1];
							let des = item[2];
							if (id && des) compIdToDesignator[id] = des;
						} else if (item[0] === "ATTR") {
							let ownerId = item[3];
							let key = item[7];
							let val = item[8];
							if (key === "Designator" && ownerId && val) {
								compIdToDesignator[ownerId] = val;
							}
						}
					} catch(e) {}
				});
			}

			// 处理盲埋孔
			const stackIds = getStackIds(innerLayerIds);
			primitives.forEach(p => {
				if (p.type === 'VIA' && p._rawRange) {
					p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
				}
			});

			// 为焊盘补引脚信息中的位号
			for (let padId in padIdToPinInfo) {
				let info = padIdToPinInfo[padId];
				if (compIdToDesignator[info.compId]) info.des = compIdToDesignator[info.compId];
				else info.des = null;
			}

			allPads.forEach(p => { if(p.net) allUsedNetNames.add(p.net); });

			// 连通分量分析
			const clusters = await computeClustersFromPrimitives(primitives, allPads, innerLayerIds, padIdToPinInfo);

			// 决定每个分量的目标网络名
			let netCounter = 1;
			const isGenericNet = (name) => /^NET\d+$/i.test(name);
			let netlistUpdates = {};

			for (let rootId of Object.keys(clusters)) {
				let group = clusters[rootId];
				if (group.length === 1) continue;
				let existingNets = new Set();
				let netVotes = new Map();
				group.forEach(p => {
					if (p.net && p.net !== '' && p.net !== 'null' && p.net !== 'undefined') {
						existingNets.add(p.net); netVotes.set(p.net, (netVotes.get(p.net) || 0) + 1);
					}
				});

				let finalNetName = '';
				if (existingNets.size > 0) {
					let sortedNets = Array.from(existingNets);
					sortedNets.sort((a, b) => {
                        // ⚠️ 不能按「名字长短」定名：分量里混进 1 个异物时，短名会顶掉正确的多数名
                        //   （实测：GND 覆铜被误连 1 个 DP 焊盘 → 整块覆铜被命名成 DP）。
                        // 改为 ① 票数多者优先 ② 真实名优先于通用 NET* ③ 名字短 ④ 字典序
                        let wa = netVotes.get(a) || 0, wb = netVotes.get(b) || 0;
                        if (wa !== wb) return wb - wa;
                        let aGen = isGenericNet(a), bGen = isGenericNet(b);
                        if (!aGen && bGen) return -1;
                        if (aGen && !bGen) return 1;
                        if (a.length !== b.length) return a.length - b.length;
                        return a.localeCompare(b);
                    });
					finalNetName = sortedNets[0];
				} else {
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

				// 收集引脚更新
				for (let item of group) {
					if (item.type === 'PAD' && item._pinInfo) {
						let pinInfo = item._pinInfo;
						if (!netlistUpdates[pinInfo.des]) netlistUpdates[pinInfo.des] = {};
						netlistUpdates[pinInfo.des][pinInfo.pin] = finalNetName;
					}
				}
			}

			// 生成操作列表
			let operations = [];
			let compSource = getComponentsContainer(netlistData);
			let designatorToCompId = {};
			for (let cid in compSource) {
				let comp = compSource[cid];
				if (comp.props && comp.props.Designator) {
					designatorToCompId[comp.props.Designator] = cid;
				}
			}

			for (let des in netlistUpdates) {
				let pinUpdates = netlistUpdates[des];
				let compId = designatorToCompId[des];
				if (!compId) continue;
				let comp = compSource[compId];
				if (!comp) continue;
				for (let pin in pinUpdates) {
					let newNet = pinUpdates[pin];
					let oldNet = '';
					if (comp.pinInfoMap && comp.pinInfoMap[pin]) {
						oldNet = comp.pinInfoMap[pin].net || '';
					} else if (comp.pins && comp.pins[pin] !== undefined) {
						oldNet = comp.pins[pin];
					}
					if (oldNet !== newNet) {
						operations.push({
							des: des,
							pin: pin,
							oldNet: oldNet || '—',
							newNet: newNet,
							status: 'pending'
						});
					}
				}
			}
			return operations;
		} else {
			// 源码/API 模式保持不变
			const { clusters, allUsedNetNames } = await analyzePcbCore();
			let netCounter = 1;
			const isGenericNet = (name) => /^NET\d+$/i.test(name);
			let operations = [];

			for (const rootId of Object.keys(clusters)) {
				let group = clusters[rootId];
				if (group.length === 1) continue;
				let existingNets = new Set();
				let netVotes = new Map();
				group.forEach(p => {
					if (p.net && p.net !== '' && p.net !== 'null' && p.net !== 'undefined') {
						existingNets.add(p.net); netVotes.set(p.net, (netVotes.get(p.net) || 0) + 1);
					}
				});

				let finalNetName = '';
				if (existingNets.size > 0) {
					let sortedNets = Array.from(existingNets);
					sortedNets.sort((a, b) => {
                        // ⚠️ 不能按「名字长短」定名：分量里混进 1 个异物时，短名会顶掉正确的多数名
                        //   （实测：GND 覆铜被误连 1 个 DP 焊盘 → 整块覆铜被命名成 DP）。
                        // 改为 ① 票数多者优先 ② 真实名优先于通用 NET* ③ 名字短 ④ 字典序
                        let wa = netVotes.get(a) || 0, wb = netVotes.get(b) || 0;
                        if (wa !== wb) return wb - wa;
                        let aGen = isGenericNet(a), bGen = isGenericNet(b);
                        if (!aGen && bGen) return -1;
                        if (aGen && !bGen) return 1;
                        if (a.length !== b.length) return a.length - b.length;
                        return a.localeCompare(b);
                    });
					finalNetName = sortedNets[0];
				} else {
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
				
				group.forEach(item => {
					if (item.net !== finalNetName) {
						operations.push({
							id: item.id,
							ticket: item.ticket,
							type: item.type,
							oldNet: item.net || '—',
							newNet: finalNetName,
							status: 'pending'
						});
					}
				});
			}
			return operations;
		}
	}

    // ========================= 4. UI 辅助函数 =========================
	function updateButtonState() {
		const execBtn = document.getElementById('btn-execute');
		const refreshBtn = document.getElementById('btn-refresh');
		if (!execBtn || !refreshBtn) return;
		// 执行按钮在有操作列表且未在分析/执行时可用
		execBtn.disabled = g_isAnalyzing || g_isExecuting || g_pendingOperations.length === 0;
		// 计算拓扑按钮只在未分析/执行时可用
		refreshBtn.disabled = g_isAnalyzing || g_isExecuting;
	}

	function setLoading(isLoading, text) {
		const mask = document.getElementById('loading-mask');
		const loadText = document.getElementById('loading-text');
		if (isLoading) {
			// 清除之前的定时器
			if (loadingTimeout) {
				clearTimeout(loadingTimeout);
				loadingTimeout = null;
			}
			mask.style.display = 'flex';
			loadText.innerText = text;
			document.getElementById('btn-execute').disabled = true;
			document.getElementById('btn-refresh').disabled = true;

			// 如果传入的文本是“分析物理拓扑中…”，则启动20秒超时定时器
			if (text === "分析物理拓扑中…") {
				loadingTimeout = setTimeout(() => {
					// 检查遮罩是否仍显示且文字未被其他操作修改
					if (mask.style.display === 'flex' && loadText.innerText === "分析物理拓扑中…") {
						loadText.innerText = "计算时间比以往要久，建议重新打开工程重试";
					}
					loadingTimeout = null;
				}, 20000);
			}
		} else {
			// 关闭遮罩时，清除定时器
			if (loadingTimeout) {
				clearTimeout(loadingTimeout);
				loadingTimeout = null;
			}
			mask.style.display = 'none';
			updateButtonState();
		}
	}

    function updateFooterStatus(current, total, message = null) {
        const bar = document.getElementById('progress-bar');
        const leftTxt = document.getElementById('status-left');
        const rightTxt = document.getElementById('status-right');
        if (total === 0) {
            bar.style.width = '0%';
            leftTxt.innerText = message || '就绪';
            rightTxt.innerText = '-- / --';
            return;
        }
        const percentage = Math.min(100, Math.round(((current / total) * 100)).toFixed(1));
        bar.style.width = `${percentage}%`;
        if (current === 0) leftTxt.innerText = message || `发现 ${total} 个待更新项`;
        else if (current === total) leftTxt.innerText = message || '执行完毕';
        else leftTxt.innerText = message || `执行中 ${percentage}%`;
        rightTxt.innerText = `${current} / ${total}`;
    }

    // ========================= 5. 表格渲染 =========================
	function rerenderTable() {
		const method = document.getElementById('method-select').value;
		let ops = [];
		if (method === 'netlist') {
			ops = g_netlistOps;
		} else {
			ops = g_sourceOps;
		}
		renderTable(ops);
	}
	
	function renderTable(ops) {
		const container = document.getElementById('result-list');
		const header = document.getElementById('grid-header');
		const method = document.getElementById('method-select').value;
		g_currentMethod = method;

		if (method === 'netlist') {
			header.innerHTML = `
				<div>位号</div>
				<div>编号</div>
				<div>旧网络</div>
				<div>新网络</div>
				<div>状态</div>
			`;
		} else {
			header.innerHTML = `
				<div>图元ID</div>
				<div>类型</div>
				<div>旧网络</div>
				<div>新网络</div>
				<div>状态</div>
			`;
		}

		container.innerHTML = "";
		if (!ops || ops.length === 0) {
			container.innerHTML = `
				<div class="empty-state">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
						<polyline points="22 4 12 14.01 9 11.01"></polyline>
					</svg>
					<div>请点击“计算拓扑”按钮生成待更新项</div>
				</div>`;
			g_pendingOperations = [];
			updateFooterStatus(0, 0);
			updateButtonState();
			return;
		}

		g_pendingOperations = ops;   // 更新全局待处理列表

		ops.forEach((op, index) => {
			const row = document.createElement('div');
			row.className = 'row-item grid-row-layout';
			row.id = `row-${index}`;
			if (method === 'netlist') {
				row.innerHTML = `
					<div class="cell-truncate" title="${op.des}">${op.des}</div>
					<div class="cell-truncate">${op.pin}</div>
					<div class="cell-truncate" title="${op.oldNet}">${op.oldNet}</div>
					<div class="cell-truncate new-net" title="${op.newNet}">${op.newNet}</div>
					<div><span class="st-pending" id="status-${index}">待处理</span></div>
				`;
			} else {
				row.innerHTML = `
					<div class="cell-truncate" title="${op.id}">${op.id}</div>
					<div class="cell-truncate">${op.type}</div>
					<div class="cell-truncate" title="${op.oldNet}">${op.oldNet}</div>
					<div class="cell-truncate new-net" title="${op.newNet}">${op.newNet}</div>
					<div><span class="st-pending" id="status-${index}">待处理</span></div>
				`;
			}
			container.appendChild(row);
		});
		updateFooterStatus(0, ops.length);
		updateButtonState();
	}

    // ========================= 6. 数据写入执行 =========================

	// 修改阶段进度更新（0% → 80%）
	function updateModifyProgress(current, total) {
		if (total === 0) return;
		const percent = ((current / total) * 80).toFixed(1);
		const bar = document.getElementById('progress-bar');
		if (bar) bar.style.width = `${percent}%`;
		const leftTxt = document.getElementById('status-left');
		const rightTxt = document.getElementById('status-right');
		if (leftTxt && rightTxt) {
			leftTxt.innerText = `修改中 ${percent}`;
			rightTxt.innerText = `${current} / ${total}`;
		}
	}

	let writeTimer = null;
	function startWriteProgress() {
		if (writeTimer) clearInterval(writeTimer);
		let progress = 80;
		writeTimer = setInterval(() => {
			if (progress < 99) {
				progress += 1;
				const bar = document.getElementById('progress-bar');
				if (bar) bar.style.width = `${progress}%`;
				const leftTxt = document.getElementById('status-left');
				if (leftTxt) leftTxt.innerText = `写入中 ${progress}%`;
			}
		}, 1000);
	}

	function stopWriteProgress(success = true) {
		if (writeTimer) {
			clearInterval(writeTimer);
			writeTimer = null;
		}
		const bar = document.getElementById('progress-bar');
		if (bar) bar.style.width = success ? '100%' : '0%';
		const leftTxt = document.getElementById('status-left');
		if (leftTxt) leftTxt.innerText = success ? '写入完成' : '写入失败';
	}

    async function writeChanges() {
		if (g_isAnalyzing || g_pendingOperations.length === 0 || g_isExecuting) return;

		const method = g_currentMethod;
		g_isExecuting = true;
		updateButtonState();

		const total = g_pendingOperations.length;
		const startTime = Date.now();

		if (method === 'netlist') {
			try {
				setLoading(true, "正在写入网表...");

				// 1. 获取网表文件并解析
				let res = netlistData;
				let netlistJson = typeof res === 'string' ? JSON.parse(res) : res;
				let compSource = getComponentsContainer(netlistJson);

				// 2. 将操作项按位号分组（designator -> {pin: newNet}）
				const pinUpdatesByDesignator = new Map();
				for (const op of g_pendingOperations) {
					if (!pinUpdatesByDesignator.has(op.des)) {
						pinUpdatesByDesignator.set(op.des, {});
					}
					pinUpdatesByDesignator.get(op.des)[op.pin] = op.newNet;
				}
				
				// 3. 预先收集所有需要更新的 DOM 元素（用于最后一次性更新状态）
				const total = g_pendingOperations.length;
				const statusSpans = [];
				const rowDivs = [];
				for (let i = 0; i < total; i++) {
					statusSpans.push(document.getElementById(`status-${i}`));
					rowDivs.push(document.getElementById(`row-${i}`));
				}
				
				// 4. 批量更新网表对象（遍历所有组件，而非操作项）
				let updateCount = 0;
				// const startTime = Date.now();

				// 建立位号到组件 ID 的映射（用于快速定位）
				const designatorToCompId = new Map();
				for (let compId in compSource) {
					let comp = compSource[compId];
					if (comp.props && comp.props.Designator) {
						designatorToCompId.set(comp.props.Designator, compId);
					}
				}

				// 遍历所有组件（这才是关键！）
				for (let compId in compSource) {
					let compData = compSource[compId];
					if (!compData || !compData.props) continue;
					let des = compData.props.Designator;
					if (!des) continue;

					const pinUpdates = pinUpdatesByDesignator.get(des);
					if (!pinUpdates) continue; // 该组件没有需要更新的引脚

					// 根据网表结构更新引脚网络
					if (compData.pinInfoMap) {
						for (let pinNum in pinUpdates) {
							const targetNet = pinUpdates[pinNum];
							const pinKey = String(pinNum);
							if (compData.pinInfoMap[pinKey]) {
								if (compData.pinInfoMap[pinKey].net !== targetNet) {
									compData.pinInfoMap[pinKey].net = targetNet;
									updateCount++;
								}
							} else {
								compData.pinInfoMap[pinKey] = { net: targetNet, number: pinKey };
								updateCount++;
							}
						}
					} else {
						if (!compData.pins) compData.pins = {};
						for (let pinNum in pinUpdates) {
							const targetNet = pinUpdates[pinNum];
							const pinKey = String(pinNum);
							if (compData.pins[pinKey] !== targetNet) {
								compData.pins[pinKey] = targetNet;
								updateCount++;
							}
						}
					}
				}
				
				// 5. 更新表格行状态（一次性，不参与循环）
				for (let i = 0; i < total; i++) {
					const span = statusSpans[i];
					if (span) {
						span.innerText = "完成";
						span.className = "st-done";
					}
					const rowDiv = rowDivs[i];
					if (rowDiv) rowDiv.classList.add('active');
				}
				
				// 6. 进度条设为 80%
				const bar = document.getElementById('progress-bar');
				if (bar) bar.style.width = '80%';
				const leftTxt = document.getElementById('status-left');
				if (leftTxt) leftTxt.innerText = '修改完成';
				const rightTxt = document.getElementById('status-right');
				if (rightTxt) rightTxt.innerText = `${total} / ${total}`;

				// 7. 开始写入模拟
				startWriteProgress();
				const duration = ((Date.now() - startTime) / 1000).toFixed(2);
				const startTimeApi = Date.now();

				// 8. 调用 API 写入网表
				const updatedJsonString = JSON.stringify(netlistJson);
				await setNetlist('PCB', updatedJsonString);

				// 9. 写入完成，结束模拟
				stopWriteProgress(true);
				const durationApi = ((Date.now() - startTimeApi) / 1000).toFixed(2);
				updateFooterStatus(total, total, `写入完成，修改耗时 ${duration} 秒，写入耗时 ${durationApi} 秒`);

			} catch (e) {
				console.error(e);
				stopWriteProgress(false);
				updateFooterStatus(0, total, "网表写入失败");
			} finally {
				setLoading(false);
			}
		} else if (method === 'source') {
			try {
				setLoading(true, "正在修改源码...");
				// let rawSource = await eda.sys_FileManager.getDocumentSource();
				let lines = rawSource.split('\n');
				let netMap = new Map();
				for (let op of g_pendingOperations) {
					netMap.set(op.id, op.newNet);
				}

				let modifiedLines = [];
				let total = g_pendingOperations.length;
				let modifiedCount = 0;
				let lastUpdatePercent = -1;

				for (let line of lines) {
					if (!line.trim()) {
						modifiedLines.push(line);
						continue;
					}
					let modified = false;
					let modifiedId = null; // 记录本次修改对应的ID

					if (isV2()) {
						// V2 数组格式
						try {
							let item = JSON.parse(line.replace(/^\s*/, ''));
							let type = item[0];
							if (type === "PAD_NET") {
								let compId = item[1];
								let padId = item[4];
								let fullId = compId + padId;
								if (netMap.has(fullId)) {
									item[3] = netMap.get(fullId);
									modified = true;
									modifiedId = fullId;
									modifiedLines.push(JSON.stringify(item));
								} else {
									modifiedLines.push(line);
								}
							} else {
								let id = item[1];
								if (netMap.has(id) && item[3] !== undefined && typeof item[3] === 'string') {
									item[3] = netMap.get(id);
									modified = true;
									modifiedId = id;
									modifiedLines.push(JSON.stringify(item));
								} else {
									modifiedLines.push(line);
								}
							}
						} catch(e) { modifiedLines.push(line); }
					} else if (isModern()) {
						// V3/V4 格式（同构）：行切分/拼装统一走 WolfCommon，保证改写后逐字节可还原
						const parsedLine = splitSourceLine(line);
						if (!parsedLine) {
							modifiedLines.push(line);
							continue;
						}
						const { leftStr, leftObj, hasTrailingPipe } = parsedLine;
						let rightObj = parsedLine.rightObj;
						const type = leftObj.type;
						if (type === 'PAD_NET') {
							let idRaw = leftObj.id;
							if (typeof idRaw === 'string' && idRaw.startsWith('[')) {
								try {
									let idParts = JSON.parse(idRaw);
									if (idParts.length >= 4) {
										const realId = idParts[1] + idParts[3];
										if (netMap.has(realId)) {
											rightObj.padNet = netMap.get(realId);
											modified = true;
											modifiedId = realId;
										}
									}
								} catch (e) {}
							}
						} else {
							const objId = leftObj.id;
							if (objId && netMap.has(objId)) {
								rightObj.netName = netMap.get(objId);
								modified = true;
								modifiedId = objId;
							}
						}
						if (modified) {
							const newRightStr = JSON.stringify(rightObj);
							modifiedLines.push(joinSourceLine(leftStr, newRightStr, hasTrailingPipe));
						} else {
							modifiedLines.push(line);
						}
					} else {
						modifiedLines.push(line);
					}

					if (modified && modifiedId) {
						modifiedCount++;
						// 每完成10%更新一次进度（0% → 80%）
						const currentPercent = (modifiedCount / total) * 80;
						const intPercent = Math.floor(currentPercent / 10) * 10;
						if (intPercent > lastUpdatePercent) {
							lastUpdatePercent = intPercent;
							const percentStr = currentPercent.toFixed(1);
							const bar = document.getElementById('progress-bar');
							if (bar) bar.style.width = `${percentStr}%`;
							const leftTxt = document.getElementById('status-left');
							const rightTxt = document.getElementById('status-right');
							if (leftTxt && rightTxt) {
								leftTxt.innerText = `修改中 ${percentStr}%`;
								rightTxt.innerText = `${modifiedCount} / ${total}`;
							}
							// 让UI有机会刷新
							await new Promise(resolve => setTimeout(resolve, 0));
						}
					}
				}

				// 确保进度达到80%
				const bar = document.getElementById('progress-bar');
				if (bar) bar.style.width = '80%';
				const leftTxt = document.getElementById('status-left');
				if (leftTxt) leftTxt.innerText = '修改完成，写入源码中...';

				setLoading(true, "正在写入源码...");
				// 修改完成，进入写入模拟
				startWriteProgress();
				const duration = ((Date.now() - startTime) / 1000).toFixed(2);
				const startTimeApi = Date.now();

				const newSource = modifiedLines.join('\n');
				await eda.sys_FileManager.setDocumentSource(newSource);

				stopWriteProgress(true);
				const durationApi = ((Date.now() - startTimeApi) / 1000).toFixed(2);
				updateFooterStatus(total, total, `写入完成，修改耗时 ${duration}秒，写入耗时 ${durationApi}秒`);

				// 更新表格状态
				for (let i = 0; i < total; i++) {
					let statusSpan = document.getElementById(`status-${i}`);
					if (statusSpan) {
						statusSpan.innerText = "完成";
						statusSpan.className = "st-done";
					}
					let rowDiv = document.getElementById(`row-${i}`);
					if (rowDiv) rowDiv.classList.add('active');
				}
				try { eda.sys_Window.redraw(); } catch(e){}
			} catch(e) {
				console.error(e);
				stopWriteProgress(false);
				updateFooterStatus(0, total, "源码写入失败");
			} finally {
				setLoading(false);
			}
		} else if (method === 'api') {
			try {
				// setLoading(true, "正在通过API更新...");
				const total = g_pendingOperations.length;
				const BATCH_SIZE = 192;
				for (let i = 0; i < total; i++) {
					let op = g_pendingOperations[i];
					let success = false;
					try {
						let props = { net: op.newNet };

						// 特殊处理 PAD 类型
						if (op.type === 'PAD') {
							success = false;
							// 存在bug，待官方修复后启用
							// eda.pcb_PrimitivePad.modify(op.id, props); break;
						} else {
							switch (op.type) {
								case "VIA":   eda.pcb_PrimitiveVia.modify(op.id, props); break;
								case "LINE":  eda.pcb_PrimitiveLine.modify(op.id, props); break;
								case "ARC":   eda.pcb_PrimitiveArc.modify(op.id, props); break;
								case "FILL":  eda.pcb_PrimitiveFill.modify(op.id, props); break;
								case "POLY":  eda.pcb_PrimitivePolyline.modify(op.id, props); break;
								case "POUR":  eda.pcb_PrimitivePour.modify(op.id, props); break;
								case "REGION": eda.pcb_PrimitiveFill.modify(op.id, props); break;
								case "COPPER_AREA": eda.pcb_PrimitivePour.modify(op.id, props); break;
							}
							success = true;
						}
					} catch (e) { success = false; console.error(e); }

					// 更新UI状态
					let statusSpan = document.getElementById(`status-${i}`);
					let rowDiv = document.getElementById(`row-${i}`);
					if (statusSpan) {
						statusSpan.innerText = success ? "完成" : "错误";
						statusSpan.className = success ? "st-done" : "st-err";
					}
					if (rowDiv) {
						rowDiv.classList.add('active');
						if(i > 0) document.getElementById(`row-${i-1}`).classList.remove('active');
					}

					// 更新进度条：直接按比例从0%到100%
					const percent = (((i + 1) / total) * 100).toFixed(1);
					const bar = document.getElementById('progress-bar');
					if (bar) bar.style.width = `${percent}%`;
					const leftTxt = document.getElementById('status-left');
					const rightTxt = document.getElementById('status-right');
					if (leftTxt && rightTxt) {
						leftTxt.innerText = `修改中 ${percent}%`;//把这个进度并保留1位小数
						rightTxt.innerText = `${i+1} / ${total}`;
					}

					if (rowDiv) rowDiv.scrollIntoView({ block: "center" }); // 无动画

					// 每 BATCH_SIZE 个暂停一下，让UI有机会刷新
					if ((i + 1) % BATCH_SIZE === 0 && i + 1 < total) {
						await new Promise(resolve => setTimeout(resolve, 0));
					}
				}

				try { eda.sys_Window.redraw(); } catch(e){}
				const duration = ((Date.now() - startTime) / 1000).toFixed(2);
				updateFooterStatus(total, total, `API更新完成，耗时 ${duration}秒，修改焊盘API存在Bug，待官方修复后启用`);
			} catch(e) {
				console.error(e);
				updateFooterStatus(0, total, "API写入失败");
			} finally {
				setLoading(false);
			}
		}

        g_isExecuting = false;
        updateButtonState();
        const lastRow = document.getElementById(`row-${total-1}`);
        if(lastRow) lastRow.classList.remove('active');
    }

    // ========================= 7. 初始化与事件绑定 =========================
	async function computeTopology() {
		if(g_isExecuting || g_isAnalyzing) return;
		g_isAnalyzing = true;
		setLoading(true, "分析物理拓扑中…");

		const method = document.getElementById('method-select').value;

		try {
			g_netlistOps = [];
			g_sourceOps = [];
			// 获取版本号（统一走 WolfCommon.getEditorVersion）
			updateFooterStatus(0, 0, "获取版本号");
			g_editorVersion = getEditorVersion();
			// 获取源码
			updateFooterStatus(0, 0, "获取源码");
			rawSource = await eda.sys_FileManager.getDocumentSource();

			if (method === 'netlist') {
				updateFooterStatus(0, 0, "获取网表");
				netlistData = await fetchNetlist();
				g_netlistOps = await generateOperations('netlist', netlistData);
			} else {
				// source 或 api 共用同一套分析结果
				g_sourceOps = await generateOperations('source', null);
			}
		} catch(e) {
			g_editorVersion = "Null";
			console.error(e);
		}

		rerenderTable();
		setLoading(false);
		g_isAnalyzing = false;
		updateButtonState();
	}

	window.onload = async function() {
		// 初始化界面
		document.getElementById('btn-refresh').addEventListener('click', computeTopology);
		document.getElementById('btn-execute').addEventListener('click', writeChanges);
		document.getElementById('method-select').addEventListener('change', () => {
			const method = document.getElementById('method-select').value;
			const warningSpan = document.getElementById('api-warning');
			if (method === 'api') {
				warningSpan.style.display = 'inline';
			} else {
				warningSpan.style.display = 'none';
			}
			// 清空所有操作数据，重置界面
			g_netlistOps = [];
			g_sourceOps = [];
			g_pendingOperations = [];
			renderTable([]);          // 直接清空表格
			updateFooterStatus(0, 0); // 重置底部进度
			updateButtonState();
		});
		// 显示空表格
		renderTable([]);
	};
