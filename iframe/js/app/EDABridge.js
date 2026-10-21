'use strict';
/* EDA 单文件桥：接收后端下发的指令，在 EDA 环境执行 pcb_Primitive*.create，并回传结果。
   通道【只使用 WebSocket】（/ws/eda），不做 HTTP 轮询降级：
   连接断开即显示「未连接」，不再自动重连（点「连接」重新建立）。

   支持的指令（后端 → 桥）：
     { id, cmd:"ping" }                     → 回传 { ver, hasEda }
     { id, cmd:"import", items:[...] }      → 建图元（component / via / line）
     { id, cmd:"probe", paths:["a.b.c"] }   → 只探测 API 是否存在（不调用）
     { id, cmd:"eval", code:"return 1" }    → 在页面上下文执行代码（可用 eda / arg）

   另外：持续监听「当前选中对象」的参数（每 100ms 采样一次；每 500ms 回传最新的
   一次结果），供工作台获取当前选中图像的坐标 / 尺寸 / 旋转；未选中任何对象时
   沿用上一次的结果（继承上一次坐标），不回传空值。 */

const VER = '2.2'; // 版本号：便于确认 EDA 里加载的是哪一版
const $ = (id) => document.getElementById(id);
let ws = null;

// 仅输出到控制台，页面上不显示日志
function log(...a) {
	try {
		console.log('[EDA 桥]', ...a);
	} catch (e) {
		// 控制台不可用时忽略
	}
}

function setStatus(txt, ok) {
	$('st').textContent = txt;
	$('dot').classList.toggle('ok', !!ok);
}
function wsOpen() {
	return !!ws && ws.readyState === 1;
}

function hasEda() {
	return typeof eda !== 'undefined' && eda && eda.pcb_PrimitiveVia;
}

// 解析地址：「127.0.0.1:8233」/「127.0.0.1」/「http://127.0.0.1:8233」都可以
function parseAddr() {
	let s = ($('addr').value || '').trim().replace(/^[a-zA-Z]+:\/\//, '');
	let host = s,
		port = '8233';
	const i = s.lastIndexOf(':');
	if (i >= 0) {
		host = s.slice(0, i);
		port = s.slice(i + 1) || '8233';
	}
	host = (host || '').replace(/^:+|:+$/g, '').trim();
	if (!host) host = '127.0.0.1';
	if (!/^\d+$/.test(port)) port = '8233';
	return { host: host, port: port };
}

/* ============ 指令执行 ============ */
// 一律走 EDA API 查 UUID：从下拉选中的封装由工作台随指令带 it.uuid（免查 API），
// 手输的 C 编号才会进到这里。
async function resolveUuid(cno) {
	const t = await eda.lib_Device.getByLcscIds(cno);
	if (!t || !t.length) throw new Error('API 未找到 C 编号 ' + cno + ' 对应的元件');
	return t[0].uuid;
}

async function execItems(items) {
	if (!hasEda()) throw new Error('当前环境未检测到 EDA API，请在立创EDA专业版中运行本页面');
	let count = 0;
	const errors = [];

	// 元件：同一批只取一次系统库 UUID
	let sysLibUuid = null;
	if (items.some((it) => it.type === 'component')) sysLibUuid = await eda.lib_LibrariesList.getSystemLibraryUuid();

	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		try {
			if (it.type === 'component') {
				const uuid = it.uuid || (await resolveUuid(it.cno));
				eda.pcb_PrimitiveComponent.create({ libraryUuid: sysLibUuid, uuid: uuid }, it.layer || 1, it.x, it.y, it.rot || 0, !!it.lock);
				count++;
			} else if (it.type === 'via') {
				eda.pcb_PrimitiveVia.create(
					'', // NET（不需要）
					it.x,
					it.y,
					it.innerD, // 孔直径
					it.outerD, // 焊盘直径
					0, // 过孔类型：普通
					null, // 设计规则名称（不需要）
					null, // 阻焊扩展
					false,
				);
				count++;
			} else if (it.type === 'line') {
				eda.pcb_PrimitiveLine.create(
					'', // 网络名称
					it.layer || 1, // 层编号
					it.x1,
					it.y1,
					it.x2,
					it.y2,
					it.width || 0.5, // 线宽
					false,
				);
				count++;
			} else {
				errors.push(`第${i + 1}个：未知类型 ${it.type}`);
			}
		} catch (err) {
			errors.push(`第${i + 1}个(${it.type})：${(err && err.message) || err}`);
		}
	}
	return { ok: errors.length === 0, count: count, errors: errors };
}

/* ---- 结果序列化：EDA 的返回值常含循环引用 / 函数 / DOM 节点，直接 JSON.stringify 会抛 ---- */
function safeJson(v, depth) {
	depth = depth || 0;
	if (v === null || v === undefined) return v === undefined ? null : null;
	const t = typeof v;
	if (t === 'number' || t === 'boolean' || t === 'string') return v;
	if (t === 'bigint') return String(v);
	if (t === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
	if (t === 'symbol') return String(v);
	if (depth > 4) return '[MaxDepth]';
	if (Array.isArray(v)) return v.slice(0, 200).map((x) => safeJson(x, depth + 1));
	// Promise / Blob / 节点这类对象：只报类型，避免污染结果
	if (typeof v.then === 'function') return '[Promise]';
	if (typeof Blob !== 'undefined' && v instanceof Blob) return '[Blob ' + v.size + 'B]';
	if (typeof Node !== 'undefined' && v instanceof Node) return '[Node ' + v.nodeName + ']';
	const out = {};
	let n = 0;
	for (const k in v) {
		if (n++ >= 100) {
			out['…'] = '省略';
			break;
		}
		try {
			out[k] = safeJson(v[k], depth + 1);
		} catch (e) {
			out[k] = '[不可读]';
		}
	}
	return out;
}

/**
 * 在 EDA 页面上下文里执行一段代码，把结果回传
 *
 * 为什么需要：桥原先只支持 `import`（建图元），而插件有 27 个功能，各自的 API 契约
 * （网表读写、源码读写、选中集、图层、坐标单位）都要实测。逐条加指令会让桥无限膨胀，
 * 所以提供一条通用执行通道，测试脚本按需拼代码下发。
 *
 * 约定：code 内可直接用 `eda` / `arg`；用 `return` 返回结果（支持 await）。
 * 例：{ cmd:"eval", code:"return (await eda.pcb_Net.getAllNetsName()).length" }
 */
async function handleEval(cmd) {
	const t0 = Date.now();
	try {
		if (typeof cmd.code !== 'string' || !cmd.code.trim()) throw new Error('eval 缺少 code');
		// eslint-disable-next-line no-new-func
		const fn = new Function('eda', 'arg', 'WolfCommon', 'return (async () => {\n' + cmd.code + '\n})();');
		const raw = await fn(typeof eda !== 'undefined' ? eda : null, cmd.arg, window.WolfCommon || null);
		sendResult({ id: cmd.id, ok: true, value: safeJson(raw), ms: Date.now() - t0 });
	} catch (e) {
		sendResult({ id: cmd.id, ok: false, error: String((e && (e.stack || e.message)) || e), ms: Date.now() - t0 });
	}
}

/** 探测一批 API 路径是否存在（不调用，只看 typeof），用于核对版本间 API 差异 */
function handleProbe(cmd) {
	const out = {};
	for (const p of cmd.paths || []) {
		// 必须从 eda 根开始逐级下钻；早期实现误把 { eda } 当根，导致首段永远判定缺失
		let cur = typeof eda !== 'undefined' ? eda : null;
		let missingAt = null;
		for (const seg of String(p).split('.')) {
			if (cur === null || cur === undefined || !(seg in Object(cur))) {
				missingAt = seg;
				break;
			}
			cur = cur[seg];
		}
		out[p] = missingAt ? 'MISSING@' + missingAt : typeof cur;
	}
	sendResult({ id: cmd.id, ok: true, value: out });
}

/** 「调试指令」开关：默认关闭。开启后才允许 eval / probe，避免产品默认带一个远程执行入口 */
function debugAllowed() {
	const el = $('allowEval');
	return !!(el && el.checked);
}

async function handleCommand(cmd) {
	if (!cmd || !cmd.id) return;
	if (cmd.cmd === 'ping') {
		sendResult({ id: cmd.id, ok: true, ver: VER, hasEda: hasEda(), debug: debugAllowed() });
		return;
	}
	if (cmd.cmd === 'eval' || cmd.cmd === 'probe') {
		if (!debugAllowed()) {
			sendResult({ id: cmd.id, ok: false, error: '调试指令未开启：请勾选「调试指令」后重试' });
			return;
		}
		if (cmd.cmd === 'eval') {
			await handleEval(cmd);
		} else {
			handleProbe(cmd);
		}
		return;
	}
	if (cmd.cmd !== 'import') {
		sendResult({ id: cmd.id, ok: false, error: '未知指令 ' + cmd.cmd });
		return;
	}
	const items = cmd.items || [];
	log('收到指令：导入 ' + items.length + ' 个对象');
	try {
		const r = await execItems(items);
		log('执行完成：成功 ' + r.count + (r.errors.length ? '，失败 ' + r.errors.length : ''));
		r.errors.slice(0, 5).forEach((e) => log(e));
		sendResult({ id: cmd.id, ok: r.ok, count: r.count, errors: r.errors });
	} catch (e) {
		log('执行异常：' + ((e && e.message) || e));
		sendResult({ id: cmd.id, ok: false, count: 0, error: String((e && e.message) || e) });
	}
}

// 只走 WebSocket
function send(payload) {
	if (!wsOpen()) {
		log('未连接，发送失败：', payload);
		return false;
	}
	try {
		ws.send(JSON.stringify(payload));
		return true;
	} catch (e) {
		log('发送失败：' + ((e && e.message) || e));
		return false;
	}
}
function sendResult(payload) {
	send(payload);
}

/* ============ 选中对象参数：100ms 采样 / 500ms 回传 ============ */
let selSampleTimer = null,
	selPushTimer = null,
	selBusy = false,
	watchStarted = false;
let lastSel = null; // 最近一次「选中对象」的参数；未选中时保留上一次（继承）

// 读取当前选中对象：只认 pcb_PrimitiveObject（图像/对象），取第一个命中的
async function sampleSelection() {
	if (selBusy) return;
	selBusy = true;
	try {
		if (
			hasEda() &&
			eda.pcb_SelectControl &&
			eda.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId &&
			eda.pcb_PrimitiveObject &&
			eda.pcb_PrimitiveObject.get
		) {
			const ids = await eda.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
			const arr = Array.isArray(ids) ? ids : ids && typeof ids.length === 'number' ? Array.prototype.slice.call(ids) : [];
			for (let i = 0; i < arr.length; i++) {
				try {
					const o = await eda.pcb_PrimitiveObject.get(arr[i]);
					if (o && o.primitiveType === 'Object' && typeof o.width === 'number' && typeof o.height === 'number') {
						lastSel = {
							topLeftX: o.topLeftX,
							topLeftY: o.topLeftY,
							width: o.width,
							height: o.height,
							rotation: o.rotation || 0,
							mirror: !!o.mirror,
							primitiveId: o.primitiveId || String(arr[i]),
						};
						break;
					}
				} catch (e) {
					/* 该对象不是 Object，跳过 */
				}
			}
		}
	} catch (e) {
		/* 忽略单次采样失败 */
	}
	selBusy = false;
}

function pushSelection() {
	// 未选中 -> 回传上一次（继承上一次坐标）；同时也起到保活作用
	send({ type: 'selection', selection: lastSel });
}

function startWatch() {
	if (watchStarted) return;
	watchStarted = true;
	selSampleTimer = setInterval(sampleSelection, 100); // 100ms 采样
	selPushTimer = setInterval(pushSelection, 500); // 500ms 回传最新
}
function stopWatch() {
	if (selSampleTimer) {
		clearInterval(selSampleTimer);
		selSampleTimer = null;
	}
	if (selPushTimer) {
		clearInterval(selPushTimer);
		selPushTimer = null;
	}
	watchStarted = false;
}

/* ============ WebSocket（唯一通道） ============ */
function connectWS() {
	// 关掉旧连接（其 onclose 会因 ws !== sock 而被忽略）
	const prev = ws;
	ws = null;
	if (prev) {
		try {
			prev.close();
		} catch (e) {
			log('关闭旧连接时出错（通常可忽略）');
		}
	}
	stopWatch();

	const a = parseAddr();
	const url = 'ws://' + a.host + ':' + a.port + '/ws/eda';
	let sock;
	try {
		sock = new WebSocket(url);
	} catch (e) {
		sock = null;
	}
	if (!sock) {
		setStatus('未连接', false);
		log('WebSocket 创建失败：' + url);
		return;
	}
	ws = sock;

	sock.onopen = () => {
		if (ws !== sock) return;
		setStatus('已连接', true);
		log('WebSocket 已连接 ' + url);
		startWatch();
	};
	sock.onmessage = (ev) => {
		if (ws !== sock) return;
		let m;
		try {
			m = JSON.parse(ev.data);
		} catch (e) {
			return;
		}
		handleCommand(m);
	};
	sock.onclose = () => {
		if (ws !== sock) return; // 已被新连接/主动断开取代，不处理
		ws = null;
		stopWatch();
		setStatus('未连接', false);
		log('WebSocket 已断开 ' + url);
	};
	sock.onerror = () => {
		try {
			sock.close();
		} catch (e) {
			log('关闭连接时出错（通常可忽略）');
		}
	};
}

function disconnect() {
	stopWatch();
	const old = ws;
	ws = null; // 先置空：old.onclose 会因 ws !== old 被忽略
	if (old) {
		try {
			old.close();
		} catch (e) {
			log('关闭旧连接时出错（通常可忽略）');
		}
	}
	setStatus('未连接', false);
}

$('conn').onclick = () => {
	disconnect();
	connectWS();
};
$('disc').onclick = disconnect;

/* 状态自校对：每 500ms 强制让界面显示与真实 socket 状态一致，
   杜绝「已点断开但界面仍显示已连接」这类不一致 */
setInterval(() => {
	const on = wsOpen();
	if (on !== ($('st').textContent === '已连接')) setStatus(on ? '已连接' : '未连接', on);
}, 500);

/* 启动即自动连接（仅一次，不自动重连） */
setStatus('未连接', false);
const _a = parseAddr();
$('bar').title = 'EDA 桥 v' + VER + '（仅 WebSocket）';
log('EDA 桥 v' + VER + ' 已就绪（只使用 WebSocket），正在自动连接 ' + _a.host + ':' + _a.port);
if (!hasEda()) log('提示：未检测到 EDA API —— 请确认本页面在立创EDA专业版环境中打开');
connectWS();
