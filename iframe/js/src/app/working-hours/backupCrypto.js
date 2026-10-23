/**
 * @//module/ app/working-hours/backupCrypto
 * @//description/ 备份签名：HMAC-SHA256（密钥由当前账号的用户名 + uuid 派生）与 Base64 编解码
 * @//exports/ bytesToBase64, base64ToBytes, createSignature, checkSignature
 * @//dependencies/ app/working-hours/backupFormat
 * @//example/ const sig = await createSignature({ user, exportedAt, payload })
 *            const ok = await checkSignature({ user, exportedAt, payload, signature })
 *
 * 定位：**轻量防篡改**，不是加密。密钥就是「用户名 + uuid」，工具本身是开源的，
 * 所以它能挡住的是「用文本编辑器改两个数字再导回去」，不是专业伪造。
 * 关键约束是「密钥由**当前登录账号**派生」：别人导出的文件在你这儿签名必然对不上，
 * 于是「导入别人的数据」在密码学层面也不成立，而不只是靠一句 if 判断。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { BACKUP_VERSION } from './backupFormat.js';

/** 密钥前缀（换掉它等于让所有旧备份失效，改动需谨慎） */
const KEY_SALT = 'wolfblack-working-hours';

/** Base64 分块大小（避免 `String.fromCharCode.apply` 参数过多爆栈） */
const CHUNK = 0x8000;

const encoder = new TextEncoder();

/**
 * 确保当前环境有 WebCrypto
 *
 * @returns {SubtleCrypto} 可用的 subtle
 * @sideEffects 无
 */
function ensureSubtle() {
	const host = globalThis.crypto;
	if (!host || !host.subtle) throw new Error('当前环境不支持签名校验（WebCrypto 不可用）');
	return host.subtle;
}

/**
 * 由用户身份派生 HMAC 密钥文本
 *
 * @param {object|null} user 用户信息
 * @returns {string} 密钥文本
 * @sideEffects 无（纯函数）
 */
function keyTextOf(user) {
	const src = user || {};
	const username = typeof src.username === 'string' ? src.username : '';
	const uuid = typeof src.uuid === 'string' ? src.uuid : '';
	return `${KEY_SALT}|${username}|${uuid}`;
}

/**
 * 待签名消息：版本 + 导出时间 + 载荷（后两者任一被改都会让签名失效）
 *
 * @param {number} exportedAt 导出时间戳
 * @param {string} payload Base64 载荷
 * @returns {Uint8Array} 消息字节
 * @sideEffects 无（纯函数）
 */
function messageOf(exportedAt, payload) {
	return encoder.encode(`v${BACKUP_VERSION}|${exportedAt}|${payload}`);
}

/**
 * 导入 HMAC 密钥
 *
 * @param {SubtleCrypto} subtle WebCrypto
 * @param {object|null} user 用户信息
 * @returns {Promise<CryptoKey>} HMAC 密钥
 * @sideEffects 无
 */
function importKey(subtle, user) {
	return subtle.importKey('raw', encoder.encode(keyTextOf(user)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * 字节 → Base64
 *
 * @param {Uint8Array} bytes 字节
 * @returns {string} Base64 文本
 * @sideEffects 无（纯函数）
 */
export function bytesToBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/**
 * Base64 → 字节
 *
 * @param {string} value Base64 文本
 * @returns {Uint8Array} 字节
 * @sideEffects 无（纯函数）；输入非法时抛错
 */
export function base64ToBytes(value) {
	if (typeof value !== 'string' || value.length === 0) throw new Error('备份载荷为空');
	let binary;
	try {
		binary = atob(value);
	} catch (e) {
		throw new Error('备份载荷不是合法的 Base64');
	}
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

/**
 * 生成签名
 *
 * @param {object} parts 参数
 * @param {object|null} parts.user 用户信息（决定密钥）
 * @param {number} parts.exportedAt 导出时间戳
 * @param {string} parts.payload Base64 载荷
 * @returns {Promise<string>} Base64 签名
 * @sideEffects 无
 */
export async function createSignature(parts) {
	const subtle = ensureSubtle();
	const key = await importKey(subtle, parts.user);
	const mac = await subtle.sign('HMAC', key, messageOf(parts.exportedAt, parts.payload));
	return bytesToBase64(new Uint8Array(mac));
}

/**
 * 校验签名（任何异常都视为「不通过」，调用方据此给出统一提示）
 *
 * @param {object} parts 参数
 * @param {object|null} parts.user 用户信息（必须是**当前登录账号**）
 * @param {number} parts.exportedAt 导出时间戳
 * @param {string} parts.payload Base64 载荷
 * @param {string} parts.signature Base64 签名
 * @returns {Promise<boolean>} 是否通过
 * @sideEffects 无
 */
export async function checkSignature(parts) {
	const subtle = ensureSubtle();
	const key = await importKey(subtle, parts.user);
	try {
		return await subtle.verify('HMAC', key, base64ToBytes(parts.signature), messageOf(parts.exportedAt, parts.payload));
	} catch (e) {
		return false;
	}
}
