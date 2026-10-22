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

  // iframe/js/src/core/version.js
  var cachedVersion = null;
  function getEditorVersion() {
    if (cachedVersion !== null) return cachedVersion;
    try {
      const edaObj = getEda();
      if (!edaObj || !edaObj.sys_Environment || typeof edaObj.sys_Environment.getEditorCurrentVersion !== "function") {
        return "";
      }
      const version2 = edaObj.sys_Environment.getEditorCurrentVersion();
      const text = version2 === null || version2 === void 0 ? "" : String(version2).trim();
      if (text) cachedVersion = text;
      return text;
    } catch (e) {
      return "";
    }
  }
  function getVersionFamily() {
    const version2 = getEditorVersion();
    if (!version2) return "";
    if (version2.startsWith("4")) return "V4";
    if (version2.startsWith("3")) return "V3";
    if (version2.startsWith("2.2")) return "V2.2";
    if (version2.startsWith("2")) return "V2";
    return "";
  }
  function isV2() {
    const family = getVersionFamily();
    return family === "V2" || family === "V2.2";
  }

  // iframe/js/src/core/log.js
  var LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  var currentLogLevel = LOG_LEVELS.info;
  function logAt(level, ...args) {
    if ((LOG_LEVELS[level] || 0) < currentLogLevel) return;
    const method = level === "debug" ? "log" : level;
    const fn = console[method] || console.log;
    try {
      fn.apply(console, ["[狼黑工具]", ...args]);
    } catch (e) {
    }
  }
  var logger = {
    /**
     * 调试日志（默认不输出）
     *
     * @param {...*} args 日志参数
     * @returns {void}
     * @sideEffects console
     */
    debug: (...args) => logAt("debug", ...args),
    /**
     * 普通信息
     *
     * @param {...*} args 日志参数
     * @returns {void}
     * @sideEffects console
     */
    info: (...args) => logAt("info", ...args),
    /**
     * 警告
     *
     * @param {...*} args 日志参数
     * @returns {void}
     * @sideEffects console
     */
    warn: (...args) => logAt("warn", ...args),
    /**
     * 错误
     *
     * @param {...*} args 日志参数
     * @returns {void}
     * @sideEffects console
     */
    error: (...args) => logAt("error", ...args),
    /**
     * 调整日志级别
     *
     * @param {'debug'|'info'|'warn'|'error'|'off'} level 级别名，`off` 表示全部静默
     * @returns {void}
     * @sideEffects 修改模块内的当前级别
     */
    setLevel: (level) => {
      if (level === "off") {
        currentLogLevel = Number.POSITIVE_INFINITY;
        return;
      }
      if (LOG_LEVELS[level]) currentLogLevel = LOG_LEVELS[level];
    }
  };

  // iframe/js/src/core/util.js
  function escapeHtml(value) {
    if (value === null || value === void 0) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // iframe/js/src/ui/statusBar.js
  var LEVEL_CLASS = Object.freeze({
    "": "",
    info: "info",
    ok: "success",
    success: "success",
    warn: "warning",
    warning: "warning",
    err: "error",
    error: "error"
  });
  var ACCENT = "accent";
  function percentOf(done, total) {
    const d = Number(done);
    const t = Number(total);
    if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) return 0;
    return Math.max(0, Math.min(100, Math.floor(d / t * 100)));
  }
  function classOf(base, level) {
    const suffix = LEVEL_CLASS[level === void 0 ? "" : level];
    if (suffix === void 0) return base;
    return suffix ? base + " " + suffix : base;
  }
  function createStatusBar(options = {}) {
    const textEl = options.textEl || null;
    const barEl = options.barEl || null;
    const baseClass = options.baseClass || "status";
    const barBaseClass = options.barBaseClass || "status-bar";
    const widthProp = options.widthProp || "width";
    function text(message, level) {
      if (!textEl) return;
      textEl.textContent = message === null || message === void 0 ? "" : String(message);
      textEl.className = classOf(baseClass, level);
    }
    function width(percent, level) {
      if (!barEl) return;
      const p = Math.max(0, Math.min(100, Number(percent) || 0));
      barEl.style[widthProp] = p + "%";
      const suffix = level === void 0 ? ACCENT : LEVEL_CLASS[level];
      barEl.className = suffix ? barBaseClass + " " + suffix : barBaseClass;
    }
    function progress(done, total, suffix, level) {
      const p = percentOf(done, total);
      text(`${done} / ${total} ${p}%${suffix ? "　" + suffix : ""}`, level);
      width(p, level);
      return p;
    }
    function reset() {
      text("", "");
      width(0, "");
    }
    return { text, progress, width, reset };
  }

  // iframe/js/src/ui/progressTicker.js
  function advanceProgress(value, opts) {
    const to = Number(opts && opts.to);
    const step = Number(opts && opts.step);
    const next = Number(value) + (Number.isFinite(step) && step > 0 ? step : 1);
    if (!Number.isFinite(to)) return next;
    return Math.min(to, next);
  }
  function createProgressTicker(options = {}) {
    const timers = options.timers || {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (handle2) => globalThis.clearInterval(handle2)
    };
    const to = Number.isFinite(Number(options.to)) ? Number(options.to) : 99;
    const step = Number.isFinite(Number(options.step)) ? Number(options.step) : 1;
    const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 1e3;
    const onTick = typeof options.onTick === "function" ? options.onTick : null;
    let current = Number.isFinite(Number(options.from)) ? Number(options.from) : 0;
    let handle = null;
    function start() {
      if (handle !== null) return;
      handle = timers.setInterval(() => {
        const next = advanceProgress(current, { to, step });
        if (next === current) return;
        current = next;
        if (onTick) onTick(current);
      }, intervalMs);
    }
    function stop() {
      if (handle === null) return;
      timers.clearInterval(handle);
      handle = null;
    }
    function value() {
      return current;
    }
    function running() {
      return handle !== null;
    }
    return { start, stop, value, running };
  }

  // iframe/js/src/ui/download.js
  function canDownload(doc, urlApi) {
    return Boolean(doc && typeof doc.createElement === "function" && urlApi && typeof urlApi.createObjectURL === "function");
  }
  function mountAndClick(doc, a) {
    if (doc.body && typeof doc.body.appendChild === "function") doc.body.appendChild(a);
    if (typeof a.click === "function") a.click();
    if (typeof a.remove === "function") a.remove();
  }
  function downloadBlob(fileName, blob, options = {}) {
    const doc = options.doc || globalThis.document;
    const urlApi = options.urlApi || globalThis.URL;
    if (!canDownload(doc, urlApi)) return false;
    const href = urlApi.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = href;
    a.download = fileName;
    mountAndClick(doc, a);
    if (typeof urlApi.revokeObjectURL === "function") urlApi.revokeObjectURL(href);
    return true;
  }
  function downloadText(fileName, text, options = {}) {
    const mime = options.mime || "text/plain";
    const body = options.bom ? "\uFEFF" + String(text) : String(text);
    const blob = new Blob([body], { type: mime + ";charset=utf-8" });
    return downloadBlob(fileName, blob, options);
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

  // iframe/js/src/app/pcb-to-sch/model.js
  function findUuids(projectJson2, sheetUuid) {
    let schematicUuid = null;
    for (const entry of Object.entries(projectJson2.schematics || {})) {
      const uuid = entry[0];
      const sheets = entry[1].sheets || [];
      if (sheets.some((sheet) => sheet.uuid === sheetUuid)) {
        schematicUuid = uuid;
        break;
      }
    }
    if (!schematicUuid) throw new Error("未找到对应原理图UUID");
    let pcbUuid = null;
    for (const entry of Object.entries(projectJson2.boards || {})) {
      const board = entry[1];
      if (board.schematic === schematicUuid) {
        pcbUuid = board.pcb;
        break;
      }
    }
    if (!pcbUuid) throw new Error("未找到对应PCB UUID");
    return { schematicUuid, pcbUuid };
  }
  function pcbFilePath(pcbUuid) {
    return `PCB/${pcbUuid}.epcb`;
  }
  function symbolFilePath(symbolUuid) {
    return `SYMBOL/${symbolUuid}.esym`;
  }
  var ATTR_FIELD = {
    Designator: "designator",
    Name: "name",
    Device: "deviceUuid",
    Footprint: "footprintUuid"
  };
  function parsePcbContent(pcbContent) {
    const map = /* @__PURE__ */ new Map();
    const lines = String(pcbContent || "").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(data)) continue;
      applyPcbLine(map, data);
    }
    return Array.from(map.values());
  }
  function applyPcbLine(map, data) {
    const type = data[0];
    if (type === "COMPONENT") {
      const props = data[7] || {};
      map.set(data[1], {
        uniqueId: props["Unique ID"] || "",
        supplierPart: props["Supplier Part"] || "",
        designator: "",
        name: "",
        deviceUuid: "",
        footprintUuid: "",
        layer: data[3],
        x: data[4],
        y: data[5],
        rotation: data[6],
        deviceName: "",
        symbolUuid: "",
        symbolName: "",
        footprintName: "",
        pins: {}
      });
      return;
    }
    if (type === "ATTR") {
      const comp = map.get(data[3]);
      const field = ATTR_FIELD[data[7]];
      if (comp && field) comp[field] = data[8];
      return;
    }
    if (type === "PAD_NET") {
      const comp = map.get(data[1]);
      if (comp) comp.pins[data[2]] = data[3];
    }
  }
  function enrichWithSymbol(components2, projectJson2) {
    const devices = projectJson2.devices || {};
    const symbols = projectJson2.symbols || {};
    const footprints = projectJson2.footprints || {};
    for (const comp of components2) {
      applyDeviceFields(comp, devices, symbols);
      comp.footprintName = footprintTitleOf(comp.footprintUuid, footprints);
    }
  }
  function applyDeviceFields(comp, devices, symbols) {
    const device = comp.deviceUuid ? devices[comp.deviceUuid] : null;
    if (!device) {
      comp.deviceName = "";
      comp.symbolUuid = "";
      comp.symbolName = "";
      return;
    }
    comp.deviceName = device.title || "";
    comp.symbolUuid = device.attributes && device.attributes.Symbol || "";
    comp.symbolName = symbolTitleOf(comp.symbolUuid, symbols);
  }
  function symbolTitleOf(symbolUuid, symbols) {
    const symbol = symbolUuid ? symbols[symbolUuid] : null;
    return symbol ? symbol.title || "" : "";
  }
  function footprintTitleOf(footprintUuid, footprints) {
    const footprint = footprintUuid ? footprints[footprintUuid] : null;
    return footprint ? footprint.title || "" : "";
  }
  function mergeComponentsForDisplay(components2) {
    const groups = /* @__PURE__ */ new Map();
    components2.forEach((comp, index) => {
      const key = `${comp.footprintUuid}|${comp.deviceUuid}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          footprintName: comp.footprintName,
          deviceName: comp.deviceName,
          symbolName: comp.symbolName,
          designators: [],
          names: [],
          supplierParts: [],
          componentIndices: []
        });
      }
      const group = groups.get(key);
      group.designators.push(comp.designator);
      group.names.push(comp.name);
      group.supplierParts.push(comp.supplierPart);
      group.componentIndices.push(index);
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      designatorDisplay: group.designators.join(","),
      nameDisplay: [...new Set(group.names)].join(",")
    })).sort((a, b) => (a.footprintName || "").toLowerCase().localeCompare((b.footprintName || "").toLowerCase()));
  }
  function projectTitleOf(projectJson2) {
    let baseName = "project_PCB_TO_SCH";
    if (projectJson2 && projectJson2.title) baseName = projectJson2.title;
    else if (projectJson2 && projectJson2.name) baseName = projectJson2.name;
    return `${String(baseName).replace(/\.epro$/i, "")}.epro`;
  }

  // iframe/js/src/app/pcb-to-sch/symbolParser.js
  var PIN_MARGIN = 40;
  var DEFAULT_BBOX = Object.freeze([-20, -20, 20, 20]);
  function finishPart(part, pinById) {
    const pinsByNumber = {};
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let hasPin = false;
    for (const pinId in pinById) {
      const pin = pinById[pinId];
      if (!pin.number) continue;
      pinsByNumber[pin.number] = { x: pin.x, y: pin.y, angle: pin.angle, name: pin.name };
      minX = Math.min(minX, pin.x);
      maxX = Math.max(maxX, pin.x);
      minY = Math.min(minY, pin.y);
      maxY = Math.max(maxY, pin.y);
      hasPin = true;
    }
    part.pins = pinsByNumber;
    part.pinBbox = hasPin ? [minX - PIN_MARGIN, minY - PIN_MARGIN, maxX + PIN_MARGIN, maxY + PIN_MARGIN] : DEFAULT_BBOX.slice();
    return part;
  }
  function parseSymbolSource(content) {
    const state = { parts: [], currentPart: null, pinById: {} };
    for (const line of String(content || "").split("\n")) {
      if (!line.trim()) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(data)) continue;
      applySymbolLine(state, data);
    }
    if (state.currentPart) state.parts.push(finishPart(state.currentPart, state.pinById));
    return state.parts;
  }
  function applySymbolLine(state, data) {
    const type = data[0];
    if (type === "PART") {
      if (state.currentPart) state.parts.push(finishPart(state.currentPart, state.pinById));
      state.currentPart = { name: data[1], pins: {} };
      state.pinById = {};
      return;
    }
    if (!state.currentPart) return;
    if (type === "PIN") {
      state.pinById[data[1]] = pinFromLine(data);
      return;
    }
    if (type === "ATTR") applyPinAttr(state.pinById, data);
  }
  function pinFromLine(data) {
    return {
      id: data[1],
      type: data[2],
      x: data[4],
      y: data[5],
      length: data[6],
      angle: data[7],
      number: null,
      name: null
    };
  }
  function applyPinAttr(pinById, data) {
    const parent = pinById[data[2]];
    if (!parent) return;
    if (data[3] === "NUMBER") parent.number = data[4];
    else if (data[3] === "NAME") parent.name = data[4];
  }

  // iframe/js/src/app/pcb-to-sch/layout.js
  var RIGHT_LIMIT = 2560;
  var PART_GAP = 40;
  var ROW_GAP = 40;
  var GROUP_GAP = 200;
  var PART_COORD_STEP = 10;
  function splitParts(items) {
    const list = [];
    for (const comp of items) {
      const partCount = comp.partCount || 1;
      for (let partIdx = 0; partIdx < partCount; partIdx++) list.push({ comp, partIdx });
    }
    return list;
  }
  function bboxOfPart(comp, partIdx, symbolDb) {
    const parts = comp.symbolUuid ? symbolDb[comp.symbolUuid] : null;
    const part = parts && parts[partIdx];
    return part && part.pinBbox || DEFAULT_BBOX.slice();
  }
  function emptyBounds() {
    return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  }
  function planCoordLayout(items, options = {}) {
    const step = options.step === void 0 ? PART_COORD_STEP : options.step;
    const parts = [];
    const bounds = emptyBounds();
    for (const item of splitParts(items)) {
      const comp = item.comp;
      const y = comp.y + step * item.partIdx;
      parts.push({ comp, partIdx: item.partIdx, x: comp.x, y });
      bounds.minX = Math.min(bounds.minX, comp.x);
      bounds.maxX = Math.max(bounds.maxX, comp.x);
      bounds.minY = Math.min(bounds.minY, comp.y);
      bounds.maxY = Math.max(bounds.maxY, comp.y);
    }
    return { parts, bounds, nextTopY: bounds.minY - GROUP_GAP };
  }
  function planFlowLayout(items, options) {
    const startX = Number(options.startX);
    const rightLimit = options.rightLimit === void 0 ? RIGHT_LIMIT : options.rightLimit;
    const partGap = options.partGap === void 0 ? PART_GAP : options.partGap;
    const rowGap = options.rowGap === void 0 ? ROW_GAP : options.rowGap;
    const parts = [];
    const bounds = emptyBounds();
    let currentTopY = Number(options.startTopY);
    let lastRight = null;
    let minYThisRow = currentTopY;
    for (const item of splitParts(items)) {
      const bbox = bboxOfPart(item.comp, item.partIdx, options.symbolDb);
      const xmin = bbox[0];
      const ymin = bbox[1];
      const xmax = bbox[2];
      const ymax = bbox[3];
      let compX = lastRight === null ? startX - xmin : lastRight + partGap - xmin;
      const right = compX + xmax;
      if (right > rightLimit) {
        currentTopY = minYThisRow - rowGap;
        compX = startX - xmin;
        lastRight = compX + xmax;
        minYThisRow = currentTopY;
      } else {
        lastRight = right;
      }
      const compY = currentTopY - ymax;
      minYThisRow = Math.min(minYThisRow, compY + ymin);
      parts.push({ comp: item.comp, partIdx: item.partIdx, x: compX, y: compY });
      bounds.minX = Math.min(bounds.minX, compX + xmin);
      bounds.maxX = Math.max(bounds.maxX, compX + xmax);
      bounds.minY = Math.min(bounds.minY, compY + ymin);
      bounds.maxY = Math.max(bounds.maxY, compY + ymax);
    }
    return { parts, bounds, nextTopY: bounds.minY - GROUP_GAP };
  }
  function layoutGroup(items, options) {
    if (options.classify === "coord") return planCoordLayout(items);
    return planFlowLayout(items, options);
  }

  // iframe/js/src/sch/emitter.js
  function createSchWireLines(o) {
    const net = o.net;
    const startX = o.startX;
    const startY = o.startY;
    const endX = o.endX;
    const endY = o.endY;
    const isModern = !!o.isModern;
    const rotation = Number.isFinite(o.rotation) ? o.rotation : 0;
    const wireStyle = o.wireStyle || "st1";
    const attrStyle = o.attrStyle || "st1";
    const centerX = (startX + endX) / 2;
    const centerY = (startY + endY) / 2;
    if (isModern) {
      const wire2 = o.nextRow();
      const line = o.nextRow();
      const attr2 = o.nextRow();
      const wireId2 = `e${wire2.id}`;
      return [
        `{"type":"WIRE","ticket":${wire2.ticket},"id":"${wireId2}"}||{"zIndex":1}|`,
        `{"type":"LINE","ticket":${line.ticket},"id":"e${line.id}"}||{"lineGroup":"${wireId2}","startX":${startX},"startY":${startY},"endX":${endX},"endY":${endY}}|`,
        `{"type":"ATTR","ticket":${attr2.ticket},"id":"e${attr2.id}"}||{"parentId":"${wireId2}","key":"NET","value":"${net}","x":${centerX},"y":${centerY},"rotation":${rotation},"keyVisible":false,"valueVisible":true}|`
      ];
    }
    const wire = o.nextRow();
    const attr = o.nextRow();
    const wireId = `e${wire.id}`;
    return [
      `["WIRE","${wireId}",[[${startX},${startY},${endX},${endY}]],"${wireStyle}",0]`,
      `["ATTR","e${attr.id}","${wireId}","NET","${net}",0,1,${centerX},${centerY},${rotation},"${attrStyle}",0]`
    ];
  }

  // iframe/js/src/app/pcb-to-sch/wirePlan.js
  var WIRE_END = Object.freeze({
    0: (pinX, pinY, len) => ({ endX: pinX - len, endY: pinY, netT: 0 }),
    90: (pinX, pinY, len, y) => ({ endX: pinX, endY: pinY - len * y, netT: 90 }),
    180: (pinX, pinY, len) => ({ endX: pinX + len, endY: pinY, netT: 0 }),
    270: (pinX, pinY, len, y) => ({ endX: pinX, endY: pinY + len * y, netT: 90 })
  });
  function planWires(input) {
    const parts = input.symbolDb[input.comp.symbolUuid] || [];
    const part = parts[input.partIdx] || parts[0] || { pins: {} };
    const symbolPins = part.pins || {};
    const yDir = input.isV2 ? 1 : -1;
    const lines = [];
    const nextRow = () => {
      const n = input.nextId();
      return { id: n, ticket: n };
    };
    for (const entry of Object.entries(input.comp.pins || {})) {
      pushWireForPin(lines, input, symbolPins, entry, yDir, nextRow);
    }
    return lines;
  }
  function pushWireForPin(lines, input, symbolPins, entry, yDir, nextRow) {
    const pinNumber = entry[0];
    const netName = entry[1];
    if (!netName) return;
    const pinInfo = symbolPins[pinNumber];
    if (!pinInfo) return;
    const pinX = input.compX + pinInfo.x;
    const pinY = input.isV2 ? input.compY + pinInfo.y : input.compY - pinInfo.y;
    const spread = WIRE_END[pinInfo.angle] || WIRE_END[0];
    const end = spread(pinX, pinY, input.wireLength, yDir);
    lines.push(
      ...createSchWireLines({
        net: netName,
        startX: pinX,
        startY: pinY,
        endX: end.endX,
        endY: end.endY,
        rotation: end.netT,
        isModern: !input.isV2,
        nextRow
      })
    );
  }

  // iframe/js/src/app/pcb-to-sch/sourceBuilder.js
  var PADDING = 120;
  function normalizeOptions(raw) {
    const o = raw || {};
    return {
      classify: o.classify || "ref",
      genTitle: !!o.genTitle,
      genFrame: !!o.genFrame,
      genWire: !!o.genWire,
      yvalue: !!o.yvalue,
      startX: o.startX === void 0 ? 100 : o.startX,
      startY: o.startY === void 0 ? -200 : o.startY,
      wireLength: o.wireLength === void 0 ? 40 : o.wireLength,
      colSpacing: o.colSpacing === void 0 ? 150 : o.colSpacing,
      rowSpacing: o.rowSpacing === void 0 ? 150 : o.rowSpacing,
      perRow: o.perRow === void 0 ? 20 : o.perRow
    };
  }
  function partNameOf(symbolDb, comp, partIdx) {
    const parts = symbolDb[comp.symbolUuid];
    const part = parts && parts[partIdx];
    return part && part.name || comp.symbolName || "Unknown";
  }
  function q(value) {
    return JSON.stringify(value === null || value === void 0 ? "" : String(value));
  }
  function classifyGroups(components2, classify) {
    const list = Array.isArray(components2) ? components2 : [];
    if (classify === "coord") return [{ name: "坐标布局", items: list }];
    const keyOf = classify === "device" ? deviceKey : classify === "pkg" ? packageKey : refKey;
    const buckets = /* @__PURE__ */ new Map();
    for (const comp of list) {
      const key = keyOf(comp);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(comp);
    }
    return [...buckets.keys()].sort().map((name) => {
      const items = buckets.get(name);
      if (classify === "ref") items.sort(byDesignatorNumber);
      return { name, items };
    });
  }
  function refKey(comp) {
    const match = String(comp.designator || "").match(/^([A-Za-z]+)/);
    return match ? match[1] : "其他";
  }
  function deviceKey(comp) {
    return comp.deviceName || "未知器件";
  }
  function packageKey(comp) {
    return comp.footprintName || "未知封装";
  }
  function byDesignatorNumber(a, b) {
    const numOf = (comp) => parseInt((String(comp.designator || "").match(/\d+/) || ["0"])[0], 10) || 0;
    return numOf(a) - numOf(b);
  }
  function emitHeaderV2(ctx) {
    ctx.lines.push('["DOCTYPE","SCH","1.1"]');
    ctx.lines.push('["HEAD",{"originX":0,"originY":0,"version":"2","maxId":11517}]');
    ctx.lines.push('["FONTSTYLE","st1",null,null,null,null,null,null,null,null,null,null]');
    ctx.lines.push('["FONTSTYLE","st2",null,null,null,60,null,null,null,null,1,0]');
    ctx.lines.push('["LINESTYLE","st3",null,null,null,2,null]');
    ctx.lines.push('["LINESTYLE","st4",null,null,null,null,null]');
  }
  function emitHeaderModern(ctx) {
    const stamp2 = ctx.options.now();
    const rand = () => Math.random().toString(36).substr(2, 8);
    const client = "client_" + stamp2 + "_" + rand();
    const uuid = "uuid_" + stamp2 + "_" + rand();
    ctx.lines.push(
      `{"type":"DOCHEAD"}||{"docType":"SCH_PAGE","client":"${client}","uuid":"${uuid}","updateTime":${stamp2},"version":${stamp2}}|`
    );
    ctx.lines.push(`{"type":"CANVAS","ticket":${ctx.nextId()},"id":"CANVAS"}||{"originX":0,"originY":0}|`);
  }
  function v2AttrLine(ctx, compId, key, value, topZero) {
    return `["ATTR","e${ctx.nextId()}","${compId}","${key}",${q(value)},${topZero ? 0 : "null"},0,null,null,null,"st1",0]`;
  }
  function emitV2Component(ctx, part) {
    const comp = part.comp;
    const compId = "e" + ctx.nextId();
    const outY = ctx.options.yvalue ? -part.y : part.y;
    ctx.lines.push(
      `["COMPONENT","${compId}",${q(partNameOf(ctx.symbolDb, comp, part.partIdx))},${part.x},${outY},0,0,{},0]`
    );
    ctx.lines.push(v2AttrLine(ctx, compId, "Device", comp.deviceUuid || "", true));
    ctx.lines.push(v2AttrLine(ctx, compId, "Symbol", comp.symbolUuid || "", true));
    ctx.lines.push(v2AttrLine(ctx, compId, "Designator", comp.designator || "", false));
    ctx.lines.push(v2AttrLine(ctx, compId, "Name", comp.name || "", false));
    ctx.lines.push(v2AttrLine(ctx, compId, "Unique ID", comp.uniqueId || "", true));
    if (ctx.options.genWire) ctx.lines.push(...planWires(wireInput(ctx, part, part.x, outY)));
  }
  function modernComponentLine(ctx, partId, x, y) {
    const ticket = ctx.nextId();
    const body = {
      partId,
      x,
      y,
      rotation: 0,
      isMirror: false,
      attrs: {
        Footprints: "[]",
        Devices: "[]",
        DeviceName: null,
        FootprintName: null,
        pinClass: {},
        differentialPairClass: {},
        Symbols: "[]"
      },
      zIndex: ticket
    };
    return { id: "e" + ticket, line: `{"type":"COMPONENT","ticket":${ticket},"id":"e${ticket}"}||${JSON.stringify(body)}|` };
  }
  function modernAttrLine(ctx, parentId, key, value, extra) {
    const e = extra || {};
    const ticket = ctx.nextId();
    const body = {
      x: e.x === void 0 ? null : e.x,
      y: e.y === void 0 ? null : e.y,
      rotation: e.rotation === void 0 ? null : e.rotation,
      color: null,
      fontFamily: null,
      fontSize: null,
      fontWeight: null,
      italic: null,
      underline: null,
      align: null,
      value: value === void 0 ? null : value,
      keyVisible: e.keyVisible === void 0 ? null : e.keyVisible,
      valueVisible: e.valueVisible === void 0 ? null : e.valueVisible,
      key,
      fillColor: null,
      parentId,
      zIndex: ticket
    };
    return `{"type":"ATTR","ticket":${ticket},"id":"e${ticket}"}||${JSON.stringify(body)}|`;
  }
  function emitModernComponent(ctx, part) {
    const comp = part.comp;
    const outY = ctx.options.yvalue ? -part.y : part.y;
    const compLine = modernComponentLine(ctx, partNameOf(ctx.symbolDb, comp, part.partIdx), part.x, outY);
    const compId = compLine.id;
    const lines = ctx.lines;
    lines.push(compLine.line);
    lines.push(modernAttrLine(ctx, compId, "Device", comp.deviceUuid || ""));
    lines.push(modernAttrLine(ctx, compId, "Symbol", comp.symbolUuid || ""));
    lines.push(modernAttrLine(ctx, compId, "Unique ID", comp.uniqueId || ""));
    lines.push(modernAttrLine(ctx, compId, "Designator", comp.designator || "", { rotation: 0, keyVisible: false, valueVisible: true }));
    lines.push(modernAttrLine(ctx, compId, "Name", comp.name || "", { rotation: 0, keyVisible: false, valueVisible: true }));
    lines.push(modernAttrLine(ctx, compId, "Channel ID", ""));
    lines.push(modernAttrLine(ctx, compId, "Group ID", ""));
    lines.push(modernAttrLine(ctx, compId, "Reuse Block", ""));
    if (ctx.options.genWire) lines.push(...planWires(wireInput(ctx, part, part.x, outY)));
  }
  function wireInput(ctx, part, compX, compY) {
    return {
      comp: part.comp,
      partIdx: part.partIdx,
      compX,
      compY,
      wireLength: ctx.options.wireLength,
      symbolDb: ctx.symbolDb,
      isV2: ctx.isV2,
      nextId: ctx.nextId
    };
  }
  function emitFrame(ctx, group, bounds) {
    if (!ctx.options.genFrame || bounds.minX === Infinity) return;
    const flip = ctx.options.yvalue;
    const x = bounds.minX - PADDING + 10;
    if (ctx.isV2) {
      const y2 = flip ? -bounds.maxY - PADDING + 30 : bounds.maxY + PADDING - 30;
      ctx.lines.push(`["TEXT","e${ctx.nextId()}",${x},${y2},0,${q(group.name)},"st2",0]`);
      return;
    }
    const ticket = ctx.nextId();
    const y = flip ? -bounds.maxY - PADDING + 30 : bounds.maxY + PADDING - 30;
    const body = { x, y, value: group.name, fontSize: 60, align: "LEFT_MIDDLE", rotation: 0 };
    ctx.lines.push(`{"type":"TEXT","ticket":${ticket},"id":"e${ticket}"}||${JSON.stringify(body)}|`);
  }
  function emitGroups(ctx) {
    let currentTopY = ctx.options.startY;
    for (const group of ctx.groups) {
      if (!group.items || group.items.length === 0) continue;
      const layout = layoutGroup(group.items, {
        classify: ctx.options.classify,
        startX: ctx.options.startX,
        startTopY: currentTopY,
        symbolDb: ctx.symbolDb
      });
      for (const part of layout.parts) ctx.emitPart(ctx, part);
      emitFrame(ctx, group, layout.bounds);
      if (ctx.options.classify !== "coord") currentTopY = layout.bounds.minY - GROUP_GAP;
    }
  }
  function stripTrailingPipe(lines) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].endsWith("|")) lines[last] = lines[last].slice(0, -1);
  }
  function buildSchSource(payload) {
    const input = payload || {};
    const options = normalizeOptions(input.options);
    options.now = input.options && input.options.now || (() => Date.now());
    let counter = Number(input.startId) || 1;
    const ctx = {
      lines: [],
      symbolDb: input.symbolDb || {},
      options,
      isV2: input.format === "v2",
      nextId: () => counter++,
      groups: classifyGroups(input.components || [], options.classify),
      emitPart: null
    };
    ctx.emitPart = ctx.isV2 ? emitV2Component : emitModernComponent;
    if (ctx.isV2) emitHeaderV2(ctx);
    else emitHeaderModern(ctx);
    emitGroups(ctx);
    if (!ctx.isV2) stripTrailingPipe(ctx.lines);
    return ctx.lines.join("\n");
  }

  // iframe/js/src/app/pcb-to-sch/index.js
  var zip = null;
  var projectJson = null;
  var components = [];
  var mergedRows = [];
  var version = "";
  var candidateSource = "";
  var currentPcbUuid = "";
  var symbolPinsDatabase = {};
  var currentSchematicUuid = null;
  var progressFill = document.getElementById("progressFill");
  var progressText = document.getElementById("progressText");
  var versionSpan = document.getElementById("versionDisplay");
  var yvalueCheck = document.getElementById("yvalue");
  var refreshBtn = document.getElementById("refreshListBtn");
  var tableRows = document.getElementById("tableRows");
  var buildBtn = document.getElementById("buildBtn");
  var writeBtn = document.getElementById("writeBtn");
  var genTitleCheck = document.getElementById("genTitle");
  var genWireCheck = document.getElementById("genWire");
  var exportCsvBtn = document.getElementById("exportCsvBtn");
  var errorsCheck = document.getElementById("errors");
  var outfile = document.getElementById("outfile");
  var exportNetBtn = document.getElementById("exportNetBtn");
  var statusBar = createStatusBar({
    textEl: progressText,
    barEl: progressFill,
    baseClass: "status-text",
    barBaseClass: "progress-bg"
  });
  function updateProgress(percent, text) {
    statusBar.width(percent, "");
    statusBar.text(text);
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function initVersion() {
    try {
      version = getEditorVersion();
      if (!version) throw new Error("未检测到 EDA 环境");
      versionSpan.textContent = `当前EDA版本：${version} 功能可用`;
      versionSpan.style.color = "#8f8";
      yvalueCheck.checked = !isV2();
    } catch (e) {
      versionSpan.textContent = "当前不在EDA环境，当前版本不支持转换";
      versionSpan.style.color = "#f88";
      refreshBtn.disabled = true;
      buildBtn.disabled = true;
      writeBtn.disabled = true;
      exportCsvBtn.disabled = true;
      exportNetBtn.disabled = true;
    }
  }
  function stamp() {
    const now = /* @__PURE__ */ new Date();
    const date = `${now.getFullYear()}${("0" + (now.getMonth() + 1)).slice(-2)}${("0" + now.getDate()).slice(-2)}`;
    const time = `${("0" + now.getHours()).slice(-2)}${("0" + now.getMinutes()).slice(-2)}${("0" + now.getSeconds()).slice(-2)}`;
    return `${date}_${time}`;
  }
  function currentClassify() {
    const radio = document.querySelector('input[name="classify"]:checked');
    return radio ? radio.value : "ref";
  }
  async function onRefresh() {
    try {
      buildBtn.disabled = true;
      writeBtn.disabled = true;
      outfile.disabled = true;
      tableRows.innerHTML = "";
      const startTime = Date.now();
      updateProgress(5, "版本检测");
      await delay(100);
      updateProgress(7, "获取当前原理信息");
      const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
      await delay(100);
      updateProgress(10, "获取工程文件");
      const ticker = createProgressTicker({
        from: 10,
        to: 40,
        step: 1,
        intervalMs: 1e3,
        onTick: (p) => updateProgress(p, `获取工程文件 (${p}%)`)
      });
      ticker.start();
      let epro;
      try {
        epro = await eda.sys_FileManager.getProjectFile("project", void 0, ".epro");
      } finally {
        ticker.stop();
      }
      updateProgress(45, "读取 project.json");
      zip = await JSZip.loadAsync(epro);
      projectJson = JSON.parse(await zip.file("project.json").async("string"));
      await delay(100);
      updateProgress(50, "查找对应的PCB");
      const uuids = findUuids(projectJson, curDoc.uuid);
      currentPcbUuid = projectJson.pcbs[uuids.pcbUuid];
      currentSchematicUuid = uuids.schematicUuid;
      await delay(100);
      updateProgress(55, "读取PCB文件");
      const pcbFile = zip.file(pcbFilePath(uuids.pcbUuid));
      if (!pcbFile) throw new Error(`在压缩包中未找到PCB文件: ${pcbFilePath(uuids.pcbUuid)}`);
      const pcbContent = await pcbFile.async("string");
      await delay(100);
      updateProgress(60, "解析PCB内容");
      components = parsePcbContent(pcbContent);
      await delay(100);
      updateProgress(80, "获取符号信息");
      enrichWithSymbol(components, projectJson);
      mergedRows = mergeComponentsForDisplay(components);
      renderTable(mergedRows);
      const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
      updateProgress(100, `元件处理完成，耗时${elapsed}秒`);
      buildBtn.disabled = false;
      exportCsvBtn.disabled = false;
    } catch (error) {
      logger.error("刷新列表失败:", error);
      updateProgress(0, `错误: ${error.message}`);
    }
  }
  function renderTable(rows) {
    tableRows.innerHTML = "";
    rows.forEach((group) => {
      const row = document.createElement("div");
      row.className = "grid-row";
      row.setAttribute("data-group-key", group.key);
      row.innerHTML = `
					<div class="row-cell" title="${escapeHtml(group.designatorDisplay)}">${escapeHtml(group.designatorDisplay)}</div>
					<div class="row-cell" title="${escapeHtml(group.nameDisplay)}">${escapeHtml(group.nameDisplay)}</div>
					<div class="row-cell" title="${escapeHtml(group.footprintName)}">${escapeHtml(group.footprintName)}</div>
					<div class="row-cell" title="${escapeHtml(group.deviceName)}">${escapeHtml(group.deviceName)}</div>
					<div class="row-cell" title="${escapeHtml(group.symbolName)}">${escapeHtml(group.symbolName)}</div>
					<div class="row-cell"><input class="manual-input" type="text" placeholder="指定..." data-group-key="${group.key}" value=""></div>
				`;
      tableRows.appendChild(row);
    });
  }
  function collectManualInputs() {
    const map = /* @__PURE__ */ new Map();
    document.querySelectorAll(".manual-input").forEach((input) => {
      const groupKey = input.getAttribute("data-group-key");
      if (groupKey) map.set(groupKey, input.value.trim());
    });
    return map;
  }
  var KEYWORD_TO_SYMBOL = {
    无极电容: "801c26e6ac62427db41c6496435118b6",
    电阻: "9c1d6a5e19e649e888ff79bf9e87b823",
    电感: "3f193864f7264a439d7adc22fdbb5dbf"
  };
  function findSymbolUuidByTitle(title) {
    const symbols = projectJson && projectJson.symbols || {};
    for (const entry of Object.entries(symbols)) {
      if (entry[1].title === title) return entry[0];
    }
    return null;
  }
  function applyManualSymbols(manualMap) {
    for (const [groupKey, inputValue] of manualMap.entries()) {
      if (!inputValue) continue;
      const targetUuid = KEYWORD_TO_SYMBOL[inputValue] || findSymbolUuidByTitle(inputValue);
      if (!targetUuid) continue;
      const group = mergedRows.find((row) => row.key === groupKey);
      if (!group) continue;
      group.componentIndices.forEach((idx) => {
        if (!components[idx]) return;
        components[idx].symbolUuid = targetUuid;
        components[idx].symbolName = inputValue;
      });
    }
  }
  function checkMissingSymbols() {
    const missing = /* @__PURE__ */ new Set();
    components.forEach((comp, idx) => {
      if (comp.symbolUuid) return;
      const group = mergedRows.find((row) => row.componentIndices.includes(idx));
      if (group) missing.add(group.key);
    });
    return Array.from(missing);
  }
  async function enrichPartCounts(compList) {
    symbolPinsDatabase = {};
    for (const comp of compList) {
      if (!comp.symbolUuid) {
        comp.partCount = 1;
        continue;
      }
      if (symbolPinsDatabase[comp.symbolUuid]) {
        comp.partCount = symbolPinsDatabase[comp.symbolUuid].length;
        continue;
      }
      const file = zip.file(symbolFilePath(comp.symbolUuid));
      if (!file) {
        logger.warn(`符号文件不存在: ${symbolFilePath(comp.symbolUuid)}`);
        symbolPinsDatabase[comp.symbolUuid] = [{ pinBbox: null, pins: {} }];
        comp.partCount = 1;
        continue;
      }
      const parts = parseSymbolSource(await file.async("string"));
      symbolPinsDatabase[comp.symbolUuid] = parts;
      comp.partCount = parts.length;
    }
  }
  async function onBuild() {
    const yvalue = yvalueCheck.checked;
    const classify = currentClassify();
    const ignoreMissing = errorsCheck.checked;
    try {
      document.querySelectorAll(".grid-row").forEach((row) => row.classList.remove("row-error"));
      const startTime = Date.now();
      if (components && projectJson) enrichWithSymbol(components, projectJson);
      updateProgress(5, "获取指定符号");
      applyManualSymbols(collectManualInputs());
      await delay(100);
      updateProgress(10, "检测符号是否存在");
      const missingSymbols = checkMissingSymbols();
      if (missingSymbols.length > 0) {
        missingSymbols.forEach((groupKey) => {
          const rowElement = document.querySelector(`[data-group-key="${groupKey}"]`);
          if (rowElement) rowElement.classList.add("row-error");
        });
        if (!ignoreMissing) {
          throw new Error("未生成源码，部分元件格式错误，已标红，需要做完 器件标准化 才能转换！！！");
        }
        logger.debug(`忽略 ${missingSymbols.length} 组缺失符号的元件，它们将不会出现在生成的源码中`);
        updateProgress(10, `忽略 ${missingSymbols.length} 组缺失符号元件`);
      }
      await delay(100);
      const componentsToBuild = ignoreMissing ? components.filter((comp) => comp.symbolUuid && comp.symbolUuid.trim() !== "") : components;
      updateProgress(20, "检测多部件符号中");
      await enrichPartCounts(componentsToBuild);
      await delay(100);
      updateProgress(40, "构建源码");
      candidateSource = buildSchSource({
        components: componentsToBuild,
        symbolDb: symbolPinsDatabase,
        format: isV2() ? "v2" : "modern",
        options: {
          classify,
          // 只有一个「生成标题」复选框：既决定组标题，也决定是否画框线（原实现两个变量指向同一元素）
          genFrame: genTitleCheck.checked,
          genWire: genWireCheck.checked,
          yvalue,
          startX: 200,
          startY: -200,
          colSpacing: 150,
          rowSpacing: 150,
          perRow: 20,
          wireLength: 40
        }
      });
      await delay(100);
      const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
      const lineCount = candidateSource ? candidateSource.split("\n").length : 0;
      updateProgress(100, `构建源码完成，耗时${elapsed}秒，生成了 ${lineCount} 行源码`);
      writeBtn.disabled = false;
      outfile.disabled = false;
      exportNetBtn.disabled = false;
    } catch (error) {
      logger.error("构建源码失败:", error);
      updateProgress(0, `错误: ${error.message}`);
    }
  }
  async function onWrite() {
    try {
      if (!candidateSource) throw new Error("没有可写入的源码，请先构建");
      const startTime = Date.now();
      updateProgress(90, "正在写入文档...");
      const curDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
      if (!curDoc || curDoc.documentType !== 1) {
        updateProgress(0, "请先切换到原理图页再写入");
        toast("请先切换到原理图页再写入", "warning");
        return;
      }
      const isSuccess = await eda.sys_FileManager.setDocumentSource(candidateSource);
      const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
      let placedCount = 0;
      try {
        const comps = await eda.sch_PrimitiveComponent.getAll();
        placedCount = Array.isArray(comps) ? comps.length : 0;
      } catch (e) {
        logger.warn("写入后清点器件失败（可忽略）", e);
      }
      logger.debug(`[Debug] 写入返回 ${isSuccess}，当前原理图器件数 ${placedCount}`);
      if (isSuccess && placedCount > 0) {
        updateProgress(100, `写入成功！耗时${elapsed}秒，器件 ${placedCount} 个`);
        toast("写入成功", "success");
      } else if (isSuccess) {
        updateProgress(100, `源码已写入，但没有生成任何器件（耗时${elapsed}秒）`);
        toast("源码已写入，但器件没有生成：原理图页可能有旧内容，建议新建一个空白原理图页后重新写入", "error");
      } else {
        updateProgress(100, `写入失败！耗时${elapsed}秒`);
        toast("写入失败", "error");
      }
    } catch (error) {
      logger.error("写入失败:", error);
      updateProgress(0, `错误: ${error.message}`);
    }
  }
  function onExportCsv() {
    if (!projectJson || !currentPcbUuid) {
      toast("请先刷新列表", "warning");
      updateProgress(0, "请先加载数据");
      return;
    }
    const headers = Array.from(document.querySelectorAll(".table-header .header-cell")).map(
      (cell) => cell.innerText.trim()
    );
    const rows = [];
    document.querySelectorAll(".grid-row").forEach((row) => {
      const cells = row.querySelectorAll(".row-cell");
      const rowData = [];
      cells.forEach((cell, index) => {
        if (index === cells.length - 1) {
          const input = cell.querySelector("input");
          rowData.push(input ? input.value : "");
        } else {
          rowData.push(cell.innerText.trim());
        }
      });
      rows.push(rowData);
    });
    const csv = [headers, ...rows].map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
    const filename = `${currentPcbUuid}_${stamp()}.csv`;
    updateProgress(100, `导出成功：${filename}`);
    downloadText(filename, csv, { mime: "text/csv", bom: true });
  }
  function csvCell(cell) {
    const text = String(cell === null || cell === void 0 ? "" : cell);
    if (text.includes(",") || text.includes('"') || text.includes("\n")) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }
  function onExportNet() {
    if (!components || components.length === 0) {
      updateProgress(0, "请先加载数据并构建源码");
      return;
    }
    if (Object.keys(symbolPinsDatabase).length === 0) {
      updateProgress(0, "请先构建源码以获取引脚信息");
      return;
    }
    const lines = ["唯一ID,位号,引脚编号,引脚名称,引脚网络"];
    for (const comp of components) lines.push(...netLinesOf(comp));
    const filename = `${currentPcbUuid || "netlist"}_${stamp()}_netlist.csv`;
    updateProgress(100, `导出网络成功：${filename}`);
    downloadText(filename, lines.join("\n"), { mime: "text/csv", bom: true });
  }
  function netLinesOf(comp) {
    const lines = [];
    const symbolParts = symbolPinsDatabase[comp.symbolUuid] || [];
    for (const entry of Object.entries(comp.pins || {})) {
      const pinNumber = entry[0];
      if (!pinNumber) continue;
      const pinName = pinNameOf(symbolParts, pinNumber);
      lines.push([comp.uniqueId || "", comp.designator || "", pinNumber, pinName, entry[1] || ""].map(csvCell).join(","));
    }
    return lines;
  }
  function pinNameOf(symbolParts, pinNumber) {
    for (const part of symbolParts) {
      const pin = (part.pins || {})[pinNumber];
      if (pin && pin.name) return pin.name;
    }
    return "";
  }
  async function onExportProject() {
    if (!zip || !currentSchematicUuid) {
      updateProgress(0, "请先刷新加载数据");
      return;
    }
    if (!candidateSource) {
      updateProgress(0, "没有可导出的源码，请先构建");
      return;
    }
    try {
      updateProgress(30, "准备导出文件...");
      zip.file(`SHEET/${currentSchematicUuid}/1.esch`, candidateSource);
      updateProgress(60, "正在生成工程文件...");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const fileName = projectTitleOf(projectJson);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      updateProgress(100, `导出成功：${fileName}`);
      toast("文件已导出", "success");
    } catch (error) {
      logger.error("导出失败:", error);
      updateProgress(0, `导出错误: ${error.message}`);
    }
  }
  initVersion();
  refreshBtn.addEventListener("click", onRefresh);
  exportCsvBtn.addEventListener("click", onExportCsv);
  exportNetBtn.addEventListener("click", onExportNet);
  buildBtn.addEventListener("click", onBuild);
  writeBtn.addEventListener("click", onWrite);
  outfile.addEventListener("click", onExportProject);
})();
