/**
 * @//module/ scripts/build-iframe
 * @//description/ 把 iframe/js/src 下的 ESM 源码按页面打包成 iframe/js/app/<Page>.js（单文件 IIFE）
 * @//exports/ 无（构建脚本）
 * @//dependencies/ esbuild, node:fs, node:path, tools/lib-embed
 * @//example/ npm run build:iframe
 *            npm run watch:iframe
 *
 * 为什么必须打包：EDA 宿主把 iframe 页面的每个 <script src> 内联成**无 MIME 的 blob URL**，
 * 且 blob 基址无法做相对解析 —— 原生 ESM（`import './x.js'`）在这个环境里不可用（2026-10-22 实测）。
 * 所以源码用 ESM 写、构建期合并成单文件 IIFE，运行时与今天的形态完全一致。
 *
 * 产物文件名沿用页面名（`GenerateNet` → `iframe/js/app/GenerateNet.js`），
 * 因此 18 个 HTML 的 `<script src>` 一行都不用改。
 *
 * 另有两处构建期注入（都是为了让「工时统计」导出的报告能离线打开）：
 *   - `define` 把 echarts（gzip+base64）与 fflate（原文）的源码注入 bundle（见 libInline.js）；
 *   - `dropLabels: ['CDN_FALLBACK']` 丢掉 reportTemplate.js 里的 CDN 兜底分支，
 *     保证产物里 grep 不到 cdn.jsdelivr.net —— 离线路径必须是**唯一**路径。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

import { encodeLibGzip } from '../tools/lib-embed.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'iframe', 'js', 'src');
const OUT_DIR = path.join(ROOT, 'iframe', 'js', 'app');

/**
 * 页面 → 源码入口映射
 *
 * 键 = 产物文件名（= 现有 HTML 里 `<script src="/iframe/js/app/<键>.js">` 的名字，不能改）；
 * 值 = `iframe/js/src/` 下的页面编排入口，尚未迁移的页面没有该文件，构建时跳过。
 */
const PAGES = {
	APITest: 'app/api-test/index.js',
	About: 'app/about/index.js',
	ClearEmptyProperties: 'app/clear-empty-properties/index.js',
	CodeConvert: 'app/code-convert/index.js',
	CreateFootprint: 'app/create-footprint/index.js',
	EDABridge: 'app/eda-bridge/index.js',
	GenerateNet: 'app/generate-net/index.js',
	ImportBom: 'app/import-bom/index.js',
	ImportImage: 'app/import-image/index.js',
	ImportQrcode: 'app/import-qrcode/index.js',
	InADNetlist: 'app/in-ad-netlist/index.js',
	ModifyNet: 'app/modify-net/index.js',
	NetlistUpdate3DModels: 'app/netlist-3d/index.js',
	OutPinNet: 'app/out-pin-net/index.js',
	PcbToSch: 'app/pcb-to-sch/index.js',
	PinSorting: 'app/pin-sorting/index.js',
	ReplaceComponent: 'app/replace-component/index.js',
	WorkingHours: 'app/working-hours/index.js',
};

/** 产物首行横幅：开发者署名 + 提醒这是生成物 */
const BANNER = `/*!
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 *
 * 由 npm run build:iframe 从 iframe/js/src 生成，请勿直接修改本文件
 */`;

/** 参与内联注入的第三方库（键 = 注入的 define 名后缀，值 = iframe/js 下的文件名） */
const LIB_FILES = {
	echarts: 'echarts.min.js',
	fflate: 'fflate.js',
};

/**
 * 扩展版本号（用于「关于」页显示）
 *
 * 从 `package.json` 读，保证版本号只有一个手改点；`extension.json` 仍需手改（平台读它），
 * 两者一致性由 `test/docConsistency.test.mjs` 核对。
 */
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/**
 * 生成内联注入的 define 表
 *
 * 缺文件直接抛错：静默跳过会让导出报告退回 CDN 分支（构建期已被裁掉），
 * 结果就是「导出成功但图表全空」——这种失败必须在构建时报出来。
 *
 * @returns {Record<string, string>} esbuild 的 define 表
 * @sideEffects 读 `iframe/js/<lib>` 并做 gzip
 */
function buildInlineDefines() {
	const defines = { __APP_VERSION__: JSON.stringify(`v${PKG_VERSION}`) };
	for (const [key, file] of Object.entries(LIB_FILES)) {
		const abs = path.join(ROOT, 'iframe', 'js', file);
		if (!fs.existsSync(abs)) throw new Error(`build:iframe — 内联库缺失：${abs}`);
		const source = fs.readFileSync(abs, 'utf8');
		const name = key === 'echarts' ? '__WOLF_LIB_ECHARTS_GZ__' : '__WOLF_LIB_FFLATE__';
		defines[name] = JSON.stringify(key === 'echarts' ? encodeLibGzip(source) : source);
	}
	return defines;
}

/**
 * 两种模式共用的 esbuild 配置
 *
 * @param {Record<string, string>} entryPoints 入口表
 * @param {string} logLevel 日志级别
 * @returns {import('esbuild').BuildOptions} 配置
 * @sideEffects 读文件系统（内联库）
 */
function sharedOptions(entryPoints, logLevel) {
	return {
		entryPoints,
		outdir: OUT_DIR,
		entryNames: '[name]',
		bundle: true,
		format: 'iife',
		platform: 'browser',
		target: ['chrome100'],
		minify: false,
		sourcemap: false,
		charset: 'utf8',
		logLevel,
		banner: { js: BANNER },
		define: buildInlineDefines(),
		dropLabels: ['CDN_FALLBACK'],
	};
}

/**
 * 收集本次要构建的入口
 *
 * @returns {{entryPoints: Record<string, string>, pending: string[]}} esbuild 入口表与尚未迁移的页面
 * @sideEffects 读文件系统
 */
function collectEntries() {
	const entryPoints = {};
	const pending = [];
	for (const [page, rel] of Object.entries(PAGES)) {
		const abs = path.join(SRC_DIR, rel);
		if (fs.existsSync(abs)) entryPoints[page] = abs;
		else pending.push(page);
	}
	return { entryPoints, pending };
}

/**
 * 构建一次
 *
 * @param {Record<string, string>} entryPoints 入口表
 * @returns {Promise<void>}
 * @sideEffects 写 `iframe/js/app/*.js`
 */
async function buildOnce(entryPoints) {
	await esbuild.build(sharedOptions(entryPoints, 'warning'));
}

async function main() {
	const watch = process.argv.includes('--watch');
	const { entryPoints, pending } = collectEntries();
	const names = Object.keys(entryPoints);

	if (names.length === 0) {
		process.stdout.write(`build:iframe — 暂无已迁移页面（待迁移 ${pending.length} 个），跳过\n`);
		return;
	}

	if (watch) {
		const ctx = await esbuild.context(sharedOptions(entryPoints, 'info'));
		await ctx.watch();
		process.stdout.write(`build:iframe --watch 已启动（${names.join(', ')}）\n`);
		return;
	}

	await buildOnce(entryPoints);
	const sizes = names.map((n) => {
		const f = path.join(OUT_DIR, `${n}.js`);
		return `${n}(${fs.existsSync(f) ? (fs.statSync(f).size / 1024).toFixed(0) : '?'}KB)`;
	});
	process.stdout.write(`build:iframe — 已构建 ${names.length} 个：${sizes.join(' ')}\n`);
	if (pending.length) {
		process.stdout.write(`            待迁移 ${pending.length} 个：${pending.join(', ')}\n`);
	}
}

await main();
