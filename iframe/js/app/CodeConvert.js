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
  async function setNetlist(page, json) {
    const edaObj = getEda();
    if (!edaObj) {
      throw new Error("未检测到 EDA 运行环境");
    }
    const text = typeof json === "string" ? json : JSON.stringify(json);
    const writePcb = () => edaObj.pcb_Net.setNetlist(NETLIST_KEY, text);
    const writeSch = () => edaObj.sch_Netlist.setNetlist(NETLIST_KEY, text);
    if (page === "PCB") {
      await writePcb();
      return "PCB";
    }
    if (page === "SCH") {
      await writeSch();
      return "SCH";
    }
    try {
      await writePcb();
      return "PCB";
    } catch (pcbError) {
      await writeSch();
      return "SCH";
    }
  }
  function getComponentsContainer(netlistObj) {
    if (!netlistObj) return {};
    return netlistObj.components ? netlistObj.components : netlistObj;
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
      const version = edaObj.sys_Environment.getEditorCurrentVersion();
      const text = version === null || version === void 0 ? "" : String(version).trim();
      if (text) cachedVersion = text;
      return text;
    } catch (e) {
      return "";
    }
  }
  function getVersionFamily() {
    const version = getEditorVersion();
    if (!version) return "";
    if (version.startsWith("4")) return "V4";
    if (version.startsWith("3")) return "V3";
    if (version.startsWith("2.2")) return "V2.2";
    if (version.startsWith("2")) return "V2";
    return "";
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

  // iframe/js/src/ui/table.js
  var SORT_INDICATOR = Object.freeze({ asc: "▲", desc: "▼", none: "" });
  function selectionSummary(items, isSelected) {
    const list = Array.isArray(items) ? items : [];
    let count = 0;
    for (const item of list) {
      if (isSelected(item)) count++;
    }
    const total = list.length;
    return {
      count,
      total,
      isAll: total > 0 && count === total,
      isIndeterminate: count > 0 && count < total
    };
  }
  function setAllSelected(items, setSelected, value) {
    const list = Array.isArray(items) ? items : [];
    for (const item of list) setSelected(item, !!value);
    return list.length;
  }

  // iframe/js/src/format/componentCode.js
  var E96_VALUES = {
    "01": 100,
    "02": 102,
    "03": 105,
    "04": 107,
    "05": 110,
    "06": 113,
    "07": 115,
    "08": 118,
    "09": 121,
    10: 124,
    11: 127,
    12: 130,
    13: 133,
    14: 137,
    15: 140,
    16: 143,
    17: 147,
    18: 150,
    19: 154,
    20: 158,
    21: 162,
    22: 165,
    23: 169,
    24: 174,
    25: 178,
    26: 182,
    27: 187,
    28: 191,
    29: 196,
    30: 200,
    31: 205,
    32: 210,
    33: 215,
    34: 221,
    35: 226,
    36: 232,
    37: 237,
    38: 243,
    39: 249,
    40: 255,
    41: 261,
    42: 267,
    43: 274,
    44: 280,
    45: 287,
    46: 294,
    47: 301,
    48: 309,
    49: 316,
    50: 324,
    51: 332,
    52: 340,
    53: 348,
    54: 357,
    55: 365,
    56: 374,
    57: 383,
    58: 392,
    59: 402,
    60: 412,
    61: 422,
    62: 432,
    63: 442,
    64: 453,
    65: 464,
    66: 475,
    67: 487,
    68: 499,
    69: 511,
    70: 523,
    71: 536,
    72: 549,
    73: 562,
    74: 576,
    75: 590,
    76: 604,
    77: 619,
    78: 634,
    79: 649,
    80: 665,
    81: 681,
    82: 698,
    83: 715,
    84: 732,
    85: 750,
    86: 768,
    87: 787,
    88: 806,
    89: 825,
    90: 845,
    91: 866,
    92: 887,
    93: 909,
    94: 931,
    95: 953,
    96: 976
  };
  var E96_MULTIPLIERS = { Z: 1e-3, Y: 0.01, X: 0.1, A: 1, B: 10, C: 100, D: 1e3, E: 1e4, F: 1e5, G: 1e6 };
  var INVALID_RAW = Number.MAX_VALUE;
  function convertCodeToValue(code, type) {
    if (!code || !type) return { text: null, raw: INVALID_RAW };
    const strCode = code.toString().toUpperCase();
    switch (type.toUpperCase()) {
      case "R":
        return convertResistor(strCode);
      case "C":
        return convertCapacitor(strCode);
      case "L":
        return convertInductor(strCode);
      default:
        return { text: code, raw: INVALID_RAW };
    }
  }
  function convertResistor(code) {
    if (code.length === 3 && /^\d{2}[A-Z]$/.test(code)) {
      const digits = code.substring(0, 2);
      const multiplierChar = code.substring(2, 3);
      if (E96_VALUES[digits] && E96_MULTIPLIERS[multiplierChar]) {
        const value = E96_VALUES[digits] * E96_MULTIPLIERS[multiplierChar];
        return { text: formatValue(value, "R"), raw: value };
      }
    }
    if (/^[0-9.]*[RKM][0-9.]*$/.test(code)) {
      const value = parseResistorWithUnit(code);
      if (value !== null) return { text: formatValue(value, "R"), raw: value };
    }
    const numericValue = plainCodeToNumber(code, true);
    if (isNaN(numericValue) || numericValue === null) return { text: code, raw: INVALID_RAW };
    return { text: formatValue(numericValue, "R"), raw: numericValue };
  }
  function convertCapacitor(code) {
    let numericValue;
    if (/^[0-9.]*[PNUM][0-9.]*[F]?$/.test(code)) {
      numericValue = parseCapacitorWithUnit(code);
    } else {
      numericValue = plainCodeToNumber(code, false);
    }
    if (isNaN(numericValue) || numericValue === null) return { text: code, raw: INVALID_RAW };
    return { text: formatValue(numericValue, "C"), raw: numericValue };
  }
  function convertInductor(code) {
    let numericValue;
    if (/^[0-9.]*[RNUMH][0-9.]*[H]?$/.test(code)) {
      numericValue = parseInductorWithUnit(code);
    } else {
      numericValue = plainCodeToNumber(code, false);
    }
    if (isNaN(numericValue) || numericValue === null) return { text: code, raw: INVALID_RAW };
    return { text: formatValue(numericValue, "L"), raw: numericValue };
  }
  function plainCodeToNumber(code, fourDigitRule) {
    if (/^\d+$/.test(code)) {
      if (code.length === 3) return parseInt(code.substring(0, 2), 10) * Math.pow(10, parseInt(code.substring(2, 3), 10));
      if (code.length === 4 && fourDigitRule) return parseInt(code.substring(0, 3), 10) * Math.pow(10, parseInt(code.substring(3, 4), 10));
    }
    return parseFloat(code);
  }
  var ZERO_RESISTOR_CODES = ["0", "00", "000", "0R"];
  var RESISTOR_MULTIPLIERS = { R: 1, K: 1e3, M: 1e6 };
  function parseLeadingR(upper) {
    const numericValue = parseFloat("0." + upper.substring(1));
    return isNaN(numericValue) ? null : numericValue;
  }
  function splitResistorUnit(upper) {
    const match = upper.match(/^([0-9]*\.?[0-9]*)[RKM]([0-9]*)$/);
    if (!match) return null;
    const integerPart = match[1] || "0";
    const unitChar = upper.includes("K") ? "K" : upper.includes("M") ? "M" : "R";
    const decimalPart = match[2] || "";
    return { integerPart, decimalPart, unitChar };
  }
  function resistorValueOf(parts) {
    const head = parts.decimalPart ? parseFloat(parts.integerPart + "." + parts.decimalPart) : parseFloat(parts.integerPart);
    if (isNaN(head)) return null;
    const numericValue = parts.integerPart === "0" && parts.decimalPart ? parseFloat("0." + parts.decimalPart) : head;
    return numericValue * (RESISTOR_MULTIPLIERS[parts.unitChar] || 1);
  }
  function parseResistorWithUnit(code) {
    const upper = String(code).toUpperCase();
    if (ZERO_RESISTOR_CODES.includes(upper)) return 0;
    if (upper.startsWith("R") && upper.length >= 2) return parseLeadingR(upper);
    const parts = splitResistorUnit(upper);
    if (!parts) return parseFloat(upper);
    return resistorValueOf(parts);
  }
  function parseCapacitorWithUnit(code) {
    const upper = String(code).toUpperCase().replace("F", "");
    const match = upper.match(/^([0-9.]*)([PNUM])([0-9.]*)$/);
    if (!match) return parseFloat(upper);
    const numericValue = joinDecimal(match[1], match[3]);
    if (numericValue === null) return null;
    const multipliers = { P: 1, N: 1e3, U: 1e6, M: 1e9 };
    return numericValue * (multipliers[match[2]] || 1);
  }
  function parseInductorWithUnit(code) {
    const upper = String(code).toUpperCase().replace("H", "");
    if (upper.startsWith("R") && upper.length >= 2) {
      const numericValue2 = parseFloat("0." + upper.substring(1));
      return isNaN(numericValue2) ? null : numericValue2;
    }
    const match = upper.match(/^([0-9.]*)([RNUMH])([0-9.]*)$/);
    if (!match) return parseFloat(upper);
    const numericValue = joinDecimal(match[1], match[3]);
    if (numericValue === null) return null;
    const multipliers = { R: 1, U: 1, N: 1e-3, M: 1e3, H: 1e6 };
    return numericValue * (multipliers[match[2]] || 1);
  }
  function joinDecimal(integerPart, decimalPart) {
    const head = integerPart || "0";
    const value = decimalPart ? parseFloat(head + "." + decimalPart) : parseFloat(head);
    return isNaN(value) ? null : value;
  }
  var VALUE_UNITS = {
    R: [
      { unit: "mΩ", factor: 1e-3 },
      { unit: "Ω", factor: 1 },
      { unit: "kΩ", factor: 1e3 },
      { unit: "MΩ", factor: 1e6 }
    ],
    C: [
      { unit: "pF", factor: 1 },
      { unit: "nF", factor: 1e3 },
      { unit: "uF", factor: 1e6 },
      { unit: "mF", factor: 1e9 },
      { unit: "F", factor: 1e12 }
    ],
    L: [
      { unit: "nH", factor: 1e-3 },
      { unit: "uH", factor: 1 },
      { unit: "mH", factor: 1e3 },
      { unit: "H", factor: 1e6 }
    ]
  };
  var ZERO_TEXT = { R: "0Ω", C: "0pF", L: "0uH" };
  function bestUnitOf(typeUnits, absValue) {
    let bestUnit = typeUnits[0];
    for (let i = typeUnits.length - 1; i >= 0; i--) {
      if (absValue >= typeUnits[i].factor || i === 0) {
        bestUnit = typeUnits[i];
        break;
      }
    }
    return bestUnit;
  }
  function formatValue(value, type) {
    if (value === void 0 || value === null || isNaN(value)) return null;
    if (value === 0) return ZERO_TEXT[type] || "0";
    const typeUnits = VALUE_UNITS[type];
    if (!typeUnits) return value.toString();
    const bestUnit = bestUnitOf(typeUnits, Math.abs(value));
    const displayValue = Number((value / bestUnit.factor).toFixed(3)).toString();
    return displayValue + bestUnit.unit;
  }

  // iframe/js/src/app/code-convert/group.js
  var TYPE_ORDER = { R: 1, C: 2, L: 3 };
  var EMPTY_ID = "空";
  function hasUniqueIdProblem(componentsMap2) {
    const seen = /* @__PURE__ */ new Set();
    let empty = false;
    let duplicate = false;
    for (const key in componentsMap2) {
      const component = componentsMap2[key];
      if (!component || !component.props) continue;
      const uniqueId = component.props["Unique ID"];
      if (!uniqueId) {
        empty = true;
        break;
      }
      if (seen.has(uniqueId)) {
        duplicate = true;
        break;
      }
      seen.add(uniqueId);
    }
    return { empty, duplicate, ok: !empty && !duplicate };
  }
  function processComponents(componentsMap2) {
    const list = [];
    for (const key in componentsMap2) {
      const component = componentsMap2[key];
      if (!component || !component.props) continue;
      const props = component.props;
      const designator = props.Designator;
      const name = props.Name;
      const uniqueId = props["Unique ID"];
      const footprint = props.FootprintName || "";
      if (!designator || !/^[RCL]\d+/i.test(designator) || /(?:[MK]?Ω|[PNU]?F|[UM]?H|F)/i.test(name)) continue;
      const compType = designator[0].toUpperCase();
      const result = convertCodeToValue(name, compType);
      const isConverted = result.text !== name && result.text !== null;
      list.push({
        uniqueId,
        designator,
        footprint,
        compType,
        rawValue: result.raw,
        name,
        value: result.text,
        shouldModify: isConverted,
        modified: isConverted && Boolean(uniqueId)
      });
    }
    return list;
  }
  function groupComponents(componentsData) {
    const list = Array.isArray(componentsData) ? componentsData : [];
    const groups = [];
    const map = /* @__PURE__ */ new Map();
    const idCount = countUniqueIds(list);
    for (const component of list) {
      const key = JSON.stringify([component.name, component.value, component.footprint]);
      let group = map.get(key);
      if (!group) {
        group = createGroup(component);
        map.set(key, group);
        groups.push(group);
      }
      if (hasIdError(component, idCount)) {
        group.hasError = true;
        group.modified = false;
      }
      group.uniqueIds.push(component.uniqueId || EMPTY_ID);
      group.designators.push(component.designator);
    }
    groups.sort((a, b) => {
      const typeA = TYPE_ORDER[a.compType] || 99;
      const typeB = TYPE_ORDER[b.compType] || 99;
      if (typeA !== typeB) return typeA - typeB;
      return a.rawValue - b.rawValue;
    });
    return groups;
  }
  function countUniqueIds(list) {
    const idCount = /* @__PURE__ */ new Map();
    for (const component of list) {
      if (component.uniqueId) idCount.set(component.uniqueId, (idCount.get(component.uniqueId) || 0) + 1);
    }
    return idCount;
  }
  function hasIdError(component, idCount) {
    if (!component.uniqueId) return true;
    return idCount.get(component.uniqueId) > 1;
  }
  function createGroup(component) {
    return {
      uniqueIds: [],
      designators: [],
      footprint: component.footprint,
      compType: component.compType,
      rawValue: component.rawValue,
      name: component.name,
      value: component.value,
      shouldModify: component.shouldModify,
      modified: component.modified,
      hasError: false
    };
  }
  function applyConversion(groups, componentsMap2) {
    const index = indexByUniqueId(componentsMap2);
    let count = 0;
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!isApplicable(group)) continue;
      count += applyGroup(group, index);
    }
    return count;
  }
  function indexByUniqueId(componentsMap2) {
    const index = /* @__PURE__ */ new Map();
    for (const key in componentsMap2) {
      const component = componentsMap2[key];
      if (!component || !component.props) continue;
      const uniqueId = component.props["Unique ID"];
      if (uniqueId && !index.has(uniqueId)) index.set(uniqueId, component);
    }
    return index;
  }
  function isApplicable(group) {
    return Boolean(group.modified && group.shouldModify && !group.hasError);
  }
  function applyGroup(group, index) {
    let count = 0;
    for (const uniqueId of group.uniqueIds) {
      if (!uniqueId || uniqueId === EMPTY_ID) continue;
      const component = index.get(uniqueId);
      if (!component) continue;
      component.props.Name = group.value;
      component.props.Value = group.value;
      count++;
    }
    return count;
  }

  // iframe/js/src/app/code-convert/index.js
  var jsonData = null;
  var componentsMap = null;
  var Page = "PCB";
  var grouped = [];
  var tableBody = document.getElementById("tableBody");
  var selectAllBox = document.getElementById("selectAll");
  var executeBtn = document.getElementById("executeBtn");
  var versionTag = document.getElementById("versionTag");
  var bar = createStatusBar({ textEl: document.getElementById("status"), baseClass: "status" });
  function renderTable() {
    tableBody.innerHTML = "";
    grouped.forEach((group, index) => {
      const row = document.createElement("tr");
      const modifyCell = document.createElement("td");
      modifyCell.className = "checkbox-cell";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = group.modified;
      checkbox.disabled = group.hasError;
      checkbox.dataset.index = index;
      checkbox.style.transform = "scale(1)";
      checkbox.addEventListener("change", function() {
        if (!group.hasError) grouped[index].modified = this.checked;
        updateSelectAllCheckbox();
      });
      modifyCell.appendChild(checkbox);
      row.appendChild(modifyCell);
      row.appendChild(ellipsisCell(group.designators.join(","), 150));
      row.appendChild(ellipsisCell(group.footprint || "-", 150));
      const nameCell = document.createElement("td");
      nameCell.textContent = group.name;
      row.appendChild(nameCell);
      const valueCell = document.createElement("td");
      valueCell.textContent = group.value;
      if (group.shouldModify) {
        valueCell.style.color = "#4CAF50";
        valueCell.style.fontWeight = "bold";
      }
      row.appendChild(valueCell);
      tableBody.appendChild(row);
    });
    updateSelectAllCheckbox();
  }
  function ellipsisCell(text, maxWidth) {
    const cell = document.createElement("td");
    cell.textContent = text;
    cell.title = text;
    cell.style.maxWidth = maxWidth + "px";
    cell.style.overflow = "hidden";
    cell.style.textOverflow = "ellipsis";
    cell.style.whiteSpace = "nowrap";
    return cell;
  }
  function modifiableGroups() {
    return grouped.filter((group) => group.shouldModify && !group.hasError);
  }
  function updateSelectAllCheckbox() {
    const summary = selectionSummary(modifiableGroups(), (group) => group.modified);
    selectAllBox.checked = summary.isAll;
    selectAllBox.indeterminate = summary.isIndeterminate;
  }
  function toggleSelectAll() {
    setAllSelected(modifiableGroups(), (group, value) => group.modified = value, selectAllBox.checked);
    renderTable();
  }
  async function executeConversion() {
    try {
      applyConversion(grouped, componentsMap);
      await setNetlist(Page, JSON.stringify(jsonData));
      const host = getEda();
      if (host && host.sys_IFrame && typeof host.sys_IFrame.closeIFrame === "function") {
        host.sys_IFrame.closeIFrame("CodeConvert");
      }
    } catch (error) {
      console.error("执行转换失败:", error);
      bar.text("转换失败: " + error.message, "error");
    }
  }
  async function initialize() {
    try {
      versionTag.textContent = (getVersionFamily() || "V2") + "模式";
    } catch (e) {
      versionTag.textContent = "V2模式";
    }
    try {
      const netlist = await getNetlist("AUTO");
      Page = netlist.page;
      jsonData = netlist.json;
      componentsMap = getComponentsContainer(jsonData);
      const check = hasUniqueIdProblem(componentsMap);
      grouped = groupComponents(processComponents(componentsMap));
      renderTable();
      selectAllBox.addEventListener("change", toggleSelectAll);
      executeBtn.addEventListener("click", executeConversion);
      if (!check.ok) {
        bar.text("部分元件的唯一ID为空/重复，可以在菜单栏-设计-重置唯一ID，否则会出现异常", "error");
        executeBtn.disabled = true;
      } else {
        bar.text("数据加载成功，请仔细检查后，选择要转换的元件", "info");
        executeBtn.disabled = false;
      }
    } catch (error) {
      console.error("初始化失败:", error);
      bar.text("数据加载失败: " + error.message, "error");
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
