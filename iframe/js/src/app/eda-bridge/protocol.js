/**
 * @//module/ app/eda-bridge/protocol
 * @//description/ 桥协议的两块纯逻辑：地址解析与「安全序列化」（EDA 返回值常含循环引用/函数/节点）
 * @//exports/ parseAddr, safeJson, SAFE_JSON_LIMITS
 * @//dependencies/ 无
 * @//example/ const { parseAddr, safeJson } = await import('./protocol.js')
 *            parseAddr('http://127.0.0.1:8233') // { host: '127.0.0.1', port: '8233' }
 *            safeJson({ a: () => 1, b: window })  // { a: '[Function a]', b: {...} }
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 序列化上限（超过就截断，避免一次回传几 MB） */
export const SAFE_JSON_LIMITS = Object.freeze({ maxDepth: 4, maxArray: 200, maxKeys: 100 });

/**
 * 解析地址输入
 *
 * 接受 `127.0.0.1:8233` / `127.0.0.1` / `http://127.0.0.1:8233` 三种写法。
 *
 * @param {string} input 输入框内容
 * @returns {{host: string, port: string}} 主机与端口（非法端口回退 8233）
 * @sideEffects 无（纯函数）
 */
export function parseAddr(input) {
	const raw = String(input || '')
		.trim()
		.replace(/^[a-zA-Z]+:\/\//, '');
	let host = raw;
	let port = '8233';
	const lastColon = raw.lastIndexOf(':');
	if (lastColon >= 0) {
		host = raw.slice(0, lastColon);
		port = raw.slice(lastColon + 1) || '8233';
	}
	host = (host || '').replace(/^:+|:+$/g, '').trim();
	if (!host) host = '127.0.0.1';
	if (!/^\d+$/.test(port)) port = '8233';
	return { host: host, port: port };
}

/** 标量类型 → 降级后的值（不在表里的类型继续往下走） */
const SCALARS = new Map([
	['number', (value) => value],
	['boolean', (value) => value],
	['string', (value) => value],
	['bigint', (value) => String(value)],
	['function', (value) => '[Function ' + (value.name || 'anonymous') + ']'],
	['symbol', (value) => String(value)],
]);

/**
 * Promise / Blob / Node 这类对象只报类型，避免污染结果
 *
 * @param {*} value 任意对象
 * @returns {string|undefined} 占位串；普通对象返回 undefined
 * @sideEffects 无（纯函数）
 */
function specialObjectOf(value) {
	if (typeof value.then === 'function') return '[Promise]';
	if (typeof Blob !== 'undefined' && value instanceof Blob) return '[Blob ' + value.size + 'B]';
	if (typeof Node !== 'undefined' && value instanceof Node) return '[Node ' + value.nodeName + ']';
	return undefined;
}

/**
 * 普通对象：逐键降级，限制键数量
 *
 * @param {object} value 对象
 * @param {number} depth 当前深度
 * @returns {object} 可安全序列化的普通对象
 * @sideEffects 无（纯函数）
 */
function plainObjectOf(value, depth) {
	const out = {};
	let count = 0;
	for (const key in value) {
		if (count++ >= SAFE_JSON_LIMITS.maxKeys) {
			out['…'] = '省略';
			break;
		}
		try {
			out[key] = safeJson(value[key], depth + 1);
		} catch (e) {
			out[key] = '[不可读]';
		}
	}
	return out;
}

/**
 * 把任意值转成可 JSON 序列化的形状
 *
 * EDA 的返回值经常带循环引用、函数、DOM 节点，直接 `JSON.stringify` 会抛错，
 * 导致「指令执行成功但结果回不来」。这里按类型降级，并限制深度/数组长度/键数量。
 *
 * @param {*} value 任意值
 * @param {number} [depth=0] 当前深度（内部递归用）
 * @returns {*} 可安全序列化的值
 * @sideEffects 无（纯函数，不修改入参）
 */
export function safeJson(value, depth = 0) {
	if (value === null || value === undefined) return null;

	const scalar = SCALARS.get(typeof value);
	if (scalar) return scalar(value);
	if (depth > SAFE_JSON_LIMITS.maxDepth) return '[MaxDepth]';

	if (Array.isArray(value)) {
		return value.slice(0, SAFE_JSON_LIMITS.maxArray).map((item) => safeJson(item, depth + 1));
	}

	const special = specialObjectOf(value);
	if (special !== undefined) return special;

	return plainObjectOf(value, depth);
}
