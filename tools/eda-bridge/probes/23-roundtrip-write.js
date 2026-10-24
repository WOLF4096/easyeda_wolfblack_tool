/**
 * 探针 23：源码「读 → no-op 改写 → 写回 → 再读」的往返保真（**会写文档**，但内容不变）
 *
 * 目的：GenerateNet 与 ReplaceComponent 都是「整份写回」，
 * 必须先确认 `setDocumentSource(原文)` 不会把文档重排/丢行 —— 否则用户一按「执行」
 * 就会看到满屏无意义 diff（严重时还会丢 POURED 之类的缓存行）。
 *
 * 安全措施：
 *   1. 只有文档里**没有任何 POUR 行**时才执行（V4 写回会丢 POURED，见 MEMORY）；
 *   2. 写之前把原文完整回传，调用方可落盘备份；
 *   3. 只写「语义完全等价」的内容（每行网络名设成原值）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
const src = await eda.sys_FileManager.getDocumentSource();
const lines = src.split('\n');

const hasPour = lines.some((l) => l.trim().startsWith('{') && l.includes('"type":"POUR"'));
if (hasPour) {
	return { skipped: '文档含 POUR 行（V4 整份写回会丢铜皮缓存），不执行往返测试', bytes: src.length };
}

/** 与本项目 `core/sourceLine.splitSourceLine` 同构 */
function splitModern(line) {
	const hasTrailingPipe = line.endsWith('|');
	const clean = hasTrailingPipe ? line.slice(0, -1) : line;
	const parts = clean.split('||');
	if (parts.length !== 2) return null;
	try {
		return { leftStr: parts[0], leftObj: JSON.parse(parts[0]), rightObj: JSON.parse(parts[1]), hasTrailingPipe };
	} catch {
		return null;
	}
}

// no-op 改写：凡是带网络名的行，把网络名设成它原本的值
let touched = 0;
const rewritten = lines.map((line) => {
	if (!line.trim() || !line.startsWith('{') || !line.includes('||')) return line;
	const p = splitModern(line);
	if (!p) return line;
	const net = p.rightObj.netName !== undefined ? p.rightObj.netName : p.rightObj.padNet;
	if (typeof net !== 'string' || !net) return line;
	p.rightObj.netName = net;
	if (p.rightObj.padNet !== undefined) p.rightObj.padNet = net;
	touched += 1;
	return p.leftStr + '||' + JSON.stringify(p.rightObj) + (p.hasTrailingPipe ? '|' : '');
});

const candidate = rewritten.join('\n');
const inMemoryEqual = candidate === src;

const before = {
	bytes: src.length,
	lines: lines.length,
	head: src.slice(0, 80),
};

await eda.sys_FileManager.setDocumentSource(candidate);
await new Promise((r) => setTimeout(r, 400));

const after = await eda.sys_FileManager.getDocumentSource();
const roundTripEqual = after === src;

// 逐行标出第一处差异，便于判断是「格式重排」还是「丢行」
let firstDiff = null;
const afterLines = after.split('\n');
for (let i = 0; i < Math.max(lines.length, afterLines.length); i++) {
	if (lines[i] !== afterLines[i]) {
		firstDiff = {
			at: i + 1,
			before: (lines[i] || '').slice(0, 140),
			after: (afterLines[i] || '').slice(0, 140),
		};
		break;
	}
}

return {
	touchedLines: touched,
	inMemoryEqual,
	roundTripEqual,
	bytesBefore: before.bytes,
	bytesAfter: after.length,
	linesBefore: before.lines,
	linesAfter: afterLines.length,
	firstDiff,
	// 原文回传给调用方落盘备份（37KB 量级，桥能承受）
	sourceBefore: src,
};
