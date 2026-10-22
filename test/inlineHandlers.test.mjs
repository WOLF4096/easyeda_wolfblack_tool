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

/**
 * 从源码里找「JS 生成的 innerHTML」中的行内处理器
 *
 * 为什么单独扫一遍：`renderManageTable()` 这类函数会用模板串生成带 `onclick="foo(...)"` 的行，
 * 这些名字**不在静态 HTML 里**，只扫 HTML 会漏 —— 实测漏暴露了
 * `exportProjectChart` / `confirmDeleteProject` 两个按钮（点了没反应）。
 *
 * @param {string} code 源码
 * @returns {Set<string>} 标识符集合
 */
function generatedIdentifiers(code) {
	const ids = new Set();
	const re = /on(?:click|change|input)="([A-Za-z_$][\w$]*)\(/g;
	let match;
	while ((match = re.exec(code))) ids.add(match[1]);
	return ids;
}

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

const SRC_APP = path.join(process.cwd(), 'iframe', 'js', 'src', 'app');

describe('生成代码里的行内处理器（innerHTML 模板串）', () => {
	if (!fs.existsSync(SRC_APP)) {
		it('跳过：尚未生成 src', () => {});
		return;
	}

	const entries = fs
		.readdirSync(SRC_APP, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => ({ dir: e.name, file: path.join(SRC_APP, e.name, 'index.js') }))
		.filter((e) => fs.existsSync(e.file));

	for (const entry of entries) {
		const code = fs.readFileSync(entry.file, 'utf8');
		const ids = generatedIdentifiers(code);
		if (ids.size === 0) continue;

		it(`${entry.dir}：模板串里的 ${ids.size} 个处理器都已暴露`, () => {
			const bundle = path.join(IFRAME, 'js', 'app', `${bundleNameOf(entry.dir)}.js`);
			assert.ok(fs.existsSync(bundle), `缺少产物 ${bundle}，先跑 npm run build:iframe`);
			const built = fs.readFileSync(bundle, 'utf8');
			const missing = [...ids].filter((id) => !exposes(built, id));
			assert.deepEqual(missing, [], `${entry.dir} 生成的行内按钮未暴露：${missing.join(', ')}`);
		});
	}
});

/**
 * 页面目录名 → 产物文件名（kebab-case → PascalCase 的已知映射）
 *
 * @param {string} dir 目录名
 * @returns {string} 产物名
 */
function bundleNameOf(dir) {
	const map = {
		'api-test': 'APITest',
		about: 'About',
		'clear-empty-properties': 'ClearEmptyProperties',
		'code-convert': 'CodeConvert',
		'create-footprint': 'CreateFootprint',
		'eda-bridge': 'EDABridge',
		'generate-net': 'GenerateNet',
		'import-bom': 'ImportBom',
		'import-image': 'ImportImage',
		'import-qrcode': 'ImportQrcode',
		'in-ad-netlist': 'InADNetlist',
		'modify-net': 'ModifyNet',
		'netlist-3d': 'NetlistUpdate3DModels',
		'out-pin-net': 'OutPinNet',
		'pcb-to-sch': 'PcbToSch',
		'pin-sorting': 'PinSorting',
		'replace-component': 'ReplaceComponent',
		'working-hours': 'WorkingHours',
	};
	return map[dir] || dir;
}
