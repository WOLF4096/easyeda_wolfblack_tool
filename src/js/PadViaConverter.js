
/**
 * 焊盘与过孔互转工具
 * v2版本特调：
 * 1. 焊盘外径不正确需要x10
 * 2. 焊盘内径设置异常需要/2
 * 3. v2版本无法应用阻焊扩展
 * v3版本特调：
 * 1. 获取过孔的坐标、外径需要x10
 * 功能：
 * 1. PadToVia: 多层焊盘转过孔 (长圆形/槽孔取小值作为直径)
 * 2. ViaToPad: 通孔过孔转焊盘
 * 3. Toggle: 自动识别互转
 */


//获取客户端版本
const version = eda.sys_Environment.getEditorCurrentVersion();
console.log('当前EDA版本:', version); // 返回2.x.2或3.x.x，获取失败默认2.x.x

// 版本检测函数
function isV3Version(versionStr) {
    return versionStr && versionStr.startsWith('3.');
}
const isV3 = isV3Version(version);

export const PadViaConverter = {
    // 1. 转为过孔 (供菜单调用)
    async toVia() {
        await this._process(1);
    },

    // 2. 转为焊盘 (供菜单调用)
    async toPad() {
        await this._process(2);
    },

    // 3. 互相转换 (供菜单调用)
    async toggle() {
        await this._process(3);
    },

    /**
     * 内部处理核心逻辑
     * @param {number} mode - 1:Pad转Via, 2:Via转Pad, 3:互转
     */
    async _process(mode) {
        try {
            // 【修正点】必须加await，因为返回值是Promise
            const selections = await eda.pcb_SelectControl.getAllSelectedPrimitives();
            console.log('选中的图元:', selections);
            
            if (!selections || selections.length === 0) {
                console.log("未选中任何图元");
                // 可以替换为EDA提供的提示框: eda.ui.showMessage("请先选择焊盘或过孔");
                return;
            }

            // 遍历处理所有选中的图元
            for (const item of selections) {
                // 情况A：焊盘转过孔 (仅处理Layer 12多层焊盘)
                if (item.primitiveType === "Pad" && item.layer === 12) {
                    if (mode === 1 || mode === 3) {
                        await this._convertPadToVia(item);
                    }
                }
                // 情况B：过孔转焊盘 (仅处理viaType 0通孔)
                else if (item.primitiveType === "Via" && item.viaType === 0) {
                    if (mode === 2 || mode === 3) {
                        await this._convertViaToPad(item);
                    }
                } else {
                    console.log(`跳过不支持的图元类型: ${item.primitiveType}`);
                }
            }
        } catch (error) {
            console.error("图元转换出错:", error);
        }
    },

    /**
     * 执行：焊盘 -> 过孔
     */
    async _convertPadToVia(pad) {
        console.log('开始转换焊盘到过孔:', pad);
        
        // 1. 计算外径：取宽高中较小的值 (处理椭圆/长圆/槽孔)
        // pad.pad结构通常为["SHAPE", width, height]
        let outerDiameter = 0;
        if (Array.isArray(pad.pad) && pad.pad.length >= 3) {
            outerDiameter = Math.min(pad.pad[1], pad.pad[2]);
            console.log(`焊盘原始尺寸: ${pad.pad[1]} x ${pad.pad[2]}, 外径取: ${outerDiameter}`);
        } else {
            console.error("焊盘形状数据异常:", pad.pad);
            return; // 数据异常不处理
        }

        // 2. 计算孔径
        let holeDiameter = 0;
        if (Array.isArray(pad.hole) && pad.hole.length >= 3) {
            holeDiameter = Math.min(pad.hole[1], pad.hole[2]);
            console.log(`焊盘孔尺寸: ${pad.hole[1]} x ${pad.hole[2]}, 孔径取: ${holeDiameter}`);
        } else {
            console.log('焊盘无孔或孔数据异常，按无孔处理');
        }

        // 3. 适配版本Bug: 处理阻焊扩展
        const solderMask = { ...pad.solderMaskAndPasteMaskExpansion };
        
        if (isV3) {
            // v3版本Bug修复: 阻焊获取不正确需要x10
            console.log('V3版本: 阻焊扩展值需要x10');
            solderMask.bottomSolderMask *= 10;
            solderMask.topSolderMask *= 10;
        }
        console.log('处理后的阻焊扩展:', solderMask);

        // 4. 创建过孔参数计算
        const finalHoleDiameter = holeDiameter * 10; // 俩个版本需要x10
        const finalOuterDiameter = outerDiameter; // 目前正常
        
        console.log(`创建过孔参数: 位置(${pad.x}, ${pad.y}), 孔径${finalHoleDiameter}, 外径${finalOuterDiameter}`);

        // 5. 创建过孔
        const newVia = await eda.pcb_PrimitiveVia.create(
            pad.net,               // 网络
            pad.x,                 // X坐标
            pad.y,                 // Y坐标
            finalHoleDiameter,     // 孔径
            finalOuterDiameter,    // 外径
            0,                     // Via Type 0 (通孔)
            null,                  // 盲埋孔名称
            solderMask,            // 阻焊设置 (已适配版本)
            false                  // 锁定状态
        );

        // 6. 删除旧焊盘
        if (newVia) {
            console.log('过孔创建成功，删除原焊盘');
            await eda.pcb_PrimitivePad.delete(pad.primitiveId);
        } else {
            console.error('过孔创建失败');
        }
    },

    /**
     * 执行：过孔 -> 焊盘
     */
    async _convertViaToPad(via) {
        console.log('开始转换过孔到焊盘:', via);
        
        // 1. 获取过孔尺寸
        let shapeSize = via.diameter;      // 外径
        let holeSize = via.holeDiameter;   // 孔径
        
        console.log(`过孔原始尺寸: 外径${shapeSize}, 孔径${holeSize}`);

        // 2. 适配版本Bug: 处理坐标和尺寸
        let x = via.x;
        let y = via.y;
        
        if (isV3) {
            // v3版本Bug修复: 获取过孔的坐标、外径不对，需要x10
            console.log('V3版本: 坐标和外径需要x10');
            x *= 10;
            y *= 10;
            shapeSize *= 10;
        }
        
        // 3. 适配版本Bug: 处理阻焊扩展
        const solderMask = { ...via.solderMaskExpansion };
        
        if (!isV3) {
            // v2版本Bug修复: 阻焊获取不正确需要x10，目前无法应用阻焊扩展，万一修复了呢
            console.log('V2版本: 阻焊扩展值需要x10');
            solderMask.bottomSolderMask *= 10;
            solderMask.topSolderMask *= 10;
        }
        console.log('处理后的阻焊扩展:', solderMask);

        // 4. 构造焊盘参数
        let padShape, holeShape;
        
        if (isV3) {
            // v3版本: 需要x10
            padShape = ["ELLIPSE", shapeSize, shapeSize];
            holeShape = ["ROUND", holeSize * 10, holeSize * 10];
            console.log(`V3版本: 焊盘形状${padShape}, 孔形状${holeShape}`);
        } else {
            // v2版本: 外径不需要处理，内径需要/2
            padShape = ["ELLIPSE", shapeSize, shapeSize];
            holeShape = ["ROUND", holeSize / 2, holeSize / 2];
            console.log(`V2版本: 焊盘形状${padShape}, 孔形状${holeShape}(内径/2)`);
        }

        // 5. 创建焊盘
        const newPad = await eda.pcb_PrimitivePad.create(
            12,                  // layer: 12 (多层)
            "1",                 // padNumber: 默认编号"1"
            x,                   // X坐标 (已适配版本)
            y,                   // Y坐标 (已适配版本)
            0,                   // rotation
            padShape,            // pad形状 (已适配版本)
            via.net,             // 网络
            holeShape,           // 孔形状 (已适配版本)
            0,                   // holeOffsetX
            0,                   // holeOffsetY
            0,                   // holeRotation
            true,                // metallization (过孔默认金属化)
            0,                   // padType: 1 (常规)
            [],                  // specialPad
            solderMask,          // 阻焊设置 (已适配版本)
            null,                // heatWelding
            false                // primitiveLock
        );

        // 6. 删除旧过孔
        if (newPad) {
            console.log('焊盘创建成功，删除原过孔');
            await eda.pcb_PrimitiveVia.delete(via.primitiveId);
        } else {
            console.error('焊盘创建失败');
        }
    }
};

// ================= 使用示例 =================

// 方法1：转为焊盘
// PadViaConverter.toPad();

// 方法2：转为过孔
// PadViaConverter.toVia();

// 方法3：互相转换 (推荐绑定到快捷键)
// PadViaConverter.toggle();