/**
 * @//module/ app/import-qrcode/index
 * @//description/ 页面编排：生成条码预览 → 位图/矢量两种方式放到 PCB → 鼠标跟随定位
 * @//exports/ 无
 * @//dependencies/ core/eda, core/layer, core/length, ui/toast, pcb/placement, app/import-qrcode/barcode
 * @//example/ 页面入口，由 iframe/ImportQrcode.html 加载打包产物 app/ImportQrcode.js
 *
 * 依赖全局：`bwipjs`（HTML 里先加载 `/iframe/js/bwip-js-min.js`）、可选 `EPCB_LayerId`。
 */

import { getEda } from '../../core/eda.js';
import { LAYER } from '../../core/layer.js';
import { toApiLength } from '../../core/length.js';
import { createFollowPlacer } from '../../pcb/placement.js';
import { toast } from '../../ui/toast.js';
import { COMMON_CODES, UNCOMMON_CODES, TWO_D_CODES_NO_TEXT, QR_CODES_WITH_ECL, buildOptions, computeDpi } from './barcode.js';

/** 1 mm = 39.37007874015748 mil */
const MM_TO_MIL = 39.37007874015748;

/** 图层下拉配置：位图只能放丝印/文档层，矢量可放铜层 */
const LAYER_OPTIONS = {
	image: [
		{ value: 'TOP_SILKSCREEN', text: '顶层丝印层', default: true },
		{ value: 'BOTTOM_SILKSCREEN', text: '底层丝印层' },
		{ value: 'DOCUMENT', text: '文档层' },
	],
	vector: [
		{ value: 'TOP', text: '顶层' },
		{ value: 'TOP_SILKSCREEN', text: '顶层丝印层', default: true },
		{ value: 'BOTTOM', text: '底层' },
		{ value: 'BOTTOM_SILKSCREEN', text: '底层丝印层' },
		{ value: 'TOP_SOLDER_MASK', text: '顶层阻焊' },
		{ value: 'BOTTOM_SOLDER_MASK', text: '底层阻焊' },
	],
};

const STATE = { outputType: 'image', unit: 'mil', currentLayer: 'TOP_SILKSCREEN', layerMap: {}, primitiveId: null };

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const selectElement = $('barcode-type');
const dataInput = $('barcode-data');
const scaleInput = $('barcode-scale');
const paddingInput = $('barcode-padding');
const eclevelSelect = $('barcode-eclevel');
const includeTextInput = $('barcode-include-text');
const scaleValueDisplay = $('scale-value');
const paddingValueDisplay = $('padding-value');
const resolutionInfo = $('resolution-info');
const errorDiv = $('error-message');
const typeImageBtn = $('type-image');
const typeVectorBtn = $('type-vector');
const vectorControls = $('vector-controls');
const imageControls = $('image-controls');
const colorForeInput = $('color-fore');
const colorBackInput = $('color-back');
const invertCheckbox = $('invert-image');
const unitMmBtn = $('unit-mm');
const unitMilBtn = $('unit-mil');
const qrSizeInput = $('qr-size');
const layerSelect = $('layer-select');
const canvasWrapper = $('canvas-wrapper');

/**
 * 建立层名 → 层号映射
 *
 * 宿主没有暴露 `EPCB_LayerId` 时退回 `core/layer` 的官方层表（原实现只兜底了 TOP_SILKSCREEN）。
 *
 * @returns {void}
 * @sideEffects 修改 STATE.layerMap
 */
function initLayerMap() {
	const hostMap = globalThis.EPCB_LayerId;
	if (hostMap) {
		STATE.layerMap = {
			TOP: hostMap.TOP,
			TOP_SILKSCREEN: hostMap.TOP_SILKSCREEN,
			TOP_SOLDER_MASK: hostMap.TOP_SOLDER_MASK,
			TOP_ASSEMBLY: hostMap.TOP_ASSEMBLY,
			BOTTOM: hostMap.BOTTOM,
			BOTTOM_SILKSCREEN: hostMap.BOTTOM_SILKSCREEN,
			BOTTOM_SOLDER_MASK: hostMap.BOTTOM_SOLDER_MASK,
			BOTTOM_ASSEMBLY: hostMap.BOTTOM_ASSEMBLY,
			DOCUMENT: hostMap.DOCUMENT,
			MECHANICAL: hostMap.MECHANICAL,
			DRILL_DRAWING: hostMap.DRILL_DRAWING,
		};
		return;
	}
	STATE.layerMap = {
		TOP: LAYER.TOP,
		TOP_SILKSCREEN: LAYER.TOP_SILKSCREEN,
		TOP_SOLDER_MASK: LAYER.TOP_SOLDER_MASK,
		TOP_ASSEMBLY: LAYER.TOP_ASSEMBLY,
		BOTTOM: LAYER.BOTTOM,
		BOTTOM_SILKSCREEN: LAYER.BOTTOM_SILKSCREEN,
		BOTTOM_SOLDER_MASK: LAYER.BOTTOM_SOLDER_MASK,
		BOTTOM_ASSEMBLY: LAYER.BOTTOM_ASSEMBLY,
		DOCUMENT: LAYER.DOCUMENT,
		MECHANICAL: LAYER.MECHANICAL,
	};
}

/**
 * 重建图层下拉
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateLayerOptions() {
	layerSelect.innerHTML = '';
	for (const option of LAYER_OPTIONS[STATE.outputType]) {
		const el = document.createElement('option');
		el.value = option.value;
		el.textContent = option.text;
		if (option.default) {
			el.selected = true;
			STATE.currentLayer = option.value;
		}
		layerSelect.appendChild(el);
	}
}

/**
 * 切换输出类型（位图 / 矢量）
 *
 * @param {'image'|'vector'} type 类型
 * @returns {void}
 * @sideEffects DOM、重新生成预览
 */
function setOutputType(type) {
	STATE.outputType = type;
	const isImage = type === 'image';
	typeImageBtn.classList.toggle('active', isImage);
	typeVectorBtn.classList.toggle('active', !isImage);
	vectorControls.style.display = isImage ? 'none' : 'block';
	imageControls.style.display = isImage ? 'block' : 'none';
	updateLayerOptions();
	generateBarcode();
}

/**
 * 切换尺寸单位（会同步换算输入框）
 *
 * @param {'mm'|'mil'} unit 目标单位
 * @returns {void}
 * @sideEffects DOM、重新生成预览
 */
function setUnit(unit) {
	if (STATE.unit === unit) return;
	const current = parseFloat(qrSizeInput.value) || 0;
	if (current > 0) {
		if (unit === 'mil' && STATE.unit === 'mm') qrSizeInput.value = (current * MM_TO_MIL).toFixed(2);
		if (unit === 'mm' && STATE.unit === 'mil') qrSizeInput.value = (current / MM_TO_MIL).toFixed(2);
	}
	STATE.unit = unit;
	unitMmBtn.classList.toggle('active', unit === 'mm');
	unitMilBtn.classList.toggle('active', unit === 'mil');
	generateBarcode();
}

/**
 * 按码型显示/隐藏「纠错级别」「包含文本」
 *
 * @returns {void}
 * @sideEffects DOM
 */
function updateFormVisibility() {
	const bcid = selectElement.value;
	$('group-eclevel').style.display = QR_CODES_WITH_ECL.includes(bcid) ? 'block' : 'none';
	$('group-include-text').style.display = TWO_D_CODES_NO_TEXT.includes(bcid) ? 'none' : 'block';
}

/**
 * 生成条码预览并刷新 DPI 提示
 *
 * @returns {void}
 * @sideEffects DOM（canvas 绘制）
 */
function generateBarcode() {
	errorDiv.textContent = '';
	const placeHint = $('place-hint');
	const bcid = selectElement.value;
	const text = dataInput.value;

	if (!text) {
		errorDiv.textContent = '输入数据不能为空。';
		resolutionInfo.textContent = '二维码尺寸: - × - px | - DPI';
		placeHint.style.display = 'none';
		return;
	}

	const options = buildOptions({
		bcid: bcid,
		text: text,
		scale: parseInt(scaleInput.value, 10),
		padding: parseInt(paddingInput.value * 2, 10),
		outputType: STATE.outputType,
		inverted: invertCheckbox.checked,
		fore: colorForeInput.value,
		back: colorBackInput.value,
		eclevel: eclevelSelect.value,
		includeText: includeTextInput.checked,
	});

	try {
		globalThis.bwipjs.toCanvas('barcode-canvas', options);
		const canvas = $('barcode-canvas');
		const dpi = computeDpi(Math.max(canvas.width, canvas.height), parseFloat(qrSizeInput.value) || 25.4, STATE.unit);
		resolutionInfo.textContent = `尺寸: ${canvas.width} × ${canvas.height} px | ${dpi} DPI`;
		placeHint.style.display = 'block';
		canvasWrapper.style.cursor = 'pointer';
	} catch (e) {
		const canvas = $('barcode-canvas');
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		errorDiv.textContent = '格式错误: ' + e.message;
		resolutionInfo.textContent = '尺寸: - × - px | - DPI';
		placeHint.style.display = 'none';
		canvasWrapper.style.cursor = 'not-allowed';
	}
}

/**
 * 取当前图层号
 *
 * @returns {number} 层号
 * @sideEffects 无
 */
function currentLayerId() {
	return STATE.layerMap[STATE.currentLayer] || LAYER.TOP_SILKSCREEN;
}

const placer = createFollowPlacer({
	getPoint: async () => {
		const host = getEda();
		return host && host.pcb_SelectControl ? host.pcb_SelectControl.getCurrentMousePosition() : null;
	},
	intervalMs: 20,
});

/**
 * 把预览图元放到 PCB 并开始跟随
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（建图元、隐藏面板、改图元位置）
 */
async function handlePlace() {
	const canvas = $('barcode-canvas');
	if (canvas.width === 0) return;

	const host = getEda();
	if (!host) {
		toast('当前非 EDA 环境，请点击“保存图片”下载。', 2);
		return;
	}

	try {
		placer.stop();

		let width = parseFloat(qrSizeInput.value) || 25.4;
		if (STATE.unit === 'mm') width *= MM_TO_MIL;
		const height = width * (canvas.height / canvas.width);

		const layerId = currentLayerId();
		const base64 = canvas.toDataURL('image/png');
		// API 的 width/height 是 number，字符串会被判为非法值（VALUE_OUT_OF_RANGE）
		const apiWidth = toApiLength(width);
		const apiHeight = toApiLength(height);

		if (STATE.outputType === 'image') {
			const created = await host.pcb_PrimitiveObject.create(layerId, 0, 0, base64, apiWidth, apiHeight, 0, false, 'img', false);
			if (!created) throw new Error('创建图像图元失败（API 返回空）');
			STATE.primitiveId = created.getState_PrimitiveId();
			placer.start(async (pt) => host.pcb_PrimitiveObject.modify(STATE.primitiveId, { topLeftX: pt.x, topLeftY: pt.y }));
		} else {
			const blob = await (await fetch(base64)).blob();
			const edaImage = await host.pcb_MathPolygon.convertImageToComplexPolygon(blob, apiWidth, apiHeight, 0.5, 0, 0, 0, true, false);
			if (!edaImage) throw new Error('图像转换为多边形失败');
			const created = await host.pcb_PrimitiveImage.create(0, 0, edaImage, layerId, apiWidth, apiHeight, 0, false, false);
			if (!created) throw new Error('创建图像图元失败（API 返回空）');
			STATE.primitiveId = created.getState_PrimitiveId();
			placer.start(async (pt) => host.pcb_PrimitiveImage.modify(STATE.primitiveId, { x: pt.x, y: pt.y }));
		}

		if (host.sys_IFrame) host.sys_IFrame.hideIFrame('ImportQrcode');
	} catch (err) {
		toast('放置失败: ' + err.message, 'error');
		placer.stop();
	}
}

/**
 * 保存预览为 PNG
 *
 * @returns {void}
 * @sideEffects DOM（触发下载）
 */
function saveAsPng() {
	const canvas = $('barcode-canvas');
	const rawText = dataInput.value;
	if (!rawText || canvas.width === 0) return;
	let fileName = rawText.replace(/[\\/:*?"<>|\r\n]/g, '_').trim();
	if (fileName === '') fileName = 'barcode';
	const link = document.createElement('a');
	link.download = fileName + '.png';
	link.href = canvas.toDataURL('image/png');
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

/**
 * 颜色输入节流（200ms）：拖动取色器时不要每一帧都重绘条码
 *
 * @returns {void}
 * @sideEffects DOM、定时器
 */
function createThrottledColorUpdate() {
	let last = 0;
	let timer = null;
	return () => {
		const now = Date.now();
		if (now - last >= 200) {
			generateBarcode();
			last = now;
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => {
			generateBarcode();
			last = Date.now();
		}, 200 - (now - last));
	};
}

/**
 * 初始化下拉、事件与首次预览
 *
 * @returns {void}
 * @sideEffects DOM、宿主 API
 */
function init() {
	const sortedUncommon = UNCOMMON_CODES.slice().sort((a, b) => a.name.localeCompare(b.name));
	const makeOption = (item) => {
		const opt = document.createElement('option');
		opt.value = item.id;
		opt.textContent = `${item.name} (${item.cn})`;
		return opt;
	};
	COMMON_CODES.forEach((item) => selectElement.appendChild(makeOption(item)));
	const separator = document.createElement('option');
	separator.disabled = true;
	separator.textContent = '--------';
	selectElement.appendChild(separator);
	sortedUncommon.forEach((item) => selectElement.appendChild(makeOption(item)));

	initLayerMap();
	updateLayerOptions();
	updateFormVisibility();
	generateBarcode();

	// 滚轮切换码型（跳过分隔项）
	selectElement.addEventListener('wheel', (event) => {
		event.preventDefault();
		const direction = event.deltaY > 0 ? 1 : -1;
		let next = selectElement.selectedIndex + direction;
		while (next >= 0 && next < selectElement.options.length) {
			if (!selectElement.options[next].disabled) {
				selectElement.selectedIndex = next;
				updateFormVisibility();
				generateBarcode();
				break;
			}
			next += direction;
		}
	});

	// 物理尺寸滚轮微调：mil 步进 1、mm 步进 0.1
	qrSizeInput.addEventListener('wheel', (event) => {
		event.preventDefault();
		const current = parseFloat(qrSizeInput.value) || 0;
		const step = STATE.unit === 'mil' ? 1 : 0.1;
		const direction = event.deltaY > 0 ? -1 : 1;
		const min = parseFloat(qrSizeInput.min) || 0.1;
		const next = Math.max(min, current + step * direction);
		qrSizeInput.value = STATE.unit === 'mil' ? Math.round(next) : next.toFixed(2);
		generateBarcode();
	});

	selectElement.addEventListener('change', () => {
		updateFormVisibility();
		generateBarcode();
	});
	dataInput.addEventListener('input', generateBarcode);
	scaleInput.addEventListener('input', () => {
		scaleValueDisplay.textContent = scaleInput.value;
		generateBarcode();
	});
	paddingInput.addEventListener('input', () => {
		paddingValueDisplay.textContent = paddingInput.value;
		generateBarcode();
	});
	eclevelSelect.addEventListener('change', generateBarcode);
	includeTextInput.addEventListener('change', generateBarcode);
	qrSizeInput.addEventListener('input', generateBarcode);
	invertCheckbox.addEventListener('change', generateBarcode);

	const throttled = createThrottledColorUpdate();
	colorForeInput.addEventListener('input', throttled);
	colorBackInput.addEventListener('input', throttled);

	layerSelect.addEventListener('change', (e) => (STATE.currentLayer = e.target.value));
	typeImageBtn.addEventListener('click', () => setOutputType('image'));
	typeVectorBtn.addEventListener('click', () => setOutputType('vector'));
	unitMmBtn.addEventListener('click', () => setUnit('mm'));
	unitMilBtn.addEventListener('click', () => setUnit('mil'));

	$('generate-btn').addEventListener('click', generateBarcode);
	canvasWrapper.addEventListener('click', () => {
		const canvas = $('barcode-canvas');
		if (canvas.width === 0 || canvasWrapper.style.cursor === 'not-allowed') return;
		void handlePlace();
	});
	$('save-btn').addEventListener('click', saveAsPng);
}

window.addEventListener('load', init);
// 窗口失焦时停止跟随（原实现语义：只是停，不作为"落地"信号）
window.onblur = () => placer.stop();
