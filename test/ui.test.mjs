/**
 * ui/* 单元测试（B2a 验收锚点）
 *
 * 这些模块是「页面通用件」，B2b 会拿它们替换 15 个页面里各写一遍的实现。
 * 所以这里覆盖的重点不是"能跑"，而是**替换后行为不变**：
 *   - toast 的宿主/降级双通道与级别归一（页面里有 2 和 'success' 两种写法）
 *   - statusBar 的百分比边界（原来 3 处都会算出 NaN% / 180%）
 *   - progressTicker 不越过上限、stop 后不再推进
 *   - table 的排序状态、指示符、全选/半选口径
 *   - poll 的重入锁（宿主慢时请求不叠加）与变化检测（不变不回调）
 *   - download 的分隔符嗅探/引号解析/CSV 转义
 *   - dialogs 的回调式宿主 API 包装
 *   - pageShell 的环境兜底
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/* ------------------------------ 极简 DOM 替身 ------------------------------ */

/**
 * 造一个元素
 *
 * @param {string} tag 标签名
 * @returns {object} 元素替身
 */
function makeEl(tag) {
	return {
		tagName: String(tag).toUpperCase(),
		id: '',
		className: '',
		style: {},
		textContent: '',
		children: [],
		parentNode: null,
		appendChild(node) {
			node.parentNode = this;
			this.children.push(node);
			return node;
		},
		remove() {
			if (!this.parentNode) return;
			this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
			this.parentNode = null;
		},
		click() {
			this.clicked = true;
		},
	};
}

/**
 * 按 id 深度查找
 *
 * @param {object} root 根节点
 * @param {string} id 目标 id
 * @returns {object|null} 命中的元素
 */
function findById(root, id) {
	if (root.id === id) return root;
	for (const child of root.children) {
		const hit = findById(child, id);
		if (hit) return hit;
	}
	return null;
}

/**
 * 造一个文档替身
 *
 * @returns {object} 文档替身
 */
function makeDoc() {
	const body = makeEl('body');
	return {
		body,
		hidden: false,
		createElement: (tag) => makeEl(tag),
		getElementById: (id) => findById(body, id),
	};
}

/**
 * 造可控定时器
 *
 * @returns {{setInterval: Function, clearInterval: Function, tick: Function, active: Function}} 定时器替身
 */
function makeTimers() {
	let cb = null;
	let seq = 0;
	return {
		setInterval(fn) {
			cb = fn;
			return ++seq;
		},
		clearInterval() {
			cb = null;
		},
		tick() {
			if (cb) cb();
		},
		active() {
			return cb !== null;
		},
	};
}

/**
 * 等待若干毫秒
 *
 * @param {number} ms 毫秒
 * @returns {Promise<void>} 定时到达后 resolve
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------ toast ------------------------------ */

describe('ui/toast', () => {
	it('normalizeLevel 兼容数字与多种字符串写法', async () => {
		const { normalizeLevel } = await import('../iframe/js/src/ui/toast.js');
		assert.equal(normalizeLevel(2), 2);
		assert.equal(normalizeLevel('success'), 'success');
		assert.equal(normalizeLevel('WARN'), 'warning');
		assert.equal(normalizeLevel('warning'), 'warning');
		assert.equal(normalizeLevel('error'), 'error');
		assert.equal(normalizeLevel(undefined), 'info');
		assert.equal(normalizeLevel(NaN), 'info');
		assert.equal(normalizeLevel('custom-type'), 'custom-type', '未识别的值应原样透传');
	});

	it('宿主可用时走宿主 toast，不写 DOM', async () => {
		const { toast } = await import('../iframe/js/src/ui/toast.js');
		const calls = [];
		const host = { sys_Message: { showToastMessage: (msg, type) => calls.push([msg, type]) } };
		const doc = makeDoc();
		const channel = toast('已写入', 'success', { host, doc });
		assert.equal(channel, 'host');
		assert.deepEqual(calls, [['已写入', 'success']]);
		assert.equal(doc.body.children.length, 0, '走宿主时不应生成横幅');
	});

	it('宿主抛错时降级为页面横幅，并在超时后移除', async () => {
		const { toast } = await import('../iframe/js/src/ui/toast.js');
		const host = {
			sys_Message: {
				showToastMessage: () => {
					throw new Error('boom');
				},
			},
		};
		const doc = makeDoc();
		const channel = toast('降级了', 2, { host, doc, timeoutMs: 10 });
		assert.equal(channel, 'dom');
		const bar = doc.getElementById('__wolf_notice');
		assert.ok(bar, '应创建 #__wolf_notice');
		assert.equal(bar.textContent, '降级了');
		await sleep(25);
		assert.equal(doc.getElementById('__wolf_notice'), null, '超时后应被移除');
	});

	it('既无宿主也无文档时返回 none', async () => {
		const { toast } = await import('../iframe/js/src/ui/toast.js');
		assert.equal(toast('x', 'info', { host: null, doc: null }), 'none');
	});
});

/* ------------------------------ statusBar ------------------------------ */

describe('ui/statusBar', () => {
	it('percentOf 夹在 0~100（原来会算出 NaN% / 180%）', async () => {
		const { percentOf } = await import('../iframe/js/src/ui/statusBar.js');
		assert.equal(percentOf(3, 10), 30);
		assert.equal(percentOf(0, 10), 0);
		assert.equal(percentOf(10, 10), 100);
		assert.equal(percentOf(99, 10), 100, '超出上限应夹到 100');
		assert.equal(percentOf(-5, 10), 0, '负数应夹到 0');
		assert.equal(percentOf(1, 0), 0, 'total=0 应为 0 而不是 NaN');
		assert.equal(percentOf(NaN, 10), 0);
	});

	it('text / progress / width / reset 写对元素且带语义类', async () => {
		const { createStatusBar } = await import('../iframe/js/src/ui/statusBar.js');
		const textEl = makeEl('span');
		const barEl = makeEl('div');
		const bar = createStatusBar({ textEl, barEl });

		bar.text('读完了', 'success');
		assert.equal(textEl.textContent, '读完了');
		assert.equal(textEl.className, 'status success');

		bar.progress(3, 10, '当前：C1', 'info');
		assert.equal(textEl.textContent, '3 / 10 30%　当前：C1');
		assert.equal(barEl.style.width, '30%');
		assert.equal(barEl.className, 'status-bar info');

		bar.width(55);
		assert.equal(barEl.style.width, '55%');
		assert.equal(barEl.className, 'status-bar accent', '不传级别时保持进行中的强调态');

		bar.reset();
		assert.equal(textEl.textContent, '');
		assert.equal(barEl.style.width, '0%');
	});

	it('元素缺失时不抛错', async () => {
		const { createStatusBar } = await import('../iframe/js/src/ui/statusBar.js');
		const bar = createStatusBar();
		assert.doesNotThrow(() => {
			bar.text('x');
			bar.progress(1, 2);
			bar.width(10);
			bar.reset();
		});
	});
});

/* ------------------------------ progressTicker ------------------------------ */

describe('ui/progressTicker', () => {
	it('advanceProgress 不越过上限', async () => {
		const { advanceProgress } = await import('../iframe/js/src/ui/progressTicker.js');
		assert.equal(advanceProgress(98, { to: 99, step: 1 }), 99);
		assert.equal(advanceProgress(99, { to: 99, step: 1 }), 99, '已到上限应保持不变');
		assert.equal(advanceProgress(10, { to: 99, step: 5 }), 15);
		assert.equal(advanceProgress(10, { to: 99, step: 0 }), 11, '非法步进按 1 处理');
	});

	it('start 推进、stop 后不再推进、重复 start 不叠加', async () => {
		const { createProgressTicker } = await import('../iframe/js/src/ui/progressTicker.js');
		const timers = makeTimers();
		const seen = [];
		const ticker = createProgressTicker({ from: 80, to: 82, step: 1, timers, onTick: (v) => seen.push(v) });

		ticker.start();
		ticker.start();
		assert.equal(ticker.running(), true);
		timers.tick();
		timers.tick();
		assert.deepEqual(seen, [81, 82]);
		timers.tick();
		assert.deepEqual(seen, [81, 82], '到上限后不再变化');

		ticker.stop();
		assert.equal(ticker.running(), false);
		assert.equal(timers.active(), false, 'stop 应清除定时器');
	});
});

/* ------------------------------ table ------------------------------ */

describe('ui/table', () => {
	const rows = [{ d: 'R10' }, { d: 'R2' }, { d: 'R1' }];
	const getter = (row, key) => row[key];

	it('点击同一列反转方向，换列从升序开始', async () => {
		const { nextSortState } = await import('../iframe/js/src/ui/table.js');
		let state = { key: null, asc: true };
		state = nextSortState(state, 'designator');
		assert.deepEqual(state, { key: 'designator', asc: true });
		state = nextSortState(state, 'designator');
		assert.deepEqual(state, { key: 'designator', asc: false });
		state = nextSortState(state, 'name');
		assert.deepEqual(state, { key: 'name', asc: true }, '换列必须是升序，不能沿用上一列的方向');
	});

	it('排序指示符三态', async () => {
		const { sortIndicatorOf, SORT_INDICATOR } = await import('../iframe/js/src/ui/table.js');
		assert.equal(sortIndicatorOf({ key: 'd', asc: true }, 'd'), SORT_INDICATOR.asc);
		assert.equal(sortIndicatorOf({ key: 'd', asc: false }, 'd'), SORT_INDICATOR.desc);
		assert.equal(sortIndicatorOf({ key: 'd', asc: true }, 'x'), '');
		assert.equal(sortIndicatorOf(null, 'd'), '');
	});

	it('sortRows 用位号自然序，且不改入参', async () => {
		const { sortRows } = await import('../iframe/js/src/ui/table.js');
		const asc = sortRows(rows, { key: 'd', asc: true, value: getter });
		assert.deepEqual(
			asc.map((r) => r.d),
			['R1', 'R2', 'R10']
		);
		const desc = sortRows(rows, { key: 'd', asc: false, value: getter });
		assert.deepEqual(
			desc.map((r) => r.d),
			['R10', 'R2', 'R1']
		);
		assert.deepEqual(
			rows.map((r) => r.d),
			['R10', 'R2', 'R1'],
			'原数组不能被改动'
		);
		assert.equal(sortRows(rows, { key: null }).length, 3, '无排序列时返回副本');
	});

	it('selectionSummary 的口径：全选 / 半选 / 全不选 / 空表', async () => {
		const { selectionSummary } = await import('../iframe/js/src/ui/table.js');
		const flags = [true, true];
		assert.deepEqual(selectionSummary(flags.map((f) => ({ f })), (i) => i.f), { count: 2, total: 2, isAll: true, isIndeterminate: false });

		const mixed = [{ f: true }, { f: false }];
		assert.deepEqual(selectionSummary(mixed, (i) => i.f), { count: 1, total: 2, isAll: false, isIndeterminate: true });

		const none = [{ f: false }];
		assert.deepEqual(selectionSummary(none, (i) => i.f), { count: 0, total: 1, isAll: false, isIndeterminate: false });

		assert.deepEqual(selectionSummary([], (i) => i.f), { count: 0, total: 0, isAll: false, isIndeterminate: false });
	});

	it('全选与反选', async () => {
		const { setAllSelected, invertSelected } = await import('../iframe/js/src/ui/table.js');
		const items = [{ f: false }, { f: false }];
		assert.equal(
			setAllSelected(items, (i, v) => (i.f = v), true),
			2
		);
		assert.deepEqual(
			items.map((i) => i.f),
			[true, true]
		);
		assert.equal(
			invertSelected(
				items,
				(i) => i.f,
				(i, v) => (i.f = v)
			),
			0
		);
		assert.deepEqual(
			items.map((i) => i.f),
			[false, false]
		);
	});
});

/* ------------------------------ poll ------------------------------ */

describe('ui/poll', () => {
	it('sameIds 只比 id 集合', async () => {
		const { sameIds } = await import('../iframe/js/src/ui/poll.js');
		assert.equal(sameIds([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]), true);
		assert.equal(sameIds([{ id: 1 }], [{ id: 1 }, { id: 2 }]), false);
		assert.equal(sameIds([], []), true);
		assert.equal(sameIds(null, undefined), true);
		assert.equal(sameIds([{ primitiveId: 'a' }], [{ primitiveId: 'a' }]), true);
	});

	it('宿主慢时不叠加请求（重入锁）', async () => {
		const { createPoll } = await import('../iframe/js/src/ui/poll.js');
		const timers = makeTimers();
		let inFlight = 0;
		let maxInFlight = 0;
		let release = null;
		const poll = createPoll({
			intervalMs: 1,
			timers,
			doc: { hidden: false },
			fetchItems: () => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				return new Promise((resolve) => {
					release = () => {
						inFlight--;
						resolve([]);
					};
				});
			},
			onItems: () => {},
		});
		poll.start();
		const first = poll.tick();
		timers.tick();
		timers.tick();
		assert.equal(maxInFlight, 1, '同一时刻只允许一个在途请求');
		release();
		await first;
		poll.stop();
		assert.equal(poll.running(), false);
	});

	it('结果没变不回调，变了才回调；页面隐藏时跳过', async () => {
		const { createPoll } = await import('../iframe/js/src/ui/poll.js');
		let current = [{ id: 1 }];
		const seen = [];
		const doc = { hidden: false };
		const poll = createPoll({
			fetchItems: async () => current,
			onItems: (items) => seen.push(items),
			doc,
		});

		await poll.tick();
		await poll.tick();
		assert.equal(seen.length, 1, '状态未变不应重复回调');

		current = [{ id: 1 }, { id: 2 }];
		await poll.tick();
		assert.equal(seen.length, 2);

		doc.hidden = true;
		current = [{ id: 3 }];
		await poll.tick();
		assert.equal(seen.length, 2, '页面隐藏时应跳过');

		poll.start();
		poll.stop();
		poll.stop();
		assert.equal(poll.running(), false, 'stop 应幂等');
	});

	it('宿主抛错不中断轮询', async () => {
		const { createPoll } = await import('../iframe/js/src/ui/poll.js');
		const poll = createPoll({
			fetchItems: async () => {
				throw new Error('宿主忙');
			},
			onItems: () => {},
			doc: { hidden: false },
		});
		await assert.doesNotReject(() => poll.tick());
	});
});

/* ------------------------------ download ------------------------------ */

describe('ui/download', () => {
	it('嗅探分隔符：制表符 / 逗号 / 分号', async () => {
		const { sniffDelimiter } = await import('../iframe/js/src/ui/download.js');
		assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
		assert.equal(sniffDelimiter('a,b,c\n1,2,3'), ',');
		assert.equal(sniffDelimiter('a;b;c'), ';');
		assert.equal(sniffDelimiter('单列'), '\t', '无法判断时按制表符');
	});

	it('解析带引号与转义引号的字段，忽略 \r 与末行空行', async () => {
		const { parseDelimited } = await import('../iframe/js/src/ui/download.js');
		assert.deepEqual(parseDelimited('a,b\r\n1,2\r\n'), [
			['a', 'b'],
			['1', '2'],
		]);
		assert.deepEqual(parseDelimited('"a,b",c\n"x""y",z'), [
			['a,b', 'c'],
			['x"y', 'z'],
		]);
		assert.deepEqual(parseDelimited('a\t"b\tc"\n1\t2', { delimiter: '\t' }), [
			['a', 'b\tc'],
			['1', '2'],
		]);
	});

	it('normalizeRows 补齐与截断列数', async () => {
		const { normalizeRows } = await import('../iframe/js/src/ui/download.js');
		assert.deepEqual(normalizeRows([['a']], 3), [['a', '', '']]);
		assert.deepEqual(normalizeRows([['a', 'b', 'c', 'd']], 2), [['a', 'b']]);
		assert.deepEqual(normalizeRows(null, 2), []);
	});

	it('toCsv 转义分隔符、引号与换行', async () => {
		const { toCsv } = await import('../iframe/js/src/ui/download.js');
		assert.equal(toCsv([['a', 'b'], ['1', '2']]), 'a,b\r\n1,2');
		assert.equal(toCsv([['a,b', 'say "hi"']]), '"a,b","say ""hi"""');
		assert.equal(toCsv([['换\n行']]), '"换\n行"');
		assert.equal(toCsv([['a', 'b']], { delimiter: '\t' }), 'a\tb');
	});

	it('downloadText 走 ObjectURL + a.click 并释放 URL', async () => {
		const { downloadText } = await import('../iframe/js/src/ui/download.js');
		const doc = makeDoc();
		const released = [];
		const urlApi = {
			createObjectURL: () => 'blob:fake',
			revokeObjectURL: (href) => released.push(href),
		};
		const ok = downloadText('bom.csv', 'a,b', { doc, urlApi, mime: 'text/csv' });
		assert.equal(ok, true);
		assert.deepEqual(released, ['blob:fake'], '用完必须释放 ObjectURL');
	});

	it('无 document 时安全返回 false', async () => {
		const { downloadText } = await import('../iframe/js/src/ui/download.js');
		assert.equal(downloadText('x.txt', 'y', { doc: null, urlApi: null }), false);
	});
});

/* ------------------------------ dialogs ------------------------------ */

describe('ui/dialogs', () => {
	it('包装回调查询：确认返回 true，取消返回 false', async () => {
		const { confirm } = await import('../iframe/js/src/ui/dialogs.js');
		const calls = [];
		const host = {
			sys_Dialog: {
				showConfirmationMessage: (msg, title, ok, cancel, cb) => {
					calls.push([msg, title, ok, cancel]);
					cb(true);
				},
			},
		};
		assert.equal(await confirm('删掉？', { host, title: '危险', okText: '删除' }), true);
		assert.deepEqual(calls, [['删掉？', '危险', '删除', '取消']]);
	});

	it('用户取消时为 false', async () => {
		const { confirm } = await import('../iframe/js/src/ui/dialogs.js');
		const host = { sys_Dialog: { showConfirmationMessage: (m, t, o, c, cb) => cb(false) } };
		assert.equal(await confirm('删掉？', { host }), false);
	});

	it('宿主不可用且无 confirm 时降级为 false，不挂起', async () => {
		const { confirm } = await import('../iframe/js/src/ui/dialogs.js');
		const origin = globalThis.confirm;
		delete globalThis.confirm;
		try {
			assert.equal(await confirm('x', { host: null }), false);
		} finally {
			if (origin) globalThis.confirm = origin;
		}
	});

	it('宿主抛错时也不挂起', async () => {
		const { confirm } = await import('../iframe/js/src/ui/dialogs.js');
		const host = {
			sys_Dialog: {
				showConfirmationMessage: () => {
					throw new Error('boom');
				},
			},
		};
		const origin = globalThis.confirm;
		delete globalThis.confirm;
		try {
			assert.equal(await confirm('x', { host }), false);
		} finally {
			if (origin) globalThis.confirm = origin;
		}
	});
});

/* ------------------------------ pageShell ------------------------------ */

describe('ui/pageShell', () => {
	it('showFatal 写入固定节点并复用', async () => {
		const { showFatal } = await import('../iframe/js/src/ui/pageShell.js');
		const doc = makeDoc();
		showFatal('第一句', { doc });
		showFatal('第二句', { doc, hint: '补充' });
		const boxes = doc.body.children.filter((c) => c.id === '__wolf_fatal');
		assert.equal(boxes.length, 1, '重复调用应复用同一节点');
		assert.equal(boxes[0].textContent, '第二句\n\n补充');
	});

	it('requireEda 在有宿主时直接返回', async () => {
		const { requireEda } = await import('../iframe/js/src/ui/pageShell.js');
		const fake = { sys_Message: {} };
		globalThis.eda = fake;
		try {
			assert.equal(requireEda(), fake);
		} finally {
			delete globalThis.eda;
		}
	});

	it('requireEda 无宿主时整屏提示并抛出', async () => {
		const { requireEda } = await import('../iframe/js/src/ui/pageShell.js');
		const doc = makeDoc();
		assert.throws(() => requireEda({ doc }), /未检测到 EDA 运行环境/);
		assert.ok(doc.getElementById('__wolf_fatal'), '应显示整屏提示');
	});
});
