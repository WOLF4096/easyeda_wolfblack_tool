/**
 * @//module/ app/eda-bridge/commands
 * @//description/ 桥的指令分发：ping / import / probe / eval（默认关闭远程执行，需勾选「调试指令」）
 * @//exports/ execItems, probePaths, createCommandHandler
 * @//dependencies/ app/eda-bridge/protocol
 * @//example/ const { createCommandHandler } = await import('./commands.js')
 *            const handle = createCommandHandler({ getHost, send, log, ver: '2.2', debugAllowed })
 *            handle({ id: 'c1', cmd: 'ping' })
 *
 * 协议是与 `tools/eda-bridge/server.mjs` 的跨仓契约：`{id, cmd}` 进、`{id, ok, ...}` 出，
 * 指令名与字段名改动必须两边同步（见 docs 里桥的说明）。
 */

import { safeJson } from './protocol.js';

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
		const item = list[i];
		try {
			if (item.type === 'component') {
				const uuid = item.uuid || (await resolveUuid(item.cno, host));
				await host.pcb_PrimitiveComponent.create({ libraryUuid: sysLibUuid, uuid: uuid }, item.layer || 1, item.x, item.y, item.rot || 0, !!item.lock);
			} else if (item.type === 'via') {
				await host.pcb_PrimitiveVia.create('', item.x, item.y, item.innerD, item.outerD, 0, null, null, false);
			} else if (item.type === 'line') {
				await host.pcb_PrimitiveLine.create('', item.layer || 1, item.x1, item.y1, item.x2, item.y2, item.width || 0.5, false);
			} else {
				errors.push(`第${i + 1}个：未知类型 ${item.type}`);
				continue;
			}
			count++;
		} catch (err) {
			errors.push(`第${i + 1}个(${item.type})：${(err && err.message) || err}`);
		}
	}

	if (log) log(`导入完成：成功 ${count}${errors.length ? '，失败 ' + errors.length : ''}`);
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
 * 创建指令处理器
 *
 * @param {object} deps 依赖
 * @param {() => object|null} deps.getHost 取宿主对象
 * @param {(payload: object) => void} deps.send 回传结果
 * @param {(msg: string) => void} [deps.log] 日志
 * @param {() => boolean} deps.debugAllowed 「调试指令」是否已勾选
 * @param {string} deps.ver 桥协议版本
 * @returns {(cmd: object) => Promise<void>} 处理器
 * @sideEffects 依指令而定（eval 会执行任意代码、import 会建图元）
 */
export function createCommandHandler(deps) {
	const getHost = deps.getHost;
	const send = deps.send;
	const log = deps.log || (() => {});
	const debugAllowed = deps.debugAllowed;
	const hasApi = () => {
		const host = getHost();
		return !!host && !!host.pcb_PrimitiveVia;
	};

	/**
	 * 通用执行通道（调试用，需勾选开关）
	 *
	 * @param {object} cmd 指令
	 * @returns {Promise<void>}
	 * @sideEffects eda API、任意代码执行
	 */
	async function handleEval(cmd) {
		const startedAt = Date.now();
		try {
			if (typeof cmd.code !== 'string' || !cmd.code.trim()) throw new Error('eval 缺少 code');
			// eslint-disable-next-line no-new-func
			const fn = new Function('eda', 'arg', 'WolfCommon', 'return (async () => {\n' + cmd.code + '\n})();');
			const raw = await fn(getHost() || null, cmd.arg, globalThis.WolfCommon || null);
			send({ id: cmd.id, ok: true, value: safeJson(raw), ms: Date.now() - startedAt });
		} catch (e) {
			send({ id: cmd.id, ok: false, error: String((e && (e.stack || e.message)) || e), ms: Date.now() - startedAt });
		}
	}

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
			send({ id: cmd.id, ver: deps.ver, ok: true, hasEda: hasApi(), debug: debugAllowed() });
			return;
		}

		if (cmd.cmd === 'eval' || cmd.cmd === 'probe') {
			if (!debugAllowed()) {
				send({ id: cmd.id, ok: false, error: '调试指令未开启：请勾选「调试指令」后重试' });
				return;
			}
			if (cmd.cmd === 'eval') await handleEval(cmd);
			else send({ id: cmd.id, ok: true, value: probePaths(cmd.paths, getHost()) });
			return;
		}

		if (cmd.cmd !== 'import') {
			send({ id: cmd.id, ok: false, error: '未知指令 ' + cmd.cmd });
			return;
		}

		const items = cmd.items || [];
		log('收到指令：导入 ' + items.length + ' 个对象');
		try {
			const result = await execItems(items, getHost(), log);
			result.errors.slice(0, 5).forEach((item) => log(item));
			send({ id: cmd.id, ok: result.ok, count: result.count, errors: result.errors });
		} catch (e) {
			log('执行异常：' + ((e && e.message) || e));
			send({ id: cmd.id, ok: false, count: 0, error: String((e && e.message) || e) });
		}
	};
}
