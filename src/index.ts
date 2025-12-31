/**
 * 入口文件
 *
 * 本文件为默认扩展入口文件，如果你想要配置其它文件作为入口文件，
 * 请修改 `extension.json` 中的 `entry` 字段；
 *
 * 请在此处使用 `export`  导出所有你希望在 `headerMenus` 中引用的方法，
 * 方法通过方法名与 `headerMenus` 关联。
 *
 * 如需了解更多开发细节，请阅读：
 * https://prodocs.lceda.cn/cn/api/guide/
 */
import * as extensionConfig from '../extension.json';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {

}
// 从PCB网表在原理图放置器件
export async function NetlistToSchematicPCB() {
    const { placeComponentsEfficiently } = await import('./js/NetlistToSchematic');
    await placeComponentsEfficiently("PCB");
}
// 从网表文件在原理图放置器件
export async function NetlistToSchematicNET() {
    const { placeComponentsEfficiently } = await import('./js/NetlistToSchematic');
    await placeComponentsEfficiently("NET");
}

// 从PCB获取引脚信息放置导线
export async function AutoWirePlacerPCB() {
    const { placeWires } = await import('./js/AutoWirePlacer');
    await placeWires("PCB");
}
// 从网表获取引脚信息放置导线
export async function AutoWirePlacerNET() {
    const { placeWires } = await import('./js/AutoWirePlacer');
    await placeWires("NET");
}
// 清除PCB多余属性
export async function ClearEmptySupplierPropertiesPCB() {
    const { ClearEmptySupplierProperties } = await import('./js/ClearEmptySupplierProperties');
    await ClearEmptySupplierProperties("PCB");
}
// 清除SCH多余属性
export async function ClearEmptySupplierPropertiesSCH() {
    const { ClearEmptySupplierProperties } = await import('./js/ClearEmptySupplierProperties');
    await ClearEmptySupplierProperties("SCH");
}
// 位号查重
export async function CheckDesignators() {
    const { checkDuplicateDesignators } = await import('./js/CheckDesignators');
    await checkDuplicateDesignators();
}
// 从网表恢复3D模型
export async function NetlistUpdate3DModels() {
    const { update3DModelsFromNetlist } = await import('./js/NetlistUpdate3DModels');
    await update3DModelsFromNetlist();
}

// 焊盘 ⇒ 过孔
export async function PadToVia() {
    const module = await import('./js/PadViaConverter');
    await module.PadViaConverter.toVia();
}
// 过孔 ⇒ 焊盘
export async function ViaToPad() {
    const module = await import('./js/PadViaConverter');
    await module.PadViaConverter.toPad();
}
// 焊盘 ⇄ 过孔
export async function PadViaToggle() {
    const module = await import('./js/PadViaConverter');
    await module.PadViaConverter.toggle();
}

// 线条 ⇒ 导线
export async function PolylinetoWire() {
    const module = await import('./js/WireConverter');
    await module.WireConverter.toWire();
}
// 导线 ⇒ 线条
export async function WiretoPolyline() {
    const module = await import('./js/WireConverter');
    await module.WireConverter.toPolyline();
}
// 导线 ⇄ 线条
export async function WirePolylinetoggle() {
    const module = await import('./js/WireConverter');
    await module.WireConverter.toggle();
}




// 批量修改网络
export async function NetReplace() {
	eda.sys_IFrame.openIFrame("/iframe/NetReplace.html", 470, 640, "NetReplace");
}
// 批量替换器件
export async function ReplaceComponent() {
	eda.sys_IFrame.openIFrame("/iframe/ReplaceComponent.html", 1280, 720, "ReplaceComponent");
}
// 导入图片
export async function ImportImage() {
	eda.sys_IFrame.openIFrame("/iframe/ImportImage.html", 960, 680, "ImportImage");
}
// 导入BOM
export async function ImportBom() {
	eda.sys_IFrame.openIFrame("/iframe/ImportBom.html", 1280, 720, "ImportBom");
}
// 导入二维码
export async function ImportQrcode() {
	eda.sys_IFrame.openIFrame("/iframe/ImportQrcode.html", 540, 640, "ImportQrcode");
}
//丝印代码转换
export function CodeConvert() {
	eda.sys_IFrame.openIFrame("/iframe/CodeConvert.html", 720, 640, "CodeConvert");
}
//关于
export function About() {
	eda.sys_IFrame.openIFrame("/iframe/About.html", 540, 720, "About");
}
