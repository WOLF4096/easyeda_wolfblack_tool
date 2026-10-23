/**
 * 「工时统计」备份链路测试：紧凑化 → 压缩 → 签名 → 校验 → 合并
 *
 * 守的是什么：导出的备份必须**能无损还原**（否则换电脑就等于丢数据），
 * 且导入时必须能判断「是不是你的、有没有被改过」——这两件事都只在真实数据上跑才靠得住，
 * 所以这里用 `buildDataset` 造数据、用 `node:zlib` 顶替浏览器的 fflate，把整条链路走通。
 *
 * 覆盖：
 *   1. 紧凑结构真的去重（uuid 字典、空槽不导出、派生字段不写）
 *   2. 还原后与导出前逐格一致（含只有空闲时间的槽）
 *   3. 压缩后明显小于旧版明文（同一份数据对比）
 *   4. 正常往返 / 改数据后签名失败 / 别人账号被拒 / 旧版明文被拒 / 版本被拒
 *   5. 合并只补不覆盖、重复导入幂等、一格 900 秒上限
 *   6. 个人面板的累计工时求和
 *   7. 导入流程（宿主用替身）：正常文件弹一次确认并落盘、别人的文件不落盘、重复导入不再确认
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';

import { buildDataset } from '../iframe/js/src/app/working-hours/aggregate.js';
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackupBody, expandBackupBody } from '../iframe/js/src/app/working-hours/backupFormat.js';
import { base64ToBytes, bytesToBase64 } from '../iframe/js/src/app/working-hours/backupCrypto.js';
import { packBackup, unpackBackup } from '../iframe/js/src/app/working-hours/backupCodec.js';
import { planMerge } from '../iframe/js/src/app/working-hours/backupMerge.js';
import { sumWorkSeconds } from '../iframe/js/src/app/working-hours/views/profilePanel.js';

/** 注入给编解码器的压缩实现（浏览器里是 fflate，这里是 zlib） */
const ZIP = { gzip: (bytes) => zlib.gzipSync(bytes), gunzip: (bytes) => zlib.gunzipSync(bytes) };

/** 测试用当前账号 */
const USER = {
	username: 'darksteel',
	nickname: '狼黑',
	avatar: '//image.lceda.cn/avatars/demo.webp',
	uuid: 'c9587c631b53481a997b8c95d02dc891',
	customerCode: '354055A',
};

const P1 = '8d7803f4a61d408997f873925b3d0698';
const P2 = '250093eb0d88434e9bfeb43230c920a2';

/**
 * 造一天配置（存储里的值）
 *
 * @param {object} slots `{ 槽位: { uuid: [工作, 空闲] } }`
 * @param {object} [meta] 工程名表
 * @returns {string} 序列化后的配置值
 * @sideEffects 无（纯函数）
 */
function dayConfig(slots, meta = { [P1]: '测试_260618' }) {
	return JSON.stringify({ meta: meta, slots: slots });
}

/**
 * 造一份聚合数据集（走真实的 aggregate 流程，避免手工拼 timeline）
 *
 * @param {Record<string, string>} configs 扩展配置
 * @returns {object} 数据集
 * @sideEffects 无（纯函数）
 */
function datasetOf(configs) {
	return buildDataset(configs, { currentUuid: null, currentName: '未命名工程', now: new Date(2026, 9, 5) });
}

/** 三天、含只有空闲时间的槽、含跨工程 */
const CONFIGS = {
	STATS_2026_10_01: dayConfig({
		0: { [P1]: [900, 0] },
		1: { [P1]: [600, 300] },
		40: { [P2]: [0, 450] },
	}),
	STATS_2026_10_02: dayConfig(
		{
			95: { [P1]: [120, 780] },
			12: { [P2]: [900, 0] },
		},
		{ [P1]: '测试_260618', [P2]: '测试1' }
	),
	STATS_2026_10_03: dayConfig({}),
};

/**
 * 把数据体重新压缩成 payload（用于伪造「只改数据不改签名」的文件）
 *
 * @param {object} body 数据体
 * @returns {string} Base64 载荷
 * @sideEffects 无
 */
function encodeBody(body) {
	return bytesToBase64(ZIP.gzip(new TextEncoder().encode(JSON.stringify(body))));
}

/**
 * 解出信封里的数据体
 *
 * @param {object} envelope 信封
 * @returns {object} 数据体
 * @sideEffects 无
 */
function decodeBody(envelope) {
	return JSON.parse(zlib.gunzipSync(base64ToBytes(envelope.payload)).toString('utf8'));
}

describe('工时备份：紧凑结构（去重）', () => {
	const data = datasetOf(CONFIGS);
	const body = buildBackupBody({ data: data, user: USER, exportedAt: 1792000000000 });

	it('数据体只有约定的六个字段，派生数据（stats/timeline）一律不写', () => {
		assert.deepEqual(Object.keys(body).sort(), ['d', 'f', 'p', 't', 'u', 'v']);
		assert.equal(body.f, BACKUP_FORMAT);
		assert.equal(body.v, BACKUP_VERSION);
	});

	it('工程 uuid 只登记一次（字典），槽位里只存下标', () => {
		assert.equal(body.p.length, 2);
		assert.deepEqual(
			body.p.map((item) => item[0]),
			[P1, P2]
		);
		const firstDay = body.d.find((entry) => entry[0] === '2026_10_01');
		assert.deepEqual(firstDay[1][0], [0, [[0, 900, 0]]]);
	});

	it('空槽与空天不导出', () => {
		const days = body.d.map((entry) => entry[0]);
		assert.deepEqual(days, ['2026_10_01', '2026_10_02']);
		const second = body.d.find((entry) => entry[0] === '2026_10_02');
		assert.equal(second[1].length, 2);
	});

	it('用户信息随数据体一起走（昵称、uuid、客户编号）', () => {
		assert.equal(body.u.username, 'darksteel');
		assert.equal(body.u.uuid, USER.uuid);
		assert.equal(body.u.customerCode, '354055A');
	});
});

describe('工时备份：无损还原', () => {
	const data = datasetOf(CONFIGS);
	const body = buildBackupBody({ data: data, user: USER, exportedAt: 1792000000000 });
	const restored = expandBackupBody(body);

	it('每一天的槽位与导出前逐格一致（含只有空闲时间的槽）', () => {
		const byDay = Object.fromEntries(restored.days.map((day) => [day.dateKey, day.slots]));
		assert.deepEqual(byDay['2026_10_01'], {
			0: { [P1]: [900, 0] },
			1: { [P1]: [600, 300] },
			40: { [P2]: [0, 450] },
		});
		assert.deepEqual(byDay['2026_10_02'], {
			12: { [P2]: [900, 0] },
			95: { [P1]: [120, 780] },
		});
	});

	it('每天带自己的工程名，工程名不丢', () => {
		const second = restored.days.find((day) => day.dateKey === '2026_10_02');
		assert.deepEqual(second.meta, { [P1]: '测试_260618', [P2]: '测试1' });
	});

	it('还原后的汇总与聚合层算出来的一致', () => {
		const totalWork = Object.values(data.projectStats).reduce((sum, item) => sum + item.totalWork, 0);
		assert.equal(restored.stats.workSeconds, totalWork);
		assert.equal(restored.stats.days, 2);
		assert.equal(restored.stats.projects, 2);
	});

	it('同一份数据体再走一遍还原仍然一致（幂等）', () => {
		const again = expandBackupBody(buildBackupBody({ data: data, user: USER, exportedAt: 1792000000000 }));
		assert.deepEqual(again.days, restored.days);
	});
});

describe('工时备份：压缩率', () => {
	it('压出来的文件明显小于旧版明文导出（同一个月的数据）', async () => {
		const configs = {};
		// 30 天 × 每天 40 个有数据的槽，模拟真实使用一个月
		for (let d = 1; d <= 30; d++) {
			const slots = {};
			for (let s = 20; s < 60; s++) slots[s] = { [P1]: [900, 0] };
			slots[12] = { [P2]: [300, 600] };
			configs[`STATS_2026_09_${String(d).padStart(2, '0')}`] = dayConfig(slots, { [P1]: '测试_260618', [P2]: '测试1' });
		}
		const data = datasetOf(configs);
		const envelope = await packBackup({ data: data, user: USER, exportedAt: 1792000000000, zip: ZIP });

		const legacy = JSON.stringify({
			exportTime: new Date(1792000000000).toLocaleString(),
			projectMeta: data.projectMeta,
			stats: data.projectStats,
			timeline: data.timeline.filter((slot) => Object.keys(slot.work).length > 0 || Object.keys(slot.rest).length > 0),
		});
		const packed = JSON.stringify(envelope);

		assert.ok(packed.length < legacy.length / 4, `应压到旧版 1/4 以下：旧 ${legacy.length} → 新 ${packed.length}`);
	});
});

describe('工时备份：打包与校验', () => {
	/**
	 * 造一个正常的备份信封
	 *
	 * @param {object} [user] 导出者
	 * @returns {Promise<object>} 信封
	 * @sideEffects 无
	 */
	async function makeEnvelope(user = USER) {
		return packBackup({ data: datasetOf(CONFIGS), user: user, exportedAt: 1792000000000, zip: ZIP });
	}

	it('本账号导出的备份能正常导入，并给出规模摘要', async () => {
		const envelope = await makeEnvelope();
		const backup = await unpackBackup({ envelope: envelope, currentUser: USER, zip: ZIP });

		assert.equal(backup.user.uuid, USER.uuid);
		assert.equal(backup.exportedAt, 1792000000000);
		assert.equal(backup.days.length, 2);
		assert.equal(backup.stats.slots, 5);
	});

	it('改了数据体里的数字（签名没变）→ 拒绝导入', async () => {
		const envelope = await makeEnvelope();
		const body = decodeBody(envelope);
		body.d[0][1][0][1][0][1] = 899; // 把 900 秒改成 899

		const forged = { ...envelope, payload: encodeBody(body) };
		await assert.rejects(() => unpackBackup({ envelope: forged, currentUser: USER, zip: ZIP }), /签名校验失败/);
	});

	it('只改信封上的用户信息 → 拒绝导入', async () => {
		const envelope = await makeEnvelope();
		const forged = { ...envelope, user: { ...envelope.user, nickname: '冒充者' } };
		forged.user.username = 'someone-else';
		await assert.rejects(() => unpackBackup({ envelope: forged, currentUser: USER, zip: ZIP }), /文件头与数据内容不一致/);
	});

	it('别人的备份 → 明确拒绝，不落到签名环节', async () => {
		const other = { ...USER, username: 'other-user', uuid: 'ffffffffffffffffffffffffffffffff' };
		const envelope = await makeEnvelope(other);
		await assert.rejects(() => unpackBackup({ envelope: envelope, currentUser: USER, zip: ZIP }), /不能导入别人的数据/);
	});

	it('同一账号改过用户名 → 旧备份仍能导入（密钥里的 uuid 没变）', async () => {
		const envelope = await makeEnvelope({ ...USER, username: 'darksteel_old' });
		const backup = await unpackBackup({ envelope: envelope, currentUser: { ...USER, username: 'darksteel_new' }, zip: ZIP });
		assert.equal(backup.days.length, 2);
	});

	it('旧版明文备份（没有用户信息）→ 提示重新导出', async () => {
		const legacy = { exportTime: '2026/10/23 11:36:43', projectMeta: {}, stats: {}, timeline: [] };
		await assert.rejects(() => unpackBackup({ envelope: legacy, currentUser: USER, zip: ZIP }), /旧版备份/);
	});

	it('版本号被改 / 载荷损坏 → 给出可读错误', async () => {
		const envelope = await makeEnvelope();
		await assert.rejects(() => unpackBackup({ envelope: { ...envelope, version: 3 }, currentUser: USER, zip: ZIP }), /版本不支持/);
		await assert.rejects(() => unpackBackup({ envelope: { ...envelope, payload: 'bm90LWd6aXA=' }, currentUser: USER, zip: ZIP }), /解压失败/);
	});

	it('没有当前账号信息时不允许导出（否则文件没人能导入）', async () => {
		await assert.rejects(() => packBackup({ data: datasetOf(CONFIGS), user: {}, zip: ZIP }), /未获取到当前账号信息/);
	});
});

describe('工时备份：合并到本地', () => {
	const incoming = [
		{
			dateKey: '2026_10_01',
			meta: { [P1]: '备份里的名字' },
			slots: { 0: { [P1]: [600, 0] }, 1: { [P1]: [600, 300] } },
		},
	];

	it('只补不覆盖：本地更大的记录原样保留，工程名也不覆盖', () => {
		const local = { STATS_2026_10_01: dayConfig({ 0: { [P1]: [900, 0] } }) };
		const plan = planMerge(local, incoming);

		assert.equal(plan.updates.length, 1);
		const merged = plan.updates[0].dayData;
		assert.deepEqual(merged.slots['0'][P1], [900, 0]);
		assert.deepEqual(merged.slots['1'][P1], [600, 300]);
		assert.equal(merged.meta[P1], '测试_260618');
		assert.equal(plan.stats.slots, 1);
		assert.equal(plan.stats.workSeconds, 600);
	});

	it('新的一天会整天空建成对应键', () => {
		const plan = planMerge({}, incoming);
		assert.equal(plan.updates[0].key, 'STATS_2026_10_01');
		assert.deepEqual(plan.updates[0].dayData.slots['1'][P1], [600, 300]);
	});

	it('同一份备份导入两次，第二次没有任何改动（幂等）', () => {
		const first = planMerge({}, incoming);
		const stored = { [first.updates[0].key]: JSON.stringify(first.updates[0].dayData) };
		const second = planMerge(stored, incoming);

		assert.equal(second.updates.length, 0);
		assert.equal(second.stats.slots, 0);
	});

	it('工程名为空串时也保持幂等（不能被当成「还没登记」反复写）', () => {
		const unnamed = [{ dateKey: '2026_10_06', meta: { [P1]: '' }, slots: { 5: { [P1]: [60, 0] } } }];
		const first = planMerge({}, unnamed);
		const stored = { [first.updates[0].key]: JSON.stringify(first.updates[0].dayData) };
		assert.equal(planMerge(stored, unnamed).updates.length, 0);
	});

	it('一格不超过 900 秒：工作满了空闲让位', () => {
		const plan = planMerge({}, [
			{ dateKey: '2026_10_04', meta: { [P1]: '测试' }, slots: { 3: { [P1]: [900, 500] } } },
			{ dateKey: '2026_10_05', meta: { [P1]: '测试' }, slots: { 3: { [P1]: [600, 600] } } },
		]);

		assert.deepEqual(plan.updates[0].dayData.slots['3'][P1], [900, 0]);
		assert.deepEqual(plan.updates[1].dayData.slots['3'][P1], [600, 300]);
	});

	it('本地存储是坏 JSON 时当作空天处理，不抛错', () => {
		const plan = planMerge({ STATS_2026_10_01: '{坏数据' }, incoming);
		assert.equal(plan.updates.length, 1);
		assert.deepEqual(plan.updates[0].dayData.slots['0'][P1], [600, 0]);
	});
});

describe('个人信息面板：累计工时', () => {
	it('把所有工程的工作时间加起来，坏值当 0', () => {
		assert.equal(sumWorkSeconds({ a: { totalWork: 3600 }, b: { totalWork: 1800 } }), 5400);
		assert.equal(sumWorkSeconds({ a: { totalWork: 100 }, b: {}, c: { totalWork: 'x' } }), 100);
		assert.equal(sumWorkSeconds(null), 0);
	});
});

describe('个人信息面板：DOM 写入', () => {
	/** 面板会用到的元素 id */
	const IDS = ['profile-avatar-img', 'profile-avatar-fallback', 'profile-name', 'profile-sub', 'profile-total', 'profile-projects'];

	/**
	 * 造一个极简 document（只实现面板用到的几个 API）
	 *
	 * @returns {{getElementById: (id: string) => object|null, els: Map<string, object>}} 替身
	 * @sideEffects 无
	 */
	function makeDoc() {
		const els = new Map();
		const of = (id) => {
			if (els.has(id)) return els.get(id);
			const classes = new Set();
			const node = {
				id: id,
				textContent: '',
				attrs: {},
				classList: {
					add: (c) => classes.add(c),
					remove: (c) => classes.delete(c),
					contains: (c) => classes.has(c),
				},
				addEventListener: () => undefined,
				getAttribute: (k) => (k in node.attrs ? node.attrs[k] : null),
				setAttribute: (k, v) => {
					node.attrs[k] = v;
				},
			};
			els.set(id, node);
			return node;
		};
		return { els: els, getElementById: (id) => (IDS.includes(id) ? of(id) : null) };
	}

	it('先画文字与占位字，进入面板后才放行头像请求', async () => {
		const { createProfilePanel } = await import('../iframe/js/src/app/working-hours/views/profilePanel.js');
		const doc = makeDoc();
		globalThis.document = doc;
		try {
			const panel = createProfilePanel({
				data: { projectStats: { [P1]: { totalWork: 3725 }, [P2]: { totalWork: 900 } } },
				getUser: () => USER,
			});

			panel.render();
			assert.equal(doc.els.get('profile-name').textContent, '狼黑');
			assert.equal(doc.els.get('profile-sub').textContent, '@darksteel · 客户编号 354055A');
			assert.equal(doc.els.get('profile-total').textContent, '1时17分');
			assert.equal(doc.els.get('profile-projects').textContent, '2 个工程');
			assert.equal(doc.els.get('profile-avatar-img').getAttribute('src'), null, '未进面板不应发起头像请求');
			assert.ok(doc.els.get('profile-avatar-fallback').classList.contains('hidden') === false);

			panel.showAvatar();
			assert.equal(doc.els.get('profile-avatar-img').getAttribute('src'), 'https://image.lceda.cn/avatars/demo.webp');
		} finally {
			delete globalThis.document;
		}
	});
});

describe('导入流程（宿主用替身）', () => {
	/**
	 * 造一个最小宿主：内存存储 + 自动确认的对话框
	 *
	 * @param {Record<string, string>} [initial] 初始存储
	 * @returns {{host: object, storage: Map<string,string>, dialogs: string[], pending: Promise[]}} 替身
	 * @sideEffects 无
	 */
	function makeHost(initial = {}) {
		const storage = new Map(Object.entries(initial));
		const dialogs = [];
		const pending = [];
		const host = {
			sys_Storage: {
				getExtensionAllUserConfigs: async () => Object.fromEntries(storage),
				setExtensionUserConfig: async (key, value) => {
					storage.set(key, value);
					return true;
				},
			},
			sys_Dialog: {
				showConfirmationMessage: (text, title, okText, cancelText, callback) => {
					dialogs.push(text);
					pending.push(callback(true));
				},
			},
			sys_Message: { showToastMessage: () => undefined },
		};
		return { host: host, storage: storage, dialogs: dialogs, pending: pending };
	}

	/**
	 * 在替身环境里跑一段逻辑，结束后清理全局
	 *
	 * @param {object} host 宿主替身
	 * @param {() => Promise<void>} fn 逻辑
	 * @returns {Promise<void>} 无
	 * @sideEffects 改写 globalThis.eda / window / document
	 */
	async function withHost(host, fn) {
		globalThis.eda = host;
		globalThis.window = { eda: host };
		globalThis.document = { getElementById: () => null };
		try {
			await fn();
		} finally {
			delete globalThis.eda;
			delete globalThis.window;
			delete globalThis.document;
		}
	}

	/**
	 * 把信封包成「文件」
	 *
	 * @param {object} envelope 信封
	 * @returns {object} File 替身
	 * @sideEffects 无
	 */
	function fileOf(envelope) {
		const text = JSON.stringify(envelope);
		return { size: text.length, text: async () => text };
	}

	it('正常文件：弹一次确认 → 写入 STATS_* → 触发重载', async () => {
		const envelope = await packBackup({ data: datasetOf(CONFIGS), user: USER, exportedAt: 1792000000000, zip: ZIP });
		const fake = makeHost();
		let reloads = 0;

		await withHost(fake.host, async () => {
			const { createDataImport } = await import('../iframe/js/src/app/working-hours/views/dataImport.js');
			const importer = createDataImport({ getUser: () => USER, zip: ZIP, hooks: { reloadData: async () => (reloads += 1) } });

			await importer.onFileChange({ target: { files: [fileOf(envelope)], value: 'x' } });
			await Promise.all(fake.pending);
		});

		assert.equal(fake.dialogs.length, 1, '应弹一次确认');
		assert.match(fake.dialogs[0], /狼黑/);
		assert.ok(fake.storage.has('STATS_2026_10_01'), '应写入第一天的配置');
		assert.equal(reloads, 1, '导入后应重载数据');
	});

	it('别人的文件：不弹确认、不写任何数据', async () => {
		const other = { ...USER, username: 'other-user', uuid: 'ffffffffffffffffffffffffffffffff' };
		const envelope = await packBackup({ data: datasetOf(CONFIGS), user: other, exportedAt: 1792000000000, zip: ZIP });
		const fake = makeHost();

		await withHost(fake.host, async () => {
			const { createDataImport } = await import('../iframe/js/src/app/working-hours/views/dataImport.js');
			const importer = createDataImport({ getUser: () => USER, zip: ZIP, hooks: { reloadData: async () => undefined } });
			await importer.onFileChange({ target: { files: [fileOf(envelope)], value: 'x' } });
		});

		assert.equal(fake.dialogs.length, 0);
		assert.equal(fake.storage.size, 0);
	});

	it('同一份文件导入两次：第二次不再弹确认', async () => {
		const envelope = await packBackup({ data: datasetOf(CONFIGS), user: USER, exportedAt: 1792000000000, zip: ZIP });
		const fake = makeHost();

		await withHost(fake.host, async () => {
			const { createDataImport } = await import('../iframe/js/src/app/working-hours/views/dataImport.js');
			const importer = createDataImport({ getUser: () => USER, zip: ZIP, hooks: { reloadData: async () => undefined } });

			await importer.onFileChange({ target: { files: [fileOf(envelope)], value: 'x' } });
			await Promise.all(fake.pending);
			await importer.onFileChange({ target: { files: [fileOf(envelope)], value: 'x' } });
			await Promise.all(fake.pending);
		});

		assert.equal(fake.dialogs.length, 1, '第二次应判定「无需导入」');
	});
});
