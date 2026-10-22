/**
 * @//module/ app/import-image/pixel
 * @//description/ 像素 ↔ 物理尺寸 ↔ DPI 的换算（含 mil/mm 单位换算）
 * @//exports/ MM_TO_MIL, MIL_TO_MM, DPI_PRESETS, sizeFromDpi, dpiFromSize, toMilSize
 * @//dependencies/ 无
 * @//example/ const { sizeFromDpi, dpiFromSize } = await import('./pixel.js')
 *            sizeFromDpi(1200, 600, 300, 'mm')   // { width: 101.6, height: 50.8 }
 *            dpiFromSize(1200, 600, 101.6, 50.8, 'mm') // 300
 *
 * 页面里这组换算写了 3 遍（loadImageToCurrent / calculateDpi / calculateDimensionsFromDpi），
 * 且都用 `toFixed(2)` 写回输入框，读的时候再 parseFloat 回来。这里只保留数值，格式化交给页面。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 1 mm = 39.37007874015748 mil */
export const MM_TO_MIL = 39.37007874015748;

/** 1 mil = 0.0254 mm */
export const MIL_TO_MM = 0.0254;

/** DPI 预设（滑块 0~5 对应倒序：滑块越大 DPI 越高） */
export const DPI_PRESETS = Object.freeze([300, 600, 900, 1200, 2400, 4800]);

/** 1 英寸 = 多少当前单位 */
function perInch(unit) {
	return unit === 'mm' ? 25.4 : 1000;
}

/**
 * 由像素与 DPI 算物理尺寸
 *
 * @param {number} pxWidth 像素宽
 * @param {number} pxHeight 像素高
 * @param {number} dpi DPI
 * @param {'mm'|'mil'} unit 目标单位
 * @returns {{width: number, height: number}} 物理尺寸（当前单位）
 * @sideEffects 无（纯函数）
 */
export function sizeFromDpi(pxWidth, pxHeight, dpi, unit) {
	const scale = perInch(unit);
	const safeDpi = Number(dpi) > 0 ? Number(dpi) : 1;
	return {
		width: (Number(pxWidth) / safeDpi) * scale,
		height: (Number(pxHeight) / safeDpi) * scale,
	};
}

/**
 * 由物理尺寸与像素算 DPI（横纵取平均并四舍五入）
 *
 * @param {number} pxWidth 像素宽
 * @param {number} pxHeight 像素高
 * @param {number} width 物理宽（当前单位）
 * @param {number} height 物理高（当前单位）
 * @param {'mm'|'mil'} unit 单位
 * @returns {number} DPI；参数非法时为 0
 * @sideEffects 无（纯函数）
 */
export function dpiFromSize(pxWidth, pxHeight, width, height, unit) {
	const scale = perInch(unit);
	const widthInch = Number(width) / scale;
	const heightInch = Number(height) / scale;
	if (!(widthInch > 0) || !(heightInch > 0)) return 0;
	const dpiX = Math.round(Number(pxWidth) / widthInch);
	const dpiY = Math.round(Number(pxHeight) / heightInch);
	return Math.round((dpiX + dpiY) / 2);
}

/**
 * 把界面上的宽高换算成 mil（放置图元用）
 *
 * @param {number|string} width 宽
 * @param {number|string} height 高
 * @param {'mm'|'mil'} unit 当前单位
 * @returns {{width: number, height: number}} mil 尺寸（非法值按 0）
 * @sideEffects 无（纯函数）
 */
export function toMilSize(width, height, unit) {
	const w = Number(width);
	const h = Number(height);
	const safeW = Number.isFinite(w) ? w : 0;
	const safeH = Number.isFinite(h) ? h : 0;
	if (unit === 'mm') return { width: safeW * MM_TO_MIL, height: safeH * MM_TO_MIL };
	return { width: safeW, height: safeH };
}
