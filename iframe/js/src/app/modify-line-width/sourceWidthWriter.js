/**
 * @//module/ app/modify-line-width/sourceWidthWriter
 * @//description/ 逐行改 PCB 源码：改 LINE/ARC 的 width、或整行删除（V2 数组 / V3V4 日志）
 * @//exports/ createWidthRewriter, rewriteWidths
 * @//dependencies/ core/log, core/sourceLine
 * @//example/ const { rewriteWidths } = await import('./sourceWidthWriter.js')
 *            const plan = { widthMap: new Map([['e4', 8]]), deleteIds: new Set(['e5']) }
 *            const { text, changed, deleted, missing } = await rewriteWidths(src, plan, false)
 *
 * 底线：**未命中的行必须逐字节原样返回**（含行尾 `|` 的有无）。一次全量写回会重排整份文档，
 * 任何"顺手美化"都会变成用户文件里的假 diff。
 *
 * 改名/删行都只认 `LINE` / `ARC` 两种外层类型：同 id 若出现在别的类型上，绝不动。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { logger } from '../../core/log.js';
import { joinSourceLine, splitSourceLine } from '../../core/sourceLine.js';

/** V2 数组里 `width` 的下标：直线 9、圆弧 10（角度占了下标 9） */
const V2_WIDTH_INDEX = Object.freeze({ LINE: 9, ARC: 10 });

/** 允许改写的图元类型 */
const WRITABLE = Object.freeze({ LINE: true, ARC: true });

/**
 * 归一计划对象（容忍调用方传裸 Map）
 *
 * @param {object} plan 计划
 * @returns {{widthMap: Map<string, number>, deleteIds: Set<string>}} 归一结果
 * @sideEffects 无（纯函数）
 */
function normalizePlan(plan) {
	const widthMap = plan && plan.widthMap instanceof Map ? plan.widthMap : new Map();
	const deleteIds = plan && plan.deleteIds instanceof Set ? plan.deleteIds : new Set();
	return { widthMap: widthMap, deleteIds: deleteIds };
}

/**
 * 改写一行 V2 源码
 *
 * @param {string} line 原始行
 * @param {{widthMap: Map<string, number>, deleteIds: Set<string>}} plan 计划
 * @returns {{line: string|null, changedId: string|null, deletedId: string|null}} 结果
 * @sideEffects 无（纯函数）
 */
function rewriteV2Line(line, plan) {
	if (!line.trim().startsWith('[')) return { line: line, changedId: null, deletedId: null };

	let item;
	try {
		item = JSON.parse(line.replace(/^\s*/, ''));
	} catch {
		logger.debug('跳过无法解析的 V2 行');
		return { line: line, changedId: null, deletedId: null };
	}
	if (!Array.isArray(item) || !WRITABLE[item[0]]) return { line: line, changedId: null, deletedId: null };

	const id = item[1];
	if (typeof id !== 'string' || !id) return { line: line, changedId: null, deletedId: null };

	if (plan.deleteIds.has(id)) return { line: null, changedId: null, deletedId: id };
	if (!plan.widthMap.has(id)) return { line: line, changedId: null, deletedId: null };

	const index = V2_WIDTH_INDEX[item[0]];
	if (index >= item.length) return { line: line, changedId: null, deletedId: null };

	item[index] = plan.widthMap.get(id);
	return { line: JSON.stringify(item), changedId: id, deletedId: null };
}

/**
 * 改写一行 V3/V4 源码
 *
 * @param {string} line 原始行
 * @param {{widthMap: Map<string, number>, deleteIds: Set<string>}} plan 计划
 * @returns {{line: string|null, changedId: string|null, deletedId: string|null}} 结果
 * @sideEffects 无（纯函数）
 */
function rewriteModernLine(line, plan) {
	const parsed = splitSourceLine(line);
	if (!parsed) return { line: line, changedId: null, deletedId: null };

	const left = parsed.leftObj;
	if (!left || !WRITABLE[left.type]) return { line: line, changedId: null, deletedId: null };

	const id = left.id;
	if (typeof id !== 'string' || !id) return { line: line, changedId: null, deletedId: null };

	if (plan.deleteIds.has(id)) return { line: null, changedId: null, deletedId: id };
	if (!plan.widthMap.has(id)) return { line: line, changedId: null, deletedId: null };

	parsed.rightObj.width = plan.widthMap.get(id);
	return {
		line: joinSourceLine(parsed.leftStr, JSON.stringify(parsed.rightObj), parsed.hasTrailingPipe),
		changedId: id,
		deletedId: null,
	};
}

/**
 * 创建逐行改写器
 *
 * @param {object} plan 计划（`{ widthMap, deleteIds }`）
 * @param {boolean} v2Mode 是否 V2 数组格式（用 `core/version.js` 的 `isV2()` 判断）
 * @returns {(line: string) => {line: string|null, changedId: string|null, deletedId: string|null}} 改写函数
 * @sideEffects 无（纯函数，闭包只捕获入参）
 */
export function createWidthRewriter(plan, v2Mode) {
	const normalized = normalizePlan(plan);
	return (line) => {
		if (typeof line !== 'string' || !line.trim()) return { line: line, changedId: null, deletedId: null };
		return v2Mode ? rewriteV2Line(line, normalized) : rewriteModernLine(line, normalized);
	};
}

/**
 * 逐行统计命中情况
 *
 * @param {Array<string>} lines 源码行
 * @param {(line: string) => object} rewrite 改写函数
 * @param {object} state 累加器（就地修改）
 * @returns {string[]} 结果行（已去掉删除的行）
 * @sideEffects **就地修改** `state` 的计数与命中集合
 */
function applyLines(lines, rewrite, state) {
	const out = [];
	for (const line of lines) {
		const result = rewrite(line);
		if (result.line === null) {
			state.deleted += 1;
			state.hit.add(result.deletedId);
			continue;
		}
		if (result.changedId) {
			state.changed += 1;
			state.hit.add(result.changedId);
		}
		out.push(result.line);
	}
	return out;
}

/**
 * 统计「计划里有、源码里没找到」的条数
 *
 * @param {object} plan 归一后的计划
 * @param {Set<string>} hit 已命中的 id
 * @returns {number} 缺失条数
 * @sideEffects 无（纯函数）
 */
function countMissing(plan, hit) {
	let missing = 0;
	for (const id of plan.widthMap.keys()) {
		if (!hit.has(id)) missing += 1;
	}
	for (const id of plan.deleteIds) {
		if (!hit.has(id)) missing += 1;
	}
	return missing;
}

/**
 * 整份源码改写（改线宽 + 删行）
 *
 * @param {string} source 原始源码
 * @param {object} plan 计划（`{ widthMap: Map<id, mil>, deleteIds: Set<id> }`）
 * @param {boolean} v2Mode 是否 V2 数组格式
 * @param {object} [options] 选项
 * @param {number} [options.yieldEvery=0] 每处理这么多行让出一次主线程（0 = 不让出）
 * @param {(done: number, total: number) => void} [options.onProgress] 进度回调
 * @returns {Promise<{text: string, changed: number, deleted: number, missing: number}>} 结果
 * @sideEffects 定时器；调用 `onProgress`
 */
export async function rewriteWidths(source, plan, v2Mode, options = {}) {
	const normalized = normalizePlan(plan);
	const rewrite = createWidthRewriter(normalized, v2Mode);
	const lines = (typeof source === 'string' ? source : '').split('\n');
	const yieldEvery = Math.max(0, Number(options.yieldEvery) || 0);
	const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

	const state = { changed: 0, deleted: 0, hit: new Set() };
	const out = [];

	for (let start = 0; start < lines.length; start += yieldEvery || lines.length) {
		const end = yieldEvery ? Math.min(lines.length, start + yieldEvery) : lines.length;
		out.push(...applyLines(lines.slice(start, end), rewrite, state));
		if (yieldEvery && end < lines.length) {
			if (onProgress) onProgress(end, lines.length);
			await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
		}
	}

	return {
		text: out.join('\n'),
		changed: state.changed,
		deleted: state.deleted,
		missing: countMissing(normalized, state.hit),
	};
}
