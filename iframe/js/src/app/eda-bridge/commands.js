/**
 * @//module/ app/eda-bridge/commands
 * @//description/ 桥的指令分发：ping / import / probe / eval（远程执行门禁由页面注入，桥页恒为放行）
 * @//exports/ execItems, probePaths, createCommandHandler
 * @//dependencies/ app/eda-bridge/protocol, app/eda-bridge/concurrent, app/eda-bridge/resolve, core/eda, core/version, core/layer, core/netlist, core/sourceLine, core/length, core/util, core/log
 * @//example/ const { createCommandHandler } = await import('./commands.js')
 *            const handle = createCommandHandler({ getHost, send, log, ver: '2.3', debugAllowed })
 *            handle({ id: 'c1', cmd: 'ping' })
 *
 * 协议是与 `tools/eda-bridge/server.mjs` 的跨仓契约：`{id, cmd}` 进、`{id, ok, ...}` 出，
 * 指令名与字段名改动必须两边同步（见 docs 里桥的说明）。新增的 `resolved` / `stale` / `ms`
 * 都是**可选回显字段**，老消费端忽略即可。
 *
 * import 是两段式：**先解析料号（去重 + 批量 + 本页缓存），再并发建图元**。
 * 旧版在循环里逐个 `await resolveUuid`，100 个元件就是 100 次网络查询 —— 这才是导入慢的主因。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { mapLimit, throttled } from './concurrent.js';
import { normCno, resolveUuids } from './resolve.js';
import { NETLIST_KEY, getEda, hasEda } from '../../core/eda.js';
import { LAYER, isConductiveLayer, isInnerLayer } from '../../core/layer.js';
import { toApiLength } from '../../core/length.js';
import { logger } from '../../core/log.js';
import { getComponentsContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { joinSourceLine, splitSourceLine } from '../../core/sourceLine.js';
import { escapeHtml } from '../../core/util.js';
import { getEditorVersion, isModern, isV2 } from '../../core/version.js';
import { safeJson } from './protocol.js';

/** 并发建图元的数量（写死常量，避免再引入配置面；出问题把这里改成 1 即退回串行） */
const CREATE_CONCURRENCY = 8;

/** 进度上报节流（ms） */
const PROGRESS_GAP = 100;

/**
 * 注入给 `eval` 指令的公共对象（形如原来的 `window.WolfCommon`）
 *
 * 页面已经不再加载 `common.js`（模块化后源码在 `src/core/*`），但探针脚本长期以
 * `WolfCommon.xxx` 的写法取工具函数。这里用同一批模块现组一份，保持探针契约不变 ——
 * 否则所有历史探针都会拿到 `null` 而失败。
 */
const EVAL_CONTEXT = Object.freeze({
	NETLIST_KEY,
	getEda,
	hasEda,
	getEditorVersion,
	isV2,
	isModern,
	LAYER,
	isInnerLayer,
	isConductiveLayer,
	getNetlist,
	setNetlist,
	getComponentsContainer,
	splitSourceLine,
	joinSourceLine,
	toApiLength,
	escapeHtml,
	logger,
});

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
 * 建单个图元（三个 create 都是异步的，**必须 await**）
 *
 * 不 await 的后果不是「慢」，而是「报告成功但画布上什么都没有」—— 异常全变成
 * 未处理的 rejection，错误计数永远是 0。
 *
 * @param {object} item 图元描述
 * @param {object} host EDA 宿主对象
 * @param {string|null} sysLibUuid 系统库 uuid（只有 component 用）
 * @returns {Promise<void>} 建完
 * @throws {Error} 未知类型 / 宿主拒绝
 * @sideEffects eda API（pcb_PrimitiveComponent/Via/Line.create）
 */
async function createOne(item, host, sysLibUuid) {
	if (item.type === 'component') {
		/**
		 * 组装 create 的实参
		 *
		 * @param {string} libraryUuid 库 uuid
		 * @returns {Array} 实参列表
		 * @sideEffects 无
		 */
		const args = (libraryUuid) => [{ libraryUuid: libraryUuid, uuid: item.uuid }, item.layer || 1, item.x, item.y, item.rot || 0, !!item.lock];
		try {
			return await host.pcb_PrimitiveComponent.create(...args(item.lib || sysLibUuid));
		} catch (err) {
			// 缓存里的 libraryUuid 可能来自另一套库（换机 / 私有部署）—— 退回系统库再试一次
			if (item.lib && item.lib !== sysLibUuid) {
				item.lib = '';
				return await host.pcb_PrimitiveComponent.create(...args(sysLibUuid));
			}
			throw err;
		}
	}
	if (item.type === 'via') {
		return await host.pcb_PrimitiveVia.create('', item.x, item.y, item.innerD, item.outerD, 0, null, null, false);
	}
	if (item.type === 'line') {
		return await host.pcb_PrimitiveLine.create('', item.layer || 1, item.x1, item.y1, item.x2, item.y2, item.width || 0.5, false);
	}
	throw new Error('未知类型 ' + item.type);
}

/**
 * 收集本批需要解析的 C 编号（只收「元件 + 没有 uuid + 有 cno」的）
 *
 * @param {object[]} list 图元列表
 * @returns {string[]} C 编号（含重复，下游会去重）
 * @sideEffects 无
 */
function collectNeed(list) {
	const need = [];
	for (const item of list) {
		if (item.type === 'component' && !item.uuid && item.cno) need.push(item.cno);
	}
	return need;
}

/**
 * 把解析结果回填到 items 上
 *
 * @param {object[]} list 图元列表（就地改写）
 * @param {object} map C 编号 -> {uuid, lib}
 * @returns {void}
 * @sideEffects 改写 items
 */
function applyUuids(list, map) {
	for (const item of list) {
		if (item.type !== 'component' || item.uuid) continue;
		const entry = map[normCno(item.cno)];
		if (!entry || !entry.uuid) continue;
		item.uuid = entry.uuid;
		if (entry.lib) item.lib = entry.lib;
	}
}

/**
 * 打印料号解析的统计行（缓存命中 / 批量次数 / 逐个次数）
 *
 * @param {object} stats resolveUuids 的统计
 * @param {number} ms 耗时
 * @param {(msg: string) => void} [log] 日志出口
 * @returns {void}
 * @sideEffects console
 */
function logResolve(stats, ms, log) {
	if (!log) return;
	log(
		`料号解析：去重后 ${stats.wanted} 个｜缓存命中 ${stats.hit}｜批量 ${stats.batch} 次｜逐个 ${stats.single} 次｜未找到 ${stats.miss.length}｜` +
			ms +
			'ms',
	);
}

/**
 * 解析料号并把 uuid 回填到 items 上
 *
 * @param {object[]} list 图元列表（会被就地改写 uuid / lib）
 * @param {object} host EDA 宿主对象
 * @param {(progress: object, force?: boolean) => void|null} push 进度回调
 * @param {(msg: string) => void} [log] 日志出口
 * @returns {Promise<{ms: number, resolved: object}>} 耗时与新解析到的映射
 * @sideEffects eda API、改写 items
 */
async function fillUuids(list, host, push, log) {
	const need = collectNeed(list);
	if (!need.length) return { ms: 0, resolved: {} };

	const startedAt = Date.now();
	const result = await resolveUuids(need, host, push, log);
	applyUuids(list, result.map);
	const ms = Date.now() - startedAt;
	logResolve(result.stats, ms, log);
	return { ms: ms, resolved: result.map };
}

/**
 * 把「能建的」挑出来；解析不到 uuid 的元件直接记错
 *
 * @param {object[]} list 图元列表
 * @param {string[]} errors 错误收集器
 * @returns {Array<{item: object, index: number}>} 待建任务
 * @sideEffects 追加 errors
 */
function collectJobs(list, errors) {
	const jobs = [];
	list.forEach((item, index) => {
		if (item.type === 'component' && !item.uuid) {
			errors.push(`第${index + 1}个(component)：未找到 C 编号 ${item.cno || '(空)'} 对应的元件`);
			return;
		}
		jobs.push({ item: item, index: index });
	});
	return jobs;
}

/**
 * 失败条目串行重试一次
 *
 * 并发建图元偶尔会撞上「文档正忙」，重试基本都能过；仍失败的才计入错误。
 *
 * @param {Array<{item: object, index: number, msg: string}>} failed 失败列表
 * @param {object} host EDA 宿主对象
 * @param {string|null} sysLibUuid 系统库 uuid
 * @param {(msg: string) => void} [log] 日志出口
 * @returns {Promise<{ok: number, failed: Array}>} 重试成功数 / 仍失败列表
 * @sideEffects eda API
 */
async function retryFailed(failed, host, sysLibUuid, log) {
	if (!failed.length) return { ok: 0, failed: [] };
	if (log) log('并发创建失败 ' + failed.length + ' 个，串行重试…');
	let ok = 0;
	const again = [];
	for (const job of failed) {
		try {
			await createOne(job.item, host, sysLibUuid);
			ok++;
		} catch (err) {
			again.push({ item: job.item, index: job.index, msg: errText(err) });
		}
	}
	return { ok: ok, failed: again };
}

/**
 * 把仍然失败的条目写进 errors；「找不到器件」的顺带记进 stale（让工作台清缓存）
 *
 * @param {Array} failed 失败列表
 * @param {string[]} errors 错误收集器
 * @param {string[]} stale 失效 C 编号收集器
 * @returns {void}
 * @sideEffects 追加 errors / stale
 */
function appendErrors(failed, errors, stale) {
	for (const job of failed) {
		errors.push(`第${job.index + 1}个(${job.item.type})：${job.msg}`);
		const notFound = /未找到|找不到|not found|invalid uuid/i.test(job.msg);
		if (job.item.type === 'component' && job.item.cno && notFound) stale.push(normCno(job.item.cno));
	}
}

/**
 * 批量建图元（component / via / line）
 *
 * @param {Array<object>} items 图元描述
 * @param {object} host EDA 宿主对象
 * @param {(msg: string) => void} [log] 日志出口
 * @param {{onProgress?: (progress: object, force?: boolean) => void}} [opts] 选项
 * @returns {Promise<{ok: boolean, count: number, errors: string[], resolved: object, stale: string[], ms: object}>} 执行结果
 * @sideEffects eda API（pcb_PrimitiveComponent/Via/Line.create、lib_Device、lib_LibrariesList）
 */
export async function execItems(items, host, log, opts) {
	if (!host || !host.pcb_PrimitiveVia) throw new Error('当前环境未检测到 EDA API，请在立创EDA专业版中运行本页面');
	const list = Array.isArray(items) ? items : [];
	const startedAt = Date.now();
	const errors = [];
	const stale = [];
	let count = 0;

	// 元件：同一批只取一次系统库 UUID
	let sysLibUuid = null;
	if (list.some((item) => item.type === 'component')) sysLibUuid = await host.lib_LibrariesList.getSystemLibraryUuid();

	// ---- ① 料号解析 ----
	const push = (opts && opts.onProgress) || null;
	const resolvedInfo = await fillUuids(list, host, push, log);

	// ---- ② 并发创建 + 失败串行重试 ----
	const jobs = collectJobs(list, errors);
	const createAt = Date.now();
	let done = 0;
	const failed = [];
	/**
	 * 上报创建进度
	 *
	 * @param {boolean} force 是否强制发出
	 * @returns {void}
	 * @sideEffects 调用 push
	 */
	const report = (force) => {
		if (push) push({ phase: 'create', done: done, total: jobs.length }, force || done >= jobs.length);
	};
	report(true);

	await mapLimit(jobs, CREATE_CONCURRENCY, async (job) => {
		try {
			await createOne(job.item, host, sysLibUuid);
			count++;
		} catch (err) {
			failed.push({ item: job.item, index: job.index, msg: errText(err) });
		}
		done++;
		report(false);
	});

	const retried = await retryFailed(failed, host, sysLibUuid, log);
	count += retried.ok;
	appendErrors(retried.failed, errors, stale);

	const ms = { resolve: resolvedInfo.ms, create: Date.now() - createAt, total: Date.now() - startedAt };
	if (log) {
		log(
			`导入完成：成功 ${count}/${list.length}${errors.length ? '，失败 ' + errors.length : ''}｜解析 ${ms.resolve}ms｜创建 ${ms.create}ms｜合计 ${ms.total}ms｜并发 ${CREATE_CONCURRENCY}`,
		);
	}
	return { ok: errors.length === 0, count: count, errors: errors, resolved: resolvedInfo.resolved, stale: stale, ms: ms };
}

/**
 * 探测一批 API 路径是否存在（只读 typeof，不调用）
 *
 * 必须从 `eda` 根开始逐级下钻：早期实现把 `{ eda }` 当根，导致首段永远判定缺失。
 *
 * @param {string[]} paths 形如 `pcb_Net.getAllNetsName`
 * @param {object} host EDA 宿主对象
 * @returns {Record<string, string>} 路径 → `typeof` 或 `MISSING@段名`
 * @sideEffects 无（只读属性）
 */
export function probePaths(paths, host) {
	const out = {};
	for (const path of Array.isArray(paths) ? paths : []) {
		let current = host || null;
		let missingAt = null;
		for (const segment of String(path).split('.')) {
			if (current === null || current === undefined || !(segment in Object(current))) {
				missingAt = segment;
				break;
			}
			current = current[segment];
		}
		out[path] = missingAt ? 'MISSING@' + missingAt : typeof current;
	}
	return out;
}

/**
 * 通用执行通道（调试用，需勾选开关）
 *
 * @param {object} cmd 指令
 * @param {object} ctx 处理上下文（getHost / send / ver 等）
 * @returns {Promise<void>}
 * @sideEffects eda API、任意代码执行
 */
async function handleEval(cmd, ctx) {
	const startedAt = Date.now();
	try {
		if (typeof cmd.code !== 'string' || !cmd.code.trim()) throw new Error('eval 缺少 code');
		// eslint-disable-next-line no-new-func
		const fn = new Function('eda', 'arg', 'WolfCommon', 'return (async () => {\n' + cmd.code + '\n})();');
		const raw = await fn(ctx.getHost() || null, cmd.arg, EVAL_CONTEXT);
		ctx.send({ id: cmd.id, ok: true, value: safeJson(raw), ms: Date.now() - startedAt });
	} catch (e) {
		ctx.send({ id: cmd.id, ok: false, error: String((e && (e.stack || e.message)) || e), ms: Date.now() - startedAt });
	}
}

/**
 * ping：回协议版本、宿主可用性、调试开关状态
 *
 * @param {object} cmd 指令
 * @param {object} ctx 处理上下文
 * @returns {void}
 * @sideEffects 回传结果
 */
function handlePing(cmd, ctx) {
	ctx.send({ id: cmd.id, ver: ctx.ver, ok: true, hasEda: ctx.hasApi(), debug: ctx.debugAllowed() });
}

/**
 * eval / probe：远程执行门禁
 *
 * 页面上的「调试指令」勾选框已移除，桥页恒为放行；这里保留判断，方便以后需要收紧时
 * 只改注入的 `debugAllowed`，不必再动指令分发。
 *
 * @param {object} cmd 指令
 * @param {object} ctx 处理上下文
 * @returns {Promise<void>}
 * @sideEffects eda API、任意代码执行（eval）
 */
async function handleDebug(cmd, ctx) {
	if (!ctx.debugAllowed()) {
		ctx.send({ id: cmd.id, ok: false, error: '调试通道未开启：当前页面禁止远程执行代码' });
		return;
	}
	if (cmd.cmd === 'eval') await handleEval(cmd, ctx);
	else ctx.send({ id: cmd.id, ok: true, value: probePaths(cmd.paths, ctx.getHost()) });
}

/**
 * import：批量建图元
 *
 * 导入期间暂停「选中对象」采样：那 100ms 一次的 API 调用会和 create 抢 EDA 主线程。
 *
 * @param {object} cmd 指令
 * @param {object} ctx 处理上下文
 * @returns {Promise<void>}
 * @sideEffects eda API、回传结果、日志
 */
async function handleImport(cmd, ctx) {
	const items = cmd.items || [];
	ctx.log('收到指令：导入 ' + items.length + ' 个对象');
	const onProgress = throttled((progress) => ctx.sendProgress(cmd.id, progress), PROGRESS_GAP);
	if (ctx.pauseWatch) ctx.pauseWatch();
	try {
		const result = await execItems(items, ctx.getHost(), ctx.log, { onProgress: onProgress });
		result.errors.slice(0, 5).forEach((item) => ctx.log(item));
		ctx.send({
			id: cmd.id,
			ok: result.ok,
			count: result.count,
			errors: result.errors,
			resolved: result.resolved,
			stale: result.stale,
			ms: result.ms,
			concurrency: CREATE_CONCURRENCY,
			total: items.length,
		});
	} catch (e) {
		ctx.log('执行异常：' + errText(e));
		ctx.send({ id: cmd.id, ok: false, count: 0, error: errText(e) });
	} finally {
		if (ctx.resumeWatch) ctx.resumeWatch();
	}
}

/**
 * 创建指令处理器
 *
 * @param {object} deps 依赖
 * @param {() => object|null} deps.getHost 取宿主对象
 * @param {(payload: object) => void} deps.send 回传结果
 * @param {(msg: string) => void} [deps.log] 日志
 * @param {() => boolean} deps.debugAllowed 是否允许远程执行（桥页恒为 true）
 * @param {string} deps.ver 桥协议版本
 * @param {() => void} [deps.pauseWatch] 导入期间暂停选中采样
 * @param {() => void} [deps.resumeWatch] 导入结束后恢复选中采样
 * @returns {(cmd: object) => Promise<void>} 处理器
 * @sideEffects 依指令而定（eval 会执行任意代码、import 会建图元）
 */
export function createCommandHandler(deps) {
	const ctx = {
		getHost: deps.getHost,
		send: deps.send,
		log: deps.log || (() => {}),
		debugAllowed: deps.debugAllowed,
		pauseWatch: deps.pauseWatch || null,
		resumeWatch: deps.resumeWatch || null,
		ver: deps.ver,
		/**
		 * 上报导入进度（带指令 id，工作台据此区分是哪次导入）
		 *
		 * @param {string} id 指令 id
		 * @param {object} progress { phase, done, total }
		 * @returns {void}
		 * @sideEffects WebSocket
		 */
		sendProgress: (id, progress) => deps.send({ type: 'progress', id: id, progress: progress }),
		hasApi: () => {
			const host = ctx.getHost();
			return !!host && !!host.pcb_PrimitiveVia;
		},
	};

	/**
	 * 指令分发（策略表）
	 *
	 * @param {object} cmd 指令
	 * @returns {Promise<void>}
	 * @sideEffects 依指令而定
	 */
	return async function handle(cmd) {
		if (!cmd || !cmd.id) return;

		if (cmd.cmd === 'ping') {
			handlePing(cmd, ctx);
			return;
		}

		if (cmd.cmd === 'eval' || cmd.cmd === 'probe') {
			await handleDebug(cmd, ctx);
			return;
		}

		if (cmd.cmd !== 'import') {
			ctx.send({ id: cmd.id, ok: false, error: '未知指令 ' + cmd.cmd });
			return;
		}

		await handleImport(cmd, ctx);
	};
}
