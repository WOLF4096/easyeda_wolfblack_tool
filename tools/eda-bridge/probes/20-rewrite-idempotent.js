/**
 * 探针 20：源码改写器的「幂等 / 字节保真」实测（只读，不写文档）
 *
 * 目的：GenerateNet 与 ReplaceComponent 都靠「逐行改写 + 整份写回」，
 * 最大的风险是**没改到内容的行被重新序列化**（数字格式、字段顺序变化），
 * 一次写回就相当于把整份源码重排 —— 所以在真实工程上先量一遍。
 *
 * 逻辑与 `app/generate-net/sourceRewrite.js` 一致，但这里**内联实现**：
 * 探针跑在 EDABridge 页面里，拿不到业务模块的 import。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
const src = await eda.sys_FileManager.getDocumentSource();
const lines = src.split('\n');

const hist = {};
const bump = (k) => {
	hist[k] = (hist[k] || 0) + 1;
};

/** 解析 V3/V4 日志行（与 core/sourceLine 的 splitSourceLine 同构） */
function splitModern(line) {
	const hasTrailingPipe = line.endsWith('|');
	const clean = hasTrailingPipe ? line.slice(0, -1) : line;
	const parts = clean.split('||');
	if (parts.length !== 2) return null;
	try {
		return {
			leftStr: parts[0],
			leftObj: JSON.parse(parts[0]),
			rightObj: JSON.parse(parts[1]),
			hasTrailingPipe,
		};
	} catch {
		return null;
	}
}

function joinModern(leftStr, rightStr, hasTrailingPipe) {
	return leftStr + '||' + rightStr + (hasTrailingPipe ? '|' : '');
}

let v2Lines = 0;
let modernLines = 0;
let modernIdempotent = 0;
let modernChanged = 0;
let v2Idempotent = 0;
let v2Changed = 0;
const changedSamples = [];

for (const line of lines) {
	if (!line.trim()) {
		bump('(空行)');
		continue;
	}

	if (line.startsWith('[')) {
		v2Lines += 1;
		let arr;
		try {
			arr = JSON.parse(line);
		} catch {
			bump('V2:解析失败');
			continue;
		}
		bump('V2:' + arr[0]);
		if (typeof arr[3] !== 'string') continue;
		arr[3] = arr[3]; // 原值写回（模拟 no-op 改写）
		const out = JSON.stringify(arr);
		if (out === line) v2Idempotent += 1;
		else {
			v2Changed += 1;
			if (changedSamples.length < 2) changedSamples.push({ kind: 'V2', in: line.slice(0, 100), out: out.slice(0, 100) });
		}
		continue;
	}

	if (line.startsWith('{')) {
		modernLines += 1;
		const parsed = splitModern(line);
		if (!parsed) {
			bump('M:解析失败');
			continue;
		}
		bump('M:' + parsed.leftObj.type);
		if (typeof parsed.rightObj.netName !== 'string') continue;
		parsed.rightObj.netName = parsed.rightObj.netName; // 原值写回
		const out = joinModern(parsed.leftStr, JSON.stringify(parsed.rightObj), parsed.hasTrailingPipe);
		if (out === line) modernIdempotent += 1;
		else {
			modernChanged += 1;
			if (changedSamples.length < 4) changedSamples.push({ kind: 'M', in: line.slice(0, 100), out: out.slice(0, 100) });
		}
	}
}

// 顺带确认网表结构（网表模式的入参）
let netlistShape = null;
try {
	const n = await eda.pcb_ManufactureData.getNetlistFile('PCB');
	const text = typeof n === 'string' ? n : JSON.stringify(n);
	const obj = JSON.parse(text);
	netlistShape = {
		rootKeys: Object.keys(obj).slice(0, 8),
		hasComponents: !!obj.components,
		sampleComp: obj.components ? Object.keys(obj.components).slice(0, 2) : Object.keys(obj).slice(0, 4),
	};
} catch (e) {
	netlistShape = '读取失败: ' + e.message;
}

return {
	sourceBytes: src.length,
	totalLines: lines.length,
	v2Lines,
	modernLines,
	v2Idempotent,
	v2Changed,
	modernIdempotent,
	modernChanged,
	changedSamples,
	hist,
	netlistShape,
};
