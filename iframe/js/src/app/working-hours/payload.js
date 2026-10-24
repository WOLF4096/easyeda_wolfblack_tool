/**
 * @//module/ app/working-hours/payload
 * @//description/ 导出报告的数据打包：GZIP 压缩 + SHA-256 校验和 + Base64
 * @//exports/ packPayload, fromBase64
 * @//dependencies/ 无
 * @//example/ const { packPayload } = await import('./payload.js')
 *            const { data, hash } = await packPayload({ projectMeta, data })
 *
 * 这只是**轻量防篡改**（校验和随数据一起下发），不是加密 —— 目标是挡住随手改数据的人，
 * 不用于对抗专业手段。报告里对应的校验逻辑在 `reportTemplate.js` 的内联脚本中。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * Base64 → Uint8Array
 *
 * @param {string} base64 Base64 文本
 * @returns {Uint8Array} 字节
 * @sideEffects 无（纯函数）
 */
export function fromBase64(base64) {
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * 把字符串（或字节）转成 Base64（走 FileReader，比逐字符拼接快）
 *
 * @param {BufferSource} buffer 字节
 * @returns {Promise<string>} Base64（不含 data URL 前缀）
 * @sideEffects 创建 Blob / FileReader
 */
function toBase64(buffer) {
	return new Promise((resolve) => {
		const blob = new Blob([buffer]);
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(',')[1]);
		reader.readAsDataURL(blob);
	});
}

/**
 * 打包导出数据
 *
 * @param {object} jsonObject 要导出的对象
 * @returns {Promise<{data: string, hash: string}>} 压缩后的 Base64 数据与校验和
 * @sideEffects 依赖全局 `fflate`（由页面脚本提供）与 WebCrypto
 */
export async function packPayload(jsonObject) {
	const plain = new TextEncoder().encode(JSON.stringify(jsonObject));
	const compressed = fflate.gzipSync(plain, { level: 9 });
	const digest = await crypto.subtle.digest('SHA-256', compressed);

	return { data: await toBase64(compressed), hash: await toBase64(new Uint8Array(digest)) };
}
