/**
 * @//module/ core/sourceLine
 * @//description/ V3/V4 日志式源码行的拆分与还原（逐字节可逆，改写源码的底线保证）
 * @//exports/ splitSourceLine, joinSourceLine
 * @//dependencies/ 无
 * @//example/ const { splitSourceLine, joinSourceLine } = await import('./core/sourceLine.js')
 *            const p = splitSourceLine(raw)
 *            if (p) raw = joinSourceLine(p.leftStr, p.rightStr, p.hasTrailingPipe)
 */

/**
 * 切分 V3/V4 的日志行：`{"type":...}||{...}|`
 *
 * 两个实测细节（来自 测试样本/ 的真实工程文件）：
 * 1. **行尾 `|` 不是每行都有**（BOARD 文档的 META 行就缺），必须原样保留，
 *    改写后再拼回去时不能擅自补上，否则等于改动文件格式；
 * 2. 外层 JSON 文本要按原样返回（`leftStr`），不能重新序列化，否则键序/浮点表示可能漂移。
 *
 * @param {string} line 单行原始文本（不含换行符）
 * @returns {{leftStr: string, rightStr: string, leftObj: Object, rightObj: Object, hasTrailingPipe: boolean}|null}
 *          无法切分或任一侧 JSON 非法时返回 null（调用方应保留原行）
 * @sideEffects 无（纯函数）
 */
export function splitSourceLine(line) {
	if (typeof line !== 'string') return null;
	const hasTrailingPipe = line.endsWith('|');
	const cleanLine = hasTrailingPipe ? line.slice(0, -1) : line;
	const parts = cleanLine.split('||');
	if (parts.length !== 2) return null;
	let leftObj;
	let rightObj;
	try {
		leftObj = JSON.parse(parts[0]);
		rightObj = JSON.parse(parts[1]);
	} catch (e) {
		return null;
	}
	if (!leftObj || typeof leftObj !== 'object') return null;
	return { leftStr: parts[0], rightStr: parts[1], leftObj: leftObj, rightObj: rightObj, hasTrailingPipe: hasTrailingPipe };
}

/**
 * 拼装日志行（与 splitSourceLine 对称）
 *
 * `splitSourceLine(raw)` → `joinSourceLine(...)` 必须与原行逐字节一致。
 *
 * @param {string} leftStr 外层 JSON 文本（保持原样）
 * @param {string} rightStr 内层 JSON 文本
 * @param {boolean} hasTrailingPipe 原行是否带行尾 `|`
 * @returns {string} 还原后的整行
 * @sideEffects 无（纯函数）
 */
export function joinSourceLine(leftStr, rightStr, hasTrailingPipe) {
	return leftStr + '||' + rightStr + (hasTrailingPipe ? '|' : '');
}
