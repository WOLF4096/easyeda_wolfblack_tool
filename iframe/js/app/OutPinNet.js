/*! 由 npm run build:iframe 从 iframe/js/src 生成，请勿直接修改本文件 */
"use strict";
(() => {
  // iframe/js/src/core/eda.js
  var NETLIST_KEY = "JLCEDA";
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

  // iframe/js/src/core/netlist.js
  async function readNetlistFile(getFile, page) {
    const file = await getFile();
    if (!file) throw new Error("获取的网表为空");
    const text = await file.text();
    if (!text || !text.trim()) throw new Error("获取的网表为空");
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`网表格式无法解析（${page}）：${e && e.message || e}`);
    }
    return { page, text, json };
  }
  async function getNetlist(page = "AUTO") {
    const edaObj = getEda();
    if (!edaObj) {
      throw new Error("未检测到 EDA 运行环境");
    }
    const readPcb = () => readNetlistFile(() => edaObj.pcb_ManufactureData.getNetlistFile(NETLIST_KEY), "PCB");
    const readSch = () => readNetlistFile(() => edaObj.sch_ManufactureData.getNetlistFile(NETLIST_KEY), "SCH");
    if (page === "PCB") return readPcb();
    if (page === "SCH") return readSch();
    try {
      return await readPcb();
    } catch (pcbError) {
      logger.debug("PCB 网表不可用，回退原理图网表：", pcbError);
      return readSch();
    }
  }
  function getComponentsContainer(netlistObj) {
    if (!netlistObj) return {};
    return netlistObj.components ? netlistObj.components : netlistObj;
  }

  // iframe/js/src/core/util.js
  function escapeHtml(value) {
    if (value === null || value === void 0) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function naturalCompare(a, b) {
    const sa = a === null || a === void 0 ? "" : String(a);
    const sb = b === null || b === void 0 ? "" : String(b);
    return sa.localeCompare(sb, "en", { numeric: true, sensitivity: "base" });
  }

  // iframe/js/src/ui/download.js
  function toCsv(rows, options = {}) {
    const delimiter = options.delimiter || ",";
    const newline = options.newline || "\r\n";
    const list = Array.isArray(rows) ? rows : [];
    const escapeCell = (cell) => {
      const text = cell === null || cell === void 0 ? "" : String(cell);
      const needsQuote = text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r");
      return needsQuote ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    return list.map((row) => (Array.isArray(row) ? row : [row]).map(escapeCell).join(delimiter)).join(newline);
  }
  function downloadBlob(fileName, blob, options = {}) {
    const doc = options.doc || globalThis.document;
    const urlApi = options.urlApi || globalThis.URL;
    if (!doc || typeof doc.createElement !== "function" || !urlApi || typeof urlApi.createObjectURL !== "function") return false;
    const href = urlApi.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = href;
    a.download = fileName;
    if (doc.body && typeof doc.body.appendChild === "function") doc.body.appendChild(a);
    if (typeof a.click === "function") a.click();
    if (typeof a.remove === "function") a.remove();
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
  function toast(message, level = TOAST_LEVEL.info, opts = {}) {
    const doc = opts.doc || globalThis.document;
    const host = opts.host === void 0 ? getEda() : opts.host;
    const text = message === null || message === void 0 ? "" : String(message);
    const type = normalizeLevel(level);
    try {
      if (host && host.sys_Message && typeof host.sys_Message.showToastMessage === "function") {
        host.sys_Message.showToastMessage(text, type);
        return "host";
      }
    } catch (e) {
    }
    return banner(doc, text, opts.timeoutMs === void 0 ? 3e3 : opts.timeoutMs) ? "dom" : "none";
  }

  // iframe/js/src/core/pins.js
  function getPins(comp) {
    const out = {};
    if (!comp || typeof comp !== "object") return out;
    if (comp.pinInfoMap && typeof comp.pinInfoMap === "object") {
      for (const [pin, info] of Object.entries(comp.pinInfoMap)) {
        out[pin] = info && typeof info === "object" ? info.net || "" : String(info || "");
      }
      return out;
    }
    if (comp.pins && typeof comp.pins === "object") {
      for (const [pin, net] of Object.entries(comp.pins)) {
        out[pin] = net && typeof net === "object" ? net.net || "" : String(net || "");
      }
    }
    return out;
  }
  function collectPinNumbers(components) {
    const set = /* @__PURE__ */ new Set();
    for (const comp of Array.isArray(components) ? components : []) {
      for (const pin of Object.keys(getPins(comp))) set.add(pin);
    }
    return Array.from(set).sort(sortPinKeys);
  }
  function sortPinKeys(a, b) {
    const na = Number(a);
    const nb = Number(b);
    const aNum = a !== "" && Number.isFinite(na);
    const bNum = b !== "" && Number.isFinite(nb);
    if (aNum && bNum) return na - nb;
    return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
  }

  // iframe/js/src/app/out-pin-net/matrix.js
  function buildComponents(container) {
    const components = [];
    if (!container || typeof container !== "object") return { components };
    for (const item of Object.values(container)) {
      if (!item || typeof item !== "object") continue;
      const props = item.props || {};
      components.push({ ...props, pins: getPins(item) });
    }
    return { components };
  }
  function filterAndSort(components, typeKey, filterValue) {
    const list = (Array.isArray(components) ? components : []).filter((comp) => filterValue === "ALL" || comp[typeKey] === filterValue);
    return list.sort((a, b) => naturalCompare(a.Designator || "", b.Designator || ""));
  }
  function buildMatrix(components, typeKey, filterValue) {
    const filtered = filterAndSort(components, typeKey, filterValue);
    const pins = collectPinNumbers(filtered);
    const rows = filtered.map((comp) => ({
      designator: comp.Designator || "?",
      cells: pins.map((pin) => comp.pins[pin] || "")
    }));
    const corner = filterValue === "ALL" ? typeKey === "DeviceName" ? "所有器件" : "所有封装" : filterValue;
    return { pins, rows, corner };
  }
  function toCsvRows(matrix) {
    const head = [matrix.corner, ...matrix.pins];
    const body = matrix.rows.map((row) => [row.designator === "?" ? "" : row.designator, ...row.cells]);
    return [head, ...body];
  }
  function toNetLengthRows(nets) {
    const rows = [["网络名称", "长度(mil)", "长度(mm)"]];
    const list = (Array.isArray(nets) ? nets : []).slice().sort((a, b) => naturalCompare(a.net || "", b.net || ""));
    for (const item of list) {
      const lenMil = item.length || 0;
      rows.push([item.net || "", lenMil.toFixed(2), (lenMil * 0.0254).toFixed(4)]);
    }
    return rows;
  }

  // iframe/js/src/app/out-pin-net/index.js
  var CSV_NEWLINE = "\n";
  var allComponents = [];
  var typeSelect = document.getElementById("typeSelect");
  var propSelect = document.getElementById("propSelect");
  var tableContainer = document.getElementById("tableContainer");
  var netTable = document.getElementById("netTable");
  var exportPinNetBtn = document.getElementById("exportPinNetBtn");
  var exportAllNetBtn = document.getElementById("exportAllNetBtn");
  function uniquePropValues(typeKey) {
    const values = allComponents.map((comp) => comp[typeKey]).filter(Boolean);
    return [...new Set(values)].sort();
  }
  function populatePropSelect() {
    const typeKey = typeSelect.value;
    const values = uniquePropValues(typeKey);
    const current = propSelect.value;
    propSelect.innerHTML = "";
    propSelect.appendChild(makeOption("ALL", "所有"));
    for (const value of values) propSelect.appendChild(makeOption(value, value));
    propSelect.value = current && values.includes(current) ? current : "ALL";
    propSelect.title = propSelect.value === "ALL" ? "所有" : propSelect.value;
  }
  function makeOption(value, text) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.title = text;
    return option;
  }
  function renderTable() {
    const typeKey = typeSelect.value;
    const filterValue = propSelect.value;
    propSelect.title = filterValue === "ALL" ? "所有" : filterValue;
    const matrix = buildMatrix(allComponents, typeKey, filterValue);
    let thead = "<thead><tr>";
    thead += `<th>${escapeHtml(matrix.corner)}</th>`;
    for (const pin of matrix.pins) thead += `<th>${escapeHtml(pin)}</th>`;
    thead += "</tr></thead>";
    let tbody = "<tbody>";
    if (matrix.rows.length === 0) {
      tbody += `<tr><td colspan="${matrix.pins.length + 1}" style="text-align:center; padding:40px; color:#7a8aa5;">暂无匹配器件</td></tr>`;
    } else {
      for (const row of matrix.rows) {
        tbody += "<tr>";
        tbody += `<td>${escapeHtml(row.designator)}</td>`;
        for (const cell of row.cells) tbody += `<td>${escapeHtml(cell)}</td>`;
        tbody += "</tr>";
      }
    }
    tbody += "</tbody>";
    netTable.innerHTML = thead + tbody;
  }
  function exportPinNetAsCsv() {
    const matrix = buildMatrix(allComponents, typeSelect.value, propSelect.value);
    downloadText(`${propSelect.value}.csv`, toCsv(toCsvRows(matrix), { newline: CSV_NEWLINE }), { mime: "text/csv", bom: true });
  }
  async function exportAllNetsAsCsv() {
    try {
      const host = getEda();
      const allNets = await host.pcb_Net.getAllNets();
      if (!allNets || allNets.length === 0) {
        toast("未能获取到网络数据，请确认是否处于 PCB 环境或图纸中是否包含网络", 2);
        return;
      }
      downloadText("all_networks_length.csv", toCsv(toNetLengthRows(allNets), { newline: CSV_NEWLINE }), { mime: "text/csv", bom: true });
    } catch (error) {
      console.error("获取网络长度失败:", error);
      toast("导出网络数据失败：带长度的网络导出仅在 PCB 视图下有效", 2);
    }
  }
  function typeChangeHandler() {
    populatePropSelect();
    renderTable();
  }
  async function initApp() {
    netTable.innerHTML = '<div class="loading-message">加载网表中...</div>';
    const jsonData = (await getNetlist("AUTO")).json;
    try {
      allComponents = buildComponents(getComponentsContainer(jsonData)).components;
      populatePropSelect();
      renderTable();
      typeSelect.removeEventListener("change", typeChangeHandler);
      propSelect.removeEventListener("change", renderTable);
      typeSelect.addEventListener("change", typeChangeHandler);
      propSelect.addEventListener("change", renderTable);
      tableContainer.addEventListener(
        "wheel",
        (e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          tableContainer.scrollLeft += e.deltaY;
        },
        { passive: false }
      );
    } catch (error) {
      netTable.innerHTML = `<div class="loading-message" style="color:#b33;">加载失败: ${escapeHtml(error.message)}</div>`;
      console.error(error);
    }
  }
  function ensureLoaded() {
    if (allComponents.length > 0) return true;
    toast("网表尚未加载", 2);
    return false;
  }
  exportPinNetBtn.addEventListener("click", () => {
    if (ensureLoaded()) exportPinNetAsCsv();
  });
  exportAllNetBtn.addEventListener("click", () => {
    if (ensureLoaded()) void exportAllNetsAsCsv();
  });
  void initApp();
})();
