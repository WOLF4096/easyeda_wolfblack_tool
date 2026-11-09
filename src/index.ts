/**
 * 狼黑工具 · 扩展入口
 *
 * 本文件只做三件事，**功能实现都不在这里**：
 *   1. 导出函数，供 `extension.json` 的 `headerMenus[].registerFn` 按名字引用
 *      （函数名 = 菜单项，改名/删除必须同步改 `extension.json`，否则菜单点了没反应）；
 *   2. 打开各功能的 iframe 页面（统一走 `openPage`）；
 *   3. 模块加载时执行一次性初始化 + 注册快捷键（V3 / V4 才有快捷键 API）。
 *
 * 功能代码的位置：
 *   - 有界面：`iframe/<页面>.html` + `iframe/js/app/<页面>.js`（页面自己读写网表 / 图元）；
 *   - 无界面：`src/js/<模块>.js`，**按需 `import()`** —— 不要在入口静态引入，
 *     否则每次打开 EDA 都要先把所有功能加载进内存。
 *
 * 开发文档：https://prodocs.lceda.cn/cn/api/guide/
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import * as extensionConfig from '../extension.json';

/* ===== 一、公共工具 ===== */

/**
 * 打开功能页面
 *
 * @param name - 页面名，对应 `iframe/<name>.html`
 * @param width - 宽（px）
 * @param height - 高（px）
 * @param id - iframe 标识
 */
function openPage(name: string, width: number, height: number, id: string = name): void {
	eda.sys_IFrame.openIFrame(`/iframe/${name}.html`, width, height, id);
}

/* ===== 二、生命周期 ===== */

/**
 * 扩展激活钩子（由 EDA 调用）
 *
 * `extension.json` 的 `activationEvents` 为空，表示不随启动自动激活，只在用户点菜单时激活，
 * 因此这里不需要做任何事；保留空实现是因为入口必须导出它。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {}

/* ===== 三、有界面的功能（打开 iframe） ===== */

/** 工作时间统计（界面；数据由下面的后台记录持续累积） */
export function WorkingHours(): void {
	openPage('WorkingHours', 960, 600);
}

/** 引脚排序（符号编辑器） */
export function PinSorting(): void {
	openPage('PinSorting', 200, 168);
}

/** 关于 */
export function About(): void {
	openPage('About', 860, 720);
}

/** PCB转原理图 */
export function PcbToSch(): void {
	// 该页面的 iframe 标识沿用历史的 'tosch'（页面内部按此标识关闭自己）
	openPage('PcbToSch', 640, 540, 'tosch');
}

/** 导入 BOM（原理图 / PCB 都挂，用于批量改器件属性） */
export function ImportBom(): void {
	openPage('ImportBom', 1024, 540);
}

/** 丝印代码转换（E96 阻值 ↔ 丝印） */
export function CodeConvert(): void {
	openPage('CodeConvert', 540, 540);
}

/** 清除多余属性（供应商 / 厂商等空属性） */
export function ClearEmptySupplierProperties(): void {
	openPage('ClearEmptyProperties', 800, 480);
}

/** 导入图片 */
export function ImportImage(): void {
	openPage('ImportImage', 860, 540);
}

/** 导入二维码 */
export function ImportQrcode(): void {
	openPage('ImportQrcode', 820, 700);
}

/** 创建封装 */
export function CreateFootprint(): void {
	openPage('CreateFootprint', 300, 100);
}

/** 批量替换器件 */
export function ReplaceComponent(): void {
	openPage('ReplaceComponent', 810, 480);
}

/** 3D 模型批量更新与恢复 */
export function NetlistUpdate3DModels(): void {
	openPage('NetlistUpdate3DModels', 960, 480);
}

/** 生成物理网络（纯几何聚类，把「有连接关系的图元」归到同一网络） */
export function GenerateNet(): void {
	openPage('GenerateNet', 540, 540);
}

/** 导入 AD 网表 */
export function InADNetlist(): void {
	openPage('InADNetlist', 540, 540);
}

/** 导出引脚网络 */
export function OutPinNet(): void {
	openPage('OutPinNet', 540, 540);
}

/** 批量修改网络 */
export function ModifyNet(): void {
	openPage('ModifyNet', 540, 540);
}

/** 批量修改线宽（按层统计分布，改宽或填 0 删除） */
export function ModifyLineWidth(): void {
	openPage('ModifyLineWidth', 400, 500);
}

/** 校准API误差（坐标 / 尺寸校准，转换类功能的倍率来源） */
export function APITest(): void {
	openPage('APITest', 512, 640);
}

/** EDA桥（本地调试通道，见 tools/eda-bridge） */
export function EDABridge(): void {
	openPage('EDABridge', 300, 37);
}

/* ===== 四、无界面的功能（直接执行，按需加载） ===== */

// ---------------------------- 导线 / 图元转换 ----------------------------

/** 焊盘 ⇄ 过孔（按选中类型自动判方向） */
export async function PadViaToggle(): Promise<void> {
	const { PadViaConverter } = await import('./js/PadViaConverter');
	await PadViaConverter.toggle();
}

/** 导线 ⇄ 线条（按选中类型自动判方向；多段首尾相接时合并为一条折线） */
export async function WirePolylinetoggle(): Promise<void> {
	const { WireConverter } = await import('./js/WireConverter');
	await WireConverter.toggle();
}

/** 填充 ⇄ 图片 */
export async function RegionImageConverter(): Promise<void> {
	const { ImageFillConverter } = await import('./js/RegionImageConverter');
	await ImageFillConverter.toggle();
}

// ---------------------------- 网表 / 器件 ----------------------------

/** 刷新网表 */
export async function RefreshNetlist(): Promise<void> {
	const mod = await import('./js/RefreshNetlist');
	await mod.RefreshNetlist();
}

/** 位号查重 */
export async function CheckDesignators(): Promise<void> {
	const { checkDuplicateDesignators } = await import('./js/CheckDesignators');
	await checkDuplicateDesignators();
}

/** 创建导线 · 来自 PCB（原来「从PCB创建导线」的逻辑：切到 PCB 读选中器件） */
export async function AutoWirePlacerPCB(): Promise<void> {
	const { placeWires } = await import('./js/autoWire/index');
	await placeWires('PCB');
}

/** 创建导线 · 来自网表（读用户配置里的网表缓存，没有缓存会明确提示） */
export async function AutoWirePlacerNET(): Promise<void> {
	const { placeWires } = await import('./js/autoWire/index');
	await placeWires('NET');
}

/** 创建导线 · 从 PCB 更新网表缓存（切到 PCB 取整份 .enet，写完切回原理图） */
export async function UpdateNetlistCacheFromPCB(): Promise<void> {
	const { updateCachedNetlistFromPCB } = await import('./js/autoWire/netlistSync');
	await updateCachedNetlistFromPCB();
}

/** 创建导线 · 从文件更新网表缓存（弹文件框选 .enet，不动当前文档） */
export async function UpdateNetlistCacheFromFile(): Promise<void> {
	const { updateCachedNetlistFromFile } = await import('./js/autoWire/netlistSync');
	await updateCachedNetlistFromFile();
}

/** 创建导线 · 清空网表缓存 */
export async function ClearNetlistCache(): Promise<void> {
	const { clearCachedNetlist } = await import('./js/autoWire/netlistSync');
	await clearCachedNetlist();
}

// ---------------------------- 后台任务（不挂菜单） ----------------------------

/**
 * 工作时间统计 —— 后台记录
 *
 * @internal 不挂在菜单上，只由下面的 `initializeOnce()` 调用。
 * 保留 `export` 只是为了兼容历史调用方；新代码请直接用 `initializeOnce`。
 */
export async function WorkingHoursJs(): Promise<void> {
	const { WorkingHours: startRecorder } = await import('./js/WorkingHours');
	await startRecorder();
}

/* ===== 五、模块加载时执行 ===== */

/** 一次性初始化的标记：EDA 可能重复加载入口，重复启动后台记录会重复计时 */
const INIT_FLAG_KEY = `__EXTENSION_${extensionConfig.name}_INITIALIZED__`;

/** `globalThis` 上挂的自定义标记（用索引签名访问，避免 TS7053） */
const globalFlags = globalThis as typeof globalThis & Record<string, boolean | undefined>;

/** 首次加载时启动「工作时间」后台记录 */
function initializeOnce(): void {
	if (globalFlags[INIT_FLAG_KEY]) return;
	console.log(`======= [${extensionConfig.name}] 插件首次加载，执行初始化 =======`);
	globalFlags[INIT_FLAG_KEY] = true;
	// 后台记录不阻塞入口加载；失败只记日志，不影响其它功能
	WorkingHoursJs().catch((error) => console.error('[系统] 启动工作时间记录失败:', error));
}

/** 读取编辑器版本号；不在 EDA 环境（或 API 异常）时返回兜底值 */
function getEditorVersion(): string {
	try {
		return eda.sys_Environment.getEditorCurrentVersion() || '2.2.x';
	} catch (e) {
		return '2.2.x';
	}
}

/** 快捷键生效的文档类型：4 = PCB，5 = 封装 */
const SHORTCUT_DOC_TYPES = [4, 5];

/** 快捷键生效的场景：非画布 / 画布选中 / 画布未选中 / 画布绘制 / 画布放置 */
const SHORTCUT_SCENES = [1, 2, 3, 4, 5];

/**
 * 快捷键参数的类型
 *
 * 官方类型声明写的是「按键名数组」（`['CONTROL', 'SHIFT', 'C']`），但运行时也接受
 * `'Ctrl+Shift+C'` 这种组合键字符串，且现网一直用后者（见发布版快捷键实际可用）。
 * 类型放宽只发生在这一个地方，方便将来官方类型修正后统一调整。
 */
type ShortcutKeys = Parameters<typeof eda.sys_ShortcutKey.registerShortcutKey>[0];

/**
 * 注册一个快捷键
 *
 * @param keys - 组合键
 * @param title - 快捷键显示名
 * @param run - 触发时的回调
 * @param docTypes - 生效的文档类型，默认 PCB + 封装
 */
function bindShortcut(keys: string[], title: string, run: () => void, docTypes: number[] = SHORTCUT_DOC_TYPES): void {
	const keyList = keys as unknown as ShortcutKeys;
	// 先注销再注册：EDA 会记住上次会话注册的快捷键，不注销会报「快捷键已存在」
	eda.sys_ShortcutKey.unregisterShortcutKey(keyList);
	eda.sys_ShortcutKey
		.registerShortcutKey(keyList, title, run, docTypes, SHORTCUT_SCENES)
		.catch((error) => console.warn(`[系统] 注册快捷键「${title}」失败:`, error));
}

/**
 * 注册快捷键
 *
 * 版本策略：快捷键 API 从 V3 起提供，**V2.2.45 没有**（调用会抛错），所以按主版本号判断。
 * 注意不要写成 `startsWith('3.')` —— V4 的版本号是 4.x，会被误判成「不支持」而一个都不注册。
 */
function registerShortcuts(): void {
	const editorVersion = getEditorVersion();
	console.log(`[系统] 检测到编辑器版本: ${editorVersion}`);

	const major = Number.parseInt(editorVersion.trim().split('.')[0], 10);
	if (!Number.isFinite(major) || major < 3) return;

	bindShortcut(['Ctrl+Shift+C'], '导入图片', () => ImportImage(), [4]);
	bindShortcut(['Ctrl+Shift+X'], '导线 ⇄ 线条', () => WirePolylinetoggle());
	bindShortcut(['Ctrl+Shift+G'], '焊盘 ⇄ 过孔', () => PadViaToggle());
	bindShortcut(['Ctrl+Shift+F'], '填充 ⇄ 图片', () => RegionImageConverter());
}

initializeOnce();
registerShortcuts();
