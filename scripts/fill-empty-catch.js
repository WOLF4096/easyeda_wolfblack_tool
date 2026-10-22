/**
 * 一次性改造脚本：为所有空 `catch {}` 补上日志或说明
 *
 * 原则：
 * - 逐行解析类（高频）→ `logger.debug`：默认不输出，排查时可打开，且不会刷屏；
 * - 删除/写入类（有副作用）→ `logger.warn` / `logger.error`：失败必须可见；
 * - 关闭已断开的连接（幂等）→ 记一条 log 或注释说明「可忽略」。
 *
 * 运行：node scripts/fill-empty-catch.js（幂等）
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** file → [行号, 类型, 消息]（行号以改造前为准，脚本按倒序处理，不会互相影响） */
const PLAN = {
	'iframe/js/app/ReplaceComponent.js': [
		[554, 'warn', '读取器件属性失败，已跳过该器件'],
		[567, 'error', '批量删除原器件失败，可能残留旧器件'],
		[655, 'error', '批量删除原器件失败，可能残留旧器件'],
		[802, 'warn', '读取器件库信息失败，已跳过'],
		[844, 'warn', '读取器件库信息失败，已跳过'],
	],
	'iframe/js/app/WorkingHours.js': [
		[1709, 'warn', '处理工时记录失败'],
		[1869, 'warn', '处理工时记录失败'],
	],
	'src/js/WorkingHours.js': [
		[303, 'warn', '保存提醒配置失败'],
		[346, 'debug', '读取工程信息失败（不影响计时）'],
		[377, 'debug', '读取调试开关失败'],
	],
	'iframe/js/app/EDABridge.js': [
		[24, 'comment', '控制台不可用时忽略'],
		[325, 'log', '关闭旧连接时出错（通常可忽略）'],
		[370, 'log', '关闭连接时出错（通常可忽略）'],
		[381, 'log', '关闭旧连接时出错（通常可忽略）'],
	],
	'iframe/js/app/GenerateNet.js': [
		[512, 'debug', '跳过无法解析的源码行'],
		[539, 'debug', '跳过格式异常的源码行'],
		[605, 'debug', '跳过格式异常的源码行'],
		[884, 'debug', '跳过无法识别的属性行'],
		[1452, 'debug', '跳过无法解析的 PAD_NET 行'],
	],
	'iframe/js/app/CreateFootprint.js': [
		[103, 'debug', '跳过无法解析的源码行'],
		[469, 'warn', '删除临时图元失败'],
	],
};

for (const [rel, items] of Object.entries(PLAN)) {
	const file = path.join(ROOT, rel);
	const lines = fs.readFileSync(file, 'utf8').split('\n');
	const sorted = [...items].sort((a, b) => b[0] - a[0]);
	let changed = 0;

	for (const [lineNo, kind, message] of sorted) {
		const idx = lineNo - 1;
		const line = lines[idx];
		if (!/\}\s*catch\s*\([^)]*\)\s*\{\s*\}\s*$/.test(line || '')) {
			console.log(`跳过（该行不是空 catch）: ${rel}:${lineNo} → ${String(line).trim().slice(0, 50)}`);
			continue;
		}
		const indent = (line.match(/^\s*/) || [''])[0];
		const head = line.replace(/\{\s*\}\s*$/, '{');
		const call =
			kind === 'comment'
				? `${indent}\t// ${message}`
				: kind === 'log'
					? `${indent}\tlog('${message}');`
					: `${indent}\tlogger.${kind}('${message}', e);`;
		lines.splice(idx, 1, head, call, `${indent}}`);
		changed++;
	}

	fs.writeFileSync(file, lines.join('\n'));
	console.log(`${rel}: 处理 ${changed}/${items.length}`);
}
