/**
 * 探针 21：打印真实 V4 文档里各类行的原文（只读）
 *
 * 上一支探针（20）发现这份文档里没有 `LINE`/`VIA`，而是 54 行 `PRIMITIVE`，
 * 且没有任何一行带 `netName` —— 说明 V4 的字段名与 `parseV3Primitives` 的假设不一致。
 * 先把真实字段打出来再决定怎么改。
 */
const src = await eda.sys_FileManager.getDocumentSource();
const lines = src.split('\n');

const want = ['PRIMITIVE', 'PAD_NET', 'NET', 'COMPONENT', 'ATTR', 'LAYER'];
const samples = {};

for (const line of lines) {
	if (!line.trim() || !line.startsWith('{')) continue;
	const hasPipe = line.endsWith('|');
	const parts = (hasPipe ? line.slice(0, -1) : line).split('||');
	if (parts.length !== 2) continue;
	let head;
	try {
		head = JSON.parse(parts[0]);
	} catch {
		continue;
	}
	if (!want.includes(head.type)) continue;
	if (samples[head.type] && samples[head.type].length >= 2) continue;
	if (!samples[head.type]) samples[head.type] = [];
	samples[head.type].push({
		left: parts[0],
		right: parts[1].length > 420 ? parts[1].slice(0, 420) + '…' : parts[1],
		hasPipe,
	});
}

// PRIMITIVE 的子类型分布
const primKinds = {};
for (const line of lines) {
	if (!line.trim() || !line.startsWith('{')) continue;
	const parts = (line.endsWith('|') ? line.slice(0, -1) : line).split('||');
	if (parts.length !== 2) continue;
	let head;
	let tail;
	try {
		head = JSON.parse(parts[0]);
		tail = JSON.parse(parts[1]);
	} catch {
		continue;
	}
	if (head.type !== 'PRIMITIVE') continue;
	const kind = tail.primitiveType || tail.shape || tail.type || '(无)';
	primKinds[kind] = (primKinds[kind] || 0) + 1;
}

return { samples, primKinds };
