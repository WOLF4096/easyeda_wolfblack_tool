/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/* B0 模块加载探针（在 EDA 的「EDA 桥」页面上下文里执行）
 *
 * 目的：不重新打包、不重装扩展，就判断「通道 A：原生 ESM」是否可行。
 *
 * 判定依据（三项一起看）：
 *   1. fetch('/iframe/js/common.js') 的 content-type —— 模块脚本必须是 JS MIME；
 *   2. import('/iframe/js/common.js') 是否成功 —— 该文件是 IIFE（无 export），
 *      作为模块导入是合法的，会执行并返回空命名空间；失败信息能区分 MIME / CSP / 协议问题；
 *   3. import('data:text/javascript,...') —— 渲染器本身是否支持 ESM（排除"是浏览器太老"这一因）。
 *
 * 另外顺带测相对路径解析，因为迁移后模块之间全是相对 import。
 */

const out = { checks: [], info: {} };

function push(id, ok, detail) {
	out.checks.push({ id, ok: !!ok, detail: String(detail == null ? '' : detail) });
}

/* ---------- 0. 环境 ---------- */
out.info.href = location.href;
out.info.origin = location.origin;
out.info.protocol = location.protocol;
out.info.hasEda = typeof eda;

/* ---------- 1. MIME ---------- */
let ct = null;
try {
	const res = await fetch('/iframe/js/common.js', { cache: 'no-store' });
	ct = res.headers.get('content-type');
	push('fetch /iframe/js/common.js', res.ok, `status=${res.status} content-type=${ct || '(无)'}`);
} catch (e) {
	push('fetch /iframe/js/common.js', false, 'fetch 失败：' + e.message);
}
out.info.commonContentType = ct;

/* ---------- 2. data: 模块（渲染器能力基线） ---------- */
try {
	const dm = await import('data:text/javascript,export const ok=1');
	push('import(data:)', dm.ok === 1, '渲染器支持 ESM');
} catch (e) {
	push('import(data:)', false, e.name + ': ' + e.message);
}

/* ---------- 3. 扩展 origin 上的 .js 当作模块导入 ---------- */
try {
	const m = await import('/iframe/js/common.js');
	push(
		'import(/iframe/js/common.js)',
		true,
		'成功；命名空间键=' + JSON.stringify(Object.keys(m)) + '；WolfCommon=' + typeof window.WolfCommon
	);
} catch (e) {
	push('import(/iframe/js/common.js)', false, e.name + ': ' + e.message);
}

/* ---------- 4. 相对路径解析（子目录 import 是迁移后的常态） ---------- */
try {
	const rel = new URL('../js/common.js', location.href).href;
	const m2 = await import(rel);
	push('import(相对路径→子目录)', true, rel + ' 键=' + JSON.stringify(Object.keys(m2)));
} catch (e) {
	push('import(相对路径→子目录)', false, e.name + ': ' + e.message);
}

/* ---------- 5. import.meta / 顶层 await ---------- */
try {
	const t = await import('data:text/javascript,export const v = await Promise.resolve(42)');
	push('顶层 await', t.v === 42, 'v=' + t.v);
} catch (e) {
	push('顶层 await', false, e.name + ': ' + e.message);
}

out.verdict = out.checks.every((c) => c.ok)
	? 'PASS → 通道 A（原生 ESM）可用'
	: 'CHECK → 有失败项，按失败信息判定（MIME/CSP 类失败 → 通道 B）';

return out;
