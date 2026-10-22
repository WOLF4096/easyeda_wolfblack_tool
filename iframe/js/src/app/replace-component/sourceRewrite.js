/**
 * @//module/ app/replace-component/sourceRewrite
 * @//description/ 按图元 ID 改写 PCB 源码行（V2 数组格式 / V3V4 日志格式），纯字符串处理
 * @//exports/ rewriteLine, rewriteSource
 * @//dependencies/ 无
 * @//example/ const { rewriteSource } = await import('./sourceRewrite.js')
 *            const next = rewriteSource(await eda.sys_FileManager.getDocumentSource(), targetMap)
 *            await eda.sys_FileManager.setDocumentSource(next)
 *
 * ⚠️ 两条实测约束写在这里，拆文件时**必须连注释一起搬**：
 *   1. V4 只改 ATTR `Device` 换不掉器件 —— 必须同时改 COMPONENT 行的 `attrs.DeviceName`；
 *   2. 行尾 `|` 不是全都有（EDA 写盘残留），改写后必须按原样补回，否则整行被丢弃。
 */

/**
 * 从 action 里取出某个属性该写成什么
 *
 * @param {object} action 替换动作
 * @param {string} key 属性名（Device / Name / Footprint）
 * @returns {string|undefined} 新值；`undefined` 表示这一行不需要改（保留原值）
 * @sideEffects 无（纯函数）
 */
function pickReplacement(action, key) {
	if (key === 'Device') return action.targetDeviceUuid;
	if (key === 'Name') return action.preserveName ? undefined : action.targetName;
	if (key === 'Footprint') return action.preserveFootprint ? undefined : action.targetFootprintUuid;
	return undefined;
}

/**
 * 改写 V2 数组格式的单行（`["ATTR", id, ..., parentId, ..., key, value]`）
 *
 * @param {string} line 原始行
 * @param {Map<string, object>} targetMap 图元 ID → 替换动作
 * @returns {string} 改写后的行；不需要改时原样返回入参
 * @sideEffects 无（纯函数）
 */
function rewriteV2Line(line, targetMap) {
	let arr;
	try {
		arr = JSON.parse(line);
	} catch {
		return line;
	}
	if (!Array.isArray(arr) || arr[0] !== 'ATTR') return line;

	const action = targetMap.get(arr[3]);
	if (!action) return line;

	const next = pickReplacement(action, arr[7]);
	if (next === undefined) return line;

	arr[8] = next;
	return JSON.stringify(arr);
}

/**
 * 重组成 `{head}||{tail}`，并按原样补回行尾 `|`
 *
 * @param {object} head 前半段对象
 * @param {object} tail 后半段对象
 * @param {boolean} hasTrailingPipe 原行是否有行尾 `|`
 * @returns {string} 新行
 * @sideEffects 无（纯函数）
 */
function joinModernLine(head, tail, hasTrailingPipe) {
	return JSON.stringify(head) + '||' + JSON.stringify(tail) + (hasTrailingPipe ? '|' : '');
}

/**
 * 改写 V3/V4 日志格式的单行（`{head}||{tail}|`）
 *
 * 两处必须改：
 *   - `COMPONENT` 行的 `attrs.DeviceName`（器件引用的权威字段，V4 才有）
 *   - `ATTR` 行的 `value`（Device / Name / Footprint 的投影）
 *
 * @param {string} line 原始行
 * @param {Map<string, object>} targetMap 图元 ID → 替换动作
 * @returns {string} 改写后的行；不需要改时原样返回入参
 * @sideEffects 无（纯函数）
 */
function rewriteModernLine(line, targetMap) {
	const hasTrailingPipe = line.endsWith('|');
	const cleanLine = hasTrailingPipe ? line.slice(0, -1) : line;
	const parts = cleanLine.split('||');
	if (parts.length !== 2) return line;

	let head;
	let tail;
	try {
		head = JSON.parse(parts[0]);
		tail = JSON.parse(parts[1]);
	} catch {
		return line;
	}

	if (head.type === 'COMPONENT') {
		const action = targetMap.get(head.id);
		if (!action || !action.targetDeviceNameJson) return line;
		tail.attrs = tail.attrs || {};
		tail.attrs.DeviceName = action.targetDeviceNameJson;
		return joinModernLine(head, tail, hasTrailingPipe);
	}

	if (head.type === 'ATTR') {
		const action = targetMap.get(tail.parentId);
		if (!action) return line;
		const next = pickReplacement(action, tail.key);
		if (next === undefined) return line;
		tail.value = next;
		return joinModernLine(head, tail, hasTrailingPipe);
	}

	return line;
}

/**
 * 改写单行源码（自动识别 V2 数组格式与 V3V4 日志格式）
 *
 * @param {string} line 原始行（不含换行符）
 * @param {Map<string, object>} targetMap 图元 ID → 替换动作
 * @returns {string} 改写后的行；未命中或无需修改时原样返回
 * @sideEffects 无（纯函数）
 */
export function rewriteLine(line, targetMap) {
	if (!line || !line.trim()) return line;
	if (line.startsWith('[')) return rewriteV2Line(line, targetMap);
	if (line.startsWith('{') && line.includes('||')) return rewriteModernLine(line, targetMap);
	return line;
}

/**
 * 改写整份源码（按 `\n` 切分再拼回，换行风格与入参一致）
 *
 * @param {string} text 源码全文
 * @param {Map<string, object>} targetMap 图元 ID → 替换动作
 * @returns {string} 改写后的全文
 * @sideEffects 无（纯函数）
 */
export function rewriteSource(text, targetMap) {
	const lines = String(text === null || text === undefined ? '' : text).split('\n');
	return lines.map((line) => rewriteLine(line, targetMap)).join('\n');
}
