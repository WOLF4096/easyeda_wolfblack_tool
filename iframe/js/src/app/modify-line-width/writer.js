/**
 * @//module/ app/modify-line-width/writer
 * @//description/ 把表格输入翻成变更计划，并按「源码更新 / API 修改」两种方式写回
 * @//exports/ planChanges, writeBySource, writeByApi
 * @//dependencies/ core/length, core/version, core/concurrency, app/modify-line-width/sourceWidthWriter, app/modify-line-width/stats
 * @//example/ const { planChanges, writeByApi } = await import('./writer.js')
 *            const plan = planChanges(rows, 'mil')      // { widthMap, deleteIds, modify, remove, invalid }
 *            await writeByApi(eda, plan, { onProgress })
 *
 * 两条铁律：
 *   1. **目标线宽 = 0 → 删除**（不是写 0 宽，0 宽 API 与源码都不接受）；
 *   2. 源码模式改宽与删行在**同一次** `setDocumentSource` 里完成，绝不拆成两步
 *      （先删后写会把行"复活"，先写后删可能碰上文档重载后的 id 变化）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { mapInChunks } from '../../core/concurrency.js';
import { toApiLength } from '../../core/length.js';
import { isV2 } from '../../core/version.js';
import { rewriteWidths } from './sourceWidthWriter.js';
import { parseWidth } from './stats.js';

/** 图元种类 → 宿主 API 名 */
const API_OF = Object.freeze({ line: 'pcb_PrimitiveLine', arc: 'pcb_PrimitiveArc' });

/** 线宽相同判定阈值（mil）：小于它视为 no-op，不触发写入 */
const SAME_WIDTH_EPS = 1e-6;

/** 源码改写每处理多少行让出一次主线程 */
const SOURCE_YIELD_EVERY = 2000;

/** `setDocumentSource` 被误拒后的重试间隔 */
const RETRY_DELAY_MS = 300;

/**
 * 延迟
 *
 * @param {number} ms 毫秒
 * @returns {Promise<void>} 定时器 Promise
 * @sideEffects 定时器
 */
function delay(ms) {
	return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * 把一行的图元加进计划
 *
 * @param {object} plan 计划（就地修改）
 * @param {object} row 表格行
 * @param {number} target 目标线宽（mil）；0 表示删除
 * @returns {void}
 * @sideEffects **就地修改** `plan`
 */
function addRow(plan, row, target) {
	for (const item of row.items) {
		if (target === 0) {
			if (plan.deleteIds.has(item.id)) continue;
			plan.deleteIds.add(item.id);
			plan.remove.push({ id: item.id, kind: item.kind });
			continue;
		}
		if (plan.widthMap.has(item.id)) continue;
		plan.widthMap.set(item.id, target);
		plan.modify.push({ id: item.id, kind: item.kind, widthMil: target });
	}
}

/**
 * 扫表格输入，生成变更计划
 *
 * 三态：留空（`null`）跳过、`0` 删除、`>0` 改宽；与当前线宽相同按 no-op 跳过。
 *
 * @param {Array<object>} rows 表格行（含 `input` 与 `items`）
 * @param {'mil'|'mm'} unit 输入单位
 * @returns {{widthMap: Map<string, number>, deleteIds: Set<string>, modify: Array<object>, remove: Array<object>, invalid: Array<object>}} 计划
 * @sideEffects 无（纯函数）
 */
export function planChanges(rows, unit) {
	const plan = { widthMap: new Map(), deleteIds: new Set(), modify: [], remove: [], invalid: [] };

	(Array.isArray(rows) ? rows : []).forEach((row, index) => {
		const target = parseWidth(row.input, unit);
		if (target === null) return;

		if (Number.isNaN(target)) {
			plan.invalid.push({ index: index, text: row.input });
			return;
		}
		if (target !== 0 && Math.abs(target - Number(row.widthMil)) < SAME_WIDTH_EPS) return;

		addRow(plan, row, target);
	});

	return plan;
}

/**
 * 用源码方式写回（改宽 + 删行，一次写入）
 *
 * @param {object} host 宿主对象（`eda`）
 * @param {object} plan 变更计划
 * @param {object} [hooks] 钩子
 * @param {(done: number, total: number) => void} [hooks.onProgress] 改写进度
 * @returns {Promise<{ok: boolean, reason: string, changed: number, deleted: number, missing: number, ms: number}>} 结果
 * @sideEffects 读写文档源码
 */
export async function writeBySource(host, plan, hooks = {}) {
	const started = Date.now();
	const empty = { changed: 0, deleted: 0, missing: 0 };

	let source;
	try {
		source = await host.sys_FileManager.getDocumentSource();
	} catch (e) {
		console.error('读取源码失败:', e);
		return { ok: false, reason: 'read-failed', ...empty, ms: Date.now() - started };
	}
	if (!source) return { ok: false, reason: 'empty-source', ...empty, ms: Date.now() - started };

	const result = await rewriteWidths(source, plan, isV2(), {
		yieldEvery: SOURCE_YIELD_EVERY,
		onProgress: hooks.onProgress,
	});
	const summary = { changed: result.changed, deleted: result.deleted, missing: result.missing };

	if (result.changed === 0 && result.deleted === 0) {
		return { ok: false, reason: 'no-match', ...summary, ms: Date.now() - started };
	}

	let wrote = await host.sys_FileManager.setDocumentSource(result.text);
	if (!wrote) {
		await delay(RETRY_DELAY_MS);
		wrote = await host.sys_FileManager.setDocumentSource(result.text);
	}

	return { ok: !!wrote, reason: wrote ? '' : 'write-rejected', ...summary, ms: Date.now() - started };
}

/**
 * 按种类分组 id
 *
 * @param {Array<{id: string, kind: string}>} list 待删除项
 * @returns {Map<string, string[]>} 种类 → id 数组
 * @sideEffects 无（纯函数）
 */
function groupByKind(list) {
	const map = new Map();
	for (const item of list) {
		if (!map.has(item.kind)) map.set(item.kind, []);
		map.get(item.kind).push(item.id);
	}
	return map;
}

/**
 * 用 API 方式写回（逐条 modify + 每类一次 delete）
 *
 * 单条失败不中断整批：`mapInChunks` 的 mapper 抛错会中断，所以 try/catch 必须在 mapper 内部。
 *
 * @param {object} host 宿主对象（`eda`）
 * @param {object} plan 变更计划
 * @param {object} [hooks] 钩子
 * @param {(done: number, total: number) => void} [hooks.onProgress] 改写进度
 * @returns {Promise<{ok: boolean, modified: number, deleted: number, failed: string[], deleteFailed: string[], ms: number}>} 结果
 * @sideEffects 调用宿主 API（会改文档）
 */
export async function writeByApi(host, plan, hooks = {}) {
	const started = Date.now();
	const failed = [];
	const deleteFailed = [];
	let modified = 0;
	let deleted = 0;

	await mapInChunks(
		plan.modify,
		8,
		async (item) => {
			try {
				await host[API_OF[item.kind]].modify(item.id, { lineWidth: toApiLength(item.widthMil, 3) });
				modified += 1;
			} catch (e) {
				console.error(`修改线宽失败 ${item.id}:`, e);
				failed.push(item.id);
			}
		},
		{ onProgress: hooks.onProgress },
	);

	for (const [kind, ids] of groupByKind(plan.remove)) {
		try {
			await host[API_OF[kind]].delete(ids);
			deleted += ids.length;
		} catch (e) {
			console.error(`删除 ${kind} 失败:`, e);
			deleteFailed.push(...ids);
		}
	}

	return {
		ok: failed.length === 0 && deleteFailed.length === 0,
		modified: modified,
		deleted: deleted,
		failed: failed,
		deleteFailed: deleteFailed,
		ms: Date.now() - started,
	};
}
