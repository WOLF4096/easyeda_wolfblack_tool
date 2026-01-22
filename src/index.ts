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

// 从PCB网表在原理图放置器件
export async function NetlistToSchematicPCB() {
	const { placeComponentsEfficiently } = await import('./js/NetlistToSchematic');
	eda.sys_Dialog.showConfirmationMessage(
		'注意：此操作将从 PCB 导入元件到原理图画布\n是否继续？',
		'从PCB导入元件到原理图画布',
		'继续',
		'取消',
		async (mainButtonClicked) => {
			if (mainButtonClicked) {
				await placeComponentsEfficiently('PCB');
			} else {
				eda.sys_Message.showToastMessage('已取消 从 PCB 放置器件 的操作', 'info');
			}
		},
	);
}
// 从网表文件在原理图放置器件
export async function NetlistToSchematicNET() {
	const { placeComponentsEfficiently } = await import('./js/NetlistToSchematic');
	eda.sys_Dialog.showConfirmationMessage(
		'注意：此操作将从 网表文件 导入元件到原理图画布\n是否继续？',
		'从网表文件导入元件到原理图画布',
		'继续',
		'取消',
		async (mainButtonClicked) => {
			if (mainButtonClicked) {
				await placeComponentsEfficiently('NET');
			} else {
				eda.sys_Message.showToastMessage('已取消 从 网表文件 放置器件 的操作', 'info');
			}
		},
	);
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
// 清除PCB多余属性
export async function ClearEmptySupplierPropertiesPCB() {
	const { ClearEmptySupplierProperties } = await import('./js/ClearEmptySupplierProperties');
	await ClearEmptySupplierProperties('PCB');
}
// 清除SCH多余属性
export async function ClearEmptySupplierPropertiesSCH() {
	const { ClearEmptySupplierProperties } = await import('./js/ClearEmptySupplierProperties');
	await ClearEmptySupplierProperties('SCH');
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

// 创建封装
export async function CreateFootprint() {
	eda.sys_IFrame.openIFrame('/iframe/CreateFootprint.html', 400, 128, 'CreateFootprint');
}

// 批量修改网络
export async function NetReplace() {
	eda.sys_IFrame.openIFrame('/iframe/NetReplace.html', 470, 640, 'NetReplace');
}
// 批量替换器件
export async function ReplaceComponent() {
	eda.sys_IFrame.openIFrame('/iframe/ReplaceComponent.html', 1280, 720, 'ReplaceComponent');
}
// 导入图片
export async function ImportImage() {
	eda.sys_IFrame.openIFrame('/iframe/ImportImage.html', 960, 680, 'ImportImage');
}
// 导入BOM
export async function ImportBom() {
	eda.sys_IFrame.openIFrame('/iframe/ImportBom.html', 1280, 720, 'ImportBom');
}
// 导入二维码
export async function ImportQrcode() {
	eda.sys_IFrame.openIFrame('/iframe/ImportQrcode.html', 540, 640, 'ImportQrcode');
}
// 丝印代码转换
export function CodeConvert() {
	eda.sys_IFrame.openIFrame('/iframe/CodeConvert.html', 720, 640, 'CodeConvert');
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

// 配置物理网络 - 极速
export async function ConfigurePhysicalNetsExtremespeed() {
	const module = await import('./js/ConfigurePhysicalNetsExtremespeed');
	eda.sys_Dialog.showConfirmationMessage(
		'使用前必须确保每个器件都有不重复的唯一ID和位号\n如果没有，可在 菜单栏 ⇒ 设计 ⇒ 重置唯一ID\n如果处理完没有反应，可以重新打开工程后尝试',
		'设置物理网络',
		'继续',
		'取消',
		async (mainButtonClicked) => {
			if (mainButtonClicked) {
				await module.configurePhysicalNets();
			} else {
				eda.sys_Message.showToastMessage('已取消', 'info');
			}
		},
	);
}
// 配置物理网络 - 传统
export async function ConfigurePhysicalNetsTradition() {
	eda.sys_IFrame.openIFrame('/iframe/ConfigurePhysicalNetsTradition.html', 500, 500, 'ConfigurePhysicalNetsTradition');
}

// 导入AltiumDesigner网表
export async function ImportAltiumDesignerNetlist() {
	const module = await import('./js/ImportAltiumDesignerNetlist');
	await module.ImportAltiumDesignerNetlist();
}

// 关于
export function About() {
	eda.sys_IFrame.openIFrame('/iframe/About.html', 680, 720, 'About');
}

// 启动软件时执行，
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

	// 判断逻辑：如果版本号以 "3." 开头，使用V3引擎；否则使用V2引擎
	if (editorVersion.trim().startsWith('3.')) {
		// 导入图片
		eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Shift+C']);
		eda.sys_ShortcutKey.registerShortcutKey(
			['Ctrl+Shift+C'],'导入图片',
			() => ImportImage(),[4],[1, 2, 3, 4, 5]
		);
		// 位号查重
		eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Alt+W']);
		eda.sys_ShortcutKey.registerShortcutKey(
			['Ctrl+Alt+W'],'位号查重',
			() => CheckDesignators(),[4],[1, 2, 3, 4, 5]
		);
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
	} else {
		// V2版本注册快捷键功能异常
		// 创建封装
		// eda.sys_ShortcutKey.unregisterShortcutKey(['Ctrl+Shift+F']);
		// eda.sys_ShortcutKey.registerShortcutKey(
		// 	['Ctrl+Shift+F'],'创建封装',
		// 	() => CreateFootprint(),[4],[1, 2, 3, 4, 5]
		// );
	}




// 测试 ============================================================================

// 测试 - 导出工程资料
// export function OutFilePackage() {
// 	eda.sys_IFrame.openIFrame("/iframe/OutFilePackage.html", 640, 720, "CodeConvert");
// }

// {
// 						"id": "OutFilePackage",
// 						"title": "导出工程资料",
// 						"registerFn": "OutFilePackage"
// 					},

// 测试 - 导入Gerber
// export async function ImportGerber() {
// 	eda.sys_IFrame.openIFrame("/iframe/ImportGerber.html", 1280, 900, "ImportGerber");
// }

// ,{
// 								"id": "ImportGerber",
// 								"title": "Gerber",
// 								"registerFn": "ImportGerber"
// 							}

