#!/usr/bin/env node
/**
 * EDA 桥服务端（本地测试用）
 *
 * EDA 里的「EDA 桥」页面是 **WebSocket 客户端**，主动连到本服务 `ws://127.0.0.1:8233/ws/eda`。
 * 本服务提供两件事：
 *   1. WebSocket 通道：向桥下发指令、接收执行结果与「当前选中对象」采样；
 *   2. HTTP 控制面（同一端口）：让命令行/Agent 用 curl 直接下发指令并同步拿结果。
 *
 * HTTP 控制面：
 *   GET  /__status           → { connected, ver, selection, calls, uptime }
 *   POST /__cmd   {json}     → 转发指令给 EDA，等结果（默认 15s 超时）
 *   POST /__reset            → 清空计数
 *
 * 为什么自己写 WebSocket 而不装 `ws`：项目零运行时依赖，且这里只需服务端最常用的
 * 文本帧 + ping/close，避免为一个测试工具引入依赖。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.argv[2] || 8233);
const PATH = '/ws/eda';
const CMD_TIMEOUT = Number(process.env.EDA_BRIDGE_TIMEOUT || 15000);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 当前连上的桥（EDA 页面）。同一时刻只保留一个：新连接顶掉旧连接。 */
let sock = null;
let sockVer = '';
let selection = null;
let lastSeen = 0;
let calls = 0;
const started = Date.now();

/** 待回包的指令：id → { resolve, timer } */
const pending = new Map();
let seq = 0;

/* ------------------------------ WebSocket 帧 ------------------------------ */

const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** 组帧：服务端发出的帧不加掩码 */
function encodeFrame(opcode, payload) {
	const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
	const len = data.length;
	let head;
	if (len < 126) {
		head = Buffer.from([0x80 | opcode, len]);
	} else if (len < 65536) {
		head = Buffer.alloc(4);
		head[0] = 0x80 | opcode;
		head[1] = 126;
		head.writeUInt16BE(len, 2);
	} else {
		head = Buffer.alloc(10);
		head[0] = 0x80 | opcode;
		head[1] = 127;
		head.writeBigUInt64BE(BigInt(len), 2);
	}
	return Buffer.concat([head, data]);
}

/**
 * 增量解帧器：TCP 分片可能把一帧拆成多次 data 事件，也可能一次带多帧。
 * 这里维护缓冲，凑够一帧就吐一条消息。
 */
function createDecoder(onMessage) {
	let buf = Buffer.alloc(0);
	return (chunk) => {
		buf = Buffer.concat([buf, chunk]);
		for (;;) {
			if (buf.length < 2) return;
			const fin = (buf[0] & 0x80) !== 0;
			const opcode = buf[0] & 0x0f;
			const masked = (buf[1] & 0x80) !== 0;
			let len = buf[1] & 0x7f;
			let offset = 2;
			if (len === 126) {
				if (buf.length < offset + 2) return;
				len = buf.readUInt16BE(offset);
				offset += 2;
			} else if (len === 127) {
				if (buf.length < offset + 8) return;
				len = Number(buf.readBigUInt64BE(offset));
				offset += 8;
			}
			let mask = null;
			if (masked) {
				if (buf.length < offset + 4) return;
				mask = buf.subarray(offset, offset + 4);
				offset += 4;
			}
			if (buf.length < offset + len) return;
			let payload = buf.subarray(offset, offset + len);
			if (mask) {
				payload = Buffer.from(payload);
				for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
			}
			buf = buf.subarray(offset + len);
			// 不支持分片续帧（桥只发小 JSON，实测不会分片）；但要把 fin 之外的场景兜住
			if (!fin) continue;
			onMessage(opcode, payload);
		}
	};
}

/* ------------------------------ 与桥的会话 ------------------------------ */

function sendToBridge(obj) {
	if (!sock) return false;
	try {
		sock.write(encodeFrame(OP_TEXT, JSON.stringify(obj)));
		return true;
	} catch (e) {
		return false;
	}
}

/** 下发一条指令并等回包（按 id 匹配） */
function dispatch(command) {
	return new Promise((resolve) => {
		if (!sock) {
			resolve({ ok: false, error: 'EDA 桥未连接：请先在 EDA 里打开「EDA 桥」页面并点连接' });
			return;
		}
		const id = 'c' + ++seq;
		const timer = setTimeout(() => {
			pending.delete(id);
			resolve({ ok: false, error: `指令超时（${CMD_TIMEOUT}ms）：${command.cmd}`, id });
		}, CMD_TIMEOUT);
		pending.set(id, { resolve, timer });
		calls++;
		if (!sendToBridge({ ...command, id })) {
			clearTimeout(timer);
			pending.delete(id);
			resolve({ ok: false, error: '下发失败（连接已断开）' });
		}
	});
}

function onBridgeMessage(text) {
	let msg;
	try {
		msg = JSON.parse(text);
	} catch (e) {
		return;
	}
	// 主动上报：当前选中对象（每 500ms）
	if (msg.type === 'selection') {
		selection = msg.selection || null;
		lastSeen = Date.now();
		return;
	}
	// 指令回包
	if (msg.id && pending.has(msg.id)) {
		const { resolve, timer } = pending.get(msg.id);
		clearTimeout(timer);
		pending.delete(msg.id);
		resolve(msg);
	}
}

/* ------------------------------ HTTP + Upgrade ------------------------------ */

const server = http.createServer((req, res) => {
	const url = req.url.split('?')[0];

	if (url === '/__status') {
		const body = {
			connected: !!sock,
			ver: sockVer,
			selection,
			selectionAgeMs: lastSeen ? Date.now() - lastSeen : null,
			calls,
			uptimeSec: Math.round((Date.now() - started) / 1000),
			pending: pending.size,
		};
		res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify(body, null, 2));
		return;
	}

	if (url === '/__reset' && req.method === 'POST') {
		calls = 0;
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end('{"ok":true}');
		return;
	}

	if (url === '/__cmd' && req.method === 'POST') {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', async () => {
			let cmd;
			try {
				cmd = JSON.parse(body);
			} catch (e) {
				res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
				res.end(JSON.stringify({ ok: false, error: '请求体不是合法 JSON' }));
				return;
			}
			const result = await dispatch(cmd);
			res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(result));
		});
		return;
	}

	res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end('EDA 桥服务端：用 POST /__cmd 下发指令，GET /__status 查看状态');
});

server.on('upgrade', (req, socket, head) => {
	if (req.url.split('?')[0] !== PATH) {
		socket.destroy();
		return;
	}
	const key = req.headers['sec-websocket-key'];
	if (!key) {
		socket.destroy();
		return;
	}
	const accept = crypto
		.createHash('sha1')
		.update(key + GUID)
		.digest('base64');
	socket.write(
		'HTTP/1.1 101 Switching Protocols\r\n' + 'Upgrade: websocket\r\n' + 'Connection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
	);

	// 新连接顶掉旧连接（EDA 里重复点「连接」时不会互相干扰）
	if (sock) {
		try {
			sock.destroy();
		} catch (e) {
			/* 忽略 */
		}
	}
	sock = socket;
	sockVer = '';
	lastSeen = Date.now();
	process.stderr.write('[eda-bridge] 桥已连接\n');

	const decode = createDecoder((opcode, payload) => {
		if (opcode === OP_TEXT) {
			onBridgeMessage(payload.toString('utf8'));
			return;
		}
		if (opcode === OP_PING) {
			socket.write(encodeFrame(OP_PONG, payload));
			return;
		}
		if (opcode === OP_CLOSE) {
			try {
				socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
			} catch (e) {
				/* 忽略 */
			}
			socket.destroy();
		}
	});

	if (head && head.length) decode(head);
	socket.on('data', decode);
	socket.on('error', () => {});
	socket.on('close', () => {
		if (sock === socket) {
			sock = null;
			process.stderr.write('[eda-bridge] 桥已断开\n');
		}
	});

	// 首次连上先要一次版本，便于日志确认 EDA 里加载的是哪一版桥
	dispatch({ cmd: 'ping' }).then((r) => {
		if (r && r.ver) {
			sockVer = r.ver;
			process.stderr.write(`[eda-bridge] 桥版本 ${r.ver}\n`);
		}
	});
});

server.listen(PORT, '127.0.0.1', () => {
	process.stdout.write(`[eda-bridge] 监听 http://127.0.0.1:${PORT}（WS 路径 ${PATH}）\n`);
});
