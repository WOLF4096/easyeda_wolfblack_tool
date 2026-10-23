/**
 * @//module/ app/working-hours/views/dataImport
 * @//description/ 导入工时备份：读文件 → 校验归属与签名 → 预览合并量 → 二次确认 → 落盘
 * @//exports/ createDataImport
 * @//dependencies/ ui/toast, core/log, app/working-hours/{time,backupCodec,backupMerge}
 * @//example/ const importer = createDataImport({ getUser, hooks })
 *            importer.pickFile(); importer.onFileChange(event)
 *
 * 三个「不做」：
 *   1. 不导入别人的文件 —— `unpackBackup` 会用**当前账号**的密钥验签，顺便比对 uuid；
 *   2. 不覆盖本地更大的记录 —— 合并只取最大值（见 backupMerge），导错文件也丢不了数据；
 *   3. 不静默写入 —— 先弹出「谁的备份、多少天、多少条」让人确认，再动手。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import { logger } from '../../../core/log.js';
import { toast } from '../../../ui/toast.js';
import { unpackBackup } from '../backupCodec.js';
import { applyMerge, planMerge } from '../backupMerge.js';
import { formatFullDateTime } from '../time.js';

/** 备份文件大小上限（工时 JSON 压缩后通常在百 KB 量级） */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * 用 FileReader 读取文本（`File.text()` 不可用时的兜底）
 *
 * @param {File} file 文件
 * @returns {Promise<string>} 文本
 * @sideEffects 无
 */
function readWithReader(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error('读取备份文件失败'));
		reader.readAsText(file, 'utf-8');
	});
}

/**
 * 读文件并解析成 JSON
 *
 * @param {File} file 备份文件
 * @returns {Promise<object>} 已解析的信封
 * @sideEffects 读磁盘
 */
async function readEnvelope(file) {
	if (file.size > MAX_FILE_BYTES) throw new Error('备份文件超过 32 MB，可能不是工时备份');
	const content = typeof file.text === 'function' ? await file.text() : await readWithReader(file);
	try {
		return JSON.parse(content);
	} catch (e) {
		throw new Error('文件不是合法的 JSON，请选择「导出备份数据」生成的 .json 备份');
	}
}

/**
 * 显示 / 更新加载遮罩（保留原有转圈动画）
 *
 * @param {HTMLElement|null} mask 遮罩元素
 * @param {string} text 提示文案
 * @returns {void}
 * @sideEffects DOM
 */
function showMask(mask, text) {
	if (!mask) return;
	const label = mask.querySelector('span');
	if (label) label.textContent = text;
	else mask.innerText = text;
	mask.style.display = 'flex';
}

/**
 * 创建导入器
 *
 * @param {object} ctx 上下文
 * @param {() => object|null} ctx.getUser 取当前用户信息
 * @param {{gzip: Function, gunzip: Function}} [ctx.zip] 压缩实现（默认页面里的 fflate，测试可注入）
 * @param {object} ctx.hooks 页面钩子
 * @param {() => Promise<void>} ctx.hooks.reloadData 导入后重新加载数据
 * @returns {{pickFile: Function, onFileChange: Function}} 导入器
 * @sideEffects 无（调用时才读写文件与存储）
 */
export function createDataImport(ctx) {
	let busy = false;

	/**
	 * 落盘并刷新页面
	 *
	 * @param {{updates: Array, stats: object}} plan 合并计划
	 * @returns {Promise<void>}
	 * @sideEffects 写扩展配置 + 重绘
	 */
	async function runImport(plan) {
		const mask = document.getElementById('loading-mask');
		showMask(mask, '正在合并导入数据...');
		try {
			await applyMerge(plan.updates);
			if (ctx.hooks && ctx.hooks.reloadData) await ctx.hooks.reloadData();
			toast(`导入完成：${plan.stats.days} 天 / ${plan.stats.slots} 条记录`, 'success');
		} catch (e) {
			logger.error('写入导入的工时数据失败', e);
			toast('导入写入失败：' + (e && e.message ? e.message : '未知错误'), 'error');
		} finally {
			if (mask) mask.style.display = 'none';
		}
	}

	/**
	 * 二次确认（文案里写清是谁的备份、会补多少）
	 *
	 * @param {object} backup 解包结果
	 * @param {{updates: Array, stats: object}} plan 合并计划
	 * @returns {void}
	 * @sideEffects 弹窗 + 可能写配置
	 */
	function confirmMerge(backup, plan) {
		if (!window.eda || !eda.sys_Dialog) {
			toast('当前环境无法弹出确认框，已取消导入', 'error');
			return;
		}
		const owner = backup.user.nickname || backup.user.username || '当前账号';
		const hours = (plan.stats.workSeconds / 3600).toFixed(1);
		const text = [
			`确认导入「${owner}」于 ${formatFullDateTime(backup.exportedAt)} 导出的备份？`,
			'',
			`将补入 ${plan.stats.days} 天、${plan.stats.slots} 条记录（约 ${hours} 小时工时）。`,
			'导入只补不覆盖：本地更大的记录保持不变，同一份文件重复导入不会翻倍。',
		].join('\n');

		eda.sys_Dialog.showConfirmationMessage(text, '确认导入工时备份', '确认导入', '取消', (clicked) => {
			if (clicked) runImport(plan);
		});
	}

	/**
	 * 校验备份 → 计算合并量 → 请求确认
	 *
	 * @param {object} backup 解包结果
	 * @returns {Promise<void>}
	 * @sideEffects 读存储；可能弹窗
	 */
	async function prepareMerge(backup) {
		const configs = (await eda.sys_Storage.getExtensionAllUserConfigs()) || {};
		const plan = planMerge(configs, backup.days);
		if (plan.updates.length === 0) {
			toast('本地已包含该备份的全部记录，无需导入', 'info');
			return;
		}
		confirmMerge(backup, plan);
	}

	/**
	 * 从 change 事件里取出文件，并清空 input（否则连续选同一个文件不会再触发 change）
	 *
	 * @param {Event} event change 事件
	 * @returns {File|null} 文件
	 * @sideEffects 改写 input.value
	 */
	function takeFile(event) {
		const input = event && event.target;
		const file = input && input.files ? input.files[0] : null;
		if (input) input.value = '';
		return file || null;
	}

	/**
	 * 选择文件后：读取 → 校验 → 预览 → 确认
	 *
	 * @param {Event} event input 的 change 事件
	 * @returns {Promise<void>}
	 * @sideEffects 读文件、可能写存储
	 */
	async function onFileChange(event) {
		const file = takeFile(event);
		if (!file || busy) return;

		busy = true;
		try {
			const envelope = await readEnvelope(file);
			const backup = await unpackBackup({ envelope: envelope, currentUser: ctx.getUser ? ctx.getUser() : null, zip: ctx.zip });
			await prepareMerge(backup);
		} catch (e) {
			logger.error('导入工时备份失败', e);
			toast(e && e.message ? e.message : '导入失败', 'error');
		} finally {
			busy = false;
		}
	}

	/**
	 * 打开系统文件选择框
	 *
	 * @returns {void}
	 * @sideEffects 触发文件选择
	 */
	function pickFile() {
		const input = document.getElementById('import-file-input');
		if (!input) {
			toast('导入入口不可用，请重开本页', 'error');
			return;
		}
		input.value = '';
		input.click();
	}

	return { pickFile: pickFile, onFileChange: onFileChange };
}
