/**
 * 批量修改线宽：纯逻辑层测试
 *
 * 守四件事：
 *   1. 单位与精度口径（6.000000000000001 → "6.0"、mm 3 位、千分位、三态输入）；
 *   2. 统计口径（浮点噪声合并、弧长不取弦长、柱状图以列内最大值为 100%）；
 *   3. 源码改写的**逐字节安全**（未命中的行原样返回、行尾 `|` 保留、只动 width / 只删 LINE·ARC）；
 *   4. 计划与写入（0 = 删除、留空跳过、同值 no-op、单条失败不影响整批）。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const STATS = '../iframe/js/src/app/modify-line-width/stats.js';
const READER = '../iframe/js/src/app/modify-line-width/reader.js';
const SOURCE = '../iframe/js/src/app/modify-line-width/sourceWidthWriter.js';
const WRITER = '../iframe/js/src/app/modify-line-width/writer.js';

/** V3/V4 形态的迷你源码（含浮点噪声的圆弧、以及一条非导线行） */
const DOC = [
	'{"type":"DOCHEAD"}||{"docType":"PCB"}|',
	'{"type":"LINE","ticket":158,"id":"e4"}||{"netName":"A","layerId":1,"startX":1,"startY":2,"endX":3,"endY":4,"width":10,"locked":false}|',
	'{"type":"ARC","ticket":171,"id":"e7"}||{"netName":"B","layerId":1,"startX":5,"startY":6,"endX":7,"endY":8,"angle":45,"width":6.000000000000001}|',
].join('\n');

/** V2 数组形态的迷你源码（LINE width 下标 9 / ARC width 下标 10） */
const DOC_V2 = [
	'["DOCTYPE","PCB","1.8"]',
	'["LINE","e4","","A",1,1,2,3,4,10,0]',
	'["ARC","e7","","B",1,5,6,7,8,45,6,0]',
].join('\n');

describe('stats：单位与格式化', () => {
	it('formatWidth：mil 1 位、mm 3 位、去负零、千分位', async () => {
		const { formatWidth } = await import(STATS);
		assert.equal(formatWidth(6.000000000000001, 'mil'), '6.0');
		assert.equal(formatWidth(6, 'mm'), '0.152');
		assert.equal(formatWidth(-0.04, 'mil'), '0.0');
		assert.equal(formatWidth(1000, 'mil'), '1,000.0');
		assert.equal(formatWidth(0, 'mil'), '0.0');
	});

	it('convertLength：mil ⇄ mm 往返误差可忽略', async () => {
		const { convertLength } = await import(STATS);
		assert.ok(Math.abs(convertLength(6, 'mil', 'mm') - 0.1524) < 1e-12);
		assert.ok(Math.abs(convertLength(convertLength(6, 'mil', 'mm'), 'mm', 'mil') - 6) < 1e-9);
		assert.ok(Math.abs(convertLength(0.15, 'mm', 'mil') - 5.905511811023622) < 1e-9);
		assert.ok(Number.isNaN(convertLength('abc', 'mil', 'mm')));
	});

	it('parseWidth：留空 null / 0 删除 / 正数 mil / 非法 NaN', async () => {
		const { parseWidth } = await import(STATS);
		assert.equal(parseWidth('', 'mil'), null);
		assert.equal(parseWidth('   ', 'mil'), null);
		assert.equal(parseWidth(null, 'mil'), null);
		assert.equal(parseWidth('0', 'mil'), 0);
		assert.equal(parseWidth('0.0', 'mm'), 0);
		assert.equal(parseWidth('8', 'mil'), 8);
		assert.equal(parseWidth('1,000', 'mil'), 1000);
		assert.ok(Math.abs(parseWidth('8', 'mm') - 314.96062992125985) < 1e-9);

		for (const bad of ['-1', 'abc', '1e5', '0x10', 'NaN', 'Infinity', '200000']) {
			assert.ok(Number.isNaN(parseWidth(bad, 'mil')), `${bad} 应判非法`);
		}
	});
});

describe('stats：统计与柱状图', () => {
	it('groupByWidth：浮点噪声合并、数量与长度累加、按线宽升序', async () => {
		const { groupByWidth } = await import(STATS);
		const items = [
			{ id: 'a', kind: 'line', layer: 1, widthMil: 6, lengthMil: 100 },
			{ id: 'b', kind: 'arc', layer: 1, widthMil: 6.000000000000001, lengthMil: 50 },
			{ id: 'c', kind: 'line', layer: 2, widthMil: 12, lengthMil: 30 },
			{ id: 'd', kind: 'line', layer: 1, widthMil: 10, lengthMil: 10 },
		];
		const rows = groupByWidth(items, 'mil');
		assert.deepEqual(
			rows.map((row) => [row.key, row.count, row.lengthMil, row.widthMil]),
			[
				['6.0', 2, 150, 6],
				['10.0', 1, 10, 10],
				['12.0', 1, 30, 12],
			],
		);
		assert.deepEqual(
			rows[0].items.map((item) => item.id),
			['a', 'b'],
		);
	});

	it('groupByWidth：mm 模式按 3 位小数分组', async () => {
		const { groupByWidth } = await import(STATS);
		const rows = groupByWidth(
			[
				{ id: 'a', kind: 'line', layer: 1, widthMil: 6, lengthMil: 1 },
				{ id: 'b', kind: 'line', layer: 1, widthMil: 6.0236, lengthMil: 1 },
			],
			'mm',
		);
		assert.deepEqual(
			rows.map((row) => row.key),
			['0.152', '0.153'],
		);
	});

	it('barPercent：最大值 100%、0 为 0、其余按比例且不小于 2%', async () => {
		const { barPercent } = await import(STATS);
		assert.equal(barPercent(200, 200), 100);
		assert.equal(barPercent(100, 200), 50);
		assert.equal(barPercent(0, 200), 0);
		assert.equal(barPercent(1, 10000), 2);
		assert.equal(barPercent(5, 0), 0);
	});
});

describe('reader：弧长与归一', () => {
	it('arcLengthMil：90° 弧长 ≈ 1.1107 × 弦长，负角同值', async () => {
		const { arcLengthMil } = await import(READER);
		const quarter = arcLengthMil(0, 0, 100, 0, 90);
		assert.ok(Math.abs(quarter - 111.072) < 0.01, `实际 ${quarter}`);
		assert.equal(arcLengthMil(0, 0, 100, 0, -90), quarter);
		assert.equal(arcLengthMil(0, 0, 100, 0, 0), 100);
		assert.equal(arcLengthMil(0, 0, 0, 0, 90), 0);
		assert.equal(arcLengthMil(0, 0, 100, 0, 360), 100);
	});

	it('readPrimitives：普通字段与 getter 双形态都能读，异常图元计数', async () => {
		const { readPrimitives } = await import(READER);
		const host = {
			pcb_PrimitiveLine: {
				getAll: async () => [
					{ primitiveId: 'a', layer: 1, lineWidth: 10, startX: 0, startY: 0, endX: 3, endY: 4, primitiveLock: false },
					{ primitiveId: 'bad', layer: 1, lineWidth: 0, startX: 0, startY: 0, endX: 1, endY: 1 },
				],
			},
			pcb_PrimitiveArc: {
				getAll: async () => [
					{
						getState_PrimitiveId: () => 'b',
						getState_Layer: () => 2,
						getState_LineWidth: () => 6.000000000000001,
						getState_StartX: () => 0,
						getState_StartY: () => 0,
						getState_EndX: () => 100,
						getState_EndY: () => 0,
						getState_ArcAngle: () => 90,
					},
				],
			},
		};
		const { items, skipped } = await readPrimitives(host);
		assert.equal(skipped, 1);
		assert.deepEqual(
			items.map((item) => [item.id, item.kind, item.layer, Math.round(item.lengthMil)]),
			[
				['a', 'line', 1, 5],
				['b', 'arc', 2, 111],
			],
		);
	});

	it('readPrimitives：缺少 Arc API 或 getAll 抛错时半边为空，不整体失败', async () => {
		const { readPrimitives } = await import(READER);
		const onlyLines = await readPrimitives({ pcb_PrimitiveLine: { getAll: async () => [] } });
		assert.deepEqual(onlyLines, { items: [], skipped: 0 });

		const broken = await readPrimitives({
			pcb_PrimitiveLine: {
				getAll: async () => {
					throw new Error('boom');
				},
			},
		});
		assert.deepEqual(broken, { items: [], skipped: 0 });
	});
});

describe('sourceWidthWriter：逐字节安全', () => {
	it('只改命中行的 width，其余行原样返回', async () => {
		const { rewriteWidths } = await import(SOURCE);
		const plan = { widthMap: new Map([['e4', 8]]), deleteIds: new Set() };
		const { text, changed, deleted, missing } = await rewriteWidths(DOC, plan, false);

		const before = DOC.split('\n');
		const after = text.split('\n');
		assert.equal(changed, 1);
		assert.equal(deleted, 0);
		assert.equal(missing, 0);
		assert.equal(after[0], before[0], 'DOCHEAD 不能被动');
		assert.equal(after[2], before[2], '未命中的 ARC 行必须逐字节相同');
		assert.match(after[1], /"width":8[,}]/);
		assert.ok(after[1].endsWith('}|'), '行尾 | 必须保留');
	});

	it('删除：整行去掉，行数减一，且不影响其它行', async () => {
		const { rewriteWidths } = await import(SOURCE);
		const plan = { widthMap: new Map(), deleteIds: new Set(['e7']) };
		const { text, changed, deleted } = await rewriteWidths(DOC, plan, false);
		assert.equal(deleted, 1);
		assert.equal(changed, 0);
		assert.equal(text.split('\n').length, DOC.split('\n').length - 1);
		assert.ok(!text.includes('"id":"e7"'));
		assert.ok(text.includes('"id":"e4"'));
	});

	it('同 id 但类型不是 LINE/ARC 时不删也不改', async () => {
		const { rewriteWidths } = await import(SOURCE);
		const doc = '{"type":"POLY","ticket":1,"id":"e4"}||{"width":10}|';
		const { text, changed, deleted } = await rewriteWidths(
			doc,
			{ widthMap: new Map([['e4', 8]]), deleteIds: new Set(['e4']) },
			false,
		);
		assert.equal(text, doc);
		assert.equal(changed, 0);
		assert.equal(deleted, 0);
	});

	it('V2：直线改下标 9、圆弧改下标 10，删除整行', async () => {
		const { rewriteWidths } = await import(SOURCE);
		const { text, changed, deleted } = await rewriteWidths(
			DOC_V2,
			{ widthMap: new Map([['e4', 8]]), deleteIds: new Set(['e7']) },
			true,
		);
		const lines = text.split('\n');
		assert.equal(changed, 1);
		assert.equal(deleted, 1);
		assert.equal(lines.length, 2);
		assert.deepEqual(JSON.parse(lines[1]), ['LINE', 'e4', '', 'A', 1, 1, 2, 3, 4, 8, 0]);
	});

	it('missing：计划里有、源码里没有的条数', async () => {
		const { rewriteWidths } = await import(SOURCE);
		const { missing, changed } = await rewriteWidths(
			DOC,
			{ widthMap: new Map([['nope', 8]]), deleteIds: new Set(['nada']) },
			false,
		);
		assert.equal(changed, 0);
		assert.equal(missing, 2);
	});

	it('空计划：原文逐字节不动', async () => {
		const { rewriteWidths } = await import(SOURCE);
		const { text } = await rewriteWidths(DOC, { widthMap: new Map(), deleteIds: new Set() }, false);
		assert.equal(text, DOC);
	});
});

describe('writer：计划与写入', () => {
	it('planChanges：留空跳过、0 删除、同值 no-op、非法进 invalid', async () => {
		const { planChanges } = await import(WRITER);
		const rows = [
			{ key: '6.0', widthMil: 6, input: '', items: [{ id: 'a', kind: 'line' }] },
			{ key: '10.0', widthMil: 10, input: ' 8 ', items: [{ id: 'c', kind: 'line' }] },
			{ key: '12.0', widthMil: 12, input: '0', items: [{ id: 'd', kind: 'line' }, { id: 'e', kind: 'arc' }] },
			{ key: '14.0', widthMil: 14, input: 'abc', items: [{ id: 'f', kind: 'line' }] },
			{ key: '16.0', widthMil: 16, input: '16.0', items: [{ id: 'g', kind: 'line' }] },
		];
		const plan = planChanges(rows, 'mil');
		assert.deepEqual(plan.modify, [{ id: 'c', kind: 'line', widthMil: 8 }]);
		assert.deepEqual(plan.remove, [
			{ id: 'd', kind: 'line' },
			{ id: 'e', kind: 'arc' },
		]);
		assert.equal(plan.invalid.length, 1);
		assert.equal(plan.widthMap.get('c'), 8);
		assert.ok(plan.deleteIds.has('e'));
	});

	it('writeByApi：逐条 modify + 每类一次 delete', async () => {
		const { writeByApi } = await import(WRITER);
		const calls = [];
		const host = {
			pcb_PrimitiveLine: {
				modify: async (id, property) => calls.push(['modify-line', id, property]),
				delete: async (ids) => calls.push(['delete-line', ids]),
			},
			pcb_PrimitiveArc: {
				modify: async (id, property) => calls.push(['modify-arc', id, property]),
				delete: async (ids) => calls.push(['delete-arc', ids]),
			},
		};
		const plan = {
			widthMap: new Map(),
			deleteIds: new Set(),
			modify: [{ id: 'a', kind: 'line', widthMil: 8 }],
			remove: [
				{ id: 'b', kind: 'arc' },
				{ id: 'c', kind: 'arc' },
			],
		};
		const result = await writeByApi(host, plan, {});
		assert.equal(result.ok, true);
		assert.equal(result.modified, 1);
		assert.equal(result.deleted, 2);
		assert.deepEqual(calls[0], ['modify-line', 'a', { lineWidth: 8 }]);
		assert.deepEqual(calls[1], ['delete-arc', ['b', 'c']]);
	});

	it('writeByApi：单条失败不中断整批', async () => {
		const { writeByApi } = await import(WRITER);
		const host = {
			pcb_PrimitiveLine: {
				modify: async (id) => {
					if (id === 'bad') throw new Error('locked');
				},
				delete: async () => undefined,
			},
			pcb_PrimitiveArc: { modify: async () => undefined, delete: async () => undefined },
		};
		const plan = {
			widthMap: new Map(),
			deleteIds: new Set(),
			modify: [
				{ id: 'bad', kind: 'line', widthMil: 8 },
				{ id: 'ok', kind: 'line', widthMil: 8 },
			],
			remove: [],
		};
		const result = await writeByApi(host, plan, {});
		assert.equal(result.ok, false);
		assert.equal(result.modified, 1);
		assert.deepEqual(result.failed, ['bad']);
	});

	it('writeBySource：写入改写后的整份源码', async () => {
		const { writeBySource } = await import(WRITER);
		let written = null;
		const host = {
			sys_FileManager: {
				getDocumentSource: async () => DOC,
				setDocumentSource: async (text) => {
					written = text;
					return true;
				},
			},
		};
		const plan = { widthMap: new Map([['e4', 8]]), deleteIds: new Set(['e7']) };
		const result = await writeBySource(host, plan, {});
		assert.equal(result.ok, true);
		assert.equal(result.changed, 1);
		assert.equal(result.deleted, 1);
		assert.ok(written.includes('"width":8'));
		assert.ok(!written.includes('"id":"e7"'));
	});

	it('writeBySource：源码里一条都没命中时中止，不写回', async () => {
		const { writeBySource } = await import(WRITER);
		let writeCalls = 0;
		const host = {
			sys_FileManager: {
				getDocumentSource: async () => DOC,
				setDocumentSource: async () => {
					writeCalls += 1;
					return true;
				},
			},
		};
		const result = await writeBySource(host, { widthMap: new Map([['nope', 8]]), deleteIds: new Set() }, {});
		assert.equal(result.ok, false);
		assert.equal(result.reason, 'no-match');
		assert.equal(writeCalls, 0, '不能白写一遍整份文档');
	});
});
