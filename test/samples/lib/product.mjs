/**
 * 加载「产品代码」里的公共模块，供样本测试直接调用
 *
 * 关键点：这些函数不是测试里重写的副本，而是 iframe 页面实际运行的同一份代码
 * （`iframe/js/common.js` 用 new Function 注入假 window 后取 WolfCommon）。
 * 这样样本测试才真正**测到产品**，而不是测一个平行实现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 仓库根目录（从 test/samples/lib 往上三级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * 载入 iframe 公共模块
 * @returns {Object} WolfCommon
 */
export function loadWolfCommon() {
	const file = path.join(ROOT, 'iframe', 'js', 'common.js');
	const source = fs.readFileSync(file, 'utf8');
	const fakeWindow = {};
	// eslint-disable-next-line no-new-func
	new Function('window', source)(fakeWindow);
	if (!fakeWindow.WolfCommon) throw new Error('iframe/js/common.js 未挂载 window.WolfCommon');
	return fakeWindow.WolfCommon;
}

/**
 * 载入后端图层常量（ESM 直接 import）
 * @returns {Promise<Object>}
 */
export async function loadPcbConstants() {
	const file = path.join(ROOT, 'src', 'js', 'common', 'pcbConstants.js');
	return import(pathToFileURL(file).href);
}
