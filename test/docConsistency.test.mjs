/**
 * 文档一致性测试
 *
 * 守三件事：
 *   1. README 的功能表与 `features.js` 逐条一致（名称、顺序、一句话说明）——两处各写各的必然漂移；
 *   2. 每条「一句话说明」不超过 32 个字符（README 表格与「关于」页共用同一段文字）；
 *   3. `package.json` 与 `extension.json` 的版本号一致（平台只读后者，漏改会装成旧版）。
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

const ROOT = process.cwd();
const MAX_BRIEF = 32;

/**
 * 读取 README 的功能表
 *
 * 只解析「## 功能清单」标题下的第一张表，按行拆出「名称 / 一句话说明」两列。
 *
 * @returns {Array<{name: string, brief: string}>} 表格行
 * @sideEffects 读文件
 */
function readReadmeTable() {
	const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === '## 功能清单');
	assert.ok(start >= 0, 'README 里找不到「## 功能清单」标题');

	const rows = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line.startsWith('## ')) break;
		if (!line.startsWith('|')) continue;
		const cells = line.split('|').map((c) => c.trim());
		// 形如 ['', 名称, 一句话, 在哪用, 版本, 演示, '']，跳过分隔行与表头
		if (cells.length < 4) continue;
		if (/^:?-+:?$/.test(cells[1]) || cells[1] === '功能') continue;
		rows.push({ name: cells[1], brief: cells[2] });
	}
	return rows;
}

describe('文档一致性', () => {
	it('README 功能表与 features.js 逐条一致（名称、顺序、一句话）', async () => {
		const { featuresData } = await import('../iframe/js/src/app/about/features.js');
		const rows = readReadmeTable();
		assert.equal(rows.length, featuresData.length, 'README 功能表条数与 features.js 不一致');
		featuresData.forEach((item, i) => {
			assert.equal(rows[i].name, item.name, `第 ${i + 1} 行功能名不一致`);
			assert.equal(rows[i].brief, item.brief, `「${item.name}」的一句话说明不一致`);
		});
	});

	it('每条一句话说明不超过 32 个字符', async () => {
		const { featuresData } = await import('../iframe/js/src/app/about/features.js');
		const tooLong = featuresData.filter((item) => [...item.brief].length > MAX_BRIEF);
		assert.deepEqual(
			tooLong.map((item) => `${item.name}: ${[...item.brief].length} 字`),
			[],
			`有说明超过 ${MAX_BRIEF} 字`
		);
	});

	it('每个功能都有步骤，且版本标注只有两种', async () => {
		const { featuresData } = await import('../iframe/js/src/app/about/features.js');
		for (const item of featuresData) {
			assert.ok(Array.isArray(item.steps) && item.steps.length >= 2, `「${item.name}」缺少使用步骤`);
			assert.ok(['V2.2.45 ~ 4', '仅 V2.2.45'].includes(item.version), `「${item.name}」版本标注异常：${item.version}`);
		}
		const onlyV22 = featuresData.filter((item) => item.version === '仅 V2.2.45').map((item) => item.name);
		assert.deepEqual(onlyV22, ['创建封装'], '只有「创建封装」允许标注为仅 V2.2.45');
	});

	it('package.json 与 extension.json 版本号一致', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
		const ext = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension.json'), 'utf8'));
		assert.equal(pkg.version, ext.version, '两处版本号不一致（平台读 extension.json）');
	});

	it('「关于」页保留 5 个入口链接', () => {
		const html = fs.readFileSync(path.join(ROOT, 'iframe', 'About.html'), 'utf8');
		for (const label of ['Github 主页', '更新日志', '嘉立创EDA扩展广场', '联系开发者', '请开发者喝咖啡']) {
			assert.ok(html.includes(label), `「关于」页缺少入口：${label}`);
		}
		assert.ok(html.includes('id="appVersion"'), '「关于」页缺少版本号占位');
	});
});
