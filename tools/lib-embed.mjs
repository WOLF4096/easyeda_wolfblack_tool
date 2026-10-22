/**
 * @//module/ tools/lib-embed
 * @//description/ 把第三方库源码编码成「能嵌进 bundle 的短字符串」（gzip + base64）
 * @//exports/ encodeLibGzip
 * @//dependencies/ node:zlib
 * @//example/ import { encodeLibGzip } from './lib-embed.mjs'
 *            const b64 = encodeLibGzip(fs.readFileSync('iframe/js/echarts.min.js', 'utf8'))
 *
 * 为什么不用原始字符串字面量：echarts.min.js 有 24.5 万个 tab 与 5 万个换行，
 * 转义后从 1474KB 膨胀到 1763KB；gzip+base64 只要 519KB，反而更小，也避开了转义风险。
 * 运行时用页面上已有的 fflate 解压（见 app/working-hours/libInline.js）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import zlib from 'node:zlib';

/**
 * 把源码压缩并编码成 base64
 *
 * @param {string} source 库源码（UTF-8 文本）
 * @returns {string} gzip 后的 base64 串
 * @sideEffects 无（纯函数）
 */
export function encodeLibGzip(source) {
	return zlib.gzipSync(Buffer.from(source, 'utf8'), { level: 9 }).toString('base64');
}
