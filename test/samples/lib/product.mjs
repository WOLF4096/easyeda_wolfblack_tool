/**
 * 加载「产品代码」里的公共模块，供样本测试直接调用
 *
 * 关键点：这些函数不是测试里重写的副本，而是 iframe 页面实际运行的同一份代码
 * （`iframe/js/common.js` 用 new Function 注入假 window 后取 WolfCommon）。
 * 这样样本测试才真正**测到产品**，而不是测一个平行实现。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 仓库根目录（从 test/samples/lib 往上三级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * 载入前端公共能力，拼成旧 `WolfCommon` 的形状
 *
 * v1.19.0 删掉了 `iframe/js/common.js` 门面，前端改为 `iframe/js/src/core/*` 的 ESM 模块。
 * 样本用例只用到 `splitSourceLine` / `joinSourceLine` / `LAYER` 三个能力，这里按需拼装，
 * 让「测的是产品同一份代码」这条前提继续成立（不是测试里的平行实现）。
 *
 * @returns {Promise<Object>} 形如旧 WolfCommon 的对象
 */
export async function loadWolfCommon() {
	const sourceLine = await import(pathToFileURL(path.join(ROOT, 'iframe', 'js', 'src', 'core', 'sourceLine.js')).href);
	const layer = await import(pathToFileURL(path.join(ROOT, 'iframe', 'js', 'src', 'core', 'layer.js')).href);
	return {
		splitSourceLine: sourceLine.splitSourceLine,
		joinSourceLine: sourceLine.joinSourceLine,
		LAYER: layer.LAYER,
	};
}

/**
 * 载入后端图层常量（ESM 直接 import）
 * @returns {Promise<Object>}
 */
export async function loadPcbConstants() {
	const file = path.join(ROOT, 'src', 'js', 'common', 'pcbConstants.js');
	return import(pathToFileURL(file).href);
}
