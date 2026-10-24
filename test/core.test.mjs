/**
 * 前端平台内核测试（`iframe/js/src/core/*`）
 *
 * 本文件原先测的是 `iframe/js/common.js` 那个 IIFE 门面（B7 已删除）。
 * 门面拆成 ESM 之后，这里改成直接组合 `core/*` 的导出 —— **断言完全不变**，
 * 只是把「在假 window 里执行 IIFE」换成了「拼一个与 WolfCommon 同形的对象」。
 *
 * 重点守护两件事：
 * 1. 版本号缓存 —— 宿主 API 只能被穿透一次（否则循环里会造成上万次跨 iframe 调用）；
 * 2. escapeHtml —— 五个字符全转义（PcbToSch 旧实现只转了双引号）。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as edaMod from '../iframe/js/src/core/eda.js';
import * as versionMod from '../iframe/js/src/core/version.js';
import * as layerMod from '../iframe/js/src/core/layer.js';
import * as netlistMod from '../iframe/js/src/core/netlist.js';
import * as lengthMod from '../iframe/js/src/core/length.js';
import * as sourceLineMod from '../iframe/js/src/core/sourceLine.js';
import * as utilMod from '../iframe/js/src/core/util.js';

/** 把 core/* 拼成一个与旧 `WolfCommon` 同形的对象 */
const CORE = { ...edaMod, ...versionMod, ...layerMod, ...netlistMod, ...lengthMod, ...sourceLineMod, ...utilMod };

/**
 * 取「一份干净的内核」
 *
 * 旧实现每次 `new Function` 都会重新执行 IIFE，天然拿到空缓存；
 * ESM 有模块级缓存，所以这里显式清掉版本号缓存来达到同样的隔离效果。
 *
 * @returns {object} 与 WolfCommon 同形的对象
 * @sideEffects 清空版本号缓存
 */
function loadCommon() {
	versionMod.resetVersionCache();
	return CORE;
}

/** 造一个最小可用的 EDA mock，统计版本查询次数 */
function makeEda(version, options = {}) {
	const state = { versionCalls: 0, pcbNetlistCalls: 0, schNetlistCalls: 0, pcbWriteCalls: 0, schWriteCalls: 0, written: [] };
	globalThis.eda = {
		sys_Environment: {
			getEditorCurrentVersion: () => {
				state.versionCalls++;
				if (options.throwOnVersion) throw new Error('no env');
				return version;
			},
		},
		pcb_ManufactureData: {
			getNetlistFile: async () => {
				state.pcbNetlistCalls++;
				if (options.pcbFails) throw new Error('pcb unavailable');
				return { text: async () => JSON.stringify(options.pcbData ?? { components: { u1: {} } }) };
			},
		},
		sch_ManufactureData: {
			getNetlistFile: async () => {
				state.schNetlistCalls++;
				return { text: async () => JSON.stringify(options.schData ?? { u9: {} }) };
			},
		},
		pcb_Net: {
			setNetlist: async (key, json) => {
				state.pcbWriteCalls++;
				state.written.push({ api: 'pcb', key, json });
				if (options.pcbWriteFails) throw new Error('pcb write fail');
			},
		},
		sch_Netlist: {
			setNetlist: async (key, json) => {
				state.schWriteCalls++;
				state.written.push({ api: 'sch', key, json });
			},
		},
	};
	return state;
}

beforeEach(() => {
	delete globalThis.eda;
});

afterEach(() => {
	delete globalThis.eda;
});

describe('版本判断与缓存', () => {
	it('V3 环境：isV3 为 true，isV2 为 false', () => {
		makeEda('3.0.12');
		const WC = loadCommon();
		assert.equal(WC.getEditorVersion(), '3.0.12');
		assert.equal(WC.isV3(), true);
		assert.equal(WC.isV2(), false);
	});

	it('V2.2 环境：isV2 为 true，isV3 为 false', () => {
		makeEda('2.2.45.1');
		const WC = loadCommon();
		assert.equal(WC.isV2(), true);
		assert.equal(WC.isV3(), false);
	});

	it('版本号只穿透宿主一次（循环内反复调用无额外开销）', () => {
		const state = makeEda('3.1.0');
		const WC = loadCommon();
		for (let i = 0; i < 50; i++) {
			WC.isV3();
			WC.isV2();
			WC.getEditorVersion();
		}
		assert.equal(state.versionCalls, 1, '宿主 getEditorCurrentVersion 应只被调用 1 次');
	});

	it('取不到版本时不缓存空值，环境就绪后能拿到', () => {
		const state = makeEda(null, { throwOnVersion: true });
		const WC = loadCommon();
		assert.equal(WC.getEditorVersion(), '');
		assert.equal(WC.isV3(), false);
		assert.ok(state.versionCalls >= 2, '空结果不应被固化');
	});

	it('无 eda 环境时返回空字符串且不抛错', () => {
		const WC = loadCommon();
		assert.equal(WC.getEditorVersion(), '');
		assert.equal(WC.hasEda(), false);
		assert.equal(WC.isV3(), false);
	});
});

describe('版本族与 V4 兼容（V3→V4 文件格式同构）', () => {
	it('V4：isV4 / isModern 为真，isV3 / isV2 为假', () => {
		makeEda('4.0.3');
		const WC = loadCommon();
		assert.equal(WC.getVersionFamily(), 'V4');
		assert.equal(WC.isV4(), true);
		assert.equal(WC.isModern(), true);
		assert.equal(WC.isV3(), false);
		assert.equal(WC.isV2(), false);
	});

	it('V3：isModern 为真（写源码/选解析器必须按新格式走）', () => {
		makeEda('3.2.1');
		const WC = loadCommon();
		assert.equal(WC.getVersionFamily(), 'V3');
		assert.equal(WC.isModern(), true);
		assert.equal(WC.isV4(), false);
	});

	it('V2.2：isModern 为假，isV2 为真', () => {
		makeEda('2.2.45.1');
		const WC = loadCommon();
		assert.equal(WC.getVersionFamily(), 'V2.2');
		assert.equal(WC.isModern(), false);
		assert.equal(WC.isV2(), true);
	});

	it('取不到版本时版本族为空、所有判断为假', () => {
		const WC = loadCommon();
		assert.equal(WC.getVersionFamily(), '');
		assert.equal(WC.isV4(), false);
		assert.equal(WC.isModern(), false);
	});
});

describe('版本适配区间（2.2.45 ~ 4.*.*）', () => {
	it('2.2.45 ~ 4.*.* 都算可用', () => {
		const WC = loadCommon();
		for (const v of ['2.2.45', '2.2.45.5', '3.0.0', '3.2.1', '4.0.3', '4.1.78', '4.99.99']) {
			assert.equal(WC.classifyVersionSupport(v), 'supported', `${v} 应判为可用`);
		}
	});

	it('低于 2.2.45 → tooOld（建议更新）', () => {
		const WC = loadCommon();
		for (const v of ['1.9.0', '2.0.0', '2.2.1', '2.2.44', '2.2.44.9']) {
			assert.equal(WC.classifyVersionSupport(v), 'tooOld', `${v} 应判为过旧`);
		}
	});

	it('主版本大于 4 → tooNew（暂未适配）', () => {
		const WC = loadCommon();
		for (const v of ['5.0.0', '5.1.2', '10.0.0']) {
			assert.equal(WC.classifyVersionSupport(v), 'tooNew', `${v} 应判为未适配`);
		}
	});

	it('解析不出来的版本 → 不给结论', () => {
		const WC = loadCommon();
		for (const v of ['', 'abc', '4.x', null, undefined]) {
			assert.equal(WC.classifyVersionSupport(v), '', `${String(v)} 不该给结论`);
		}
	});
});

describe('图层常量与判定', () => {
	it('关键图层号与官方定义一致', () => {
		const WC = loadCommon();
		assert.equal(WC.LAYER.TOP, 1);
		assert.equal(WC.LAYER.BOTTOM, 2);
		assert.equal(WC.LAYER.BOARD_OUTLINE, 11);
		assert.equal(WC.LAYER.MULTI, 12);
		assert.equal(WC.LAYER.INNER_1, 15);
		assert.equal(WC.LAYER.HOLE, 47);
	});

	it('isCopperLayer：顶层/底层/内层为真，MULTI 与丝印阻焊为假', () => {
		const WC = loadCommon();
		[1, 2, 15, 20, 44, 46].forEach((l) => assert.equal(WC.isCopperLayer(l), true, `layer ${l}`));
		[3, 5, 12, 13, 14, 47].forEach((l) => assert.equal(WC.isCopperLayer(l), false, `layer ${l}`));
	});

	it('isConductiveLayer：在铜层基础上把 MULTI(12) 也算进来', () => {
		const WC = loadCommon();
		assert.equal(WC.isConductiveLayer(12), true);
		assert.equal(WC.isConductiveLayer(1), true);
		assert.equal(WC.isConductiveLayer(47), false);
	});

	it('isInnerLayer 只认 15~46（顶层底层不算内层）', () => {
		const WC = loadCommon();
		assert.equal(WC.isInnerLayer(15), true);
		assert.equal(WC.isInnerLayer(46), true);
		assert.equal(WC.isInnerLayer(1), false);
		assert.equal(WC.isInnerLayer(14), false);
	});
});

describe('日志行切分/拼装（改写源码的地基）', () => {
	const LINE = '{"type":"ATTR","ticket":7,"id":"e70"}||{"key":"Designator","value":"R1"}|';

	it('带行尾 | 的行能切分并原样拼回', () => {
		const WC = loadCommon();
		const parsed = WC.splitSourceLine(LINE);
		assert.ok(parsed);
		assert.equal(parsed.hasTrailingPipe, true);
		assert.equal(parsed.leftObj.id, 'e70');
		assert.equal(parsed.rightObj.value, 'R1');
		assert.equal(WC.joinSourceLine(parsed.leftStr, parsed.rightStr, parsed.hasTrailingPipe), LINE);
	});

	it('缺少行尾 | 的行（真实样本里存在）也能往返，且不擅自补 |', () => {
		const WC = loadCommon();
		const raw = '{"type":"META","ticket":1,"id":"META"}||{"title":"Board2","zIndex":1}';
		const parsed = WC.splitSourceLine(raw);
		assert.ok(parsed);
		assert.equal(parsed.hasTrailingPipe, false);
		assert.equal(WC.joinSourceLine(parsed.leftStr, parsed.rightStr, parsed.hasTrailingPipe), raw);
		assert.ok(!WC.joinSourceLine(parsed.leftStr, parsed.rightStr, false).endsWith('|'));
	});

	it('改写内层后外层文本保持原样（不重新序列化）', () => {
		const WC = loadCommon();
		const parsed = WC.splitSourceLine(LINE);
		parsed.rightObj.value = 'R2';
		const next = WC.joinSourceLine(parsed.leftStr, JSON.stringify(parsed.rightObj), parsed.hasTrailingPipe);
		assert.ok(next.startsWith('{"type":"ATTR","ticket":7,"id":"e70"}||'));
		assert.ok(next.includes('"value":"R2"'));
		assert.ok(next.endsWith('|'));
	});

	it('非法行返回 null（调用方应保留原行）', () => {
		const WC = loadCommon();
		['', 'no separator', '{"a":1}||{bad json}|', '{"a":1}||{"b":2}||{"c":3}|'].forEach((bad) => {
			assert.equal(WC.splitSourceLine(bad), null, `应判为非法: ${bad}`);
		});
	});
});

describe('getComponentsContainer', () => {
	it('V3：取 components 容器', () => {
		const WC = loadCommon();
		const components = { u1: { props: {} } };
		assert.equal(WC.getComponentsContainer({ components }), components);
	});

	it('V2：直接返回根对象', () => {
		const WC = loadCommon();
		const root = { u1: { props: {} } };
		assert.equal(WC.getComponentsContainer(root), root);
	});

	it('null/undefined 返回空对象（不抛错）', () => {
		const WC = loadCommon();
		assert.deepEqual(WC.getComponentsContainer(null), {});
		assert.deepEqual(WC.getComponentsContainer(undefined), {});
	});
});

describe('escapeHtml', () => {
	it('五个字符全部转义', () => {
		const WC = loadCommon();
		assert.equal(WC.escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;');
	});

	it('null/undefined/数字按空或字符串处理', () => {
		const WC = loadCommon();
		assert.equal(WC.escapeHtml(null), '');
		assert.equal(WC.escapeHtml(undefined), '');
		assert.equal(WC.escapeHtml(0), '0');
	});

	it('不含特殊字符时原样返回（保证界面文案零变化）', () => {
		const WC = loadCommon();
		assert.equal(WC.escapeHtml('R1 10k 0603'), 'R1 10k 0603');
		assert.equal(WC.escapeHtml('U1'), 'U1');
	});
});

describe('getNetlist / setNetlist', () => {
	it('AUTO：PCB 可用时取 PCB', async () => {
		const state = makeEda('3.0.0', { pcbData: { components: { u1: {} } } });
		const WC = loadCommon();
		const res = await WC.getNetlist('AUTO');
		assert.equal(res.page, 'PCB');
		assert.deepEqual(res.json, { components: { u1: {} } });
		assert.equal(state.pcbNetlistCalls, 1);
		assert.equal(state.schNetlistCalls, 0);
	});

	it('AUTO：PCB 失败时回退 SCH', async () => {
		makeEda('2.2.45', { pcbFails: true, schData: { u9: {} } });
		const WC = loadCommon();
		const res = await WC.getNetlist('AUTO');
		assert.equal(res.page, 'SCH');
		assert.deepEqual(res.json, { u9: {} });
	});

	it('page=PCB 时不回退 SCH（异常向上抛）', async () => {
		makeEda('3.0.0', { pcbFails: true });
		const WC = loadCommon();
		await assert.rejects(() => WC.getNetlist('PCB'));
	});

	it('setNetlist：PCB 走 pcb_Net，SCH 走 sch_Netlist，键名恒为 JLCEDA', async () => {
		const state = makeEda('3.0.0');
		const WC = loadCommon();
		await WC.setNetlist('PCB', '{"a":1}');
		await WC.setNetlist('SCH', { a: 1 });
		assert.deepEqual(state.written, [
			{ api: 'pcb', key: 'JLCEDA', json: '{"a":1}' },
			{ api: 'sch', key: 'JLCEDA', json: '{"a":1}' },
		]);
	});

	it('setNetlist：AUTO 下 PCB 写入失败时回退 SCH', async () => {
		const state = makeEda('3.0.0', { pcbWriteFails: true });
		const WC = loadCommon();
		const page = await WC.setNetlist('AUTO', '{}');
		assert.equal(page, 'SCH');
		assert.equal(state.schWriteCalls, 1);
	});
});

// ---------------------------------------------------------------------------
// 网表读取的空值语义（v1.17.9）
// ---------------------------------------------------------------------------

describe('getNetlist - 空网表要给人话', () => {
	it('文件返回 undefined（当前文档没有网表）→ 抛「获取的网表为空」', async () => {
		globalThis.eda = {
			pcb_ManufactureData: { getNetlistFile: async () => undefined },
			sch_ManufactureData: { getNetlistFile: async () => undefined },
		};
		const WC = loadCommon();
		await assert.rejects(() => WC.getNetlist('PCB'), /获取的网表为空/);
		// AUTO 两个来源都空时同样是这句，而不是 TypeError
		await assert.rejects(() => WC.getNetlist('AUTO'), /获取的网表为空/);
	});

	it('文件内容为空串 / 纯空白 → 抛「获取的网表为空」', async () => {
		for (const text of ['', '   \n  ']) {
			globalThis.eda = {
				pcb_ManufactureData: { getNetlistFile: async () => ({ text: async () => text }) },
				sch_ManufactureData: { getNetlistFile: async () => ({ text: async () => text }) },
			};
			const WC = loadCommon();
			await assert.rejects(() => WC.getNetlist('PCB'), /获取的网表为空/);
		}
	});

	it('JSON 非法 → 抛出带来源的解析错误，而不是裸 SyntaxError', async () => {
		globalThis.eda = {
			pcb_ManufactureData: { getNetlistFile: async () => ({ text: async () => 'not-json' }) },
		};
		const WC = loadCommon();
		await assert.rejects(() => WC.getNetlist('PCB'), /网表格式无法解析（PCB）/);
	});

	it('AUTO 下 PCB 为空会回退 SCH，正常返回', async () => {
		globalThis.eda = {
			pcb_ManufactureData: { getNetlistFile: async () => undefined },
			sch_ManufactureData: { getNetlistFile: async () => ({ text: async () => '{"u9":{}}' }) },
		};
		const WC = loadCommon();
		const res = await WC.getNetlist('AUTO');
		assert.equal(res.page, 'SCH');
		assert.deepEqual(res.json, { u9: {} });
	});
});

describe('toApiLength - 传给 EDA API 的长度必须是 number', () => {
	const WC = loadCommon();

	it('toFixed 出来的字符串必须转回 number（V4 判字符串非法，报「必须为正数」）', () => {
		const value = WC.toApiLength('2275.00');
		assert.equal(typeof value, 'number');
		assert.equal(value, 2275);
	});

	it('按位数四舍五入，结果不带浮点尾巴', () => {
		assert.equal(WC.toApiLength(12.3456), 12.35);
		assert.equal(WC.toApiLength(2.0000000001), 2);
		assert.equal(WC.toApiLength(1.23456, 4), 1.2346);
	});

	it('极小非零值不会被舍成 0（0 同样会被判为"非正数"）', () => {
		assert.equal(WC.toApiLength(0.001), 0.001);
		assert.equal(WC.toApiLength(0), 0);
	});

	it('无法解析为有限数时返回 NaN，交给调用方校验', () => {
		assert.ok(Number.isNaN(WC.toApiLength('abc')));
		assert.ok(Number.isNaN(WC.toApiLength(undefined)));
		assert.ok(Number.isNaN(WC.toApiLength(Infinity)));
	});
});
