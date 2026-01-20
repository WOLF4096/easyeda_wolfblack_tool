/**
 * 导线(Primitive Line/Arc) 与 线条(Polyline)/区域(Region) 互转工具 v2.3 (Arc修正版)
 * * 功能说明：
 * 1. toWire(): 将选中的 Polyline/Region 转为 Line/Arc (导线)
 * 2. toPolyline(): 将选中的 Line/Arc 转为 Polyline (线条)
 * 3. toggle(): 智能判断，互相转换
 * * * 更新说明：
 * - [v2.3] 修复 Arc 转 Polyline 被错误放大的问题：仅对 Line 应用 x10 缩放，Arc 保持原值
 * - [v2.2] 支持 v2.2.45.x 版本 Line 坐标及线宽 x10 修正
 * - 增加对 Region (圆形、矩形、圆角矩形) 转导线的支持
 * */

export const WireConverter = {
	/**
	 * 入口 1: 转为导线 (Polyline/Region -> Line/Arc)
	 */
	toWire: async function () {
		const primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		console.log('Basic Primitives:', primitives);
		if (!primitives || primitives.length === 0) return;

		// 获取 Region 的详细信息以提取 Net 属性
		const detailedPrimitives = await eda.pcb_SelectControl.getSelectedPrimitives();
		const netMap = this._buildNetMap(detailedPrimitives);

		// eda.sys_Log.add("开始转换 轮廓对象 ⇒ 导线");

		for (let item of primitives) {
			if (item.primitiveType === 'Polyline' && item.polygon && item.polygon.polygon) {
				await this._convertPolyToWire(item);
			} else if (item.primitiveType === 'Region' && item.complexPolygon && item.complexPolygon.polygon) {
				const externalNet = netMap[item.primitiveId];
				await this._convertRegionToWire(item, externalNet);
			}
		}
		// eda.sys_Log.add("转换完成");
		// eda.sys_PanelControl.openBottomPanel("log");
	},

	/**
	 * 入口 2: 转为线条 (Line/Arc -> Polyline)
	 */
	toPolyline: async function () {
		const primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		console.log(primitives);
		if (!primitives || primitives.length === 0) return;

		// eda.sys_Log.add("开始转换 导线 ⇒ 轮廓对象");

		for (let item of primitives) {
			if (item.primitiveType === 'Line' || item.primitiveType === 'Arc') {
				await this._convertWireToPoly(item);
			}
		}
		// eda.sys_Log.add("转换完成");
		// eda.sys_PanelControl.openBottomPanel("log");
	},

	/**
	 * 入口 3: 互相转换 (自动识别类型)
	 */
	toggle: async function () {
		const primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		console.log(primitives);
		if (!primitives || primitives.length === 0) return;

		const detailedPrimitives = await eda.pcb_SelectControl.getSelectedPrimitives();
		const netMap = this._buildNetMap(detailedPrimitives);

		// eda.sys_Log.add("开始转换 导线 ⇄ 线条");

		for (let item of primitives) {
			if (item.primitiveType === 'Polyline') {
				await this._convertPolyToWire(item);
			} else if (item.primitiveType === 'Region') {
				const externalNet = netMap[item.primitiveId];
				await this._convertRegionToWire(item, externalNet);
			} else if (item.primitiveType === 'Line' || item.primitiveType === 'Arc') {
				await this._convertWireToPoly(item);
			}
		}
		// eda.sys_Log.add("转换完成");
		// eda.sys_PanelControl.openBottomPanel("log");
	},

	// ================= 内部逻辑方法 =================

	/**
	 * 辅助方法：构建 globalIndex 到 Net 的映射表
	 */
	_buildNetMap: function (detailedPrimitives) {
		const map = {};
		if (detailedPrimitives && Array.isArray(detailedPrimitives)) {
			detailedPrimitives.forEach((p) => {
				if (p.globalIndex) {
					map[p.globalIndex] = p.net || '';
				}
			});
		}
		return map;
	},

	/**
	 * 辅助方法：检查铜层
	 */
	_checkCopperLayer: function (layer, primitiveId) {
		const isTopOrBottom = layer === 1 || layer === 2;
		const isInnerLayer = layer >= 15 && layer <= 46;

		if (!isTopOrBottom && !isInnerLayer) {
			eda.sys_Log.add(`当前图元 ${primitiveId} 不在铜层，不可转为导线`, 'warn');
			eda.sys_PanelControl.openBottomPanel('log');
			return false;
		}
		return true;
	},

	/**
	 * 核心逻辑 1：将 Polyline 拆解并创建对应的 Line/Arc
	 */
	_convertPolyToWire: async function (polyItem) {
		if (!this._checkCopperLayer(polyItem.layer, polyItem.primitiveId)) return;

		const arr = polyItem.polygon.polygon;
		const net = polyItem.net || '';
		const layer = polyItem.layer;
		const width = polyItem.lineWidth * 10;

		if (!arr || arr.length < 2 || typeof arr[0] !== 'number') return;

		let startX = arr[0];
		let startY = arr[1];
		let currentMode = 'L';
		let i = 2;

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
			} else if (currentMode === 'ARC' || currentMode === 'CARC') {
				const angle = arr[i];
				const endX = arr[i + 1];
				const endY = arr[i + 2];
				await eda.pcb_PrimitiveArc.create(net, layer, startX, startY, endX, endY, angle, width, 1, false);
				startX = endX;
				startY = endY;
				i += 3;
			} else {
				i++;
			}
		}
	},

	/**
	 * 核心逻辑 2：将 Region (Circle/Rect/Polygon) 拆解为 Line/Arc
	 */
	_convertRegionToWire: async function (regionItem, overrideNet) {
		if (!this._checkCopperLayer(regionItem.layer, regionItem.primitiveId)) return;

		const arr = regionItem.complexPolygon.polygon;
		const net = overrideNet !== undefined && overrideNet !== null ? overrideNet : regionItem.net || '';
		const layer = regionItem.layer;
		const width = regionItem.lineWidth * 10;

		if (!arr || arr.length === 0) return;
		const firstVal = arr[0];

		try {
			await eda.pcb_PrimitivePolyline.delete(regionItem.primitiveId);
		} catch (e) {
			console.warn(e);
		}

		// 情况 A: 通用多边形
		if (typeof firstVal === 'number') {
			if (arr.length < 2) return;
			let startX = arr[0];
			let startY = arr[1];
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
					const endX = arr[i];
					const endY = arr[i + 1];
					await eda.pcb_PrimitiveLine.create(net, layer, startX, startY, endX, endY, width, false);
					startX = endX;
					startY = endY;
					i += 2;
				} else if (currentMode === 'ARC' || currentMode === 'CARC') {
					const angle = arr[i];
					const endX = arr[i + 1];
					const endY = arr[i + 2];
					await eda.pcb_PrimitiveArc.create(net, layer, startX, startY, endX, endY, angle, width, 1, false);
					startX = endX;
					startY = endY;
					i += 3;
				} else {
					i++;
				}
			}
			return;
		}

		// 情况 B: 特殊形状
		const type = firstVal;
		if (type === 'CIRCLE') {
			const cx = arr[1];
			const cy = arr[2];
			const r = arr[3];
			await eda.pcb_PrimitiveArc.create(net, layer, cx - r, cy, cx + r, cy, 180, width, 1, false);
			await eda.pcb_PrimitiveArc.create(net, layer, cx + r, cy, cx - r, cy, 180, width, 1, false);
		} else if (type === 'R') {
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
				return { x: cx + (dx * cos - dy * sin), y: cy + (dx * sin + dy * cos) };
			};
			const p1_start = rotatePoint(x + r, y);
			const p1_end = rotatePoint(x + w - r, y);
			const p2_start = p1_end;
			const p2_end = rotatePoint(x + w, y - r);
			const p3_start = p2_end;
			const p3_end = rotatePoint(x + w, y + h_vector + r);
			const p4_start = p3_end;
			const p4_end = rotatePoint(x + w - r, y + h_vector);
			const p5_start = p4_end;
			const p5_end = rotatePoint(x + r, y + h_vector);
			const p6_start = p5_end;
			const p6_end = rotatePoint(x, y + h_vector + r);
			const p7_start = p6_end;
			const p7_end = rotatePoint(x, y - r);
			const p8_start = p7_end;
			const p8_end = p1_start;

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
	 * * 更新 [v2.3]：修复 Arc 被放大的问题。现在仅当图元为 Line 且版本为 2.2.45.x 时才执行 x10
	 */
	_convertWireToPoly: async function (wireItem) {
		let polygonArr = [];

		// 1. 版本检测
		const currentVersion = eda.sys_Environment.getEditorCurrentVersion();
		const isVersion2245 = currentVersion && currentVersion.startsWith('2.2.45');

		// 2. 设定缩放系数
		// 仅当版本匹配 AND 图元类型是 Line 时，才应用 x10
		let scale = 1;
		if (isVersion2245 && wireItem.primitiveType === 'Line') {
			scale = 10;
			console.log(`检测到版本 ${currentVersion} 且图元为 Line，应用 10x 缩放修正`);
		}

		// 3. 计算参数 (对 Arc 而言 scale 始终为 1)
		const startX = wireItem.startX * scale;
		const startY = wireItem.startY * scale;
		const endX = wireItem.endX * scale;
		const endY = wireItem.endY * scale;
		const width = wireItem.lineWidth * scale;

		// 4. 删除原图元
		if (wireItem.primitiveType === 'Line') {
			await eda.pcb_PrimitiveLine.delete(wireItem.primitiveId);
		} else {
			await eda.pcb_PrimitiveArc.delete(wireItem.primitiveId);
		}

		// 5. 构建 Polygon 数据
		if (wireItem.primitiveType === 'Line') {
			polygonArr = [startX, startY, 'L', endX, endY];
		} else if (wireItem.primitiveType === 'Arc') {
			// Arc 保持原样逻辑 (注意：arcAngle 本身不涉及单位长度，无需缩放)
			polygonArr = [startX, startY, 'ARC', wireItem.arcAngle, endX, endY];
		}

		const polyObj = eda.pcb_MathPolygon.createPolygon(polygonArr);

		// 6. 创建 Polyline
		await eda.pcb_PrimitivePolyline.create(wireItem.net || '', wireItem.layer, polyObj, width, false);
	},
};
