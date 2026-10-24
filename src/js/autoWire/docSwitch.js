/**
 * 原理图 ⇄ PCB 页签切换
 *
 * 「创建导线 → 来自PCB」需要临时切到 PCB 取选中器件，「从PCB更新网表缓存」需要切到 PCB 取整份网表，
 * 两边都要「切过去、取完切回原理图」，所以单独抽出来共用一份页签记忆。
 *
 * --- 模块边界 ---
 * 本模块是「EDA 编排层」：只做文档切换，不读网表也不写文档。
 * 状态只有 `lastSchematicTabId`（切走前的原理图页签），进程内共享一份。
 *
 * 注意：
 *   - `switchToPCB()` **不抛错**，返回 `false` 表示没定位到 PCB —— 调用方自己决定是否中止；
 *   - `switchToSchematic()` **会抛错**：拿不到原理图页签时必须拦住后续写盘，
 *     否则会把导线行拼进 PCB 源码（系统会报「格式错误」，甚至写坏文档）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { logger } from '../common/logger.js';

/** 切走前的原理图页签 ID（形如 `UUID@ProjectID`） */
let lastSchematicTabId = null;

/**
 * 切换到当前板子对应的 PCB 界面
 *
 * 顺带记下当前原理图页签，供 `switchToSchematic()` 切回。
 *
 * @returns {Promise<boolean>} 是否成功切到 PCB（找不到 PCB 页签 / 板子信息异常时为 false）
 * @sideEffects 切换编辑器活动文档
 */
export async function switchToPCB() {
	try {
		// A. 记录当前原理图信息 (如果当前是在原理图界面)
		const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		logger.debug(curDoc);
		if (curDoc && curDoc.documentType === 1) {
			// 1 代表原理图
			lastSchematicTabId = curDoc.uuid + '@' + curDoc.parentProjectUuid;
			logger.debug(lastSchematicTabId);
			logger.debug(curDoc.tabId);
		}

		// B. 获取当前板子对应的 PCB UUID
		const boardInfo = await eda.dmt_Board.getCurrentBoardInfo();
		logger.debug(boardInfo);
		if (!boardInfo || !boardInfo.pcb) throw new Error('未获取到板子信息');
		const targetPcbUuid = boardInfo.pcb.uuid;

		// C. 在分屏树中查找 匹配该UUID 的 PCB Tab
		const splitData = await eda.dmt_EditorControl.getSplitScreenTree();
		// TabId 通常格式为 "UUID@ProjectID"，所以使用 includes 匹配
		const pcbTab = splitData.tabs.find((tab) => tab.tabId.includes(targetPcbUuid));
		logger.debug(pcbTab);
		if (!pcbTab) {
			await eda.sys_Message.showToastMessage('未找到当前板子对应的PCB窗口，请确认PCB已打开', 2);
			return false;
		}
		await eda.dmt_EditorControl.activateDocument(pcbTab.tabId);
		return true;
	} catch (error) {
		logger.error('切换PCB失败:', error);
		return false;
	}
}

/**
 * 切换回切换前的原理图界面
 *
 * @returns {Promise<void>}
 * @sideEffects 切换编辑器活动文档
 * @throws 没有记录到原理图页签时抛错（调用方须中止写盘）
 */
export async function switchToSchematic() {
	// 没有记录到原理图页签时直接中止：否则后续 getDocumentSource() 读到的是 PCB 源码，
	// 再把原理图导线行拼进去写回，等于往 PCB 文档里塞错误格式（系统会报「格式错误」）。
	if (!lastSchematicTabId) {
		await eda.sys_Message.showToastMessage('未能定位原理图页签，已中止（避免写入错误文档）', 2);
		throw new Error('未能定位原理图页签');
	}
	await eda.dmt_EditorControl.activateDocument(lastSchematicTabId);
}
