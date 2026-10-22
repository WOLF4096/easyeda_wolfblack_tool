/**
 * 模块头契约测试（把 `@//module/ @//description/ @//exports/ @//dependencies/ @//example/` 变成可执行检查）
 *
 * 为什么值得单独守：模块头的 `@//exports/` 一旦和真实导出一致性漂移，
 * 后来的人会按注释去 import 一个已经不存在的函数 —— 而打包是静态的，只有运行时才炸。
 *
 * 同时守住两条约定：
 *   1. 五个标签齐全且顺序固定；
 *   2. 不允许 `export default`（统一具名导出）。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SRC_ROOT = path.join(process.cwd(), 'iframe', 'js', 'src');
const TAGS = ['@//module/', '@//description/', '@//exports/', '@//dependencies/', '@//example/'];

/**
 * 递归收集待检查的模块文件
 *
 * @param {string} dir 目录
 * @returns {string[]} 文件的绝对路径
 */
function collect(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...collect(abs));
		else if (entry.name.endsWith('.js')) out.push(abs);
	}
	return out.sort();
}

/**
 * 取文件顶部的块注释
 *
 * @param {string} code 源码
 * @returns {string} 注释正文（含定界符）；没有则空串
 */
function headerOf(code) {
	const trimmed = code.replace(/^\uFEFF/, '').trimStart();
	if (!trimmed.startsWith('/**')) return '';
	const end = trimmed.indexOf('*/');
	return end === -1 ? '' : trimmed.slice(0, end + 2);
}

/**
 * 读某个标签的值
 *
 * @param {string} header 模块头注释
 * @param {string} tag 标签（含 `@//` 前缀）
 * @returns {string|null} 标签值；不存在返回 null
 */
function tagValue(header, tag) {
	const line = header
		.split('\n')
		.map((l) => l.replace(/^\s*\*\s?/, '').trim())
		.find((l) => l.startsWith(tag));
	return line ? line.slice(tag.length).trim() : null;
}

const files = fs.existsSync(SRC_ROOT) ? collect(SRC_ROOT) : [];

describe('模块头契约（iframe/js/src/**）', () => {
	it('至少能扫描到已迁移模块', () => {
		assert.ok(files.length >= 9, `应至少扫描到 9 个模块，实际 ${files.length}`);
	});

	for (const file of files) {
		const rel = path.relative(SRC_ROOT, file).replaceAll('\\', '/');
		const expectedId = rel.replace(/\.js$/, '');

		it(`${rel}：五个标签齐全且顺序固定`, () => {
			const header = headerOf(fs.readFileSync(file, 'utf8'));
			assert.ok(header, `${rel} 缺少顶部块注释`);
			let cursor = -1;
			for (const tag of TAGS) {
				const at = header.indexOf(tag);
				assert.ok(at !== -1, `${rel} 缺少 ${tag}`);
				assert.ok(at > cursor, `${rel} 的 ${tag} 顺序不对`);
				assert.ok(tagValue(header, tag), `${rel} 的 ${tag} 值为空`);
				cursor = at;
			}
		});

		it(`${rel}：@//module/ 与文件路径一致`, () => {
			const header = headerOf(fs.readFileSync(file, 'utf8'));
			assert.equal(tagValue(header, '@//module/'), expectedId);
		});

		it(`${rel}：@//exports/ 与真实导出一致`, async () => {
			const header = headerOf(fs.readFileSync(file, 'utf8'));
			const declared = tagValue(header, '@//exports/');
			const expected = declared === '无' ? [] : declared.split(',').map((s) => s.trim()).filter(Boolean);

			if (expected.length === 0) {
				// 页面入口没有导出，且**不能 import**（它在导入时就会去查 DOM、拉网表）。
				// 所以这里改验源码：注释之外不允许出现 export 语句。
				const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
				assert.equal(/^\s*export\s/m.test(code), false, `${rel} 声明无导出，但源码里有 export 语句`);
				return;
			}

			const mod = await import(`../iframe/js/src/${rel}`);
			const actual = Object.keys(mod).sort();
			assert.deepEqual(actual, expected.slice().sort(), `${rel} 的导出与模块头不一致`);
		});

		it(`${rel}：不使用 export default`, () => {
			const code = fs.readFileSync(file, 'utf8');
			assert.equal(/export\s+default/.test(code), false, `${rel} 不应使用 export default`);
		});
	}
});
