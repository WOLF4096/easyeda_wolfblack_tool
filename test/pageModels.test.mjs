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

describe('app/modify-net/replacePlan', () => {
	it('解析 TSV 规则：跳过空行与缺列', async () => {
		const { parseRules } = await import('../iframe/js/src/app/modify-net/replacePlan.js');
		const rules = parseRules(' NET_A\tNET_X \n\n坏行\nNET_B\tNET_Y\n\tNET_Z\n');
		assert.deepEqual(rules, [
			{ oldName: 'NET_A', newName: 'NET_X' },
			{ oldName: 'NET_B', newName: 'NET_Y' },
		]);
	});

	it('映射表：键统一小写，值按开关转大写', async () => {
		const { buildReplaceMap } = await import('../iframe/js/src/app/modify-net/replacePlan.js');
		const map = buildReplaceMap([{ oldName: 'Net_A', newName: 'net_x' }], true);
		assert.equal(map.get('net_a'), 'NET_X');
		const keep = buildReplaceMap([{ oldName: 'Net_A', newName: 'net_x' }], false);
		assert.equal(keep.get('net_a'), 'net_x');
	});

	it('改写两种引脚结构并产出逐条日志', async () => {
		const { applyRenames } = await import('../iframe/js/src/app/modify-net/replacePlan.js');
		const container = {
			A: { props: { Designator: 'R1' }, pinInfoMap: { 1: { net: 'net_a' }, 2: { net: 'OTHER' } } },
			B: { props: { Designator: 'R2' }, pins: { 1: 'NET_A' } },
		};
		const map = new Map([['net_a', 'NET_X']]);
		const { count, lines } = applyRenames(container, map);
		assert.equal(count, 2);
		assert.equal(container.A.pinInfoMap[1].net, 'NET_X');
		assert.equal(container.A.pinInfoMap[2].net, 'OTHER', '不匹配的网络不能动');
		assert.equal(container.B.pins[1], 'NET_X');
		assert.deepEqual(lines, ['替换: R1.1 [net_a -> NET_X]', '替换: R2.1 [NET_A -> NET_X]']);
	});

	it('listPinsOf 引脚按数值排序', async () => {
		const { listPinsOf } = await import('../iframe/js/src/app/modify-net/replacePlan.js');
		const list = listPinsOf({ pins: { 10: 'B', 2: 'A', 1: '' } });
		assert.deepEqual(
			list.map((p) => p.pin),
			['1', '2', '10']
		);
		assert.equal(list[0].net, '');
	});
});

describe('app/netlist-3d/transform', () => {
	it('Transform 解析/重建：rZ 在存储序里位于 rX 之前', async () => {
		const { parseTransform, composeTransform } = await import('../iframe/js/src/app/netlist-3d/transform.js');
		const parsed = parseTransform('387,200,300,90,0,45.5,10,20,0');
		assert.deepEqual(parsed, { sX: 387, sY: 200, sZ: 300, rZ: 90, rX: 0, rY: 45.5, oX: 10, oY: 20, oZ: 0 });
		assert.equal(composeTransform(parsed), '387,200,300,90,0,45.5,10,20,0');
		assert.deepEqual(parseTransform(''), { sX: 0, sY: 0, sZ: 0, rZ: 0, rX: 0, rY: 0, oX: 0, oY: 0, oZ: 0 });
	});

	it('单位换算：mm 显示要乘 0.0254，回写要除回去；角度不换算', async () => {
		const { toDisplay, toRaw } = await import('../iframe/js/src/app/netlist-3d/transform.js');
		assert.equal(toDisplay(1000, 'mm', false), 25.4);
		assert.equal(toDisplay(1000, 'mil', false), 1000);
		assert.equal(toDisplay(90, 'mm', true), 90, '角度不做单位换算');
		assert.ok(Math.abs(toRaw(25.4, 'mm', false) - 1000) < 1e-6);
		assert.equal(toRaw(90, 'mm', true), 90);
		assert.equal(toRaw('abc', 'mil', false), 0, '非数字按 0');
	});

	it('applyInput 写字段、重建 Transform、标记已修改', async () => {
		const { applyInput } = await import('../iframe/js/src/app/netlist-3d/transform.js');
		const item = { sX: 0, sY: 0, sZ: 0, rZ: 0, rX: 0, rY: 0, oX: 0, oY: 0, oZ: 0, status: '待更新' };
		applyInput(item, 'rZ', '90', 'mm');
		assert.equal(item.rZ, 90);
		assert.equal(item.rawTransform, '0,0,0,90,0,0,0,0,0');
		assert.equal(item.status, '已修改');
	});

	it('状态样式覆盖「跳过 / 校验失败」，不再落到默认灰', async () => {
		const { STATUS_CLASS } = await import('../iframe/js/src/app/netlist-3d/transform.js');
		assert.equal(STATUS_CLASS['跳过'], 'status-ready');
		assert.equal(STATUS_CLASS['校验失败'], 'status-error');
		assert.equal(STATUS_CLASS['成功'], 'status-success');
	});

	it('写回校验只比 UUID 前缀（忽略 | 之后的内容）', async () => {
		const { isModelMatch } = await import('../iframe/js/src/app/netlist-3d/transform.js');
		const item = { rawModel: 'uuid1|extra', modelTitle: 'RES', rawTransform: '1,2,3,4,5,6,7,8,9' };
		const ok = {
			otherProperty: { '3D Model': 'uuid1', '3D Model Title': 'RES', '3D Model Transform': '1,2,3,4,5,6,7,8,9' },
		};
		assert.equal(isModelMatch(item, ok), true);
		assert.equal(isModelMatch(item, { otherProperty: { ...ok.otherProperty, '3D Model Title': 'OTHER' } }), false);
		assert.equal(isModelMatch(item, null), false);
	});
});

describe('app/in-ad-netlist', () => {
	const adText = ['( GND', 'U1-3', 'R1-2', ')', '( VCC', 'U1-1', ')'].join('\n');

	it('AD 网表解析：按括号分段，位号|引脚 → 网络', async () => {
		const { parseADNetlist } = await import('../iframe/js/src/app/in-ad-netlist/adParser.js');
		const { netMap, errors } = parseADNetlist(adText);
		assert.equal(netMap.get('U1|3'), 'GND');
		assert.equal(netMap.get('R1|2'), 'GND');
		assert.equal(netMap.get('U1|1'), 'VCC');
		assert.deepEqual(errors, []);
	});

	it('异常输入给出可读错误', async () => {
		const { parseADNetlist } = await import('../iframe/js/src/app/in-ad-netlist/adParser.js');
		assert.deepEqual(parseADNetlist('').errors, ['网表内容为空']);
		assert.deepEqual(parseADNetlist('没有括号').errors, ['未检测到有效的AD网表']);
		const bad = parseADNetlist('( GND\nU1_3\n)');
		assert.equal(bad.netMap.size, 0);
		assert.match(bad.errors[0], /行格式异常/);
	});

	it('同一引脚多次出现以最后一次为准', async () => {
		const { parseADNetlist } = await import('../iframe/js/src/app/in-ad-netlist/adParser.js');
		const { netMap } = parseADNetlist('( OLD\nU1-1\n)\n( NEW\nU1-1\n)');
		assert.equal(netMap.get('U1|1'), 'NEW');
	});

	it('对比行：位号自然序、缺元件/缺引脚给警告、真差异才标 isDiff', async () => {
		const { buildCompareRows } = await import('../iframe/js/src/app/in-ad-netlist/compare.js');
		const netMap = new Map([
			['U10|1', 'GND'],
			['U2|1', 'VCC'],
			['R1|2', 'GND'],
			['U2|9', 'GND'],
		]);
		const container = {
			A: { props: { Designator: 'U2' }, pinInfoMap: { 1: { net: 'Net1' } } },
			B: { props: { Designator: 'U10' }, pins: { 1: 'GND' } },
		};
		const rows = buildCompareRows(netMap, container);
		assert.deepEqual(
			rows.map((r) => `${r.refDes}|${r.pinNo}`),
			['R1|2', 'U2|1', 'U2|9', 'U10|1']
		);
		assert.equal(rows[0].warning, true, 'R1 不存在');
		assert.equal(rows[0].oldNet, '⚠️ 未找到元件');
		assert.equal(rows[1].isDiff, true, 'U2.1 由 Net1 变 VCC');
		assert.equal(rows[2].warning, true, 'U2.9 引脚未定义');
		assert.equal(rows[3].isDiff, false, 'U10.1 网络未变');
	});

	it('写回在深拷贝上做，原网表不被修改；缺引脚时按原结构补', async () => {
		const { applyToCopy } = await import('../iframe/js/src/app/in-ad-netlist/compare.js');
		const original = { components: { A: { props: { Designator: 'U1' }, pinInfoMap: { 1: { net: 'OLD' } } } } };
		const netMap = new Map([
			['U1|1', 'NEW'],
			['U1|2', 'GND'],
			['U9|1', 'VCC'],
		]);
		const { updatedObj, updateCount, skippedCount } = applyToCopy(original, netMap);
		assert.equal(updateCount, 2);
		assert.equal(skippedCount, 1);
		assert.equal(updatedObj.components.A.pinInfoMap[1].net, 'NEW');
		assert.deepEqual(updatedObj.components.A.pinInfoMap[2], { name: '', number: '2', net: 'GND' });
		assert.equal(original.components.A.pinInfoMap[1].net, 'OLD', '原对象必须保持不动');
		assert.equal(original.components.A.pinInfoMap[2], undefined);
	});
});

describe('app/pin-sorting/sortKey', () => {
	it('朝向归一化：0/180 → 180，90/270 → 270', async () => {
		const { normalizeRotation } = await import('../iframe/js/src/app/pin-sorting/sortKey.js');
		assert.equal(normalizeRotation(0), 180);
		assert.equal(normalizeRotation(180), 180);
		assert.equal(normalizeRotation(90), 270);
		assert.equal(normalizeRotation(270), 270);
		assert.equal(normalizeRotation(-90), 270, '负数要先归到 [0,360)');
		assert.equal(normalizeRotation(360), 180);
		assert.equal(normalizeRotation('abc'), 180);
	});

	it('末尾排序键：拆分排序按段颠倒，否则逐字符颠倒', async () => {
		const { createTransformKey } = await import('../iframe/js/src/app/pin-sorting/sortKey.js');
		const split = createTransformKey(true);
		assert.equal(split('DQ10'), '10DQ', '拆分排序：DQ10 的键必须让 DQ6 排在它前面');
		assert.equal(split('DQ6'), '6DQ');
		const chars = createTransformKey(false);
		assert.equal(chars('UDQS'), 'SQDU');
	});

	it('比较器：末尾排序把 DQ6 排在 DQ10 之前', async () => {
		const { createComparator } = await import('../iframe/js/src/app/pin-sorting/sortKey.js');
		const cmp = createComparator({ prop: 'name', endSort: true, splitSort: true, order: 'asc' });
		const names = ['DQ10', 'DQ6'].sort((a, b) => cmp({ name: a }, { name: b }));
		assert.deepEqual(names, ['DQ6', 'DQ10']);
	});

	it('布局：横向朝向（180）竖排、纵向朝向（270）横排', async () => {
		const { planLayout } = await import('../iframe/js/src/app/pin-sorting/sortKey.js');
		const pins = [{ name: 'A', number: '1', x: 100, y: 50, rotation: 180 }];
		const vertical = planLayout(pins, { prop: 'name', spacing: 10, endSort: false, splitSort: true, order: 'asc' });
		assert.equal(vertical.baseRotation, 180);
		assert.equal(vertical.vertical, true);
		assert.deepEqual(vertical.targets[0], { x: 100, y: 50, rotation: 180 });

		const pins2 = [
			{ name: 'A', number: '1', x: 100, y: 50, rotation: 90 },
			{ name: 'B', number: '2', x: 100, y: 30, rotation: 90 },
		];
		const horizontal = planLayout(pins2, { prop: 'name', spacing: 10, endSort: false, splitSort: true, order: 'asc' });
		assert.equal(horizontal.baseRotation, 270);
		assert.equal(horizontal.vertical, false);
		assert.deepEqual(horizontal.targets[0], { x: 100, y: 50, rotation: 270 });
		assert.deepEqual(horizontal.targets[1], { x: 110, y: 50, rotation: 270 }, '横排：Y 固定、X 递增');
	});

	it('布局：竖排按 Y 递减，从最上方开始', async () => {
		const { planLayout } = await import('../iframe/js/src/app/pin-sorting/sortKey.js');
		const pins = [
			{ name: 'B', number: '2', x: 100, y: 30, rotation: 180 },
			{ name: 'A', number: '1', x: 100, y: 50, rotation: 180 },
		];
		const plan = planLayout(pins, { prop: 'name', spacing: 10, endSort: false, splitSort: true, order: 'asc' });
		assert.deepEqual(
			plan.sorted.map((p) => p.name),
			['A', 'B']
		);
		assert.deepEqual(plan.targets[0], { x: 100, y: 50, rotation: 180 });
		assert.deepEqual(plan.targets[1], { x: 100, y: 40, rotation: 180 });
	});
});

describe('app/eda-bridge/protocol', () => {
	it('地址解析兼容三种写法', async () => {
		const { parseAddr } = await import('../iframe/js/src/app/eda-bridge/protocol.js');
		assert.deepEqual(parseAddr('127.0.0.1:8233'), { host: '127.0.0.1', port: '8233' });
		assert.deepEqual(parseAddr('http://127.0.0.1:9000'), { host: '127.0.0.1', port: '9000' });
		assert.deepEqual(parseAddr('127.0.0.1'), { host: '127.0.0.1', port: '8233' });
		assert.deepEqual(parseAddr(''), { host: '127.0.0.1', port: '8233' });
		assert.deepEqual(parseAddr('host:abc'), { host: 'host', port: '8233' }, '非法端口回退');
	});

	it('safeJson 处理函数 / 循环引用 / Promise / 深度', async () => {
		const { safeJson } = await import('../iframe/js/src/app/eda-bridge/protocol.js');
		assert.equal(safeJson(undefined), null);
		assert.equal(safeJson(() => 1), '[Function anonymous]', '匿名函数降级成占位串');
		assert.equal(safeJson(Promise.resolve(1)), '[Promise]');
		assert.equal(safeJson(10n), '10');

		const cyclic = { a: 1 };
		cyclic.self = cyclic;
		const out = safeJson(cyclic);
		assert.equal(out.a, 1);
		assert.ok(out.self, '循环引用必须被深度上限截断而不是栈溢出');

		const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
		assert.equal(JSON.stringify(safeJson(deep)).includes('MaxDepth'), true);
	});

	it('safeJson 限制数组长度', async () => {
		const { safeJson, SAFE_JSON_LIMITS } = await import('../iframe/js/src/app/eda-bridge/protocol.js');
		const arr = Array.from({ length: SAFE_JSON_LIMITS.maxArray + 50 }, (_, i) => i);
		assert.equal(safeJson(arr).length, SAFE_JSON_LIMITS.maxArray);
	});
});

describe('app/import-image/{pixel,layout}', () => {
	it('像素↔物理尺寸↔DPI 可往返', async () => {
		const { sizeFromDpi, dpiFromSize, toMilSize } = await import('../iframe/js/src/app/import-image/pixel.js');
		const size = sizeFromDpi(1200, 600, 300, 'mm');
		assert.equal(Math.round(size.width), 102, '1200px / 300dpi = 4 inch = 101.6mm');
		assert.equal(Math.round(size.height), 51);
		assert.equal(dpiFromSize(1200, 600, size.width, size.height, 'mm'), 300);
		const mil = toMilSize(25.4, 25.4, 'mm');
		assert.ok(Math.abs(mil.width - 1000) < 0.01, '25.4mm = 1000mil');
		assert.deepEqual(toMilSize('abc', 10, 'mil'), { width: 0, height: 10 });
	});

	it('文件名解析：T/B/L 构成双列版式，行优先排列', async () => {
		const { parseFileNameOrder } = await import('../iframe/js/src/app/import-image/layout.js');
		const files = ['T2.png', 'T1.png', 'B1.png', 'L1.png', 'L2.png'].map((name) => ({ name }));
		const { ordered, layoutMap, useSpecial } = parseFileNameOrder(files);
		assert.equal(useSpecial, true);
		assert.deepEqual(
			ordered.map((f) => f.name),
			['T2.png', 'B1.png', 'T1.png', 'L2.png', 'L1.png'],
			'T/B 降序、按行优先交叉排列；L 左列升序、右列降序'
		);
		assert.deepEqual(layoutMap.get(0), { col: 'left', row: 0 });
		assert.deepEqual(layoutMap.get(1), { col: 'right', row: 0 });
	});

	it('文件名不匹配时退回原顺序与普通网格', async () => {
		const { parseFileNameOrder, computeOrigins } = await import('../iframe/js/src/app/import-image/layout.js');
		const files = [{ name: 'a.png' }, { name: 'b.png' }];
		const parsed = parseFileNameOrder(files);
		assert.equal(parsed.useSpecial, false);
		assert.equal(parsed.layoutMap, null);
		assert.deepEqual(parsed.ordered, files);
	});

	it('L 数量为奇数时不启用特殊布局', async () => {
		const { parseFileNameOrder } = await import('../iframe/js/src/app/import-image/layout.js');
		const files = ['T1.png', 'B1.png', 'L1.png'].map((name) => ({ name }));
		assert.equal(parseFileNameOrder(files).useSpecial, false, 'L 必须为 0 或偶数');
	});

	it('原点计算：特殊布局按行列，普通布局按正方形网格', async () => {
		const { computeOrigins } = await import('../iframe/js/src/app/import-image/layout.js');
		const special = computeOrigins({
			totalImages: 2,
			imgWidth: 100,
			imgHeight: 50,
			originX: 10,
			originY: 20,
			layoutMap: new Map([
				[0, { col: 'left', row: 0 }],
				[1, { col: 'right', row: 1 }],
			]),
			useSpecial: true,
		});
		assert.deepEqual(special[0], { x: 10, y: 20 });
		assert.deepEqual(special[1], { x: 110, y: -30 }, '右列偏移一个图宽，行号越大 Y 越小');

		const grid = computeOrigins({ totalImages: 4, imgWidth: 100, imgHeight: 50, originX: 0, originY: 0, layoutMap: null, useSpecial: false });
		assert.deepEqual(grid, [
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 0, y: -100 },
			{ x: 100, y: -100 },
		], '网格间距取长边');
	});
});

describe('app/api-test/{calibration,sourceProbe}', () => {
	it('校准表达式：四则运算与非法输入', async () => {
		const { applyCal, applyCalStr } = await import('../iframe/js/src/app/api-test/calibration.js');
		assert.equal(applyCal('100', '*2'), 200);
		assert.equal(applyCal('100', '/4'), 25);
		assert.equal(applyCal('100', '+5'), 105);
		assert.equal(applyCal('100', '-5'), 95);
		assert.equal(applyCal('abc', '*2'), 'abc', '非数字原样返回');
		assert.equal(applyCal('100', ''), '100', '无校准值原样返回');
		assert.equal(applyCalStr('10,20', '*2'), '20,40');
		assert.equal(applyCalStr(5, '*2'), 10);
	});

	it('比对容差 0.05，坐标逐分量比较', async () => {
		const { compare } = await import('../iframe/js/src/app/api-test/calibration.js');
		assert.equal(compare('10,20', '10.01,19.99'), true);
		assert.equal(compare('10,20', '10.1,20'), false);
		assert.equal(compare(100, 100.04), true);
		assert.equal(compare(100, 100.06), false);
		assert.equal(compare('1,2', '1,2,3'), false);
	});

	it('倍率互转：*x / /x / 纯数字 / 越界', async () => {
		const { ratioToCalInput, calToMultiplier, MULTIPLIER_MAX, MULTIPLIER_MIN } = await import('../iframe/js/src/app/api-test/calibration.js');
		assert.equal(ratioToCalInput(1.0005), '', '接近 1 留空');
		assert.equal(ratioToCalInput(2), '*2');
		assert.equal(ratioToCalInput(0.5), '/2');
		assert.equal(calToMultiplier(''), 1);
		assert.equal(calToMultiplier('*2'), 2);
		assert.equal(calToMultiplier('/4'), 0.25);
		assert.equal(calToMultiplier('0.5'), 0.5, '用户没写符号的纯数字按乘数');
		assert.equal(calToMultiplier('+5'), 1, '加减法无法表达成乘数');
		assert.equal(Number.isNaN(calToMultiplier(String(MULTIPLIER_MAX * 10))), true);
		assert.equal(Number.isNaN(calToMultiplier(String(MULTIPLIER_MIN / 10))), true);
	});

	it('源码归一：V2 下标表与 V3 字段表都要对上', async () => {
		const { normalizeFromSource } = await import('../iframe/js/src/app/api-test/sourceProbe.js');
		const v2Via = ['VIA', 'e1', 0, '', '', 105, 110, 12, 24, 0, 10, 5, 0, []];
		assert.deepEqual(normalizeFromSource('Via', v2Via, null), ['105,110', 12, 24, '10']);

		const v3Via = { centerX: 1, centerY: 2, holeDiameter: 3, viaDiameter: 4, topSolderExpansion: null };
		assert.deepEqual(normalizeFromSource('Via', null, v3Via), ['1,2', 3, 4, 'null']);

		const v2Line = ['LINE', 'e3', 0, '', 1, 57, 75, 87, 75, 10, 0];
		assert.deepEqual(normalizeFromSource('Line', v2Line, null), ['57,75', 10]);
		assert.deepEqual(normalizeFromSource('Line', null, { startX: 5, startY: 6, width: 7 }), ['5,6', 7]);
		assert.deepEqual(normalizeFromSource('Unknown', [], null), []);
	});

	it('API 取值：阻焊扩展的三种形状', async () => {
		const { extractFromApi } = await import('../iframe/js/src/app/api-test/sourceProbe.js');
		const base = { x: 1, y: 2, holeDiameter: 3, diameter: 4 };
		assert.equal(extractFromApi('Via', { ...base, solderMaskExpansion: null })[3], 'null');
		assert.equal(extractFromApi('Via', { ...base, solderMaskExpansion: { topSolderMask: 0.2 } })[3], '0.2');
		assert.equal(extractFromApi('Via', { ...base, solderMaskExpansion: undefined })[3], '0');
		assert.equal(extractFromApi('Via', { ...base, solderMaskExpansion: 2 })[3], '2');
	});
});

describe('app/{import-qrcode/create-footprint}', () => {
	it('bwip-js 选项：纠错级别与「包含文本」按码型开关', async () => {
		const { buildOptions, computeDpi } = await import('../iframe/js/src/app/import-qrcode/barcode.js');
		const base = { bcid: 'qrcode', text: 'A1', scale: 4, padding: 2, outputType: 'image', inverted: false, fore: '#112233', back: '#ffffff', eclevel: 'H', includeText: true };
		const qr = buildOptions(base);
		assert.equal(qr.eclevel, 'H');
		assert.equal(qr.includetext, undefined, '二维码不提供「包含文本」');
		assert.equal(qr.barcolor, '112233', '颜色要去掉 #');

		const code128 = buildOptions({ ...base, bcid: 'code128', outputType: 'vector', inverted: true });
		assert.equal(code128.eclevel, undefined, '一维码没有纠错级别');
		assert.equal(code128.includetext, true);
		assert.equal(code128.barcolor, 'ffffff', '矢量 + 反转要反色');

		assert.equal(computeDpi(1000, 25.4, 'mm'), 1000);
		assert.equal(computeDpi(1000, 1000, 'mil'), 1000);
		assert.equal(computeDpi(1000, 0, 'mm'), 0);
	});

	it('路径平移：L / ARC 命令段的坐标都要移位', async () => {
		const { transformPath } = await import('../iframe/js/src/app/create-footprint/sourceBuilder.js');
		assert.deepEqual(transformPath(['R', 10, 20, 5], 5, 10), ['R', 5, 10, 5]);
		assert.deepEqual(transformPath([10, 20, 'L', 30, 40], 10, 20), [0, 0, 'L', 20, 20]);
		// ARC 段：终点 (i+2, i+3) 与后续裸坐标都要平移，圆心在 i+4/i+5 同样会被减
		assert.deepEqual(transformPath([0, 0, 'ARC', 0, 0, 5, 6], 1, 1), [-1, -1, 'ARC', 0, -1, 4, 5]);
	});

	it('封装源码：id 从 e1 起重新编号，坐标按原点偏移', async () => {
		const { buildFootprintSource } = await import('../iframe/js/src/app/create-footprint/sourceBuilder.js');
		const primitives = [
			['PAD', 'old1', 0, '', 12, '1', 100, 200, 0, ['ROUND', 10, 10], ['ELLIPSE', 20, 20]],
			['LINE', 'old2', 0, '', 1, 110, 200, 130, 200, 5],
		];
		const source = buildFootprintSource(primitives, { uuid: 'fp-1', deviceName: 'TEST', originX: 100, originY: 200 });
		const lines = source.trim().split('\n');
		const pad = JSON.parse(lines.find((l) => l.startsWith('["PAD"')));
		assert.equal(pad[1], 'e1');
		assert.equal(pad[6], 0);
		assert.equal(pad[7], 0);
		assert.equal(primitives[0][1], 'old1', '不能改入参');
		assert.ok(source.includes('"uuid":"fp-1"'));
		assert.ok(source.includes('"title":"TEST"'));
	});
});
