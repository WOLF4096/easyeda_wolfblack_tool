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
export function activate(status?: 'onStartupFinished', arg?: string): void {}

// PCB转SCH
export async function PcbToSch() {
	eda.sys_IFrame.openIFrame('/iframe/PcbToSch.html', 640, 540, 'tosch');
}

// 从PCB获取引脚信息放置导线
export async function AutoWirePlacerPCB() {
	const { placeWires } = await import('./js/AutoWirePlacer');
	await placeWires('PCB');
}

// 从网表获取引脚信息放置导线
export async function AutoWirePlacerNET() {
	const { placeWires } = await import('./js/AutoWirePlacer');
	await placeWires('NET');
}

// 清除属性
export async function ClearEmptySupplierProperties() {
	eda.sys_IFrame.openIFrame('/iframe/ClearEmptyProperties.html', 800, 480, 'ClearEmptyProperties');
}

// 刷新网表
export async function RefreshNetlist() {
	const { RefreshNetlist } = await import('./js/RefreshNetlist');
	await RefreshNetlist();
}

// 位号查重
export async function CheckDesignators() {
	const { checkDuplicateDesignators } = await import('./js/CheckDesignators');
	await checkDuplicateDesignators();
}

// 3D模型批量更新与恢复
export async function NetlistUpdate3DModels() {
	eda.sys_IFrame.openIFrame('/iframe/NetlistUpdate3DModels.html', 960, 480, 'NetlistUpdate3DModels');
}

// // 焊盘 ⇒ 过孔
// export async function PadToVia() {
// 	const module = await import('./js/PadViaConverter');
// 	await module.PadViaConverter.toVia();
// }
// // 过孔 ⇒ 焊盘
// export async function ViaToPad() {
// 	const module = await import('./js/PadViaConverter');
// 	await module.PadViaConverter.toPad();
// }
// 焊盘 ⇄ 过孔
export async function PadViaToggle() {
	const module = await import('./js/PadViaConverter');
	await module.PadViaConverter.toggle();
}

// // 线条 ⇒ 导线
// export async function PolylinetoWire() {
// 	const module = await import('./js/WireConverter');
// 	await module.WireConverter.toWire();
// }
// // 导线 ⇒ 线条
// export async function WiretoPolyline() {
// 	const module = await import('./js/WireConverter');
// 	await module.WireConverter.toPolyline();
// }
// 导线 ⇄ 线条
export async function WirePolylinetoggle() {
	const module = await import('./js/WireConverter');
	await module.WireConverter.toggle();
}
// 填充 ⇄ 图片
export async function RegionImageConverter() {
	const module = await import('./js/RegionImageConverter');
	await module.ImageFillConverter.toggle();
}

// 创建封装
export async function CreateFootprint() {
	eda.sys_IFrame.openIFrame('/iframe/CreateFootprint.html', 300, 100, 'CreateFootprint');
}

// 批量修改网络
export async function NetReplace() {
	eda.sys_IFrame.openIFrame('/iframe/NetReplace.html', 470, 640, 'NetReplace');
}

// 批量替换器件
export async function ReplaceComponent() {
	eda.sys_IFrame.openIFrame('/iframe/ReplaceComponent.html', 810, 480, 'ReplaceComponent');
}

// 导入图片
export async function ImportImage() {
	eda.sys_IFrame.openIFrame('/iframe/ImportImage.html', 860, 540, 'ImportImage');
}

// 导入BOM
export async function ImportBom() {
	eda.sys_IFrame.openIFrame('/iframe/ImportBom.html', 1024, 540, 'ImportBom');
}

// 导入二维码
export async function ImportQrcode() {
	eda.sys_IFrame.openIFrame('/iframe/ImportQrcode.html', 820, 700, 'ImportQrcode');
}

// 导入Gerber
// export async function ImportGerber() {
// 	eda.sys_IFrame.openIFrame('/iframe/ImportGerber.html', 1280, 800, 'ImportGerber');
// }

// 丝印代码转换
export function CodeConvert() {
	eda.sys_IFrame.openIFrame('/iframe/CodeConvert.html', 540, 540, 'CodeConvert');
}

// 工作时间统计 - 前端界面
export async function WorkingHours() {
	eda.sys_IFrame.openIFrame('/iframe/WorkingHours.html', 540, 680, 'WorkingHours');
}
// 工作时间统计 - 后台记录
export async function WorkingHoursJs() {
	const module = await import('./js/WorkingHours');
	await module.WorkingHours();
}

// 生成物理网络
export async function GenerateNet() {
	eda.sys_IFrame.openIFrame('/iframe/GenerateNet.html', 540, 540, 'GenerateNet');
}

// 导入 AD 网表
export async function InADNetlist() {
	eda.sys_IFrame.openIFrame('/iframe/InADNetlist.html', 540, 540, 'InADNetlist');
}

// 导出引脚网络
export async function OutPinNet() {
	eda.sys_IFrame.openIFrame('/iframe/OutPinNet.html', 540, 540, 'OutPinNet');
}

// 批量修改网络
export async function ModifyNet() {
	eda.sys_IFrame.openIFrame('/iframe/ModifyNet.html', 540, 540, 'ModifyNet');
}

// 导出工程文件
// export async function ExportFile() {
// 	eda.sys_IFrame.openIFrame('/iframe/ExportFile.html', 600, 600, 'ExportFile');
// }

// API基准测试
export function APITest() {
	eda.sys_IFrame.openIFrame('/iframe/APITest.html', 512, 640, 'APITest');
}
// 关于
export function About() {
	eda.sys_IFrame.openIFrame('/iframe/About.html', 860, 720, 'About');
}

// 启动软件时执行
const INIT_FLAG_KEY = `__EXTENSION_${extensionConfig.name}_INITIALIZED__`;
if (!globalThis[INIT_FLAG_KEY]) {
	console.log(`======= [${extensionConfig.name}] 插件首次加载，执行初始化 =======`);
	WorkingHoursJs(); // 后台记录工作时间
	globalThis[INIT_FLAG_KEY] = true;

}


// 注册快捷键
// 检测版本
let editorVersion = '2.2.x';
try {
	editorVersion = eda.sys_Environment.getEditorCurrentVersion() || '2.2.x';
} catch (e) {}
console.log(`[系统] 检测到编辑器版本: ${editorVersion}`);

// 条件判断：只支持V3版本，V2版本不支持快捷键
if (editorVersion.trim().startsWith('3.')) {
	// 导入图片
	eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Shift+C']);
	eda.sys_ShortcutKey.registerShortcutKey(
		['Ctrl+Shift+C'],'导入图片',
		() => ImportImage(),[4],[1, 2, 3, 4, 5]
	);
	// 位号查重
	// eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Alt+W']);
	// eda.sys_ShortcutKey.registerShortcutKey(
	// 	['Ctrl+Alt+W'],'位号查重',
	// 	() => CheckDesignators(),[4],[1, 2, 3, 4, 5]
	// );
	// 导线 ⇄ 线条
	eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Shift+X']);
	eda.sys_ShortcutKey.registerShortcutKey(
		['Ctrl+Shift+X'],'导线 ⇄ 线条',
		() => WirePolylinetoggle(),[4, 5],[1, 2, 3, 4, 5]
	);
	// 焊盘 ⇄ 过孔
	eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Shift+G']);
	eda.sys_ShortcutKey.registerShortcutKey(
		['Ctrl+Shift+G'],'焊盘 ⇄ 过孔',
		() => PadViaToggle(),[4, 5],[1, 2, 3, 4, 5]
	);
	// 图片 ⇄ 填充
	eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Shift+F']);
	eda.sys_ShortcutKey.registerShortcutKey(
		['Ctrl+Shift+F'],'焊盘 ⇄ 过孔',
		() => PadViaToggle(),[4, 5],[1, 2, 3, 4, 5]
	);
}
