/**
 * 焊盘与过孔互转工具
 * * 版本适配记录：
 * v2.2.43:
 * - Pad转Via: 正常
 * - Via转Pad: 阻焊需x10, 内径需/2
 * v2.2.45:
 * - Via转Pad: 坐标x10, 外径x10, 内径x5, 阻焊x10
 * v3.2.69:
 * - Pad转Via: 阻焊需x10, 孔径需x10
 * - Via转Pad: 坐标x10, 孔径x10
 * - 特殊: 若Via阻焊为null, 强制设为-1000
 *
 * * 功能：
 * 1. PadToVia: 多层焊盘转过孔
 * 2. ViaToPad: 通孔过孔转焊盘
 * 3. Toggle: 自动识别互转
 */

//获取客户端版本
const version = eda.sys_Environment.getEditorCurrentVersion();
console.log('当前EDA版本:', version); // 返回值 2.2.43或2.2.45或3.2.69

// 版本检测函数
function isV3Version(versionStr) {
	return versionStr && versionStr.startsWith('3.');
}

function isV2_2_45_Version(versionStr) {
	return versionStr && versionStr.includes('2.2.45');
}

const isV3 = isV3Version(version);
const isV2_45 = isV2_2_45_Version(version);

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
	 * @param {number} mode - 1:Pad转Via, 2:Via转Pad, 3:互转
	 */
	async _process(mode) {
		try {
			const selections = await eda.pcb_SelectControl.getAllSelectedPrimitives();

			if (!selections || selections.length === 0) {
				console.log('未选中任何图元');
				return;
			}

			for (const item of selections) {
				// Pad -> Via
				if (item.primitiveType === 'Pad' && item.layer === 12) {
					if (mode === 1 || mode === 3) {
						await this._convertPadToVia(item);
					}
				}
				// Via -> Pad
				else if (item.primitiveType === 'Via' && item.viaType === 0) {
					if (mode === 2 || mode === 3) {
						await this._convertViaToPad(item);
					}
				}
			}
		} catch (error) {
			console.error('图元转换出错:', error);
		}
	},

	/**
	 * 执行：焊盘 -> 过孔
	 */
	async _convertPadToVia(pad) {
		console.log('开始转换焊盘到过孔:', pad);

		// 1. 计算外径
		let outerDiameter = 0;
		if (Array.isArray(pad.pad) && pad.pad.length >= 3) {
			outerDiameter = Math.min(pad.pad[1], pad.pad[2]);
		} else {
			return;
		}

		// 2. 计算孔径
		let holeDiameter = 0;
		if (Array.isArray(pad.hole) && pad.hole.length >= 3) {
			holeDiameter = Math.min(pad.hole[1], pad.hole[2]);
		}

		// 3. 阻焊处理
		const solderMask = { ...pad.solderMaskAndPasteMaskExpansion };

		if (isV3) {
			// v3 Pad转Via bug: 阻焊需x10
			solderMask.bottomSolderMask *= 10;
			solderMask.topSolderMask *= 10;
		}

		// 4. 尺寸处理
		const finalHoleDiameter = holeDiameter * 10; // 统一x10
		const finalOuterDiameter = outerDiameter;

		// 5. 创建过孔
		const newVia = await eda.pcb_PrimitiveVia.create(pad.net, pad.x, pad.y, finalHoleDiameter, finalOuterDiameter, 0, null, solderMask, false);

		// 6. 删除旧焊盘
		if (newVia) {
			await eda.pcb_PrimitivePad.delete(pad.primitiveId);
		}
	},

	/**
	 * 执行：过孔 -> 焊盘
	 */
	async _convertViaToPad(via) {
		console.log('开始转换过孔到焊盘:', via);

		// 1. 获取尺寸
		let shapeSize = via.diameter;
		let holeSize = via.holeDiameter;

		// 2. 坐标与尺寸预处理 (Bug适配)
		let x = via.x;
		let y = via.y;

		// V3 和 V2.2.45 的坐标都需要 x10
		if (isV3 || isV2_45) {
			x *= 10;
			y *= 10;
		}

		// V3 读取到的外径偏小，需要 x10
		if (isV3) {
			shapeSize *= 10;
		}

		// 3. 阻焊处理 (本次修改核心)
		let solderMask = {};

		if (via.solderMaskExpansion === null) {
			// 【新增需求】如果源数据为null，强制设为 -1000
			console.log('检测到阻焊扩展为null，强制设为 -1000');
			solderMask = {
				topSolderMask: -1000,
				bottomSolderMask: -1000,
				topPasteMask: 0,
				bottomPasteMask: 0,
			};
			// 注意：这里手动设定了值，因此跳过下方的倍率处理，防止 -1000 变成 -10000
		} else {
			// 正常拷贝
			solderMask = { ...via.solderMaskExpansion };

			// 旧 V2 版本 Bug: 阻焊需 x10
			// V2.2.45 版本 Bug: 阻焊也需 x10
			if (!isV3) {
				console.log('V2系版本: 阻焊扩展值 x10');
				solderMask.bottomSolderMask *= 10;
				solderMask.topSolderMask *= 10;
			}
		}

		// 4. 构造形状参数
		let padShape, holeShape;

		if (isV3) {
			// V3.2.69: 外径正常，内径 x10
			padShape = ['ELLIPSE', shapeSize, shapeSize];
			holeShape = ['ROUND', holeSize * 10, holeSize * 10];
		} else if (isV2_45) {
			// V2.2.45: 外径x10，内径x5
			padShape = ['ELLIPSE', shapeSize * 10, shapeSize * 10];
			holeShape = ['ROUND', holeSize * 5, holeSize * 5];
		} else {
			// V2.2.43: 外径正常，内径 /2
			padShape = ['ELLIPSE', shapeSize, shapeSize];
			holeShape = ['ROUND', holeSize / 2, holeSize / 2];
		}

		// 5. 创建焊盘
		const newPad = await eda.pcb_PrimitivePad.create(
			12,
			'1',
			x,
			y,
			0,
			padShape,
			via.net,
			holeShape,
			0,
			0,
			0,
			true,
			0,
			[],
			solderMask,
			null,
			false,
		);

		// 6. 删除旧过孔
		if (newPad) {
			console.log('焊盘创建成功');
			await eda.pcb_PrimitiveVia.delete(via.primitiveId);
		} else {
			console.error('焊盘创建失败');
		}
	},
};
