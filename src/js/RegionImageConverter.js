/**
 * 图像 (Image) 与 填充 (Fill/Region) 互转工具
 * * 核心机制：通过解析底层源码（兼容 V2 & V3 格式），精准提取原生的二维 path 路径数组。
 * * 修复偏移与形变：自动计算 Image 移动/拉伸后的坐标增量与长宽缩放比例，生成 Fill 时对整个路径网络进行精准的仿射对齐。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

// const ImageFillConverter = {
export const ImageFillConverter = {
    async toFill() {
        await this._process('Fill');
    },

    async toImage() {
        await this._process('Image');
    },

    async toggle() {
        await this._process('Toggle');
    },

    async _process(mode) {
        try {
            const components = await eda.pcb_SelectControl.getAllSelectedPrimitives();
			console.log(components);
            if (!components || components.length === 0) {
                console.log('未选中任何图元');
                return;
            }

            const targets = components.filter(c => c.primitiveType === 'Image' || c.primitiveType === 'Fill' || c.primitiveType === 'Region');
            if (targets.length === 0) {
                // V4 实测：填充图元的 primitiveType 是 'Fill'（不是 'Region'）；
                // 彩色图片（二进制内嵌对象）是 'Object'，源码里没有 path 只有 blob 地址，无法转填充
                console.warn('选中的图元中没有 Image / Fill（彩色图片是 Object，暂不支持转换）');
                eda.sys_Message.showToastMessage('请先选中「图片」或「填充」图元（彩色图片/二维码彩色图暂不支持）');
                return;
            }

            const sourceStr = await eda.sys_FileManager.getDocumentSource();
            const segments = sourceStr.split(/[\n~]/); 

            for (const item of targets) {
                const isImage = item.primitiveType === 'Image';
                const isFill = item.primitiveType === 'Fill' || item.primitiveType === 'Region';

                let targetType = mode;
                if (mode === 'Toggle') {
                    targetType = isImage ? 'Fill' : 'Image';
                } else if ((mode === 'Fill' && isFill) || (mode === 'Image' && isImage)) {
                    continue; 
                }

                // 提取路径及变换参数
                let extractedData = this._extractPath(segments, item.primitiveId);
                if (!extractedData || !extractedData.path) {
                    console.warn(`跳过：无法从源码提取图元 [${item.primitiveId}] 的路径数据`);
                    eda.sys_Message.showToastMessage(`图元 [${item.primitiveId}] 源码里没有路径数据，无法转换`);
                    continue;
                }

                let { path, angle, mirror } = extractedData;

                // 将所有的 C 降级转化为多段 L
                path = this._convertCurvesToLines(path, 20);
				
                if (targetType === 'Image') {
                    await this._createImage(item, path);
                } else if (targetType === 'Fill') {
                    // 将旋转和镜像参数传递给 createFill
                    await this._createFill(item, path, angle, mirror);
                }
            }
        } catch (error) {
            console.error('互转过程出错:', error);
        }
    },

    _extractPath(segments, id) {
        for (let segment of segments) {
            if (segment.includes(`"${id}"`)) {
                if (segment.includes('}||{')) {
                    // V3 格式解析
                    const parts = segment.split('}||');
                    if (parts.length === 2) {
                        try {
                            let jsonStr = parts[1];
                            if (jsonStr.endsWith('|')) jsonStr = jsonStr.slice(0, -1);
                            const data = JSON.parse(jsonStr);
                            if (Array.isArray(data.path)) {
                                return {
                                    path: data.path,
                                    angle: data.angle || 0,
                                    mirror: !!data.mirror // 转为布尔值
                                };
                            }
                        } catch (e) {
                            console.error('V3 数据块解析失败', e);
                        }
                    }
                } else if (segment.trim().startsWith('[')) {
                    // V2 格式解析
                    try {
                        const arr = JSON.parse(segment.trim());
                        // 如果是 IMAGE，按对应索引取值：8 是角度，9 是镜像，10 是路径
                        if (arr[0] === "IMAGE" && arr[1] === id) {
                            return {
                                path: arr[10],
                                angle: arr[8] || 0,
                                mirror: arr[9] === 1 || arr[9] === true
                            };
                        }
                        // 如果是 Region 等其他格式兜底
                        for (let el of arr) {
                            if (Array.isArray(el) && Array.isArray(el[0])) {
                                return { path: el, angle: 0, mirror: false };
                            }
                        }
                    } catch (e) {
                        console.error('V2 数据块解析失败', e);
                    }
                }
            }
        }
        return null;
    },

    /**
     * 计算二维 path 的 BBox (包围盒)
     */
    _calculateBBox(path) {
        let xs = [], ys = [];
        for (let subPath of path) {
            let i = 0;
            if (typeof subPath[0] === 'number') {
                xs.push(subPath[0]); ys.push(subPath[1]); i = 2;
            }
            while (i < subPath.length) {
                let token = subPath[i];
                if (token === 'L' || token === 'M') {
                    xs.push(subPath[i+1]); ys.push(subPath[i+2]); i += 3;
                } else if (token === 'ARC' || token === 'CARC') {
                    xs.push(subPath[i+2]); ys.push(subPath[i+3]); i += 4;
                } else if (typeof token === 'number') {
                    xs.push(subPath[i]); ys.push(subPath[i+1]); i += 2;
                } else {
                    i++;
                }
            }
        }
        return {
            minX: Math.min(...xs), maxX: Math.max(...xs),
            minY: Math.min(...ys), maxY: Math.max(...ys)
        };
    },

	/**
     * 将 Path 数组中的三阶贝塞尔曲线(C) 和 圆弧(ARC/CARC) 降级转换为 多段近似直线(L)
     * 解决非等比拉伸时，圆弧无法变成椭圆，强制变回圆的 Bug。
     */
    _convertCurvesToLines(path, segments = 20) {
        const format = (num) => Number(num.toFixed(4));
        
        let newPath = [];
        let curX = 0, curY = 0;

        for (let subPath of path) {
            let newSub = [];
            let i = 0;
            
            if (typeof subPath[0] === 'number') {
                curX = format(subPath[0]);
                curY = format(subPath[1]);
                newSub.push(curX, curY);
                i = 2;
            }

            while (i < subPath.length) {
                let token = subPath[i];
                if (token === 'M' || token === 'L') {
                    curX = format(subPath[i+1]);
                    curY = format(subPath[i+2]);
                    newSub.push(token, curX, curY);
                    i += 3;
                } else if (token === 'ARC' || token === 'CARC') {
                    // --- 核心修复：解析并降级圆弧为多段直线 ---
                    let sweepDeg = subPath[i+1];
                    let x2 = subPath[i+2];
                    let y2 = subPath[i+3];
                    
                    let sweepRad = (sweepDeg * Math.PI) / 180;
                    if (token === 'CARC') sweepRad = -sweepRad; // 顺时针反转

                    let dx = x2 - curX;
                    let dy = y2 - curY;
                    let d = Math.hypot(dx, dy);
                    
                    if (d > 0.001 && Math.abs(sweepRad) > 0.001) {
                        let halfSweep = sweepRad / 2;
                        let h = 0;
                        // 避免 180度时 tan(90) 趋近无穷大导致的计算爆炸
                        if (Math.abs(Math.abs(sweepRad) - Math.PI) > 0.001) {
                            h = d / (2 * Math.tan(halfSweep));
                        }

                        let midX = (curX + x2) / 2;
                        let midY = (curY + y2) / 2;

                        // 纯数学计算圆心，避免三角函数精度丢失
                        let cx = midX - h * (dy / d);
                        let cy = midY + h * (dx / d);

                        let startAngle = Math.atan2(curY - cy, curX - cx);
                        let radius = Math.hypot(curX - cx, curY - cy);

                        // 动态决定切割段数 (例如每 5度切一段，保证椭圆平滑)
                        let arcSegments = Math.max(12, Math.floor(Math.abs(sweepDeg) / 5));

                        for (let step = 1; step <= arcSegments; step++) {
                            let theta = startAngle + (sweepRad * step) / arcSegments;
                            let px = cx + radius * Math.cos(theta);
                            let py = cy + radius * Math.sin(theta);
                            newSub.push('L', format(px), format(py));
                        }
                    } else {
                        // 兜底退化为直线
                        newSub.push('L', format(x2), format(y2));
                    }
                    
                    curX = format(x2);
                    curY = format(y2);
                    i += 4;
                } else if (token === 'C') {
                    let x1 = subPath[i+1], y1 = subPath[i+2];
                    let x2 = subPath[i+3], y2 = subPath[i+4];
                    let x3 = subPath[i+5], y3 = subPath[i+6];

                    for (let step = 1; step <= segments; step++) {
                        let t = step / segments;
                        let mt = 1 - t;
                        
                        let bx = (mt * mt * mt) * curX + 3 * (mt * mt) * t * x1 + 3 * mt * (t * t) * x2 + (t * t * t) * x3;
                        let by = (mt * mt * mt) * curY + 3 * (mt * mt) * t * y1 + 3 * mt * (t * t) * y2 + (t * t * t) * y3;

                        newSub.push('L', format(bx), format(by));
                    }

                    curX = format(x3);
                    curY = format(y3);
                    i += 7;
                } else if (typeof token === 'number') {
                    curX = format(subPath[i]);
                    curY = format(subPath[i+1]);
                    newSub.push(curX, curY);
                    i += 2;
                } else {
                    newSub.push(token);
                    i++;
                }
            }
            newPath.push(newSub);
        }
        return newPath;
    },
	

    /**
     * 综合仿射变换：对路径进行 平移 + 缩放 -> 镜像 -> 旋转 (严格对齐 EDA 锚点机制)
     */
    _transformPath(path, bbox, targetX, targetY, scaleX, scaleY, angle, mirror) {
        const format = (num) => Number(num.toFixed(4));
        
        // 计算旋转相关的三角函数值 (角度转弧度)
        const rad = angle * Math.PI / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        // 单个坐标点的空间变换函数
        const transformPoint = (x, y) => {
            // 1. 基础缩放与平移 (先对齐到最终的目标原点 targetX, targetY)
            let sx = targetX + (x - bbox.minX) * scaleX;
            let sy = targetY + (y - bbox.maxY) * scaleY;

            // 2. 镜像处理 (软件底层是以 startX 作为翻转轴心，而不是图形内部中点)
            if (mirror) {
                sx = 2 * targetX - sx;
            }

            // 3. 旋转处理 (同样严格绕着 startX, startY 锚点进行旋转)
            if (angle !== 0) {
                let dx = sx - targetX;
                let dy = sy - targetY;
                // 标准二维旋转矩阵
                sx = targetX + dx * cosA - dy * sinA;
                sy = targetY + dx * sinA + dy * cosA;
            }

            return [format(sx), format(sy)];
        };

        let newPath = JSON.parse(JSON.stringify(path)); 
        for (let subPath of newPath) {
            let i = 0;
            if (typeof subPath[0] === 'number') {
                let [nx, ny] = transformPoint(subPath[0], subPath[1]);
                subPath[0] = nx; subPath[1] = ny;
                i = 2;
            }
            while (i < subPath.length) {
                let token = subPath[i];
                if (token === 'L' || token === 'M') {
                    let [nx, ny] = transformPoint(subPath[i+1], subPath[i+2]);
                    subPath[i+1] = nx; subPath[i+2] = ny;
                    i += 3;
                } else if (token === 'ARC' || token === 'CARC') {
                    let [nx, ny] = transformPoint(subPath[i+2], subPath[i+3]);
                    subPath[i+2] = nx; subPath[i+3] = ny;
                    // 如果进行了镜像翻转，圆弧的扫过角度必须取反，否则弧度会鼓包在反方向
                    if (mirror) {
                        subPath[i+1] = format(-subPath[i+1]); 
                    }
                    i += 4; 
                } else if (typeof token === 'number') {
                    let [nx, ny] = transformPoint(subPath[i], subPath[i+1]);
                    subPath[i] = nx; subPath[i+1] = ny;
                    i += 2;
                } else {
                    i++;
                }
            }
        }
        return newPath;
    },

    async _createImage(item, path) {
        const bbox = this._calculateBBox(path);
        const startX = bbox.minX;             
        const startY = bbox.maxY;             
        const width = bbox.maxX - bbox.minX;       
        const height = bbox.maxY - bbox.minY;      

        try {
			// console.log(path);
            const newImage = await eda.pcb_PrimitiveImage.create(
                startX, startY, path, item.layer, width, height, 0, false, false
            );

            if (newImage) {
                console.log(`成功将 Region [${item.primitiveId}] 转换为 Image`);
                await this._deleteSource(item);
            } else {
                eda.sys_Message.showToastMessage(`图元 [${item.primitiveId}] 转换为 Image 失败`);
            }
        } catch (err) {
			eda.sys_Message.showToastMessage(`图元 [${item.primitiveId}] 转换为 Image 失败:`);
            console.error(`图元 [${item.primitiveId}] 转换为 Image 失败:`, err);
        }
    },

    /**
     * 删除被转换的源图元
     *
     * V4 实测：填充图元的 primitiveType 是 `Fill`，只能用 `pcb_PrimitiveFill.delete` 删；
     * 用 `pcb_PrimitiveRegion.delete` 删填充会返回 false 而且**不会报错**（图元留在原地）。
     */
    async _deleteSource(item) {
        const type = item.primitiveType;
        try {
            if (type === 'Image') {
                await eda.pcb_PrimitiveImage.delete(item.primitiveId);
            } else if (type === 'Fill') {
                await eda.pcb_PrimitiveFill.delete(item.primitiveId);
            } else if (type === 'Region') {
                await eda.pcb_PrimitiveRegion.delete(item.primitiveId);
            }
        } catch (err) {
            console.warn(`删除源图元 [${item.primitiveId}](${type}) 失败:`, err);
        }
    },

    async _createFill(item, path, angle = 0, mirror = false) {
        try {
            // 1. 计算原始 path 的包围盒与宽高
            const bbox = this._calculateBBox(path);
            const baseWidth = bbox.maxX - bbox.minX;
            const baseHeight = bbox.maxY - bbox.minY;

            // 2. 获取 Image 当前真实的坐标 (顶左点)
            const itemX = item.x !== undefined ? item.x : item.startX;
            const itemY = item.y !== undefined ? item.y : item.startY;

            // 3. 计算缩放比 (防止除以0的情况)
            const scaleX = (item.width !== undefined && baseWidth > 0) ? (item.width / baseWidth) : 1;
            const scaleY = (item.height !== undefined && baseHeight > 0) ? (item.height / baseHeight) : 1;

            // 4. 判断是否需要变形处理 (含位移、拉伸、旋转、镜像)
            const deltaX = itemX !== undefined ? (itemX - bbox.minX) : 0;
            const deltaY = itemY !== undefined ? (itemY - bbox.maxY) : 0;
            const needsTransform = Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001 || 
                                   Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001 ||
                                   angle !== 0 || mirror === true;

            let finalPath = path;
            if (needsTransform && itemX !== undefined && itemY !== undefined) {
                console.log(`执行形变: Scale=[${scaleX.toFixed(2)},${scaleY.toFixed(2)}], Angle=${angle}, Mirror=${mirror}`);
                // 传入 angle 和 mirror 参数
                finalPath = this._transformPath(path, bbox, itemX, itemY, scaleX, scaleY, angle, mirror);
            }

            // 5. 生成最终的填充
            // ⚠️ V4 实测：图片的 path 是「子路径数组」（多轮廓，二维码就是成百上千个轮廓），
            // `createPolygon()` 只吃单条扁平路径，传嵌套数组会直接返回 undefined，
            // 接着 Fill.create 就抛「无法创建填充图元，可能是传入的参数不正确」。
            // 必须用 `createComplexPolygon()`（等价于旧版能接受的嵌套形态）。
            const polygon = await this._toPolygon(finalPath);
            if (!polygon) {
                eda.sys_Message.showToastMessage(`图元 [${item.primitiveId}] 转换为 Fill 失败：路径无法构成填充`);
                console.warn('createComplexPolygon 返回空，path 片段:', JSON.stringify(finalPath).slice(0, 200));
                return;
            }
            const newFill = await eda.pcb_PrimitiveFill.create(
                item.layer, 
                polygon,               
                item.net || '',       			   
                'SOLID',               
                item.lineWidth || 0.2, 
                false
            );

            if (newFill) {
                console.log(`成功将 Image [${item.primitiveId}] 转换为 Region(Fill)`);
                await this._deleteSource(item);
            }
        } catch (err) {
            eda.sys_Message.showToastMessage(`图元 [${item.primitiveId}] 转换为 Fill 失败`);
            console.error(`图元 [${item.primitiveId}] 转换为 Fill 失败:`, err);
        }
    },

    /**
     * path（子路径数组）→ 复杂多边形对象
     *
     * 优先 `createComplexPolygon`（支持多轮廓）；个别老版本没有该方法时，
     * 退化成「单轮廓用 createPolygon(path[0])」——多轮廓下会丢失内部挖孔，但至少不报错。
     */
    async _toPolygon(path) {
        if (typeof eda.pcb_MathPolygon.createComplexPolygon === 'function') {
            const cp = await eda.pcb_MathPolygon.createComplexPolygon(path);
            if (cp) return cp;
            // 有的版本对"只有一条轮廓"的嵌套数组也挑剔，再试一次扁平形态
            if (path.length === 1) {
                return (await eda.pcb_MathPolygon.createComplexPolygon(path[0])) || null;
            }
            return null;
        }
        if (path.length === 1) {
            return (await eda.pcb_MathPolygon.createPolygon(path[0])) || null;
        }
        console.warn('当前 EDA 版本没有 createComplexPolygon，多轮廓填充可能丢挖孔');
        return (await eda.pcb_MathPolygon.createPolygon(path[0])) || null;
    }
};

// ImageFillConverter.toggle();
