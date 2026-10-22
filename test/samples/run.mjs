#!/usr/bin/env node
/**
 * 测试样本自动化测试 · 命令行入口
 *
 * 用法：
 *   node test/samples/run.mjs                     # 跑「测试样本」目录下全部样本
 *   node test/samples/run.mjs --dir 测试样本       # 指定样本目录
 *   node test/samples/run.mjs --only atom        # 只跑 id 含 atom 的用例
 *   node test/samples/run.mjs --sample V4        # 只跑文件名含 V4 的样本
 *   node test/samples/run.mjs --list             # 只列出用例，不执行
 *   node test/samples/run.mjs --verbose          # 明细里也打印警告
 *   node test/samples/run.mjs --no-write         # 不落盘报告
 *
 * 退出码：0 = 全部通过；1 = 有失败（error）；2 = 环境/输入问题（如目录为空）
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import fs from 'node:fs';
import path from 'node:path';

import { createCases } from './cases.mjs';
import { discoverSamples, loadSample } from './lib/loader.mjs';
import { ROOT, loadPcbConstants, loadWolfCommon } from './lib/product.mjs';
import { buildSummary, formatConsole, toJson, toMarkdown } from './lib/report.mjs';
import { collectSampleStats } from './lib/stats.mjs';

/** 解析命令行参数 */
function parseArgs(argv) {
	const args = { dir: '测试样本', only: '', sample: '', json: '', md: '', verbose: false, write: true, list: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		if (a === '--dir') args.dir = next();
		else if (a === '--only') args.only = next();
		else if (a === '--sample') args.sample = next();
		else if (a === '--json') args.json = next();
		else if (a === '--md') args.md = next();
		else if (a === '--verbose' || a === '-v') args.verbose = true;
		else if (a === '--no-write') args.write = false;
		else if (a === '--list') args.list = true;
		else if (a === '--help' || a === '-h') args.help = true;
	}
	return args;
}

const HELP = `测试样本自动化测试

  --dir <path>      样本目录（默认：测试样本）
  --only <text>     只执行 id 包含该文本的用例
  --sample <text>   只执行文件名包含该文本的样本
  --json <path>     JSON 报告路径（默认 build/test-report/samples-report.json）
  --md <path>       Markdown 报告路径（默认 build/test-report/samples-report.md）
  --verbose, -v     明细中同时列出警告
  --no-write        不写报告文件
  --list            只列出用例
`;

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		process.stdout.write(HELP);
		return 0;
	}

	const cases = createCases();
	if (args.list) {
		process.stdout.write('可用用例：\n');
		cases.forEach((c) => process.stdout.write(`  ${c.id.padEnd(22)} [${c.category}] ${c.title}\n`));
		return 0;
	}

	// ---------- 1. 发现并装载样本 ----------
	const samplesDir = path.isAbsolute(args.dir) ? args.dir : path.join(ROOT, args.dir);
	const files = discoverSamples(samplesDir).filter((f) => !args.sample || path.basename(f).includes(args.sample));
	if (files.length === 0) {
		process.stderr.write(`✗ 在「${samplesDir}」下没有找到 .epro / .epro2 样本\n`);
		return 2;
	}

	const startedAt = Date.now();
	const WC = await loadWolfCommon();
	const PCB = await loadPcbConstants();

	const samples = [];
	for (const file of files) {
		const sample = await loadSample(file);
		sample.stats = collectSampleStats(sample, WC);
		samples.push(sample);
	}

	// ---------- 2. 逐用例执行 ----------
	const selected = cases.filter((c) => !args.only || c.id.includes(args.only));
	const ctx = { samples, WC, PCB };
	const caseResults = [];
	for (const testCase of selected) {
		const t0 = Date.now();
		let findings = [];
		try {
			findings = (await testCase.run(ctx)) || [];
		} catch (e) {
			findings = [
				{
					level: 'error',
					category: testCase.category,
					where: '（用例执行异常）',
					message: e && e.message ? e.message : String(e),
					expected: '用例正常返回',
					actual: e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : '',
				},
			];
		}
		caseResults.push({ ...testCase, findings, durationMs: Date.now() - t0 });
	}

	// ---------- 3. 汇总与输出 ----------
	const summary = buildSummary({ samplesDir, samples, caseResults, durationMs: Date.now() - startedAt });
	process.stdout.write(formatConsole(summary, { verbose: args.verbose }) + '\n');

	if (args.write) {
		const jsonPath = path.isAbsolute(args.json || '') ? args.json : path.join(ROOT, args.json || 'build/test-report/samples-report.json');
		const mdPath = path.isAbsolute(args.md || '') ? args.md : path.join(ROOT, args.md || 'build/test-report/samples-report.md');
		fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
		fs.mkdirSync(path.dirname(mdPath), { recursive: true });
		fs.writeFileSync(jsonPath, toJson(summary), 'utf8');
		fs.writeFileSync(mdPath, toMarkdown(summary), 'utf8');
		process.stdout.write(`\n报告已写入:\n  ${jsonPath}\n  ${mdPath}\n`);
	}

	return summary.ok ? 0 : 1;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((e) => {
		process.stderr.write(`✗ 运行失败: ${e && e.stack ? e.stack : e}\n`);
		process.exitCode = 2;
	});
