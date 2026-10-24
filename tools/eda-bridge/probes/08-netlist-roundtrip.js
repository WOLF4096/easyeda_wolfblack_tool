/**
 * 探针 08：网表读写往返（**会写回网表，务必先备份**）
 *
 * `导入BOM` / `批量修改网络` / `清空空属性` / `网表更新3D模型` 都是「读网表 → 改 JSON → setNetlist 写回」。
 * 只要 `setNetlist` 会**重新序列化**或**丢字段**，这些功能就会在写回时改坏用户数据。
 *
 * 做法：读出网表文本 → 原样 setNetlist 写回 → 再读一次比对。
 * 若「写回同样的文本」都导致内容变化，说明平台在写回时做了归一化，插件必须知道这一点。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

const KEY = 'JLCEDA';

const read = async () => {
	const f = await eda.pcb_ManufactureData.getNetlistFile(KEY);
	return String((await f.text()) || '');
};

const out = { version: eda.sys_Environment.getEditorCurrentVersion() };

const before = await read();
const beforeJson = JSON.parse(before);
out.before = {
	bytes: before.length,
	components: Object.keys(beforeJson.components || beforeJson).length,
};

let writeResult = null;
try {
	writeResult = await eda.pcb_Net.setNetlist(KEY, before);
} catch (e) {
	out.writeError = String((e && e.message) || e);
}
out.setNetlistReturn = writeResult === undefined ? 'undefined' : JSON.parse(JSON.stringify(writeResult ?? null));

const after = await read();
out.after = { bytes: after.length };
out.exactSame = after === before;

// 语义层面比较（忽略 key 顺序与数字格式）
const norm = (v) => {
	if (v === null || typeof v !== 'object') return v;
	if (Array.isArray(v)) return v.map(norm);
	const o = {};
	for (const k of Object.keys(v).sort()) o[k] = norm(v[k]);
	return o;
};
try {
	out.semanticSame = JSON.stringify(norm(JSON.parse(after))) === JSON.stringify(norm(beforeJson));
} catch (e) {
	out.semanticSame = 'parse-error: ' + (e && e.message);
}

// 首次差异位置，便于定位是哪个字段被改
if (after !== before) {
	let i = 0;
	while (i < after.length && i < before.length && after[i] === before[i]) i++;
	out.firstDiff = { at: i, before: before.slice(i, i + 80), after: after.slice(i, i + 80) };
}

return out;
