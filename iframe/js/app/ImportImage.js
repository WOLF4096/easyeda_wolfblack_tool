/*! 由 npm run build:iframe 从 iframe/js/src 生成，请勿直接修改本文件 */
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

  // iframe/js/src/app/import-image/layout.js
  var NAME_PATTERN = /^(T|B|L)(\d+|S).*\.(png|jpg|jpeg|bmp)$/i;
  var ALIAS_PATTERN = /^(TOP|BOT).*\.(png|jpg|jpeg|bmp)$/i;
  function gridSize(count) {
    return Math.ceil(Math.sqrt(Number(count) || 0));
  }
  function parseFileNameOrder(files) {
    const list = Array.isArray(files) ? files : [];
    const parsed = parseFileNames(list);
    if (!parsed.every((item) => item.valid)) return noSpecialLayout(list);
    const groups = splitGroups(resolveItems(parsed));
    if (!isSideCountValid(groups.lGroup.length)) return noSpecialLayout(list);
    return buildSpecialLayout(list, groups);
  }
  function noSpecialLayout(list) {
    return { ordered: list, layoutMap: null, useSpecial: false };
  }
  function parseFileNames(list) {
    return list.map((file, idx) => {
      const name = String(file && file.name ? file.name : "");
      let match = name.match(NAME_PATTERN);
      if (match) return { idx, type: "normal", prefix: match[1].toUpperCase(), suffix: match[2].toUpperCase(), valid: true };
      match = name.match(ALIAS_PATTERN);
      if (match) return { idx, type: "alias", alias: match[1].toUpperCase(), valid: true };
      return { idx, valid: false };
    });
  }
  function maxSideNumber(parsed) {
    const lNumbers = parsed.filter((p) => p.type === "normal" && p.prefix === "L" && p.suffix !== "S").map((p) => parseInt(p.suffix, 10)).filter((num) => !isNaN(num));
    return lNumbers.length > 0 ? Math.max(...lNumbers) : 1;
  }
  function resolveItems(parsed) {
    const maxL = maxSideNumber(parsed);
    return parsed.map((p) => {
      if (p.type === "normal") return { idx: p.idx, prefix: p.prefix, suffix: p.suffix };
      return p.alias === "TOP" ? { idx: p.idx, prefix: "L", suffix: "1" } : { idx: p.idx, prefix: "L", suffix: String(maxL) };
    });
  }
  function splitGroups(items) {
    const tGroup = items.filter((p) => p.prefix === "T" && p.suffix !== "S");
    const bGroup = items.filter((p) => p.prefix === "B" && p.suffix !== "S");
    const lGroup = items.filter((p) => p.prefix === "L");
    const tsFile = items.find((p) => p.prefix === "T" && p.suffix === "S");
    const bsFile = items.find((p) => p.prefix === "B" && p.suffix === "S");
    tGroup.sort((a, b) => parseInt(b.suffix, 10) - parseInt(a.suffix, 10));
    bGroup.sort((a, b) => parseInt(b.suffix, 10) - parseInt(a.suffix, 10));
    lGroup.sort((a, b) => parseInt(a.suffix, 10) - parseInt(b.suffix, 10));
    return { tGroup, bGroup, lGroup, tsFile, bsFile };
  }
  function isSideCountValid(lCount) {
    return lCount === 0 || lCount >= 2 && lCount % 2 === 0;
  }
  function buildSpecialLayout(list, groups) {
    const leftOrder = [...groups.tGroup];
    if (groups.tsFile) leftOrder.push(groups.tsFile);
    let rightL = [];
    const lCount = groups.lGroup.length;
    if (lCount > 0) {
      const half = lCount / 2;
      leftOrder.push(...groups.lGroup.slice(0, half));
      rightL = groups.lGroup.slice(half).reverse();
    }
    const rightOrder = [...groups.bGroup];
    if (groups.bsFile) rightOrder.push(groups.bsFile);
    rightOrder.push(...rightL);
    return interleave(list, leftOrder, rightOrder);
  }
  function interleave(list, leftOrder, rightOrder) {
    const ordered = [];
    const layoutMap = /* @__PURE__ */ new Map();
    const maxRows = Math.max(leftOrder.length, rightOrder.length);
    for (let row = 0; row < maxRows; row++) {
      if (row < leftOrder.length) {
        layoutMap.set(ordered.length, { col: "left", row });
        ordered.push(list[leftOrder[row].idx]);
      }
      if (row < rightOrder.length) {
        layoutMap.set(ordered.length, { col: "right", row });
        ordered.push(list[rightOrder[row].idx]);
      }
    }
    return { ordered, layoutMap, useSpecial: true };
  }
  function computeOrigins(input) {
    const total = Number(input.totalImages) || 0;
    const origins = [];
    if (input.useSpecial && input.layoutMap) {
      for (let i = 0; i < total; i++) {
        const pos = input.layoutMap.get(i);
        if (!pos) {
          origins.push({ x: input.originX, y: input.originY });
          continue;
        }
        origins.push({
          x: input.originX + (pos.col === "right" ? input.imgWidth : 0),
          y: input.originY - pos.row * input.imgHeight
        });
      }
      return origins;
    }
    const size = gridSize(total);
    const side = Math.max(input.imgWidth, input.imgHeight);
    for (let idx = 0; idx < total; idx++) {
      const row = Math.floor(idx / size);
      const col = idx % size;
      origins.push({ x: input.originX + col * side, y: input.originY - row * side });
    }
    return origins;
  }

  // iframe/js/src/app/import-image/pixel.js
  var MM_TO_MIL = 39.37007874015748;
  var MIL_TO_MM = 0.0254;
  var DPI_PRESETS = Object.freeze([300, 600, 900, 1200, 2400, 4800]);
  function perInch(unit) {
    return unit === "mm" ? 25.4 : 1e3;
  }
  function sizeFromDpi(pxWidth, pxHeight, dpi, unit) {
    const scale = perInch(unit);
    const safeDpi = Number(dpi) > 0 ? Number(dpi) : 1;
    return {
      width: Number(pxWidth) / safeDpi * scale,
      height: Number(pxHeight) / safeDpi * scale
    };
  }
  function dpiFromSize(pxWidth, pxHeight, width, height, unit) {
    const scale = perInch(unit);
    const widthInch = Number(width) / scale;
    const heightInch = Number(height) / scale;
    if (!(widthInch > 0) || !(heightInch > 0)) return 0;
    const dpiX = Math.round(Number(pxWidth) / widthInch);
    const dpiY = Math.round(Number(pxHeight) / heightInch);
    return Math.round((dpiX + dpiY) / 2);
  }
  function toMilSize(width, height, unit) {
    const w = Number(width);
    const h = Number(height);
    const safeW = Number.isFinite(w) ? w : 0;
    const safeH = Number.isFinite(h) ? h : 0;
    if (unit === "mm") return { width: safeW * MM_TO_MIL, height: safeH * MM_TO_MIL };
    return { width: safeW, height: safeH };
  }

  // iframe/js/src/app/import-image/index.js
  var TILE_SIZE = 1800;
  var JPEG_QUALITY = 0.8;
  var FOLLOW_MS = 50;
  var $ = (id) => document.getElementById(id);
  var dpiSlider = $("dpiSlider");
  var widthInput = $("widthInput");
  var heightInput = $("heightInput");
  var unitOptions = document.querySelectorAll(".unit-option");
  var placeImageBtn = $("placeImageBtn");
  var layerOptions = document.querySelectorAll(".layer-option");
  var selectImageBtn = $("selectImageBtn");
  var customDpiInput = $("customDpiInput");
  var dpiValueItems = document.querySelectorAll(".dpi-value-item");
  var sliceimportCheckbox = $("sliceimport");
  var aspectRatioCheckbox = $("aspectRatioCheckbox");
  var currentUnit = "mil";
  var currentDpi = 1200;
  var currentLayer = "DOC";
  var originalAspectRatio = 1;
  var currentImage = null;
  var imagesArray = [];
  var objectUrls = [];
  var isPlacingActive = false;
  var isProcessing = false;
  var currentPlacedId = null;
  var lastPlacedX = 0;
  var lastPlacedY = 0;
  var isSliceEnabled = false;
  var isCalculatingFromDpi = false;
  var pendingTiles = [];
  var totalImagesCount = 0;
  var specialLayoutMap = null;
  var useSpecialLayout = false;
  function revokeAllObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }
  function renderGrid(files, twoColumns = false) {
    const gridContainer = $("gridPreview");
    gridContainer.innerHTML = "";
    if (!files.length) {
      gridContainer.style.display = "none";
      return;
    }
    gridContainer.style.display = "grid";
    gridContainer.style.gridTemplateColumns = twoColumns ? "repeat(2, minmax(0, 1fr))" : `repeat(${gridSize(files.length)}, minmax(0, 1fr))`;
    for (const file of files) {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      const item = document.createElement("div");
      item.className = "grid-item";
      const img = document.createElement("img");
      img.src = url;
      img.alt = file.name;
      img.onerror = () => console.error(`图片加载失败: ${file.name}`);
      item.appendChild(img);
      gridContainer.appendChild(item);
    }
  }
  function updateGridItemAspectRatio(ratio) {
    document.querySelectorAll(".grid-item").forEach((item) => item.style.aspectRatio = ratio);
  }
  function syncDpiUi(dpi) {
    const index = DPI_PRESETS.indexOf(dpi);
    if (index !== -1) {
      dpiSlider.value = 5 - index;
      dpiValueItems.forEach((item, i) => item.classList.toggle("active", i === index));
    } else {
      dpiValueItems.forEach((item) => item.classList.remove("active"));
    }
    customDpiInput.value = dpi;
  }
  function writeSize(width, height) {
    widthInput.value = width.toFixed(2);
    heightInput.value = height.toFixed(2);
  }
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
      console.error("无法加载图片获取尺寸");
    };
    img.src = url;
  }
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
  function setCurrentDpiAndRecalc(dpi) {
    if (!currentImage || !aspectRatioCheckbox.checked) return;
    currentDpi = dpi;
    syncDpiUi(currentDpi);
    calculateDimensionsFromDpi();
  }
  function currentLayerId() {
    if (currentLayer === "TS") return LAYER.TOP_SILKSCREEN;
    if (currentLayer === "BS") return LAYER.BOTTOM_SILKSCREEN;
    return LAYER.DOCUMENT;
  }
  function currentPlaceSize() {
    return toMilSize(parseFloat(widthInput.value), parseFloat(heightInput.value), currentUnit);
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function cropToBase64(img, sx, sy, sw, sh) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      canvas.toBlob(
        (blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    });
  }
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
      return [{ base64, relX: 0, relY: 0, width: pcbWidth, height: pcbHeight }];
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
            base64,
            relX: sx / pxWidth * pcbWidth,
            relY: sy / pxHeight * pcbHeight,
            width: sw / pxWidth * pcbWidth,
            height: sh / pxHeight * pcbHeight
          }))
        );
      }
    }
    const tiles = await Promise.all(jobs);
    URL.revokeObjectURL(img.src);
    return tiles;
  }
  async function prepareAllTiles(files, pcbWidth, pcbHeight) {
    const tiles = [];
    for (let idx = 0; idx < files.length; idx++) {
      const list = await generateTiles(files[idx], pcbWidth, pcbHeight);
      for (const tile of list) tiles.push({ ...tile, imgIndex: idx });
    }
    return { tiles, totalImages: files.length };
  }
  var placer = createFollowPlacer({
    getPoint: async () => {
      const host = getEda();
      return host && host.pcb_SelectControl ? host.pcb_SelectControl.getCurrentMousePosition() : null;
    },
    intervalMs: FOLLOW_MS
  });
  async function startPlaceTile(tile) {
    const host = getEda();
    try {
      const created = await host.pcb_PrimitiveObject.create(currentLayerId(), 0, 0, tile.base64, toApiLength(tile.width), toApiLength(tile.height), 0, false, "img", false);
      if (!created) throw new Error("创建图像图元失败（API 返回空）");
      currentPlacedId = created.getState_PrimitiveId();
      placer.start(async (point) => {
        await host.pcb_PrimitiveObject.modify(currentPlacedId, { topLeftX: point.x, topLeftY: point.y });
        lastPlacedX = point.x;
        lastPlacedY = point.y;
      });
      return true;
    } catch (err) {
      console.error("放置 tile 失败:", err);
      toast("放置失败，请重试", "error");
      return false;
    }
  }
  async function finishCurrentPlaceAndContinue() {
    placer.stop();
    const host = getEda();
    if (!currentPlacedId) {
      cleanUpAndClose();
      return;
    }
    const firstTile = pendingTiles[0];
    const originX = lastPlacedX - firstTile.relX;
    const originY = lastPlacedY + firstTile.relY;
    const { width: imgWidth, height: imgHeight } = currentPlaceSize();
    const origins = computeOrigins({
      totalImages: totalImagesCount,
      imgWidth,
      imgHeight,
      originX,
      originY,
      layoutMap: specialLayoutMap,
      useSpecial: useSpecialLayout
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
          "img",
          false
        );
      } catch (err) {
        console.error(`创建 tile 失败 (imgIndex=${tile.imgIndex}):`, err);
      }
    }
    cleanUpAndClose();
  }
  function cleanUpAndClose() {
    currentPlacedId = null;
    isPlacingActive = false;
    pendingTiles = [];
    totalImagesCount = 0;
    specialLayoutMap = null;
    useSpecialLayout = false;
    if (imagesArray.length === 0) placeImageBtn.disabled = true;
    const host = getEda();
    if (host && host.sys_IFrame) host.sys_IFrame.closeIFrame("ImportImage");
  }
  async function handlePlaceImage() {
    if (isPlacingActive) {
      toast("正在放置中，请先完成当前操作", "warning");
      return;
    }
    if (isProcessing) {
      toast("正在处理图片，请稍候...", "warning");
      return;
    }
    if (!imagesArray.length) {
      toast("请先选择图片", "error");
      return;
    }
    const { width, height } = currentPlaceSize();
    if (width <= 0 || height <= 0) {
      toast("请输入有效的宽度和高度", "error");
      return;
    }
    const host = getEda();
    if (!host) {
      toast("未检测到 EDA 运行环境", "error");
      return;
    }
    isSliceEnabled = sliceimportCheckbox.checked;
    isProcessing = true;
    toast("正在处理图片，请稍候...", "info");
    let prepared;
    try {
      prepared = await prepareAllTiles(imagesArray, width, height);
    } catch (err) {
      console.error("图片处理失败:", err);
      toast("图片处理失败，请重试", "error");
      isProcessing = false;
      return;
    }
    pendingTiles = prepared.tiles;
    totalImagesCount = prepared.totalImages;
    isPlacingActive = true;
    isProcessing = false;
    if (host.sys_IFrame) host.sys_IFrame.hideIFrame("ImportImage");
    await startPlaceTile(pendingTiles[0]);
  }
  async function handleImageSelect() {
    if (isPlacingActive) {
      toast("请先完成当前图片放置", "warning");
      return;
    }
    placer.stop();
    try {
      const files = await new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".png,.jpg,.jpeg,.bmp";
        input.onchange = () => resolve(Array.from(input.files));
        input.click();
      });
      if (!files.length) return;
      const validTypes = ["image/png", "image/jpeg", "image/bmp"];
      if (files.some((file) => !validTypes.includes(String(file.type).toLowerCase()))) {
        toast("仅支持 PNG、JPG、JPEG、BMP 格式", "error");
        return;
      }
      revokeAllObjectUrls();
      const { ordered, layoutMap, useSpecial } = parseFileNameOrder(files);
      specialLayoutMap = layoutMap;
      useSpecialLayout = useSpecial;
      imagesArray = ordered;
      renderGrid(imagesArray, useSpecialLayout);
      document.querySelector(".preview-placeholder").style.display = "none";
      $("previewImage").style.display = "none";
      loadImageToCurrent(imagesArray[0]);
      isPlacingActive = false;
    } catch (error) {
      console.error("选择图像时出错:", error);
    }
  }
  window.onblur = async () => {
    if (isPlacingActive) await finishCurrentPlaceAndContinue();
  };
  unitOptions.forEach((option) => {
    option.addEventListener("click", () => {
      if (option.classList.contains("active")) return;
      unitOptions.forEach((item) => item.classList.remove("active"));
      option.classList.add("active");
      const oldUnit = currentUnit;
      currentUnit = option.dataset.unit;
      if (currentImage && widthInput.value && heightInput.value) {
        if (oldUnit === "mm" && currentUnit === "mil") {
          widthInput.value = (parseFloat(widthInput.value) * MM_TO_MIL).toFixed(2);
          heightInput.value = (parseFloat(heightInput.value) * MM_TO_MIL).toFixed(2);
        } else if (oldUnit === "mil" && currentUnit === "mm") {
          widthInput.value = (parseFloat(widthInput.value) * MIL_TO_MM).toFixed(2);
          heightInput.value = (parseFloat(heightInput.value) * MIL_TO_MM).toFixed(2);
        }
        calculateDpi();
      }
    });
  });
  layerOptions.forEach((option) => {
    option.addEventListener("click", () => {
      if (option.classList.contains("active")) return;
      layerOptions.forEach((item) => item.classList.remove("active"));
      option.classList.add("active");
      currentLayer = option.dataset.layer;
    });
  });
  widthInput.addEventListener("input", () => {
    if (isCalculatingFromDpi) return;
    calculateDpi();
    if (aspectRatioCheckbox.checked && currentImage) {
      const width = parseFloat(widthInput.value);
      if (!isNaN(width)) heightInput.value = (width / originalAspectRatio).toFixed(2);
    }
  });
  heightInput.addEventListener("input", () => {
    if (isCalculatingFromDpi) return;
    calculateDpi();
    if (aspectRatioCheckbox.checked && currentImage) {
      const height = parseFloat(heightInput.value);
      if (!isNaN(height)) widthInput.value = (height * originalAspectRatio).toFixed(2);
    }
  });
  function toggleAspectRatio() {
    if (aspectRatioCheckbox.checked) {
      customDpiInput.disabled = false;
      dpiSlider.disabled = false;
      dpiValueItems.forEach((item) => item.style.pointerEvents = "auto");
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
    dpiValueItems.forEach((item) => item.style.pointerEvents = "none");
    dpiValueItems.forEach((item) => item.classList.remove("active"));
    customDpiInput.value = "";
    currentDpi = null;
  }
  aspectRatioCheckbox.addEventListener("change", toggleAspectRatio);
  dpiSlider.addEventListener("input", () => {
    const index = 5 - parseInt(dpiSlider.value, 10);
    setCurrentDpiAndRecalc(DPI_PRESETS[index]);
  });
  dpiValueItems.forEach((item, index) => {
    item.addEventListener("click", () => setCurrentDpiAndRecalc(DPI_PRESETS[index]));
  });
  customDpiInput.addEventListener("input", () => {
    const dpi = parseInt(customDpiInput.value, 10);
    if (isNaN(dpi) || dpi <= 0) return;
    currentDpi = dpi;
    syncDpiUi(currentDpi);
    if (aspectRatioCheckbox.checked && currentImage) calculateDimensionsFromDpi();
  });
  sliceimportCheckbox.addEventListener("change", () => {
    isSliceEnabled = sliceimportCheckbox.checked;
  });
  isSliceEnabled = sliceimportCheckbox.checked;
  selectImageBtn.addEventListener("click", handleImageSelect);
  placeImageBtn.addEventListener("click", handlePlaceImage);
  placeImageBtn.disabled = true;
})();
