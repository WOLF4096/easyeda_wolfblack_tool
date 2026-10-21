/**
 * 探针 07：源码行改写的无损性（只读，**不写文档**）
 *
 * `生成物理网络` / `从PCB转原理图` 的写回路径是「逐行切分 → 改内层对象 → 重新序列化 → 拼回」。
 * 风险点不在切分，而在**重新序列化**：key 顺序、数字格式（1e-7 / 120.061 / -0）都可能变，
 * 极端情况还会丢字段或多字段。
 *
 * 签名（见 iframe/js/common.js）：
 *   splitSourceLine(line) → { leftStr, rightStr, leftObj, rightObj, hasTrailingPipe } | null
 *   joinSourceLine(leftStr, rightStr, hasTrailingPipe) → string
 *
 * 检查三件事：
 *   1. 拼回时保持原字符串 → 必须逐字节等于原行（这是不写坏文档的底线）；
 *   2. 模拟「改了内容重新序列化」：`JSON.stringify(rightObj)` 与原 rightStr 的差异行数；
 *   3. 重新序列化后再切分，内层对象必须与原对象深度相等（语义不丢）。
 */

const WC = window.WolfCommon;
if (!WC || !WC.splitSourceLine || !WC.joinSourceLine) {
	return { error: 'WolfCommon.splitSourceLine / joinSourceLine 不可用' };
}

const src = await eda.sys_FileManager.getDocumentSource();
const lines = String(src || '').split('\n');

const stats = {
	total: lines.length,
	blank: 0,
	parsed: 0,
	unparsable: 0,
	byteIdentical: 0,
	byteMismatch: 0,
	reserializeChanged: 0,
	semanticLoss: 0,
};
const problems = [];
const reserializeSamples = [];

const norm = (v) => {
	if (v === null || typeof v !== 'object') return v;
	if (Array.isArray(v)) return v.map(norm);
	const out = {};
	for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
	return out;
};
const deepEqual = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	if (!line.trim()) {
		stats.blank++;
		continue;
	}

	// V2 数组格式（无 ||）：走 JSON.parse / JSON.stringify 这条分支
	if (!line.includes('||')) {
		let arr = null;
		try {
			arr = JSON.parse(line);
		} catch (e) {
			stats.unparsable++;
			continue;
		}
		stats.parsed++;
		const again = JSON.stringify(arr);
		if (again === line) stats.byteIdentical++;
		else {
			stats.byteMismatch++;
			stats.reserializeChanged++;
			if (problems.length < 6) problems.push({ no: i + 1, kind: 'V2 数组序列化后不等于原行' });
			if (reserializeSamples.length < 6) {
				reserializeSamples.push({ no: i + 1, orig: line.slice(0, 110), now: again.slice(0, 110) });
			}
		}
		continue;
	}

	const part = WC.splitSourceLine(line);
	if (!part) {
		stats.unparsable++;
		continue;
	}
	stats.parsed++;

	// 1) 原样拼回
	const same = WC.joinSourceLine(part.leftStr, part.rightStr, part.hasTrailingPipe);
	if (same === line) stats.byteIdentical++;
	else {
		stats.byteMismatch++;
		if (problems.length < 6) problems.push({ no: i + 1, kind: '拼回不等于原行' });
	}

	// 2) 重新序列化内层
	const reserialized = JSON.stringify(part.rightObj);
	if (reserialized !== part.rightStr) {
		stats.reserializeChanged++;
		if (reserializeSamples.length < 6) {
			reserializeSamples.push({
				no: i + 1,
				orig: part.rightStr.slice(0, 110),
				now: reserialized.slice(0, 110),
			});
		}
	}

	// 3) 重新序列化后语义是否一致
	const back = WC.splitSourceLine(WC.joinSourceLine(part.leftStr, reserialized, part.hasTrailingPipe));
	if (!back) {
		stats.semanticLoss++;
		if (problems.length < 6) problems.push({ no: i + 1, kind: '重新序列化后无法切分' });
	} else if (!deepEqual(part.rightObj, back.rightObj)) {
		stats.semanticLoss++;
		if (problems.length < 6) problems.push({ no: i + 1, kind: '重新序列化后语义不一致' });
	}
}

return { version: eda.sys_Environment.getEditorCurrentVersion(), stats, problems, reserializeSamples };
