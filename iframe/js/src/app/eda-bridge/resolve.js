/**
 * @//module/ app/eda-bridge/resolve
 * @//description/ 立创 C 编号 → 器件 UUID 的解析：本页缓存 → 批量查询 → 并发逐个兜底
 * @//exports/ resolveUuids, normCno
 * @//dependencies/ app/eda-bridge/concurrent
 * @//example/ const { resolveUuids } = await import('./resolve.js')
 *            const { map, stats } = await resolveUuids(['C965184'], host, push, log)
 *
 * 为什么要专门做：`lib_Device.getByLcscIds` 是网络级查询（一次几百毫秒）。
 * 一块板 100 个元件往往只有十来种料号，逐个串行查会把导入拖成几分钟。
 * 这里做三件事：**去重**（按料号而不是按元件查）、**批量**（一次带多个编号）、
 * **本页缓存**（同一次会话里第二次导入 0 次查询）。
 *
 * ⚠️ 两个实测坑：
 *   1. 传**单个字符串**时 V4 返回的是器件对象、不是数组（传数组才返回数组）——必须归一；
 *   2. 批量结果靠 `supplierId` 回映 C 编号；万一一条都没有，只能按返回顺序对齐，
 *      但必须先单查第一个核对 uuid —— 顺序错位等于整批元件换成别的型号。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { mapLimit } from './concurrent.js';

/** 本页缓存：C 编号 -> {uuid, lib}（跨会话的持久缓存由工作台后端负责） */
const CNO_CACHE = new Map();

/** 一次批量查询最多带多少个 C 编号（太大怕宿主截断，太小又退化成逐个） */
const RESOLVE_BATCH = 50;

/** 批量不可用 / 有缺项时，逐个查询的并发度 */
const RESOLVE_CONCURRENCY = 6;

/**
 * C 编号归一：去空白、转大写
 *
 * @param {*} value 原始值
 * @returns {string} 归一后的编号；空值返回空串
 * @sideEffects 无
 */
export function normCno(value) {
	return String(value == null ? '' : value)
		.trim()
		.toUpperCase();
}

/**
 * 错误文案
 *
 * @param {*} err 异常
 * @returns {string} 可读文案
 * @sideEffects 无
 */
function errText(err) {
	return (err && err.message) || String(err);
}

/**
 * 把 API 返回值归一成数组（数组 / 单个对象 / 空）
 *
 * @param {*} raw 返回值
 * @returns {Array} 数组
 * @sideEffects 无
 */
function asList(raw) {
	if (Array.isArray(raw)) return raw;
	return raw ? [raw] : [];
}

/**
 * 切片
 *
 * @param {Array} arr 原数组
 * @param {number} size 每片长度
 * @returns {Array<Array>} 切片
 * @sideEffects 无
 */
function chunkOf(arr, size) {
	const out = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/**
 * 器件对象里带的 C 编号（立创器件的 supplierId 就是 C 编号）
 *
 * @param {object} device 器件对象
 * @returns {string} C 编号；没有则空串
 * @sideEffects 无
 */
function devCno(device) {
	return normCno(device && (device.supplierId || device.lcscId || device.supplierNo || ''));
}

/**
 * 器件对象 -> 缓存条目
 *
 * @param {object} device 器件对象
 * @returns {{uuid: string, lib: string}|null} 条目；没有 uuid 为 null
 * @sideEffects 无
 */
function devEntry(device) {
	return device && device.uuid ? { uuid: device.uuid, lib: device.libraryUuid || '' } : null;
}

/**
 * 去重并分出「缓存命中」与「待查」
 *
 * @param {string[]} cnos 原始编号列表（可重复）
 * @returns {{want: string[], map: object, todo: string[]}} 去重列表 / 命中项 / 待查项
 * @sideEffects 无
 */
function splitCached(cnos) {
	const want = [];
	const seen = Object.create(null);
	for (const value of cnos) {
		const key = normCno(value);
		if (!key || seen[key]) continue;
		seen[key] = 1;
		want.push(key);
	}
	const map = {};
	const todo = [];
	for (const key of want) {
		const hit = CNO_CACHE.get(key);
		if (hit && hit.uuid) map[key] = hit;
		else todo.push(key);
	}
	return { want, map, todo };
}

/**
 * 批量结果 -> {map, rest}
 *
 * @param {string[]} part 本批请求的 C 编号
 * @param {object[]} list 批量返回的器件列表
 * @returns {{map: object, rest: string[], tagged: number}} 命中项 / 未命中 / 带 C 编号的条数
 * @sideEffects 无
 */
function takeBatch(part, list) {
	const byCno = new Map();
	for (const device of list) {
		const key = devCno(device);
		if (key && !byCno.has(key)) byCno.set(key, device);
	}
	const map = {};
	const rest = [];
	for (const cno of part) {
		const entry = devEntry(byCno.get(cno));
		if (entry) map[cno] = entry;
		else rest.push(cno);
	}
	return { map, rest, tagged: byCno.size };
}

/**
 * 单个编号查询（兜底路径）
 *
 * @param {string} cno C 编号
 * @param {object} host EDA 宿主
 * @returns {Promise<{uuid: string, lib: string}|null>} 条目
 * @sideEffects eda API
 */
async function queryOne(cno, host) {
	return devEntry(asList(await host.lib_Device.getByLcscIds(cno))[0]);
}

/**
 * 批量结果不带 C 编号时，抽第一个单查核对，判断能否按返回顺序对齐
 *
 * @param {string[]} part 本批请求的 C 编号
 * @param {object[]} list 批量返回的器件列表
 * @param {object} ctx 上下文（host / log）
 * @returns {Promise<boolean>} 顺序是否可信
 * @sideEffects eda API
 */
async function orderMatches(part, list, ctx) {
	try {
		const probe = devEntry(asList(await ctx.host.lib_Device.getByLcscIds(part[0]))[0]);
		const same = !!probe && probe.uuid === (list[0] && list[0].uuid);
		if (!same && ctx.log) ctx.log('批量结果与单查不一致，放弃按顺序对齐，改逐个查');
		return same;
	} catch (e) {
		return false;
	}
}

/**
 * 按返回顺序对齐一批结果（仅在「一条都不带 C 编号」时使用）
 *
 * @param {string[]} part 本批请求的 C 编号
 * @param {object[]} list 批量返回的器件列表
 * @param {object} ctx 上下文
 * @returns {Promise<string[]>} 仍未解析到的编号
 * @sideEffects eda API、写 ctx.map / CNO_CACHE / ctx.stats
 */
async function alignByIndex(part, list, ctx) {
	if (!(await orderMatches(part, list, ctx))) return part;
	const rest = [];
	for (let i = 0; i < part.length; i++) {
		const entry = devEntry(list[i]);
		if (entry) {
			ctx.map[part[i]] = entry;
			CNO_CACHE.set(part[i], entry);
			ctx.stats.got.push(part[i]);
		} else rest.push(part[i]);
	}
	if (ctx.log) ctx.log('批量结果不带 C 编号，已按返回顺序对齐 ' + part.length + ' 个（已核对首个）');
	return rest;
}

/**
 * 并发逐个查询（批量完全失败、或批量漏掉的那部分）
 *
 * @param {string[]} list 待查编号
 * @param {object} host EDA 宿主
 * @param {object} ctx 上下文
 * @returns {Promise<void>} 查完
 * @sideEffects eda API、写 ctx.map / CNO_CACHE / ctx.stats
 */
async function resolveEach(list, host, ctx) {
	if (!list.length) return;
	await mapLimit(list, RESOLVE_CONCURRENCY, async (cno) => {
		let entry = null;
		try {
			entry = await queryOne(cno, host);
			ctx.stats.single++;
		} catch (err) {
			if (ctx.log) ctx.log('查询失败 ' + cno + '：' + errText(err));
		}
		if (entry) {
			ctx.map[cno] = entry;
			CNO_CACHE.set(cno, entry);
			ctx.stats.got.push(cno);
		} else ctx.stats.miss.push(cno);
		ctx.push();
	});
}

/**
 * 解析一批（先批量、再兜底）
 *
 * @param {string[]} part 本批编号
 * @param {object} host EDA 宿主
 * @param {object} ctx 上下文
 * @returns {Promise<void>} 解析完
 * @sideEffects eda API、写 ctx
 */
async function resolveChunk(part, host, ctx) {
	let left = part;
	let list = null;
	try {
		list = asList(await host.lib_Device.getByLcscIds(part));
		ctx.stats.batch++;
	} catch (e) {
		if (ctx.log) ctx.log('批量查询不可用，改逐个查：' + errText(e));
	}
	if (list && list.length) {
		const got = takeBatch(part, list);
		for (const cno of Object.keys(got.map)) {
			ctx.map[cno] = got.map[cno];
			CNO_CACHE.set(cno, got.map[cno]);
			ctx.stats.got.push(cno);
		}
		left = got.rest;
		// 一条都没带 C 编号，但条数对得上 -> 抽一个核对后按顺序对齐
		if (got.tagged === 0 && got.rest.length === part.length && list.length === part.length && part.length > 1) {
			left = await alignByIndex(part, list, ctx);
		}
		ctx.push();
	}
	await resolveEach(left, host, ctx);
}

/**
 * 把一批 C 编号解析成 {cno: {uuid, lib}}
 *
 * @param {string[]} cnos C 编号列表（可重复，内部去重）
 * @param {object} host EDA 宿主对象
 * @param {(progress: object, force?: boolean) => void} [push] 进度回调（分母 = 去重后的料号数）
 * @param {(msg: string) => void} [log] 日志出口
 * @returns {Promise<{map: object, stats: object}>} 解析结果与统计
 * @sideEffects eda API
 */
export async function resolveUuids(cnos, host, push, log) {
	const { want, map, todo } = splitCached(cnos);
	const stats = { wanted: want.length, hit: want.length - todo.length, batch: 0, single: 0, miss: [], got: [] };
	const ctx = {
		host,
		map,
		stats,
		log,
		/**
		 * 上报解析进度
		 *
		 * @returns {void}
		 * @sideEffects 调用 push
		 */
		push: () => {
			if (!push) return;
			const done = stats.hit + stats.got.length;
			push({ phase: 'resolve', done, total: want.length }, done >= want.length);
		},
	};
	ctx.push();
	for (const part of chunkOf(todo, RESOLVE_BATCH)) await resolveChunk(part, host, ctx);
	return { map, stats };
}
