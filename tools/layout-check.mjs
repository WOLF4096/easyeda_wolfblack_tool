#!/usr/bin/env node
/**
 * 版式自检（headless Chrome）
 *
 * 做什么：按 `src/index.ts` 里 `openPage()` 给定的尺寸，把每个 iframe 页面真实渲染一遍，
 * 检查「控件是否被裁切 / 是否出现横向滚动 / 按钮文字是否被截断」，并顺手截图存档。
 *
 * 为什么需要：18 个页面共用一份 common.css，改一处样式很容易挤坏某个 300px 宽的小窗；
 * 纯靠人眼看不完，靠单元测试又测不到版式。
 *
 * 用法：
 *   node tools/layout-check.mjs              # 全部页面
 *   node tools/layout-check.mjs --only Code  # 只查文件名含 Code 的页面
 *   node tools/layout-check.mjs --no-shot    # 不截图（快）
 *
 * 产物：temp/layout-check/results/*.json、temp/layout-check/shots/*.png
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, 'temp', 'layout-check');
const RESULTS = path.join(WORK, 'results');
const SHOTS = path.join(WORK, 'shots');
const PORT = 8951;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BUDGET = 3500;

/** 从入口文件里读页面尺寸，避免两处维护 */
function readPageSizes() {
	const src = fs.readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8');
	const sizes = new Map();
	const re = /openPage\('([\w]+)',\s*(\d+),\s*(\d+)/g;
	let m;
	while ((m = re.exec(src))) sizes.set(m[1], { w: Number(m[2]), h: Number(m[3]) });
	return sizes;
}

/** 生成测量用的外壳页：与页面 1:1 的 iframe + 度量脚本 */
const HARNESS = (page, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#0a0a0a}iframe{border:0;display:block;width:${w}px;height:${h}px}</style></head>
<body>
<iframe id="f" src="/iframe/${page}.html"></iframe>
<script>
const f = document.getElementById('f');
function inScroller(el, win) {
	let p = el.parentElement;
	while (p && p !== el.ownerDocument.body) {
		const cs = win.getComputedStyle(p);
		if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) {
			const rp = p.getBoundingClientRect(), r = el.getBoundingClientRect();
			if (r.right > rp.right + 1 || r.bottom > rp.bottom + 1 || r.left < rp.left - 1 || r.top < rp.top - 1) return true;
		}
		p = p.parentElement;
	}
	return false;
}
function name(el) {
	return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
}
f.addEventListener('load', () => setTimeout(() => {
	const d = f.contentDocument, win = f.contentWindow;
	if (!d || !win) return;
	const vw = win.innerWidth, vh = win.innerHeight;
	// 文档型页面（About）允许整页纵向滚动，只查横向溢出与控件截断
	const scrollPage = !!(d.body && d.body.classList.contains('page-scroll'));
	const bad = [];
	const check = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) return;
		if (inScroller(el, win)) return;
		const outRight = r.right > vw + 1 || r.left < -1;
		const outBottom = !scrollPage && (r.bottom > vh + 1 || r.top < -1);
		if (outRight || outBottom) {
			bad.push({ el: name(el), why: 'out', rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
		} else if ((el.tagName === 'BUTTON' || el.tagName === 'TH' || el.tagName === 'LABEL') && el.scrollWidth > el.clientWidth + 1) {
			bad.push({ el: name(el), why: 'clip', scroll: [el.scrollWidth, el.clientWidth] });
		}
	};
	d.querySelectorAll('button,input,select,textarea,label,.toolbar,.status-bar,.grid-header,.view-container,.p2s-bottom,.wh-sidebar,.wh-header,.qr-panel,.ii-controls,.cc-header,.gn-header,.apitest-header,.bridge-bar,.cf-form,.ps-form,.about-container,.wh-shell').forEach(check);
	const de = d.documentElement;
	fetch('/__layout', { method: 'POST', body: JSON.stringify({
		page: ${JSON.stringify(page)}, w: vw, h: vh,
		overflow: [de.scrollWidth - vw, scrollPage ? 0 : de.scrollHeight - vh],
		scrollPage,
		bad: bad.slice(0, 12), total: bad.length,
	}) });
}, 1500));
</script>
</body></html>`;

function ensureDirs() {
	fs.rmSync(WORK, { recursive: true, force: true });
	fs.mkdirSync(RESULTS, { recursive: true });
	fs.mkdirSync(SHOTS, { recursive: true });
	fs.writeFileSync(path.join(WORK, 'harness.html'), HARNESS('__PAGE__', 0, 0));
}

function serve() {
	const types = {
		'.html': 'text/html; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.png': 'image/png',
		'.json': 'application/json',
	};
	http.createServer((req, res) => {
		if (req.method === 'POST' && req.url === '/__layout') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				try {
					const data = JSON.parse(body);
					fs.writeFileSync(path.join(RESULTS, data.page + '.json'), JSON.stringify(data));
				} catch (e) {
					/* 忽略半截请求 */
				}
				res.writeHead(204);
				res.end();
			});
			return;
		}
		const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
		const file = path.join(ROOT, rel);
		if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			res.end('404');
			return;
		}
		res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	}).listen(PORT, '127.0.0.1');
}

function waitPort(retries = 50) {
	return new Promise((resolve) => {
		let n = 0;
		const tick = () => {
			const req = http.get({ host: '127.0.0.1', port: PORT, path: '/iframe/css/common.css' }, (res) => {
				res.resume();
				resolve(res.statusCode === 200);
			});
			req.on('error', () => (++n < retries ? setTimeout(tick, 100) : resolve(false)));
		};
		tick();
	});
}

function runChrome(page, w, h, shot) {
	const name = 'shot-' + page;
	const harnessFile = path.join(WORK, name + '.html');
	fs.writeFileSync(harnessFile, HARNESS(page, w, h));
	const resultFile = path.join(RESULTS, page + '.json');
	// Chrome 对窗口有最小值（实测 < 500px 宽会被夹到 500，矮窗口甚至被压到 4px），
	// 所以截图窗口一律取「页面尺寸 + 余量」，页面本身仍按 iframe 的精确宽高渲染。
	const winW = Math.max(w + 24, 540);
	const winH = Math.max(h + 24, 300);
	const args = [
		'--headless=new',
		'--disable-gpu',
		'--no-sandbox',
		'--hide-scrollbars',
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-background-networking',
		'--force-device-scale-factor=1',
		`--window-size=${winW},${winH}`,
		`--virtual-time-budget=${BUDGET}`,
		`--user-data-dir=${path.join(WORK, 'profile-' + page)}`,
	];
	if (shot) args.push(`--screenshot=${path.join(SHOTS, page + '.png')}`);
	args.push(`http://127.0.0.1:${PORT}/temp/layout-check/${name}.html`);

	return new Promise((resolve) => {
		const child = spawn(CHROME, args, { stdio: 'ignore' });
		const deadline = Date.now() + BUDGET + 12000;
		let settled = false;
		const finish = (data) => {
			if (settled) return;
			settled = true;
			child.kill('SIGKILL');
			resolve(data);
		};
		const tick = () => {
			if (fs.existsSync(resultFile)) {
				const raw = fs.readFileSync(resultFile, 'utf8');
				let data = null;
				try {
					data = JSON.parse(raw);
				} catch (e) {
					/* 半截文件，下个 tick 再读 */
				}
				if (data) {
					// 等 Chrome 把截图落盘（--screenshot 在 virtual time 用尽后才写）
					const wait = shot ? 3000 : 0;
					fs.unlinkSync(resultFile);
					setTimeout(() => finish(data), wait);
					return;
				}
			}
			if (Date.now() > deadline) {
				finish(null);
				return;
			}
			setTimeout(tick, 120);
		};
		tick();
	});
}

function pad(s, len) {
	let width = 0;
	for (const ch of String(s)) width += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
	return String(s) + ' '.repeat(Math.max(0, len - width));
}

async function main() {
	const argv = process.argv.slice(2);
	const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
	const shot = !argv.includes('--no-shot');
	if (!fs.existsSync(CHROME)) {
		process.stderr.write(`✗ 未找到 Chrome：${CHROME}\n`);
		return 2;
	}
	const sizes = readPageSizes();
	const pages = [...sizes.keys()].filter((p) => !only || p.includes(only));

	ensureDirs();
	serve();
	if (!(await waitPort())) {
		process.stderr.write('✗ 静态服务启动失败\n');
		return 2;
	}

	const out = ['', '版式自检（尺寸取自 src/index.ts · headless Chrome）', ''];
	out.push('  ' + pad('页面', 26) + pad('尺寸', 12) + pad('溢出', 10) + pad('问题', 8) + '说明');
	out.push('  ' + '─'.repeat(78));

	let failed = 0;
	for (const page of pages) {
		const { w, h } = sizes.get(page);
		const r = await runChrome(page, w, h, shot);
		if (!r) {
			out.push('  ' + pad(page, 26) + pad(`${w}×${h}`, 12) + 'TIMEOUT');
			failed++;
			continue;
		}
		const [ox, oy] = r.overflow;
		const bad = r.bad || [];
		const okOverflow = ox <= 0 && oy <= 0;
		const okBad = bad.length === 0;
		if (!okOverflow || !okBad) failed++;
		const marks = [];
		if (ox > 0) marks.push(`横向+${ox}`);
		if (oy > 0) marks.push(`纵向+${oy}`);
		out.push(
			'  ' +
				pad(page, 26) +
				pad(`${w}×${h}`, 12) +
				pad(marks.length ? marks.join(' ') : '无', 10) +
				pad(bad.length ? String(bad.length) : '-', 8) +
				(okBad ? (okOverflow ? 'OK' : '') : '')
		);
		for (const b of bad) {
			out.push(`      ✗ ${b.why}  ${b.el}  ${b.rect ? 'rect=' + b.rect.join(',') : 'scroll=' + b.scroll.join('/')}`);
		}
	}

	out.push('');
	out.push(failed === 0 ? `结论: ${pages.length} 个页面在各自尺寸下均无裁切/溢出` : `结论: ${failed} / ${pages.length} 个页面存在版式问题`);
	out.push(`截图: temp/layout-check/shots/`);
	process.stdout.write(out.join('\n') + '\n');
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
	process.stderr.write(`✗ 运行失败: ${e && e.stack ? e.stack : e}\n`);
	process.exit(2);
});
