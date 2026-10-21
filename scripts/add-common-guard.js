/**
 * 一次性改造脚本：给每个页面脚本的 `window.WolfCommon` 解构加缺失兜底
 *
 * 背景：12 个页面在顶层直接解构 `window.WolfCommon`，一旦 common.js 未加载（旧缓存、
 * 路径变更、安装不完整），整页脚本直接 `TypeError` 白屏且没有任何提示。
 * 改造后：先取 WC 并判空，缺失时在页面上显示可读提示，再抛错中止后续脚本。
 *
 * 运行：node scripts/add-common-guard.js  （幂等，已改造过的文件会跳过）
 */
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', 'iframe', 'js', 'app');

const GUARD = [
	'const WC = window.WolfCommon;',
	'if (!WC) {',
	"\t(document.body || document.documentElement).innerHTML = '<div style=\"padding:24px;font:14px/1.6 sans-serif;color:#f28b82\">公共模块 common.js 未加载，请重新安装扩展</div>';",
	"\tthrow new Error('[狼黑工具] 公共模块 common.js 未加载');",
	'}',
];

const files = fs.readdirSync(APP_DIR).filter((f) => f.endsWith('.js'));
const report = [];

for (const name of files) {
	const file = path.join(APP_DIR, name);
	const lines = fs.readFileSync(file, 'utf8').split('\n');
	if (lines.some((l) => l.includes('const WC = window.WolfCommon'))) {
		report.push([name, '已改造，跳过']);
		continue;
	}

	const endIdx = lines.findIndex((l) => /=\s*window\.WolfCommon;\s*$/.test(l));
	if (endIdx < 0) {
		report.push([name, '未使用 WolfCommon，跳过']);
		continue;
	}

	// 往回找解构语句的起始行（const { ... } = window.WolfCommon;）
	let startIdx = endIdx;
	while (startIdx > 0 && !/^\s*(const|let|var)\b/.test(lines[startIdx])) startIdx--;
	if (!/^\s*(const|let|var)\b/.test(lines[startIdx])) {
		report.push([name, '定位失败，跳过']);
		continue;
	}

	const indent = (lines[startIdx].match(/^\s*/) || [''])[0];
	const guarded = GUARD.map((l) => indent + l);
	lines[endIdx] = lines[endIdx].replace(/=\s*window\.WolfCommon;/, '= WC;');
	lines.splice(startIdx, 0, ...guarded);

	fs.writeFileSync(file, lines.join('\n'));
	report.push([name, `已改造（第 ${startIdx + 1} 行）`]);
}

for (const [name, status] of report) console.log(name.padEnd(26), status);
console.log('改造文件数:', report.filter(([, s]) => s.startsWith('已改造')).length);
