/**
 * 网表缓存读写测试（mock 全局 eda）
 *
 * 被测模块：src/js/autoWire/netlistCache.js
 * 守四件事：
 *   1. 正文原样往返（不套 JSON 外层，大文本才不会被二次转义）；
 *   2. 元信息损坏时正文仍可读（元信息只是提示，不能连累缓存本身）；
 *   3. 两个来源共用一个键 —— 后写的直接覆盖前一份；
 *   4. 老版本没有 `deleteExtensionUserConfig` 时，「清空」仍能生效（退化为写空串）。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
	CACHE_KEY,
	META_KEY,
	clearNetlistCache,
	describeCacheMeta,
	loadNetlistCache,
	saveNetlistCache,
} from '../src/js/autoWire/netlistCache.js';

/** 一个极简的「用户配置」 */
let storage;
let originWarn;

beforeEach(() => {
	storage = new Map();
	originWarn = console.warn;
	console.warn = () => {};
	globalThis.eda = {
		sys_Storage: {
			getExtensionUserConfig: (key) => storage.get(key),
			setExtensionUserConfig: async (key, value) => {
				storage.set(key, value);
				return true;
			},
			deleteExtensionUserConfig: async (key) => storage.delete(key),
		},
	};
});

afterEach(() => {
	console.warn = originWarn;
	delete globalThis.eda;
});

describe('网表缓存读写', () => {
	it('写入后能原样读回正文与来源', async () => {
		const text = '{"components":{"u1":{"props":{}}}}';
		const { ok, meta } = await saveNetlistCache(text, { source: 'PCB', sourceLabel: 'PCB' });
		assert.equal(ok, true);
		assert.equal(meta.bytes, text.length);

		const cached = await loadNetlistCache();
		assert.equal(cached.text, text);
		assert.equal(cached.meta.source, 'PCB');
		assert.ok(cached.meta.savedAt > 0);
	});

	it('没有缓存时返回 null', async () => {
		assert.equal(await loadNetlistCache(), null);
	});

	it('元信息损坏时正文仍可读，meta 为 null', async () => {
		storage.set(CACHE_KEY, 'body');
		storage.set(META_KEY, '{{{ 坏掉的 JSON');
		const cached = await loadNetlistCache();
		assert.equal(cached.text, 'body');
		assert.equal(cached.meta, null);
	});

	it('两个来源共用一个键：后写的覆盖前一份', async () => {
		await saveNetlistCache('from-pcb', { source: 'PCB', sourceLabel: 'PCB' });
		await saveNetlistCache('from-file', { source: 'FILE', sourceLabel: '文件', fileName: 'a.enet' });
		const cached = await loadNetlistCache();
		assert.equal(cached.text, 'from-file');
		assert.equal(cached.meta.source, 'FILE');
		assert.equal(cached.meta.fileName, 'a.enet');
	});

	it('save 的返回值带上写入后的元信息', async () => {
		const { meta } = await saveNetlistCache('x', { source: 'FILE', summary: { componentCount: 3 } });
		assert.equal(meta.summary.componentCount, 3);
		assert.equal(JSON.parse(storage.get(META_KEY)).summary.componentCount, 3);
	});

	it('清空后正文与元信息都不在', async () => {
		await saveNetlistCache('x', { source: 'PCB' });
		await clearNetlistCache();
		assert.equal(storage.has(CACHE_KEY), false);
		assert.equal(storage.has(META_KEY), false);
		assert.equal(await loadNetlistCache(), null);
	});

	it('老版本没有删除接口时退化为写空串', async () => {
		delete globalThis.eda.sys_Storage.deleteExtensionUserConfig;
		await saveNetlistCache('x', { source: 'PCB' });
		globalThis.eda.sys_Storage.deleteExtensionUserConfig = async () => {
			throw new Error('接口不存在');
		};
		await clearNetlistCache();
		assert.equal(storage.get(CACHE_KEY), '');
		assert.equal(await loadNetlistCache(), null);
	});
});

describe('describeCacheMeta', () => {
	it('元信息缺失 → 来源未知', () => {
		assert.equal(describeCacheMeta(null), '来源未知');
		assert.equal(describeCacheMeta(undefined), '来源未知');
	});

	it('带来源与时间', () => {
		const meta = { source: 'PCB', sourceLabel: 'PCB', fileName: '', savedAt: new Date(2026, 9, 24, 15, 30).getTime() };
		assert.equal(describeCacheMeta(meta), '来自 PCB · 2026-10-24 15:30');
	});

	it('带文件名', () => {
		const meta = { source: 'FILE', sourceLabel: '文件', fileName: 'board.enet', savedAt: 0 };
		assert.equal(describeCacheMeta(meta), '来自 文件 board.enet');
	});

	it('没有 sourceLabel 时按 source 兜底', () => {
		assert.equal(describeCacheMeta({ source: 'FILE', savedAt: 0 }), '来自 文件');
	});
});
