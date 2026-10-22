/**
 * EDA 图元 API 调用契约测试（核心）
 *
 * 被测模块：src/js/PadViaConverter.js、src/js/WireConverter.js
 * 方式：mock 全局 `eda`，录制所有 `*.create(...)` / `*.delete(...)` 的实参，
 *      断言「参数个数、类型、顺序、缩放后的数值」符合客户端 API 契约。
 *
 * 一旦某个 EDA 版本的 API 签名发生变化，这里会先红，避免线上静默画歪。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { PadViaConverter } from '../src/js/PadViaConverter.js';
import { WireConverter } from '../src/js/WireConverter.js';

/** 断言浮点近似相等（缩放会引入 0.1*35 这类精度尾巴） */
function assertClose(actual, expected, message) {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${message || '数值不近似'}: 期望 ${expected}，实际 ${actual}`);
}

/** 录制型 eda mock */
function createEdaMock(options = {}) {
	const calls = [];
	const toasts = [];
	let selectedDetailed = options.detailed || [];
	const selections = options.selections || [];

	const recorder = (apiName) => ({
		create: async (...args) => {
			calls.push({ api: apiName, method: 'create', args });
			return options.failCreate === apiName ? null : { ok: true };
		},
		delete: async (...args) => {
			calls.push({ api: apiName, method: 'delete', args });
			return true;
		},
	});

	const logs = [];
	globalThis.eda = {
		sys_Storage: {
			getExtensionUserConfig: async () => (options.calibration ? JSON.stringify(options.calibration) : ''),
		},
		sys_Log: {
			add: (msg, level) => logs.push({ msg, level }),
		},
		sys_PanelControl: { openBottomPanel: () => {} },
		pcb_SelectControl: {
			getAllSelectedPrimitives: async () => selections,
			getSelectedPrimitives: async () => selectedDetailed,
		},
		pcb_PrimitiveVia: recorder('pcb_PrimitiveVia'),
		pcb_PrimitivePad: recorder('pcb_PrimitivePad'),
		pcb_PrimitiveLine: recorder('pcb_PrimitiveLine'),
		pcb_PrimitiveArc: recorder('pcb_PrimitiveArc'),
		pcb_PrimitivePolyline: recorder('pcb_PrimitivePolyline'),
		pcb_PrimitiveRegion: recorder('pcb_PrimitiveRegion'),
		pcb_PrimitiveFill: recorder('pcb_PrimitiveFill'),
		sys_Message: {
			showToastMessage: (msg, type) => toasts.push({ msg, type }),
		},
		pcb_MathPolygon: {
			createPolygon: (arr) => {
				if (options.polygonFails) return undefined;
				const polyObj = { __polygon: arr };
				calls.push({ api: 'pcb_MathPolygon', method: 'createPolygon', args: [arr], result: polyObj });
				return polyObj;
			},
		},
	};

	return { calls, logs, toasts, setSelections: (s) => (selections.length = 0, selections.push(...s)) };
}

/** 取某 API 某方法的全部调用实参 */
function pick(calls, api, method = 'create') {
	return calls.filter((c) => c.api === api && c.method === method).map((c) => c.args);
}

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
	delete globalThis.eda;
});

// ---------------------------------------------------------------------------
// 焊盘 ⇄ 过孔
// ---------------------------------------------------------------------------

describe('pcb_PrimitiveVia.create - 焊盘转过孔', () => {
	/** 外层 10x6、内孔 3x3，取 Min 后 outer=6 / hole=3 */
	const pad = {
		primitiveType: 'Pad',
		primitiveId: 'e100',
		layer: 12,
		net: 'GND',
		x: 100,
		y: 200,
		pad: ['ELLIPSE', 10, 6],
		hole: ['ROUND', 3, 3],
		solderMaskAndPasteMaskExpansion: { topSolderMask: 0.1, bottomSolderMask: 0.2, topPasteMask: 0, bottomPasteMask: 0 },
	};

	it('默认 1:1 校准 → 9 个实参，顺序为 (net, x, y, 内径, 外径, 0, null, 阻焊, false)', async () => {
		const { calls } = createEdaMock({ selections: [pad] });
		await PadViaConverter.toVia();

		const [args] = pick(calls, 'pcb_PrimitiveVia');
		assert.equal(args.length, 9, 'pcb_PrimitiveVia.create 参数个数必须为 9');
		assert.deepEqual(args, [
			'GND',
			100,
			200,
			3,
			6,
			0,
			null,
			{ topSolderMask: 0.1, bottomSolderMask: 0.2, topPasteMask: 0, bottomPasteMask: 0 },
			false,
		]);
	});

	it('参数类型契约：net 为字符串，坐标/内外径为 number，第 6 位恒为 0，第 7 位恒为 null，末位恒为 false', async () => {
		const { calls } = createEdaMock({ selections: [pad] });
		await PadViaConverter.toVia();

		const [args] = pick(calls, 'pcb_PrimitiveVia');
		assert.equal(typeof args[0], 'string');
		[1, 2, 3, 4, 5].forEach((i) => assert.equal(typeof args[i], 'number', `第 ${i} 位必须是 number`));
		assert.equal(args[5], 0);
		assert.equal(args[6], null);
		assert.equal(typeof args[7], 'object');
		assert.equal(args[8], false);
	});

	it('校准倍率生效：获取焊盘 × 创建过孔 相乘（坐标 2×0.5=1、外径 3×2=6、内径 4×3=12、阻焊 5×7=35）', async () => {
		const calibration = {
			获取焊盘: { 坐标: 2, 内径: 4, 外径: 3, 阻焊: 5 },
			创建过孔: { 坐标: 0.5, 内径: 3, 外径: 2, 阻焊: 7 },
		};
		const { calls } = createEdaMock({ selections: [pad], calibration });
		await PadViaConverter.toVia();

		const [args] = pick(calls, 'pcb_PrimitiveVia');
		assertClose(args[1], 100, 'x 缩放后');
		assertClose(args[2], 200, 'y 缩放后');
		assertClose(args[3], 36, '内径 3×12');
		assertClose(args[4], 36, '外径 6×6');
		assertClose(args[7].topSolderMask, 3.5, '上阻焊 0.1×35');
		assertClose(args[7].bottomSolderMask, 7, '下阻焊 0.2×35');
	});

	it('创建成功后删除原焊盘（传入 primitiveId）', async () => {
		const { calls } = createEdaMock({ selections: [pad] });
		await PadViaConverter.toVia();
		assert.deepEqual(pick(calls, 'pcb_PrimitivePad', 'delete'), [['e100']]);
	});

	it('pad 数组不足 3 位 → 直接跳过，不创建也不删除', async () => {
		const broken = { ...pad, pad: ['ELLIPSE', 10] };
		const { calls } = createEdaMock({ selections: [broken] });
		await PadViaConverter.toVia();
		assert.equal(pick(calls, 'pcb_PrimitiveVia').length, 0);
		assert.equal(pick(calls, 'pcb_PrimitivePad', 'delete').length, 0);
	});

	it('无孔数据时内径补 0；无阻焊数据时用 -1000 兜底', async () => {
		const noHole = { ...pad, hole: null, solderMaskAndPasteMaskExpansion: null };
		const { calls } = createEdaMock({ selections: [noHole] });
		await PadViaConverter.toVia();

		const [args] = pick(calls, 'pcb_PrimitiveVia');
		assert.equal(args[3], 0, '内径应为 0');
		assert.deepEqual(args[7], { topSolderMask: -1000, bottomSolderMask: -1000, topPasteMask: 0, bottomPasteMask: 0 });
	});

	it('非通孔层（layer !== 12）或非 Pad 类型 → 不处理', async () => {
		const via = { ...pad, layer: 1 };
		const { calls } = createEdaMock({ selections: [via, { primitiveType: 'Line' }] });
		await PadViaConverter.toVia();
		assert.equal(calls.length, 0);
	});
});

describe('pcb_PrimitivePad.create - 过孔转焊盘', () => {
	const via = {
		primitiveType: 'Via',
		primitiveId: 'e200',
		viaType: 0,
		net: 'VCC',
		x: 10,
		y: 20,
		diameter: 8,
		holeDiameter: 4,
		solderMaskExpansion: null,
	};

	it('默认 1:1 校准 → 17 个实参，通孔层 12 / 网格名 "1" / 旋转 0', async () => {
		const { calls } = createEdaMock({ selections: [via] });
		await PadViaConverter.toPad();

		const [args] = pick(calls, 'pcb_PrimitivePad');
		assert.equal(args.length, 17, 'pcb_PrimitivePad.create 参数个数必须为 17');
		assert.deepEqual(args, [
			12,
			'1',
			10,
			20,
			0,
			['ELLIPSE', 8, 8],
			'VCC',
			['ROUND', 4, 4],
			0,
			0,
			0,
			true,
			0,
			[],
			{ topSolderMask: -1000, bottomSolderMask: -1000, topPasteMask: 0, bottomPasteMask: 0 },
			null,
			false,
		]);
	});

	it('外形/孔形数组必须是 [形状名, 尺寸, 尺寸] 三段式', async () => {
		const { calls } = createEdaMock({ selections: [via] });
		await PadViaConverter.toPad();

		const [args] = pick(calls, 'pcb_PrimitivePad');
		assert.equal(args[5].length, 3);
		assert.equal(args[5][0], 'ELLIPSE');
		assert.equal(args[5][1], args[5][2], '圆焊盘长宽必须一致');
		assert.equal(args[7].length, 3);
		assert.equal(args[7][0], 'ROUND');
		assert.equal(typeof args[1], 'string', '第 2 位（网格名）必须是字符串');
	});

	it('有阻焊数据时 topPasteMask/bottomPasteMask 跟随阻焊值，并应用倍率', async () => {
		const withSolder = { ...via, solderMaskExpansion: { topSolderMask: 0.5, bottomSolderMask: 0.25 } };
		const calibration = { 获取过孔: { 阻焊: 2 }, 创建焊盘: { 阻焊: 3 } };
		const { calls } = createEdaMock({ selections: [withSolder], calibration });
		await PadViaConverter.toPad();

		const [args] = pick(calls, 'pcb_PrimitivePad');
		assertClose(args[14].topSolderMask, 3, '0.5×(2×3)');
		assertClose(args[14].bottomSolderMask, 1.5, '0.25×6');
		assertClose(args[14].topPasteMask, 3);
		assertClose(args[14].bottomPasteMask, 1.5);
	});

	it('viaType !== 0（非通孔过孔）→ 不处理', async () => {
		const buried = { ...via, viaType: 1 };
		const { calls } = createEdaMock({ selections: [buried] });
		await PadViaConverter.toPad();
		assert.equal(calls.length, 0);
	});

	it('创建成功后删除原过孔', async () => {
		const { calls } = createEdaMock({ selections: [via] });
		await PadViaConverter.toPad();
		assert.deepEqual(pick(calls, 'pcb_PrimitiveVia', 'delete'), [['e200']]);
	});
});

// ---------------------------------------------------------------------------
// 导线 ⇄ 线条
// ---------------------------------------------------------------------------

describe('pcb_PrimitiveLine.create / pcb_PrimitiveArc.create - 线条转导线', () => {
	it('直线段：8 个实参 (net, layer, x1, y1, x2, y2, width, false)', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e300',
			net: 'GND',
			layer: 1,
			lineWidth: 0.25,
			polygon: { polygon: [0, 0, 'L', 10, 20] },
		};
		const { calls } = createEdaMock({ selections: [poly], detailed: [] });
		await WireConverter.toWire();

		const [args] = pick(calls, 'pcb_PrimitiveLine');
		assert.equal(args.length, 8, 'pcb_PrimitiveLine.create 参数个数必须为 8');
		assert.deepEqual(args, ['GND', 1, 0, 0, 10, 20, 0.25, false]);
		assert.equal(typeof args[0], 'string');
		assert.equal(typeof args[1], 'number');
		[2, 3, 4, 5, 6].forEach((i) => assert.equal(typeof args[i], 'number'));
		assert.equal(args[7], false);
	});

	it('坐标倍率生效（获取折线.坐标 2 × 创建直线.坐标 3 = 6），线宽倍率独立', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e300',
			net: '',
			layer: 2,
			lineWidth: 0.5,
			polygon: { polygon: [1, 2, 'L', 3, 4] },
		};
		const calibration = {
			获取折线: { 坐标: 2, 线宽: 2 },
			创建直线: { 坐标: 3, 线宽: 4 },
			创建弧线: { 圆弧角度: 10 },
		};
		const { calls } = createEdaMock({ selections: [poly], detailed: [], calibration });
		await WireConverter.toWire();

		const [args] = pick(calls, 'pcb_PrimitiveLine');
		assertClose(args[2], 6);
		assertClose(args[3], 12);
		assertClose(args[4], 18);
		assertClose(args[5], 24);
		assertClose(args[6], 4, '线宽 0.5×(2×4)');
	});

	it('弧线段：10 个实参 (net, layer, x1, y1, x2, y2, angle, width, 1, false)，角度单独缩放', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e300',
			net: 'N1',
			layer: 1,
			lineWidth: 0.2,
			polygon: { polygon: [0, 0, 'ARC', 45, 10, 0] },
		};
		const { calls } = createEdaMock({ selections: [poly], detailed: [] });
		await WireConverter.toWire();

		const [args] = pick(calls, 'pcb_PrimitiveArc');
		assert.equal(args.length, 10, 'pcb_PrimitiveArc.create 参数个数必须为 10');
		assert.deepEqual(args, ['N1', 1, 0, 0, 10, 0, 45, 0.2, 1, false]);
		assert.equal(typeof args[6], 'number', '角度必须传 number');
		assert.equal(args[8], 1);
		assert.equal(args[9], false);
	});

	it('弧线角度只用「创建弧线」一侧的倍率（个别版本 create 要弧度）', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e300',
			net: '',
			layer: 1,
			lineWidth: 0.2,
			polygon: { polygon: [0, 0, 'CARC', 9, 10, 0] },
		};
		// 写侧用 创建弧线.圆弧角度=5；读侧 0.017453 不应影响写
		const calibration = { 获取折线: { 坐标: 2 }, 创建直线: { 坐标: 1 }, 创建弧线: { 圆弧角度: 5 }, 获取弧线: { 圆弧角度: 0.017453 } };
		const { calls } = createEdaMock({ selections: [poly], detailed: [], calibration });
		await WireConverter.toWire();

		const [args] = pick(calls, 'pcb_PrimitiveArc');
		assertClose(args[6], 45, '角度 9×5（只乘创建侧）');
		assertClose(args[4], 20, '坐标 10×(2×1)');
	});

	it('角度校准默认 1：两侧同为角度制时原样透传', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e301',
			net: '',
			layer: 1,
			lineWidth: 0.2,
			polygon: { polygon: [0, 0, 'ARC', 90, 10, 0] },
		};
		const { calls } = createEdaMock({ selections: [poly], detailed: [], calibration: {} });
		await WireConverter.toWire();
		const [args] = pick(calls, 'pcb_PrimitiveArc');
		assert.equal(args[6], 90, '无校准时角度不变');
	});

	it('多段路径逐段发射：起止点首尾相接', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e300',
			net: '',
			layer: 1,
			lineWidth: 0.2,
			polygon: { polygon: [0, 0, 'L', 10, 0, 'L', 10, 10] },
		};
		const { calls } = createEdaMock({ selections: [poly], detailed: [] });
		await WireConverter.toWire();

		const lines = pick(calls, 'pcb_PrimitiveLine');
		assert.equal(lines.length, 2);
		assert.deepEqual([lines[0][2], lines[0][3], lines[0][4], lines[0][5]], [0, 0, 10, 0]);
		assert.deepEqual([lines[1][2], lines[1][3], lines[1][4], lines[1][5]], [10, 0, 10, 10], '第二段应从上一段终点起笔');
	});

	it('转换前先删除原折线图元', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e300',
			net: '',
			layer: 1,
			lineWidth: 0.2,
			polygon: { polygon: [0, 0, 'L', 1, 1] },
		};
		const { calls } = createEdaMock({ selections: [poly], detailed: [] });
		await WireConverter.toWire();
		assert.deepEqual(pick(calls, 'pcb_PrimitivePolyline', 'delete'), [['e300']]);
	});

	it('非铜层（layer 5）→ 跳过并写 warn 日志', async () => {
		const poly = {
			primitiveType: 'Polyline',
			primitiveId: 'e300',
			net: '',
			layer: 5,
			lineWidth: 0.2,
			polygon: { polygon: [0, 0, 'L', 1, 1] },
		};
		const { calls, logs } = createEdaMock({ selections: [poly], detailed: [] });
		await WireConverter.toWire();
		assert.equal(pick(calls, 'pcb_PrimitiveLine').length, 0);
		assert.equal(logs.length, 1);
		assert.equal(logs[0].level, 'warn');
	});

	it('铜层判定：1/2 与 15~46 视为铜层，其余不是', async () => {
		for (const layer of [1, 2, 15, 46]) {
			const poly = { primitiveType: 'Polyline', primitiveId: 'e', net: '', layer, lineWidth: 0.2, polygon: { polygon: [0, 0, 'L', 1, 1] } };
			const { calls } = createEdaMock({ selections: [poly], detailed: [] });
			await WireConverter.toWire();
			assert.equal(pick(calls, 'pcb_PrimitiveLine').length, 1, `layer ${layer} 应可转换`);
		}
		for (const layer of [3, 14, 47]) {
			const poly = { primitiveType: 'Polyline', primitiveId: 'e', net: '', layer, lineWidth: 0.2, polygon: { polygon: [0, 0, 'L', 1, 1] } };
			const { calls } = createEdaMock({ selections: [poly], detailed: [] });
			await WireConverter.toWire();
			assert.equal(pick(calls, 'pcb_PrimitiveLine').length, 0, `layer ${layer} 不应转换`);
		}
	});

	it('圆形区域（CIRCLE）→ 两段 180° 弧线，圆心/半径按坐标倍率缩放', async () => {
		const region = {
			primitiveType: 'Region',
			primitiveId: 'e400',
			net: 'GND',
			layer: 1,
			lineWidth: 0.2,
			complexPolygon: { polygon: ['CIRCLE', 10, 20, 5] },
		};
		const calibration = { 获取折线: { 坐标: 2 }, 创建直线: { 坐标: 1 } };
		const { calls } = createEdaMock({ selections: [region], detailed: [], calibration });
		await WireConverter.toWire();

		const arcs = pick(calls, 'pcb_PrimitiveArc');
		assert.equal(arcs.length, 2);
		// cx=20 cy=40 r=10 → 左上→右上，再反向
		assert.deepEqual([arcs[0][2], arcs[0][3], arcs[0][4], arcs[0][5], arcs[0][6]], [10, 40, 30, 40, 180]);
		assert.deepEqual([arcs[1][2], arcs[1][3], arcs[1][4], arcs[1][5], arcs[1][6]], [30, 40, 10, 40, 180]);
	});

	it('圆角矩形（R）：圆角半径被限制在短边一半以内', async () => {
		// w=20 h=10 r=100 → 应被夹到 min(20,10)/2 = 5
		const region = {
			primitiveType: 'Region',
			primitiveId: 'e400',
			net: '',
			layer: 1,
			lineWidth: 0.2,
			complexPolygon: { polygon: ['R', 0, 0, 20, 10, 0, 100] },
		};
		const { calls } = createEdaMock({ selections: [region], detailed: [] });
		await WireConverter.toWire();

		const arcs = pick(calls, 'pcb_PrimitiveArc');
		// r 被夹到 5 → 四角各一段 -90° 弧
		assert.equal(arcs.length, 4);
		arcs.forEach((a) => assert.equal(a[6], -90));
	});
});

describe('pcb_PrimitivePolyline.create - 导线转线条', () => {
	it('直线 → 5 个实参 (net, layer, polygonObj, width, false)', async () => {
		const line = {
			primitiveType: 'Line',
			primitiveId: 'e500',
			net: 'GND',
			layer: 1,
			startX: 1,
			startY: 2,
			endX: 3,
			endY: 4,
			lineWidth: 0.3,
		};
		const { calls } = createEdaMock({ selections: [line] });
		await WireConverter.toPolyline();

		const [args] = pick(calls, 'pcb_PrimitivePolyline');
		assert.equal(args.length, 5, 'pcb_PrimitivePolyline.create 参数个数必须为 5');
		assert.equal(args[0], 'GND');
		assert.equal(args[1], 1);
		assert.deepEqual(args[2].__polygon, [1, 2, 'L', 3, 4]);
		assert.equal(args[3], 0.3);
		assert.equal(args[4], false);
	});

	it('弧线 → polygon：角度乘「获取弧线」一侧的倍率（个别版本 get 返回弧度）', async () => {
		const arc = {
			primitiveType: 'Arc',
			primitiveId: 'e501',
			net: 'N1',
			layer: 1,
			startX: 0,
			startY: 0,
			endX: 5,
			endY: 5,
			arcAngle: 30,
			lineWidth: 0.3,
		};
		// 读侧：get 返回弧度时，系数应为 57.2958（弧度→度）；这里用 6 便于断言
		const calibration = { 获取弧线: { 圆弧角度: 6 }, 创建弧线: { 圆弧角度: 0.017453 } };
		const { calls } = createEdaMock({ selections: [arc], calibration });
		await WireConverter.toPolyline();

		const [args] = pick(calls, 'pcb_PrimitivePolyline');
		assert.equal(args[2].__polygon[2], 'ARC');
		assertClose(args[2].__polygon[3], 180, '角度 30×6（只乘获取侧）');
	});

	it('弧度↔角度换算系数（0.017453 / 57.2958）在合法范围内不会被当作非法值', async () => {
		const arc = {
			primitiveType: 'Arc',
			primitiveId: 'e502',
			net: '',
			layer: 1,
			startX: 0,
			startY: 0,
			endX: 1,
			endY: 1,
			arcAngle: 90,
			lineWidth: 0.2,
		};
		// 模拟某版本 get 返回的是弧度、需要换成度：90 × 57.2958 ≈ 5156.6
		const calibration = { 获取弧线: { 圆弧角度: 57.2958 } };
		const { calls } = createEdaMock({ selections: [arc], calibration });
		await WireConverter.toPolyline();
		const [args] = pick(calls, 'pcb_PrimitivePolyline');
		assert.ok(args[2].__polygon[3] > 5000, 'rad→deg 系数应原样生效');
	});

	it('删除旧图元时区分 Line / Arc 的 API', async () => {
		const line = { primitiveType: 'Line', primitiveId: 'e500', net: '', layer: 1, startX: 0, startY: 0, endX: 1, endY: 1, lineWidth: 0.1 };
		const arc = { primitiveType: 'Arc', primitiveId: 'e501', net: '', layer: 1, startX: 0, startY: 0, endX: 1, endY: 1, arcAngle: 90, lineWidth: 0.1 };
		const { calls } = createEdaMock({ selections: [line, arc] });
		await WireConverter.toPolyline();
		assert.deepEqual(pick(calls, 'pcb_PrimitiveLine', 'delete'), [['e500']]);
		assert.deepEqual(pick(calls, 'pcb_PrimitiveArc', 'delete'), [['e501']]);
	});

	it('无选中图元 → 不发任何调用', async () => {
		const { calls } = createEdaMock({ selections: [] });
		await WireConverter.toggle();
		assert.equal(calls.length, 0);
	});

	// ---------------- 多段合并成连续折线（v1.17.7 新增） ----------------

	it('首尾相接的两段直线 → 合并成一条连续折线（3 个节点）', async () => {
		const a = { primitiveType: 'Line', primitiveId: 'e1', net: 'GND', layer: 1, startX: 0, startY: 0, endX: 10, endY: 0, lineWidth: 0.2 };
		const b = { primitiveType: 'Line', primitiveId: 'e2', net: 'GND', layer: 1, startX: 10, startY: 0, endX: 10, endY: 10, lineWidth: 0.2 };
		const { calls } = createEdaMock({ selections: [a, b] });
		await WireConverter.toPolyline();

		const polys = pick(calls, 'pcb_PrimitivePolyline');
		assert.equal(polys.length, 1, '两段应合并为一条折线');
		assert.deepEqual(polys[0][2].__polygon, [0, 0, 'L', 10, 0, 'L', 10, 10]);
		assert.deepEqual(pick(calls, 'pcb_PrimitiveLine', 'delete'), [['e1'], ['e2']], '原导线都必须删除');
	});

	it('方向相反的第二段（终点接第一段终点）→ 合并时自动反转', async () => {
		const a = { primitiveType: 'Line', primitiveId: 'e1', net: '', layer: 1, startX: 0, startY: 0, endX: 10, endY: 0, lineWidth: 0.2 };
		const b = { primitiveType: 'Line', primitiveId: 'e2', net: '', layer: 1, startX: 20, startY: 0, endX: 10, endY: 0, lineWidth: 0.2 };
		const { calls } = createEdaMock({ selections: [a, b] });
		await WireConverter.toPolyline();

		const polys = pick(calls, 'pcb_PrimitivePolyline');
		assert.equal(polys.length, 1);
		assert.deepEqual(polys[0][2].__polygon, [0, 0, 'L', 10, 0, 'L', 20, 0]);
	});

	it('反向的弧线 → 合并时角度取负（扫掠方向相反）', async () => {
		const line = { primitiveType: 'Line', primitiveId: 'e1', net: '', layer: 1, startX: 0, startY: 0, endX: 10, endY: 0, lineWidth: 0.2 };
		const arc = { primitiveType: 'Arc', primitiveId: 'e2', net: '', layer: 1, startX: 20, startY: 0, endX: 10, endY: 0, arcAngle: 90, lineWidth: 0.2 };
		const { calls } = createEdaMock({ selections: [line, arc] });
		await WireConverter.toPolyline();

		const polys = pick(calls, 'pcb_PrimitivePolyline');
		assert.equal(polys.length, 1);
		assert.deepEqual(polys[0][2].__polygon, [0, 0, 'L', 10, 0, 'ARC', -90, 20, 0]);
	});

	it('不同网络 / 图层 / 线宽不合并', async () => {
		const mk = (id, net, layer, width) => ({ primitiveType: 'Line', primitiveId: id, net, layer, startX: 0, startY: 0, endX: 1, endY: 0, lineWidth: width });
		const { calls } = createEdaMock({ selections: [mk('e1', 'GND', 1, 0.2), mk('e2', 'VCC', 1, 0.2)] });
		await WireConverter.toPolyline();
		assert.equal(pick(calls, 'pcb_PrimitivePolyline').length, 2, '不同网络各自成线');

		const { calls: c2 } = createEdaMock({ selections: [mk('e1', 'GND', 1, 0.2), mk('e2', 'GND', 2, 0.2)] });
		await WireConverter.toPolyline();
		assert.equal(pick(c2, 'pcb_PrimitivePolyline').length, 2, '不同图层各自成线');

		const { calls: c3 } = createEdaMock({ selections: [mk('e1', 'GND', 1, 0.2), mk('e2', 'GND', 1, 0.3)] });
		await WireConverter.toPolyline();
		assert.equal(pick(c3, 'pcb_PrimitivePolyline').length, 2, '不同线宽各自成线');
	});

	it('折线创建失败 → 用快照恢复原导线，并给出提示', async () => {
		const a = { primitiveType: 'Line', primitiveId: 'e1', net: 'GND', layer: 1, startX: 0, startY: 0, endX: 10, endY: 0, lineWidth: 0.2 };
		const { calls, toasts } = createEdaMock({ selections: [a], failCreate: 'pcb_PrimitivePolyline' });
		await WireConverter.toPolyline();

		const restored = pick(calls, 'pcb_PrimitiveLine');
		assert.equal(restored.length, 1, '应重建原直线');
		assert.deepEqual(restored[0], ['GND', 1, 0, 0, 10, 0, 0.2, false], '恢复参数与原图元一致');
		assert.equal(toasts.length, 1);
	});

	it('Region 必须用 pcb_PrimitiveRegion.delete（不能用 Polyline.delete）', async () => {
		const region = {
			primitiveType: 'Region',
			primitiveId: 'e400',
			net: 'GND',
			layer: 1,
			lineWidth: 0.2,
			complexPolygon: { polygon: ['CIRCLE', 10, 20, 5] },
		};
		const { calls } = createEdaMock({ selections: [region] });
		await WireConverter.toWire();

		assert.deepEqual(pick(calls, 'pcb_PrimitiveRegion', 'delete'), [['e400']]);
		assert.equal(pick(calls, 'pcb_PrimitivePolyline', 'delete').length, 0, '不应再借用折线 API 删区域');
	});
});
