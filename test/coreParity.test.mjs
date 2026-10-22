/**
 * core/* 与 common.js 的「双实现等价」测试（B1 验收锚点）
 *
 * 背景：`iframe/js/common.js` 是 18 个页面共用的 IIFE 门面，拆分成 ESM 期间**冻结不动**。
 * 迁移期两套实现并存，最大的风险是静默漂移 —— 所以这里逐项比对：
 * 同一个输入下，`window.WolfCommon` 与 `src/core/*` 必须给出相同结果。
 *
 * 加载方式：
 *   - 门面：`new Function('window', code)` 丢进假 window 执行（它是 IIFE，不是 ESM）；
 *   - ESM：直接 `import()`，用 query 串给需要「新鲜实例」的用例（版本号有模块级缓存）。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const COMMON_SOURCE = fs.readFileSync(path.join(process.cwd(), 'iframe', 'js', 'common.js'), 'utf8');

/** 门面导出项（= common.js:487-517 的键集合） */
const EXPECTED_KEYS = [
	'NETLIST_KEY',
	'LAYER',
	'logger',
	'getEda',
	'hasEda',
	'getEditorVersion',
	'getVersionFamily',
	'isV2',
	'isV3',
	'isV4',
	'isModern',
	'isInnerLayer',
	'isCopperLayer',
	'isConductiveLayer',
	'getComponentsContainer',
	'escapeHtml',
	'createSchWireLines',
	'splitSourceLine',
	'joinSourceLine',
	'toApiLength',
	'getNetlist',
	'setNetlist',
];

let seq = 0;

/**
 * 加载门面实现（每次都是全新闭包，版本号缓存互不影响）
 *
 * @param {object|null} eda 假宿主对象，null 表示「不在 EDA 环境」
 * @returns {object} window.WolfCommon
 */
function loadClassic(eda) {
	const fakeWindow = {};
	globalThis.eda = eda === null ? undefined : eda;
	// eslint-disable-next-line no-new-func
	new Function('window', COMMON_SOURCE)(fakeWindow);
	return fakeWindow.WolfCommon;
}

/**
 * 加载 ESM 实现（每个用例一套独立模块实例）
 *
 * @returns {Promise<object>} 与门面同形的聚合对象
 */
async function loadEsm() {
	const q = `?p=${++seq}`;
	const [eda, ver, layer, net, src, len, util, log, emit] = await Promise.all([
		import(`../iframe/js/src/core/eda.js${q}`),
		import(`../iframe/js/src/core/version.js${q}`),
		import(`../iframe/js/src/core/layer.js${q}`),
		import(`../iframe/js/src/core/netlist.js${q}`),
		import(`../iframe/js/src/core/sourceLine.js${q}`),
		import(`../iframe/js/src/core/length.js${q}`),
		import(`../iframe/js/src/core/util.js${q}`),
		import(`../iframe/js/src/core/log.js${q}`),
		import(`../iframe/js/src/sch/emitter.js${q}`),
	]);
	return {
		NETLIST_KEY: eda.NETLIST_KEY,
		LAYER: layer.LAYER,
		logger: log.logger,
		getEda: eda.getEda,
		hasEda: eda.hasEda,
		getEditorVersion: ver.getEditorVersion,
		getVersionFamily: ver.getVersionFamily,
		isV2: ver.isV2,
		isV3: ver.isV3,
		isV4: ver.isV4,
		isModern: ver.isModern,
		isInnerLayer: layer.isInnerLayer,
		isCopperLayer: layer.isCopperLayer,
		isConductiveLayer: layer.isConductiveLayer,
		getComponentsContainer: net.getComponentsContainer,
		escapeHtml: util.escapeHtml,
		createSchWireLines: emit.createSchWireLines,
		splitSourceLine: src.splitSourceLine,
		joinSourceLine: src.joinSourceLine,
		toApiLength: len.toApiLength,
		getNetlist: net.getNetlist,
		setNetlist: net.setNetlist,
	};
}

/**
 * 造最小可用的假宿主
 *
 * @param {object} opt 选项：version/pcbNetlist/schNetlist/throwOnPcbWrite 等
 * @returns {object} 假 eda
 */
function makeEda(opt = {}) {
	const calls = [];
	const mkFile = (text) => (text === undefined ? undefined : new Blob([text]));
	return {
		calls,
		sys_Environment: {
			getEditorCurrentVersion: () => {
				if (opt.throwOnVersion) throw new Error('no env');
				return opt.version === undefined ? '3.0.12' : opt.version;
			},
		},
		pcb_ManufactureData: {
			getNetlistFile: () => mkFile(opt.pcbNetlist),
		},
		sch_ManufactureData: {
			getNetlistFile: () => mkFile(opt.schNetlist),
		},
		pcb_Net: {
			setNetlist: (key, text) => {
				calls.push(['pcb', key, text]);
				if (opt.throwOnPcbWrite) throw new Error('pcb write failed');
			},
		},
		sch_Netlist: {
			setNetlist: (key, text) => {
				calls.push(['sch', key, text]);
				if (opt.throwOnSchWrite) throw new Error('sch write failed');
			},
		},
	};
}

afterEach(() => {
	delete globalThis.eda;
});

describe('B1 · core/* 与 common.js 等价', () => {
	it('导出集合与门面一致（22 项）', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		assert.deepEqual(Object.keys(classic).sort(), EXPECTED_KEYS.toSorted(), '门面导出项变化了，需同步 EXPECTED_KEYS');
		assert.deepEqual(Object.keys(esm).sort(), EXPECTED_KEYS.toSorted(), 'core/* 聚合导出项与门面不一致');
	});

	it('NETLIST_KEY 与 LAYER 完全相等', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		assert.equal(esm.NETLIST_KEY, classic.NETLIST_KEY);
		assert.deepEqual(esm.LAYER, classic.LAYER);
	});

	for (const version of ['3.0.12', '4.1.78', '2.2.45.1', '2.0.5', '', null]) {
		it(`版本族判定一致：${JSON.stringify(version)}`, async () => {
			const eda = version === null ? null : makeEda({ version });
			const classic = loadClassic(eda);
			const esm = await loadEsm();
			for (const fn of ['getEditorVersion', 'getVersionFamily', 'isV2', 'isV3', 'isV4', 'isModern']) {
				assert.deepEqual(esm[fn](), classic[fn](), `${fn} 在 version=${JSON.stringify(version)} 下不一致`);
			}
			assert.equal(esm.hasEda(), classic.hasEda());
		});
	}

	it('版本号缓存行为一致：只穿透一次宿主', async () => {
		let versionCalls = 0;
		const eda = {
			sys_Environment: {
				getEditorCurrentVersion: () => {
					versionCalls++;
					return '3.0.12';
				},
			},
		};
		const classic = loadClassic(eda);
		for (let i = 0; i < 50; i++) classic.isModern();
		const classicCalls = versionCalls;

		versionCalls = 0;
		const esm = await loadEsm();
		for (let i = 0; i < 50; i++) esm.isModern();
		assert.equal(classicCalls, 1, '门面应在首次调用后缓存版本号');
		assert.equal(versionCalls, 1, 'core/version 应在首次调用后缓存版本号');
	});

	it('图层判定一致（覆盖边界与异常输入）', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		const cases = [0, 1, 2, 3, 14, 15, 44, 45, 46, 47, 48, 71, 100, 101, 361, '1', '15', 'abc', null, undefined];
		for (const layer of cases) {
			for (const fn of ['isInnerLayer', 'isCopperLayer', 'isConductiveLayer']) {
				assert.deepEqual(esm[fn](layer), classic[fn](layer), `${fn}(${JSON.stringify(layer)}) 不一致`);
			}
		}
	});

	it('escapeHtml 一致（五个字符 + 假值）', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		const cases = ['', null, undefined, 0, false, '<a href="x">A&B\'s</a>', '&amp;', '中文<>', {}];
		for (const v of cases) {
			assert.equal(esm.escapeHtml(v), classic.escapeHtml(v), `escapeHtml(${JSON.stringify(v)}) 不一致`);
		}
	});

	it('toApiLength 一致（含极小值与非法输入）', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		const cases = ['2275.00', 2275, 0, -0, 0.0001, -1, NaN, Infinity, 'abc', null, undefined, '1e3', ' 12.345 '];
		for (const v of cases) {
			assert.deepEqual(esm.toApiLength(v), classic.toApiLength(v), `toApiLength(${JSON.stringify(v)}) 不一致`);
			assert.deepEqual(esm.toApiLength(v, 4), classic.toApiLength(v, 4), `toApiLength(${JSON.stringify(v)},4) 不一致`);
		}
	});

	it('源码行拆分/还原一致，且可逐字节来回', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		const lines = [
			'{"type":"LINE","ticket":1,"id":"e1"}||{"startX":1,"startY":2}|',
			'{"type":"META","ticket":0,"id":"e0"}||{"version":"2.0.0"}',
			'{"type":"LINE"}||{"a":1}||{"b":2}|',
			'{"type":"LINE"}||not-json|',
			'["LINE","e1",[[0,0,1,1]],"st1",0]',
			'',
			'{"type":"X"}||null|',
		];
		for (const line of lines) {
			const c = classic.splitSourceLine(line);
			const e = esm.splitSourceLine(line);
			assert.deepEqual(e, c, `splitSourceLine(${JSON.stringify(line)}) 不一致`);
			if (c) {
				const rebuiltClassic = classic.joinSourceLine(c.leftStr, c.rightStr, c.hasTrailingPipe);
				const rebuiltEsm = esm.joinSourceLine(e.leftStr, e.rightStr, e.hasTrailingPipe);
				assert.equal(rebuiltEsm, rebuiltClassic, 'joinSourceLine 结果不一致');
				assert.equal(rebuiltClassic, line, `拆分再拼装必须逐字节回到原行：${JSON.stringify(line)}`);
			}
		}
		assert.deepEqual(esm.splitSourceLine(123), classic.splitSourceLine(123));
	});

	it('导线源码发射器逐字节一致（V2 与 V3/V4 两种格式）', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		const combos = [
			{ isModern: true, rotation: 0 },
			{ isModern: true, rotation: 90 },
			{ isModern: false, rotation: 0 },
			{ isModern: false, rotation: 45, wireStyle: 'st2', attrStyle: 'st3' },
			{ isModern: true, rotation: NaN },
		];
		for (const combo of combos) {
			const mk = () => {
				let id = 100;
				let ticket = 500;
				return () => ({ id: ++id, ticket: ++ticket });
			};
			const base = { net: 'NET_1', startX: 10, startY: 20, endX: 110, endY: -20, ...combo };
			const c = classic.createSchWireLines({ ...base, nextRow: mk() });
			const e = esm.createSchWireLines({ ...base, nextRow: mk() });
			assert.deepEqual(e, c, `导线源码在 ${JSON.stringify(combo)} 下不一致`);
		}
	});

	it('组件容器获取一致', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		const cases = [null, undefined, {}, { components: { a: 1 } }, { a: 1 }, { components: {} }];
		for (const v of cases) {
			assert.deepEqual(esm.getComponentsContainer(v), classic.getComponentsContainer(v), `getComponentsContainer(${JSON.stringify(v)}) 不一致`);
		}
	});

	it('getNetlist 在 PCB/SCH/AUTO 三种取法下行为一致', async () => {
		const netlist = JSON.stringify({ components: { R1: { props: {} } } });
		const scenarios = [
			{ name: 'PCB 可用', opt: { pcbNetlist: netlist, schNetlist: netlist } },
			{ name: '仅 SCH 可用', opt: { pcbNetlist: undefined, schNetlist: netlist } },
			{ name: '两者都空', opt: { pcbNetlist: undefined, schNetlist: undefined } },
			{ name: '空文件', opt: { pcbNetlist: '   ', schNetlist: netlist } },
			{ name: '非法 JSON', opt: { pcbNetlist: '{oops', schNetlist: netlist } },
		];
		const classic = loadClassic(null);
		const esm = await loadEsm();
		for (const s of scenarios) {
			for (const page of ['AUTO', 'PCB', 'SCH']) {
				// 两套实现都是「每次调用时经 getEda() 动态取宿主」，所以必须各自指定宿主后再调
				globalThis.eda = makeEda(s.opt);
				let cr;
				let cs;
				try {
					cr = await classic.getNetlist(page);
				} catch (err) {
					cs = err.message;
				}
				globalThis.eda = makeEda(s.opt);
				let er;
				let es;
				try {
					er = await esm.getNetlist(page);
				} catch (err) {
					es = err.message;
				}
				assert.deepEqual(er, cr, `${s.name} / ${page}：返回值不一致`);
				assert.equal(es, cs, `${s.name} / ${page}：异常消息不一致`);
			}
		}
	});

	it('setNetlist 在写 PCB 失败时回退 SCH，且写入文本一致', async () => {
		const payload = { components: { R1: {} } };
		const classic = loadClassic(null);
		const esm = await loadEsm();
		for (const opt of [{}, { throwOnPcbWrite: true }]) {
			for (const [page, data] of [
				['AUTO', payload],
				['SCH', JSON.stringify(payload)],
			]) {
				const classicEda = makeEda(opt);
				globalThis.eda = classicEda;
				const classicPage = await classic.setNetlist(page, data);

				const esmEda = makeEda(opt);
				globalThis.eda = esmEda;
				const esmPage = await esm.setNetlist(page, data);

				const label = `${page} / ${opt.throwOnPcbWrite ? 'PCB 写失败' : '正常'}`;
				assert.equal(esmPage, classicPage, `${label}：写回目标不一致`);
				assert.deepEqual(esmEda.calls, classicEda.calls, `${label}：写入调用序列不一致`);
			}
		}
	});

	it('logger 形状一致，且能一键静默', async () => {
		const classic = loadClassic(null);
		const esm = await loadEsm();
		const shape = (l) => Object.keys(l).sort();
		assert.deepEqual(shape(esm.logger), shape(classic.logger), 'logger 成员不一致');
		assert.deepEqual(shape(esm.logger), ['debug', 'error', 'info', 'setLevel', 'warn']);

		const origin = console.log;
		let hits = 0;
		console.log = () => {
			hits++;
		};
		try {
			classic.logger.setLevel('off');
			esm.logger.setLevel('off');
			for (let i = 0; i < 5; i++) {
				classic.logger.debug('x');
				classic.logger.warn('x');
				esm.logger.debug('x');
				esm.logger.warn('x');
			}
		} finally {
			console.log = origin;
		}
		assert.equal(hits, 0, 'setLevel("off") 之后不应有任何输出');
	});
});
