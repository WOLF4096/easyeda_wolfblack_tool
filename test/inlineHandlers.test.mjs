/**
 * 行内事件契约测试：HTML 里 `onclick="foo(...)"` 用到的标识符，必须在打包产物里被显式暴露到 window
 *
 * 为什么必须有这条：打包产物是单文件 IIFE，页面脚本里的顶层 `function foo(){}` 不再是全局的。
 * HTML 的行内处理器只能读到 window 上的属性 —— 漏暴露的表现是「按钮点了没反应」，
 * 而且控制台只有一句 `foo is not defined`，很容易被当成样式问题查很久。
 *
 * 运行前提：先 `npm run build:iframe`（`npm test` 会自动跑构建，见 package.json 的 pretest）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const IFRAME = path.join(process.cwd(), 'iframe');

/** 行内表达式里不需要暴露的前缀（内联语句，不是函数名） */
const INLINE_PREFIX = /^(const |var |let |event\.|return |if |this\.)/;

/**
 * 取 HTML 里所有行内处理器引用的标识符
 *
 * @param {string} html HTML 源码
 * @returns {Set<string>} 标识符集合
 */
function inlineIdentifiers(html) {
	const ids = new Set();
	const re = /on(?:click|change|input|blur|keydown|mouseover)="([^"]+)"/g;
	let match;
	while ((match = re.exec(html))) {
		const expr = match[1].trim();
		if (INLINE_PREFIX.test(expr)) continue;
		const head = expr.match(/^([A-Za-z_$][\w$]*)/);
		if (head) ids.add(head[1]);
	}
	return ids;
}

/**
 * 判断产物是否把某个名字挂到了 window 上
 *
 * 支持两种写法：`window.foo = ...` 与 `Object.assign(window, { ..., foo, ... })`
 *
 * @param {string} code 产物源码
 * @param {string} name 标识符
 * @returns {boolean} 是否已暴露
 */
function exposes(code, name) {
	if (new RegExp(`window\\.${name}\\s*=`).test(code)) return true;
	const assign = code.match(/Object\.assign\(window,\s*\{[\s\S]*?\}\)/);
	if (!assign) return false;
	return new RegExp(`\\b${name}\\b`).test(assign[0]);
}

const pages = fs
	.readdirSync(IFRAME)
	.filter((f) => f.endsWith('.html'))
	.sort();

describe('行内事件契约（HTML ↔ 打包产物）', () => {
	for (const page of pages) {
		const html = fs.readFileSync(path.join(IFRAME, page), 'utf8');
		const ids = inlineIdentifiers(html);
		if (ids.size === 0) continue;

		it(`${page}：${ids.size} 个行内处理器都已暴露到 window`, () => {
			const bundle = path.join(IFRAME, 'js', 'app', page.replace(/\.html$/, '.js'));
			assert.ok(fs.existsSync(bundle), `缺少产物 ${bundle}，先跑 npm run build:iframe`);
			const code = fs.readFileSync(bundle, 'utf8');

			const missing = [...ids].filter((id) => !exposes(code, id));
			assert.deepEqual(missing, [], `${page} 未暴露：${missing.join(', ')}`);
		});
	}
});
