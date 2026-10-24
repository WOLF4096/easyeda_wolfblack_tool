#!/usr/bin/env node
/**
 * 文档源码备份 / 还原（配合 EDA桥）
 *
 * 做写入类实测前必须先备份：桥的 `eval` 能直接 `setDocumentSource`，写坏了要能一键回滚。
 * 注意**两个 EDA 版本的源码序列化格式不同**（V2 数组 / V3-V4 日志），因此备份文件
 * 不能跨版本互用——还原时请回写到同一个端口。
 *
 * 用法：
 *   node tools/eda-bridge/doc.mjs backup  --port 4178 --out temp/backup/v4-pcb.txt
 *   node tools/eda-bridge/doc.mjs restore --port 4178 --in  temp/backup/v4-pcb.txt
 *   node tools/eda-bridge/doc.mjs check   --port 4178 --in  temp/backup/v4-pcb.txt
 *
 * check：只读比对「当前源码」与备份是否一致（用于确认测试后文档是否已复原）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];
const get = (flag, fallback) => {
	const i = argv.indexOf(flag);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(get('--port', process.env.EDA_BRIDGE_PORT || 8233));
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * 归一化源码，用于比对
 *
 * 实测：`getDocumentSource()` 每次读出来的 `DOCHEAD.client` 都不同（EDA 每次会话生成新值），
 * 写入后 `updateTime` / `version` 也会变。这些字段不代表内容差异，比对时必须抹掉，
 * 否则「还原成功」会被误判为失败。
 */
function normalize(text) {
	return String(text || '')
		.replace(/"client"\s*:\s*"[^"]*"/g, '"client":"*"')
		.replace(/"updateTime"\s*:\s*\d+/g, '"updateTime":0')
		.replace(/"version"\s*:\s*"\d+"/g, '"version":"0"');
}

async function evalInEda(code) {
	const res = await fetch(BASE + '/__cmd', { method: 'POST', body: JSON.stringify({ cmd: 'eval', code }) });
	const out = await res.json();
	if (!out.ok) throw new Error(out.error || '指令失败');
	return out.value;
}

if (!['backup', 'restore', 'check'].includes(cmd)) {
	process.stderr.write('用法: doc.mjs <backup|restore|check> --port N [--out 文件 | --in 文件]\n');
	process.exit(2);
}

if (cmd === 'backup') {
	const out = get('--out');
	if (!out) {
		process.stderr.write('backup 需要 --out <文件>\n');
		process.exit(2);
	}
	const v = await evalInEda(`
		const src = await eda.sys_FileManager.getDocumentSource();
		let doc = null;
		try { doc = await eda.dmt_SelectControl.getCurrentDocumentInfo(); } catch (e) {}
		return { version: eda.sys_Environment.getEditorCurrentVersion(), source: String(src || ''), doc };
	`);
	fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
	fs.writeFileSync(out, v.source, 'utf8');
	fs.writeFileSync(out + '.meta.json', JSON.stringify({ version: v.version, doc: v.doc, bytes: v.source.length }, null, 2));
	process.stdout.write(`✓ 已备份 ${v.version} → ${out}（${v.source.length} 字符）\n`);
	process.exit(0);
}

const input = get('--in');
if (!input) {
	process.stderr.write(`${cmd} 需要 --in <文件>\n`);
	process.exit(2);
}
const text = fs.readFileSync(input, 'utf8');

if (cmd === 'restore') {
	// 在 EDA 内做归一化比对，避免把 45KB 文本再传回来比
	const v = await evalInEda(`
		const src = ${JSON.stringify(text)};
		const ok = await eda.sys_FileManager.setDocumentSource(src);
		const after = String(await eda.sys_FileManager.getDocumentSource() || '');
		const norm = (t) => t
			.replace(/"client"\\s*:\\s*"[^"]*"/g, '"client":"*"')
			.replace(/"updateTime"\\s*:\\s*\\d+/g, '"updateTime":0')
			.replace(/"version"\\s*:\\s*"\\d+"/g, '"version":"0"');
		return { ok: !!ok, same: norm(after) === norm(src), bytes: after.length };
	`);
	process.stdout.write(JSON.stringify(v, null, 2) + '\n');
	process.exit(v.same ? 0 : 1);
}

// check
const v = await evalInEda(`return String(await eda.sys_FileManager.getDocumentSource() || '');`);
const same = normalize(v) === normalize(text);
process.stdout.write(
	same ? `✓ 当前源码与备份一致（归一化后比对，${text.length} 字符）\n` : `✗ 不一致：当前 ${v.length} 字符 / 备份 ${text.length} 字符\n`,
);
process.exit(same ? 0 : 1);
