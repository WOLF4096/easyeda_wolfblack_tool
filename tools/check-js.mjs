/**
 * @//module/ tools/check-js
 * @//description/ iframe 前端代码的复杂度门禁（带基线，只拦「新增」违规）
 * @//exports/ 无（CLI 脚本）
 * @//dependencies/ eslint, node:child_process, node:fs, node:path
 * @//example/ npm run check:js          # 只报新增违规，有则退出码 1
 *            npm run check:js:update   # 把当前违规记为基线（用于清理存量）
 *
 * 为什么要基线而不是「一次清零」：存量违规集中在几个从原文件整体搬过来的页面入口里
 * （WorkingHours 的图表编排、PcbToSch 的源码发射等），一次性重写它们的风险远大于收益。
 * 基线把「存量」冻结住，之后任何人新增违规都会立刻失败 —— 这才是可持续的复杂度约束。
 *
 * 基线键 = `相对路径|规则|消息`（不含行号，避免改一行就把基线全部作废）。
 * 消息里带函数名与数值（`complexity of 14`），所以复杂度继续升高也会被当成新违规。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG = path.join('config', 'eslint.iframe.js');
const TARGET = 'iframe/js/src/**/*.js';
const BASELINE = path.join('config', 'eslint-baseline.json');

/**
 * 跑 ESLint 并把结果解析成违规列表
 *
 * @returns {Array<{file: string, rule: string, message: string}>} 违规列表（已归一成相对路径）
 * @sideEffects 执行子进程
 */
function runEslint() {
	let raw;
	try {
		raw = execFileSync(
			process.platform === 'win32' ? 'npx.cmd' : 'npx',
			['eslint', '--no-eslintrc', '--config', CONFIG, '-f', 'json', TARGET],
			{ cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: true }
		);
	} catch (e) {
		// ESLint 有 error 时退出码非 0，但 stdout 里仍有完整 JSON
		raw = e.stdout || '';
	}
	if (!raw.trim()) return [];

	const results = JSON.parse(raw);
	const out = [];
	for (const result of results) {
		const rel = path.relative(ROOT, result.filePath).replaceAll('\\', '/');
		for (const msg of result.messages) {
			out.push({ file: rel, rule: msg.ruleId || '(fatal)', message: msg.message });
		}
	}
	return out;
}

/**
 * 把违规列表压成「键 → 次数」的计数表
 *
 * @param {Array<{file: string, rule: string, message: string}>} list 违规列表
 * @returns {Map<string, number>} 计数表
 * @sideEffects 无（纯函数）
 */
function toCounts(list) {
	const counts = new Map();
	for (const item of list) {
		const key = `${item.file}|${item.rule}|${item.message}`;
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return counts;
}

/**
 * 读基线（不存在视为空基线）
 *
 * @returns {Map<string, number>} 基线计数表
 * @sideEffects 读文件
 */
function readBaseline() {
	if (!fs.existsSync(path.join(ROOT, BASELINE))) return new Map();
	const data = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf8'));
	return new Map(Object.entries(data.counts || {}));
}

/**
 * 比较当前与基线
 *
 * @param {Map<string, number>} current 当前计数
 * @param {Map<string, number>} baseline 基线计数
 * @returns {{added: string[], removed: string[], total: number, baseTotal: number}} 差异
 * @sideEffects 无（纯函数）
 */
function diff(current, baseline) {
	const added = [];
	const removed = [];
	let total = 0;
	let baseTotal = 0;

	for (const [key, count] of current) {
		total += count;
		const base = baseline.get(key) || 0;
		if (count > base) added.push(`${key}（基线 ${base}，现在 ${count}）`);
	}
	for (const [key, count] of baseline) {
		baseTotal += count;
		const now = current.get(key) || 0;
		if (now < count) removed.push(`${key}（基线 ${count}，现在 ${now}）`);
	}
	return { added, removed, total, baseTotal };
}

const violations = runEslint();
const current = toCounts(violations);

if (process.argv.includes('--update')) {
	const counts = Object.fromEntries([...current.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
	fs.writeFileSync(
		path.join(ROOT, BASELINE),
		JSON.stringify(
			{ updatedAt: new Date().toISOString().slice(0, 10), note: '存量违规基线，只允许减少', counts: counts },
			null,
			2
		) + '\n',
		'utf8'
	);
	process.stdout.write(`check:js — 基线已更新：${violations.length} 条违规写入 ${BASELINE}\n`);
	process.exit(0);
}

const baseline = readBaseline();
const { added, removed, total, baseTotal } = diff(current, baseline);

process.stdout.write(`check:js — 当前 ${total} 条违规，基线 ${baseTotal} 条\n`);
if (removed.length > 0) {
	process.stdout.write(`  已修复 ${removed.length} 条（可以跑 check:js:update 收紧基线）：\n`);
	for (const item of removed.slice(0, 5)) process.stdout.write(`    - ${item}\n`);
}

if (added.length === 0) {
	process.stdout.write('✓ 没有新增违规\n');
	process.exit(0);
}

process.stdout.write(`✗ 新增 ${added.length} 条违规：\n`);
for (const item of added) process.stdout.write(`  + ${item}\n`);
process.exit(1);
