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
  function hasEda() {
    return !!getEda();
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
  function isModern() {
    const family = getVersionFamily();
    return family === "V3" || family === "V4";
  }

  // iframe/js/src/core/util.js
  function naturalCompare(a, b) {
    const sa = a === null || a === void 0 ? "" : String(a);
    const sb = b === null || b === void 0 ? "" : String(b);
    return sa.localeCompare(sb, "en", { numeric: true, sensitivity: "base" });
  }

  // iframe/js/src/core/concurrency.js
  var DEFAULT_CHUNK_SIZE = 10;
  var DEFAULT_YIELD_MS = 10;
  async function mapInChunks(items, size, mapper, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const chunkSize = Math.max(1, Number(size) || DEFAULT_CHUNK_SIZE);
    const yieldMs = options.yieldMs === void 0 ? DEFAULT_YIELD_MS : Number(options.yieldMs) || 0;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const results = new Array(list.length);
    let done = 0;
    for (let start = 0; start < list.length; start += chunkSize) {
      const chunk = list.slice(start, start + chunkSize);
      await Promise.all(
        chunk.map(async (item, offset) => {
          try {
            results[start + offset] = await mapper(item, start + offset);
          } finally {
            done += 1;
            if (onProgress) onProgress(done, list.length, item);
          }
        })
      );
      if (yieldMs > 0) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, yieldMs));
      }
    }
    return results;
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
  function nextSortState(state, key) {
    const current = state || { key: null, asc: true };
    if (current.key === key) return { key, asc: !current.asc };
    return { key, asc: true };
  }
  function sortIndicatorOf(state, key) {
    if (!state || state.key !== key) return SORT_INDICATOR.none;
    return state.asc ? SORT_INDICATOR.asc : SORT_INDICATOR.desc;
  }
  function sortRows(rows, spec) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const key = spec && spec.key;
    if (!key) return list;
    const getValue = spec.value;
    const compare = typeof spec.compare === "function" ? spec.compare : naturalCompare;
    const dir = spec.asc === false ? -1 : 1;
    list.sort((a, b) => dir * compare(getValue(a, key), getValue(b, key)));
    return list;
  }
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

  // iframe/js/src/app/replace-component/componentReader.js
  function pickDevice(result) {
    return (Array.isArray(result) ? result[0] : result) || null;
  }
  function pickPrimitiveId(handle) {
    if (!handle) return null;
    if (Array.isArray(handle)) return handle.length ? pickPrimitiveId(handle[0]) : null;
    if (typeof handle === "string") return handle;
    if (handle.primitiveId) return handle.primitiveId;
    if (typeof handle.getState_PrimitiveId === "function") return handle.getState_PrimitiveId();
    return null;
  }
  function getDeviceUuid(comp) {
    const u = comp && comp.component ? comp.component.uuid : null;
    if (!u) return "";
    return typeof u === "string" ? u : u.uuid || "";
  }
  function getFootprintUuid(comp) {
    const f = comp && comp.footprint ? comp.footprint.uuid : null;
    if (!f) return "";
    return typeof f === "string" ? f : f.uuid || "";
  }
  function getFootprintName(comp) {
    if (!comp) return "";
    const f = comp.footprint;
    if (f && typeof f === "object" && f.name) return f.name;
    if (typeof f === "string" && f) return f;
    return comp.otherProperty && comp.otherProperty.Footprint || "";
  }
  function getDeviceNameJson(comp) {
    const u = comp && comp.component ? comp.component.uuid : null;
    if (!u || typeof u !== "object") return null;
    return JSON.stringify({ name: u.name || "", source: u.source || "", uuid: u.uuid || "" });
  }
  function resolveDynamicString(str, properties, fallbackDevice = "") {
    if (!str || typeof str !== "string") return str;
    let hasTemplate = false;
    let hasMissingValue = false;
    const result = str.replace(/=\{([^}]+)\}/g, (match, propName) => {
      hasTemplate = true;
      if (properties[propName] !== void 0 && properties[propName] !== "") {
        return properties[propName];
      }
      hasMissingValue = true;
      return match;
    });
    if (hasTemplate && hasMissingValue && fallbackDevice) return fallbackDevice;
    return result;
  }
  function extractProps(comp) {
    const rawName = comp.name || comp.component && comp.component.name || "";
    const props = comp.otherProperty || {};
    const deviceFromComponent = deviceFromComponentOf(comp);
    const deviceName = deviceNameOf(comp, props, deviceFromComponent);
    const mergedProps = { ...comp, ...props };
    const name = resolveDynamicString(rawName, mergedProps, deviceName);
    const footprint = footprintOf(comp, mergedProps);
    const supplierId = comp.supplierId || "";
    return { name, footprint, supplierId };
  }
  function deviceFromComponentOf(comp) {
    if (!(comp.component && typeof comp.component === "object")) return "";
    return comp.component.uuid && typeof comp.component.uuid === "object" && comp.component.uuid.name || comp.component.name;
  }
  function deviceNameOf(comp, props, deviceFromComponent) {
    return props.Device || props.DeviceName || deviceFromComponent || comp.manufacturerId || "";
  }
  function footprintOf(comp, mergedProps) {
    return mergedProps && mergedProps.Footprint || comp.otherProperty && comp.otherProperty.Footprint || comp.footprint && comp.footprint.name || (typeof comp.footprint === "string" ? comp.footprint : "") || "";
  }
  function buildGroupKey(props) {
    return `${props.name}|${props.footprint}|${props.supplierId}`;
  }
  function enrichComponentData(sel, pInfo) {
    if (!pInfo || !pInfo.device_info) return sel;
    const attrs = pInfo.device_info.attributes || {};
    applyRootAttributes(sel, pInfo, attrs);
    sel.otherProperty = sel.otherProperty || {};
    for (const key in attrs) {
      if (!STRUCTURAL_ATTRS.includes(key)) sel.otherProperty[key] = attrs[key];
    }
    applyFootprint3d(sel.otherProperty, pInfo.device_info.footprint_info);
    return sel;
  }
  var STRUCTURAL_ATTRS = ["Footprint", "Symbol", "3D Model", "Designator"];
  function applyRootAttributes(sel, pInfo, attrs) {
    sel.manufacturer = pInfo.brandName || attrs.Manufacturer || sel.manufacturer;
    sel.manufacturerId = pInfo.model || attrs["Manufacturer Part"] || sel.manufacturerId;
    sel.supplier = attrs.Supplier || sel.supplier || "LCSC";
    sel.supplierId = pInfo.code || sel.supplierId;
  }
  function applyFootprint3d(otherProperty, fpInfo) {
    if (!fpInfo || !fpInfo.model_3d) return;
    const libUuid = fpInfo.creator ? fpInfo.creator.uuid : "";
    otherProperty["3D Model"] = otherProperty["3D Model"] || (libUuid ? `${fpInfo.model_3d.uri}|${libUuid}` : fpInfo.model_3d.uri);
    otherProperty["3D Model Title"] = otherProperty["3D Model Title"] || fpInfo.model_3d.title;
    otherProperty["3D Model Transform"] = otherProperty["3D Model Transform"] || fpInfo.model_3d.transform;
  }

  // iframe/js/src/app/replace-component/pastePlan.js
  function parseClipboard(text) {
    const pasteMap = /* @__PURE__ */ new Map();
    const lines = String(text === null || text === void 0 ? "" : text).split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[\t\s]+/);
      if (parts.length < 2) continue;
      const newSupplierId = parts.pop().trim();
      const designatorsStr = parts.join(",");
      for (const designator of designatorsStr.split(/[,\s]+/)) {
        const d = designator.trim();
        if (d) pasteMap.set(d, newSupplierId);
      }
    }
    return pasteMap;
  }
  function flattenGroups(groups) {
    const items = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      group.designators.forEach((designator, index) => {
        items.push({
          designator,
          primitiveId: group.primitiveId[index],
          sourceComp: group.ComponentsSource[index],
          original: { ...group.original },
          target: { ...group.target },
          options: { ...group.options },
          selected: group.selected,
          ComponentsTarget: group.ComponentsTarget
        });
      });
    }
    return items;
  }
  function applyTargetSupplierIds(items, pasteMap) {
    let updateCount = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const newSupplierId = pasteMap.get(item.designator);
      if (!newSupplierId || item.target.supplierId === newSupplierId) continue;
      item.target.supplierId = newSupplierId;
      item.selected = true;
      item.target.name = null;
      item.target.footprint = null;
      item.target.footprintuuid = null;
      item.target.uuid = null;
      item.ComponentsTarget = null;
      updateCount += 1;
    }
    return updateCount;
  }
  function regroupGroups(items) {
    const groupMap = /* @__PURE__ */ new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const key = `${item.original.name}|${item.original.footprint}|${item.original.supplierId}|${item.target.supplierId}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          designators: [],
          primitiveId: [],
          original: item.original,
          target: item.target,
          options: item.options,
          selected: item.selected,
          ComponentsSource: [],
          ComponentsTarget: item.ComponentsTarget
        });
      }
      const group = groupMap.get(key);
      group.designators.push(item.designator);
      group.primitiveId.push(item.primitiveId);
      group.ComponentsSource.push(item.sourceComp);
    }
    const groups = Array.from(groupMap.values());
    for (const group of groups) {
      group.designators.sort(naturalCompare);
    }
    return groups;
  }

  // iframe/js/src/app/replace-component/sourceRewrite.js
  function pickReplacement(action, key) {
    if (key === "Device") return action.targetDeviceUuid;
    if (key === "Name") return action.preserveName ? void 0 : action.targetName;
    if (key === "Footprint") return action.preserveFootprint ? void 0 : action.targetFootprintUuid;
    return void 0;
  }
  function rewriteV2Line(line, targetMap) {
    let arr;
    try {
      arr = JSON.parse(line);
    } catch {
      return line;
    }
    if (!Array.isArray(arr) || arr[0] !== "ATTR") return line;
    const action = targetMap.get(arr[3]);
    if (!action) return line;
    const next = pickReplacement(action, arr[7]);
    if (next === void 0) return line;
    arr[8] = next;
    return JSON.stringify(arr);
  }
  function joinModernLine(head, tail, hasTrailingPipe) {
    return JSON.stringify(head) + "||" + JSON.stringify(tail) + (hasTrailingPipe ? "|" : "");
  }
  function rewriteModernLine(line, targetMap) {
    const hasTrailingPipe = line.endsWith("|");
    const cleanLine = hasTrailingPipe ? line.slice(0, -1) : line;
    const parts = cleanLine.split("||");
    if (parts.length !== 2) return line;
    let head;
    let tail;
    try {
      head = JSON.parse(parts[0]);
      tail = JSON.parse(parts[1]);
    } catch {
      return line;
    }
    if (head.type === "COMPONENT") return rewriteComponentLine(line, head, tail, targetMap, hasTrailingPipe);
    if (head.type === "ATTR") {
      const action = targetMap.get(tail.parentId);
      if (!action) return line;
      const next = pickReplacement(action, tail.key);
      if (next === void 0) return line;
      tail.value = next;
      return joinModernLine(head, tail, hasTrailingPipe);
    }
    return line;
  }
  function rewriteComponentLine(line, head, tail, targetMap, hasTrailingPipe) {
    const action = targetMap.get(head.id);
    if (!action || !action.targetDeviceNameJson) return line;
    tail.attrs = tail.attrs || {};
    tail.attrs.DeviceName = action.targetDeviceNameJson;
    return joinModernLine(head, tail, hasTrailingPipe);
  }
  function rewriteLine(line, targetMap) {
    if (!line || !line.trim()) return line;
    if (line.startsWith("[")) return rewriteV2Line(line, targetMap);
    if (line.startsWith("{") && line.includes("||")) return rewriteModernLine(line, targetMap);
    return line;
  }
  function rewriteSource(text, targetMap) {
    const lines = String(text === null || text === void 0 ? "" : text).split("\n");
    return lines.map((line) => rewriteLine(line, targetMap)).join("\n");
  }

  // iframe/js/src/app/replace-component/netlistSync.js
  var PRESERVE_KEYS = Object.freeze([
    "Footprint",
    "Designator",
    "Add into BOM",
    "3D Model",
    "3D Model Title",
    "3D Model Transform",
    "Device",
    "Unique ID",
    "Reuse Block",
    "Group ID",
    "Channel ID",
    "Convert to PCB"
  ]);
  var PRESERVE_SET = new Set(PRESERVE_KEYS);
  function mergeIntoProps(props, action) {
    const targetComp = action.targetComp || {};
    mergeOtherProperties(props, targetComp.otherProperty);
    mergeSupplierFields(props, targetComp);
    props.Name = action.preserveName ? action.sourceName : action.targetName;
    props.FootprintName = action.preserveFootprint ? action.sourceFootprintName : targetComp.footprint ? targetComp.footprint.name : "";
    props.DeviceName = targetComp.manufacturerId || "";
  }
  function mergeOtherProperties(props, otherProperty) {
    if (!otherProperty) return;
    for (const key in otherProperty) {
      if (!PRESERVE_SET.has(key)) props[key] = otherProperty[key];
    }
  }
  function mergeSupplierFields(props, targetComp) {
    if (targetComp.supplier) props.Supplier = targetComp.supplier;
    if (targetComp.supplierId) props["Supplier Part"] = targetComp.supplierId;
    if (targetComp.manufacturer) props.Manufacturer = targetComp.manufacturer;
    if (targetComp.manufacturerId) props["Manufacturer Part"] = targetComp.manufacturerId;
  }
  function applyTargetProps(componentsNode, desigMap) {
    if (!componentsNode || typeof componentsNode !== "object") return 0;
    let count = 0;
    for (const compKey in componentsNode) {
      const compItem = componentsNode[compKey];
      if (!compItem || typeof compItem !== "object" || !compItem.props) continue;
      if (!compItem.props.Designator) continue;
      const action = desigMap.get(compItem.props.Designator);
      if (!action) continue;
      mergeIntoProps(compItem.props, action);
      count += 1;
    }
    return count;
  }

  // iframe/js/src/app/replace-component/index.js
  var TEMP_X = -1e4;
  var TEMP_Y = -1e4;
  var groupedData = [];
  var pendingTempIds = [];
  var sortState = { key: null, asc: true };
  var fetchPollInterval = null;
  var pollBusy = false;
  var SORT_VALUE = {
    designator: (group) => group.designators[0] || "",
    name: (group) => group.target.name || group.original.name || "",
    footprint: (group) => group.target.footprint || group.original.footprint || "",
    supplierId: (group) => group.target.supplierId || group.original.supplierId || ""
  };
  var statusBar = createStatusBar({
    textEl: document.getElementById("statusText"),
    barEl: document.getElementById("progressBg"),
    baseClass: "status-text",
    barBaseClass: "progress-bg"
  });
  var status = {
    reset: () => {
      statusBar.reset();
      statusBar.text("准备就绪，待粘贴数据，格式：位号|C编号（必须从Excel复制粘贴）");
    },
    readyToReplace: (costTime) => {
      statusBar.width(0, "");
      statusBar.text(costTime ? `获取数据完成，耗时${costTime}秒，待替换` : "获取数据完成，待替换");
    },
    setProgress: (current, total, supplierId) => {
      const percent = total === 0 ? 0 : Math.floor(current / total * 100);
      statusBar.text(`器件总数：${current} / ${total} ${percent}%，当前获取：${supplierId}`);
      statusBar.width(percent, "");
    }
  };
  function sortValueOf(row, key) {
    return SORT_VALUE[key] ? SORT_VALUE[key](row) : "";
  }
  function plainCompare(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  function handleSort(key) {
    const next = nextSortState(sortState, key);
    sortState.key = next.key;
    sortState.asc = next.asc;
    groupedData = sortRows(groupedData, {
      key,
      asc: next.asc,
      value: sortValueOf,
      compare: key === "designator" ? naturalCompare : plainCompare
    });
    document.querySelectorAll(".sortable-header .sort-icon").forEach((icon) => {
      icon.textContent = "";
    });
    const activeIcon = document.querySelector(`.sortable-header[data-sort="${key}"] .sort-icon`);
    if (activeIcon) activeIcon.textContent = sortIndicatorOf(sortState, key);
    renderTable();
  }
  async function cleanupTempComponents() {
    const ids = pendingTempIds.slice();
    pendingTempIds = [];
    const targets = new Set(ids);
    try {
      const all = await eda.pcb_PrimitiveComponent.getAll();
      for (const comp of all) {
        if (Math.round(comp.x) === TEMP_X && Math.round(comp.y) === TEMP_Y) targets.add(comp.primitiveId);
      }
      if (targets.size > 0) await eda.pcb_PrimitiveComponent.delete(Array.from(targets));
    } catch (err) {
      logger.warn("清理临时器件失败（画布 (-10000,-10000) 附近可能残留）", err);
    }
  }
  function groupComponents(rawComponents) {
    const groupMap = /* @__PURE__ */ new Map();
    for (const comp of rawComponents) {
      if (!comp.designator) continue;
      const props = extractProps(comp);
      const key = buildGroupKey(props);
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          designators: [],
          primitiveId: [],
          original: props,
          target: { name: null, footprint: null, supplierId: null },
          options: { preserveName: true, preserveFootprint: true, preserve3D: true },
          selected: false,
          ComponentsSource: []
        });
      }
      const group = groupMap.get(key);
      group.designators.push(comp.designator);
      group.primitiveId.push(comp.primitiveId);
      group.ComponentsSource.push(comp);
    }
    const groups = Array.from(groupMap.values());
    for (const group of groups) group.designators.sort(naturalCompare);
    return groups;
  }
  async function initData() {
    try {
      if (!hasEda()) {
        logger.warn("[Debug] 未检测到 eda 对象，等待环境注入或在独立浏览器中运行...");
        return;
      }
      const rawComponents = await eda.pcb_PrimitiveComponent.getAll();
      groupedData = groupComponents(rawComponents);
      renderTable();
    } catch (error) {
      logger.error("[Debug] 初始化数据失败:", error);
    }
  }
  async function handlePaste() {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      logger.error("[Debug] 读取剪贴板失败:", err);
      logger.debug("读取剪贴板失败，请检查浏览器权限或确认是否在安全上下文(https)中！");
      return;
    }
    const pasteMap = parseClipboard(text);
    if (pasteMap.size === 0) return;
    const items = flattenGroups(groupedData);
    const updateCount = applyTargetSupplierIds(items, pasteMap);
    groupedData = regroupGroups(items);
    logger.debug(`[Debug] 匹配并更新了 ${updateCount} 条记录的立创编号`);
    if (updateCount > 0) document.getElementById("btnFetch").disabled = false;
    renderTable();
  }
  function applyFetchedTarget(supplierId, payload) {
    for (const group of groupedData) {
      if (!group.selected || group.target.supplierId !== supplierId) continue;
      group.target.name = payload.name;
      group.target.footprint = payload.footprint;
      group.target.footprintuuid = payload.footprintuuid;
      group.target.uuid = payload.uuid;
      group.ComponentsTarget = payload.comp;
    }
  }
  function resolveTargetProps(sel, pInfo) {
    enrichComponentData(sel, pInfo);
    const rawName = targetRawName(sel, pInfo);
    const props = sel.otherProperty || {};
    const mergedProps = { ...sel, ...props };
    const fallbackDevice = props.Device || props["Manufacturer Part"] || sel.manufacturerId || "";
    let finalName = resolveDynamicString(rawName, mergedProps, fallbackDevice);
    if (String(finalName).includes("={")) finalName = props.Value || sel.manufacturerId || finalName;
    const finalFootprint = targetFootprint(sel, pInfo);
    return {
      name: finalName,
      footprint: finalFootprint,
      footprintuuid: getFootprintUuid(sel),
      uuid: getDeviceUuid(sel),
      comp: sel
    };
  }
  function targetRawName(sel, pInfo) {
    return pInfo && pInfo.device_info && pInfo.device_info.attributes && pInfo.device_info.attributes.Name || sel.name || sel.component && sel.component.name || "";
  }
  function targetFootprint(sel, pInfo) {
    const fpInfo = pInfo ? pInfo.device_info.footprint_info : null;
    return fpInfo && (fpInfo.display_title || fpInfo.title) || getFootprintName(sel) || "未知封装";
  }
  async function fetchProductInfo(supplierId) {
    return null;
  }
  async function placeTempComponents(supplierIds, sysLibUuid) {
    const autoFetchMap = /* @__PURE__ */ new Map();
    const manualPendingIds = /* @__PURE__ */ new Set();
    let placeCount = 0;
    statusBar.width(0, "");
    await mapInChunks(
      supplierIds,
      DEFAULT_CHUNK_SIZE,
      async (supplierId) => {
        try {
          const dev = pickDevice(await eda.lib_Device.getByLcscIds(supplierId));
          if (dev && dev.uuid) {
            const handle = await eda.pcb_PrimitiveComponent.create(
              { libraryUuid: sysLibUuid, uuid: dev.uuid },
              1,
              TEMP_X,
              TEMP_Y,
              0,
              false
            );
            const createdId = pickPrimitiveId(handle);
            if (createdId) autoFetchMap.set(supplierId, createdId);
            else manualPendingIds.add(supplierId);
            placeCount += 1;
          }
        } catch (err) {
          logger.warn(`预载器件 ${supplierId} 失败，转为手动兜底`, err);
          manualPendingIds.add(supplierId);
          placeCount += 1;
        }
      },
      { onProgress: (done, total, supplierId) => status.setProgress(done, total, supplierId) }
    );
    return { autoFetchMap, manualPendingIds, placeCount };
  }
  async function readAutoFetched(autoFetchMap) {
    if (autoFetchMap.size === 0) return;
    const entries = Array.from(autoFetchMap.entries());
    const toDeleteIds = [];
    statusBar.width(0, "");
    await mapInChunks(
      entries,
      DEFAULT_CHUNK_SIZE,
      async (entry) => {
        const supplierId = entry[0];
        const primitiveId = entry[1];
        try {
          const sel = await eda.pcb_PrimitiveComponent.get(primitiveId).catch(() => null);
          if (sel) {
            applyFetchedTarget(supplierId, resolveTargetProps(sel, await fetchProductInfo(supplierId)));
            toDeleteIds.push(primitiveId);
          }
        } catch (getErr) {
          logger.warn("读取器件属性失败，已跳过该器件", getErr);
        }
      },
      { onProgress: (done, total, entry) => status.setProgress(done, total, `获取属性: ${entry[0]}`) }
    );
    if (isModern()) pendingTempIds.push(...toDeleteIds);
    else if (toDeleteIds.length > 0) {
      try {
        await eda.pcb_PrimitiveComponent.delete(toDeleteIds);
      } catch (delErr) {
        logger.error("批量删除原器件失败，可能残留旧器件", delErr);
      }
    }
    renderTable();
    statusBar.width(0, "");
  }
  function pollManualSelection(manualPendingIds, fetchStart) {
    logger.debug(`由于API限制，有 ${manualPendingIds.size} 种器件需要手动辅助。
请在画布中将它们【全部框选】，工具将自动提取参数并删除！`);
    statusBar.text(
      `由于API限制，需手动辅助，请在画布(-10000,-10000)中【框选】新增的 ${manualPendingIds.size} 个器件，工具将自动提取参数并删除！`
    );
    fetchPollInterval = setInterval(async () => {
      if (pollBusy) return;
      pollBusy = true;
      try {
        const selectedItems = await eda.pcb_SelectControl.getAllSelectedPrimitives() || [];
        if (selectedItems.length !== manualPendingIds.size) return;
        const done = await applyManualSelection(selectedItems, manualPendingIds, fetchStart);
        if (!done) return;
        clearInterval(fetchPollInterval);
        fetchPollInterval = null;
      } finally {
        pollBusy = false;
      }
    }, 1e3);
  }
  async function applyManualSelection(selectedItems, manualPendingIds, fetchStart) {
    let hasUpdate = false;
    let validMatchCount = 0;
    await mapInChunks(selectedItems, DEFAULT_CHUNK_SIZE, async (sel) => {
      const selSupplierId = sel.supplierId || sel.otherProperty && (sel.otherProperty["Supplier Part"] || sel.otherProperty.supplierId) || "";
      if (!selSupplierId || !manualPendingIds.has(selSupplierId)) return;
      validMatchCount += 1;
      applyFetchedTarget(selSupplierId, resolveTargetProps(sel, await fetchProductInfo(selSupplierId)));
      manualPendingIds.delete(selSupplierId);
      hasUpdate = true;
    });
    if (!(validMatchCount === selectedItems.length && hasUpdate)) return false;
    const toDeleteIds = selectedItems.map((item) => item.primitiveId).filter((id) => id);
    if (toDeleteIds.length > 0) {
      if (isModern()) pendingTempIds.push(...toDeleteIds);
      else {
        try {
          await eda.pcb_PrimitiveComponent.delete(toDeleteIds);
        } catch (delErr) {
          logger.error("批量删除原器件失败，可能残留旧器件", delErr);
        }
      }
    }
    renderTable();
    const costTime = ((performance.now() - fetchStart) / 1e3).toFixed(2);
    statusBar.width(0, "");
    statusBar.text(`获取完成，耗时${costTime}秒 (已自动删除临时器件)`);
    setTimeout(() => status.readyToReplace(costTime), 3e3);
    return true;
  }
  async function handleFetch() {
    const fetchStart = performance.now();
    statusBar.text("正在检查待获取器件...");
    if (fetchPollInterval) {
      clearInterval(fetchPollInterval);
      fetchPollInterval = null;
    }
    const sysLibUuid = await eda.lib_LibrariesList.getSystemLibraryUuid();
    const pendingSupplierIds = /* @__PURE__ */ new Set();
    for (const group of groupedData) {
      if (group.selected && group.target.supplierId && !group.target.uuid) pendingSupplierIds.add(group.target.supplierId);
    }
    if (pendingSupplierIds.size === 0) {
      statusBar.text("数据已获取");
      setTimeout(() => status.readyToReplace(), 3e3);
      return;
    }
    const { autoFetchMap, manualPendingIds, placeCount } = await placeTempComponents(
      Array.from(pendingSupplierIds),
      sysLibUuid
    );
    if (placeCount === 0) {
      statusBar.text("未能在库中找到对应的器件");
      setTimeout(() => status.readyToReplace(), 3e3);
      return;
    }
    await readAutoFetched(autoFetchMap);
    if (manualPendingIds.size === 0) {
      const costTime = ((performance.now() - fetchStart) / 1e3).toFixed(2);
      statusBar.text(`获取完成，耗时${costTime}秒`);
      document.getElementById("btnReplace").disabled = false;
      setTimeout(() => status.readyToReplace(costTime), 3e3);
      logger.debug(`[性能打点] 🎉 handleFetch 完整生命周期 总耗时: ${costTime} 秒`);
      return;
    }
    pollManualSelection(manualPendingIds, fetchStart);
  }
  function buildTargetMap() {
    const targetMap = /* @__PURE__ */ new Map();
    for (const group of groupedData) {
      if (!group.selected || !group.ComponentsTarget) continue;
      group.primitiveId.forEach((primitiveId, index) => {
        const sourceComp = group.ComponentsSource[index];
        const targetComp = group.ComponentsTarget;
        targetMap.set(primitiveId, {
          preserveName: group.options.preserveName,
          preserveFootprint: group.options.preserveFootprint,
          preserve3D: group.options.preserve3D,
          sourceComp,
          targetComp,
          targetDeviceUuid: getDeviceUuid(targetComp),
          targetDeviceNameJson: getDeviceNameJson(targetComp),
          sourceName: sourceComp.name || "",
          targetName: group.target.name || targetComp.name || "",
          sourceFootprintUuid: getFootprintUuid(sourceComp),
          targetFootprintUuid: getFootprintUuid(targetComp),
          designator: group.designators[index],
          sourceFootprintName: getFootprintName(sourceComp)
        });
      });
    }
    return targetMap;
  }
  async function sync3DModels(targetMap) {
    for (const entry of targetMap.entries()) {
      const primitiveId = entry[0];
      const action = entry[1];
      const modelSource = action.preserve3D ? action.sourceComp : action.targetComp;
      const props = modelSource && modelSource.otherProperty || {};
      const rawUri = props["3D Model"] || "";
      const modelUri = rawUri.includes("|") ? rawUri.split("|")[0] : rawUri;
      await eda.pcb_PrimitiveComponent.modify(primitiveId, {
        otherProperty: {
          "3D Model": modelUri,
          "3D Model Title": props["3D Model Title"] || "",
          "3D Model Transform": props["3D Model Transform"] || ""
        }
      });
    }
  }
  async function syncNetlist(targetMap) {
    const desigMap = /* @__PURE__ */ new Map();
    for (const action of targetMap.values()) desigMap.set(action.designator, action);
    const jsonData = (await getNetlist("PCB")).json;
    applyTargetProps(getComponentsContainer(jsonData), desigMap);
    await setNetlist("PCB", JSON.stringify(jsonData, null, 2));
    logger.debug("[Debug] 网表同步更新完成！");
  }
  async function executeReplace() {
    const startTime = performance.now();
    statusBar.text("正在执行替换...");
    const targetMap = buildTargetMap();
    if (targetMap.size === 0) {
      logger.warn("[Debug] 没有需要替换的有效图元，请检查是否勾选并成功获取了目标数据");
      return;
    }
    try {
      const rawSource = await eda.sys_FileManager.getDocumentSource();
      await eda.sys_FileManager.setDocumentSource(rewriteSource(rawSource, targetMap));
      await cleanupTempComponents();
      await sync3DModels(targetMap);
      try {
        await syncNetlist(targetMap);
      } catch (netErr) {
        logger.error("[Debug] 网表更新阶段发生异常:", netErr);
      }
      const costTime = ((performance.now() - startTime) / 1e3).toFixed(2);
      logger.debug(`[Debug] 替换完成，共处理 ${targetMap.size} 个图元。耗时 ${costTime} 秒`);
      statusBar.text(`替换完成，耗时${costTime}秒`);
      setTimeout(() => status.reset(), 3e3);
    } catch (err) {
      logger.error("[Debug] 替换过程中发生致命错误:", err);
      statusBar.text("替换失败，请查看控制台日志");
      await cleanupTempComponents();
    }
  }
  function renderTable() {
    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";
    groupedData.forEach((group, index) => {
      const tr = document.createElement("tr");
      if (!group.selected) tr.classList.add("disabled-row");
      const designatorText = group.designators.join("、");
      tr.innerHTML = `
                    <td><input type="checkbox" class="row-selector" data-index="${index}" ${group.selected ? "checked" : ""}></td>
                    
                    <td title="${safeTitle(designatorText)}">${designatorText}</td>
                    
                    <td title="${safeTitle(formatTitle(group.original.name, group.target.name))}">${formatCell(group.original.name, group.target.name)}</td>
                    
                    <td title="${safeTitle(formatTitle(group.original.footprint, group.target.footprint))}">${formatCell(group.original.footprint, group.target.footprint)}</td>
                    
                    <td title="${safeTitle(formatTitle(group.original.supplierId, group.target.supplierId))}">${formatCell(group.original.supplierId, group.target.supplierId)}</td>
                    
                    <td><input type="checkbox" class="opt-cb" data-index="${index}" data-key="preserveName" ${group.options.preserveName ? "checked" : ""} ${!group.selected ? "disabled" : ""}></td>
                    <td><input type="checkbox" class="opt-cb" data-index="${index}" data-key="preserveFootprint" ${group.options.preserveFootprint ? "checked" : ""} ${!group.selected ? "disabled" : ""}></td>
                    <td><input type="checkbox" class="opt-cb" data-index="${index}" data-key="preserve3D" ${group.options.preserve3D ? "checked" : ""} ${!group.selected ? "disabled" : ""}></td>
                `;
      tbody.appendChild(tr);
    });
    syncSelectAllState();
  }
  function formatCell(oldVal, newVal) {
    if (newVal && newVal !== oldVal) return `${oldVal || "-"} <span class="change-arrow">→</span> ${newVal}`;
    return oldVal || "-";
  }
  function formatTitle(oldVal, newVal) {
    if (newVal && newVal !== oldVal) return `${oldVal || "-"} → ${newVal}`;
    return String(oldVal || "-");
  }
  function safeTitle(str) {
    return String(str).replace(/"/g, "&quot;");
  }
  function syncSelectAllState() {
    const selectAllCb = document.getElementById("selectAll");
    const summary = selectionSummary(groupedData, (group) => group.selected);
    selectAllCb.checked = summary.isAll;
    selectAllCb.indeterminate = summary.isIndeterminate;
  }
  function bindEvents() {
    const tbody = document.getElementById("tableBody");
    const selectAllCb = document.getElementById("selectAll");
    document.getElementById("btnPaste").addEventListener("click", handlePaste);
    document.getElementById("btnFetch").addEventListener("click", handleFetch);
    document.getElementById("btnReplace").addEventListener("click", executeReplace);
    document.querySelectorAll(".sortable-header").forEach((header) => {
      header.addEventListener("click", () => handleSort(header.getAttribute("data-sort")));
    });
    tbody.addEventListener("change", (event) => {
      const target = event.target;
      if (target.type !== "checkbox") return;
      const group = groupedData[parseInt(target.getAttribute("data-index"), 10)];
      if (!group) return;
      if (target.classList.contains("row-selector")) {
        group.selected = target.checked;
        renderTable();
      } else if (target.classList.contains("opt-cb")) {
        group.options[target.getAttribute("data-key")] = target.checked;
      }
    });
    selectAllCb.addEventListener("change", (event) => {
      const isChecked = event.target.checked;
      groupedData.forEach((group) => {
        group.selected = isChecked;
      });
      renderTable();
    });
    document.querySelectorAll(".clickable-header").forEach((header) => {
      header.addEventListener("click", () => {
        const key = header.getAttribute("data-key");
        const activeGroups = groupedData.filter((group) => group.selected);
        if (activeGroups.length === 0) return;
        const targetState = !activeGroups.every((group) => group.options[key]);
        activeGroups.forEach((group) => {
          group.options[key] = targetState;
        });
        renderTable();
      });
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    initData();
  });
  window.addEventListener("pagehide", () => {
    if (pendingTempIds.length > 0) cleanupTempComponents();
  });
})();
