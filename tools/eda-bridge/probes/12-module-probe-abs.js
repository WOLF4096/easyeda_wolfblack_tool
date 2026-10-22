/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/* B0 模块加载探针 · 第二轮
 *
 * 第一轮发现：页面文档是 `blob:https://pro.lceda.cn/<uuid>`，`/iframe/...` 这类
 * 绝对路径在文档内解析不了（base 是 blob URL）。所以这一轮换成真实资源 URL：
 *   - 先看 document.baseURI / <base> / 首个 script[src] 的真实地址；
 *   - 再用绝对 https URL 做 fetch + import。
 *
 * 判定：content-type 是 JS + import 成功 ⇒ 通道 A 可用（模块加载链路通）。
 */

const out = { checks: [], info: {} };
const push = (id, ok, detail) => out.checks.push({ id, ok: !!ok, detail: String(detail ?? '') });

/* ---------- 0. 文档基址 ---------- */
const base = document.querySelector('base');
const firstScript = document.querySelector('script[src]');
out.info.locationHref = location.href;
out.info.documentBaseURI = document.baseURI;
out.info.baseTag = base ? base.href : '(无 <base> 标签)';
out.info.firstScriptSrc = firstScript ? firstScript.src : '(无外链脚本)';
out.info.hasEda = typeof eda;

/* 用首个外链脚本反推资源根（形如 https://host/xxx/iframe/js/EDABridge.js） */
let assetRoot = null;
if (firstScript && firstScript.src) {
	const u = new URL(firstScript.src);
	assetRoot = firstScript.src.replace(/\/iframe\/js\/[^/]+$/, '');
	out.info.assetRoot = assetRoot;
}

const absCommon = assetRoot ? `${assetRoot}/iframe/js/common.js` : null;
out.info.probeUrl = absCommon;
if (!absCommon) {
	push('反推资源根', false, '拿不到首个外链脚本的绝对地址，无法定位 /iframe/js/common.js');
	return out;
}
push('反推资源根', true, absCommon);

/* ---------- 1. MIME ---------- */
let ct = null;
try {
	const res = await fetch(absCommon, { cache: 'no-store' });
	ct = res.headers.get('content-type');
	const text = await res.text();
	push(
		'fetch 绝对 URL',
		res.ok,
		`status=${res.status} content-type=${ct || '(无)'} bytes=${text.length} 首行=${JSON.stringify(text.slice(0, 40))}`
	);
} catch (e) {
	push('fetch 绝对 URL', false, e.name + ': ' + e.message);
}
out.info.contentType = ct;
const mimeOk = !!ct && /javascript|ecmascript/i.test(ct);
push('MIME 是否为 JS', mimeOk, ct || '(无 content-type)');

/* ---------- 2. 当模块导入（IIFE 无 export，合法，返回空命名空间） ---------- */
try {
	const m = await import(absCommon);
	push('import 绝对 URL', true, '成功；命名空间键=' + JSON.stringify(Object.keys(m)));
} catch (e) {
	push('import 绝对 URL', false, e.name + ': ' + e.message);
}

/* ---------- 3. 带查询串的二次导入（验证不被缓存策略坑） ---------- */
try {
	const m2 = await import(absCommon + '?probe=1');
	push('import 带 query', true, '成功；键=' + JSON.stringify(Object.keys(m2)));
} catch (e) {
	push('import 带 query', false, e.name + ': ' + e.message);
}

/* ---------- 4. 子目录相对解析：让一个 data: 模块去 import 同目录文件测不了，
        改为验证「模块内部再 import 绝对 URL」这条链路 ---------- */
try {
	const code = `import ${JSON.stringify(absCommon)}; export const ok = true;`;
	const m3 = await import('data:text/javascript,' + encodeURIComponent(code));
	push('模块内再 import', m3.ok === true, '嵌套 import 绝对 URL 成功（依赖图能展开）');
} catch (e) {
	push('模块内再 import', false, e.name + ': ' + e.message);
}

const failed = out.checks.filter((c) => !c.ok).length;
out.verdict =
	mimeOk && failed === 0
		? 'PASS → 通道 A 可用（MIME 正确 + 模块 import 链路通）'
		: !mimeOk
			? 'FAIL(MIME) → 通道 B：宿主没给 .js 正确的 JS MIME，静态 module 与 import 都会被拒'
			: `CHECK → ${failed} 项失败，按失败信息判定`;

return out;
