/**
 * @//module/ app/eda-bridge/commands
 * @//description/ 桥的指令分发：ping / import / probe / eval（远程执行门禁由页面注入，桥页恒为放行）
 * @//exports/ execItems, probePaths, createCommandHandler
 * @//dependencies/ app/eda-bridge/protocol, core/eda, core/version, core/layer, core/netlist, core/sourceLine, core/length, core/util, core/log
 * @//example/ const { createCommandHandler } = await import('./commands.js')
 *            const handle = createCommandHandler({ getHost, send, log, ver: '2.2', debugAllowed })
 *            handle({ id: 'c1', cmd: 'ping' })
 *
 * 协议是与 `tools/eda-bridge/server.mjs` 的跨仓契约：`{id, cmd}` 进、`{id, ok, ...}` 出，
 * 指令名与字段名改动必须两边同步（见 docs 里桥的说明）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { safeJson } from './protocol.js';
import { NETLIST_KEY, getEda, hasEda } from '../../core/eda.js';
import { getEditorVersion, isModern, isV2 } from '../../core/version.js';
import { LAYER, isConductiveLayer, isInnerLayer } from '../../core/layer.js';
import { getComponentsContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { joinSourceLine, splitSourceLine } from '../../core/sourceLine.js';
import { toApiLength } from '../../core/length.js';
import { escapeHtml } from '../../core/util.js';
import { logger } from '../../core/log.js';

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
 * 批量建图元（component / via / line）
 *
 * 注意：三个 `create` 都是**异步**的，必须 await —— 早先漏了 await 会出现
 * 「报告成功但画布上什么都没有」。
 *
 * @param {Array<object>} items 图元描述
 * @param {object} host EDA 宿主对象
 * @param {(msg: string) => void} [log] 日志出口
 * @returns {Promise<{ok: boolean, count: number, errors: string[]}>} 执行结果
 * @sideEffects eda API（pcb_PrimitiveComponent/Via/Line.create、lib_Device、lib_LibrariesList）
 */
/**
 * 建单条图元
 *
 * @param {object} item 图元描述
 * @param {object} host EDA 宿主对象
 * @param {string|null} sysLibUuid 系统库 uuid（只有 component 用）
 * @returns {Promise<boolean>} 是否已处理；false 表示未知类型
 * @sideEffects eda API（pcb_PrimitiveComponent/Via/Line.create、lib_Device）
 */
async function createOne(item, host, sysLibUuid) {
	if (item.type === 'component') {
		const uuid = item.uuid || (await resolveUuid(item.cno, host));
		await host.pcb_PrimitiveComponent.create({ libraryUuid: sysLibUuid, uuid: uuid }, item.layer || 1, item.x, item.y, item.rot || 0, !!item.lock);
		return true;
	}
	if (item.type === 'via') {
		await host.pcb_PrimitiveVia.create('', item.x, item.y, item.innerD, item.outerD, 0, null, null, false);
		return true;
	}
	if (item.type === 'line') {
		await host.pcb_PrimitiveLine.create('', item.layer || 1, item.x1, item.y1, item.x2, item.y2, item.width || 0.5, false);
		return true;
	}
	return false;
}

/**
 * 执行单条图元（失败只记账，不中断整批）
 *
 * @param {object} item 图元描述
 * @param {number} index 下标
 * @param {object} host EDA 宿主对象
 * @param {string|null} sysLibUuid 系统库 uuid
 * @param {string[]} errors 错误收集器
 * @returns {Promise<number>} 成功条数（0 或 1）
 * @sideEffects eda API、追加 `errors`
 */
async function execOne(item, index, host, sysLibUuid, errors) {
	try {
		if (await createOne(item, host, sysLibUuid)) return 1;
		errors.push(`第${index + 1}个：未知类型 ${item.type}`);
	} catch (err) {
		errors.push(`第${index + 1}个(${item.type})：${(err && err.message) || err}`);
	}
	return 0;
}

/**
 * 导入完成的日志文案
 *
 * @param {number} count 成功条数
 * @param {number} errorCount 失败条数
 * @returns {string} 文案
 * @sideEffects 无（纯函数）
 */
function importSummary(count, errorCount) {
	return `导入完成：成功 ${count}${errorCount ? '，失败 ' + errorCount : ''}`;
}

export async function execItems(items, host, log) {
	if (!host || !host.pcb_PrimitiveVia) throw new Error('当前环境未检测到 EDA API，请在立创EDA专业版中运行本页面');
	const list = Array.isArray(items) ? items : [];
	const errors = [];
	let count = 0;

	// 元件：同一批只取一次系统库 UUID
	let sysLibUuid = null;
	if (list.some((item) => item.type === 'component')) {
		sysLibUuid = await host.lib_LibrariesList.getSystemLibraryUuid();
	}

	for (let i = 0; i < list.length; i++) {
		count += await execOne(list[i], i, host, sysLibUuid, errors);
	}

	if (log) log(importSummary(count, errors.length));
	return { ok: errors.length === 0, count: count, errors: errors };
}

/**
 * 通过立创编号查器件 UUID
 *
 * @param {string} cno 立创编号（C 开头）
 * @param {object} host EDA 宿主对象
 * @returns {Promise<string>} 器件 uuid
 * @throws {Error} 查不到时抛出
 * @sideEffects eda API（lib_Device.getByLcscIds）
 */
async function resolveUuid(cno, host) {
	const result = await host.lib_Device.getByLcscIds(cno);
	const list = Array.isArray(result) ? result : result ? [result] : [];
	if (list.length === 0) throw new Error('API 未找到 C 编号 ' + cno + ' 对应的元件');
	return list[0].uuid;
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
 * @param {object} cmd 指令
 * @param {object} ctx 处理上下文
 * @returns {Promise<void>}
 * @sideEffects eda API、回传结果、日志
 */
async function handleImport(cmd, ctx) {
	const items = cmd.items || [];
	ctx.log('收到指令：导入 ' + items.length + ' 个对象');
	try {
		const result = await execItems(items, ctx.getHost(), ctx.log);
		result.errors.slice(0, 5).forEach((item) => ctx.log(item));
		ctx.send({ id: cmd.id, ok: result.ok, count: result.count, errors: result.errors });
	} catch (e) {
		ctx.log('执行异常：' + ((e && e.message) || e));
		ctx.send({ id: cmd.id, ok: false, count: 0, error: String((e && e.message) || e) });
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
 * @returns {(cmd: object) => Promise<void>} 处理器
 * @sideEffects 依指令而定（eval 会执行任意代码、import 会建图元）
 */
export function createCommandHandler(deps) {
	const ctx = {
		getHost: deps.getHost,
		send: deps.send,
		log: deps.log || (() => {}),
		debugAllowed: deps.debugAllowed,
		ver: deps.ver,
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
