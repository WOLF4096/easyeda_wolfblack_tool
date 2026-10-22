/**
 * @//module/ tools/check-deps
 * @//description/ 前端模块依赖方向门禁：分层单向、禁止循环
 * @//exports/ 无（CLI 脚本）
 * @//dependencies/ node:fs, node:path
 * @//example/ npm run check:deps
 *
 * 分层约定（下面 LAYER_RULES 是唯一事实来源）：
 *   core（平台内核） < format / sch / ui（基础能力） < app（页面编排）
 * 规则：**只能依赖同层或更低层**；页面之间互不依赖（app/<页> 只能 import 自己的目录）。
 *
 * 为什么要这道门：拆完 82 个模块后，最容易发生的退化是「页面 A 顺手 import 了页面 B 的模型」，
 * 几个月后就又粘成一团，而 `npm test` 完全发现不了。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'iframe', 'js', 'src');

/** 目录 → 层号（数字越小越底层） */
const LAYERS = {
	core: 0,
	format: 1,
	pcb: 1, // 跨页面复用的 PCB 交互（跟手放置控制器），被 import-image / import-qrcode 共用
	sch: 1,
	ui: 1,
	app: 2,
};

/**
 * 递归收集 src 下的所有模块
 *
 * @param {string} dir 目录
 * @returns {string[]} 绝对路径
 * @sideEffects 读文件系统
 */
function collect(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...collect(abs));
		else if (entry.name.endsWith('.js')) out.push(abs);
	}
	return out.sort();
}

/**
 * 取相对 src 的模块 id（形如 `app/generate-net/plan`）
 *
 * @param {string} abs 绝对路径
 * @returns {string} 模块 id
 * @sideEffects 无（纯函数）
 */
function idOf(abs) {
	return path.relative(SRC, abs).replaceAll('\\', '/').replace(/\.js$/, '');
}

/**
 * 取模块所属层与页面域
 *
 * @param {string} id 模块 id
 * @returns {{layer: number, area: string}} 层与域（app 下第二段是页面名，其余为层名）
 * @sideEffects 无（纯函数）
 */
function layerOf(id) {
	const seg = id.split('/');
	const top = seg[0];
	return { layer: LAYERS[top] === undefined ? 9 : LAYERS[top], area: top === 'app' ? `app/${seg[1]}` : top };
}

/**
 * 取一个文件里的静态 import 目标
 *
 * @param {string} code 源码
 * @returns {string[]} import 路径（原样）
 * @sideEffects 无（纯函数）
 */
function importsOf(code) {
	const out = [];
	const re = /\bfrom\s+['"]([^'"]+)['"]/g;
	let m;
	while ((m = re.exec(code))) out.push(m[1]);
	return out;
}

const files = collect(SRC);
const graph = new Map();
const problems = [];

for (const file of files) {
	const from = idOf(file);
	const code = fs.readFileSync(file, 'utf8');
	const deps = [];

	for (const spec of importsOf(code)) {
		if (!spec.startsWith('.')) {
			problems.push(`${from} → 非法裸导入 '${spec}'（前端不能依赖 node_modules，宿主不保证能加载）`);
			continue;
		}
		const targetAbs = path.resolve(path.dirname(file), spec);
		const to = idOf(targetAbs);
		deps.push(to);

		const a = layerOf(from);
		const b = layerOf(to);

		if (b.layer === 9) {
			problems.push(`${from} → '${spec}' 解析到了 src 之外的路径`);
			continue;
		}
		if (b.layer > a.layer) {
			problems.push(`${from}（${a.area}）反向依赖 ${to}（${b.area}）—— 只能依赖同层或更低层`);
			continue;
		}
		// 页面之间互不依赖：app/<A> 不能 import app/<B>
		if (a.area.startsWith('app/') && b.area.startsWith('app/') && a.area !== b.area) {
			problems.push(`${from} 跨页面依赖 ${to}（${a.area} → ${b.area}）—— 共用逻辑应上提到 core/ui/sch/format`);
		}
	}
	graph.set(from, deps);
}

// 环检测（DFS 三色）
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map([...graph.keys()].map((k) => [k, WHITE]));
const cycles = [];

/**
 * 深度优先找环
 *
 * @param {string} node 当前模块
 * @param {string[]} stack 当前路径
 * @returns {void}
 * @sideEffects 修改 `color` 与 `cycles`
 */
function visit(node, stack) {
	color.set(node, GRAY);
	for (const dep of graph.get(node) || []) {
		if (!graph.has(dep)) continue;
		const c = color.get(dep);
		if (c === GRAY) cycles.push([...stack.slice(stack.indexOf(dep)), dep].join(' → '));
		else if (c === WHITE) visit(dep, [...stack, dep]);
	}
	color.set(node, BLACK);
}

for (const node of graph.keys()) {
	if (color.get(node) === WHITE) visit(node, [node]);
}

const edgeCount = [...graph.values()].reduce((sum, deps) => sum + deps.length, 0);
process.stdout.write(`check:deps — ${files.length} 个模块、${edgeCount} 条 import\n`);

if (cycles.length > 0) {
	process.stdout.write(`✗ 发现 ${cycles.length} 处循环依赖：\n`);
	for (const c of cycles.slice(0, 10)) process.stdout.write(`  - ${c}\n`);
}
if (problems.length > 0) {
	process.stdout.write(`✗ 发现 ${problems.length} 处依赖方向违规：\n`);
	for (const p of problems.slice(0, 20)) process.stdout.write(`  - ${p}\n`);
}
if (problems.length === 0 && cycles.length === 0) {
	process.stdout.write('✓ 分层单向、无循环依赖\n');
	process.exit(0);
}
process.exit(1);
