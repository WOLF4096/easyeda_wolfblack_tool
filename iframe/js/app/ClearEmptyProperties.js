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

  // iframe/js/src/ui/table.js
  var SORT_INDICATOR = Object.freeze({ asc: "▲", desc: "▼", none: "" });
  function nextSortState(state, key) {
    const current = state || { key: null, asc: true };
    if (current.key === key) return { key, asc: !current.asc };
    return { key, asc: true };
  }
  function sortRows(rows2, spec) {
    const list = Array.isArray(rows2) ? rows2.slice() : [];
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
  function setAllSelected(items, setSelected, value) {
    const list = Array.isArray(items) ? items : [];
    for (const item of list) setSelected(item, !!value);
    return list.length;
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

  // iframe/js/src/app/clear-empty-properties/propsModel.js
  var PRESERVE_KEYS = Object.freeze([
    "Convert to PCB",
    "Reuse Block",
    "Group ID",
    "Channel ID",
    "PCB Layer",
    "Device",
    "Footprint",
    "Add into BOM",
    "FootprintName",
    "DeviceName",
    "SymbolName"
  ]);
  var BASE_PROPS = Object.freeze(["Name", "Unique ID", "Designator", "3D Model", "3D Model Title", "3D Model Transform"]);
  var KEY_PROPS = Object.freeze(["Manufacturer", "Manufacturer Part", "Supplier", "Supplier Part", "Value"]);
  function categoryOf(key) {
    if (PRESERVE_KEYS.includes(key)) return "preserve";
    if (BASE_PROPS.includes(key)) return "base";
    if (KEY_PROPS.includes(key)) return "key";
    return "more";
  }
  function buildRows(container) {
    const rows2 = [];
    if (!container || typeof container !== "object") return rows2;
    for (const key in container) {
      const comp = container[key];
      if (!comp || !comp.props || !comp.props.Designator) continue;
      const supplier = comp.props.Supplier || "";
      const isEmptySupplier = supplier.trim() === "";
      rows2.push({
        id: key,
        designator: comp.props.Designator || "",
        name: comp.props.Name || "",
        // 优先读取 FootprintName，没有则降级读取 Footprint
        footprint: comp.props.FootprintName || comp.props.Footprint || "",
        supplier,
        // UI 勾选状态：Supplier 为空时勾选行与「更多属性」，否则全不选
        selected: isEmptySupplier,
        clearBase: false,
        clearKey: false,
        clearMore: isEmptySupplier,
        refProps: comp.props
      });
    }
    return rows2;
  }
  function clearBySelection(rows2) {
    const list = Array.isArray(rows2) ? rows2 : [];
    let components = 0;
    let props = 0;
    for (const row of list) {
      if (!row.selected || !(row.clearBase || row.clearKey || row.clearMore)) continue;
      let modified = false;
      const target = row.refProps || {};
      for (const key in target) {
        const category = categoryOf(key);
        if (category === "preserve") continue;
        const shouldClear = category === "base" && row.clearBase || category === "key" && row.clearKey || category === "more" && row.clearMore;
        if (!shouldClear || target[key] === "") continue;
        target[key] = "";
        modified = true;
        props++;
      }
      if (modified) components++;
    }
    return { components, props };
  }
  function toggleColumn(rows2, field) {
    const active = (Array.isArray(rows2) ? rows2 : []).filter((row) => row.selected);
    if (active.length === 0) return false;
    const targetState = !active.every((row) => row[field]);
    for (const row of active) row[field] = targetState;
    return targetState;
  }

  // iframe/js/src/app/clear-empty-properties/index.js
  var rawNetlistData = null;
  var dataSourceMode = "PCB";
  var rows = [];
  var sortState = { key: null, asc: true };
  var tbody = document.getElementById("tableBody");
  var btnRefresh = document.getElementById("btnRefresh");
  var btnClear = document.getElementById("btnClear");
  var cbAllRows = document.getElementById("cbAllRows");
  var thAllBase = document.getElementById("thAllBase");
  var thAllKey = document.getElementById("thAllKey");
  var thAllMore = document.getElementById("thAllMore");
  function cellOf(row, key) {
    return row[key] || "";
  }
  function renderTable() {
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #888;">未找到组件数据，请检查图纸</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((item, index) => {
      const rowClass = item.selected ? "" : "disabled-row";
      const disabledAttr = item.selected ? "" : "disabled";
      return `
					<tr class="${rowClass}">
						<td><input type="checkbox" class="cb-row" data-index="${index}" ${item.selected ? "checked" : ""}></td>
						<td title="${escapeHtml(item.designator)}">${escapeHtml(item.designator)}</td>
						<td title="${escapeHtml(item.name)}">${escapeHtml(item.name || "-")}</td>
						<td title="${escapeHtml(item.footprint)}">${escapeHtml(item.footprint || "-")}</td>
						<td title="${escapeHtml(item.supplier)}">${escapeHtml(item.supplier || "-")}</td>
						<td><input type="checkbox" class="cb-base" data-index="${index}" ${item.clearBase ? "checked" : ""} ${disabledAttr}></td>
						<td><input type="checkbox" class="cb-key" data-index="${index}" ${item.clearKey ? "checked" : ""} ${disabledAttr}></td>
						<td><input type="checkbox" class="cb-more" data-index="${index}" ${item.clearMore ? "checked" : ""} ${disabledAttr}></td>
					</tr>
				`;
    }).join("");
    updateSelectAllRowState();
  }
  function updateSelectAllRowState() {
    if (rows.length === 0) return;
    const summary = selectionSummary(rows, (item) => item.selected);
    cbAllRows.checked = summary.isAll;
    cbAllRows.indeterminate = summary.isIndeterminate;
  }
  function sortAndRender() {
    rows = sortRows(rows, { key: sortState.key, asc: sortState.asc, value: cellOf });
    renderTable();
  }
  async function fetchData() {
    if (!hasEda()) {
      toast("未检测到 EDA 运行环境", 2);
      return;
    }
    try {
      btnRefresh.disabled = true;
      btnRefresh.textContent = "获取中...";
      const netlist = await getNetlist("AUTO");
      dataSourceMode = netlist.page;
      rawNetlistData = netlist.json;
      rows = buildRows(getComponentsContainer(rawNetlistData));
      sortState = { key: "designator", asc: true };
      sortAndRender();
      toast(`成功获取 ${rows.length} 个元件数据`, "success");
    } catch (error) {
      console.error("网表获取失败:", error);
      toast("获取数据失败: " + error.message, "error");
    } finally {
      btnRefresh.disabled = false;
      btnRefresh.textContent = "刷新数据";
    }
  }
  async function executeClear() {
    if (!rawNetlistData || rows.length === 0) return;
    const pending = rows.filter((item) => item.selected && (item.clearBase || item.clearKey || item.clearMore));
    if (pending.length === 0) {
      toast("没有勾选需要清空的属性或元件", "warning");
      return;
    }
    try {
      const stat = clearBySelection(rows);
      const updatedJsonString = JSON.stringify(rawNetlistData, null, 2);
      await setNetlist(dataSourceMode, updatedJsonString);
      toast(`成功处理 ${stat.components} 个元件`, "success");
    } catch (error) {
      console.error("写回网表失败:", error);
      toast("执行失败: " + error.message, "error");
    }
  }
  function bindEvents() {
    btnRefresh.addEventListener("click", fetchData);
    btnClear.addEventListener("click", executeClear);
    tbody.addEventListener("change", (e) => {
      const target = e.target;
      if (target.tagName !== "INPUT" || target.type !== "checkbox") return;
      const item = rows[parseInt(target.getAttribute("data-index"), 10)];
      if (!item) return;
      if (target.classList.contains("cb-row")) {
        item.selected = target.checked;
        renderTable();
      } else if (target.classList.contains("cb-base")) {
        item.clearBase = target.checked;
      } else if (target.classList.contains("cb-key")) {
        item.clearKey = target.checked;
      } else if (target.classList.contains("cb-more")) {
        item.clearMore = target.checked;
      }
    });
    document.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        sortState = nextSortState(sortState, th.getAttribute("data-sort"));
        document.querySelectorAll(".sort-icon").forEach((icon2) => icon2.textContent = "");
        const icon = th.querySelector(".sort-icon");
        if (icon) icon.textContent = sortState.asc ? "▲" : "▼";
        sortAndRender();
      });
    });
    cbAllRows.addEventListener("change", (e) => {
      setAllSelected(rows, (item, value) => item.selected = value, e.target.checked);
      renderTable();
    });
    thAllBase.addEventListener("click", () => applyColumnToggle("clearBase"));
    thAllKey.addEventListener("click", () => applyColumnToggle("clearKey"));
    thAllMore.addEventListener("click", () => applyColumnToggle("clearMore"));
  }
  function applyColumnToggle(field) {
    toggleColumn(rows, field);
    renderTable();
  }
  function start() {
    bindEvents();
    if (!hasEda()) return;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fetchData);
    else fetchData();
  }
  start();
})();
