/**
 * API 校准配置读取测试（mock 全局 eda）
 *
 * 被测模块：src/js/common/apiConfig.js
 * 这是唯一需要 mock `eda` 的公共模块 —— 它读 `eda.sys_Storage.getExtensionUserConfig`。
 *
 * 注意：模块内部用的是裸标识符 `eda`（不是 `globalThis.eda`），
 * 因此只需给 `globalThis.eda` 赋值即可生效。
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { loadApiConfig } from '../src/js/common/apiConfig.js';

const DEFAULT_CONFIG = { 创建过孔: { 坐标: 1, 内径: 1, 外径: 1 } };

let originWarn;
let warnCalls;

beforeEach(() => {
	originWarn = console.warn;
	warnCalls = [];
	console.warn = (...args) => warnCalls.push(args);
	delete globalThis.eda;
});

afterEach(() => {
	console.warn = originWarn;
	delete globalThis.eda;
});

/** 构造一个只带 sys_Storage 的假 eda */
function mockEda(impl) {
	globalThis.eda = { sys_Storage: { getExtensionUserConfig: impl } };
}

describe('loadApiConfig', () => {
	it('正常返回字符串 → 解析为对象', async () => {
		const stored = { 创建过孔: { 坐标: 10, 内径: 2, 外径: 3 } };
		mockEda(async () => JSON.stringify(stored));
		assert.deepEqual(await loadApiConfig(DEFAULT_CONFIG), stored);
		assert.equal(warnCalls.length, 0);
	});

	it('使用默认存储键 APITest', async () => {
		const keys = [];
		mockEda(async (key) => {
			keys.push(key);
			return '{}';
		});
		await loadApiConfig(DEFAULT_CONFIG);
		assert.deepEqual(keys, ['APITest']);
	});

	it('自定义存储键透传', async () => {
		const keys = [];
		mockEda(async (key) => {
			keys.push(key);
			return '{}';
		});
		await loadApiConfig(DEFAULT_CONFIG, 'MyCalibration');
		assert.deepEqual(keys, ['MyCalibration']);
	});

	it('返回空字符串 → 回退默认配置且不打 warn', async () => {
		mockEda(async () => '');
		assert.deepEqual(await loadApiConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
		assert.equal(warnCalls.length, 0);
	});

	it('返回 null/undefined → 回退默认配置', async () => {
		mockEda(async () => null);
		assert.deepEqual(await loadApiConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
		mockEda(async () => undefined);
		assert.deepEqual(await loadApiConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
	});

	it('返回非法 JSON → 回退默认配置并 warn', async () => {
		mockEda(async () => '{ 坐标: 1, }');
		const result = await loadApiConfig(DEFAULT_CONFIG);
		assert.deepEqual(result, DEFAULT_CONFIG);
		assert.equal(warnCalls.length, 1);
		assert.match(String(warnCalls[0][0]), /解析失败/);
	});

	it('getExtensionUserConfig 抛错 → 回退默认配置并 warn', async () => {
		mockEda(async () => {
			throw new Error('storage unavailable');
		});
		const result = await loadApiConfig(DEFAULT_CONFIG);
		assert.deepEqual(result, DEFAULT_CONFIG);
		assert.equal(warnCalls.length, 1);
		assert.match(String(warnCalls[0][0]), /读取/);
	});

	it('eda 全局不存在 → 回退默认配置且不抛错', async () => {
		delete globalThis.eda;
		assert.deepEqual(await loadApiConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
		assert.equal(warnCalls.length, 1);
	});

	it('合法 JSON 但为空对象 → 原样返回，不与默认配置合并', async () => {
		// 契约：字段级兜底由调用方用 `api[分组]?.[字段] ?? 1` 负责
		mockEda(async () => '{}');
		assert.deepEqual(await loadApiConfig(DEFAULT_CONFIG), {});
	});

	it('返回值与默认配置不是同一个引用（避免调用方误改默认值）', async () => {
		const stored = { 创建过孔: { 坐标: 5 } };
		mockEda(async () => JSON.stringify(stored));
		const result = await loadApiConfig(DEFAULT_CONFIG);
		assert.notEqual(result, DEFAULT_CONFIG);
		assert.deepEqual(result, stored);
	});
});
