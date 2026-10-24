#!/usr/bin/env node
/**
 * 向 EDA桥下发一条指令（命令行助手）
 *
 * 服务端是 `tools/eda-bridge/server.mjs`，本脚本只是把「读代码 → POST /__cmd → 打印结果」
 * 包装一下，避免在 shell 里手写 JSON 转义。
 *
 * 用法：
 *   node tools/eda-bridge/run.mjs --file temp/probe-version.js
 *   node tools/eda-bridge/run.mjs "return eda.sys_Environment.getEditorCurrentVersion()"
 *   node tools/eda-bridge/run.mjs --probe "pcb_Net.getAllNets,pcb_Net.getAllNetsName"
 *   node tools/eda-bridge/run.mjs --status
 *
 * 退出码：0 = 指令成功；1 = 指令失败（含超时/未连接）；2 = 参数错误
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import fs from 'node:fs';

const argv = process.argv.slice(2);
const PORT = Number(process.env.EDA_BRIDGE_PORT || 8233);
const TIMEOUT = Number(process.env.EDA_BRIDGE_TIMEOUT || 15000);
const BASE = `http://127.0.0.1:${PORT}`;

function usage(msg) {
	if (msg) process.stderr.write(msg + '\n');
	process.stderr.write('用法: run.mjs [--file <path> | <code>] [--probe a.b,c.d] [--status]\n');
	process.exit(2);
}

async function post(path, body) {
	const res = await fetch(BASE + path, { method: 'POST', body: JSON.stringify(body ?? {}) });
	return res.json();
}

async function main() {
	if (argv.includes('--status')) {
		const res = await fetch(BASE + '/__status');
		process.stdout.write(JSON.stringify(await res.json(), null, 2) + '\n');
		return 0;
	}

	if (argv.includes('--probe')) {
		const paths = String(argv[argv.indexOf('--probe') + 1] || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (!paths.length) usage('--probe 后面要跟逗号分隔的 API 路径');
		const out = await post('/__cmd', { cmd: 'probe', paths });
		process.stdout.write(JSON.stringify(out, null, 2) + '\n');
		return out.ok ? 0 : 1;
	}

	let code = '';
	let arg;
	if (argv.includes('--arg-file')) {
		// 探针需要外部数据（如 API 路径清单）时用：--arg-file xxx.json
		const argFile = argv[argv.indexOf('--arg-file') + 1];
		if (!argFile) usage('--arg-file 后面要跟文件路径');
		arg = JSON.parse(fs.readFileSync(argFile, 'utf8'));
	}
	if (argv.includes('--file')) {
		const file = argv[argv.indexOf('--file') + 1];
		if (!file) usage('--file 后面要跟文件路径');
		code = fs.readFileSync(file, 'utf8');
	} else {
		const rest = argv.filter((a) => !a.startsWith('--') && a !== arg && !String(a).endsWith('.json'));
		code = rest.join(' ').trim();
	}
	if (!code) usage('缺少要执行的代码');

	const out = await post('/__cmd', { cmd: 'eval', code, arg });
	process.stdout.write(JSON.stringify(out, null, 2) + '\n');
	return out.ok ? 0 : 1;
}

main()
	.then((c) => {
		process.exitCode = c;
	})
	.catch((e) => {
		process.stderr.write(`✗ ${e && e.message ? e.message : e}\n`);
		process.exitCode = 1;
	});
