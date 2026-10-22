/**
 * B2b 页面模型测试：验证「从页面脚本搬进模块」的逻辑与迁移前行为一致
 *
 * 覆盖四个已迁移页面的纯逻辑层：
 *   - format/componentCode      ← CodeConvert 的 12 个换算函数
 *   - app/code-convert/group    ← CodeConvert 的筛选/分组/写回
 *   - app/clear-empty-properties/propsModel ← 属性分类与清空
 *   - app/import-bom/{pasteParser,bomModel} ← 粘贴解析与分组
 *   - app/out-pin-net/matrix    ← 引脚矩阵与导出数据
 *   - core/pins                 ← pinInfoMap / pins 双结构归一
 *
 * 重点守「口径」而不是「实现」：同一个编码必须换算成同一个文本，
 * 同一份粘贴必须落到同样的字段，否则用户看到的结果就变了。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('format/componentCode', () => {
	it('电阻：01C（E96）/ 4R7（内嵌小数点）/ R01 / 1002', async () => {
		const { convertCodeToValue } = await import('../iframe/js/src/format/componentCode.js');
		assert.deepEqual(convertCodeToValue('01C', 'R'), { text: '10kΩ', raw: 10000 });
		assert.deepEqual(convertCodeToValue('4R7', 'R'), { text: '4.7Ω', raw: 4.7 });
		assert.deepEqual(convertCodeToValue('R01', 'R'), { text: '10mΩ', raw: 0.01 });
		assert.deepEqual(convertCodeToValue('2K2', 'R'), { text: '2.2kΩ', raw: 2200 });
		assert.deepEqual(convertCodeToValue('1002', 'R'), { text: '10kΩ', raw: 10000 });
		assert.deepEqual(convertCodeToValue('0R', 'R'), { text: '0Ω', raw: 0 });
	});

	it('电容：104 / 4u7 / 1000（4 位仍按普通数字，不能套电阻规则）', async () => {
		const { convertCodeToValue } = await import('../iframe/js/src/format/componentCode.js');
		assert.deepEqual(convertCodeToValue('104', 'C'), { text: '100nF', raw: 100000 });
		assert.deepEqual(convertCodeToValue('4u7', 'C'), { text: '4.7uF', raw: 4700000 });
		assert.deepEqual(convertCodeToValue('1000', 'C'), { text: '1nF', raw: 1000 }, '电容 4 位是 1000pF，不是 100×10^0');
		assert.deepEqual(convertCodeToValue('1002', 'C'), { text: '1.002nF', raw: 1002 });
		assert.deepEqual(convertCodeToValue('220', 'C'), { text: '22pF', raw: 22 });
	});

	it('电感：4u7 / 100n / 4R7', async () => {
		const { convertCodeToValue } = await import('../iframe/js/src/format/componentCode.js');
		assert.deepEqual(convertCodeToValue('4u7', 'L'), { text: '4.7uH', raw: 4.7 });
		assert.deepEqual(convertCodeToValue('100n', 'L'), { text: '100nH', raw: 0.1 });
		assert.deepEqual(convertCodeToValue('4R7', 'L'), { text: '4.7uH', raw: 4.7 });
	});

	it('无法换算时原样返回文本，且 raw 为最大哨兵值', async () => {
		const { convertCodeToValue } = await import('../iframe/js/src/format/componentCode.js');
		const r = convertCodeToValue('ABC', 'R');
		assert.equal(r.text, 'ABC');
		assert.equal(r.raw, Number.MAX_VALUE);
		assert.deepEqual(convertCodeToValue('', 'R'), { text: null, raw: Number.MAX_VALUE });
		assert.deepEqual(convertCodeToValue('104', 'X'), { text: '104', raw: Number.MAX_VALUE });
	});

	it('formatValue 的单位选择与零值', async () => {
		const { formatValue } = await import('../iframe/js/src/format/componentCode.js');
		assert.equal(formatValue(0, 'R'), '0Ω');
		assert.equal(formatValue(0, 'C'), '0pF');
		assert.equal(formatValue(0, 'L'), '0uH');
		assert.equal(formatValue(0.0047, 'R'), '4.7mΩ');
		assert.equal(formatValue(2200000, 'R'), '2.2MΩ');
		assert.equal(formatValue(1e12, 'C'), '1F');
		assert.equal(formatValue(null, 'R'), null);
	});
});

describe('app/code-convert/group', () => {
	/** 造一个最小网表：R1=01C、C1=104、LED1 被排除、R2 已带单位被排除 */
	function makeNetlist() {
		return {
			R1: { props: { Designator: 'R1', Name: '01C', 'Unique ID': 'u1' } },
			C1: { props: { Designator: 'C1', Name: '104', 'Unique ID': 'u2' } },
			LED1: { props: { Designator: 'LED1', Name: 'RED', 'Unique ID': 'u3' } },
			R2: { props: { Designator: 'R2', Name: '10kΩ', 'Unique ID': 'u4' } },
		};
	}

	it('筛选：只留 R/C/L 开头且名称未带单位的器件', async () => {
		const { processComponents } = await import('../iframe/js/src/app/code-convert/group.js');
		const list = processComponents(makeNetlist());
		assert.deepEqual(
			list.map((item) => item.designator),
			['R1', 'C1']
		);
		assert.equal(list[0].value, '10kΩ');
		assert.equal(list[1].value, '100nF');
	});

	it('分组：同值同封装合并，不同类型按 R→C→L 排序', async () => {
		const { groupComponents, processComponents } = await import('../iframe/js/src/app/code-convert/group.js');
		const netlist = makeNetlist();
		netlist.R3 = { props: { Designator: 'R3', Name: '01C', 'Unique ID': 'u5' } };
		const groups = groupComponents(processComponents(netlist));
		assert.equal(groups.length, 2, 'R1 与 R3 应合并成一组');
		assert.deepEqual(groups[0].designators, ['R1', 'R3']);
		assert.equal(groups[0].compType, 'R');
		assert.equal(groups[1].compType, 'C');
	});

	it('唯一 ID 为空或重复的组标 hasError 并强制取消勾选', async () => {
		const { groupComponents, processComponents } = await import('../iframe/js/src/app/code-convert/group.js');
		const netlist = {
			R1: { props: { Designator: 'R1', Name: '01C', 'Unique ID': 'dup' } },
			R2: { props: { Designator: 'R2', Name: '01C', 'Unique ID': 'dup' } },
			C1: { props: { Designator: 'C1', Name: '104' } },
		};
		const groups = groupComponents(processComponents(netlist));
		for (const group of groups) {
			assert.equal(group.hasError, true, `${group.name} 应标为错误组`);
			assert.equal(group.modified, false);
		}
	});

	it('唯一 ID 自检区分「空」与「重复」', async () => {
		const { hasUniqueIdProblem } = await import('../iframe/js/src/app/code-convert/group.js');
		assert.deepEqual(hasUniqueIdProblem({ A: { props: { 'Unique ID': 'x' } } }), { empty: false, duplicate: false, ok: true });
		assert.equal(hasUniqueIdProblem({ A: { props: {} } }).empty, true);
		assert.equal(hasUniqueIdProblem({ A: { props: { 'Unique ID': 'x' } }, B: { props: { 'Unique ID': 'x' } } }).duplicate, true);
	});

	it('写回：只处理勾选且无错误的组，Name 与 Value 同时写', async () => {
		const { applyConversion, groupComponents, processComponents } = await import('../iframe/js/src/app/code-convert/group.js');
		const netlist = makeNetlist();
		const groups = groupComponents(processComponents(netlist));
		const count = applyConversion(groups, netlist);
		assert.equal(count, 2);
		assert.equal(netlist.R1.props.Name, '10kΩ');
		assert.equal(netlist.R1.props.Value, '10kΩ');
		assert.equal(netlist.C1.props.Value, '100nF');
		assert.equal(netlist.LED1.props.Name, 'RED', '未进入表格的器件不能被改动');
	});
});

describe('app/clear-empty-properties/propsModel', () => {
	it('属性分类：受保护 / 基础 / 关键 / 更多', async () => {
		const { categoryOf } = await import('../iframe/js/src/app/clear-empty-properties/propsModel.js');
		assert.equal(categoryOf('DeviceName'), 'preserve');
		assert.equal(categoryOf('Name'), 'base');
		assert.equal(categoryOf('Value'), 'key');
		assert.equal(categoryOf('自定义属性'), 'more');
	});

	it('建行：只收有位号的器件，供应商为空时默认勾选并预勾「更多」', async () => {
		const { buildRows } = await import('../iframe/js/src/app/clear-empty-properties/propsModel.js');
		const rows = buildRows({
			A: { props: { Designator: 'R1', Name: '10k', FootprintName: '0603', Supplier: '' } },
			B: { props: { Designator: 'R2', Supplier: 'LCSC' } },
			C: { props: { Name: '无能位号' } },
			D: null,
		});
		assert.equal(rows.length, 2);
		assert.equal(rows[0].selected, true);
		assert.equal(rows[0].clearMore, true);
		assert.equal(rows[0].footprint, '0603');
		assert.equal(rows[1].selected, false);
	});

	it('清空：只清空勾选分类、跳过受保护键与已是空串的键', async () => {
		const { buildRows, clearBySelection } = await import('../iframe/js/src/app/clear-empty-properties/propsModel.js');
		const container = {
			A: {
				props: { Designator: 'R1', Name: '10k', Value: '10k', Manufacturer: 'X', 'Group ID': 'g', 自定义: 'y', Empty: '' },
			},
		};
		const rows = buildRows(container);
		rows[0].clearBase = true;
		rows[0].clearMore = true;
		const stat = clearBySelection(rows);
		// 「基础属性」分类里除 Name 外还含 Designator，所以基础列一勾会清两个
		assert.deepEqual(stat, { components: 1, props: 3 }, 'Designator + Name + 自定义 被清，空串不计入');
		assert.equal(container.A.props.Name, '');
		assert.equal(container.A.props.Designator, '', '默认行为：Designator 属于基础属性，勾选后同样会被清空');
		assert.equal(container.A.props['自定义'], '');
		assert.equal(container.A.props.Value, '10k', '关键属性未勾选，不能动');
		assert.equal(container.A.props['Group ID'], 'g', '受保护属性永不清空');
	});

	it('未勾选行不参与清空', async () => {
		const { buildRows, clearBySelection } = await import('../iframe/js/src/app/clear-empty-properties/propsModel.js');
		const container = { A: { props: { Designator: 'R1', Name: '10k', Supplier: 'LCSC' } } };
		const rows = buildRows(container);
		rows[0].clearBase = true;
		assert.deepEqual(clearBySelection(rows), { components: 0, props: 0 });
		assert.equal(container.A.props.Name, '10k');
	});

	it('列级切换：只作用于已勾选行，全勾则取消', async () => {
		const { toggleColumn } = await import('../iframe/js/src/app/clear-empty-properties/propsModel.js');
		const rows = [
			{ selected: true, clearKey: false },
			{ selected: true, clearKey: false },
			{ selected: false, clearKey: false },
		];
		assert.equal(toggleColumn(rows, 'clearKey'), true);
		assert.deepEqual(
			rows.map((r) => r.clearKey),
			[true, true, false]
		);
		assert.equal(toggleColumn(rows, 'clearKey'), false);
		assert.deepEqual(
			rows.map((r) => r.clearKey),
			[false, false, false]
		);
		assert.equal(toggleColumn([{ selected: false, clearKey: false }], 'clearKey'), false);
	});
});

describe('app/import-bom', () => {
	it('粘贴解析：TSV 用逗号分位号，CSV 用顿号分位号', async () => {
		const { parsePaste } = await import('../iframe/js/src/app/import-bom/pasteParser.js');
		const tsv = parsePaste('R1,R2\t10k\tC1\tYAGEO\tC123\tLCSC');
		assert.deepEqual(tsv[0].designators, ['R1', 'R2']);
		assert.equal(tsv[0].name, '10k');
		assert.equal(tsv[0].manufacturerPart, 'C1');

		const csv = parsePaste('R1、R2,10k,C1,YAGEO,C123,LCSC');
		assert.deepEqual(csv[0].designators, ['R1', 'R2']);
		assert.equal(csv[0].supplier, 'LCSC');

		const padded = parsePaste('R1\t10k');
		assert.deepEqual(padded[0], { designators: ['R1'], name: '10k', manufacturerPart: '', manufacturer: '', supplierPart: '', supplier: '' });
		assert.deepEqual(parsePaste('   '), []);
	});

	it('器件名解引用：={Value} 模板取 Value', async () => {
		const { resolveComponentName } = await import('../iframe/js/src/app/import-bom/bomModel.js');
		assert.equal(resolveComponentName({ Name: '={Value}', Value: '10k' }), '10k');
		assert.equal(resolveComponentName({ Name: 'R0603' }), 'R0603');
		assert.equal(resolveComponentName({ Value: '4k7' }), '4k7');
		assert.equal(resolveComponentName({}), '');
	});

	it('分组：同值同封装合并，含 | 的名称不会串组', async () => {
		const { buildRows, groupRows } = await import('../iframe/js/src/app/import-bom/bomModel.js');
		const container = {
			A: { props: { Designator: 'R1', Name: 'A|B', 'Unique ID': 'u1' } },
			B: { props: { Designator: 'R2', Name: 'A', 'Unique ID': 'u2' } },
			C: { props: { Designator: 'R3', Name: 'A|B', 'Unique ID': 'u3' } },
		};
		const groups = groupRows(buildRows(container));
		assert.equal(groups.length, 2, 'A|B 与 A 不能因为拼接键相同而合并');
		assert.deepEqual(groups[0].designators, ['R1', 'R3']);
	});

	it('粘贴应用：位数变化计数 + C 开头自动补 LCSC + 未匹配位号单独返回', async () => {
		const { applyPaste, buildRows } = await import('../iframe/js/src/app/import-bom/bomModel.js');
		const rows = buildRows({ A: { props: { Designator: 'R1', 'Unique ID': 'u1' } } });
		const stat = applyPaste(rows, [
			{ designators: ['R1', 'R9'], name: '10k', manufacturerPart: '', manufacturer: '', supplierPart: 'C123', supplier: '' },
		]);
		assert.equal(stat.updated, 1);
		assert.deepEqual(stat.missing, ['R9']);
		assert.equal(rows[0].supplier, 'LCSC');
		assert.equal(rows[0].selected, true);
		assert.equal(rows[0].changed, true);
	});

	it('无明显变化时不计入更新', async () => {
		const { applyPaste, buildRows } = await import('../iframe/js/src/app/import-bom/bomModel.js');
		const rows = buildRows({ A: { props: { Designator: 'R1', Name: '10k', 'Unique ID': 'u1' } } });
		const stat = applyPaste(rows, [{ designators: ['R1'], name: '10k', manufacturerPart: '', manufacturer: '', supplierPart: '', supplier: '' }]);
		assert.equal(stat.updated, 0);
		assert.equal(rows[0].changed, false);
	});

	it('写回：Value 必写，Name 是模板时不覆盖', async () => {
		const { applyToComponent, buildRows } = await import('../iframe/js/src/app/import-bom/bomModel.js');
		const comp = { props: { Designator: 'R1', Name: '={Value}', Value: 'old' } };
		const rows = buildRows({ A: comp });
		rows[0].name = '10k';
		rows[0].supplier = 'LCSC';
		assert.equal(applyToComponent(rows[0], comp), true);
		assert.equal(comp.props.Value, '10k');
		assert.equal(comp.props.Name, '={Value}', '模板串不能被改成固定文本');
		assert.equal(comp.props.Supplier, 'LCSC');
		assert.equal(rows[0].changed, false, '写回后应清掉「已改动」标记');
	});
});

describe('app/out-pin-net/matrix', () => {
	const netlist = {
		A: { props: { Designator: 'R10', FootprintName: '0603' }, pinInfoMap: { 2: { net: 'GND' }, 1: { net: 'VCC' } } },
		B: { props: { Designator: 'R2', FootprintName: '0402' }, pins: { 1: 'VCC', 3: 'SIG' } },
	};

	it('core/pins 抹平 pinInfoMap 与 pins 两种结构', async () => {
		const { getPins, collectPinNumbers } = await import('../iframe/js/src/core/pins.js');
		assert.deepEqual(getPins(netlist.A), { 2: 'GND', 1: 'VCC' });
		assert.deepEqual(getPins(netlist.B), { 1: 'VCC', 3: 'SIG' });
		assert.deepEqual(collectPinNumbers([netlist.A, netlist.B]), ['1', '2', '3'], '引脚号必须按数值排序');
		assert.deepEqual(getPins(null), {});
	});

	it('矩阵：引脚列取并集，行按位号自然序', async () => {
		const { buildComponents, buildMatrix } = await import('../iframe/js/src/app/out-pin-net/matrix.js');
		const { components } = buildComponents(netlist);
		const matrix = buildMatrix(components, 'FootprintName', 'ALL');
		assert.deepEqual(matrix.pins, ['1', '2', '3']);
		assert.deepEqual(
			matrix.rows.map((r) => r.designator),
			['R2', 'R10']
		);
		assert.deepEqual(matrix.rows[0].cells, ['VCC', '', 'SIG']);
		assert.equal(matrix.corner, '所有封装');
	});

	it('按属性值筛选与角标文案', async () => {
		const { buildComponents, buildMatrix } = await import('../iframe/js/src/app/out-pin-net/matrix.js');
		const { components } = buildComponents(netlist);
		const matrix = buildMatrix(components, 'FootprintName', '0603');
		assert.equal(matrix.rows.length, 1);
		assert.equal(matrix.corner, '0603');
		assert.deepEqual(matrix.pins, ['1', '2']);
	});

	it('导出二维数组：首行角标 + 引脚，数据行首位号', async () => {
		const { buildComponents, buildMatrix, toCsvRows } = await import('../iframe/js/src/app/out-pin-net/matrix.js');
		const { components } = buildComponents(netlist);
		const rows = toCsvRows(buildMatrix(components, 'DeviceName', 'ALL'));
		assert.deepEqual(rows[0], ['所有器件', '1', '2', '3']);
		assert.deepEqual(rows[1], ['R2', 'VCC', '', 'SIG']);
	});

	it('网络长度导出：mil 与 mm 两列，按网络名自然排序', async () => {
		const { toNetLengthRows } = await import('../iframe/js/src/app/out-pin-net/matrix.js');
		const rows = toNetLengthRows([
			{ net: 'Net10', length: 100 },
			{ net: 'Net2', length: 0 },
		]);
		assert.deepEqual(rows[0], ['网络名称', '长度(mil)', '长度(mm)']);
		assert.deepEqual(rows[1], ['Net2', '0.00', '0.0000']);
		assert.deepEqual(rows[2], ['Net10', '100.00', '2.5400']);
	});
});
