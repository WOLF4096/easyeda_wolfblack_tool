/* eslint-disable complexity */
/**
 * 导线(Primitive Line/Arc) 与 线条(Polyline)/区域(Region) 互转工具
 *
 * 核心机制：通过读取本地存储的 API 校准数据，动态处理图元转换时的坐标/尺寸倍率缩放。
 *
 * 功能：
 * 1. toWire():      选中的 Polyline / Region 转为 Line/Arc（导线）
 * 2. toPolyline():  选中的 Line / Arc 转为 Polyline（线条），**首尾相接的多段会合并成一条连续折线**
 * 3. toggle():      按选中类型自动互转
 *
 * 两条硬约束（实机踩坑得来，改动时别绕开）：
 * - **必须先删后建**：ID1、ID2 两根导线若相互交叉，系统会把它们自动拆成 ID3/4/5/6 四段；
 *   此时再按原 ID 删除已经删不掉了。因此「删除原图元」必须发生在「创建新图元」之前。
 * - **删除失败即回滚**：先删的代价是失败后原图元已不在，所以每条转换路径都在创建失败时
 *   用删除前的快照把原图元重建回去（`_restoreItem`），不能让用户「两边都没了」。
 */
import { loadApiConfig } from './common/apiConfig.js';
import { isCopperLayer } from './common/pcbConstants.js';
import { buildPolygonPath, buildWireChains, isValidSegment } from './common/wireChain.js';

// 默认 API 配置兜底（防止解析失败导致崩溃）
// 注意：`圆弧角度` 保留键名只为兼容历史校准数据，**已不再参与计算** ——
// 实测 V2.2 与 V4 的 `pcb_PrimitiveArc.create/get` 与多边形路径 `ARC` 全是角度制，
// 再乘一个「获取弧线.圆弧角度」会把 90° 压成 1.57°（详见 docs/测试报告-v1.17.6.md P1-3）。
const DEFAULT_API_CONFIG = {
	创建折线: { 坐标: 1, 线宽: 1 },
	创建直线: { 坐标: 1, 线宽: 1 },
	创建弧线: { 坐标: 1, 线宽: 1, 圆弧角度: 1 },
	获取折线: { 坐标: 1, 线宽: 1 },
	获取直线: { 坐标: 1, 线宽: 1 },
	获取弧线: { 坐标: 1, 线宽: 1, 圆弧角度: 1 },
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

			// 导线（Line/Arc）统一收集后批量处理：只有一起删、一起建，才能把
			// 首尾相接的多段合并成一条连续折线，也避免交叉导线被系统拆段后删不掉。
			const wires = [];

			for (const item of primitives) {
				if (item.primitiveType === 'Polyline' && item.polygon?.polygon) {
					if (mode === 1 || mode === 3) await this._convertPolyToWire(item, api);
				} else if (item.primitiveType === 'Region' && item.complexPolygon?.polygon) {
					if (mode === 1 || mode === 3) await this._convertRegionToWire(item, netMap[item.primitiveId], api);
				} else if (item.primitiveType === 'Line' || item.primitiveType === 'Arc') {
					if (mode === 2 || mode === 3) wires.push(item);
				}
			}

			if (wires.length) await this._convertWiresToPoly(wires, api);
		} catch (error) {
			console.error('导线互转出错:', error);
		}
	},

	/**
	 * 安全获取 API 配置
	 */
	async _getApiConfig() {
		return loadApiConfig(DEFAULT_API_CONFIG);
	},

	/**
	 * 通用倍率提取辅助函数
	 * @returns {number} src倍率 * target倍率
	 */
	_getScale(api, srcKey, targetKey, prop) {
		const srcScale = api[srcKey]?.[prop] ?? 1;
		const targetScale = api[targetKey]?.[prop] ?? 1;
		const value = Number(srcScale) * Number(targetScale);
		return Number.isFinite(value) && value > 0 ? value : 1;
	},

	/**
	 * 构建图元ID到Net的映射表
	 */
	_buildNetMap(detailedPrimitives) {
		const map = {};
		if (Array.isArray(detailedPrimitives)) {
			detailedPrimitives.forEach((p) => {
				if (p.globalIndex) map[p.globalIndex] = p.net || '';
			});
		}
		return map;
	},

	/**
	 * 检查是否在铜层
	 */
	_checkCopperLayer(layer, primitiveId) {
		const isCopper = isCopperLayer(layer);
		if (!isCopper) {
			eda.sys_Log.add(`当前图元 ${primitiveId} 不在铜层，不可转为导线`, 'warn');
			eda.sys_PanelControl.openBottomPanel('log');
		}
		return isCopper;
	},

	/**
	 * 按删除前的快照把原图元重建回去（创建失败的兜底）
	 *
	 * 只做「尽力而为」：重建出的图元是新 ID，但几何/网络/图层与原图元一致，
	 * 好过让用户的图元凭空消失。
	 *
	 * @param {object} item - `getAllSelectedPrimitives()` 返回的原始图元对象
	 * @param {number} [coordScale] - 坐标倍率：快照是原始值，重建时要按 create 的单位换算
	 * @param {number} [widthScale] - 线宽倍率
	 * @returns {Promise<boolean>} 是否重建成功
	 */
	async _restoreItem(item, coordScale = 1, widthScale = 1) {
		if (!item) return false;
		try {
			if (item.primitiveType === 'Polyline') {
				const res = await eda.pcb_PrimitivePolyline.create(item.net || '', item.layer, item.polygon, item.lineWidth, false);
				return !!res;
			}
			if (item.primitiveType === 'Region') {
				const res = await eda.pcb_PrimitiveRegion.create(
					item.layer,
					item.complexPolygon,
					item.ruleType || [],
					item.regionName,
					item.lineWidth,
					false,
				);
				return !!res;
			}
			if (item.primitiveType === 'Arc') {
				const res = await eda.pcb_PrimitiveArc.create(
					item.net || '',
					item.layer,
					item.startX * coordScale,
					item.startY * coordScale,
					item.endX * coordScale,
					item.endY * coordScale,
					item.arcAngle || 0,
					item.lineWidth * widthScale,
					1,
					false,
				);
				return !!res;
			}
			if (item.primitiveType === 'Line') {
				const res = await eda.pcb_PrimitiveLine.create(
					item.net || '',
					item.layer,
					item.startX * coordScale,
					item.startY * coordScale,
					item.endX * coordScale,
					item.endY * coordScale,
					item.lineWidth * widthScale,
					false,
				);
				return !!res;
			}
		} catch (e) {
			console.error(`恢复图元 ${item.primitiveId} 失败:`, e);
		}
		return false;
	},

	// ================= 核心转换逻辑 =================

	/**
	 * 线条 (Polyline) ⇒ 导线 (Line/Arc)
	 */
	async _convertPolyToWire(polyItem, api) {
		if (!this._checkCopperLayer(polyItem.layer, polyItem.primitiveId)) return;

		const arr = polyItem.polygon.polygon;
		if (!arr || arr.length < 2 || typeof arr[0] !== 'number') return;

		const coordScale = this._getScale(api, '获取折线', '创建直线', '坐标');
		const widthScale = this._getScale(api, '获取折线', '创建直线', '线宽');

		const net = polyItem.net || '';
		const layer = polyItem.layer;
		const targetWidth = polyItem.lineWidth * widthScale;

		// 先删后建：交叉导线会被系统拆段，删除必须赶在创建之前
		await eda.pcb_PrimitivePolyline.delete(polyItem.primitiveId);

		let created = 0;
		try {
			created = await this._emitLinesFromPath(arr, net, layer, targetWidth, coordScale);
			if (created === 0) throw new Error('没有生成任何导线段');
		} catch (e) {
			console.error('线条转导线失败，正在恢复原折线:', e);
			eda.sys_Message.showToastMessage('转换失败，已尝试恢复原线条', 2);
			// 删除后创建失败：把原折线按快照重建，避免图元丢失
			await this._restoreItem(polyItem);
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

		const net = overrideNet ?? regionItem.net ?? '';
		const layer = regionItem.layer;
		const targetWidth = regionItem.lineWidth * widthScale;
		const firstVal = arr[0];

		// Region 必须用 pcb_PrimitiveRegion.delete：
		// 实测 pcb_PrimitivePolyline.delete(regionId) 会返回 true 但根本没删（v1.17.6 P0-3）
		try {
			const ok = await eda.pcb_PrimitiveRegion.delete(regionItem.primitiveId);
			if (ok === false) throw new Error('删除区域失败');
		} catch (e) {
			console.warn('删除原 Region 图元失败，已中止转换:', e);
			eda.sys_Message.showToastMessage('删除原区域失败，未做转换', 2);
			return;
		}

		try {
			// --- 场景 A: 通用多边形 ---
			if (typeof firstVal === 'number') {
				if (arr.length < 2) return;
				const created = await this._emitLinesFromPath(arr, net, layer, targetWidth, coordScale);
				if (created === 0) throw new Error('没有生成任何导线段');
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
			} else if (type === 'R') {
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
				const p1_end = rotatePoint(x + w - r, y);
				const p2_end = rotatePoint(x + w, y - r);
				const p3_end = rotatePoint(x + w, y + h_vector + r);
				const p4_end = rotatePoint(x + w - r, y + h_vector);
				const p5_end = rotatePoint(x + r, y + h_vector);
				const p6_end = rotatePoint(x, y + h_vector + r);
				const p7_end = rotatePoint(x, y - r);

				if (w > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p1_start.x, p1_start.y, p1_end.x, p1_end.y, targetWidth, false);
				if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p1_end.x, p1_end.y, p2_end.x, p2_end.y, -90, targetWidth, 1, false);
				if (Math.abs(h_vector) > 2 * r)
					await eda.pcb_PrimitiveLine.create(net, layer, p2_end.x, p2_end.y, p3_end.x, p3_end.y, targetWidth, false);
				if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p3_end.x, p3_end.y, p4_end.x, p4_end.y, -90, targetWidth, 1, false);
				if (w > 2 * r) await eda.pcb_PrimitiveLine.create(net, layer, p4_end.x, p4_end.y, p5_end.x, p5_end.y, targetWidth, false);
				if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p5_end.x, p5_end.y, p6_end.x, p6_end.y, -90, targetWidth, 1, false);
				if (Math.abs(h_vector) > 2 * r)
					await eda.pcb_PrimitiveLine.create(net, layer, p6_end.x, p6_end.y, p7_end.x, p7_end.y, targetWidth, false);
				if (r > 0) await eda.pcb_PrimitiveArc.create(net, layer, p7_end.x, p7_end.y, p1_start.x, p1_start.y, -90, targetWidth, 1, false);
			}
		} catch (e) {
			console.error('区域转导线失败，正在恢复原区域:', e);
			eda.sys_Message.showToastMessage('转换失败，已尝试恢复原区域', 2);
			await this._restoreItem(regionItem);
		}
	},

	/**
	 * 遍历 path 数组并逐段发射导线（Line/Arc）
	 * 这是 Polyline 与 Region 转为导线的公共发射逻辑，消除重复代码
	 *
	 * 角度不做任何缩放：多边形路径的 `ARC` 与 `pcb_PrimitiveArc.create` 都是角度制
	 * （两版实测一致），乘任何倍率都会把圆弧画直。
	 *
	 * @param {Array} arr - 折线路径数组，格式 [x0,y0,'L',x1,y1,'ARC',angle,x,y,...]
	 * @param {string} net - 网络名
	 * @param {number} layer - 图层
	 * @param {number} targetWidth - 目标线宽
	 * @param {number} coordScale - 坐标缩放倍率
	 * @returns {Promise<number>} 实际创建的导线段数
	 */
	async _emitLinesFromPath(arr, net, layer, targetWidth, coordScale) {
		let startX = arr[0] * coordScale;
		let startY = arr[1] * coordScale;
		let currentMode = 'L';
		let i = 2;
		let count = 0;

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
				if (!Number.isFinite(endX) || !Number.isFinite(endY)) break;
				await eda.pcb_PrimitiveLine.create(net, layer, startX, startY, endX, endY, targetWidth, false);
				startX = endX;
				startY = endY;
				i += 2;
				count++;
			} else if (currentMode === 'ARC' || currentMode === 'CARC') {
				const angle = Number(arr[i]) || 0;
				const endX = arr[i + 1] * coordScale;
				const endY = arr[i + 2] * coordScale;
				if (!Number.isFinite(endX) || !Number.isFinite(endY)) break;
				await eda.pcb_PrimitiveArc.create(net, layer, startX, startY, endX, endY, angle, targetWidth, 1, false);
				startX = endX;
				startY = endY;
				i += 3;
				count++;
			} else {
				i++;
			}
		}

		return count;
	},

	/**
	 * 导线 (Line/Arc) ⇒ 折线 (Polyline)
	 *
	 * 与旧实现的区别：
	 * 1. 选中多段**首尾相接**的导线时，合并成**一条连续折线**（而不是每段一条碎折线）；
	 * 2. 先统一删除全部选中导线，再创建折线（交叉导线会被系统拆段，顺序不能反）；
	 * 3. 某条链创建失败时，用快照把那几段导线重建回去，避免「删了没建成」。
	 *
	 * 分组规则：`layer` + `net` + 线宽 完全一致才会合并 —— 跨层/跨网/不同线宽合并会改变外观。
	 *
	 * @param {Array<object>} items - 选中的 Line/Arc 图元
	 * @param {object} api - 校准配置
	 */
	async _convertWiresToPoly(items, api) {
		// 1. 归一化（缩放 + 统一字段），并记录原始图元用于回滚
		const convertible = [];
		const skipped = [];
		for (const item of items) {
			const isArc = item.primitiveType === 'Arc';
			const coordScale = this._getScale(api, isArc ? '获取弧线' : '获取直线', '创建折线', '坐标');
			const widthScale = this._getScale(api, isArc ? '获取弧线' : '获取直线', '创建折线', '线宽');
			const width = Number(item.lineWidth);
			const seg = {
				type: isArc ? 'ARC' : 'L',
				layer: item.layer,
				net: item.net || '',
				width: (Number.isFinite(width) ? width : 0) * widthScale,
				startX: item.startX * coordScale,
				startY: item.startY * coordScale,
				endX: item.endX * coordScale,
				endY: item.endY * coordScale,
				angle: isArc ? Number(item.arcAngle) || 0 : 0,
				item,
				coordScale,
				widthScale,
			};
			// 坐标异常 / 零长度的图元不参与转换，更不能先删掉
			if (isValidSegment(seg)) convertible.push(seg);
			else skipped.push(item);
		}

		if (skipped.length) {
			console.warn(
				'以下导线数据异常已跳过:',
				skipped.map((s) => s.primitiveId),
			);
			eda.sys_Log.add(`导线转线条：跳过 ${skipped.length} 条异常导线`, 'warn');
		}
		if (convertible.length === 0) return;

		// 2. 先拼链（纯计算，失败也不影响文档），再删原图元
		const chains = buildWireChains(convertible);
		if (chains.length === 0) return;

		for (const seg of convertible) {
			const item = seg.item;
			try {
				if (item.primitiveType === 'Line') await eda.pcb_PrimitiveLine.delete(item.primitiveId);
				else await eda.pcb_PrimitiveArc.delete(item.primitiveId);
			} catch (e) {
				console.warn(`删除导线 ${item.primitiveId} 失败:`, e);
			}
		}

		// 3. 逐链创建折线
		let successCount = 0;
		let failCount = 0;

		for (const chain of chains) {
			const head = chain.segments[0];
			try {
				const path = buildPolygonPath(chain.segments);
				const polyObj = eda.pcb_MathPolygon.createPolygon(path);
				if (!polyObj) throw new Error('createPolygon 返回空');
				const created = await eda.pcb_PrimitivePolyline.create(head.net || '', head.layer, polyObj, head.width, false);
				if (!created) throw new Error('创建折线失败');
				successCount++;
			} catch (e) {
				failCount++;
				console.error(`折线创建失败（${chain.segments.length} 段），正在恢复原导线:`, e);
				// 该链的每段都按快照重建，尽量不让图元消失
				for (const seg of chain.segments) await this._restoreItem(seg.item, seg.coordScale, seg.widthScale);
			}
		}

		if (failCount > 0) {
			eda.sys_Message.showToastMessage(`导线转线条：成功 ${successCount} 条，失败 ${failCount} 条（已尝试恢复）`, 3);
			eda.sys_Log.add(`导线转线条部分失败：成功 ${successCount}，失败 ${failCount}`, 'warn');
			eda.sys_PanelControl.openBottomPanel('log');
		}
	},
};
