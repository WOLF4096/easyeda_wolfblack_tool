/**
 * 网表缓存的三个维护动作（菜单入口）
 *
 * | 菜单 | 做什么 |
 * | --- | --- |
 * | 从 PCB 更新网表缓存 | 切到 PCB → 取整份 .enet 网表 → 写入缓存 → 切回原理图 |
 * | 从文件更新网表缓存 | 弹文件框选 .enet → 写入缓存（不动当前文档） |
 * | 清空网表缓存 | 删掉缓存正文与元信息 |
 *
 * 「创建导线 → 来自网表」读的就是这里写的缓存，**PCB 来源与文件来源只存一份**，
 * 后写的覆盖前一份，靠元信息告诉用户手上这份是哪来的、什么时候的。
 *
 * --- 模块边界 ---
 * 本模块是「EDA 编排 + 交互层」：负责切页、取文件、弹提示、写日志；
 * 缓存存取在 netlistCache.js，网表统计在 netlistParser.js（纯函数）。
 * 三个函数都**不抛错**，失败时返回 `{ success: false, message }` 并弹提示。
 *
 * 关于从 PCB 取网表：PCB 文档下同样用 `eda.sch_ManufactureData.getNetlistFile('JLCEDA')`，
 * 返回的 `File` 就是整块板的 .enet 网表（含全部器件与引脚网络），不需要选中任何器件。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import { logger } from '../common/logger.js';
import { switchToPCB, switchToSchematic } from './docSwitch.js';
import { clearNetlistCache, describeCacheMeta, loadNetlistCache, saveNetlistCache } from './netlistCache.js';
import { summarizeNetlist } from './netlistParser.js';

/** 网表文件类型（与「创建导线」原来取原理图网表用的是同一档） */
const NETLIST_FILE_TYPE = 'JLCEDA';

/** 文件筛选后缀 */
const NETLIST_EXTENSIONS = ['.enet'];

/**
 * 延迟
 *
 * @param {number} ms - 毫秒
 * @returns {Promise<void>} 定时结束
 */
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 读取 File 对象为文本
 *
 * 先用标准的 `Blob.text()`；个别老版本的文件对象上没有这个方法，退回 `FileReader`
 * （与改造前「从网表创建导线」读文件的方式一致），两条路都拿不到才报错。
 *
 * @param {File} file - 文件对象
 * @returns {Promise<string>} 文本内容
 */
function readFileAsText(file) {
	if (typeof file.text === 'function') return file.text();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (event) => resolve(event.target.result);
		reader.onerror = (error) => reject(error);
		reader.readAsText(file);
	});
}

/**
 * 提示 + 写日志
 *
 * @param {string} message - 文案
 * @param {'info'|'error'} [level] - 日志级别
 * @returns {Promise<void>}
 * @sideEffects 弹 toast、写 EDA 日志
 */
async function notify(message, level = 'info') {
	await eda.sys_Message.showToastMessage(message, level === 'error' ? 2 : 3);
	try {
		eda.sys_Log.add(message, level);
	} catch (error) {
		logger.warn('写 EDA 日志失败', error);
	}
}

/**
 * 取网表正文里的规模摘要，顺带校验它确实是一份网表
 *
 * @param {string} text - 网表正文
 * @returns {{componentCount: number, pinCount: number, netCount: number}} 统计摘要
 * @throws 内容不是合法网表 JSON 时抛错
 */
function requireSummary(text) {
	const summary = summarizeNetlist(text);
	if (!summary) throw new Error('网表内容无效（没有解析到任何器件，可能取错了文档）');
	return summary;
}

/**
 * 把网表写进缓存
 *
 * @param {string} text - 网表正文
 * @param {{source: string, sourceLabel: string, fileName?: string}} info - 来源信息
 * @returns {Promise<{summary: object, meta: object}>} 统计摘要与写入后的元信息
 * @throws 写配置失败时抛错
 * @sideEffects 写 `eda.sys_Storage`
 */
async function commitCache(text, info) {
	const summary = requireSummary(text);
	const { ok, meta } = await saveNetlistCache(text, { ...info, summary });
	if (!ok) throw new Error('写入用户配置失败');
	return { summary, meta };
}

/**
 * 拼一句缓存规模描述
 *
 * @param {object} summary - `summarizeNetlist` 的结果
 * @returns {string} 形如 `123 个器件 / 456 个引脚 / 78 个网络`
 */
function describeSummary(summary) {
	return `${summary.componentCount} 个器件 / ${summary.pinCount} 个引脚 / ${summary.netCount} 个网络`;
}

/**
 * 从当前（PCB）文档读取整份网表
 *
 * 刚切页时偶尔会取到空值，延迟几百毫秒再取一次。
 *
 * @returns {Promise<string>} 网表正文
 * @throws 取不到文件或内容为空时抛错
 */
async function readNetlistFromDocument() {
	let file = await eda.pcb_ManufactureData.getNetlistFile(NETLIST_FILE_TYPE);
	console.log(file);
	if (!file) {
		await delay(400);
		file = await eda.pcb_ManufactureData.getNetlistFile(NETLIST_FILE_TYPE);
	}
	if (!file) throw new Error('未取到网表文件，请确认当前 PCB 已保存');

	const text = await file.text();
	if (!text || !text.trim()) throw new Error('网表文件内容为空');
	return text;
}

/**
 * 从 PCB 更新网表缓存
 *
 * 切到 PCB → 取整份网表 → **先写缓存** → 再切回原理图。
 * 切页失败时直接中止（此时取到的会是原理图自己的网表，写进去就变成「来源造假」）。
 *
 * @returns {Promise<{success: boolean, message: string, meta?: object}>} 结果
 * @sideEffects 切换文档、写 `eda.sys_Storage`、弹提示
 */
export async function updateCachedNetlistFromPCB() {
	// 只有真的切过去才负责切回来：没切成功时当前页就是原理图，不用动
	let switched = false;
	try {
		switched = await switchToPCB();
		if (!switched) {
			const message = '未能获取到网表，不允许分屏使用';
			await notify(message, 'error');
			return { success: false, message };
		}
		const text = await readNetlistFromDocument();
		const { summary, meta } = await commitCache(text, { source: 'PCB', sourceLabel: 'PCB' });
		const message = `已从 PCB 更新网表缓存：${describeSummary(summary)}`;
		await notify(message);
		return { success: true, message, meta };
	} catch (error) {
		logger.error('从 PCB 更新网表缓存失败:', error);
		const message = `更新网表缓存失败：${(error && error.message) || error}`;
		await notify(message, 'error');
		return { success: false, message };
	} finally {
		// 无论成败都切回原理图：用户是在原理图页点的菜单
		if (switched) {
			try {
				await switchToSchematic();
			} catch (error) {
				logger.warn('切回原理图失败（缓存操作已结束）', error);
			}
		}
	}
}

/**
 * 从文件更新网表缓存
 *
 * 只读文件写缓存，不碰当前文档，所以不需要切页。
 *
 * @returns {Promise<{success: boolean, message: string, meta?: object}>} 结果
 * @sideEffects 弹文件框、读文件、写 `eda.sys_Storage`、弹提示
 */
export async function updateCachedNetlistFromFile() {
	try {
		const file = await eda.sys_FileSystem.openReadFileDialog(NETLIST_EXTENSIONS, false);
		if (!file) {
			const message = '未选择文件，网表缓存未更新';
			await notify(message, 'info');
			return { success: false, message };
		}
		const text = await readFileAsText(file);
		const { summary, meta } = await commitCache(text, {
			source: 'FILE',
			sourceLabel: '文件',
			fileName: file.name || '',
		});
		const message = `已从文件更新网表缓存：${describeSummary(summary)}`;
		await notify(message);
		return { success: true, message, meta };
	} catch (error) {
		logger.error('从文件更新网表缓存失败:', error);
		const message = `更新网表缓存失败：${(error && error.message) || error}`;
		await notify(message, 'error');
		return { success: false, message };
	}
}

/**
 * 清空网表缓存
 *
 * 缓存本来就是空的时候也返回成功，只把文案写清楚，避免「点了没反应」的错觉。
 *
 * @returns {Promise<{success: boolean, message: string}>} 结果
 * @sideEffects 删 `eda.sys_Storage`、弹提示
 */
export async function clearCachedNetlist() {
	try {
		const cached = await loadNetlistCache();
		if (!cached) {
			const message = '网表缓存本来就是空的，无需清空';
			await notify(message, 'info');
			return { success: true, message };
		}
		await clearNetlistCache();
		const message = `已清空网表缓存（${describeCacheMeta(cached.meta)}）`;
		await notify(message);
		return { success: true, message };
	} catch (error) {
		logger.error('清空网表缓存失败:', error);
		const message = `清空网表缓存失败：${(error && error.message) || error}`;
		await notify(message, 'error');
		return { success: false, message };
	}
}
