/**
 * @//module/ tools/apply-signature
 * @//description/ 给项目内全部文档末尾、代码开头加统一的开发者署名（幂等，可重复运行）
 * @//exports/ 无（CLI 脚本）
 * @//dependencies/ node:fs, node:path
 * @//example/ node tools/apply-signature.mjs --dry   # 只列出会被改的文件
 *            node tools/apply-signature.mjs         # 实际写入
 *
 * 为什么要脚本而不是手改：项目里 100+ 个源码模块，手改一次就会漏，且以后新增文件还会漂。
 * 幂等靠检测「辅助开发：DeepSeek-V4.1-Flash」这一行：已存在就整份跳过。
 *
 * 三处硬约束（踩过）：
 *   1. `iframe/js/src/**` 的模块头由 test/moduleHeader.test.mjs 校验，要求文件**以块注释开头**
 *      → 署名必须插进已有块注释内部（结束标记之前），不能另起一个块注释；
 *   2. 带 shebang 的脚本（`#!/usr/bin/env node`）必须把署名插在 shebang 之后，否则脚本跑不起来；
 *   3. HTML 的 `<!doctype html>` 必须保持在第一行 → 署名插在 doctype 之后、`<html>` 之前。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');

/** 署名正文（三行，文档与代码共用同一份文本） */
const LINES = ['开发者：WOLF4096', '辅助开发：DeepSeek-V4.1-Flash', '本工具为非官方第三方开源扩展'];
/** 幂等标记：出现任意一处即认为已加过 */
const MARK = '辅助开发：DeepSeek-V4.1-Flash';

const CODE_EXT = new Set(['.js', '.mjs', '.ts', '.css', '.html']);
const DOC_EXT = new Set(['.md']);

/** 不处理的路径片段（产物、依赖、临时目录、样本、法律文本） */
const SKIP_DIRS = ['node_modules', 'build', 'dist', 'temp', '.git', '.workbuddy', '测试样本', 'images'];
const SKIP_FILES = new Set(['package-lock.json', 'LICENSE', 'extension.json', 'package.json', '.prettierrc', '.gitignore', '.edaignore']);
/** 构建产物目录：由 build-iframe 的 banner 统一署名，不手改 */
const isGenerated = (rel) => rel.split(path.sep).join('/').startsWith('iframe/js/app/');
/** 第三方库（echarts / fflate / jszip / bwip-js）：不能把项目署名写进别人的源码 */
const isThirdParty = (rel) => /^iframe[\\/]js[\\/][^\\/]+\.js$/.test(rel);

/**
 * 递归收集待处理文件
 *
 * @param {string} dir 起始目录
 * @param {string[]} out 结果数组
 * @returns {string[]} 绝对路径
 * @sideEffects 读文件系统
 */
function collect(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.includes(entry.name)) continue;
			collect(path.join(dir, entry.name), out);
			continue;
		}
		const abs = path.join(dir, entry.name);
		const rel = path.relative(ROOT, abs);
		if (SKIP_FILES.has(entry.name) || isGenerated(rel) || isThirdParty(rel)) continue;
		const ext = path.extname(entry.name).toLowerCase();
		if (CODE_EXT.has(ext) || DOC_EXT.has(ext)) out.push(abs);
	}
	return out;
}

/**
 * 探测文件的换行风格
 *
 * @param {string} text 文件内容
 * @returns {string} `\r\n` 或 `\n`
 * @sideEffects 无（纯函数）
 */
function eolOf(text) {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * 文档：在末尾追加署名引用块
 *
 * @param {string} text 原文
 * @returns {string} 新文
 * @sideEffects 无（纯函数）
 */
function signDoc(text) {
	const eol = eolOf(text);
	const body = text.replace(/\s+$/, '');
	return `${body}${eol}${eol}---${eol}${eol}${LINES.map((line) => `> ${line}`).join(eol)}${eol}`;
}

/**
 * HTML：插在 doctype 之后（doctype 必须留在第一行）
 *
 * @param {string} text 原文
 * @returns {string} 新文
 * @sideEffects 无（纯函数）
 */
function signHtml(text) {
	const eol = eolOf(text);
	const block = `<!--${eol}${LINES.map((line) => `  ${line}`).join(eol)}${eol}-->${eol}`;
	const match = text.match(/^\uFEFF?\s*<!doctype[^>]*>\r?\n/i);
	if (!match) return `${block}${text}`;
	const head = text.slice(0, match[0].length);
	return `${head}${block}${text.slice(match[0].length)}`;
}

/**
 * JS / TS / CSS：插进已有块注释内部；没有块注释就在文件最前另起一个
 *
 * 插进块注释内部是为了不破坏 `moduleHeader` 测试的「文件必须以 /** 开头」约束。
 *
 * @param {string} text 原文
 * @returns {string} 新文
 * @sideEffects 无（纯函数）
 */
function signCode(text) {
	const eol = eolOf(text);
	const inner = LINES.map((line) => ` * ${line}`).join(eol);
	const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
	const rest = bom ? text.slice(1) : text;

	// shebang 必须留在第一行
	let shebang = '';
	let body = rest;
	const shebangMatch = rest.match(/^#![^\n]*\r?\n/);
	if (shebangMatch) {
		shebang = shebangMatch[0];
		body = rest.slice(shebang.length);
	}

	if (body.trimStart().startsWith('/**')) {
		const offset = body.length - body.trimStart().length;
		const close = body.indexOf('*/', offset);
		if (close !== -1) {
			const before = body.slice(0, close).replace(/\s*$/, '');
			const after = body.slice(close);
			return `${bom}${shebang}${before}${eol} *${eol}${inner}${eol} ${after}`;
		}
	}

	const block = `/*${eol}${inner}${eol} */${eol}${eol}`;
	return `${bom}${shebang}${block}${body.replace(/^(\r?\n)+/, '')}`;
}

/**
 * 处理单个文件
 *
 * @param {string} abs 绝对路径
 * @returns {'added'|'skip'} 结果
 * @sideEffects 写文件（DRY 时不写）
 */
function processFile(abs) {
	const text = fs.readFileSync(abs, 'utf8');
	if (text.includes(MARK)) return 'skip';
	const ext = path.extname(abs).toLowerCase();
	let next;
	if (DOC_EXT.has(ext)) next = signDoc(text);
	else if (ext === '.html') next = signHtml(text);
	else next = signCode(text);
	if (DRY) {
		console.log(`[dry] ${path.relative(ROOT, abs)}`);
		return 'added';
	}
	fs.writeFileSync(abs, next, 'utf8');
	return 'added';
}

const files = collect(ROOT);
let added = 0;
let skipped = 0;
for (const abs of files) {
	if (processFile(abs) === 'added') added++;
	else skipped++;
}
console.log(`\n签名注入${DRY ? '（预演）' : ''}：待改 ${files.length} 个文件，本次处理 ${added} 个，已存在跳过 ${skipped} 个`);
