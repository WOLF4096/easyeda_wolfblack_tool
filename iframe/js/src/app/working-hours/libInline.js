/**
 * @//module/ app/working-hours/libInline
 * @//description/ 还原构建期内嵌的 echarts / fflate 源码，供导出报告离线内联
 * @//exports/ EMBEDDED_LIBS, decodeEmbeddedLib, getInlineLibs
 * @//dependencies/ 无（fflate 取页面全局；缺失时降级为空串）
 * @//example/ const { echarts, fflate } = getInlineLibs()
 *            buildLibTags(echarts, fflate)
 *
 * 为什么必须构建期内嵌：EDA 宿主把页面渲染成 blob: 文档，`fetch('/iframe/js/x.js')`
 * 会直接 `Failed to parse URL`，所以「运行时读本地文件」这条路是死的（2026-10-22 实测）。
 * 构建脚本（scripts/build-iframe.mjs）用 esbuild define 把两个常量注入进来：
 *   - `__WOLF_LIB_ECHARTS_GZ__`：echarts 源码的 gzip+base64（519KB，解压后 1474KB）
 *   - `__WOLF_LIB_FFLATE__`：fflate 源码原文（32KB，它自己就是解压器，不能再压缩）
 * 未打包（node 直测）时 `typeof` 保护让两个常量取空串，模块仍可安全 import。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
/* global __WOLF_LIB_ECHARTS_GZ__, __WOLF_LIB_FFLATE__ */

/**
 * 构建期内嵌的库源码（未注入时为空串）
 *
 * @type {{ echartsGz: string, fflate: string }}
 */
export const EMBEDDED_LIBS = {
	echartsGz: typeof __WOLF_LIB_ECHARTS_GZ__ === 'string' ? __WOLF_LIB_ECHARTS_GZ__ : '',
	fflate: typeof __WOLF_LIB_FFLATE__ === 'string' ? __WOLF_LIB_FFLATE__ : '',
};

/**
 * base64 → 解压 → 文本；任一步失败都返回空串（导出侧据此判定库不可用）
 *
 * @param {string} gzBase64 gzip 后的 base64 串
 * @param {(bytes: Uint8Array) => Uint8Array} inflate 解压函数（浏览器传 fflate.gunzipSync）
 * @returns {string} 源码文本；失败返回空串
 * @sideEffects 无（纯函数）
 */
export function decodeEmbeddedLib(gzBase64, inflate) {
	if (!gzBase64 || typeof inflate !== 'function') return '';
	try {
		const bytes = Uint8Array.from(atob(gzBase64), (c) => c.charCodeAt(0));
		const raw = inflate(bytes);
		if (!raw || raw.length === 0) return '';
		return new TextDecoder().decode(raw);
	} catch (e) {
		return '';
	}
}

/**
 * 库源码里若出现 `</script` 会提前闭合标签，内联前必须转义
 *
 * @param {string} code 源码
 * @returns {string} 转义后的源码
 * @sideEffects 无（纯函数）
 */
function escapeScriptTag(code) {
	return code.replace(/<\/script/gi, '<\\/script');
}

/**
 * 取可直接内联进导出报告的库源码（已转义 `</script`）
 *
 * @param {object} [fflateRef] fflate 对象；不传则取页面全局 `fflate`
 * @returns {{ echarts: string, fflate: string }} 两个库源码，缺失的为空串
 * @sideEffects 无（纯函数）
 */
export function getInlineLibs(fflateRef) {
	const lib = fflateRef || (typeof fflate !== 'undefined' ? fflate : null);
	const echarts = lib ? decodeEmbeddedLib(EMBEDDED_LIBS.echartsGz, (bytes) => lib.gunzipSync(bytes)) : '';
	return {
		echarts: escapeScriptTag(echarts),
		fflate: escapeScriptTag(EMBEDDED_LIBS.fflate),
	};
}
