/**
 * @//module/ app/eda-bridge/index
 * @//description/ 页面编排：WebSocket 连接（唯一通道）+ 选中对象采样上报 + UI 状态自校对
 * @//exports/ 无
 * @//dependencies/ core/eda, app/eda-bridge/protocol, app/eda-bridge/commands
 * @//example/ 页面入口，由 iframe/EDABridge.html 加载打包产物 app/EDABridge.js
 *
 * 这是一条**调试/自动化测试通道**，不属于任何业务功能：不读网表、不写文档。
 * 与 `tools/eda-bridge/server.mjs` 通过 `/ws/eda` 通信，指令契约见 commands.js。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../../core/eda.js';
import { createCommandHandler } from './commands.js';
import { parseAddr } from './protocol.js';

/** 桥协议版本（不是 EDA 版本） */
const VER = '2.2';

/** 采样间隔 / 回传间隔 */
const SAMPLE_MS = 100;
const PUSH_MS = 500;

const $ = (id) => document.getElementById(id);

let ws = null;
let selSampleTimer = null;
let selPushTimer = null;
let selBusy = false;
let watchStarted = false;
let lastSel = null; // 最近一次「选中对象」参数；未选中时保留上一次（继承）

/**
 * 控制台日志（页面上不显示）
 *
 * @param {...*} args 日志参数
 * @returns {void}
 * @sideEffects console
 */
function log(...args) {
	try {
		console.log('[EDA桥]', ...args);
	} catch (e) {
		/* 控制台不可用时忽略 */
	}
}

/**
 * 更新状态文字与指示灯
 *
 * @param {string} text 状态文字
 * @param {boolean} ok 是否已连接
 * @returns {void}
 * @sideEffects DOM
 */
function setStatus(text, ok) {
	const statusEl = $('st');
	const dotEl = $('dot');
	if (statusEl) statusEl.textContent = text;
	if (dotEl && dotEl.classList) dotEl.classList.toggle('ok', !!ok);
}

/**
 * 连接是否可用
 *
 * @returns {boolean} `readyState === 1`
 * @sideEffects 无
 */
function wsOpen() {
	return !!ws && ws.readyState === 1;
}

/**
 * 「调试指令」是否可用
 *
 * 页面上已不再提供勾选框：这条桥本来就是开发者自测通道，开关留在界面上只会
 * 让普通用户误点。命令分发侧的 `debugAllowed()` 依赖契约保留，恒为允许。
 *
 * @returns {boolean} 恒为 true
 * @sideEffects 无
 */
function debugAllowed() {
	return true;
}

/**
 * 发送一条消息（未连接时静默失败）
 *
 * @param {object} payload 消息
 * @returns {boolean} 是否发出
 * @sideEffects WebSocket
 */
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

const handleCommand = createCommandHandler({
	getHost: getEda,
	send: send,
	log: log,
	debugAllowed: debugAllowed,
	ver: VER,
});

/**
 * 宿主是否具备「按 id 取 Object 图元」所需的三组 API
 *
 * @param {object|null} host EDA 宿主对象
 * @returns {boolean} 是否可用
 * @sideEffects 无
 */
function hasObjectApi(host) {
	return !!(
		host &&
		host.pcb_SelectControl &&
		host.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId &&
		host.pcb_PrimitiveObject &&
		host.pcb_PrimitiveObject.get
	);
}

/**
 * 选中集返回值归一成数组（可能是真正的数组，也可能是类数组）
 *
 * @param {*} ids 选中集返回值
 * @returns {Array} id 列表
 * @sideEffects 无
 */
function toIdList(ids) {
	if (Array.isArray(ids)) return ids;
	return ids && typeof ids.length === 'number' ? Array.prototype.slice.call(ids) : [];
}

/**
 * 是否是需要采样的 Object 图元（尺寸必须是数字）
 *
 * @param {*} obj API 返回的图元
 * @returns {boolean} 是否命中
 * @sideEffects 无
 */
function isSampledObject(obj) {
	return !!(obj && obj.primitiveType === 'Object' && typeof obj.width === 'number' && typeof obj.height === 'number');
}

/**
 * 从 Object 图元取出要上报的参数
 *
 * @param {object} obj Object 图元
 * @param {*} fallbackId 选中集里的 id（图元没带 id 时兜底）
 * @returns {object} 选中参数
 * @sideEffects 无
 */
function selectionOf(obj, fallbackId) {
	return {
		topLeftX: obj.topLeftX,
		topLeftY: obj.topLeftY,
		width: obj.width,
		height: obj.height,
		rotation: obj.rotation || 0,
		mirror: !!obj.mirror,
		primitiveId: obj.primitiveId || String(fallbackId),
	};
}

/**
 * 在选中集里找第一个 Object 图元
 *
 * @param {object} host EDA 宿主对象
 * @param {Array} list 选中 id 列表
 * @returns {Promise<object|null>} 选中参数；没找到为 null
 * @sideEffects eda API（pcb_PrimitiveObject.get）
 */
async function findFirstObject(host, list) {
	for (let i = 0; i < list.length; i++) {
		try {
			const obj = await host.pcb_PrimitiveObject.get(list[i]);
			if (isSampledObject(obj)) return selectionOf(obj, list[i]);
		} catch (e) {
			/* 该对象不是 Object，跳过 */
		}
	}
	return null;
}

/**
 * 采样当前选中对象（只认 Object 类型，取第一个命中的）
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（选中集 / pcb_PrimitiveObject.get）
 */
async function sampleSelection() {
	if (selBusy) return;
	selBusy = true;
	try {
		const host = getEda();
		if (hasObjectApi(host)) {
			const ids = await host.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
			const found = await findFirstObject(host, toIdList(ids));
			if (found) lastSel = found;
		}
	} catch (e) {
		/* 忽略单次采样失败 */
	}
	selBusy = false;
}

/**
 * 回传选中对象（未选中时沿用上一次，兼作保活）
 *
 * @returns {void}
 * @sideEffects WebSocket
 */
function pushSelection() {
	send({ type: 'selection', selection: lastSel });
}

/**
 * 启动采样与回传定时器（幂等）
 *
 * @returns {void}
 * @sideEffects 注册定时器
 */
function startWatch() {
	if (watchStarted) return;
	watchStarted = true;
	selSampleTimer = setInterval(sampleSelection, SAMPLE_MS);
	selPushTimer = setInterval(pushSelection, PUSH_MS);
}

/**
 * 停止采样与回传（幂等）
 *
 * @returns {void}
 * @sideEffects 清除定时器
 */
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

/**
 * 建立连接（先关旧连接，不自动重连）
 *
 * @returns {void}
 * @sideEffects WebSocket、DOM
 */
function connectWS() {
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

	const addr = parseAddr($('addr') ? $('addr').value : '');
	const url = 'ws://' + addr.host + ':' + addr.port + '/ws/eda';
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
		let message;
		try {
			message = JSON.parse(ev.data);
		} catch (e) {
			return;
		}
		void handleCommand(message);
	};
	sock.onclose = () => {
		if (ws !== sock) return; // 已被新连接/主动断开取代
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

/**
 * 主动断开
 *
 * @returns {void}
 * @sideEffects WebSocket、DOM
 */
function disconnect() {
	stopWatch();
	const old = ws;
	ws = null; // 先置空：old.onclose 会因 ws !== old 被忽略
	if (old) {
		try {
			old.close();
		} catch (e) {
			log('关闭连接时出错（通常可忽略）');
		}
	}
	setStatus('未连接', false);
}

if ($('conn'))
	$('conn').onclick = () => {
		disconnect();
		connectWS();
	};
if ($('disc')) $('disc').onclick = disconnect;

/* 状态自校对：每 500ms 让界面与真实 socket 状态一致，杜绝「已断开但显示已连接」 */
setInterval(() => {
	const on = wsOpen();
	const shown = $('st') && $('st').textContent === '已连接';
	if (on !== shown) setStatus(on ? '已连接' : '未连接', on);
}, 500);

setStatus('未连接', false);
const initial = parseAddr($('addr') ? $('addr').value : '');
if ($('bar')) $('bar').title = 'EDA桥 v' + VER + '（仅 WebSocket）';
log('EDA桥 v' + VER + ' 已就绪（只使用 WebSocket），正在自动连接 ' + initial.host + ':' + initial.port);
if (!getEda()) log('提示：未检测到 EDA API —— 请确认本页面在立创EDA专业版环境中打开');
connectWS();
