/**
 * 前端公共模块测试（iframe/js/common.js）
 *
 * 该文件是浏览器 IIFE（挂在 window.WolfCommon），不是 ESM，所以这里用
 * `new Function('window', code)` 把它放进一个假 window 里执行，再把 `eda`
 * 挂到 globalThis 上模拟宿主环境。
 *
 * 重点守护两件事：
 * 1. 版本号缓存 —— 宿主 API 只能被穿透一次（否则循环里会造成上万次跨 iframe 调用）；
 * 2. escapeHtml —— 五个字符全转义（PcbToSch 旧实现只转了双引号）。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

const COMMON_SOURCE = fs.readFileSync(path.join(process.cwd(), 'iframe', 'js', 'common.js'), 'utf8');

/** 在假 window 里执行 common.js，返回 WolfCommon 实例 */
function loadCommon() {
	const fakeWindow = {};
	// eslint-disable-next-line no-new-func
	new Function('window', COMMON_SOURCE)(fakeWindow);
	return fakeWindow.WolfCommon;
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
