/**
 * 真实样本上的 GenerateNet 分析链（解析 → 连通 → 改写）验证
 *
 * 为什么单独一个文件：`test/*.test.mjs` 默认不依赖 `测试样本/`，而这个用例需要真实工程文件。
 * 所以先探测目录，不存在就整组跳过（不拉低别人的 npm test）。
 *
 * 守的三件事：
 *   1. 同一块板在 V2 / V3 / V4 三种格式下，解析出的图元数与连通分量必须一致；
 *   2. 源码改写必须**逐字节幂等** —— 把每行的网络名设成原值再写回，输出必须等于输入。
 *      这条是「整份写回不会重排用户文档」的唯一保证；
 *   3. 行尾 `|` 的有无必须按原样还原（V3/V4 里存在缺行尾的行）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { loadAllSamples } from './samples/lib/loader.mjs';
import { parseV2Primitives, parseV3Primitives } from '../iframe/js/src/app/generate-net/sourceParser.js';
import { computeClusters } from '../iframe/js/src/app/generate-net/connectivity.js';
import { createLineRewriter } from '../iframe/js/src/app/generate-net/sourceRewrite.js';

const SAMPLES_DIR = '测试样本';
const hasSamples = fs.existsSync(SAMPLES_DIR);

/**
 * 从一行源码里取出「图元 id → 该行原本的网络名」
 *
 * @param {string} line 源码行
 * @param {boolean} isV2 是否 V2 数组格式
 * @returns {{id: string, net: string}|null} 命中的键与网络名
 * @sideEffects 无（纯函数）
 */
function netOfLine(line, isV2) {
	if (!line.trim()) return null;

	if (isV2) {
		if (!line.startsWith('[')) return null;
		let arr;
		try {
			arr = JSON.parse(line);
		} catch {
			return null;
		}
		if (typeof arr[3] !== 'string' || !arr[3]) return null;
		return { id: arr[0] === 'PAD_NET' ? arr[1] + arr[4] : arr[1], net: arr[3] };
	}

	if (!line.startsWith('{') || !line.includes('||')) return null;
	const parts = (line.endsWith('|') ? line.slice(0, -1) : line).split('||');
	if (parts.length !== 2) return null;
	let left;
	let right;
	try {
		left = JSON.parse(parts[0]);
		right = JSON.parse(parts[1]);
	} catch {
		return null;
	}
	const net = right.netName || right.padNet;
	if (typeof net !== 'string' || !net) return null;

	let id = left.id;
	if (left.type === 'PAD_NET' && typeof id === 'string' && id.startsWith('[')) {
		try {
			const p = JSON.parse(id);
			id = p[1] + p[3];
		} catch {
			return null;
		}
	}
	return { id: id, net: net };
}

describe('真实样本：GenerateNet 分析链', { skip: hasSamples ? false : '缺少 测试样本/ 目录' }, () => {
	it('三种格式解析出同样的图元数 / 连通分量', async () => {
		const samples = await loadAllSamples(SAMPLES_DIR);
		const summary = [];

		for (const sample of samples) {
			const pcb = sample.docs.find((d) => d.docType === 'PCB');
			if (!pcb) continue;

			const lines = pcb.lines.map((l) => l.text);
			const isV2 = Number(String(sample.version).replace(/^V/, '')) === 2;
			const ctx = { allUsedNetNames: new Set(), padIdToPinInfo: {} };
			const parsed = isV2 ? parseV2Primitives(lines, ctx) : parseV3Primitives(lines, ctx);
			const clusters = computeClusters(parsed.primitives, [], parsed.innerLayerIds, ctx.padIdToPinInfo);
			const sizes = Object.values(clusters)
				.map((g) => g.length)
				.sort((a, b) => b - a);

			summary.push({ version: sample.version, primitives: parsed.primitives.length, sizes: sizes });
		}

		assert.ok(summary.length >= 2, `至少要能读到两个样本，实际 ${summary.length}`);
		for (const entry of summary) {
			assert.ok(entry.primitives > 0, `${entry.version} 解析出 0 个图元 —— 版本判定或字段名对不上`);
		}

		// 同一块板子在不同格式下必须得出相同的拓扑
		const first = summary[0];
		for (const entry of summary.slice(1)) {
			assert.equal(entry.primitives, first.primitives, `${entry.version} 的图元数与 ${first.version} 不一致`);
			assert.deepEqual(entry.sizes, first.sizes, `${entry.version} 的连通分量与 ${first.version} 不一致`);
		}
	});

	it('源码改写逐字节幂等（把网络名设成原值再写回）', async () => {
		const samples = await loadAllSamples(SAMPLES_DIR);
		let checked = 0;

		for (const sample of samples) {
			const pcb = sample.docs.find((d) => d.docType === 'PCB');
			if (!pcb) continue;

			const lines = pcb.lines.map((l) => l.text);
			const isV2 = Number(String(sample.version).replace(/^V/, '')) === 2;
			const netMap = new Map();
			const rewrite = createLineRewriter(netMap, isV2);

			for (const line of lines) {
				const hit = netOfLine(line, isV2);
				if (!hit) continue;

				netMap.clear();
				netMap.set(hit.id, hit.net);
				const out = rewrite(line).line;
				assert.equal(out, line, `${sample.version} 的这行被重排了：\n  原行 ${line.slice(0, 120)}\n  新行 ${out.slice(0, 120)}`);
				checked += 1;
			}
		}

		assert.ok(checked > 10, `参与比对的行太少（${checked}），样本可能没被正确读取`);
	});
});
