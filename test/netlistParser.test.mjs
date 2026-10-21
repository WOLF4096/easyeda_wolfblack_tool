/**
 * 网表解析纯函数测试
 *
 * 被测模块：src/js/autoWire/netlistParser.js
 * 该模块不依赖 `eda`，因此本文件无需任何 mock，直接导入即可。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { formatFileNetlist, formatPCBNetlist, formatSchematicNetlist, processNetlistData } from '../src/js/autoWire/netlistParser.js';

/** 静音被测模块内部的 console 输出（解析过程会打日志） */
let originLog;
let originWarn;
beforeEach(() => {
	originLog = console.log;
	originWarn = console.warn;
	console.log = () => {};
	console.warn = () => {};
});
afterEach(() => {
	console.log = originLog;
	console.warn = originWarn;
});

describe('formatSchematicNetlist - V2 格式', () => {
	it('裸对象网表 + pins 结构，按引脚提取网络', () => {
		const netlist = JSON.stringify({
			u1: { props: { Designator: 'R1' }, pins: { '1': 'GND', '2': 'VCC' } },
		});
		const result = formatSchematicNetlist(netlist, { uniqueId: 'u1' });
		assert.deepEqual(result, [
			{ uniqueId: 'u1', designator: 'R1', pin: '1', netName: 'GND' },
			{ uniqueId: 'u1', designator: 'R1', pin: '2', netName: 'VCC' },
		]);
	});

	it('pins 中值为 null/undefined 时降级为空字符串', () => {
		const netlist = JSON.stringify({
			u1: { props: { Designator: 'R1' }, pins: { '1': null, '2': 'VCC' } },
		});
		const result = formatSchematicNetlist(netlist, { uniqueId: 'u1' });
		assert.equal(result[0].netName, '');
		assert.equal(result[1].netName, 'VCC');
	});
});

describe('formatSchematicNetlist - V3 格式', () => {
	it('带 components 容器 + pinInfoMap 结构', () => {
		const netlist = JSON.stringify({
			components: {
				u1: { props: { Designator: 'C1' }, pinInfoMap: { '1': { net: 'GND' }, '2': { net: '3V3' } } },
			},
		});
		const result = formatSchematicNetlist(netlist, { uniqueId: 'u1' });
		assert.deepEqual(result, [
			{ uniqueId: 'u1', designator: 'C1', pin: '1', netName: 'GND' },
			{ uniqueId: 'u1', designator: 'C1', pin: '2', netName: '3V3' },
		]);
	});

	it('pinInfoMap 条目缺失 net 字段时降级为空字符串', () => {
		const netlist = JSON.stringify({
			components: { u1: { props: { Designator: 'C1' }, pinInfoMap: { '1': {}, '2': null } } },
		});
		const result = formatSchematicNetlist(netlist, { uniqueId: 'u1' });
		assert.deepEqual(
			result.map((r) => r.netName),
			['', ''],
		);
	});

	it('V3 但器件只有 pins（结构不匹配）时回退到 V2 的 pins 分支', () => {
		// isV3 为真但 pinInfoMap 缺失，走 else if (componentData.pins)
		const netlist = JSON.stringify({
			components: { u1: { props: { Designator: 'C1' }, pins: { '1': 'GND' } } },
		});
		const result = formatSchematicNetlist(netlist, { uniqueId: 'u1' });
		assert.equal(result.length, 1);
		assert.equal(result[0].netName, 'GND');
	});
});

describe('formatSchematicNetlist - 器件选择与异常分支', () => {
	it('传数组时逐个器件提取，空数组返回空结果', () => {
		const netlist = JSON.stringify({
			u1: { props: { Designator: 'R1' }, pins: { '1': 'GND' } },
			u2: { props: { Designator: 'R2' }, pins: { '1': 'VCC' } },
		});
		const result = formatSchematicNetlist(netlist, [{ uniqueId: 'u1' }, { uniqueId: 'u2' }]);
		assert.deepEqual(
			result.map((r) => `${r.designator}.${r.pin}=${r.netName}`),
			['R1.1=GND', 'R2.1=VCC'],
		);
		assert.deepEqual(formatSchematicNetlist(netlist, []), []);
	});

	it('单器件（非数组）入参也能处理', () => {
		const netlist = JSON.stringify({ u1: { props: { Designator: 'R1' }, pins: { '1': 'GND' } } });
		const result = formatSchematicNetlist(netlist, { uniqueId: 'u1' });
		assert.equal(result.length, 1);
	});

	it('器件不在网表中：跳过且不抛错', () => {
		const netlist = JSON.stringify({ u1: { props: { Designator: 'R1' }, pins: { '1': 'GND' } } });
		const result = formatSchematicNetlist(netlist, [{ uniqueId: 'missing' }, { uniqueId: 'u1' }]);
		assert.equal(result.length, 1);
		assert.equal(result[0].uniqueId, 'u1');
	});

	it('缺 props：整条器件跳过（拿不到位号）', () => {
		const netlist = JSON.stringify({ u1: { pins: { '1': 'GND' } } });
		assert.deepEqual(formatSchematicNetlist(netlist, { uniqueId: 'u1' }), []);
	});

	it('既无 pins 也无 pinInfoMap：跳过且不抛错', () => {
		const netlist = JSON.stringify({ u1: { props: { Designator: 'R1' } } });
		assert.deepEqual(formatSchematicNetlist(netlist, { uniqueId: 'u1' }), []);
	});

	it('网表 JSON 非法时向上抛出（由调用方捕获）', () => {
		assert.throws(() => formatSchematicNetlist('not-json', { uniqueId: 'u1' }), SyntaxError);
	});

	it('formatFileNetlist 与 formatSchematicNetlist 行为一致', () => {
		const netlist = JSON.stringify({ u1: { props: { Designator: 'R1' }, pins: { '1': 'GND' } } });
		assert.deepEqual(formatFileNetlist(netlist, { uniqueId: 'u1' }), formatSchematicNetlist(netlist, { uniqueId: 'u1' }));
	});
});

describe('formatPCBNetlist', () => {
	it('数组入参：只保留 Component，引脚取 pads[].num/net', () => {
		const pcbData = [
			{
				primitiveType: 'Component',
				uniqueId: 'u1',
				designator: 'R1',
				pads: [
					{ num: '1', net: 'GND' },
					{ num: '2', net: 'VCC' },
				],
			},
			{ primitiveType: 'Line', uniqueId: 'x', designator: 'L?', pads: [{ num: '1', net: 'N' }] },
		];
		assert.deepEqual(formatPCBNetlist(pcbData), [
			{ uniqueId: 'u1', designator: 'R1', pin: '1', netName: 'GND' },
			{ uniqueId: 'u1', designator: 'R1', pin: '2', netName: 'VCC' },
		]);
	});

	it('单个器件对象入参（非数组）', () => {
		const pcbData = { primitiveType: 'Component', uniqueId: 'u1', designator: 'R1', pads: [{ num: '1', net: 'GND' }] };
		assert.deepEqual(formatPCBNetlist(pcbData), [{ uniqueId: 'u1', designator: 'R1', pin: '1', netName: 'GND' }]);
	});

	it('焊盘 net 缺失时降级为空字符串', () => {
		const pcbData = { primitiveType: 'Component', uniqueId: 'u1', designator: 'R1', pads: [{ num: '1' }] };
		assert.equal(formatPCBNetlist(pcbData)[0].netName, '');
	});

	it('非 Component 图元被过滤，无 pads 的器件返回空数组', () => {
		assert.deepEqual(formatPCBNetlist({ primitiveType: 'Via' }), []);
		assert.deepEqual(formatPCBNetlist({ primitiveType: 'Component', uniqueId: 'u1', pads: null }), []);
	});
});

describe('processNetlistData', () => {
	const schematic = [
		{ uniqueId: 'u1', designator: 'R1', pin: '1', netName: '' },
		{ uniqueId: 'u1', designator: 'R1', pin: '2', netName: 'VCC' },
	];
	const pcb = [
		{ uniqueId: 'u1', designator: 'R1', pin: '1', netName: 'GND' },
		{ uniqueId: 'u1', designator: 'R1', pin: '2', netName: 'VCC' },
	];

	it('原理图无网、PCB 有网 → 生成待放线数据', () => {
		const result = processNetlistData(['e10'], 'u1', 'R1', schematic, pcb);
		assert.deepEqual(result, [{ componentId: 'e10', uniqueId: 'u1', designator: 'R1', pin: '1', netName: 'GND' }]);
	});

	it('两侧都有网 → 无差异，返回空数组', () => {
		const result = processNetlistData(['e10'], 'u1', 'R1', schematic, pcb).filter((r) => r.pin === '2');
		assert.deepEqual(result, []);
	});

	it('原理图侧完全缺失该引脚 → 视作无网，仍需放线', () => {
		const result = processNetlistData(['e10'], 'u1', 'R1', [], pcb);
		assert.deepEqual(
			result.map((r) => r.pin),
			['1', '2'],
		);
	});

	it('PCB 侧网名为空白字符串 → 不放线', () => {
		const blankPcb = [{ uniqueId: 'u1', designator: 'R1', pin: '1', netName: '   ' }];
		assert.deepEqual(processNetlistData(['e10'], 'u1', 'R1', schematic, blankPcb), []);
	});

	it('多图元 ID：每个 ID 各生成一条记录', () => {
		const result = processNetlistData(['e10', 'e11'], 'u1', 'R1', schematic, pcb);
		assert.deepEqual(
			result.map((r) => r.componentId),
			['e10', 'e11'],
		);
	});

	it('只处理指定 uniqueId 的器件，其它器件互不干扰', () => {
		const mixedPcb = [...pcb, { uniqueId: 'u2', designator: 'R2', pin: '1', netName: 'GND' }];
		const result = processNetlistData(['e10'], 'u1', 'R1', schematic, mixedPcb);
		assert.ok(result.every((r) => r.uniqueId === 'u1'));
		assert.equal(result.length, 1);
	});
});
