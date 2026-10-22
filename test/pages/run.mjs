#!/usr/bin/env node
/**
 * 页面冒烟测试（headless Chrome + mock eda）
 *
 * 做什么：给每个 iframe 页面注入 mock 的 `eda` 宿主，真实加载页面脚本，
 * 捕获初始化期的同步异常 / 未捕获 Promise / console.error，判断页面能否正常跑起来。
 *
 * 为什么需要：单元测试只覆盖 `src/js` 的纯逻辑，18 个页面脚本（1.2 万行）此前
 * 完全没有被执行过——空引用、API 误用这类问题只能靠人肉点。
 *
 * 实现要点（踩过的坑）：
 *   1. 静态服务必须跑在**子进程**：主进程同步等 Chrome 时，同进程的 server 会被饿死；
 *   2. 每个页面用**独立 --user-data-dir**：默认 profile 会被上一个 Chrome 进程锁住而卡死；
 *   3. 结果由页面**主动 POST 回本地服务**，而不是等 `--dump-dom`——
 *      部分页面有常驻定时器，Chrome 迟迟不退出，dump 会一直等（实测单页 15s+）。
 *
 * 用法：
 *   node test/pages/run.mjs                # 全部页面
 *   node test/pages/run.mjs --only Net     # 只跑文件名含 Net 的页面
 *   node test/pages/run.mjs --verbose      # 打印「未 mock 的 API」
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORK = path.join(ROOT, 'temp', 'pages-smoke');
const RESULTS = path.join(WORK, 'results');
const PORT = 8941;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE_TIMEOUT = 10000;

/* ------------------------------ 页面准备 ------------------------------ */

/** 把 mock 脚本插到 <head> 最前面，产出可加载的临时页面 */
function buildPatchedPages(filter) {
	fs.rmSync(WORK, { recursive: true, force: true });
	fs.mkdirSync(RESULTS, { recursive: true });
	const pages = fs
		.readdirSync(path.join(ROOT, 'iframe'))
		.filter((f) => f.endsWith('.html'))
		.filter((f) => !filter || f.includes(filter));
	for (const page of pages) {
		const html = fs.readFileSync(path.join(ROOT, 'iframe', page), 'utf8');
		const patched = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<script src="/test/pages/mock-eda.js"></script>`);
		fs.writeFileSync(path.join(WORK, page), patched);
	}
	return pages;
}

/* ------------------------------ 静态服务 ------------------------------ */

function serveForever() {
	const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
	http.createServer((req, res) => {
		// 页面冒烟结果回传
		if (req.method === 'POST' && req.url === '/__smoke') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				try {
					const data = JSON.parse(body);
					const name = path.basename(String(data.page || 'unknown')).replace(/\.html$/, '');
					fs.writeFileSync(path.join(RESULTS, name + '.json'), JSON.stringify(data));
				} catch (e) {
					/* 忽略非法回传 */
				}
				res.writeHead(204);
				res.end();
			});
			return;
		}
		const rel = decodeURIComponent(req.url.split('?')[0]);
		let file = path.join(ROOT, rel);
		if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
		if (!fs.existsSync(file)) {
			res.writeHead(404);
			res.end('404');
			return;
		}
		res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	}).listen(PORT, '127.0.0.1');
}

async function waitPort(retries = 50) {
	for (let i = 0; i < retries; i++) {
		const ok = await new Promise((resolve) => {
			const req = http.get({ host: '127.0.0.1', port: PORT, path: '/iframe/About.html' }, (res) => {
				res.resume();
				resolve(res.statusCode === 200);
			});
			req.on('error', () => resolve(false));
			req.setTimeout(300, () => {
				req.destroy();
				resolve(false);
			});
		});
		if (ok) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return false;
}

/* ------------------------------ 单页执行 ------------------------------ */

/**
 * 打开一个页面，等它把结果 POST 回来（最多 PAGE_TIMEOUT），然后杀掉 Chrome
 * @returns {Promise<{ok: boolean, result?: Object, ms: number}>}
 */
function runPage(page, index) {
	const name = page.replace(/\.html$/, '');
	const resultFile = path.join(RESULTS, name + '.json');
	const profile = path.join(WORK, 'profile-' + index);
	const t0 = Date.now();
	const args = [
		'--headless=new',
		'--disable-gpu',
		'--no-sandbox',
		'--hide-scrollbars',
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-background-networking',
		`--user-data-dir=${profile}`,
		`http://127.0.0.1:${PORT}/temp/pages-smoke/${page}`,
	];
	const child = spawn(CHROME, args, { stdio: 'ignore' });

	return new Promise((resolve) => {
		const deadline = Date.now() + PAGE_TIMEOUT;
		const tick = () => {
			if (fs.existsSync(resultFile)) {
				let result = null;
				try {
					result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
				} catch (e) {
					/* 半截文件，下个 tick 再读 */
				}
				if (result) {
					child.kill('SIGKILL');
					resolve({ ok: true, result, ms: Date.now() - t0 });
					return;
				}
			}
			if (Date.now() > deadline) {
				child.kill('SIGKILL');
				resolve({ ok: false, ms: Date.now() - t0 });
				return;
			}
			setTimeout(tick, 100);
		};
		tick();
	});
}

/* ------------------------------ 主流程 ------------------------------ */

function pad(text, len) {
	const s = String(text);
	let w = 0;
	for (const ch of s) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
	return s + ' '.repeat(Math.max(0, len - w));
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes('--serve')) {
		serveForever();
		return new Promise(() => {});
	}
	const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
	const verbose = argv.includes('--verbose');

	if (!fs.existsSync(CHROME)) {
		process.stderr.write(`✗ 未找到 Chrome：${CHROME}\n`);
		return 2;
	}

	const pages = buildPatchedPages(only);
	if (pages.length === 0) {
		process.stderr.write('✗ 没有匹配的页面\n');
		return 2;
	}

	const server = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], { stdio: 'ignore' });
	if (!(await waitPort())) {
		server.kill();
		process.stderr.write('✗ 静态服务启动失败\n');
		return 2;
	}

	const rows = [];
	for (const [i, page] of pages.entries()) {
		const { ok, result, ms } = await runPage(page, i);
		if (!ok) {
			rows.push({ page, status: 'TIMEOUT', errors: [], missing: [], ms });
			continue;
		}
		const errors = [...(result.errors || []), ...(result.unhandled || [])];
		rows.push({ page, status: errors.length ? 'FAIL' : 'PASS', errors, missing: result.missing || [], calls: result.calls || 0, ms });
	}
	server.kill();

	const out = [];
	const failed = rows.filter((r) => r.status === 'FAIL');
	const timeout = rows.filter((r) => r.status === 'TIMEOUT');
	out.push('');
	out.push('页面冒烟测试（mock eda · headless Chrome）');
	out.push('');
	out.push('  ' + pad('页面', 30) + pad('结果', 9) + pad('错误', 6) + pad('未mock', 8) + '耗时');
	out.push('  ' + '─'.repeat(70));
	for (const r of rows) {
		out.push('  ' + pad(r.page, 30) + pad(r.status, 9) + pad(String(r.errors.length), 6) + pad(String(r.missing.length), 8) + r.ms + 'ms');
	}

	if (failed.length) {
		out.push('');
		out.push('失败明细');
		for (const r of failed) {
			out.push(`  ✗ ${r.page}`);
			for (const e of r.errors.slice(0, 6)) {
				out.push(`      [${e.type || 'error'}] ${String(e.msg).split('\n')[0].slice(0, 220)}${e.at ? '  @ ' + e.at : ''}`);
			}
		}
	}
	if (timeout.length) {
		out.push('');
		out.push('超时（页面未回传结果，可能需要交互或依赖未 mock 的 API）');
		for (const r of timeout) out.push(`  ? ${r.page}  ${r.ms}ms`);
	}
	if (verbose) {
		out.push('');
		out.push('未 mock 的 eda API（覆盖缺口，非失败）');
		for (const r of rows.filter((x) => x.missing.length)) out.push(`  ${pad(r.page, 30)} ${r.missing.join(', ')}`);
	}
	out.push('');
	out.push(`结论: ${failed.length === 0 ? '全部页面初始化无异常' : failed.length + ' / ' + rows.length + ' 个页面初始化异常'}${timeout.length ? `（${timeout.length} 个超时）` : ''}`);
	process.stdout.write(out.join('\n') + '\n');
	return failed.length === 0 ? 0 : 1;
}

main()
	.then((c) => {
		process.exitCode = c;
	})
	.catch((e) => {
		process.stderr.write(`✗ 运行失败: ${e && e.stack ? e.stack : e}\n`);
		process.exitCode = 2;
	});
