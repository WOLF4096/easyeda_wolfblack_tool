/**
 * 导线链式合并（纯函数）测试
 *
 * 被测模块：src/js/common/wireChain.js
 * 覆盖：连续段拼链、方向反转、弧线角度取负、分组隔离（层/网/线宽）、闭合环、容差、无效段。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPolygonPath, buildWireChains, isValidSegment, reverseSegment } from '../src/js/common/wireChain.js';

/** 造一段直线 */
function line(id, startX, startY, endX, endY, extra = {}) {
	return { type: 'L', layer: 1, net: 'GND', width: 0.2, startX, startY, endX, endY, angle: 0, item: { primitiveId: id }, ...extra };
}

/** 造一段弧线 */
function arc(id, startX, startY, endX, endY, angle, extra = {}) {
	return { type: 'ARC', layer: 1, net: 'GND', width: 0.2, startX, startY, endX, endY, angle, item: { primitiveId: id }, ...extra };
}

describe('buildWireChains - 拼链', () => {
	it('空输入 → 空数组', () => {
		assert.deepEqual(buildWireChains([]), []);
		assert.deepEqual(buildWireChains(null), []);
	});

	it('单段 → 一条只含一段的链', () => {
		const chains = buildWireChains([line('e1', 0, 0, 10, 0)]);
		assert.equal(chains.length, 1);
		assert.equal(chains[0].segments.length, 1);
	});

	it('两段首尾相接 → 合成一条链，顺序保持', () => {
		const chains = buildWireChains([line('e1', 0, 0, 10, 0), line('e2', 10, 0, 10, 10)]);
		assert.equal(chains.length, 1);
		assert.deepEqual(
			chains[0].segments.map((s) => s.item.primitiveId),
			['e1', 'e2'],
		);
	});

	it('第二段终点接第一段终点 → 合并时反转', () => {
		const chains = buildWireChains([line('e1', 0, 0, 10, 0), line('e2', 20, 0, 10, 0)]);
		assert.equal(chains.length, 1);
		const [first, second] = chains[0].segments;
		assert.deepEqual([first.startX, first.startY, first.endX, first.endY], [0, 0, 10, 0]);
		assert.deepEqual([second.startX, second.startY, second.endX, second.endY], [10, 0, 20, 0]);
	});

	it('反向弧线 → 角度取负', () => {
		const chains = buildWireChains([line('e1', 0, 0, 10, 0), arc('e2', 20, 0, 10, 0, 90)]);
		assert.equal(chains.length, 1);
		assert.equal(chains[0].segments[1].angle, -90);
		assert.equal(chains[0].segments[1].startX, 10);
		assert.equal(chains[0].segments[1].endX, 20);
	});

	it('前一段接在链头 → unshift 到最前面（保持走向一致）', () => {
		// 传入顺序故意打乱：中间段、尾段、头段
		const mid = line('mid', 10, 0, 20, 0);
		const tail = line('tail', 20, 0, 30, 0);
		const head = line('head', 0, 0, 10, 0);
		const chains = buildWireChains([mid, tail, head]);
		assert.equal(chains.length, 1);
		assert.deepEqual(
			chains[0].segments.map((s) => s.item.primitiveId),
			['head', 'mid', 'tail'],
		);
	});

	it('不同网络 / 图层 / 线宽不合并', () => {
		assert.equal(buildWireChains([line('e1', 0, 0, 10, 0), line('e2', 10, 0, 20, 0, { net: 'VCC' })]).length, 2);
		assert.equal(buildWireChains([line('e1', 0, 0, 10, 0), line('e2', 10, 0, 20, 0, { layer: 2 })]).length, 2);
		assert.equal(buildWireChains([line('e1', 0, 0, 10, 0), line('e2', 10, 0, 20, 0, { width: 0.3 })]).length, 2);
	});

	it('首尾不接 → 各自成链', () => {
		const chains = buildWireChains([line('e1', 0, 0, 10, 0), line('e2', 50, 0, 60, 0)]);
		assert.equal(chains.length, 2);
	});

	it('闭合环（矩形四段）→ 合成一条链，终点回到起点', () => {
		const chains = buildWireChains([line('e1', 0, 0, 10, 0), line('e2', 10, 0, 10, 10), line('e3', 10, 10, 0, 10), line('e4', 0, 10, 0, 0)]);
		assert.equal(chains.length, 1);
		assert.equal(chains[0].segments.length, 4);
		const last = chains[0].segments[3];
		assert.deepEqual([last.endX, last.endY], [0, 0]);
	});

	it('端点容差：浮点误差范围内仍算相接', () => {
		const a = line('e1', 0, 0, 10, 0);
		const b = line('e2', 10.0000004, 0, 20, 0);
		assert.equal(buildWireChains([a, b]).length, 1);
		// 超出容差则不合并
		const c = line('e3', 10.01, 0, 20, 0);
		assert.equal(buildWireChains([a, c]).length, 2);
	});

	it('无效段（NaN / 零长度）被过滤，不影响其它段', () => {
		const bad = line('bad', 0, 0, Number.NaN, 0);
		const zero = line('zero', 5, 5, 5, 5);
		const good = line('e1', 0, 0, 10, 0);
		const chains = buildWireChains([bad, zero, good]);
		assert.equal(chains.length, 1);
		assert.equal(chains[0].segments[0].item.primitiveId, 'e1');
	});
});

describe('buildPolygonPath - 路径拼装', () => {
	it('直线 → [x0, y0, "L", x1, y1]', () => {
		assert.deepEqual(buildPolygonPath([line('e1', 1, 2, 3, 4)]), [1, 2, 'L', 3, 4]);
	});

	it('直线 + 弧线 → 依次写入 L / ARC 段', () => {
		const path = buildPolygonPath([line('e1', 0, 0, 10, 0), arc('e2', 10, 0, 20, 5, -90)]);
		assert.deepEqual(path, [0, 0, 'L', 10, 0, 'ARC', -90, 20, 5]);
	});

	it('空链 → 空数组', () => {
		assert.deepEqual(buildPolygonPath([]), []);
		assert.deepEqual(buildPolygonPath(null), []);
	});
});

describe('reverseSegment / isValidSegment', () => {
	it('reverseSegment 交换起止点；弧线角度取负；不改原对象', () => {
		const seg = arc('e1', 0, 0, 10, 5, 45);
		const rev = reverseSegment(seg);
		assert.deepEqual([rev.startX, rev.startY, rev.endX, rev.endY], [10, 5, 0, 0]);
		assert.equal(rev.angle, -45);
		assert.deepEqual([seg.startX, seg.startY, seg.angle], [0, 0, 45], '入参不被修改');
	});

	it('isValidSegment：坐标必须是有限数且长度不为 0', () => {
		assert.equal(isValidSegment(line('e1', 0, 0, 10, 0)), true);
		assert.equal(isValidSegment(line('e2', 0, 0, 0, 0)), false);
		assert.equal(isValidSegment(line('e3', 0, 0, Infinity, 0)), false);
		assert.equal(isValidSegment(arc('e4', 0, 0, 1, 1, Number.NaN)), false);
	});
});
