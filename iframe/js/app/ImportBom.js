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
    const text2 = await file.text();
    if (!text2 || !text2.trim()) throw new Error("获取的网表为空");
    let json;
    try {
      json = JSON.parse(text2);
    } catch (e) {
      throw new Error(`网表格式无法解析（${page}）：${e && e.message || e}`);
    }
    return { page, text: text2, json };
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
    const text2 = typeof json === "string" ? json : JSON.stringify(json);
    const writePcb = () => edaObj.pcb_Net.setNetlist(NETLIST_KEY, text2);
    const writeSch = () => edaObj.sch_Netlist.setNetlist(NETLIST_KEY, text2);
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
      const text2 = version === null || version === void 0 ? "" : String(version).trim();
      if (text2) cachedVersion = text2;
      return text2;
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
    function text2(message, level) {
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
      text2(`${done} / ${total} ${p}%${suffix ? "　" + suffix : ""}`, level);
      width(p, level);
      return p;
    }
    function reset() {
      text2("", "");
      width(0, "");
    }
    return { text: text2, progress, width, reset };
  }

  // iframe/js/src/ui/table.js
  var SORT_INDICATOR = Object.freeze({ asc: "▲", desc: "▼", none: "" });
  function nextSortState(state, key) {
    const current = state || { key: null, asc: true };
    if (current.key === key) return { key, asc: !current.asc };
    return { key, asc: true };
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

  // iframe/js/src/app/import-bom/bomModel.js
  var TRACKED_FIELDS = ["name", "manufacturerPart", "manufacturer", "supplierPart", "supplier"];
  function resolveComponentName(props) {
    const source = props || {};
    const raw = String(source.Name || "");
    if (/^=\{.*\}$/.test(raw)) return source.Value || source.value || "";
    return raw || source.Value || source.value || "";
  }
  function buildRows(container) {
    const rows = [];
    if (!container || typeof container !== "object") return rows;
    for (const [key, component] of Object.entries(container)) {
      if (!component || !component.props) continue;
      rows.push(toRow(key, component.props));
    }
    return rows;
  }
  function text(value) {
    return value || "";
  }
  function toRow(key, props) {
    const designator = text(props.Designator);
    const name = resolveComponentName(props);
    return {
      jsonKey: key,
      uniqueId: props["Unique ID"],
      designator,
      name,
      footprint: props.FootprintName || props.Footprint || "",
      supplier: text(props.Supplier),
      supplierPart: text(props["Supplier Part"]),
      manufacturerPart: text(props["Manufacturer Part"]),
      manufacturer: text(props.Manufacturer),
      selected: false,
      changed: false,
      original: snapshot(designator, name, props)
    };
  }
  function snapshot(designator, name, props) {
    return {
      designator,
      name,
      supplier: props.Supplier || "",
      supplierPart: props["Supplier Part"] || "",
      manufacturerPart: props["Manufacturer Part"] || "",
      manufacturer: props.Manufacturer || ""
    };
  }
  function groupRows(rows) {
    const map = /* @__PURE__ */ new Map();
    const groups = [];
    for (const item of Array.isArray(rows) ? rows : []) {
      const prefix = String(item.designator || "").replace(/[0-9]+$/, "");
      const key = JSON.stringify([
        prefix,
        item.footprint,
        item.name,
        item.supplier,
        item.supplierPart,
        item.manufacturerPart,
        item.manufacturer,
        item.changed,
        item.original.name,
        item.original.supplier,
        item.original.supplierPart,
        item.original.manufacturerPart,
        item.original.manufacturer
      ]);
      let group = map.get(key);
      if (!group) {
        group = {
          items: [],
          designators: [],
          name: item.name,
          supplier: item.supplier,
          supplierPart: item.supplierPart,
          manufacturerPart: item.manufacturerPart,
          manufacturer: item.manufacturer,
          changed: item.changed,
          original: item.original,
          selected: item.selected
        };
        map.set(key, group);
        groups.push(group);
      }
      group.items.push(item);
      group.designators.push(item.designator);
      if (!item.selected) group.selected = false;
    }
    return groups;
  }
  function sortGroups(groups, state) {
    const list = (Array.isArray(groups) ? groups : []).slice();
    if (!state || !state.key) return list;
    const dir = state.asc === false ? -1 : 1;
    list.sort((a, b) => {
      const valA = state.key === "designators" ? a.designators.join(", ") : String(a[state.key] || "");
      const valB = state.key === "designators" ? b.designators.join(", ") : String(b[state.key] || "");
      return dir * naturalCompare(valA, valB);
    });
    return list;
  }
  function applyPaste(rows, pasteItems) {
    const list = Array.isArray(rows) ? rows : [];
    let updated = 0;
    const missing = [];
    const byDesignator = indexByDesignator(list);
    for (const pasteItem of Array.isArray(pasteItems) ? pasteItems : []) {
      for (const designator of pasteItem.designators) {
        const row = byDesignator.get(designator);
        if (!row) {
          missing.push(designator);
          continue;
        }
        updated += applyPasteRow(row, pasteItem);
      }
    }
    return { updated, missing };
  }
  function indexByDesignator(rows) {
    const byDesignator = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (!byDesignator.has(row.designator)) byDesignator.set(row.designator, row);
    }
    return byDesignator;
  }
  function resolveSupplier(pasteItem) {
    if (!pasteItem.supplier && isLcscSupplierPart(pasteItem.supplierPart)) return "LCSC";
    return pasteItem.supplier;
  }
  function isLcscSupplierPart(supplierPart) {
    return Boolean(supplierPart) && supplierPart.trim().toUpperCase().startsWith("C");
  }
  function applyPasteRow(row, pasteItem) {
    const next = {
      name: pasteItem.name,
      manufacturerPart: pasteItem.manufacturerPart,
      manufacturer: pasteItem.manufacturer,
      supplierPart: pasteItem.supplierPart,
      supplier: resolveSupplier(pasteItem)
    };
    const hasChanges = TRACKED_FIELDS.some((field) => next[field] !== row.original[field]);
    if (!hasChanges) return 0;
    Object.assign(row, next, { changed: true, selected: true });
    return 1;
  }
  function applyToComponent(row, comp) {
    if (!comp) return false;
    comp.props = comp.props || {};
    const value = row.name || row.original.name;
    comp.props.Value = value;
    if (!/^=\{.*\}$/.test(String(comp.props.Name || ""))) {
      comp.props.Name = value;
    }
    comp.props.Supplier = row.supplier || row.original.supplier;
    comp.props["Supplier Part"] = row.supplierPart || row.original.supplierPart;
    comp.props["Manufacturer Part"] = row.manufacturerPart || row.original.manufacturerPart;
    comp.props.Manufacturer = row.manufacturer || row.original.manufacturer;
    row.changed = false;
    row.original = snapshot(row.designator, row.name, comp.props);
    return true;
  }

  // iframe/js/src/app/import-bom/pasteParser.js
  function parsePaste(text2) {
    const raw = String(text2 === null || text2 === void 0 ? "" : text2).trim();
    const items = [];
    if (!raw) return items;
    const lines = raw.split("\n");
    const firstLine = lines[0];
    const useTab = firstLine.includes("	");
    const delimiter = useTab ? "	" : ",";
    const designatorSeparator = useTab ? "," : "、";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const cells = trimmed.split(delimiter).slice(0, 6);
      while (cells.length < 6) cells.push("");
      items.push({
        designators: splitDesignators(cells[0], designatorSeparator),
        name: cells[1].trim(),
        manufacturerPart: cells[2].trim(),
        manufacturer: cells[3].trim(),
        supplierPart: cells[4].trim(),
        supplier: cells[5].trim()
      });
    }
    return items;
  }
  function splitDesignators(field, separator) {
    const text2 = String(field || "").trim();
    if (!text2.includes(separator)) return text2 ? [text2] : [];
    return text2.split(separator).map((d) => d.trim()).filter((d) => d);
  }

  // iframe/js/src/app/import-bom/index.js
  var jsonData = {};
  var componentsMap = {};
  var tableData = [];
  var Page = "PCB";
  var sortState = { key: null, asc: true };
  var tableBody = document.getElementById("tableBody");
  var selectAllBtn = document.getElementById("selectAll");
  var pasteBtn = document.getElementById("pasteBtn");
  var importBtn = document.getElementById("importBtn");
  var masterCheckbox = document.getElementById("masterCheckbox");
  var versionTag = document.getElementById("versionTag");
  var bar = createStatusBar({ textEl: document.getElementById("statusBar"), baseClass: "status-bar" });
  function formatCell(oldVal, newVal) {
    if (newVal && newVal !== oldVal) {
      return `${escapeHtml(oldVal || "-")} <span class="change-arrow">→</span> ${escapeHtml(newVal)}`;
    }
    return escapeHtml(oldVal || "-");
  }
  function formatTitle(oldVal, newVal) {
    if (newVal && newVal !== oldVal) return `${oldVal || "-"} → ${newVal}`;
    return String(oldVal || "-");
  }
  function createPropCell(group, field) {
    const cell = document.createElement("td");
    const changed = group.changed && group[field] !== group.original[field];
    cell.innerHTML = changed ? formatCell(group.original[field], group[field]) : escapeHtml(group.original[field] || "-");
    cell.title = changed ? formatTitle(group.original[field], group[field]) : group.original[field] || "-";
    return cell;
  }
  function renderTable() {
    tableBody.innerHTML = "";
    const groups = sortGroups(groupRows(tableData), sortState);
    for (const group of groups) {
      const row = document.createElement("tr");
      if (!group.selected) row.classList.add("disabled-row");
      row.appendChild(createSelectorCell(group, row));
      const designatorCell = document.createElement("td");
      const designators = group.designators.join(", ");
      designatorCell.textContent = designators;
      designatorCell.title = designators;
      row.appendChild(designatorCell);
      row.appendChild(createPropCell(group, "name"));
      row.appendChild(createPropCell(group, "manufacturerPart"));
      row.appendChild(createPropCell(group, "manufacturer"));
      row.appendChild(createPropCell(group, "supplierPart"));
      row.appendChild(createPropCell(group, "supplier"));
      tableBody.appendChild(row);
    }
  }
  function createSelectorCell(group, row) {
    const cell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "row-selector";
    checkbox.checked = group.selected;
    checkbox.addEventListener("change", () => {
      group.selected = checkbox.checked;
      for (const item of group.items) item.selected = checkbox.checked;
      row.classList.toggle("disabled-row", !checkbox.checked);
      updateMasterCheckbox();
      updateSelectAllButton();
    });
    cell.appendChild(checkbox);
    return cell;
  }
  function updateStatusBar() {
    const ids = tableData.map((item) => item.uniqueId).filter((id) => id && id !== "");
    const hasEmpty = tableData.some((item) => !item.uniqueId || item.uniqueId === "");
    const hasDuplicate = new Set(ids).size !== ids.length;
    if (hasEmpty || hasDuplicate) {
      let msg = "注意：";
      if (hasEmpty) msg += "存在空的唯一ID; ";
      if (hasDuplicate) msg += "存在重复的唯一ID; ";
      msg += "建议先重置唯一ID，否则可能导致异常。";
      bar.text(msg, "warning");
    } else {
      bar.text(`数据加载成功 (${(getVersionFamily() || "V2") + "模式"})，可以粘贴并导入`, "success");
    }
    importBtn.disabled = false;
  }
  function updateSelectAllButton() {
    const summary = selectionSummary(tableData, (item) => item.selected);
    selectAllBtn.textContent = summary.isAll ? "全不选" : "全选";
  }
  function updateMasterCheckbox() {
    const summary = selectionSummary(tableData, (item) => item.selected);
    masterCheckbox.checked = summary.isAll;
    masterCheckbox.indeterminate = summary.isIndeterminate;
  }
  function loadBOMData() {
    try {
      tableData = buildRows(componentsMap);
      renderTable();
    } catch (error) {
      console.error("加载BOM数据失败:", error);
      bar.text("加载BOM数据失败: " + error.message, "error");
    }
  }
  async function handlePaste() {
    try {
      const text2 = await navigator.clipboard.readText();
      const stat = applyPaste(tableData, parsePaste(text2));
      renderTable();
      updateMasterCheckbox();
      updateSelectAllButton();
      if (stat.updated > 0) {
        bar.text(`成功匹配并更新了 ${stat.updated} 个组件的属性 (已自动勾选)`, "success");
      } else {
        bar.text("没有检测到需要更新的属性，或数据无变化", "warning");
      }
    } catch (error) {
      console.error("粘贴失败:", error);
      bar.text("粘贴失败: " + error.message, "error");
    }
  }
  async function handleImport() {
    try {
      const selected = tableData.filter((item) => item.selected);
      if (selected.length === 0) {
        bar.text("请至少选择一个项目进行导入", "warning");
        return;
      }
      let successCount = 0;
      for (const item of selected) {
        if (!item.jsonKey || !componentsMap[item.jsonKey]) continue;
        if (applyToComponent(item, componentsMap[item.jsonKey])) successCount++;
      }
      await setNetlist(Page, JSON.stringify(jsonData, null, 2));
      bar.text(`成功导入并写回了 ${successCount} 个组件的属性`, "success");
      setTimeout(loadBOMData, 500);
    } catch (error) {
      console.error("导入失败:", error);
      bar.text("导入失败: " + error.message, "error");
    }
  }
  function bindSortHeaders() {
    document.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        sortState = nextSortState(sortState, th.getAttribute("data-key"));
        document.querySelectorAll("th.sortable .sort-arrow").forEach((span) => span.textContent = "");
        const arrow = th.querySelector(".sort-arrow");
        if (arrow) arrow.textContent = sortState.asc ? "▲" : "▼";
        renderTable();
      });
    });
  }
  async function init() {
    try {
      const version = getEditorVersion();
      versionTag.textContent = version ? (getVersionFamily() || "V2") + "模式" : "V2模式 (默认)";
    } catch (e) {
      versionTag.textContent = "模式未知";
    }
    try {
      const netlist = await getNetlist("AUTO");
      Page = netlist.page;
      jsonData = netlist.json;
      componentsMap = getComponentsContainer(jsonData);
      loadBOMData();
      updateStatusBar();
    } catch (error) {
      console.error("初始化错误", error);
      bar.text("初始化失败: 未能读取到画布环境数据", "error");
    }
  }
  masterCheckbox.addEventListener("change", () => {
    setAllSelected(tableData, (item, value) => item.selected = value, masterCheckbox.checked);
    renderTable();
    updateSelectAllButton();
  });
  selectAllBtn.addEventListener("click", () => {
    const summary = selectionSummary(tableData, (item) => item.selected);
    setAllSelected(tableData, (item, value) => item.selected = value, !summary.isAll);
    renderTable();
    updateMasterCheckbox();
    updateSelectAllButton();
  });
  pasteBtn.addEventListener("click", handlePaste);
  importBtn.addEventListener("click", handleImport);
  bindSortHeaders();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
