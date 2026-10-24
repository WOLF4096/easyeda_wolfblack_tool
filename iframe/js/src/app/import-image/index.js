/**
 * @//module/ app/import-image/index
 * @//description/ 页面编排：选图 → 按 DPI 算物理尺寸 → 切片 → 建图像图元 → 跟手放置 → 批量落地
 * @//exports/ 无
 * @//dependencies/ core/eda, core/layer, core/length, ui/toast, pcb/placement, app/import-image/{pixel,layout}
 * @//example/ 页面入口，由 iframe/ImportImage.html 加载打包产物 app/ImportImage.js
 *
 * 「落地」的判定沿用原实现：**窗口失焦视为用户点了画布**（PCB 面板被点就会失焦）。
 * 因此这里不用 `ui/toast` 的静默失败路径，而是保留 closeIFrame 收尾。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../../core/eda.js';
import { LAYER } from '../../core/layer.js';
import { toApiLength } from '../../core/length.js';
import { createFollowPlacer } from '../../pcb/placement.js';
import { toast } from '../../ui/toast.js';
import { computeOrigins, gridSize, parseFileNameOrder } from './layout.js';
import { DPI_PRESETS, MIL_TO_MM, MM_TO_MIL, dpiFromSize, sizeFromDpi, toMilSize } from './pixel.js';

/** 切片像素尺寸（正方形） */
const TILE_SIZE = 1800;
/** JPEG 压缩质量 */
const JPEG_QUALITY = 0.8;
/** 鼠标跟随间隔 */
const FOLLOW_MS = 50;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const dpiSlider = $('dpiSlider');
const widthInput = $('widthInput');
const heightInput = $('heightInput');
const unitOptions = document.querySelectorAll('.unit-option');
const placeImageBtn = $('placeImageBtn');
const layerOptions = document.querySelectorAll('.layer-option');
const selectImageBtn = $('selectImageBtn');
const customDpiInput = $('customDpiInput');
const dpiValueItems = document.querySelectorAll('.ii-dpi-item');
const sliceimportCheckbox = $('sliceimport');
const aspectRatioCheckbox = $('aspectRatioCheckbox');

/* ---------- 状态 ---------- */
let currentUnit = 'mil';
let currentDpi = 1200;
let currentLayer = 'DOC';
let originalAspectRatio = 1;
let currentImage = null;
let imagesArray = [];
let objectUrls = [];
let isPlacingActive = false;
let isProcessing = false;
let currentPlacedId = null;
let lastPlacedX = 0;
let lastPlacedY = 0;
let isSliceEnabled = false;
let isCalculatingFromDpi = false;
let pendingTiles = [];
let totalImagesCount = 0;
let specialLayoutMap = null;
let useSpecialLayout = false;

/**
 * 释放预览用的 ObjectURL
 *
 * @returns {void}
 * @sideEffects 释放内存
 */
function revokeAllObjectUrls() {
	objectUrls.forEach((url) => URL.revokeObjectURL(url));
	objectUrls = [];
}

/**
 * 渲染图片预览网格
 *
 * @param {Array<File>} files 文件
 * @param {boolean} twoColumns 是否强制两列（特殊布局）
 * @returns {void}
 * @sideEffects DOM
 */
function renderGrid(files, twoColumns = false) {
	const gridContainer = $('gridPreview');
	gridContainer.innerHTML = '';
	if (!files.length) {
		gridContainer.style.display = 'none';
		return;
	}
	gridContainer.style.display = 'grid';
	gridContainer.style.gridTemplateColumns = twoColumns ? 'repeat(2, minmax(0, 1fr))' : `repeat(${gridSize(files.length)}, minmax(0, 1fr))`;
	for (const file of files) {
		const url = URL.createObjectURL(file);
		objectUrls.push(url);
		const item = document.createElement('div');
		item.className = 'grid-item';
		const img = document.createElement('img');
		img.src = url;
		img.alt = file.name;
		img.onerror = () => console.error(`图片加载失败: ${file.name}`);
		item.appendChild(img);
		gridContainer.appendChild(item);
	}
}

/**
 * 同步所有预览项的宽高比
 *
 * @param {number} ratio 宽高比
 * @returns {void}
 * @sideEffects DOM
 */
function updateGridItemAspectRatio(ratio) {
	document.querySelectorAll('.grid-item').forEach((item) => (item.style.aspectRatio = ratio));
}

/**
 * 同步 DPI 控件（滑块、高亮、自定义输入框）
 *
 * @param {number} dpi DPI 值
 * @returns {void}
 * @sideEffects DOM
 */
function syncDpiUi(dpi) {
	const index = DPI_PRESETS.indexOf(dpi);
	if (index !== -1) {
		dpiSlider.value = 5 - index; // 滑块 0~5 与预设倒序对应
		dpiValueItems.forEach((item, i) => item.classList.toggle('active', i === index));
	} else {
		dpiValueItems.forEach((item) => item.classList.remove('active'));
	}
	customDpiInput.value = dpi;
}

/**
 * 把宽高写进输入框（按当前单位，保留 2 位）
 *
 * @param {number} width 宽
 * @param {number} height 高
 * @returns {void}
 * @sideEffects DOM
 */
function writeSize(width, height) {
	widthInput.value = width.toFixed(2);
	heightInput.value = height.toFixed(2);
}

/**
 * 载入图片到编辑区：算原始尺寸并按当前 DPI 填物理尺寸
 *
 * @param {File} file 图片文件
 * @returns {void}
 * @sideEffects DOM、创建 ObjectURL
 */
function loadImageToCurrent(file) {
	if (!file) return;
	currentImage = file;
	const img = new Image();
	const url = URL.createObjectURL(file);
	img.onload = () => {
		URL.revokeObjectURL(url);
		originalAspectRatio = img.width / img.height;
		updateGridItemAspectRatio(originalAspectRatio);
		const dpi = currentDpi || 1200;
		const size = sizeFromDpi(img.width, img.height, dpi, currentUnit);
		writeSize(size.width, size.height);
		customDpiInput.value = dpi;
		currentDpi = dpi;
		syncDpiUi(dpi);
		if (aspectRatioCheckbox.checked) {
			const width = parseFloat(widthInput.value);
			if (!isNaN(width)) heightInput.value = (width / originalAspectRatio).toFixed(2);
		}
		placeImageBtn.disabled = false;
	};
	img.onerror = () => {
		URL.revokeObjectURL(url);
		console.error('无法加载图片获取尺寸');
	};
	img.src = url;
}

/**
 * 由当前宽高反算 DPI（保持横纵比时使用）
 *
 * @returns {void}
 * @sideEffects DOM
 */
function calculateDpi() {
	if (!aspectRatioCheckbox.checked || !currentImage) return;
	if (!widthInput.value || !heightInput.value) return;
	const img = new Image();
	img.onload = () => {
		const dpi = dpiFromSize(img.width, img.height, parseFloat(widthInput.value), parseFloat(heightInput.value), currentUnit);
		if (!dpi) return;
		customDpiInput.value = dpi;
		currentDpi = dpi;
		syncDpiUi(dpi);
	};
	img.src = URL.createObjectURL(currentImage);
}

/**
 * 由当前 DPI 重算宽高
 *
 * @returns {void}
 * @sideEffects DOM
 */
function calculateDimensionsFromDpi() {
	if (!currentImage || !currentDpi) return;
	isCalculatingFromDpi = true;
	const img = new Image();
	img.onload = () => {
		const size = sizeFromDpi(img.width, img.height, currentDpi, currentUnit);
		writeSize(size.width, size.height);
		isCalculatingFromDpi = false;
		syncDpiUi(currentDpi);
	};
	img.src = URL.createObjectURL(currentImage);
}

/**
 * 设置 DPI 并重算尺寸
 *
 * @param {number} dpi DPI
 * @returns {void}
 * @sideEffects DOM
 */
function setCurrentDpiAndRecalc(dpi) {
	if (!currentImage || !aspectRatioCheckbox.checked) return;
	currentDpi = dpi;
	syncDpiUi(currentDpi);
	calculateDimensionsFromDpi();
}

/**
 * 取当前图层号
 *
 * @returns {number} 层号
 * @sideEffects 无
 */
function currentLayerId() {
	if (currentLayer === 'TS') return LAYER.TOP_SILKSCREEN;
	if (currentLayer === 'BS') return LAYER.BOTTOM_SILKSCREEN;
	return LAYER.DOCUMENT;
}

/**
 * 取放置尺寸（mil）
 *
 * @returns {{width: number, height: number}} 尺寸
 * @sideEffects 无
 */
function currentPlaceSize() {
	return toMilSize(parseFloat(widthInput.value), parseFloat(heightInput.value), currentUnit);
}

/**
 * File → base64
 *
 * @param {File} file 文件
 * @returns {Promise<string>} dataURL
 * @sideEffects 读文件
 */
function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

/**
 * 裁剪一块并编码为 JPEG base64
 *
 * @param {HTMLImageElement} img 原图
 * @param {number} sx 起点 X（px）
 * @param {number} sy 起点 Y（px）
 * @param {number} sw 宽（px）
 * @param {number} sh 高（px）
 * @returns {Promise<string>} base64
 * @sideEffects 创建 canvas
 */
function cropToBase64(img, sx, sy, sw, sh) {
	return new Promise((resolve, reject) => {
		const canvas = document.createElement('canvas');
		canvas.width = sw;
		canvas.height = sh;
		canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
		canvas.toBlob(
			(blob) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			},
			'image/jpeg',
			JPEG_QUALITY,
		);
	});
}

/**
 * 单张图生成 tile 列表（整图 1 个，或按 1800px 切片）
 *
 * @param {File} file 文件
 * @param {number} pcbWidth PCB 宽（mil）
 * @param {number} pcbHeight PCB 高（mil）
 * @returns {Promise<Array<object>>} tiles
 * @sideEffects 创建 canvas、ObjectURL
 */
async function generateTiles(file, pcbWidth, pcbHeight) {
	const img = await new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = reject;
		image.src = URL.createObjectURL(file);
	});
	const pxWidth = img.width;
	const pxHeight = img.height;

	if (!isSliceEnabled) {
		const base64 = await fileToBase64(file);
		URL.revokeObjectURL(img.src);
		return [{ base64: base64, relX: 0, relY: 0, width: pcbWidth, height: pcbHeight }];
	}

	const cols = Math.ceil(pxWidth / TILE_SIZE);
	const rows = Math.ceil(pxHeight / TILE_SIZE);
	const jobs = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const sx = col * TILE_SIZE;
			const sy = row * TILE_SIZE;
			const sw = Math.min(TILE_SIZE, pxWidth - sx);
			const sh = Math.min(TILE_SIZE, pxHeight - sy);
			jobs.push(
				cropToBase64(img, sx, sy, sw, sh).then((base64) => ({
					base64: base64,
					relX: (sx / pxWidth) * pcbWidth,
					relY: (sy / pxHeight) * pcbHeight,
					width: (sw / pxWidth) * pcbWidth,
					height: (sh / pxHeight) * pcbHeight,
				})),
			);
		}
	}
	const tiles = await Promise.all(jobs);
	URL.revokeObjectURL(img.src);
	return tiles;
}

/**
 * 预处理全部图片
 *
 * @param {Array<File>} files 文件数组
 * @param {number} pcbWidth 宽（mil）
 * @param {number} pcbHeight 高（mil）
 * @returns {Promise<{tiles: Array<object>, totalImages: number}>} tiles 与图片数
 * @sideEffects 创建 canvas
 */
async function prepareAllTiles(files, pcbWidth, pcbHeight) {
	const tiles = [];
	for (let idx = 0; idx < files.length; idx++) {
		const list = await generateTiles(files[idx], pcbWidth, pcbHeight);
		for (const tile of list) tiles.push({ ...tile, imgIndex: idx });
	}
	return { tiles: tiles, totalImages: files.length };
}

const placer = createFollowPlacer({
	getPoint: async () => {
		const host = getEda();
		return host && host.pcb_SelectControl ? host.pcb_SelectControl.getCurrentMousePosition() : null;
	},
	intervalMs: FOLLOW_MS,
});

/**
 * 创建第一个 tile 并开始跟随
 *
 * @param {object} tile 首个 tile
 * @returns {Promise<boolean>} 是否成功
 * @sideEffects eda API（建图元、跟随改位置）
 */
async function startPlaceTile(tile) {
	const host = getEda();
	try {
		const created = await host.pcb_PrimitiveObject.create(
			currentLayerId(),
			0,
			0,
			tile.base64,
			toApiLength(tile.width),
			toApiLength(tile.height),
			0,
			false,
			'img',
			false,
		);
		if (!created) throw new Error('创建图像图元失败（API 返回空）');
		currentPlacedId = created.getState_PrimitiveId();
		placer.start(async (point) => {
			await host.pcb_PrimitiveObject.modify(currentPlacedId, { topLeftX: point.x, topLeftY: point.y });
			lastPlacedX = point.x;
			lastPlacedY = point.y;
		});
		return true;
	} catch (err) {
		console.error('放置 tile 失败:', err);
		toast('放置失败，请重试', 'error');
		return false;
	}
}

/**
 * 结束当前放置：按版式批量落地剩余 tile，然后关窗
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（建图元、关窗）、DOM
 */
async function finishCurrentPlaceAndContinue() {
	placer.stop();
	const host = getEda();
	if (!currentPlacedId) {
		cleanUpAndClose();
		return;
	}

	const firstTile = pendingTiles[0];
	// Y 轴翻转：PCB 的 Y 向上，鼠标落点对应图元左上角
	const originX = lastPlacedX - firstTile.relX;
	const originY = lastPlacedY + firstTile.relY;
	const { width: imgWidth, height: imgHeight } = currentPlaceSize();

	const origins = computeOrigins({
		totalImages: totalImagesCount,
		imgWidth: imgWidth,
		imgHeight: imgHeight,
		originX: originX,
		originY: originY,
		layoutMap: specialLayoutMap,
		useSpecial: useSpecialLayout,
	});

	const layerId = currentLayerId();
	for (let i = 1; i < pendingTiles.length; i++) {
		const tile = pendingTiles[i];
		const imageOrigin = origins[tile.imgIndex] || { x: originX, y: originY };
		try {
			await host.pcb_PrimitiveObject.create(
				layerId,
				imageOrigin.x + tile.relX,
				imageOrigin.y - tile.relY,
				tile.base64,
				toApiLength(tile.width),
				toApiLength(tile.height),
				0,
				false,
				'img',
				false,
			);
		} catch (err) {
			console.error(`创建 tile 失败 (imgIndex=${tile.imgIndex}):`, err);
		}
	}

	cleanUpAndClose();
}

/**
 * 复位状态并关闭面板
 *
 * @returns {void}
 * @sideEffects eda API（关窗）、DOM
 */
function cleanUpAndClose() {
	currentPlacedId = null;
	isPlacingActive = false;
	pendingTiles = [];
	totalImagesCount = 0;
	specialLayoutMap = null;
	useSpecialLayout = false;
	if (imagesArray.length === 0) placeImageBtn.disabled = true;
	const host = getEda();
	if (host && host.sys_IFrame) host.sys_IFrame.closeIFrame('ImportImage');
}

/**
 * 开始放置（按钮）
 *
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function handlePlaceImage() {
	if (isPlacingActive) {
		toast('正在放置中，请先完成当前操作', 'warning');
		return;
	}
	if (isProcessing) {
		toast('正在处理图片，请稍候...', 'warning');
		return;
	}
	if (!imagesArray.length) {
		toast('请先选择图片', 'error');
		return;
	}
	const { width, height } = currentPlaceSize();
	if (width <= 0 || height <= 0) {
		toast('请输入有效的宽度和高度', 'error');
		return;
	}

	const host = getEda();
	if (!host) {
		toast('未检测到 EDA 运行环境', 'error');
		return;
	}

	isSliceEnabled = sliceimportCheckbox.checked;
	isProcessing = true;
	toast('正在处理图片，请稍候...', 'info');

	let prepared;
	try {
		prepared = await prepareAllTiles(imagesArray, width, height);
	} catch (err) {
		console.error('图片处理失败:', err);
		toast('图片处理失败，请重试', 'error');
		isProcessing = false;
		return;
	}

	pendingTiles = prepared.tiles;
	totalImagesCount = prepared.totalImages;
	isPlacingActive = true;
	isProcessing = false;
	if (host.sys_IFrame) host.sys_IFrame.hideIFrame('ImportImage');

	await startPlaceTile(pendingTiles[0]);
}

/**
 * 选择图片并解析版式
 *
 * @returns {Promise<void>}
 * @sideEffects DOM、读文件
 */
async function handleImageSelect() {
	if (isPlacingActive) {
		toast('请先完成当前图片放置', 'warning');
		return;
	}
	placer.stop();

	try {
		const files = await new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.multiple = true;
			input.accept = '.png,.jpg,.jpeg,.bmp';
			input.onchange = () => resolve(Array.from(input.files));
			input.click();
		});
		if (!files.length) return;

		const validTypes = ['image/png', 'image/jpeg', 'image/bmp'];
		if (files.some((file) => !validTypes.includes(String(file.type).toLowerCase()))) {
			toast('仅支持 PNG、JPG、JPEG、BMP 格式', 'error');
			return;
		}

		revokeAllObjectUrls();

		const { ordered, layoutMap, useSpecial } = parseFileNameOrder(files);
		specialLayoutMap = layoutMap;
		useSpecialLayout = useSpecial;
		imagesArray = ordered;

		renderGrid(imagesArray, useSpecialLayout);
		document.querySelector('.preview-placeholder').style.display = 'none';
		$('previewImage').style.display = 'none';

		loadImageToCurrent(imagesArray[0]);
		isPlacingActive = false;
	} catch (error) {
		console.error('选择图像时出错:', error);
	}
}

/* ---------- 事件 ---------- */

// 窗口失焦 = 用户点了画布 → 落地并批量放置剩余 tile
window.onblur = async () => {
	if (isPlacingActive) await finishCurrentPlaceAndContinue();
};

unitOptions.forEach((option) => {
	option.addEventListener('click', () => {
		if (option.classList.contains('active')) return;
		unitOptions.forEach((item) => item.classList.remove('active'));
		option.classList.add('active');
		const oldUnit = currentUnit;
		currentUnit = option.dataset.unit;
		if (currentImage && widthInput.value && heightInput.value) {
			if (oldUnit === 'mm' && currentUnit === 'mil') {
				widthInput.value = (parseFloat(widthInput.value) * MM_TO_MIL).toFixed(2);
				heightInput.value = (parseFloat(heightInput.value) * MM_TO_MIL).toFixed(2);
			} else if (oldUnit === 'mil' && currentUnit === 'mm') {
				widthInput.value = (parseFloat(widthInput.value) * MIL_TO_MM).toFixed(2);
				heightInput.value = (parseFloat(heightInput.value) * MIL_TO_MM).toFixed(2);
			}
			calculateDpi();
		}
	});
});

layerOptions.forEach((option) => {
	option.addEventListener('click', () => {
		if (option.classList.contains('active')) return;
		layerOptions.forEach((item) => item.classList.remove('active'));
		option.classList.add('active');
		currentLayer = option.dataset.layer;
	});
});

widthInput.addEventListener('input', () => {
	if (isCalculatingFromDpi) return;
	calculateDpi();
	if (aspectRatioCheckbox.checked && currentImage) {
		const width = parseFloat(widthInput.value);
		if (!isNaN(width)) heightInput.value = (width / originalAspectRatio).toFixed(2);
	}
});

heightInput.addEventListener('input', () => {
	if (isCalculatingFromDpi) return;
	calculateDpi();
	if (aspectRatioCheckbox.checked && currentImage) {
		const height = parseFloat(heightInput.value);
		if (!isNaN(height)) widthInput.value = (height * originalAspectRatio).toFixed(2);
	}
});

/**
 * 切换「保持横纵比」：关闭时禁用 DPI 控件
 *
 * @returns {void}
 * @sideEffects DOM
 */
function toggleAspectRatio() {
	if (aspectRatioCheckbox.checked) {
		customDpiInput.disabled = false;
		dpiSlider.disabled = false;
		dpiValueItems.forEach((item) => (item.style.pointerEvents = 'auto'));
		if (currentImage) {
			const img = new Image();
			img.onload = () => {
				originalAspectRatio = img.width / img.height;
				const width = parseFloat(widthInput.value);
				if (!isNaN(width)) heightInput.value = (width / originalAspectRatio).toFixed(2);
				calculateDpi();
			};
			img.src = URL.createObjectURL(currentImage);
		}
		return;
	}
	customDpiInput.disabled = true;
	dpiSlider.disabled = true;
	dpiValueItems.forEach((item) => (item.style.pointerEvents = 'none'));
	dpiValueItems.forEach((item) => item.classList.remove('active'));
	customDpiInput.value = '';
	currentDpi = null;
}
aspectRatioCheckbox.addEventListener('change', toggleAspectRatio);

dpiSlider.addEventListener('input', () => {
	const index = 5 - parseInt(dpiSlider.value, 10);
	setCurrentDpiAndRecalc(DPI_PRESETS[index]);
});

dpiValueItems.forEach((item, index) => {
	item.addEventListener('click', () => setCurrentDpiAndRecalc(DPI_PRESETS[index]));
});

customDpiInput.addEventListener('input', () => {
	const dpi = parseInt(customDpiInput.value, 10);
	if (isNaN(dpi) || dpi <= 0) return;
	currentDpi = dpi;
	syncDpiUi(currentDpi);
	if (aspectRatioCheckbox.checked && currentImage) calculateDimensionsFromDpi();
});

sliceimportCheckbox.addEventListener('change', () => {
	isSliceEnabled = sliceimportCheckbox.checked;
});
isSliceEnabled = sliceimportCheckbox.checked;

selectImageBtn.addEventListener('click', handleImageSelect);
placeImageBtn.addEventListener('click', handlePlaceImage);
placeImageBtn.disabled = true;
