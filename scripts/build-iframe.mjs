/**
 * @//module/ scripts/build-iframe
 * @//description/ 把 iframe/js/src 下的 ESM 源码按页面打包成 iframe/js/app/<Page>.js（单文件 IIFE）
 * @//exports/ 无（构建脚本）
 * @//dependencies/ esbuild, node:fs, node:path
 * @//example/ npm run build:iframe
 *            npm run watch:iframe
 *
 * 为什么必须打包：EDA 宿主把 iframe 页面的每个 <script src> 内联成**无 MIME 的 blob URL**，
 * 且 blob 基址无法做相对解析 —— 原生 ESM（`import './x.js'`）在这个环境里不可用（2026-10-22 实测）。
 * 所以源码用 ESM 写、构建期合并成单文件 IIFE，运行时与今天的形态完全一致。
 *
 * 产物文件名沿用页面名（`GenerateNet` → `iframe/js/app/GenerateNet.js`），
 * 因此 18 个 HTML 的 `<script src>` 一行都不用改。
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

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

/** 产物首行横幅：提醒这是生成物 */
const BANNER = '/*! 由 npm run build:iframe 从 iframe/js/src 生成，请勿直接修改本文件 */';

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
	await esbuild.build({
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
		logLevel: 'warning',
		banner: { js: BANNER },
	});
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
		const ctx = await esbuild.context({
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
			logLevel: 'info',
			banner: { js: BANNER },
		});
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
