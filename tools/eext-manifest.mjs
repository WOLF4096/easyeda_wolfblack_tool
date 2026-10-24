/**
 * @//module/ tools/eext-manifest
 * @//description/ .eext 内容清单的唯一实现：打包（build/packaged.ts）与门禁（tools/check-eext.mjs）共用
 * @//exports/ ALLOW_RULES, CORE_REQUIRED, REQUIRED_IMAGES, toPosix, matchRule, listEextFiles, resolveRef, assertEextContent
 * @//dependencies/ ignore, node:fs, node:path
 * @//example/ node tools/check-eext.mjs        # 门禁
 *            const { listEextFiles, assertEextContent } = await import('./eext-manifest.mjs')
 *
 * 为什么要把「打什么进包」抽成一个模块：原来只有 `build/packaged.ts` 里的几行过滤，
 * 没人知道最终包里到底有什么，也没有任何机制阻止新增文件被顺手带进去。现在打包与校验
 * 走同一个函数，`.edaignore`（黑名单，决定剔除什么）+ `ALLOW_RULES`（白名单，决定允许什么）
 * 双保险：黑名单漏一行，白名单会拦住。
 *
 * 另一条硬约束：**包里少一个文件，用户那边就是白屏或点了没反应**，而 zip 照样成功、不报错。
 * 所以除了「不多」，这里还要保证「不少」——见 `assertEextContent` 的四类引用完整性检查。
 *
 * 注意：`README.md` / `CHANGELOG.md` / `PRIVACY.md` / `LICENSE` / `images/` / `locales/`
 * **不是垃圾**。扩展广场用它们渲染详情页、更新日志、详情图、许可证与多语言，EDA 会读，
 * 移出去会导致商店页空白。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import ignore from 'ignore';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 路径统一成 POSIX 分隔符（zip 内一律用 `/`）
 *
 * @param {string} p 任意路径
 * @returns {string} 正斜杠形式
 * @sideEffects 无（纯函数）
 */
export function toPosix(p) {
	return p.replaceAll('\\', '/');
}

/**
 * 允许进入 .eext 的类别
 *
 * 一条规则都没命中的文件会被判为「无关内容」。新增类别时必须改这里，
 * 而不是去 `.edaignore` 里补一行 —— 前者会经过测试，后者不会。
 *
 * @type {Array<{name: string, test: (rel: string) => boolean}>}
 */
export const ALLOW_RULES = [
	{ name: '扩展清单', test: (rel) => rel === 'extension.json' },
	// 广场展示资源：README=详情、CHANGELOG=更新日志、LICENSE=许可证、PRIVACY=隐私政策
	{ name: '广场展示资源', test: (rel) => /^(LICENSE|README\.md|CHANGELOG\.md|PRIVACY\.md)$/.test(rel) },
	{ name: '扩展入口', test: (rel) => rel === 'dist/index.js' },
	{ name: '详情图片', test: (rel) => /^images\/[^/]+\.png$/.test(rel) },
	{ name: '多语言', test: (rel) => /^locales\/.+\.json$/.test(rel) },
	{ name: '页面', test: (rel) => /^iframe\/[^/]+\.html$/.test(rel) },
	{ name: '页面样式', test: (rel) => rel === 'iframe/css/common.css' },
	// 页面打包产物（build:iframe 生成，单文件 IIFE）
	{ name: '页面产物', test: (rel) => /^iframe\/js\/app\/[^/]+\.js$/.test(rel) },
	// 页面直接用 <script src> 引入的第三方库（echarts / fflate / jszip / bwip-js）
	{ name: '第三方库', test: (rel) => /^iframe\/js\/[^/]+\.js$/.test(rel) },
];

/** 无论怎样都必须存在的文件（少一个就是坏包） */
export const CORE_REQUIRED = ['extension.json', 'dist/index.js', 'LICENSE', 'README.md', 'CHANGELOG.md', 'PRIVACY.md', 'iframe/css/common.css'];

/** 详情图 / 关于页图片：JS 里可能用运行时拼路径，静态扫描不到，这里显式点名 */
export const REQUIRED_IMAGES = ['images/logo.png', 'images/info.png', 'images/reward_qrcode.png', 'images/wx.png'];

/** 静态资源后缀（HTML 里引用这些才需要校验文件存在） */
const ASSET_EXT = /\.(js|css|png|json)$/i;

/**
 * 匹配一个文件属于哪个允许类别
 *
 * @param {string} rel POSIX 相对路径
 * @returns {string|null} 类别名；无关内容返回 null
 * @sideEffects 无（纯函数）
 */
export function matchRule(rel) {
	for (const rule of ALLOW_RULES) {
		if (rule.test(rel)) return rule.name;
	}
	return null;
}

/**
 * 读 `.edaignore` 并算出真正会打进包的文件清单
 *
 * 与旧版 `packaged.ts` 的行为保持一致：目录行结尾的 `/`（或 `\`）先去掉，
 * 再交给 `ignore` 过滤；只保留文件（目录条目本身不进 zip）。
 *
 * @param {string} root 项目根目录
 * @returns {string[]} POSIX 相对路径，已排序
 * @throws {Error} `.edaignore` 不存在时抛出（它必须入库，见 .gitignore 注释）
 * @sideEffects 读文件系统
 */
export function listEextFiles(root) {
	const ignoreFile = path.join(root, '.edaignore');
	if (!fs.existsSync(ignoreFile)) {
		throw new Error(`找不到 ${ignoreFile}。它必须随仓库分发，否则无法排除无关文件、打不出包。`);
	}
	const patterns = fs
		.readFileSync(ignoreFile, 'utf8')
		.split(/[\r\n]+/)
		.filter((line) => line.trim() !== '')
		.map((line) => (line.endsWith('/') || line.endsWith('\\') ? line.slice(0, -1) : line));
	const ig = ignore().add(patterns);

	const all = fs.readdirSync(root, { encoding: 'utf8', recursive: true }).map(toPosix);
	const kept = ig.filter(all).filter((rel) => {
		const abs = path.join(root, rel);
		return fs.existsSync(abs) && fs.lstatSync(abs).isFile();
	});
	return kept.map(toPosix).sort();
}

/**
 * 把 HTML 里的资源引用解析成包内相对路径
 *
 * 支持三种形式（都在真实页面里出现过）：
 *   - 绝对：`/iframe/js/app/X.js`、`/images/logo.png`；
 *   - 相对：`../images/wx.png`（相对当前 HTML 所在目录）；
 *   - 跳过：`#`、`data:`、`https://` 等外部或锚点引用。
 *
 * @param {string} ref 引用原文
 * @param {string} htmlRel HTML 在包内的相对路径
 * @returns {string|null} 包内相对路径；不需要校验时返回 null
 * @sideEffects 无（纯函数）
 */
export function resolveRef(ref, htmlRel) {
	const value = String(ref).trim();
	if (!value || value.startsWith('#') || value.startsWith('data:')) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // https: / javascript: 等
	if (value.startsWith('/')) return value.slice(1);
	return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(htmlRel), value)));
}

/**
 * 从 HTML 文本里取所有静态资源引用
 *
 * @param {string} html HTML 原文
 * @returns {string[]} 引用原文（含 src / href / data-img 三种属性）
 * @sideEffects 无（纯函数）
 */
function refsOf(html) {
	const out = [];
	const re = /(?:src|href|data-img)="([^"]+)"/g;
	let match;
	while ((match = re.exec(html))) out.push(match[1]);
	return out;
}

/**
 * 从 `extension.json` 里取所有菜单注册函数名
 *
 * @param {string} text extension.json 原文
 * @returns {string[]} 去重后的 registerFn 列表
 * @sideEffects 无（纯函数）
 */
function registerFnsOf(text) {
	const out = new Set();
	const re = /"registerFn"\s*:\s*"([^"]+)"/g;
	let match;
	while ((match = re.exec(text))) out.add(match[1]);
	return [...out];
}

/**
 * 从入口源码里取所有 `openPage('X')` 打开的页面名
 *
 * @param {string} text `src/index.ts` 原文
 * @returns {string[]} 去重后的页面名
 * @sideEffects 无（纯函数）
 */
function openPagesOf(text) {
	const out = new Set();
	const re = /openPage\(\s*'([^']+)'/g;
	let match;
	while ((match = re.exec(text))) out.add(match[1]);
	return [...out];
}

/**
 * 校验包内容：既不能多，也不能少
 *
 * 四类「少」的检查，每一类都对应一种真实故障：
 *   1. 核心文件缺失 → 扩展装不上 / 商店页空白；
 *   2. `registerFn` 在 `dist/index.js` 里找不到 → 菜单点下去没反应；
 *   3. `openPage('X')` 但 `iframe/X.html` 不在包里 → 点开是空白窗口；
 *   4. HTML 引用的 js/css/png 不在包里 → 页面半残（图表不显示、图片 404）。
 *
 * @param {string[]} files 包内文件清单（POSIX 相对路径）
 * @param {string} root 项目根目录（用于读 extension.json / src/index.ts / HTML 原文）
 * @returns {{problems: string[], stats: Map<string, number>}} 问题列表与按类别的数量统计
 * @sideEffects 读文件系统
 */
export function assertEextContent(files, root) {
	const problems = [];
	const stats = new Map();
	const present = new Set(files);

	// ---- 1. 无关内容 / 缺失核心文件 ----
	for (const rel of files) {
		const kind = matchRule(rel);
		if (kind === null) problems.push(`无关内容：${rel}`);
		else stats.set(kind, (stats.get(kind) || 0) + 1);
	}
	for (const rel of [...CORE_REQUIRED, ...REQUIRED_IMAGES]) {
		if (!present.has(rel)) problems.push(`缺少必需文件：${rel}`);
	}

	// ---- 2. 菜单项漏导出（改了函数名但没同步，或忘了 export）----
	// 入口缺失时由上面的 CORE_REQUIRED 报一句「缺少 dist/index.js」就够了，
	// 这里不再逐个菜单刷屏（28 条同名报错会把真正的原因埋掉）。
	const entryPath = path.join(root, 'dist', 'index.js');
	const entryText = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '';
	if (entryText) {
		for (const fn of registerFnsOf(fs.readFileSync(path.join(root, 'extension.json'), 'utf8'))) {
			if (!entryText.includes(fn)) problems.push(`extension.json 注册了 ${fn}，但 dist/index.js 里找不到它`);
		}
	}

	// ---- 3. 打开的页面不在包里 ----
	const pageSrc = path.join(root, 'src', 'index.ts');
	if (fs.existsSync(pageSrc)) {
		for (const page of openPagesOf(fs.readFileSync(pageSrc, 'utf8'))) {
			if (!present.has(`iframe/${page}.html`)) problems.push(`入口打开了 ${page}，但包里没有 iframe/${page}.html`);
		}
	}

	// ---- 4. 页面引用的静态资源不在包里 ----
	for (const rel of files) {
		if (!rel.startsWith('iframe/') || !rel.endsWith('.html')) continue;
		const html = fs.readFileSync(path.join(root, rel), 'utf8');
		for (const ref of refsOf(html)) {
			const target = resolveRef(ref, rel);
			if (!target || !ASSET_EXT.test(target)) continue;
			if (!present.has(target)) problems.push(`${rel} 引用了 ${ref}，但包里没有 ${target}`);
		}
	}

	return { problems, stats };
}
