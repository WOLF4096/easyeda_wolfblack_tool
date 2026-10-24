/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/* B0 模块加载探针 · 第三轮（判定性）
 *
 * 已知：iframe 页面是 blob 文档，且每个 <script src> 都被宿主改写成无 MIME 的 blob URL。
 * 本轮验证四件事，用来最终定通道：
 *   1. 宿主是否在 https://pro.lceda.cn/iframe/... 提供这些文件（若提供 → 可走绝对 URL 的 ESM）；
 *   2. blob + 正确 MIME 的模块能否被 import（排除"blob 一律不行"的误判）；
 *   3. blob + 无 MIME 的模块（复现宿主给我脚本的类型）→ 确认失败原因就是 MIME；
 *   4. blob 模块内部 import './x.js' 能否做相对解析（决定能否真正拆成多文件模块图）。
 */

const out = { checks: [] };
const push = (id, ok, detail) => out.checks.push({ id, ok: !!ok, detail: String(detail ?? '') });

/* ---------- 1. 宿主是否用 https 提供扩展文件 ---------- */
for (const url of ['https://pro.lceda.cn/iframe/js/common.js', 'https://pro.lceda.cn/iframe/EDABridge.html']) {
	try {
		const res = await fetch(url, { cache: 'no-store' });
		const text = await res.text();
		push(
			'https 直取 ' + url.replace('https://pro.lceda.cn', ''),
			res.ok && /javascript|html/i.test(res.headers.get('content-type') || ''),
			`status=${res.status} ct=${res.headers.get('content-type') || '(无)'} bytes=${text.length} 首行=${JSON.stringify(text.slice(0, 30))}`
		);
	} catch (e) {
		push('https 直取 ' + url.replace('https://pro.lceda.cn', ''), false, e.name + ': ' + e.message);
	}
}

/* ---------- 2/3. blob 模块：有 MIME vs 无 MIME ---------- */
const jsWithMime = URL.createObjectURL(new Blob(['export const ok=1'], { type: 'text/javascript' }));
try {
	const m = await import(jsWithMime);
	push('blob(有 MIME) import', m.ok === 1, '成功 → 说明 blob 模块本身可行，瓶颈在 MIME');
} catch (e) {
	push('blob(有 MIME) import', false, e.name + ': ' + e.message);
}

const jsNoMime = URL.createObjectURL(new Blob(['export const ok=2']));
try {
	const m = await import(jsNoMime);
	push('blob(无 MIME) import', false, '竟然成功（与预期不符），ok=' + m.ok);
} catch (e) {
	push('blob(无 MIME) import', true, '按预期被拒：' + e.message.slice(0, 90) + ' ← 宿主给的脚本就是这种');
}

/* ---------- 4. blob 模块内做相对 import ---------- */
const depUrl = URL.createObjectURL(new Blob(['export const v=7'], { type: 'text/javascript' }));
const mainUrl = URL.createObjectURL(
	new Blob([`import { v } from './dep.js'; export const ok = (v === 7);`], { type: 'text/javascript' })
);
try {
	const m = await import(mainUrl);
	push('blob 内相对 import', m.ok === true, '成功 → 多文件模块图可行');
} catch (e) {
	push('blob 内相对 import', false, '相对解析失败：' + e.message.slice(0, 120));
}

/* ---------- 5. 用绝对 URL 指向另一个 blob 的 import（依赖图能否手写拼起来） ---------- */
const mainUrl2 = URL.createObjectURL(
	new Blob([`import { v } from ${JSON.stringify(depUrl)}; export const ok = (v === 7);`], { type: 'text/javascript' })
);
try {
	const m = await import(mainUrl2);
	push('blob 内绝对 blob import', m.ok === true, '成功 → 理论上可用运行时 blob 图，但需自建加载器');
} catch (e) {
	push('blob 内绝对 blob import', false, e.message.slice(0, 120));
}

URL.revokeObjectURL(jsWithMime);
URL.revokeObjectURL(jsNoMime);
URL.revokeObjectURL(depUrl);
URL.revokeObjectURL(mainUrl);
URL.revokeObjectURL(mainUrl2);

const verdictMap = {
	'https 直取': '宿主根本不通过 https 提供扩展文件 → 绝对 URL 的 ESM 不可行',
};
out.notes = verdictMap;
out.summary = out.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.id}`).join(' | ');
return out;
