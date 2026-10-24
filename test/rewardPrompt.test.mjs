/**
 * 「感觉不错？」计数与触发测试（mock 全局 eda）
 *
 * 被测模块：iframe/js/src/ui/rewardPrompt.js
 * 守四件事：
 *   1. 每满 10 次弹一次，同一个计数值只弹一次；
 *   2. 「弹过」记在用户配置里 —— 重开 EDA 后同一数值不再重复弹，但下一个 10 次照弹；
 *   3. 存储读/写失败都不抛错、不打断主流程，本次会话的计数照样走；
 *   4. 计数不在这里打日志（模块内没有任何 console / logger 调用，见源码）。
 *
 * 每个用例用 `?case=N` 重新 import 一次模块，绕开模块内的会话缓存
 * （模拟「刚打开 EDA」与「用了几次之后」两种起点）。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

/** 已经用过多少个模块实例（保证每次 import 都是新的） */
let seq = 0;

/**
 * 取一份全新的模块实例（模块级缓存为初始状态）
 *
 * @returns {Promise<object>} rewardPrompt 模块命名空间
 */
function freshModule() {
	seq++;
	return import(`../iframe/js/src/ui/rewardPrompt.js?case=${seq}`);
}

/** 记录被写进 EDA 日志面板的内容（应当始终为空：只打控制台） */
let edaLogCalls = [];

/**
 * 装一个假的 EDA 用户配置
 *
 * @param {object} [initial] 初始配置项
 * @returns {Map<string, string>} 底层存储（断言用）
 */
function mockStorage(initial = {}) {
	const store = new Map(Object.entries(initial));
	edaLogCalls = [];
	globalThis.eda = {
		sys_Log: { add: (...args) => edaLogCalls.push(args) },
		sys_Storage: {
			getExtensionUserConfig: (key) => store.get(key),
			setExtensionUserConfig: async (key, value) => {
				store.set(key, value);
				return true;
			},
		},
	};
	return store;
}

afterEach(() => {
	delete globalThis.eda;
});

describe('shouldPrompt', () => {
	it('只有整 10 次且没弹过才弹', async () => {
		const { shouldPrompt } = await freshModule();
		assert.equal(shouldPrompt(10, 0), true);
		assert.equal(shouldPrompt(20, 10), true);
		assert.equal(shouldPrompt(9, 0), false);
		assert.equal(shouldPrompt(11, 10), false);
		assert.equal(shouldPrompt(0, 0), false);
	});

	it('同一个计数值不重复弹', async () => {
		const { shouldPrompt } = await freshModule();
		assert.equal(shouldPrompt(10, 10), false);
	});
});

describe('recordUsage', () => {
	it('前 9 次不弹，第 10 次弹一次并带上次数', async () => {
		mockStorage();
		const { recordUsage } = await freshModule();
		const opened = [];
		for (let i = 1; i <= 9; i++) await recordUsage((opts) => opened.push(opts));
		assert.equal(opened.length, 0);

		await recordUsage((opts) => opened.push(opts));
		assert.equal(opened.length, 1);
		assert.equal(opened[0].count, 10);
		assert.equal(opened[0].title, '感觉不错？');
	});

	it('第 11~19 次不弹，第 20 次再弹', async () => {
		mockStorage();
		const { recordUsage } = await freshModule();
		const opened = [];
		for (let i = 1; i <= 20; i++) await recordUsage((opts) => opened.push(opts));
		assert.deepEqual(
			opened.map((o) => o.count),
			[10, 20],
		);
	});

	it('计数落盘：返回值与存储一致', async () => {
		const store = mockStorage();
		const { recordUsage } = await freshModule();
		assert.equal(await recordUsage(() => {}), 1);
		assert.equal(store.get('PCB_TO_SCH_USAGE_COUNT'), '1');
		assert.equal(store.get('PCB_TO_SCH_REWARD_PROMPTED'), undefined);
	});

	it('重开 EDA 后同一计数值不重复弹，但下一个 10 次照弹', async () => {
		mockStorage();
		const first = await freshModule();
		const openedAtFirst = [];
		for (let i = 1; i <= 10; i++) await first.recordUsage((opts) => openedAtFirst.push(opts));
		assert.equal(openedAtFirst.length, 1);

		// 新实例 = 重开 EDA：会话缓存清空，只剩存储里的计数
		const second = await freshModule();
		const openedLater = [];
		for (let i = 11; i <= 19; i++) await second.recordUsage((opts) => openedLater.push(opts));
		assert.equal(openedLater.length, 0);
		await second.recordUsage((opts) => openedLater.push(opts));
		assert.deepEqual(
			openedLater.map((o) => o.count),
			[20],
		);
	});

	it('存储里已有 9 次时，下一次（第 10 次）就弹', async () => {
		mockStorage({ PCB_TO_SCH_USAGE_COUNT: '9' });
		const { recordUsage } = await freshModule();
		const opened = [];
		await recordUsage((opts) => opened.push(opts));
		assert.equal(opened.length, 1);
		assert.equal(opened[0].count, 10);
	});

	it('宿主不可用时不抛错，本次会话仍逐个累加', async () => {
		const { recordUsage, getUsageCount } = await freshModule();
		const opened = [];
		assert.equal(await recordUsage((opts) => opened.push(opts)), 1);
		assert.equal(await recordUsage((opts) => opened.push(opts)), 2);
		assert.equal(await getUsageCount(), 2);
		assert.equal(opened.length, 0);
	});

	it('写入抛错也不影响返回值', async () => {
		globalThis.eda = {
			sys_Storage: {
				getExtensionUserConfig: () => null,
				setExtensionUserConfig: async () => {
					throw new Error('存储不可用');
				},
			},
		};
		const { recordUsage } = await freshModule();
		assert.equal(await recordUsage(() => {}), 1);
	});

	it('计数串损坏时按 0 起算', async () => {
		mockStorage({ PCB_TO_SCH_USAGE_COUNT: '不是数字' });
		const { recordUsage } = await freshModule();
		assert.equal(await recordUsage(() => {}), 1);
	});

	it('不传弹窗函数时也不会抛错（默认走真实浮层，无 DOM 环境直接跳过）', async () => {
		mockStorage({ PCB_TO_SCH_USAGE_COUNT: '9' });
		const { recordUsage } = await freshModule();
		assert.equal(await recordUsage(), 10);
	});

	it('连点 5 次就是 +5（并发调用不丢计数）', async () => {
		mockStorage();
		const { recordUsage, getUsageCount } = await freshModule();
		const opened = [];
		const results = await Promise.all([1, 2, 3, 4, 5].map(() => recordUsage((opts) => opened.push(opts))));
		assert.deepEqual(results, [1, 2, 3, 4, 5]);
		assert.equal(await getUsageCount(), 5);
		assert.equal(opened.length, 0);
	});

	it('并发连点跨过第 10 次，只弹一次', async () => {
		mockStorage({ PCB_TO_SCH_USAGE_COUNT: '5' });
		const { recordUsage } = await freshModule();
		const opened = [];
		const results = await Promise.all([1, 2, 3, 4, 5].map(() => recordUsage((opts) => opened.push(opts))));
		assert.deepEqual(results, [6, 7, 8, 9, 10]);
		assert.deepEqual(
			opened.map((o) => o.count),
			[10],
		);
	});

	it('每次点击都把当前次数打到控制台', async () => {
		mockStorage();
		const { recordUsage } = await freshModule();
		const originInfo = console.info;
		const lines = [];
		console.info = (...args) => lines.push(args.join(' '));
		try {
			await recordUsage(() => {});
			await recordUsage(() => {});
		} finally {
			console.info = originInfo;
		}
		assert.ok(
			lines.some((line) => line.includes('累计转换次数：1')),
			`缺第 1 次输出：${lines.join(' | ')}`,
		);
		assert.ok(
			lines.some((line) => line.includes('累计转换次数：2')),
			`缺第 2 次输出：${lines.join(' | ')}`,
		);
	});

	it('不往 EDA 日志面板写东西（只在控制台）', async () => {
		mockStorage();
		const { recordUsage } = await freshModule();
		const originInfo = console.info;
		console.info = () => {};
		try {
			await recordUsage(() => {});
		} finally {
			console.info = originInfo;
		}
		assert.deepEqual(edaLogCalls, []);
	});
});

/**
 * 取一个函数的函数体（按花括号配对截取）
 *
 * 用来确认计数挂在哪几个动作上 —— 挂错位置（例如挂到「加载数据」）从界面上看不出来，
 * 只有数到弹窗时才发觉，所以这里按源码守一道。
 *
 * @param {string} code 源码
 * @param {string} name 函数名
 * @returns {string} 函数体（含两侧花括号）
 */
function functionBody(code, name) {
	const start = code.indexOf(`async function ${name}(`);
	assert.ok(start >= 0, `源码里找不到 async function ${name}`);
	const braceStart = code.indexOf('{', start);
	let depth = 0;
	for (let i = braceStart; i < code.length; i++) {
		if (code[i] === '{') depth++;
		else if (code[i] === '}') {
			depth--;
			if (depth === 0) return code.slice(braceStart, i + 1);
		}
	}
	throw new Error(`${name} 的花括号不配对`);
}

describe('计数触发点（PCB 转原理图页面）', () => {
	const pagePath = path.join(process.cwd(), 'iframe', 'js', 'src', 'app', 'pcb-to-sch', 'index.js');
	const code = fs.readFileSync(pagePath, 'utf8');

	it('挂在「写入文档」成功分支里', () => {
		const body = functionBody(code, 'onWrite');
		assert.ok(body.includes('recordUsage'), 'onWrite 里没有计一次使用');
		// 必须在「写入成功且器件数 > 0」的分支内，不能放在失败分支
		const successBranch = body.slice(body.indexOf('isSuccess && placedCount > 0'), body.indexOf('} else if (isSuccess)'));
		assert.ok(successBranch.includes('recordUsage'), 'recordUsage 不在写入成功分支里');
	});

	it('挂在「导出文件」成功之后', () => {
		const body = functionBody(code, 'onExportProject');
		assert.ok(body.includes('recordUsage'), 'onExportProject 里没有计一次使用');
	});

	it('不挂在「加载数据」上', () => {
		assert.equal(functionBody(code, 'onRefresh').includes('recordUsage'), false, 'onRefresh 不该计数');
	});
});
