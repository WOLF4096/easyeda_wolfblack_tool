/**
 * @//module/ ui/rewardPrompt
 * @//description/ 「从 PCB 转原理图」的使用计数与「感觉不错？」触发（计数不对前端展示，只打控制台）
 * @//exports/ recordUsage, getUsageCount, shouldPrompt
 * @//dependencies/ core/eda, core/log, ui/rewardDialog
 * @//example/ const { recordUsage } = await import('./ui/rewardPrompt.js')
 *            await recordUsage()   // 导入文档 / 导出文件成功后调一次
 *
 * 规则：累计次数每满 10 次弹一次「感觉不错？」，同一个计数值只弹一次
 * （`lastPrompted` 记在用户配置里，重开 EDA 也不会重复弹）。
 *
 * --- 边界 ---
 * 计数只存在扩展用户配置里，**不在界面上显示**，只把当前次数打到控制台方便排查；
 * 不写 EDA 日志面板、不写更新日志。任何失败都静默——计数属于附赠能力，
 * 不能因为它报错而打断「转原理图」本身。
 *
 * 连点必须一次不漏：所有记录动作走同一条串行队列（见 `recordUsage`），
 * 避免两次并发点击都读到同一个旧值、各自 +1 后互相覆盖。
 *
 * 存储用 `sys_Storage.getExtensionUserConfig / setExtensionUserConfig` 的键值接口
 * （与工时统计、基准测试一致），不用 `getExtensionAllUserConfigs` 的全量读写——
 * 前者不会因为别的配置项变化而互相覆盖。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import { getEda } from '../core/eda.js';
import { logger } from '../core/log.js';
import { showRewardDialog } from './rewardDialog.js';

/** 累计使用次数的配置键 */
const COUNT_KEY = 'PCB_TO_SCH_USAGE_COUNT';

/** 最近一次已经弹过的计数值（同一个数值只弹一次） */
const PROMPTED_KEY = 'PCB_TO_SCH_REWARD_PROMPTED';

/** 每满多少次弹一次 */
const PROMPT_STEP = 10;

/** 会话内缓存：存储读取有开销，读取失败时也靠它保证本次会话的计数不倒退 */
let countCache = null;
let promptedCache = null;

/** 记录动作的串行队列：连点时保证「读 → 加一 → 写」不会交错 */
let queue = Promise.resolve();

/**
 * 把存储里的值转成非负整数
 *
 * @param {*} value 原始值（可能是数字、数字字符串或 undefined）
 * @returns {number} 非负整数；无法解析时为 0
 */
function toCount(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * 读一个配置项
 *
 * 宿主不可用（浏览器直开调试）或接口抛错时返回 null，由调用方兜底。
 *
 * @param {string} key 配置键
 * @returns {Promise<string|null>} 配置值；读不到为 null
 * @sideEffects eda API（sys_Storage.getExtensionUserConfig）
 */
async function readValue(key) {
	try {
		const host = getEda();
		if (!host || !host.sys_Storage) return null;
		const raw = await host.sys_Storage.getExtensionUserConfig(key);
		return raw === undefined || raw === null ? null : raw;
	} catch (e) {
		return null;
	}
}

/**
 * 写一个配置项
 *
 * @param {string} key 配置键
 * @param {string} value 配置值
 * @returns {Promise<boolean>} 是否写入成功
 * @sideEffects eda API（sys_Storage.setExtensionUserConfig）
 */
async function writeValue(key, value) {
	try {
		const host = getEda();
		if (!host || !host.sys_Storage) return false;
		return (await host.sys_Storage.setExtensionUserConfig(key, value)) !== false;
	} catch (e) {
		return false;
	}
}

/**
 * 当前累计次数（优先会话缓存，首次才读存储）
 *
 * @returns {Promise<number>} 累计次数
 * @sideEffects 首次调用读 eda API
 */
async function readCount() {
	if (countCache === null) countCache = toCount(await readValue(COUNT_KEY));
	return countCache;
}

/**
 * 最近一次弹过的计数值
 *
 * @returns {Promise<number>} 计数值；没弹过为 0
 * @sideEffects 首次调用读 eda API
 */
async function readPrompted() {
	if (promptedCache === null) promptedCache = toCount(await readValue(PROMPTED_KEY));
	return promptedCache;
}

/**
 * 读当前累计使用次数（不改变任何状态）
 *
 * 仅供排查使用，不在界面上展示。
 *
 * @returns {Promise<number>} 累计次数
 * @sideEffects 首次调用读 eda API
 */
export function getUsageCount() {
	return readCount();
}

/**
 * 判断这一刻是否该弹窗
 *
 * 三个条件缺一不可：是正数、是 10 的整数倍、这个计数值还没弹过。
 *
 * @param {number} count 累计次数
 * @param {number} prompted 最近一次弹过的计数值
 * @returns {boolean} 该弹为 true
 */
export function shouldPrompt(count, prompted) {
	return count > 0 && count % PROMPT_STEP === 0 && prompted !== count;
}

/**
 * 单次记录：读 → 加一 → 落盘 → 打控制台 → 判定弹窗
 *
 * 只由 `recordUsage` 的队列调用，不对外暴露（避免绕过队列造成并发覆盖）。
 *
 * @param {Function} showDialog 弹窗函数
 * @returns {Promise<number>} 自增后的累计次数；失败为 -1
 * @sideEffects 读写 eda 存储、console、可能插入浮层
 */
async function recordOnce(showDialog) {
	try {
		const count = (await readCount()) + 1;
		countCache = count;
		await writeValue(COUNT_KEY, String(count));
		// 每次点击都把当前次数打到控制台（界面上不显示，EDA 日志面板也不写）
		logger.info(`累计转换次数：${count}`);

		if (shouldPrompt(count, await readPrompted())) {
			// 先落盘「已弹过」再弹：避免同一次操作里重入导致连弹两次
			promptedCache = count;
			await writeValue(PROMPTED_KEY, String(count));
			showDialog({ title: '感觉不错？', count });
		}
		return count;
	} catch (e) {
		// 计数是附赠能力：失败就算了，不打断调用方
		return -1;
	}
}

/**
 * 记一次「从 PCB 转原理图」的成功操作，满 10 次时弹赞赏引导
 *
 * 允许连点：所有调用排进同一条队列，逐个「读 → 加一 → 写」，
 * 连点 N 次就是 +N，不会因为两次点击读到同一个旧值而丢计数。
 *
 * 先写计数再判定弹窗：即使弹窗被拦下，次数也已经落盘，不会少记一次。
 * 写计数失败时仍继续走判定（本次会话的缓存值是对的），只是下次开 EDA 可能少算。
 *
 * @param {Function} [showDialog] 弹窗函数（默认「感觉不错？」浮层，测试可注入替身）
 * @returns {Promise<number>} 自增后的累计次数；整体失败为 -1
 * @sideEffects 写 eda 存储、console、可能插入浮层
 */
export function recordUsage(showDialog = showRewardDialog) {
	const task = queue.then(() => recordOnce(showDialog));
	// 队列自身必须吞掉异常，否则一次失败会让后续所有记录都卡在 rejected 上
	queue = task.catch(() => undefined);
	return task;
}
