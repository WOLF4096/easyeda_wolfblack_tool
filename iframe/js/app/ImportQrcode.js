/*!
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 *
 * 由 npm run build:iframe 从 iframe/js/src 生成，请勿直接修改本文件
 */
"use strict";
(() => {
  // iframe/js/src/core/eda.js
  function getEda() {
    try {
      if (typeof eda !== "undefined" && eda) return eda;
    } catch (e) {
    }
    try {
      if (globalThis.parent && globalThis.parent !== globalThis && globalThis.parent.eda) return globalThis.parent.eda;
    } catch (e) {
    }
    return globalThis.eda || null;
  }

  // iframe/js/src/core/layer.js
  var LAYER = Object.freeze({
    TOP: 1,
    BOTTOM: 2,
    TOP_SILKSCREEN: 3,
    BOTTOM_SILKSCREEN: 4,
    TOP_SOLDER_MASK: 5,
    BOTTOM_SOLDER_MASK: 6,
    TOP_PASTE_MASK: 7,
    BOTTOM_PASTE_MASK: 8,
    TOP_ASSEMBLY: 9,
    BOTTOM_ASSEMBLY: 10,
    BOARD_OUTLINE: 11,
    MULTI: 12,
    // 多层：通孔焊盘 / 过孔
    DOCUMENT: 13,
    MECHANICAL: 14,
    INNER_1: 15,
    INNER_30: 44,
    HOLE: 47,
    COMPONENT_SHAPE: 48,
    COMPONENT_MARKING: 49,
    CUSTOM_1: 71,
    CUSTOM_30: 100
  });

  // iframe/js/src/core/length.js
  function toApiLength(value, digits = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    const rounded = Number(num.toFixed(digits));
    if (rounded === 0 && num !== 0) return num;
    return rounded;
  }

  // iframe/js/src/pcb/placement.js
  function createFollowPlacer(options = {}) {
    const timers = options.timers || {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (handle2) => globalThis.clearInterval(handle2)
    };
    const getPoint = options.getPoint;
    const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 20;
    let handle = null;
    let busy = false;
    function start(apply) {
      stop();
      if (typeof getPoint !== "function" || typeof apply !== "function") return false;
      handle = timers.setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const point = await getPoint();
          if (point) await apply(point);
        } catch (e) {
          stop();
        } finally {
          busy = false;
        }
      }, intervalMs);
      return true;
    }
    function stop() {
      if (handle === null) return;
      timers.clearInterval(handle);
      handle = null;
    }
    function running() {
      return handle !== null;
    }
    return { start, stop, running };
  }

  // iframe/js/src/ui/toast.js
  var TOAST_LEVEL = Object.freeze({
    info: "info",
    success: "success",
    warn: "warning",
    error: "error",
    warning: "warning",
    legacy: 2
  });
  var BANNER_ID = "__wolf_notice";
  function normalizeLevel(level) {
    if (typeof level === "number") return Number.isFinite(level) ? level : TOAST_LEVEL.info;
    if (typeof level !== "string") return TOAST_LEVEL.info;
    const key = level.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TOAST_LEVEL, key) ? TOAST_LEVEL[key] : level;
  }
  function banner(doc, text, timeoutMs) {
    if (!doc || !doc.body || typeof doc.createElement !== "function") return false;
    let bar = doc.getElementById(BANNER_ID);
    if (!bar) {
      bar = doc.createElement("div");
      bar.id = BANNER_ID;
      bar.style.cssText = "position:fixed;left:0;right:0;top:0;padding:8px 12px;background:#5a1d1d;color:#fff;font:13px/1.5 sans-serif;z-index:9999";
      doc.body.appendChild(bar);
    }
    bar.textContent = text;
    setTimeout(() => {
      if (typeof bar.remove === "function") bar.remove();
    }, timeoutMs);
    return true;
  }
  function showOnHost(host, text, type) {
    try {
      if (!host || !host.sys_Message || typeof host.sys_Message.showToastMessage !== "function") return false;
      host.sys_Message.showToastMessage(text, type);
      return true;
    } catch (e) {
      return false;
    }
  }
  function toast(message, level = TOAST_LEVEL.info, opts = {}) {
    const doc = opts.doc || globalThis.document;
    const host = opts.host === void 0 ? getEda() : opts.host;
    const text = message === null || message === void 0 ? "" : String(message);
    if (showOnHost(host, text, normalizeLevel(level))) return "host";
    return banner(doc, text, opts.timeoutMs === void 0 ? 3e3 : opts.timeoutMs) ? "dom" : "none";
  }

  // iframe/js/src/app/import-qrcode/barcode.js
  var COMMON_CODES = [
    { id: "qrcode", name: "QR Code", cn: "二维码" },
    { id: "datamatrix", name: "Data Matrix", cn: "数据矩阵码" },
    { id: "microqrcode", name: "Micro QR Code", cn: "微型二维码" },
    { id: "azteccode", name: "Aztec Code", cn: "阿兹特克码" },
    { id: "code128", name: "Code 128", cn: "128码" },
    { id: "code39", name: "Code 39", cn: "39码" },
    { id: "pdf417", name: "PDF417", cn: "便携式数据文件" }
  ];
  var UNCOMMON_CODES = [
    { id: "auspost", name: "AusPost", cn: "澳大利亚邮政码" },
    { id: "aztecrune", name: "Aztec Runes", cn: "阿兹特克符文" },
    { id: "bc412", name: "BC412", cn: "BC412码" },
    { id: "channelcode", name: "Channel Code", cn: "通道码" },
    { id: "codablockf", name: "Codablock F", cn: "F区段码" },
    { id: "codabar", name: "Codabar", cn: "库德巴码" },
    { id: "code11", name: "Code 11", cn: "11码" },
    { id: "code16k", name: "Code 16K", cn: "16K码" },
    { id: "code2of5", name: "Code 2 of 5", cn: "25码" },
    { id: "code32", name: "Code 32", cn: "意大利药监码" },
    { id: "code93", name: "Code 93", cn: "93码" },
    { id: "codeone", name: "Code One", cn: "一号码" },
    { id: "coop2of5", name: "COOP 2 of 5", cn: "COOP25码" },
    { id: "daft", name: "DAFT Code", cn: "DAFT码" },
    { id: "datalogic2of5", name: "Datalogic 2 of 5", cn: "Datalogic 25码" },
    { id: "dotcode", name: "DotCode", cn: "点阵码" },
    { id: "ean13", name: "EAN-13", cn: "欧洲商品条码13" },
    { id: "ean14", name: "EAN-14", cn: "欧洲商品条码14" },
    { id: "ean8", name: "EAN-8", cn: "欧洲商品条码8" },
    { id: "flattermarken", name: "Flattermarken", cn: "Flattermarken码" },
    { id: "gs1-128", name: "GS1-128", cn: "GS1-128码" },
    { id: "gs1datamatrix", name: "GS1 Data Matrix", cn: "GS1数据矩阵码" },
    { id: "gs1qrcode", name: "GS1 QR Code", cn: "GS1二维码" },
    { id: "hanxin", name: "Han Xin Code", cn: "汉信码" },
    { id: "hibcazteccode", name: "HIBC Aztec Code", cn: "HIBC阿兹特克码" },
    { id: "hibccodablockf", name: "HIBC Codablock F", cn: "HIBC F区段码" },
    { id: "hibccode128", name: "HIBC Code 128", cn: "HIBC 128码" },
    { id: "hibccode39", name: "HIBC Code 39", cn: "HIBC 39码" },
    { id: "hibcdatamatrix", name: "HIBC Data Matrix", cn: "HIBC数据矩阵码" },
    { id: "hibcmicropdf417", name: "HIBC MicroPDF417", cn: "HIBC微型PDF417" },
    { id: "hibcpdf417", name: "HIBC PDF417", cn: "HIBC PDF417" },
    { id: "hibcqrcode", name: "HIBC QR Code", cn: "HIBC二维码" },
    { id: "iata2of5", name: "IATA 2 of 5", cn: "IATA 25码" },
    { id: "identcode", name: "Deutsche Post Identcode", cn: "德国邮政识别码" },
    { id: "industrial2of5", name: "Industrial 2 of 5", cn: "工业25码" },
    { id: "interleaved2of5", name: "Interleaved 2 of 5", cn: "交叉25码" },
    { id: "isbn", name: "ISBN", cn: "国际标准书号" },
    { id: "ismn", name: "ISMN", cn: "国际标准音乐出版物号" },
    { id: "issn", name: "ISSN", cn: "国际标准连续出版物号" },
    { id: "itf14", name: "ITF-14", cn: "ITF-14码" },
    { id: "japanpost", name: "Japan Post", cn: "日本邮政码" },
    { id: "kix", name: "KIX", cn: "荷兰KIX码" },
    { id: "leitcode", name: "Deutsche Post Leitcode", cn: "德国邮政路由码" },
    { id: "matrix2of5", name: "Matrix 2 of 5", cn: "矩阵25码" },
    { id: "maxicode", name: "MaxiCode", cn: "MaxiCode码" },
    { id: "micropdf417", name: "MicroPDF417", cn: "微型PDF417" },
    { id: "msi", name: "MSI", cn: "MSI普莱西码" },
    { id: "onecode", name: "USPS Intelligent Mail", cn: "USPS智能邮件码" },
    { id: "pharmacode", name: "Pharmacode", cn: "制药码" },
    { id: "pharmacode2", name: "Two-track Pharmacode", cn: "双轨制药码" },
    { id: "planet", name: "PLANET", cn: "PLANET码" },
    { id: "plessey", name: "Plessey", cn: "普莱西码" },
    { id: "posicode", name: "PosiCode", cn: "PosiCode码" },
    { id: "postnet", name: "POSTNET", cn: "POSTNET码" },
    { id: "pzn", name: "PZN", cn: "德国药品中心码" },
    { id: "rationalizedCodabar", name: "Rationalized Codabar", cn: "合理化库德巴码" },
    { id: "raw", name: "Raw", cn: "原始数据码" },
    { id: "royalmail", name: "Royal Mail", cn: "英国皇家邮政码" },
    { id: "sscc18", name: "SSCC-18", cn: "SSCC-18码" },
    { id: "symbol", name: "Symbol", cn: "符号码" },
    { id: "telepen", name: "Telepen", cn: "Telepen码" },
    { id: "telepennumeric", name: "Telepen Numeric", cn: "数字Telepen码" },
    { id: "ultracode", name: "Ultracode", cn: "超码" },
    { id: "upca", name: "UPC-A", cn: "通用产品代码A" },
    { id: "upce", name: "UPC-E", cn: "通用产品代码E" }
  ];
  var QR_CODES_WITH_ECL = ["qrcode", "microqrcode", "gs1qrcode", "hibcqrcode"];
  var TWO_D_CODES_NO_TEXT = ["datamatrix", "qrcode", "microqrcode", "azteccode", "pdf417", "micropdf417", "maxicode", "dotcode", "hanxin", "gs1datamatrix", "gs1qrcode", "hibcazteccode", "hibcdatamatrix", "hibcmicropdf417", "hibcpdf417", "hibcqrcode", "codeone", "aztecrune", "flattermarken", "ultracode"];
  function buildOptions(input) {
    let barcolor = "000000";
    let bgcolor = "ffffff";
    if (input.outputType === "image") {
      barcolor = String(input.fore || "").replace(/^#/, "") || "000000";
      bgcolor = String(input.back || "").replace(/^#/, "") || "ffffff";
    } else if (input.outputType === "vector" && input.inverted) {
      barcolor = "ffffff";
      bgcolor = "000000";
    }
    const options = {
      bcid: input.bcid,
      text: input.text,
      scale: input.scale,
      padding: input.padding,
      textxalign: "center",
      barcolor,
      textcolor: barcolor,
      backgroundcolor: bgcolor
    };
    if (QR_CODES_WITH_ECL.includes(input.bcid)) options.eclevel = input.eclevel;
    if (!TWO_D_CODES_NO_TEXT.includes(input.bcid)) options.includetext = input.includeText;
    return options;
  }
  function computeDpi(maxPixels, physSize, unit) {
    const pixels = Number(maxPixels);
    const size = Number(physSize);
    if (!Number.isFinite(pixels) || !Number.isFinite(size) || size <= 0) return 0;
    if (unit === "mm") return Math.round(pixels * 25.4 / size);
    if (unit === "mil") return Math.round(pixels * 1e3 / size);
    return 0;
  }

  // iframe/js/src/app/import-qrcode/index.js
  var MM_TO_MIL = 39.37007874015748;
  var LAYER_OPTIONS = {
    image: [
      { value: "TOP_SILKSCREEN", text: "顶层丝印层", default: true },
      { value: "BOTTOM_SILKSCREEN", text: "底层丝印层" },
      { value: "DOCUMENT", text: "文档层" }
    ],
    vector: [
      { value: "TOP", text: "顶层" },
      { value: "TOP_SILKSCREEN", text: "顶层丝印层", default: true },
      { value: "BOTTOM", text: "底层" },
      { value: "BOTTOM_SILKSCREEN", text: "底层丝印层" },
      { value: "TOP_SOLDER_MASK", text: "顶层阻焊" },
      { value: "BOTTOM_SOLDER_MASK", text: "底层阻焊" }
    ]
  };
  var STATE = { outputType: "image", unit: "mil", currentLayer: "TOP_SILKSCREEN", layerMap: {}, primitiveId: null };
  var $ = (id) => document.getElementById(id);
  var selectElement = $("barcode-type");
  var dataInput = $("barcode-data");
  var scaleInput = $("barcode-scale");
  var paddingInput = $("barcode-padding");
  var eclevelSelect = $("barcode-eclevel");
  var includeTextInput = $("barcode-include-text");
  var scaleValueDisplay = $("scale-value");
  var paddingValueDisplay = $("padding-value");
  var resolutionInfo = $("resolution-info");
  var errorDiv = $("error-message");
  var typeImageBtn = $("type-image");
  var typeVectorBtn = $("type-vector");
  var vectorControls = $("vector-controls");
  var imageControls = $("image-controls");
  var colorForeInput = $("color-fore");
  var colorBackInput = $("color-back");
  var invertCheckbox = $("invert-image");
  var unitMmBtn = $("unit-mm");
  var unitMilBtn = $("unit-mil");
  var qrSizeInput = $("qr-size");
  var layerSelect = $("layer-select");
  var canvasWrapper = $("canvas-wrapper");
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
        DRILL_DRAWING: hostMap.DRILL_DRAWING
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
      MECHANICAL: LAYER.MECHANICAL
    };
  }
  function updateLayerOptions() {
    layerSelect.innerHTML = "";
    for (const option of LAYER_OPTIONS[STATE.outputType]) {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.text;
      if (option.default) {
        el.selected = true;
        STATE.currentLayer = option.value;
      }
      layerSelect.appendChild(el);
    }
  }
  function setOutputType(type) {
    STATE.outputType = type;
    const isImage = type === "image";
    typeImageBtn.classList.toggle("active", isImage);
    typeVectorBtn.classList.toggle("active", !isImage);
    vectorControls.style.display = isImage ? "none" : "block";
    imageControls.style.display = isImage ? "block" : "none";
    updateLayerOptions();
    generateBarcode();
  }
  function setUnit(unit) {
    if (STATE.unit === unit) return;
    const current = parseFloat(qrSizeInput.value) || 0;
    if (current > 0) {
      if (unit === "mil" && STATE.unit === "mm") qrSizeInput.value = (current * MM_TO_MIL).toFixed(2);
      if (unit === "mm" && STATE.unit === "mil") qrSizeInput.value = (current / MM_TO_MIL).toFixed(2);
    }
    STATE.unit = unit;
    unitMmBtn.classList.toggle("active", unit === "mm");
    unitMilBtn.classList.toggle("active", unit === "mil");
    generateBarcode();
  }
  function updateFormVisibility() {
    const bcid = selectElement.value;
    $("group-eclevel").style.display = QR_CODES_WITH_ECL.includes(bcid) ? "block" : "none";
    $("group-include-text").style.display = TWO_D_CODES_NO_TEXT.includes(bcid) ? "none" : "block";
  }
  function generateBarcode() {
    errorDiv.textContent = "";
    const placeHint = $("place-hint");
    const bcid = selectElement.value;
    const text = dataInput.value;
    if (!text) {
      errorDiv.textContent = "输入数据不能为空。";
      resolutionInfo.textContent = "二维码尺寸: - × - px | - DPI";
      placeHint.style.display = "none";
      return;
    }
    const options = buildOptions({
      bcid,
      text,
      scale: parseInt(scaleInput.value, 10),
      padding: parseInt(paddingInput.value * 2, 10),
      outputType: STATE.outputType,
      inverted: invertCheckbox.checked,
      fore: colorForeInput.value,
      back: colorBackInput.value,
      eclevel: eclevelSelect.value,
      includeText: includeTextInput.checked
    });
    try {
      globalThis.bwipjs.toCanvas("barcode-canvas", options);
      const canvas = $("barcode-canvas");
      const dpi = computeDpi(Math.max(canvas.width, canvas.height), parseFloat(qrSizeInput.value) || 25.4, STATE.unit);
      resolutionInfo.textContent = `尺寸: ${canvas.width} × ${canvas.height} px | ${dpi} DPI`;
      placeHint.style.display = "block";
      canvasWrapper.style.cursor = "pointer";
    } catch (e) {
      const canvas = $("barcode-canvas");
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      errorDiv.textContent = "格式错误: " + e.message;
      resolutionInfo.textContent = "尺寸: - × - px | - DPI";
      placeHint.style.display = "none";
      canvasWrapper.style.cursor = "not-allowed";
    }
  }
  function currentLayerId() {
    return STATE.layerMap[STATE.currentLayer] || LAYER.TOP_SILKSCREEN;
  }
  var placer = createFollowPlacer({
    getPoint: async () => {
      const host = getEda();
      return host && host.pcb_SelectControl ? host.pcb_SelectControl.getCurrentMousePosition() : null;
    },
    intervalMs: 20
  });
  async function handlePlace() {
    const canvas = $("barcode-canvas");
    if (canvas.width === 0) return;
    const host = getEda();
    if (!host) {
      toast("当前非 EDA 环境，请点击“保存图片”下载。", 2);
      return;
    }
    try {
      placer.stop();
      const size = computePlaceSize(canvas);
      const layerId = currentLayerId();
      const base64 = canvas.toDataURL("image/png");
      if (STATE.outputType === "image") await placeAsImage(host, layerId, base64, size);
      else await placeAsVector(host, layerId, base64, size);
      if (host.sys_IFrame) host.sys_IFrame.hideIFrame("ImportQrcode");
    } catch (err) {
      toast("放置失败: " + err.message, "error");
      placer.stop();
    }
  }
  function computePlaceSize(canvas) {
    let width = parseFloat(qrSizeInput.value) || 25.4;
    if (STATE.unit === "mm") width *= MM_TO_MIL;
    const height = width * (canvas.height / canvas.width);
    return { apiWidth: toApiLength(width), apiHeight: toApiLength(height) };
  }
  async function placeAsImage(host, layerId, base64, size) {
    const created = await host.pcb_PrimitiveObject.create(layerId, 0, 0, base64, size.apiWidth, size.apiHeight, 0, false, "img", false);
    if (!created) throw new Error("创建图像图元失败（API 返回空）");
    STATE.primitiveId = created.getState_PrimitiveId();
    placer.start(async (pt) => host.pcb_PrimitiveObject.modify(STATE.primitiveId, { topLeftX: pt.x, topLeftY: pt.y }));
  }
  async function placeAsVector(host, layerId, base64, size) {
    const blob = await (await fetch(base64)).blob();
    const edaImage = await host.pcb_MathPolygon.convertImageToComplexPolygon(blob, size.apiWidth, size.apiHeight, 0.5, 0, 0, 0, true, false);
    if (!edaImage) throw new Error("图像转换为多边形失败");
    const created = await host.pcb_PrimitiveImage.create(0, 0, edaImage, layerId, size.apiWidth, size.apiHeight, 0, false, false);
    if (!created) throw new Error("创建图像图元失败（API 返回空）");
    STATE.primitiveId = created.getState_PrimitiveId();
    placer.start(async (pt) => host.pcb_PrimitiveImage.modify(STATE.primitiveId, { x: pt.x, y: pt.y }));
  }
  function saveAsPng() {
    const canvas = $("barcode-canvas");
    const rawText = dataInput.value;
    if (!rawText || canvas.width === 0) return;
    let fileName = rawText.replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
    if (fileName === "") fileName = "barcode";
    const link = document.createElement("a");
    link.download = fileName + ".png";
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
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
  function init() {
    const sortedUncommon = UNCOMMON_CODES.slice().sort((a, b) => a.name.localeCompare(b.name));
    const makeOption = (item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} (${item.cn})`;
      return opt;
    };
    COMMON_CODES.forEach((item) => selectElement.appendChild(makeOption(item)));
    const separator = document.createElement("option");
    separator.disabled = true;
    separator.textContent = "--------";
    selectElement.appendChild(separator);
    sortedUncommon.forEach((item) => selectElement.appendChild(makeOption(item)));
    initLayerMap();
    updateLayerOptions();
    updateFormVisibility();
    generateBarcode();
    selectElement.addEventListener("wheel", (event) => {
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
    qrSizeInput.addEventListener("wheel", (event) => {
      event.preventDefault();
      const current = parseFloat(qrSizeInput.value) || 0;
      const step = STATE.unit === "mil" ? 1 : 0.1;
      const direction = event.deltaY > 0 ? -1 : 1;
      const min = parseFloat(qrSizeInput.min) || 0.1;
      const next = Math.max(min, current + step * direction);
      qrSizeInput.value = STATE.unit === "mil" ? Math.round(next) : next.toFixed(2);
      generateBarcode();
    });
    selectElement.addEventListener("change", () => {
      updateFormVisibility();
      generateBarcode();
    });
    dataInput.addEventListener("input", generateBarcode);
    scaleInput.addEventListener("input", () => {
      scaleValueDisplay.textContent = scaleInput.value;
      generateBarcode();
    });
    paddingInput.addEventListener("input", () => {
      paddingValueDisplay.textContent = paddingInput.value;
      generateBarcode();
    });
    eclevelSelect.addEventListener("change", generateBarcode);
    includeTextInput.addEventListener("change", generateBarcode);
    qrSizeInput.addEventListener("input", generateBarcode);
    invertCheckbox.addEventListener("change", generateBarcode);
    const throttled = createThrottledColorUpdate();
    colorForeInput.addEventListener("input", throttled);
    colorBackInput.addEventListener("input", throttled);
    layerSelect.addEventListener("change", (e) => STATE.currentLayer = e.target.value);
    typeImageBtn.addEventListener("click", () => setOutputType("image"));
    typeVectorBtn.addEventListener("click", () => setOutputType("vector"));
    unitMmBtn.addEventListener("click", () => setUnit("mm"));
    unitMilBtn.addEventListener("click", () => setUnit("mil"));
    $("generate-btn").addEventListener("click", generateBarcode);
    canvasWrapper.addEventListener("click", () => {
      const canvas = $("barcode-canvas");
      if (canvas.width === 0 || canvasWrapper.style.cursor === "not-allowed") return;
      void handlePlace();
    });
    $("save-btn").addEventListener("click", saveAsPng);
  }
  window.addEventListener("load", init);
  window.onblur = () => placer.stop();
})();
