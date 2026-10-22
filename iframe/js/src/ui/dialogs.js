/**
 * @//module/ ui/dialogs
 * @//description/ 把宿主的回调式确认对话框包成 Promise（并给出浏览器直开时的降级）
 * @//exports/ confirm
 * @//dependencies/ core/eda
 * @//example/ const { confirm } = await import('./ui/dialogs.js')
 *            if (await confirm('确认删除全部记录？', { title: '危险操作', okText: '删除' })) { … }
 */

import { getEda } from '../core/eda.js';

/**
 * 显示确认对话框
 *
 * 宿主签名是回调式的：
 * `sys_Dialog.showConfirmationMessage(message, title, okText, cancelText, callback(ok))`。
 * 项目里 3 处调用各自展开回调，缩进很深且容易漏掉「取消」分支；这里包成 Promise。
 *
 * @param {string} message 正文
 * @param {object} [options] 选项
 * @param {string} [options.title='确认'] 标题
 * @param {string} [options.okText='确认'] 主按钮文案
 * @param {string} [options.cancelText='取消'] 取消按钮文案
 * @param {object|null} [options.host] 宿主对象（默认走 core/eda 的 getEda）
 * @returns {Promise<boolean>} 用户点主按钮为 true；取消 / 关闭 / 调用失败为 false
 * @sideEffects eda API（sys_Dialog.showConfirmationMessage）或浏览器 confirm
 */
export function confirm(message, options = {}) {
	const host = options.host === undefined ? getEda() : options.host;
	const title = options.title || '确认';
	const okText = options.okText || '确认';
	const cancelText = options.cancelText || '取消';
	const text = message === null || message === undefined ? '' : String(message);

	return new Promise((resolve) => {
		let settled = false;
		const done = (value) => {
			if (settled) return;
			settled = true;
			resolve(!!value);
		};

		try {
			if (host && host.sys_Dialog && typeof host.sys_Dialog.showConfirmationMessage === 'function') {
				host.sys_Dialog.showConfirmationMessage(text, title, okText, cancelText, (ok) => done(ok));
				return;
			}
		} catch (e) {
			/* 宿主不可用 → 走下面的降级 */
		}

		if (typeof globalThis.confirm === 'function') {
			try {
				done(globalThis.confirm(text));
				return;
			} catch (e) {
				/* 无 UI 环境（如 node 测试）→ 视为取消 */
			}
		}
		done(false);
	});
}
