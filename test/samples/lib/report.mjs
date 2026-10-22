/**
 * 报告输出层
 *
 * 三种形态：
 *   1. 控制台：人看的摘要 + 失败明细（默认输出）
 *   2. Markdown：可归档、可贴到 PR/发布说明
 *   3. JSON：机读，供 CI 判断或二次统计
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const PASS = 'PASS';
const FAIL = 'FAIL';

/** 计算右对齐填充（中文字符按 2 宽估算，避免表格错位） */
function width(text) {
	let w = 0;
	for (const ch of String(text)) w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
	return w;
}

/** 左对齐补空格 */
function padEnd(text, len) {
	const s = String(text);
	return s + ' '.repeat(Math.max(0, len - width(s)));
}

/** Markdown 表格单元格转义（用例标题里可能出现 | ） */
function mdCell(text) {
	return String(text ?? '').replace(/\|/g, '\\|');
}

/** 图层列表压缩展示：超过 10 个只列前 8 个 + 总数 */
function summarizeLayers(layers) {
	const list = layers || [];
	if (list.length <= 10) return list.join(',') || '-';
	return list.slice(0, 8).join(',') + `…(共 ${list.length} 个)`;
}

/** 右对齐补空格 */
function padStart(text, len) {
	const s = String(text);
	return ' '.repeat(Math.max(0, len - width(s))) + s;
}

/**
 * 汇总成报告数据
 * @param {Object} input
 * @returns {Object}
 */
export function buildSummary({ samplesDir, samples, caseResults, durationMs }) {
	const sampleRows = samples.map((s) => {
		const lines = s.docs.reduce((n, d) => n + d.lines.length, 0);
		const missingTail = s.stats?.missingTrailingPipe ?? 0;
		const failed = (s.issues || []).filter((i) => i.level === 'error').length;
		return {
			name: s.name,
			version: s.version,
			editorVersion: s.editorVersion,
			packageKind: s.packageKind,
			docs: s.docs.length,
			lines,
			missingTrailingPipe: missingTail,
			layers: s.stats?.layers || [],
			maxAbsCoord: s.stats?.maxAbsCoord ?? null,
			docTypes: s.stats?.docTypes || [],
			status: failed > 0 ? FAIL : PASS,
			failures: failed,
		};
	});

	const caseRows = caseResults.map((r) => ({
		id: r.id,
		title: r.title,
		category: r.category,
		status: r.findings.some((f) => f.level === 'error') ? FAIL : PASS,
		errors: r.findings.filter((f) => f.level === 'error').length,
		warnings: r.findings.filter((f) => f.level === 'warn').length,
		durationMs: Math.round(r.durationMs),
		findings: r.findings,
	}));

	const totals = {
		samples: sampleRows.length,
		samplesPassed: sampleRows.filter((r) => r.status === PASS).length,
		docs: sampleRows.reduce((n, r) => n + r.docs, 0),
		lines: sampleRows.reduce((n, r) => n + r.lines, 0),
		cases: caseRows.length,
		casesPassed: caseRows.filter((r) => r.status === PASS).length,
		errors: caseRows.reduce((n, r) => n + r.errors, 0) + sampleRows.reduce((n, r) => n + r.failures, 0),
		warnings: caseRows.reduce((n, r) => n + r.warnings, 0),
		versions: [...new Set(sampleRows.map((r) => r.version))].sort(),
		durationMs: Math.round(durationMs),
	};

	return {
		generatedAt: new Date().toISOString(),
		samplesDir,
		totals,
		samples: sampleRows,
		cases: caseRows,
		ok: totals.errors === 0,
	};
}

/**
 * 控制台报告
 * @param {Object} summary
 * @param {{verbose?: boolean}} options
 * @returns {string}
 */
export function formatConsole(summary, { verbose = false } = {}) {
	const out = [];
	const t = summary.totals;
	out.push('');
	out.push('狼黑工具 · 测试样本自动化测试（脱离 EDA 环境）');
	out.push(`样本目录: ${summary.samplesDir}`);
	out.push(`覆盖版本: ${t.versions.join(' / ') || '-'}    样本: ${t.samples}    文档: ${t.docs}    行: ${t.lines}    耗时: ${t.durationMs}ms`);
	out.push('');
	out.push('① 样本概览');
	const header = ['样本', '版本', '文档', '行数', '缺|行', '结果'];
	const rows = summary.samples.map((s) => [s.name, s.version, String(s.docs), String(s.lines), String(s.missingTrailingPipe), s.status]);
	const widths = header.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i]))));
	const line = (cells) => '  ' + cells.map((c, i) => padEnd(c, widths[i] + 2)).join('');
	out.push(line(header));
	out.push('  ' + widths.map((w) => '─'.repeat(w + 2)).join(''));
	rows.forEach((r) => out.push(line(r)));

	out.push('');
	out.push('② 用例结果');
	const h2 = ['用例', '类别', '结果', '失败', '警告', '耗时'];
	const r2 = summary.cases.map((c) => [c.id, c.category, c.status, String(c.errors), String(c.warnings), c.durationMs + 'ms']);
	const w2 = h2.map((h, i) => Math.max(width(h), ...r2.map((r) => width(r[i]))));
	const line2 = (cells) => '  ' + cells.map((c, i) => padEnd(c, w2[i] + 2)).join('');
	out.push(line2(h2));
	out.push('  ' + w2.map((w) => '─'.repeat(w + 2)).join(''));
	r2.forEach((r) => out.push(line2(r)));

	const details = [];
	for (const c of summary.cases) {
		for (const f of c.findings) {
			if (f.level === 'error' || verbose) details.push({ caseId: c.id, ...f });
		}
	}
	if (details.length) {
		out.push('');
		out.push(`③ 明细（错误${verbose ? ' + 警告' : ''}，按用例分组）`);
		for (const d of details) {
			out.push(`  [${d.level === 'error' ? 'ERROR' : 'WARN '}] ${d.caseId} — ${d.where}`);
			out.push(`           ${d.message}`);
			if (d.expected !== undefined) out.push(`           期望: ${d.expected}`);
			if (d.actual !== undefined) out.push(`           实际: ${d.actual}`);
		}
	}

	out.push('');
	out.push('④ 观测数据（用于盯格式漂移）');
	for (const s of summary.samples) {
		out.push(`  ${padEnd(s.name, 26)} 图层: ${summarizeLayers(s.layers)}`);
		out.push(`  ${' '.repeat(26)} 坐标量级(max|x|y|): ${s.maxAbsCoord ?? '-'}    文档类型: ${s.docTypes.join(',')}`);
	}

	out.push('');
	const verdict = summary.ok
		? `结论: 全部通过 —— ${t.casesPassed}/${t.cases} 用例、${t.samplesPassed}/${t.samples} 样本通过${t.warnings ? `（${t.warnings} 条警告）` : ''}`
		: `结论: 未通过 —— ${t.errors} 个错误，见上方明细`;
	out.push(verdict);
	return out.join('\n');
}

/**
 * Markdown 报告
 * @param {Object} summary
 * @returns {string}
 */
export function toMarkdown(summary) {
	const t = summary.totals;
	const md = [];
	md.push('# 测试样本自动化测试报告');
	md.push('');
	md.push(`- 生成时间：${new Date(summary.generatedAt).toLocaleString('zh-CN')}`);
	md.push(`- 样本目录：\`${summary.samplesDir}\``);
	md.push(`- 覆盖版本：${t.versions.join(' / ') || '-'}`);
	md.push(
		`- 结论：**${summary.ok ? '全部通过' : '未通过'}**（用例 ${t.casesPassed}/${t.cases}，样本 ${t.samplesPassed}/${t.samples}，错误 ${t.errors}，警告 ${t.warnings}，耗时 ${t.durationMs}ms）`,
	);
	md.push('');
	md.push('## 一、样本概览');
	md.push('');
	md.push('| 样本 | 版本 | 包形态 | 文档 | 行数 | 缺行尾 `\\|` | 图层 | 结果 |');
	md.push('| :--- | :--- | :--- | ---: | ---: | ---: | :--- | :--- |');
	for (const s of summary.samples) {
		md.push(
			`| ${mdCell(s.name)} | ${s.version} | ${s.packageKind} | ${s.docs} | ${s.lines} | ${s.missingTrailingPipe} | ${mdCell(summarizeLayers(s.layers))} | ${s.status} |`,
		);
	}
	md.push('');
	md.push('## 二、用例结果');
	md.push('');
	md.push('| 用例 | 类别 | 结果 | 失败 | 警告 | 耗时 |');
	md.push('| :--- | :--- | :--- | ---: | ---: | ---: |');
	for (const c of summary.cases) {
		md.push(`| \`${c.id}\` ${mdCell(c.title)} | ${c.category} | ${c.status} | ${c.errors} | ${c.warnings} | ${c.durationMs}ms |`);
	}
	const failures = [];
	for (const c of summary.cases) for (const f of c.findings) if (f.level === 'error') failures.push({ caseId: c.id, ...f });
	if (failures.length) {
		md.push('');
		md.push('## 三、失败明细');
		md.push('');
		for (const f of failures) {
			md.push(`### \`${f.caseId}\` — ${f.where}`);
			md.push('');
			md.push(`- 问题：${f.message}`);
			if (f.expected !== undefined) md.push(`- 期望：\`${f.expected}\``);
			if (f.actual !== undefined) md.push(`- 实际：\`${f.actual}\``);
			md.push('');
		}
	}
	const warns = [];
	for (const c of summary.cases) for (const f of c.findings) if (f.level === 'warn') warns.push({ caseId: c.id, ...f });
	if (warns.length) {
		md.push('');
		md.push('## 四、警告');
		md.push('');
		for (const w of warns) md.push(`- \`${w.caseId}\` @ ${w.where}：${w.message}（实际：${w.actual ?? '-'}）`);
	}
	return md.join('\n');
}

/** JSON 报告（只保留结构化字段，findings 全量保留） */
export function toJson(summary) {
	return JSON.stringify(summary, null, 2);
}
