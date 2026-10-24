/**
 * 焊盘与过孔互转工具 (Refactored)
 * * 核心机制：通过读取本地存储的 API 校准数据，动态处理图元转换时的尺寸/坐标倍率缩放。
 * 功能：
 * 1. PadToVia: 选中的通孔焊盘 转 过孔
 * 2. ViaToPad: 选中的通孔过孔 转 焊盘
 * 3. Toggle: 根据选中类型自动互相转换
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { loadApiConfig } from './common/apiConfig.js';
import { LAYER, MASK_DEFAULT_EXPANSION, isThroughHoleLayer } from './common/pcbConstants.js';

// 默认 API 配置兜底（防止用户首次使用时没有本地缓存导致 JSON 解析报错）
const DEFAULT_API_CONFIG = {
	'创建过孔': { '坐标': 1, '内径': 1, '外径': 1, '阻焊': 1 },
	'创建焊盘': { '坐标': 1, '内径': 1, '外径': 1, '阻焊': 1 },
	'获取过孔': { '坐标': 1, '内径': 1, '外径': 1, '阻焊': 1 },
	'获取焊盘': { '坐标': 1, '内径': 1, '外径': 1, '阻焊': 1 },
};

export const PadViaConverter = {
	// 1. 转为过孔
	async toVia() {
		await this._process(1);
	},

	// 2. 转为焊盘
	async toPad() {
		await this._process(2);
	},

	// 3. 互相转换
	async toggle() {
		await this._process(3);
	},

	/**
	 * 内部处理核心逻辑
	 */
	async _process(mode) {
		try {
			// 1. 安全读取并解析 API 校准配置（复用公共工具，解析失败回退默认 1:1）
			const api = await loadApiConfig(DEFAULT_API_CONFIG);

			// 2. 获取当前选中的图元
			const selections = await eda.pcb_SelectControl.getAllSelectedPrimitives();
			if (!selections || selections.length === 0) {
				console.log('未选中任何图元');
				return;
			}

			// 3. 遍历分发处理
			for (const item of selections) {
				// Pad ⇒ Via (仅处理通孔焊盘，即落在 MULTI(12) 层的焊盘)
				if (item.primitiveType === 'Pad' && isThroughHoleLayer(item.layer)) {
					if (mode === 1 || mode === 3) {
						await this._convertPadToVia(item, api);
					}
				}
				// Via ⇒ Pad (仅处理通孔过孔 viaType = 0)
				else if (item.primitiveType === 'Via' && item.viaType === 0) {
					if (mode === 2 || mode === 3) {
						await this._convertViaToPad(item, api);
					}
				}
			}
		} catch (error) {
			console.error('图元转换调度出错:', error);
		}
	},

	/**
	 * 执行：焊盘 ⇒ 过孔
	 */
	async _convertPadToVia(pad, api) {
		console.log('开始转换焊盘到过孔:', pad);

		// --- 1. 解析原始尺寸 (取宽高最小值) ---
		if (!Array.isArray(pad.pad) || pad.pad.length < 3) return; // 数据异常跳过
		const rawOuterDiameter = Math.min(pad.pad[1], pad.pad[2]);
		const rawHoleDiameter = Array.isArray(pad.hole) && pad.hole.length >= 3 ? Math.min(pad.hole[1], pad.hole[2]) : 0;

		// --- 2. 提取校准缩放系数 ---
		const coordScale = (api['获取焊盘']?.['坐标'] ?? 1) * (api['创建过孔']?.['坐标'] ?? 1);
		const outerScale = (api['获取焊盘']?.['外径'] ?? 1) * (api['创建过孔']?.['外径'] ?? 1);
		const holeScale = (api['获取焊盘']?.['内径'] ?? 1) * (api['创建过孔']?.['内径'] ?? 1);
		const solderScale = (api['获取焊盘']?.['阻焊'] ?? 1) * (api['创建过孔']?.['阻焊'] ?? 1);

		// --- 3. 构造阻焊参数 (安全处理 Null) ---
		let targetSolderMask = {
			topSolderMask: MASK_DEFAULT_EXPANSION,
			bottomSolderMask: MASK_DEFAULT_EXPANSION,
			topPasteMask: 0,
			bottomPasteMask: 0,
		};
		if (pad.solderMaskAndPasteMaskExpansion) {
			targetSolderMask = { ...pad.solderMaskAndPasteMaskExpansion };
			targetSolderMask.topSolderMask *= solderScale;
			targetSolderMask.bottomSolderMask *= solderScale;
		}

		// --- 4. 创建过孔并删除原焊盘 ---
		const newVia = await eda.pcb_PrimitiveVia.create(
			pad.net,
			pad.x * coordScale, // 坐标 X
			pad.y * coordScale, // 坐标 Y
			rawHoleDiameter * holeScale, // 内径
			rawOuterDiameter * outerScale, // 外径
			0,
			null,
			targetSolderMask,
			false,
		);

		if (newVia) {
			console.log('过孔创建成功');
			await eda.pcb_PrimitivePad.delete(pad.primitiveId);
		}
	},

	/**
	 * 执行：过孔 ⇒ 焊盘
	 */
	async _convertViaToPad(via, api) {
		console.log('开始转换过孔到焊盘:', via);

		// --- 1. 提取校准缩放系数 ---
		const coordScale = (api['获取过孔']?.['坐标'] ?? 1) * (api['创建焊盘']?.['坐标'] ?? 1);
		const outerScale = (api['获取过孔']?.['外径'] ?? 1) * (api['创建焊盘']?.['外径'] ?? 1);
		const holeScale = (api['获取过孔']?.['内径'] ?? 1) * (api['创建焊盘']?.['内径'] ?? 1);
		const solderScale = (api['获取过孔']?.['阻焊'] ?? 1) * (api['创建焊盘']?.['阻焊'] ?? 1);

		// --- 2. 构造阻焊参数 (安全处理 Null) ---
		let targetTopSolder = MASK_DEFAULT_EXPANSION;
		let targetBotSolder = MASK_DEFAULT_EXPANSION;
		const hasSolder = via.solderMaskExpansion !== null;

		if (hasSolder) {
			targetTopSolder = via.solderMaskExpansion.topSolderMask * solderScale;
			targetBotSolder = via.solderMaskExpansion.bottomSolderMask * solderScale;
		}

		const targetSolderMask = {
			topSolderMask: targetTopSolder,
			bottomSolderMask: targetBotSolder,
			topPasteMask: hasSolder ? targetTopSolder || 0 : 0,
			bottomPasteMask: hasSolder ? targetBotSolder || 0 : 0,
		};

		// --- 3. 构造形状与最终尺寸 ---
		const finalOuterSize = via.diameter * outerScale;
		const finalHoleSize = via.holeDiameter * holeScale;
		const padShape = ['ELLIPSE', finalOuterSize, finalOuterSize];
		const holeShape = ['ROUND', finalHoleSize, finalHoleSize];

		// --- 4. 创建焊盘并删除原过孔 ---
		const newPad = await eda.pcb_PrimitivePad.create(
			LAYER.MULTI,
			'1', // layer(多层/通孔), 默认网格名
			via.x * coordScale, // 坐标 X
			via.y * coordScale, // 坐标 Y
			0,
			padShape,
			via.net,
			holeShape, // 旋转角度, 外形, 网络, 孔形
			0,
			0,
			0,
			true,
			0,
			[], // 散热/电镀/文本等属性
			targetSolderMask,
			null,
			false,
		);

		if (newPad) {
			console.log('焊盘创建成功');
			await eda.pcb_PrimitiveVia.delete(via.primitiveId);
		}
	},
};
