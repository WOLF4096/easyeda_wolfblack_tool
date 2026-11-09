/**
 * eext 内容清单（tools/eext-manifest.mjs）单测
 *
 * 守的是什么：打包脚本与门禁共用同一份清单实现，所以这份清单一旦判错，
 * 要么把垃圾打进扩展包，要么让一个缺文件的坏包顺利出厂 —— 两种都不会在本地报错，
 * 只会在用户机器上白屏。这里把「分类」「引用解析」「真实仓库无无关内容」三件事钉住。
 *
 * 注意：`dist/index.js` 与 `iframe/js/app/*.js` 是构建产物（不入库），
 * 未构建时与它们相关的断言会自动跳过，其余断言照常跑。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { assertEextContent, listEextFiles, matchRule, resolveRef } from '../tools/eext-manifest.mjs';

const ROOT = process.cwd();

describe('eext 清单：允许类别', () => {
	it('入口、清单、展示资源、图片、多语言、页面、产物、第三方库都能归类', async () => {
		const cases = [
			['extension.json', '扩展清单'],
			['dist/index.js', '扩展入口'],
			['README.md', '广场展示资源'],
			['CHANGELOG.md', '广场展示资源'],
			['LICENSE', '广场展示资源'],
			['PRIVACY.md', '广场展示资源'],
			['images/logo.png', '详情图片'],
			['locales/zh-Hans.json', '多语言'],
			['locales/extensionJson/en.json', '多语言'],
			['iframe/WorkingHours.html', '页面'],
			['iframe/css/common.css', '页面样式'],
			['iframe/js/app/WorkingHours.js', '页面产物'],
			['iframe/js/echarts.min.js', '第三方库'],
		];
		for (const [rel, expected] of cases) {
			assert.equal(matchRule(rel), expected, `${rel} 应归类为「${expected}」`);
		}
	});

	it('源码、测试、工具、样本、路径穿越一律判为无关内容', async () => {
		const junk = [
			'iframe/js/src/core/util.js',
			'iframe/js/src/package.json',
			'test/core.test.mjs',
			'tools/check-eext.mjs',
			'scripts/build-iframe.mjs',
			'docs/FORMATLOG.md',
			'package.json',
			'tsconfig.json',
			'.edaignore',
			'iframe/js/app/../../secret.js',
		];
		for (const rel of junk) {
			assert.equal(matchRule(rel), null, `${rel} 不该被打进包`);
		}
	});
});

describe('eext 清单：HTML 资源引用解析', () => {
	it('绝对路径直接去掉前导斜杠', async () => {
		assert.equal(resolveRef('/iframe/js/app/About.js', 'iframe/About.html'), 'iframe/js/app/About.js');
	});

	it('相对路径按 HTML 所在目录解析（About.html 里的 ../images/wx.png）', async () => {
		assert.equal(resolveRef('../images/wx.png', 'iframe/About.html'), 'images/wx.png');
	});

	it('锚点、外部链接、data: 不需要校验', async () => {
		assert.equal(resolveRef('#', 'iframe/About.html'), null);
		assert.equal(resolveRef('https://github.com/WOLF4096/easyeda_wolfblack_tool', 'iframe/About.html'), null);
		assert.equal(resolveRef('data:image/png;base64,AAAA', 'iframe/About.html'), null);
	});
});

describe('eext 清单：真实仓库', () => {
	const files = listEextFiles(ROOT);

	it('清单非空，且不包含源码 / 测试 / 依赖目录', async () => {
		assert.ok(files.length > 40, `清单只有 ${files.length} 个文件，明显不对`);
		for (const prefix of ['iframe/js/src/', 'test/', 'tools/', 'scripts/', 'node_modules/']) {
			assert.deepEqual(
				files.filter((rel) => rel.startsWith(prefix)),
				[],
				`${prefix} 不该出现在包里`,
			);
		}
	});

	it('清单里没有任何「无关内容」', async () => {
		const unknown = files.filter((rel) => matchRule(rel) === null);
		assert.deepEqual(unknown, [], `发现无关内容：${unknown.join(', ')}`);
	});

	it('广场展示资源与 19 个页面都在（这些是 EDA 会读的）', async () => {
		for (const rel of ['README.md', 'CHANGELOG.md', 'LICENSE', 'PRIVACY.md', 'images/info.png', 'locales/zh-Hans.json']) {
			assert.ok(files.includes(rel), `缺少展示资源 ${rel}`);
		}
		assert.equal(files.filter((rel) => /^iframe\/[^/]+\.html$/.test(rel)).length, 19, '页面数应为 19');
	});

	it('引用完整性无问题（需先构建，未构建时跳过）', async (t) => {
		if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
			return t.skip('未构建 dist/index.js，先跑 npm run build');
		}
		const { problems } = assertEextContent(files, ROOT);
		assert.deepEqual(problems, [], problems.join('\n'));
	});
});

describe('eext 清单：坏包能被拦住', () => {
	it('构造一个只剩 extension.json 的清单 → 报缺失 + 无关内容', async () => {
		const { problems } = assertEextContent(['extension.json', 'bogus.txt'], ROOT);
		assert.ok(
			problems.some((p) => p.includes('无关内容：bogus.txt')),
			`应报无关内容，实际：${problems.join(' / ')}`,
		);
		assert.ok(
			problems.some((p) => p.includes('缺少必需文件：README.md')),
			`应报缺少 README.md，实际：${problems.join(' / ')}`,
		);
	});

	it('HTML 引用了包里没有的资源 → 能被点名', async () => {
		// 真实 HTML 都在，这里只给「页面」不给「它引用的 js」，模拟忘记 build:iframe
		const { problems } = assertEextContent(['iframe/About.html'], ROOT);
		assert.ok(
			problems.some((p) => p.includes('iframe/About.html') && p.includes('包里没有')),
			`应报 About.html 的引用缺失，实际：${problems.join(' / ')}`,
		);
	});
});
