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
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
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

describe('app/replace-component/pastePlan', () => {
	it('解析剪贴板：Tab / 空格 / 逗号位号 / 空行', async () => {
		const { parseClipboard } = await import('../iframe/js/src/app/replace-component/pastePlan.js');
		const text = ['C106\tC100042', '', 'R5   R6    C200001', 'D1,D2\tC300001', '单列无编号'].join('\n');
		const map = parseClipboard(text);
		assert.equal(map.get('C106'), 'C100042');
		assert.equal(map.get('R5'), 'C200001');
		assert.equal(map.get('R6'), 'C200001', '多个空格分隔的位号共享同一编号');
		assert.equal(map.get('D1'), 'C300001');
		assert.equal(map.get('D2'), 'C300001');
		assert.equal(map.size, 5, '只有一行的记录必须被忽略');
	});

	it('编号变化时自动勾选并清空旧缓存；编号未变则不动', async () => {
		const { applyTargetSupplierIds } = await import('../iframe/js/src/app/replace-component/pastePlan.js');
		const items = [
			{ designator: 'C1', target: { supplierId: 'C100', name: '旧名', footprint: '0805', uuid: 'u1' }, selected: false },
			{ designator: 'C2', target: { supplierId: 'C200' }, selected: false },
		];
		const count = applyTargetSupplierIds(items, new Map([['C1', 'C999'], ['C2', 'C200']]));
		assert.equal(count, 1, '只有 C1 真的变了');
		assert.equal(items[0].selected, true);
		assert.equal(items[0].target.name, null, '缓存名称必须清空，否则会拿旧属性替换');
		assert.equal(items[0].target.uuid, null);
		assert.equal(items[1].selected, false);
	});

	it('展平→打标→重分组：目标编号不同的必须拆行', async () => {
		const { flattenGroups, applyTargetSupplierIds, regroupGroups } = await import(
			'../iframe/js/src/app/replace-component/pastePlan.js'
		);
		const groups = [
			{
				designators: ['C1', 'C10', 'C2'],
				primitiveId: ['p1', 'p2', 'p3'],
				original: { name: '100nF', footprint: '0603', supplierId: 'C100' },
				target: { name: null, footprint: null, supplierId: null },
				options: { preserveName: true, preserveFootprint: true, preserve3D: true },
				selected: false,
				ComponentsSource: ['s1', 's2', 's3'],
			},
		];
		const items = flattenGroups(groups);
		assert.equal(items.length, 3);
		applyTargetSupplierIds(items, new Map([['C1', 'C900'], ['C2', 'C900'], ['C10', 'C800']]));
		const regrouped = regroupGroups(items);
		assert.equal(regrouped.length, 2, 'C10 目标不同 → 必须拆成独立一行');
		const byTarget = regrouped.map((g) => g.target.supplierId).sort();
		assert.deepEqual(byTarget, ['C800', 'C900']);
		const c900 = regrouped.find((g) => g.target.supplierId === 'C900');
		assert.deepEqual(c900.designators, ['C1', 'C2'], '位号要按自然序排好');
		assert.deepEqual(c900.primitiveId, ['p1', 'p3']);
	});
});

describe('app/replace-component/sourceRewrite', () => {
	const action = () => ({
		preserveName: false,
		preserveFootprint: false,
		preserve3D: true,
		targetDeviceUuid: 'dev-new',
		targetDeviceNameJson: '{"name":"R","source":"sys","uuid":"dev-new"}',
		targetName: 'NEW-NAME',
		targetFootprintUuid: 'fp-new',
	});

	it('V2 数组格式：Device 必改，Name/Footprint 按「保留」开关', async () => {
		const { rewriteLine } = await import('../iframe/js/src/app/replace-component/sourceRewrite.js');
		const map = new Map([['e5', action()]]);

		const dev = JSON.stringify(['ATTR', 'a1', 0, 'e5', '', '', '', 'Device', 'dev-old', 0]);
		assert.equal(JSON.parse(rewriteLine(dev, map))[8], 'dev-new');

		const name = JSON.stringify(['ATTR', 'a2', 0, 'e5', '', '', '', 'Name', 'OLD', 0]);
		assert.equal(JSON.parse(rewriteLine(name, map))[8], 'NEW-NAME');

		const keep = new Map([['e5', { ...action(), preserveName: true, preserveFootprint: true }]]);
		assert.equal(rewriteLine(name, keep), name, '勾了保留就必须原样返回');
		assert.equal(rewriteLine(JSON.stringify(['ATTR', 'a3', 0, 'e5', '', '', '', 'Value', '1k', 0]), map).includes('1k'), true);

		const other = JSON.stringify(['ATTR', 'a4', 0, 'e9', '', '', '', 'Device', 'x', 0]);
		assert.equal(rewriteLine(other, map), other, '非目标图元不动');
	});

	it('V3/V4 日志格式：COMPONENT 的 attrs.DeviceName 与 ATTR 的 value 都要改，行尾 | 保持原样', async () => {
		const { rewriteLine } = await import('../iframe/js/src/app/replace-component/sourceRewrite.js');
		const map = new Map([['e5', action()]]);

		const comp = '{"type":"COMPONENT","id":"e5"}||{"attrs":{"DeviceName":"old"},"x":1}|';
		const compOut = rewriteLine(comp, map);
		assert.equal(compOut.endsWith('|'), true, '行尾 | 必须保留');
		assert.equal(JSON.parse(compOut.slice(0, -1).split('||')[1]).attrs.DeviceName, action().targetDeviceNameJson);

		// 有些行没有行尾 |（EDA 写盘残留），改写后也不能凭空加上
		const noPipe = '{"type":"ATTR","id":"a1"}||{"parentId":"e5","key":"Device","value":"old"}';
		const noPipeOut = rewriteLine(noPipe, map);
		assert.equal(noPipeOut.endsWith('|'), false, '原本没有行尾 | 就不能加');
		assert.equal(JSON.parse(noPipeOut.split('||')[1]).value, 'dev-new');

		// V2/V3 器件：没有 DeviceNameJson 时 COMPONENT 行不动
		const legacy = new Map([['e5', { ...action(), targetDeviceNameJson: null }]]);
		assert.equal(rewriteLine(comp, legacy), comp);
	});

	it('整份改写：只动命中行，其余行逐字节不变', async () => {
		const { rewriteSource } = await import('../iframe/js/src/app/replace-component/sourceRewrite.js');
		const map = new Map([['e5', action()]]);
		const src = [
			'["DOCTYPE","PCB","1.0"]',
			'',
			'{"type":"ATTR","id":"a1"}||{"parentId":"e5","key":"Device","value":"old"}|',
			'[]',
			'{"type":"ATTR","id":"a2"}||{"parentId":"e9","key":"Device","value":"keep"}|',
		].join('\n');
		const out = rewriteSource(src, map).split('\n');
		assert.equal(out.length, 5, '行数不变');
		assert.equal(out[0], '["DOCTYPE","PCB","1.0"]');
		assert.equal(out[1], '');
		assert.equal(out[3], '[]');
		assert.equal(out[4].includes('keep'), true);
		assert.equal(out[2].includes('dev-new'), true);
	});
});

describe('app/replace-component/{componentReader,netlistSync}', () => {
	it('器件 uuid 三版本：V2 字符串 / V4 对象 / 为空', async () => {
		const { getDeviceUuid, getDeviceNameJson } = await import('../iframe/js/src/app/replace-component/componentReader.js');
		assert.equal(getDeviceUuid({ component: { uuid: 'u-1' } }), 'u-1');
		assert.equal(getDeviceUuid({ component: { uuid: { name: 'R', source: 'sys', uuid: 'u-2' } } }), 'u-2');
		assert.equal(getDeviceUuid({}), '');
		assert.equal(getDeviceNameJson({ component: { uuid: 'u-1' } }), null, 'V2 不需要改 COMPONENT 行');
		assert.equal(
			getDeviceNameJson({ component: { uuid: { name: 'R', source: 'sys', uuid: 'u-2' } } }),
			'{"name":"R","source":"sys","uuid":"u-2"}'
		);
	});

	it('器件名读取：V4 无 Device 属性时从 component.uuid.name 取', async () => {
		const { extractProps } = await import('../iframe/js/src/app/replace-component/componentReader.js');
		const v4 = { name: '={Value}', otherProperty: { Value: '4.7K' }, component: { uuid: { name: 'RK73' } }, supplierId: 'C1' };
		assert.equal(extractProps(v4).name, '4.7K');

		const v2 = { name: 'CAP-10uF', otherProperty: { Footprint: '0805' }, supplierId: 'C2' };
		assert.deepEqual(extractProps(v2), { name: 'CAP-10uF', footprint: '0805', supplierId: 'C2' });

		const missing = { name: '={DoesNotExist}', otherProperty: {}, manufacturerId: 'M-1' };
		assert.equal(extractProps(missing).name, 'M-1', '模板取不到值时回退器件名');
	});

	it('网表合并：受保护字段不覆盖，名称按保留开关', async () => {
		const { applyTargetProps } = await import('../iframe/js/src/app/replace-component/netlistSync.js');
		const container = {
			a: {
				props: {
					Designator: 'C1',
					Name: '旧',
					FootprintName: '0603',
					DeviceName: 'OLD',
					'Unique ID': 'keep-me',
					'3D Model': 'keep-3d',
					Value: '1uF',
				},
			},
			meta: { version: '2.0.0' },
		};
		const desigMap = new Map([
			[
				'C1',
				{
					preserveName: false,
					preserveFootprint: false,
					sourceName: '旧名',
					targetName: '新名',
					sourceFootprintName: '0603',
					targetComp: {
						otherProperty: { Value: '10uF', '3D Model': 'new', Designator: 'X' },
						footprint: { name: '0805' },
						supplier: 'LCSC',
						supplierId: 'C999',
						manufacturer: 'Yageo',
						manufacturerId: 'RC0805',
					},
				},
			],
		]);
		assert.equal(applyTargetProps(container, desigMap), 1, '没有 props 的元数据项要跳过');
		const p = container.a.props;
		assert.equal(p.Value, '10uF');
		assert.equal(p['3D Model'], 'keep-3d', '3D 模型由专门步骤处理');
		assert.equal(p['Unique ID'], 'keep-me');
		assert.equal(p.Designator, 'C1', '位号绝不能被目标器件覆盖');
		assert.equal(p.Name, '新名');
		assert.equal(p.FootprintName, '0805');
		assert.equal(p.DeviceName, 'RC0805');
		assert.equal(p['Supplier Part'], 'C999');
		assert.equal(p.Manufacturer, 'Yageo');
	});
});

describe('core/concurrency', () => {
	it('分片并发：结果保序、片内不超过并发上限', async () => {
		const { mapInChunks } = await import('../iframe/js/src/core/concurrency.js');
		let inFlight = 0;
		let peak = 0;
		const items = Array.from({ length: 23 }, (_, i) => i);
		const out = await mapInChunks(
			items,
			5,
			async (n) => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((r) => setTimeout(r, 1));
				inFlight -= 1;
				return n * 2;
			},
			{ yieldMs: 0 }
		);
		assert.deepEqual(out.slice(0, 3), [0, 2, 4]);
		assert.equal(out[22], 44, '结果必须与入参同序');
		assert.ok(peak <= 5, `并发上限被突破：${peak}`);
	});

	it('进度回调覆盖到每一项；mapper 抛错会中断整批', async () => {
		const { mapInChunks } = await import('../iframe/js/src/core/concurrency.js');
		const seen = [];
		await mapInChunks([1, 2, 3], 2, async (n) => n, { yieldMs: 0, onProgress: (done, total) => seen.push(`${done}/${total}`) });
		assert.deepEqual(seen, ['1/3', '2/3', '3/3']);

		await assert.rejects(
			mapInChunks([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error('boom');
				return n;
			}, { yieldMs: 0 })
		);
	});
});

describe('app/pcb-to-sch/model', () => {
	it('findUuids：从当前页 uuid 找到原理图与 PCB', async () => {
		const { findUuids } = await import('../iframe/js/src/app/pcb-to-sch/model.js');
		const project = {
			schematics: { s1: { sheets: [{ uuid: 'sheet-a' }] }, s2: { sheets: [{ uuid: 'sheet-b' }] } },
			boards: { board1: { schematic: 's2', pcb: 'pcb-2' } },
		};
		assert.deepEqual(findUuids(project, 'sheet-b'), { schematicUuid: 's2', pcbUuid: 'pcb-2' });
		assert.throws(() => findUuids(project, 'nope'), /未找到对应原理图UUID/);
		assert.throws(() => findUuids({ schematics: { s1: { sheets: [{ uuid: 'x' }] } }, boards: {} }, 'x'), /未找到对应PCB UUID/);
	});

	it('parsePcbContent：COMPONENT / ATTR / PAD_NET 三类行', async () => {
		const { parsePcbContent } = await import('../iframe/js/src/app/pcb-to-sch/model.js');
		const pcb = [
			'["DOCTYPE","PCB","1.0"]',
			'["COMPONENT","c1","R",1,100,200,90,{"Unique ID":"u1","Supplier Part":"C123"}]',
			'["ATTR","a1",0,"c1","","","","Designator","R1",0]',
			'["ATTR","a2",0,"c1","","","","Name","10K",0]',
			'["ATTR","a3",0,"c1","","","","Device","dev1",0]',
			'["ATTR","a4",0,"c1","","","","Footprint","fp1",0]',
			'["PAD_NET","c1","1","VCC"]',
			'["PAD_NET","c1","2",""]',
			'不是 JSON 的行',
		].join('\n');
		const comps = parsePcbContent(pcb);
		assert.equal(comps.length, 1);
		assert.equal(comps[0].designator, 'R1');
		assert.equal(comps[0].name, '10K');
		assert.equal(comps[0].deviceUuid, 'dev1');
		assert.equal(comps[0].footprintUuid, 'fp1');
		assert.equal(comps[0].uniqueId, 'u1');
		assert.equal(comps[0].supplierPart, 'C123');
		assert.equal(comps[0].layer, 1);
		assert.deepEqual(comps[0].pins, { 1: 'VCC', 2: '' }, '空网络名也要保留（表示未连接）');
	});

	it('enrichWithSymbol + mergeComponentsForDisplay', async () => {
		const { enrichWithSymbol, mergeComponentsForDisplay } = await import('../iframe/js/src/app/pcb-to-sch/model.js');
		const project = {
			devices: { dev1: { title: '电阻', attributes: { Symbol: 'sym1' } } },
			symbols: { sym1: { title: 'R' } },
			footprints: { fp1: { title: '0603' } },
		};
		const comps = [
			{ designator: 'R1', name: '10K', deviceUuid: 'dev1', footprintUuid: 'fp1', symbolUuid: '', symbolName: '', deviceName: '', footprintName: '', supplierPart: 'C1' },
			{ designator: 'R2', name: '10K', deviceUuid: 'dev1', footprintUuid: 'fp1', symbolUuid: '', symbolName: '', deviceName: '', footprintName: '', supplierPart: '' },
			{ designator: 'U1', name: '', deviceUuid: 'missing', footprintUuid: 'missing' },
		];
		enrichWithSymbol(comps, project);
		assert.equal(comps[0].symbolUuid, 'sym1');
		assert.equal(comps[0].symbolName, 'R');
		assert.equal(comps[0].footprintName, '0603');
		assert.equal(comps[2].symbolUuid, '', '找不到器件时三个字段都要清空');
		assert.equal(comps[2].footprintName, '');

		const rows = mergeComponentsForDisplay(comps);
		assert.equal(rows.length, 2, '封装+器件相同的要合并');
		assert.equal(rows[0].footprintName, '', '按封装名排序，空串在前');
		assert.equal(rows[1].designatorDisplay, 'R1,R2');
		assert.deepEqual(rows[1].componentIndices, [0, 1]);
	});

	it('projectTitleOf 去掉重复的 .epro 后缀', async () => {
		const { projectTitleOf } = await import('../iframe/js/src/app/pcb-to-sch/model.js');
		assert.equal(projectTitleOf({ title: '我的板子' }), '我的板子.epro');
		assert.equal(projectTitleOf({ title: 'a.epro' }), 'a.epro');
		assert.equal(projectTitleOf(null), 'project_PCB_TO_SCH.epro');
	});
});

describe('app/pcb-to-sch/symbolParser', () => {
	it('按 PART 切分，NUMBER/NAME 归并到引脚，包围盒外扩 40', async () => {
		const { parseSymbolSource } = await import('../iframe/js/src/app/pcb-to-sch/symbolParser.js');
		const esym = [
			'["DOCTYPE","SYMBOL","1.1"]',
			'["PART","R.1",{"BBOX":[-40,-40,40,40]}]',
			'["PIN","p1",1,null,-40,0,20,0]',
			'["ATTR","n1","p1","NAME","1"]',
			'["ATTR","u1","p1","NUMBER","1"]',
			'["PIN","p2",1,null,40,0,20,180]',
			'["ATTR","n2","p2","NAME","2"]',
			'["ATTR","u2","p2","NUMBER","2"]',
			'["PART","R.2",{}]',
			'["PIN","p3",1,null,0,100,20,90]',
			'["ATTR","u3","p3","NUMBER","3"]',
		].join('\n');
		const parts = parseSymbolSource(esym);
		assert.equal(parts.length, 2);
		assert.equal(parts[0].name, 'R.1');
		assert.deepEqual(parts[0].pins['1'], { x: -40, y: 0, angle: 0, name: '1' });
		assert.deepEqual(parts[0].pinBbox, [-80, -40, 80, 40]);
		assert.equal(parts[1].name, 'R.2');
		assert.deepEqual(parts[1].pinBbox, [-40, 60, 40, 140]);
	});

	it('没有引脚号的行不计入：包围盒退化为默认值', async () => {
		const { parseSymbolSource } = await import('../iframe/js/src/app/pcb-to-sch/symbolParser.js');
		const parts = parseSymbolSource(['["PART","X.1",{}]', '["PIN","p1",1,null,0,0,20,0]'].join('\n'));
		assert.deepEqual(parts[0].pins, {});
		assert.deepEqual(parts[0].pinBbox, [-20, -20, 20, 20]);
	});
});

describe('app/pcb-to-sch/layout', () => {
	const symbolDb = {
		sym: [{ name: 'R.1', pins: {}, pinBbox: [-20, -20, 20, 20] }],
	};

	it('流式布局：首个部件左边界对齐 startX，同行按 40 间隔，超出 2560 换行', async () => {
		const { planFlowLayout } = await import('../iframe/js/src/app/pcb-to-sch/layout.js');
		const items = [1, 2, 3].map((n) => ({ designator: 'R' + n, symbolUuid: 'sym' }));
		const plan = planFlowLayout(items, { startX: 200, startTopY: -200, symbolDb });

		// 第一个：compX = 200 - (-20) = 220，右边界 240
		assert.equal(plan.parts[0].x, 220);
		assert.equal(plan.parts[0].y, -220, 'compY = topY - ymax = -200 - 20');
		// 第二个：compX = 240 + 40 - (-20) = 300
		assert.equal(plan.parts[1].x, 300);
		assert.equal(plan.bounds.minX, 200);
		assert.equal(plan.parts[2].x, 380, 'compX = 320 + 40 + 20');
		assert.equal(plan.bounds.maxX, 400);
		assert.equal(plan.bounds.maxY, -200);
		assert.equal(plan.bounds.minY, -240);
		assert.equal(plan.nextTopY, -440, '下一组顶部 = 本组底部 - 200');
	});

	it('流式布局：换行后回到 startX，顶部下移 40', async () => {
		const { planFlowLayout } = await import('../iframe/js/src/app/pcb-to-sch/layout.js');
		const wide = { designator: 'W1', symbolUuid: 'wide' };
		const db = { wide: [{ name: 'W.1', pins: {}, pinBbox: [-1200, -20, 1200, 20] }] };
		const plan = planFlowLayout([wide, wide], { startX: 200, startTopY: -200, symbolDb: db });
		assert.equal(plan.parts[0].x, 1400, 'compX = 200 - (-1200)');
		// 第一个右边界 1400+1200=2600 > 2560 → 第二个必然换行
		assert.equal(plan.parts[1].x, 1400);
		// 第一个部件本身就超界（right=2600>2560）→ 先换行再放；第二个再换一次
		assert.equal(plan.parts[0].y, -260);
		assert.equal(plan.parts[1].y, -340);
	});

	it('坐标布局：用 PCB 原坐标，不改入参，多部件按 10 偏移', async () => {
		const { planCoordLayout } = await import('../iframe/js/src/app/pcb-to-sch/layout.js');
		const comp = { x: 100, y: 200, symbolUuid: 'sym', partCount: 2 };
		const plan = planCoordLayout([comp]);
		assert.equal(plan.parts.length, 2);
		assert.deepEqual(
			plan.parts.map((p) => ({ x: p.x, y: p.y })),
			[
				{ x: 100, y: 200 },
				{ x: 100, y: 210 },
			]
		);
		assert.equal(comp.y, 200, '绝不能改入参（原 V3 实现会累积漂移）');
	});
});

describe('app/pcb-to-sch/sourceBuilder', () => {
	const symbolDb = {
		sym: [
			{
				name: 'R.1',
				pins: { 1: { x: -40, y: 0, angle: 0, name: '1' }, 2: { x: 40, y: 0, angle: 180, name: '2' } },
				pinBbox: [-80, -40, 80, 40],
			},
		],
	};
	const comps = [
		{ designator: 'R10', name: '10K', deviceUuid: 'd1', symbolUuid: 'sym', uniqueId: 'u1', pins: { 1: 'VCC', 2: '' } },
		{ designator: 'R2', name: '1K', deviceUuid: 'd1', symbolUuid: 'sym', uniqueId: 'u2', pins: {} },
	];

	it('分类：位号前缀分组 + 组内按数字升序（R2 在 R10 前）', async () => {
		const { classifyGroups } = await import('../iframe/js/src/app/pcb-to-sch/sourceBuilder.js');
		const groups = classifyGroups(comps, 'ref');
		assert.equal(groups.length, 1);
		assert.equal(groups[0].name, 'R');
		assert.deepEqual(
			groups[0].items.map((c) => c.designator),
			['R2', 'R10']
		);
		assert.equal(classifyGroups(comps, 'coord')[0].name, '坐标布局');
		assert.equal(classifyGroups([{ designator: '1', deviceName: '' }], 'device')[0].name, '未知器件');
	});

	it('现代格式：COMPONENT 必带 attrs、每器件必有 Channel ID、末行不带 |', async () => {
		const { buildSchSource } = await import('../iframe/js/src/app/pcb-to-sch/sourceBuilder.js');
		const src = buildSchSource({
			components: comps,
			symbolDb,
			format: 'modern',
			options: { classify: 'ref', startX: 200, startY: -200, now: () => 1700000000000 },
		});
		const lines = src.split('\n');
		assert.equal(lines[0].startsWith('{"type":"DOCHEAD"}'), true);
		assert.equal(lines[1].startsWith('{"type":"CANVAS"'), true);
		assert.equal(lines[lines.length - 1].endsWith('|'), false, '末行不能有行尾 |');

		const compLines = lines.filter((l) => l.includes('"type":"COMPONENT"'));
		assert.equal(compLines.length, 2);
		for (const line of compLines) {
			const body = JSON.parse(line.replace(/\|$/, '').split('||')[1]);
			assert.ok(body.attrs, 'V4 缺 attrs 会静默丢器件');
			assert.deepEqual(Object.keys(body.attrs), [
				'Footprints',
				'Devices',
				'DeviceName',
				'FootprintName',
				'pinClass',
				'differentialPairClass',
				'Symbols',
			]);
		}

		const attrs = lines.filter((l) => l.includes('"type":"ATTR"')).map((l) => JSON.parse(l.replace(/\|$/, '').split('||')[1]));
		const channelIds = attrs.filter((a) => a.key === 'Channel ID');
		assert.equal(channelIds.length, 2, '每个器件都要有 Channel ID，否则整份拒写');
		assert.ok(attrs.every((a) => 'zIndex' in a && 'parentId' in a && 'fillColor' in a), 'ATTR 字段必须齐全');
	});

	it('现代格式：开了 genWire 才生成导线，空网络不生成', async () => {
		const { buildSchSource } = await import('../iframe/js/src/app/pcb-to-sch/sourceBuilder.js');
		const withWire = buildSchSource({
			components: [comps[0]],
			symbolDb,
			format: 'modern',
			options: { classify: 'ref', genWire: true, now: () => 1 },
		}).split('\n');
		const wires = withWire.filter((l) => l.includes('"type":"WIRE"'));
		assert.equal(wires.length, 1, '只有引脚 1 有网络，空心脚不连线');
		const netAttr = withWire.filter((l) => l.includes('"key":"NET"'));
		assert.equal(netAttr.length, 1);
		assert.ok(netAttr.every((l) => l.includes('"value":"VCC"')));

		const noWire = buildSchSource({
			components: [comps[0]],
			symbolDb,
			format: 'modern',
			options: { classify: 'ref', now: () => 1 },
		}).split('\n');
		assert.equal(noWire.filter((l) => l.includes('"type":"WIRE"')).length, 0);
	});

	it('V2 格式：头部 6 行、ATTR 的 y 位置分 0/null、Designator 在 Name 之前', async () => {
		const { buildSchSource } = await import('../iframe/js/src/app/pcb-to-sch/sourceBuilder.js');
		const lines = buildSchSource({ components: [comps[0]], symbolDb, format: 'v2', options: { classify: 'ref' } }).split(
			'\n'
		);
		assert.deepEqual(lines.slice(0, 6).map((l) => JSON.parse(l)[0]), [
			'DOCTYPE',
			'HEAD',
			'FONTSTYLE',
			'FONTSTYLE',
			'LINESTYLE',
			'LINESTYLE',
		]);
		const comp = JSON.parse(lines[6]);
		assert.equal(comp[0], 'COMPONENT');
		assert.equal(comp[2], 'R.1');
		// 原理图 V2 的 ATTR 是「短格式」：["ATTR", id, parentId, key, value, x, y, ...]
		// 注意与 PCB 的 ATTR（parentId 在 3、key 在 7）不是同一套下标，别串用
		const keys = lines.slice(7, 12).map((l) => JSON.parse(l)[3]);
		assert.deepEqual(keys, ['Device', 'Symbol', 'Designator', 'Name', 'Unique ID']);
		assert.deepEqual(
			[JSON.parse(lines[8])[5], JSON.parse(lines[8])[6]],
			[0, 0],
			'Device 的 x/y 都写 0'
		);
		assert.deepEqual(
			[JSON.parse(lines[9])[5], JSON.parse(lines[9])[6]],
			[null, 0],
			'Designator 的 x 写 null、y 写 0'
		);
	});

	it('genFrame 生成组标题，y 位置随「Y 翻转」改变', async () => {
		const { buildSchSource } = await import('../iframe/js/src/app/pcb-to-sch/sourceBuilder.js');
		const plain = buildSchSource({
			components: [comps[0]],
			symbolDb,
			format: 'modern',
			options: { classify: 'ref', genFrame: true, now: () => 1 },
		});
		const textLine = plain.split('\n').find((l) => l.includes('"type":"TEXT"'));
		assert.ok(textLine);
		const body = JSON.parse(textLine.replace(/\|$/, '').split('||')[1]);
		assert.equal(body.value, 'R');
		assert.equal(body.align, 'LEFT_MIDDLE');

		const flipped = buildSchSource({
			components: [comps[0]],
			symbolDb,
			format: 'modern',
			options: { classify: 'ref', genFrame: true, yvalue: true, now: () => 1 },
		});
		const flippedBody = JSON.parse(
			flipped
				.split('\n')
				.find((l) => l.includes('"type":"TEXT"'))
				.replace(/\|$/, '')
				.split('||')[1]
		);
		assert.notEqual(flippedBody.y, body.y, 'Y 翻转后标题位置必须跟着变');
	});
});

describe('app/generate-net/geometry', () => {
	it('线段交叉：十字相交 true，平行/错开 false', async () => {
		const { segmentsIntersect, isTwoLinesTouching, distToSegmentSquared } = await import(
			'../iframe/js/src/app/generate-net/geometry.js'
		);
		assert.equal(segmentsIntersect(0, 0, 100, 0, 50, -50, 50, 50), true);
		assert.equal(segmentsIntersect(0, 0, 100, 0, 0, 10, 100, 10), false);
		assert.equal(distToSegmentSquared(50, 10, 0, 0, 100, 0), 100);

		const a = { x1: 0, y1: 0, x2: 100, y2: 0, w: 10 };
		assert.equal(isTwoLinesTouching(a, { x1: 100, y1: 3, x2: 200, y2: 3, w: 10 }), true, '端点半宽内算相接');
		assert.equal(isTwoLinesTouching(a, { x1: 100, y1: 30, x2: 200, y2: 30, w: 10 }), false);
	});

	it('圆不能用包围盒四边近似：半径 0.955 与切线距离 1.27 不能判相接', async () => {
		const { checkConnectivityHighPrecision } = await import('../iframe/js/src/app/generate-net/geometry.js');
		const roundPad = { shape: 'ROUND', layer: 1, x: 0, y: 0, r: 0.955, w: 1.91, h: 1.91 };
		const nearLine = { shape: 'line', layer: 1, x1: -50, y1: 1.27, x2: 50, y2: 1.27, w: 0.1 };
		assert.equal(checkConnectivityHighPrecision(roundPad, nearLine), false, '圆心距 1.27 > r+w/2 时不能连通');

		const touchLine = { shape: 'line', layer: 1, x1: -50, y1: 0.9, x2: 50, y2: 0.9, w: 0.1 };
		assert.equal(checkConnectivityHighPrecision(roundPad, touchLine), true);
	});

	it('层不同不连通；MULTI 与任意层连通；盲埋孔按层栈翻译', async () => {
		const { areLayersConnected, getRealLayerIdsFromRange, getStackIds } = await import(
			'../iframe/js/src/app/generate-net/geometry.js'
		);
		assert.equal(areLayersConnected({ layer: 1 }, { layer: 2 }), false);
		assert.equal(areLayersConnected({ layer: 1 }, { layer: 12 }), true);
		assert.equal(areLayersConnected({ layer: 1, blindLayers: [1, 15] }, { layer: 15 }), true);
		assert.equal(areLayersConnected({ layer: 1, blindLayers: [1, 15] }, { layer: 2 }), false);

		const stack = getStackIds([15, 17, 15]);
		assert.deepEqual(stack, [1, 15, 17, 2], '顶层 + 去重升序内层 + 底层');
		assert.deepEqual(getRealLayerIdsFromRange('1-3', stack), [1, 15, 17]);
		assert.deepEqual(getRealLayerIdsFromRange('', stack), null);
		assert.deepEqual(getRealLayerIdsFromRange('x-y', stack), [], '解析不出数字时返回空表（原实现行为）');
	});

	it('圆弧拆折线：90° 弧的中间点在弧上（不是弦的中点）', async () => {
		const { expandArcLines } = await import('../iframe/js/src/app/generate-net/geometry.js');
		// 半圆：从 (100,0) 到 (0,0)，角度 180°（顺时针/逆时针由符号决定），半径 50
		const segs = expandArcLines({ id: 'a1', type: 'ARC', net: 'N', layer: 1, x1: 100, y1: 0, x2: 0, y2: 0, angle: 180, w: 5 });
		assert.ok(segs.length > 1, '必须拆成多段');
		assert.equal(segs[0].x1, 100);
		assert.equal(segs[segs.length - 1].x2, 0);
		// 所有中间点都应在半径 50 的圆上
		for (const s of segs) {
			const d = Math.hypot(s.x1 - 50, s.y1);
			assert.ok(Math.abs(d - 50) < 1e-6, `点不在弧上：${d}`);
		}
	});
});

describe('app/generate-net/sourceParser', () => {
	it('V2：LINE / VIA / PAD_NET / LAYER', async () => {
		const { parseV2Primitives } = await import('../iframe/js/src/app/generate-net/sourceParser.js');
		const ctx = { allUsedNetNames: new Set(), padIdToPinInfo: {} };
		const lines = [
			'["LAYER",15,"INNER1","Inner1",3]',
			'["LINE","e1",0,"VCC",1,0,0,100,0,10]',
			'["VIA","e2",0,"GND","1-2",10,10,1,24]',
			'["PAD_NET","c1","3","GND",".1"]',
		];
		const { primitives, innerLayerIds } = parseV2Primitives(lines, ctx);
		assert.deepEqual(innerLayerIds, [15]);
		assert.equal(primitives.length, 2);
		assert.deepEqual(primitives[0], { id: 'e1', type: 'LINE', net: 'VCC', layer: 1, shape: 'line', x1: 0, y1: 0, x2: 100, y2: 0, w: 10 });
		assert.equal(primitives[1].layer, 12, '过孔一律记在多层');
		assert.equal(primitives[1].r, 12);
		assert.deepEqual(ctx.padIdToPinInfo['c1.1'], { compId: 'c1', pin: '3' });
		assert.equal(ctx.allUsedNetNames.has('VCC'), true);
	});

	it('V3：LINE / VIA / PAD_NET 的 id 拆解 / ATTR 位号回填', async () => {
		const { parseV3Primitives } = await import('../iframe/js/src/app/generate-net/sourceParser.js');
		const ctx = { allUsedNetNames: new Set(), padIdToPinInfo: {} };
		const lines = [
			'{"type":"LINE","ticket":3,"id":"e3"}||{"lineGroup":"e3","startX":0,"startY":0,"endX":10,"endY":0,"width":6,"netName":"N1","layerId":1}|',
			'{"type":"VIA","ticket":4,"id":"e4"}||{"centerX":5,"centerY":5,"viaDiameter":24,"ruleName":"1-2","netName":"N2"}|',
			'{"type":"PAD_NET","ticket":5,"id":"[\\"PAD_NET\\",\\"c9\\",\\"2\\",\\".3\\"]"}||{"padNet":"N3"}|',
			'{"type":"ATTR","ticket":6,"id":"e6"}||{"key":"Designator","value":"R7","parentId":"c9"}|',
		];
		const { primitives, compIdToDesignator } = parseV3Primitives(lines, ctx);
		assert.equal(primitives[0].x2, 10);
		assert.equal(primitives[0].net, 'N1');
		assert.equal(primitives[1].r, 12);
		assert.equal(primitives[1]._rawRange, '1-2');
		assert.equal(ctx.padIdToPinInfo['c9.3'].pin, '2');
		assert.equal(ctx.padIdToPinInfo['.3'].compId, 'c9', '后缀键也要登记');
		assert.equal(compIdToDesignator.c9, 'R7');
		assert.equal(ctx.padIdToPinInfo['c9.3'].des, 'R7', '位号要回填到引脚信息');
		assert.deepEqual([...ctx.allUsedNetNames].sort(), ['N1', 'N2', 'N3']);
	});

	it('FILL 多边形：矩形写法展开成 4 个顶点，多层填充被忽略', async () => {
		const { parseV3Primitives } = await import('../iframe/js/src/app/generate-net/sourceParser.js');
		const ctx = { allUsedNetNames: new Set(), padIdToPinInfo: {} };
		const lines = [
			'{"type":"FILL","id":"f1"}||{"path":["R",0,0,100,50,0,0],"netName":"GND","layerId":1}|',
			'{"type":"FILL","id":"f2"}||{"path":["R",0,0,10,10,0,0],"netName":"X","layerId":12}|',
		];
		const { primitives } = parseV3Primitives(lines, ctx);
		assert.equal(primitives.length, 1);
		assert.equal(primitives[0].vertices.length, 4);
		assert.equal(primitives[0].w, 100);
		assert.equal(primitives[0].h, 50);
		assert.equal(primitives[0].x, 50, '中心 = min + w/2');
	});
});

describe('app/generate-net/{connectivity,netNamer,plan}', () => {
	it('同层交叉的两条线并成一个分量；不同层不合并', async () => {
		const { computeClusters } = await import('../iframe/js/src/app/generate-net/connectivity.js');
		const prims = [
			{ id: 'l1', type: 'LINE', net: 'A', layer: 1, shape: 'line', x1: 0, y1: 0, x2: 100, y2: 0, w: 6 },
			{ id: 'l2', type: 'LINE', net: 'A', layer: 1, shape: 'line', x1: 50, y1: -50, x2: 50, y2: 50, w: 6 },
			{ id: 'l3', type: 'LINE', net: 'B', layer: 2, shape: 'line', x1: 0, y1: 0, x2: 100, y2: 0, w: 6 },
		];
		const clusters = computeClusters(prims, [], [], {});
		const sizes = Object.values(clusters).map((g) => g.length).sort((a, b) => b - a);
		assert.deepEqual(sizes, [2, 1], 'l1 与 l2 合并，l3 因层不同独立');
	});

	it('定名：票数优先于名字长短（GND 覆铜不会被 1 个 DP 焊盘改名）', async () => {
		const { voteNets, rankNetCandidates, createNetNamer, isGenericNet } = await import(
			'../iframe/js/src/app/generate-net/netNamer.js'
		);
		const group = [
			{ net: 'GND' },
			{ net: 'GND' },
			{ net: 'GND' },
			{ net: 'DP' },
			{ net: '' },
			{ net: 'null' },
		];
		const votes = voteNets(group);
		assert.equal(votes.get('GND'), 3);
		assert.equal(votes.has(''), false, '空网络不计票');
		assert.equal(votes.has('null'), false);
		assert.equal(rankNetCandidates(votes)[0], 'GND');

		assert.equal(isGenericNet('NET12'), true);
		assert.equal(isGenericNet('net3'), true);
		assert.equal(isGenericNet('NET_A'), false);
		// 票数相同时：真实名 > NET*
		const tie = voteNets([{ net: 'NET5' }, { net: 'VCC' }]);
		assert.equal(rankNetCandidates(tie)[0], 'VCC');

		const namer = createNetNamer(new Set(['NET1', 'NET2']));
		assert.equal(namer.nameFor(new Map()), 'NET3', '必须跳过已占用的名字');
		const namer2 = createNetNamer(new Set());
		assert.equal(namer2.nameFor(new Map()), 'NET1');
		assert.equal(namer2.nameFor(new Map()), 'NET2', '同一批内不重名');
	});

	it('图元模式：单元素分量跳过，只产出真正需要改的项', async () => {
		const { planPrimitiveOperations } = await import('../iframe/js/src/app/generate-net/plan.js');
		const clusters = {
			r1: [
				{ id: 'l1', type: 'LINE', net: 'VCC' },
				{ id: 'l2', type: 'LINE', net: '' },
			],
			r2: [{ id: 'l3', type: 'LINE', net: '' }],
			r3: [
				{ id: 'l4', type: 'LINE', net: 'GND' },
				{ id: 'l5', type: 'LINE', net: 'GND' },
			],
		};
		const ops = planPrimitiveOperations(clusters, new Set());
		assert.deepEqual(
			ops.map((o) => `${o.id}:${o.oldNet}->${o.newNet}`),
			['l2:—->VCC'],
			'网络名未变的不产生操作；孤立图元跳过'
		);
	});

	it('网表模式：按位号+引脚产出，旧网络从两种结构读', async () => {
		const { planNetlistOperations } = await import('../iframe/js/src/app/generate-net/plan.js');
		const clusters = {
			r1: [
				{ id: 'p1', type: 'PAD', net: 'GND', _pinInfo: { des: 'U1', pin: '1' } },
				{ id: 'p2', type: 'PAD', net: 'GND', _pinInfo: { des: 'U1', pin: '2' } },
			],
		};
		const container = {
			c1: { props: { Designator: 'U1' }, pinInfoMap: { 1: { net: 'OLD' }, 2: { net: 'GND' } } },
		};
		const ops = planNetlistOperations(clusters, new Set(), container);
		assert.deepEqual(ops, [{ des: 'U1', pin: '1', oldNet: 'OLD', newNet: 'GND', status: 'pending' }]);
	});

	it('写网表：两种引脚结构都能写，缺引脚按原结构补', async () => {
		const { applyPinUpdates } = await import('../iframe/js/src/app/generate-net/plan.js');
		const container = {
			a: { props: { Designator: 'U1' }, pinInfoMap: { 1: { net: 'OLD' } } },
			b: { props: { Designator: 'U2' }, pins: { 1: 'A' } },
		};
		const updates = new Map([
			['U1', { 1: 'NEW', 2: 'GND' }],
			['U2', { 1: 'B' }],
		]);
		const count = applyPinUpdates(container, updates);
		assert.equal(count, 3, 'U1.1 改 + U1.2 新增 + U2.1 改');
		assert.equal(container.a.pinInfoMap[1].net, 'NEW');
		assert.deepEqual(container.a.pinInfoMap[2], { net: 'GND', number: '2' });
		assert.equal(container.b.pins[1], 'B');
	});
});

describe('app/generate-net/sourceRewrite', () => {
	it('V2：普通图元改第 3 段，PAD_NET 用 compId+suffix 拼 id', async () => {
		const { createLineRewriter } = await import('../iframe/js/src/app/generate-net/sourceRewrite.js');
		const map = new Map([
			['e1', 'GND'],
			['c1.2', 'VCC'],
		]);
		const rewrite = createLineRewriter(map, true);

		const line = '["LINE","e1",0,"OLD",1,0,0,10,0,6]';
		const out = rewrite(line);
		assert.equal(JSON.parse(out.line)[3], 'GND');
		assert.equal(out.changedId, 'e1');

		const padNet = '["PAD_NET","c1","2","OLD",".2"]';
		const padOut = rewrite(padNet);
		assert.equal(JSON.parse(padOut.line)[3], 'VCC');
		assert.equal(padOut.changedId, 'c1.2');

		const untouched = '["LINE","e9",0,"A",1,0,0,1,0,6]';
		assert.equal(rewrite(untouched).line, untouched, '未命中的行必须逐字节不变');
	});

	it('V3：改 netName / padNet，行尾 | 保持原样', async () => {
		const { createLineRewriter } = await import('../iframe/js/src/app/generate-net/sourceRewrite.js');
		const map = new Map([
			['e3', 'GND'],
			['c9.7', 'VCC'],
		]);
		const rewrite = createLineRewriter(map, false);

		const line = '{"type":"LINE","id":"e3"}||{"netName":"OLD","layerId":1}|';
		const out = rewrite(line);
		assert.equal(out.line.endsWith('|'), true);
		assert.equal(JSON.parse(out.line.slice(0, -1).split('||')[1]).netName, 'GND');

		const noPipe = '{"type":"LINE","id":"e3"}||{"netName":"OLD"}';
		assert.equal(rewrite(noPipe).line.endsWith('|'), false, '原本没有行尾 | 就不能加');

		const padNet = '{"type":"PAD_NET","id":"[\\"PAD_NET\\",\\"c9\\",\\"3\\",\\".7\\"]"}||{"padNet":"OLD"}|';
		const padOut = rewrite(padNet);
		assert.equal(JSON.parse(padOut.line.slice(0, -1).split('||')[1]).padNet, 'VCC');

		const broken = '{"type":"LINE"';
		assert.equal(rewrite(broken).line, broken, '解析不了的行原样返回');
	});

	it('整份改写的 changed 计数与实际改动行一致', async () => {
		const { rewriteNetInSource } = await import('../iframe/js/src/app/generate-net/sourceRewrite.js');
		const src = ['{"type":"LINE","id":"e1"}||{"netName":"A"}|', '{"type":"LINE","id":"e2"}||{"netName":"B"}|', ''];
		const result = rewriteNetInSource(src, new Map([['e1', 'X']]), false);
		assert.equal(result.changed, 1);
		assert.equal(result.lines.length, 3);
		assert.equal(result.lines[2], '');
	});
});

describe('app/working-hours/{time,reminder}', () => {
	it('时长格式：0 补成 00:00:00，超过 24 小时照常进位', async () => {
		const { formatDuration, formatTimeCN, formatFullDateTime } = await import('../iframe/js/src/app/working-hours/time.js');
		assert.equal(formatDuration(0), '00:00:00');
		assert.equal(formatDuration(3725), '01:02:05');
		assert.equal(formatDuration(90000), '25:00:00');
		assert.equal(formatTimeCN(1.5), '1时30分');
		assert.equal(formatTimeCN(NaN), '0时0分');
		assert.equal(formatFullDateTime(Infinity), '无');
		assert.equal(formatFullDateTime(new Date(2026, 9, 22, 15, 4).getTime()), '2026/10/22 15:04');
	});

	it('提醒分钟互转：纯数字按分钟，HH:MM:SS 按小时', async () => {
		const { formatMin, parseMin } = await import('../iframe/js/src/app/working-hours/reminder.js');
		assert.equal(formatMin(90), '1:30:00');
		assert.equal(formatMin(45), '45:00');
		assert.equal(parseMin('90'), 90);
		assert.equal(parseMin('1:30:00'), 90);
		assert.equal(parseMin('1:30'), 1, '两段只取第一段（当作小时）');
		assert.equal(parseMin(''), 0);
		assert.equal(parseMin('abc'), 0);
		assert.equal(parseMin(15), 15);
	});
});

describe('app/working-hours/aggregate', () => {
	const day = (slots, meta) => JSON.stringify({ slots, meta });

	it('聚合：时间轴补齐空白天、统计工时与首末时刻', async () => {
		const { buildDataset } = await import('../iframe/js/src/app/working-hours/aggregate.js');
		const now = new Date(2026, 9, 22, 12, 0, 0);
		const configs = {
			STATS_2026_10_20: day({ 0: { p1: [60, 0] }, 1: { p1: [0, 30] } }, { p1: '项目A' }),
			STATS_2026_10_21: day({ 2: { p1: [120, 0] } }, { p1: '项目A' }),
		};
		const ds = buildDataset(configs, { now });

		assert.equal(ds.timeline.length, 3 * 96, '20/21/22 三天 × 96 格');
		assert.equal(ds.projectStats.p1.totalWork, 180);
		assert.equal(ds.projectStats.p1.totalRest, 30);
		assert.equal(ds.projectStats.p1.startTs, new Date(2026, 9, 20, 0, 0).getTime());
		assert.equal(ds.projectStats.p1.endTs, new Date(2026, 9, 21, 0, 30).getTime());
		assert.equal(ds.todayTs, new Date(2026, 9, 22, 0, 0).getTime());
	});

	it('没有任何历史数据时，时间轴只含今天，当前工程也建一行', async () => {
		const { buildDataset } = await import('../iframe/js/src/app/working-hours/aggregate.js');
		const now = new Date(2026, 9, 22, 12, 0, 0);
		const ds = buildDataset({}, { currentUuid: 'cur', currentName: '当前工程', now });
		assert.equal(ds.timeline.length, 96);
		assert.equal(ds.projectStats.cur.name, '当前工程');
		assert.equal(ds.projectStats.cur.totalWork, 0);
		assert.deepEqual(ds.sortedProjectIds, ['cur']);
	});

	it('工程按总工时降序并依次配色；坏配置被跳过', async () => {
		const { buildDataset, COLOR_PALETTE } = await import('../iframe/js/src/app/working-hours/aggregate.js');
		const now = new Date(2026, 9, 22, 12, 0, 0);
		const ds = buildDataset(
			{
				STATS_2026_10_22: day({ 0: { a: [10, 0], b: [99, 0] } }, { a: 'A', b: 'B' }),
				STATS_2026_10_22_broken: 'not json',
				OTHER_KEY: 'x',
			},
			{ now }
		);
		assert.deepEqual(ds.sortedProjectIds, ['b', 'a']);
		assert.equal(ds.pidColorMap.b, COLOR_PALETTE[0]);
		assert.equal(ds.pidColorMap.a, COLOR_PALETTE[1]);
	});

	it('今日工时只统计今天那 96 格', async () => {
		const { buildDataset, getTodayWorkHours } = await import('../iframe/js/src/app/working-hours/aggregate.js');
		const now = new Date(2026, 9, 22, 12, 0, 0);
		const ds = buildDataset({ STATS_2026_10_22: day({ 0: { p: [3600, 0] }, 10: { p: [1800, 0] } }, { p: 'P' }) }, { now });
		assert.equal(getTodayWorkHours(ds.timeline, ds.tsMap, ds.todayTs), 1.5);
		assert.equal(getTodayWorkHours(ds.timeline, ds.tsMap, ds.todayTs, 'p'), 1.5);
		assert.equal(getTodayWorkHours(ds.timeline, ds.tsMap, ds.todayTs, 'other'), 0);
		assert.equal(getTodayWorkHours(ds.timeline, ds.tsMap, 0), 0, '时间轴上没有的日期返回 0');
	});
});

describe('app/working-hours/reportTemplate', () => {
	it('标题转义、数据与校验和注入、库标签二选一', async () => {
		const { buildSecureReportHtml, buildLibTags } = await import('../iframe/js/src/app/working-hours/reportTemplate.js');
		const html = buildSecureReportHtml({
			fileName: '工时<A&B>',
			libTags: '<script>lib</script>',
			data: 'DATA_DATA',
			hash: 'HASH_HASH',
		});
		assert.equal(html.includes('工时&lt;A&amp;B&gt;'), true, '标题必须转义');
		assert.equal(html.includes('const _D = "DATA_DATA"'), true);
		assert.equal(html.includes('const _H = "HASH_HASH"'), true);
		assert.equal(html.includes('<script>lib</script>'), true);
		assert.equal(html.includes('cdn.jsdelivr.net'), false, '已内联就不该再引 CDN');

		// 注意：模板里的 `<\/script>` 求值后就是真正的 `</script>` —— 那正是库自己的闭合标签
		assert.equal(buildLibTags('e', 'f'), '<script>e</script>\n\t<script>f</script>');
		assert.ok(buildLibTags('', 'f').includes('cdn.jsdelivr.net/npm/echarts'), '缺任意一个就整体回退 CDN');
		assert.ok(buildLibTags('e', '').includes('cdn.jsdelivr.net/npm/fflate'));
	});
});
