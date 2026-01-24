/**
 * 焊盘与过孔互转工具 (Refactored)
 * * * 版本适配记录：
 * v2.2.43:
 * - Pad⇒Via: 孔径x10, 阻焊x1
 * - Via⇒Pad: 坐标x1, 外径x1, 内径/2, 阻焊x10
 * * v2.2.45:
 * - Pad⇒Via: 孔径x10, 阻焊x1
 * - Via⇒Pad: 坐标x10, 外径x10, 内径x5, 阻焊x10
 * * v3.2.69:
 * - Pad⇒Via: 孔径x10, 阻焊x10
 * - Via⇒Pad: 坐标x10, 外径x10, 内径x10, 阻焊x1
 * * v3.2.80 (新增):
 * - v3.2.69: 孔径x10, 坐标/10
 * * * 功能：
 * 1. PadToVia: 多层焊盘转过孔
 * 2. ViaToPad: 通孔过孔转焊盘
 * 3. Toggle: 自动识别互转
 */

// 获取客户端版本
const version = eda.sys_Environment.getEditorCurrentVersion();
console.log('当前EDA版本:', version);

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
            const selections = await eda.pcb_SelectControl.getAllSelectedPrimitives();
            console.log(selections);
            if (!selections || selections.length === 0) {
                console.log('未选中任何图元');
                return;
            }

            for (const item of selections) {
                // Pad ⇒ Via (仅处理通孔焊盘 layer=12)
                if (item.primitiveType === 'Pad' && item.layer === 12) {
                    if (mode === 1 || mode === 3) {
                        await this._convertPadToVia(item);
                    }
                }
                // Via ⇒ Pad (仅处理通孔过孔 type=0)
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
     * 执行：焊盘 ⇒ 过孔
     */
    async _convertPadToVia(pad) {
        console.log('开始转换焊盘到过孔:', pad);

        // --- 1. 获取原始数据 (Raw Data) ---
        // 获取外径 (取宽高最小值)
        let rawOuterDiameter = 0;
        if (Array.isArray(pad.pad) && pad.pad.length >= 3) {
            rawOuterDiameter = Math.min(pad.pad[1], pad.pad[2]);
        } else {
            return; // 数据异常，跳过
        }

        // 获取孔径 (取宽高最小值)
        let rawHoleDiameter = 0;
        if (Array.isArray(pad.hole) && pad.hole.length >= 3) {
            rawHoleDiameter = Math.min(pad.hole[1], pad.hole[2]);
        }

        // 获取阻焊
        let rawTopSolder = pad.solderMaskAndPasteMaskExpansion.topSolderMask;
        let rawBotSolder = pad.solderMaskAndPasteMaskExpansion.bottomSolderMask;


        // --- 2. 版本适配逻辑 (Switch Case) ---
        let finalHoleDiameter;
		let finalOuterDiameter;
		let finalTopSolder;
		let finalBotSolder;

        switch (version) {
            case '3.2.80':
                // 3.2.80：孔径x10，坐标/10
                finalHoleDiameter = rawHoleDiameter * 10; 
                finalOuterDiameter = rawOuterDiameter;
                finalTopSolder = rawTopSolder;
                finalBotSolder = rawBotSolder;
                pad.x = pad.x / 10;
                pad.y = pad.y / 10;
                break;

            case '3.2.69':
                // V3.2.69: 阻焊需x10, 孔径需x10
                finalHoleDiameter = rawHoleDiameter * 10;
                finalOuterDiameter = rawOuterDiameter;
                finalTopSolder = rawTopSolder * 10;
                finalBotSolder = rawBotSolder * 10;
                break;

            case '2.2.45':
            case '2.2.43':
                // V2.2.43&45: 孔径需x10, 阻焊无法设置
                finalHoleDiameter = rawHoleDiameter * 10;
                finalOuterDiameter = rawOuterDiameter;
                finalTopSolder = rawTopSolder;
                finalBotSolder = rawBotSolder;
                break;

            default:
                // 默认策略 (同最新稳定版 3.2.80 或 报错)
                console.warn(`未匹配的版本 ${version}，使用默认 V3.2.80 逻辑`);
                finalHoleDiameter = rawHoleDiameter * 10; 
                finalOuterDiameter = rawOuterDiameter;
                finalTopSolder = rawTopSolder;
                finalBotSolder = rawBotSolder;
                pad.x = pad.x / 10;
                pad.y = pad.y / 10;
                break;
        }

        // --- 3. 构造参数并创建 ---
        const solderMask = { ...pad.solderMaskAndPasteMaskExpansion };
        solderMask.topSolderMask = finalTopSolder;
        solderMask.bottomSolderMask = finalBotSolder;

        const newVia = await eda.pcb_PrimitiveVia.create(
            pad.net,
            pad.x,
            pad.y,
            finalHoleDiameter,
            finalOuterDiameter,
            0,
            null,
            solderMask,
            false
        );

        if (newVia) {
            await eda.pcb_PrimitivePad.delete(pad.primitiveId);
        }
    },

    /**
     * 执行：过孔 ⇒ 焊盘
     */
    async _convertViaToPad(via) {
        console.log('开始转换过孔到焊盘:', via);

        // --- 1. 获取原始数据 (Raw Data) ---
        const rawX = via.x;
        const rawY = via.y;
        const rawShapeSize = via.diameter;      // 外径
        const rawHoleSize = via.holeDiameter;   // 内径
        let rawTopSolder;
		let rawBotSolder;
        let isSolderNull = false;

        // 特殊处理：若阻焊为null，标记并设为默认值，后续不再进行倍率乘除
        if (via.solderMaskExpansion === null) {
            console.log('检测到阻焊扩展为null，强制设为 -1000');
            isSolderNull = true;
            rawTopSolder = -1000;
            rawBotSolder = -1000;
        } else {
            rawTopSolder = via.solderMaskExpansion.topSolderMask;
            rawBotSolder = via.solderMaskExpansion.bottomSolderMask;
        }

        // --- 2. 版本适配逻辑 (Switch Case) ---
        let finalX;
		let finalY;
		let finalShapeSize;
		let finalHoleSize;
		let finalTopSolder;
		let finalBotSolder;

        switch (version) {
            case '3.2.80':
                finalX = rawX;
                finalY = rawY;
                finalShapeSize = rawShapeSize;
                finalHoleSize = rawHoleSize;
                break;

            case '3.2.69':
                // V3.2.69: 坐标x10, 外径x10, 内径x10
                finalX = rawX * 10;
                finalY = rawY * 10;
                finalShapeSize = rawShapeSize * 10;
                finalHoleSize = rawHoleSize * 10;
                break;

            case '2.2.45':
                // V2.2.45: 坐标x10, 外径x10, 内径x5
                finalX = rawX * 10;
                finalY = rawY * 10;
                finalShapeSize = rawShapeSize * 10;
                finalHoleSize = rawHoleSize * 5;
                break;

            case '2.2.43':
                // V2.2.43: 坐标正常, 外径正常, 内径/2
                finalX = rawX;
                finalY = rawY;
                finalShapeSize = rawShapeSize;
                finalHoleSize = rawHoleSize / 2;
                break;

            default:
                // 默认使用 3.2.80 逻辑
                console.warn(`未匹配的版本 ${version}，使用默认 V3.2.80 逻辑`);
                finalX = rawX;
                finalY = rawY;
                finalShapeSize = rawShapeSize;
                finalHoleSize = rawHoleSize;
                break;
        }

        if (isSolderNull) {
            finalTopSolder = -1000;
            finalBotSolder = -1000;
        } else {
            finalTopSolder = rawTopSolder;
            finalBotSolder = rawBotSolder;
        }


        // --- 3. 构造形状参数 ---
        // 构造 PadShape: ['ELLIPSE', width, height]
        const padShape = ['ELLIPSE', finalShapeSize, finalShapeSize];
        // 构造 HoleShape: ['ROUND', diameter, diameter]
        const holeShape = ['ROUND', finalHoleSize, finalHoleSize];

        // 构造阻焊对象
        const solderMask = {
            topSolderMask: finalTopSolder,
            bottomSolderMask: finalBotSolder,
            topPasteMask: isSolderNull ? 0 : via.solderMaskExpansion?.topPasteMask || 0,
            bottomPasteMask: isSolderNull ? 0 : via.solderMaskExpansion?.bottomPasteMask || 0,
        };

        // --- 4. 创建焊盘 ---
        const newPad = await eda.pcb_PrimitivePad.create(
            12,             // layer
            '1',            // net name placeholder
            finalX,
            finalY,
            0,              // rotation
            padShape,
            via.net,        // net
            holeShape,
            0, 0, 0,        // thermal info
            true,           // plated
            0,              // text info
            [],             // points
            solderMask,
            null,
            false
        );

        if (newPad) {
            console.log('焊盘创建成功');
            await eda.pcb_PrimitiveVia.delete(via.primitiveId);
        } else {
            console.error('焊盘创建失败');
        }
    },
};
