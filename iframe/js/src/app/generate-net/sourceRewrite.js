/**
 * @//module/ app/generate-net/sourceRewrite
 * @//description/ 把新网络名写进 PCB 源码行（V2 数组格式 / V3V4 日志格式），逐行纯变换
 * @//exports/ createLineRewriter, rewriteNetInSource
 * @//dependencies/ core/log, core/sourceLine
 * @//example/ const { createLineRewriter } = await import('./sourceRewrite.js')
 *            const rewrite = createLineRewriter(netMap, isV2())   // netMap: 图元id → 新网络名
 *            const { line, changedId } = rewrite(oldLine)
 *
 * 三种写入方式里只有这一种「不依赖宿主 API」，所以必须保证换行/行尾 `|` 逐字节可还原：
 * 未命中的行必须**原样返回入参**，否则一次全量写回会改动整份文件。
 */

import { logger } from '../../core/log.js';
import { joinSourceLine, splitSourceLine } from '../../core/sourceLine.js';

/**
 * 改写一行 V2 源码
 *
 * PAD_NET 行的 id 由 `compId + padSuffix` 拼成；其余图元的网络在第 3 个字段。
 *
 * @param {string} line 原始行
 * @param {Map<string, string>} netMap 图元 id → 新网络名
 * @returns {{line: string, changedId: string|null}} 结果
 * @sideEffects 无（纯函数）
 */
function rewriteV2Line(line, netMap) {
	let item;
	try {
		item = JSON.parse(line.replace(/^\s*/, ''));
	} catch {
		return { line: line, changedId: null };
	}
	if (!Array.isArray(item)) return { line: line, changedId: null };

	if (item[0] === 'PAD_NET') {
		const fullId = item[1] + item[4];
		if (!netMap.has(fullId)) return { line: line, changedId: null };
		item[3] = netMap.get(fullId);
		return { line: JSON.stringify(item), changedId: fullId };
	}

	const id = item[1];
	if (netMap.has(id) && item[3] !== undefined && typeof item[3] === 'string') {
		item[3] = netMap.get(id);
		return { line: JSON.stringify(item), changedId: id };
	}
	return { line: line, changedId: null };
}

/**
 * 改写一行 V3/V4 源码
 *
 * 行切分与拼装统一走 `core/sourceLine`，保证改写后逐字节可还原（含行尾 `|`）。
 *
 * @param {string} line 原始行
 * @param {Map<string, string>} netMap 图元 id → 新网络名
 * @returns {{line: string, changedId: string|null}} 结果
 * @sideEffects 无（纯函数）
 */
function rewriteModernLine(line, netMap) {
	const parsed = splitSourceLine(line);
	if (!parsed) return { line: line, changedId: null };

	const leftObj = parsed.leftObj;
	const rightObj = parsed.rightObj;
	let changedId = null;

	if (leftObj.type === 'PAD_NET') {
		changedId = modernPadNetId(leftObj.id, netMap);
		if (changedId) rightObj.padNet = netMap.get(changedId);
	} else if (leftObj.id && netMap.has(leftObj.id)) {
		changedId = leftObj.id;
		rightObj.netName = netMap.get(changedId);
	}

	if (!changedId) return { line: line, changedId: null };
	return { line: joinSourceLine(parsed.leftStr, JSON.stringify(rightObj), parsed.hasTrailingPipe), changedId: changedId };
}

/**
 * 从 PAD_NET 行的 `id` 里算出「compId + padSuffix」形式的真实 id
 *
 * @param {string} idRaw 行里的 id 字段（可能是 `["PAD_NET", compId, pin, padSuffix]` 的 JSON 串）
 * @param {Map<string, string>} netMap 图元 id → 新网络名
 * @returns {string|null} 命中的 id；未命中返回 null
 * @sideEffects 无（纯函数）
 */
function modernPadNetId(idRaw, netMap) {
	if (typeof idRaw !== 'string' || !idRaw.startsWith('[')) return null;
	let idParts;
	try {
		idParts = JSON.parse(idRaw);
	} catch {
		logger.debug('跳过无法解析的 PAD_NET 行');
		return null;
	}
	if (!Array.isArray(idParts) || idParts.length < 4) return null;
	const realId = idParts[1] + idParts[3];
	return netMap.has(realId) ? realId : null;
}

/**
 * 创建逐行改写器
 *
 * @param {Map<string, string>} netMap 图元 id → 新网络名
 * @param {boolean} v2Mode 是否 V2 格式
 * @returns {(line: string) => {line: string, changedId: string|null}} 改写函数
 * @sideEffects 无（纯函数，闭包只捕获入参）
 */
export function createLineRewriter(netMap, v2Mode) {
	return (line) => {
		if (!line || !line.trim()) return { line: line, changedId: null };
		return v2Mode ? rewriteV2Line(line, netMap) : rewriteModernLine(line, netMap);
	};
}

/**
 * 整份改写（便捷入口，进度回调由调用方在 `onLine` 里做）
 *
 * @param {string[]} lines 源码行
 * @param {Map<string, string>} netMap 图元 id → 新网络名
 * @param {boolean} v2Mode 是否 V2 格式
 * @param {(done: number, total: number, changedId: string|null) => void} [onLine] 每行回调
 * @returns {{lines: string[], changed: number}} 改写结果与改动行数
 * @sideEffects 调用 `onLine`
 */
export function rewriteNetInSource(lines, netMap, v2Mode, onLine) {
	const rewrite = createLineRewriter(netMap, v2Mode);
	const out = [];
	let changed = 0;

	for (const line of lines) {
		const result = rewrite(line);
		if (result.changedId) changed += 1;
		out.push(result.line);
		if (onLine) onLine(out.length, lines.length, result.changedId);
	}

	return { lines: out, changed: changed };
}
