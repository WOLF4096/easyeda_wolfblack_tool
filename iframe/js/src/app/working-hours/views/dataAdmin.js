/**
 * @//module/ app/working-hours/views/dataAdmin
 * @//description/ 危险操作：清空全部记录、删除单个工程的全部时间片
 * @//exports/ createDataAdmin, stripProjectFromDay
 * @//dependencies/ ui/toast, core/log
 * @//example/ const admin = createDataAdmin({ ui, data, hooks })
 *            admin.confirmDeleteProject(uuid)
 *
 * 两个操作都直接改扩展的用户配置（`STATS_YYYY_MM_DD`），删错无法恢复，
 * 所以流程固定为「二次确认 → 显示遮罩 → 逐日清洗 → 重新加载」。
 * 存储清洗拆成纯函数 `stripProjectFromDay`，可以脱离 EDA 单测。
 */

import { toast } from '../../../ui/toast.js';
import { logger } from '../../../core/log.js';

/**
 * 从某一天的配置里删掉一个工程的所有时间片
 *
 * @param {object} dayData 单日配置（`{meta, slots}`）
 * @param {string} uuid 工程 id
 * @returns {boolean} 是否有改动
 * @sideEffects 改写 `dayData`
 */
export function stripProjectFromDay(dayData, uuid) {
	let modified = false;

	if (dayData.slots) {
		for (const slotId in dayData.slots) {
			const slot = dayData.slots[slotId];
			if (!slot || !slot[uuid]) continue;
			delete slot[uuid];
			modified = true;
			if (Object.keys(slot).length === 0) delete dayData.slots[slotId];
		}
	}
	if (dayData.meta && dayData.meta[uuid]) {
		delete dayData.meta[uuid];
		modified = true;
	}
	return modified;
}

/**
 * 逐日清洗某个工程
 *
 * @param {string} uuid 工程 id
 * @returns {Promise<void>}
 * @sideEffects 写扩展用户配置
 */
async function purgeProject(uuid) {
	const raw = await eda.sys_Storage.getExtensionAllUserConfigs();
	const allConfigs = raw || {};

	for (const dateKey in allConfigs) {
		if (!dateKey.startsWith('STATS_')) continue;
		let dayData;
		try {
			dayData = typeof allConfigs[dateKey] === 'string' ? JSON.parse(allConfigs[dateKey]) : allConfigs[dateKey];
		} catch (e) {
			continue; // 坏数据跳过，不阻断其它日期
		}
		if (!dayData) continue;
		if (!stripProjectFromDay(dayData, uuid)) continue;
		await eda.sys_Storage.setExtensionUserConfig(dateKey, JSON.stringify(dayData));
	}
}

/**
 * 删除某个工程的全部记录并刷新界面
 *
 * @param {object} ctx 上下文
 * @param {string} uuid 工程 id
 * @returns {Promise<void>}
 * @sideEffects 写配置 + 重绘
 */
async function deleteProject(ctx, uuid) {
	const ui = ctx.ui;
	const hooks = ctx.hooks;
	const mask = document.getElementById('loading-mask');
	mask.style.display = 'flex';
	mask.innerText = '正在执行本地存储清洗...';
	try {
		await purgeProject(uuid);
		toast('底层驱动数据同步擦除成功', 'success');
		await hooks.reloadData();

		if (ui.selectedManageUuid === uuid) {
			ui.selectedManageUuid = null;
			hooks.disposeManageChart();
			document.getElementById('manage-chart-title').innerText = '请点击上方工程行查看对应工程时间轴';
			document.getElementById('manage-custom-legend').classList.add('collapsed');
		}

		if (ui.selectedDetailUuid === uuid) {
			ui.selectedDetailUuid = null;
			if (ui.activeTab === 'project') {
				hooks.updateProjectSelector();
				hooks.onProjectSelectorChange();
			}
		}

		hooks.renderManageTable();
		if (ui.selectedManageUuid) hooks.initManageChart(ui.selectedManageUuid, ctx.data.projectMeta[ui.selectedManageUuid] || '');
		mask.style.display = 'none';
	} catch (e) {
		mask.innerText = '擦除产生未知错误: ' + e.message;
		mask.onclick = () => {
			mask.style.display = 'none';
		};
	}
}

/**
 * 二次确认后删除某个工程
 *
 * @param {object} ctx 上下文
 * @param {string} uuid 工程 id
 * @param {string} [name] 工程名（不传则从元数据取，避免 onclick 里传引号炸掉）
 * @returns {void}
 * @sideEffects 弹窗 + 可能写配置
 */
function confirmDelete(ctx, uuid, name) {
	const projectName = name || ctx.data.projectMeta[uuid] || '未命名工程';
	eda.sys_Dialog.showConfirmationMessage(
		`确认彻底删除 “${projectName}” 的全部时间记录？\n(此操作无法恢复)`,
		'确认清除时间片记录',
		'确认删除',
		'取消',
		async (mainButtonClicked) => {
			if (mainButtonClicked) await deleteProject(ctx, uuid);
		}
	);
}

/**
 * 二次确认后清空全部记录
 *
 * @param {object} ctx 上下文
 * @returns {void}
 * @sideEffects 弹窗 + 可能写配置
 */
function clearAll(ctx) {
	if (!window.eda || !eda.sys_Dialog) return;
	eda.sys_Dialog.showConfirmationMessage(
		'警告：此操作不可逆，将彻底删除所有本地记录的工程耗时数据。\n确认要清除全部数据吗？',
		'确认强制清除',
		'确认清除',
		'取消',
		async (mainButtonClicked) => {
			if (!mainButtonClicked) return;
			const mask = document.getElementById('loading-mask');
			mask.style.display = 'flex';
			mask.innerText = '正在强制擦除时间切片记录...';
			try {
				const allConfigs = await eda.sys_Storage.getExtensionAllUserConfigs();
				for (const key in allConfigs) {
					if (key.startsWith('STATS_')) await eda.sys_Storage.setExtensionUserConfig(key, '');
				}
				toast('全部记录已被安全擦除', 'success');
				await ctx.hooks.reloadData();
				ctx.ui.selectedDetailUuid = null;
				ctx.ui.selectedManageUuid = null;
				await ctx.hooks.switchTab('total');
			} catch (e) {
				logger.error('清除工时记录失败', e);
				toast('清除产生未知错误: ' + e.message, 'error');
			}
			mask.style.display = 'none';
		}
	);
}

/**
 * 创建危险操作处理器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.ui 交互状态（会改写 selectedDetailUuid / selectedManageUuid）
 * @param {object} ctx.data 数据集
 * @param {object} ctx.hooks 页面钩子
 * @param {() => Promise<void>} ctx.hooks.reloadData 重新加载数据
 * @param {(tab: string) => Promise<void>} ctx.hooks.switchTab 切换 tab
 * @param {() => void} ctx.hooks.renderManageTable 重渲染管理表格
 * @param {(uuid: string) => void} ctx.hooks.initManageChart 重建管理图
 * @param {() => void} ctx.hooks.disposeManageChart 销毁管理图
 * @param {() => void} ctx.hooks.updateProjectSelector 刷新工程下拉
 * @param {() => void} ctx.hooks.onProjectSelectorChange 下拉切换后的重绘
 * @returns {{clearAllDataConfirm: Function, confirmDeleteProject: Function, deleteProjectData: Function}} 处理器
 * @sideEffects 无（调用时才产生副作用）
 */
export function createDataAdmin(ctx) {
	return {
		clearAllDataConfirm: () => clearAll(ctx),
		confirmDeleteProject: (uuid, name) => confirmDelete(ctx, uuid, name),
		deleteProjectData: (uuid) => deleteProject(ctx, uuid),
	};
}
