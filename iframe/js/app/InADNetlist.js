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
  var META_KEYS = ["version", "designRule", "netClass", "units", "layers"];
  function isComponentLike(value) {
    return Boolean(value && typeof value === "object" && (value.props || value.pins || value.pinInfoMap));
  }
  function pickComponents(netlistObj) {
    const picked = {};
    for (const key in netlistObj) {
      if (META_KEYS.includes(key)) continue;
      if (isComponentLike(netlistObj[key])) picked[key] = netlistObj[key];
    }
    return picked;
  }
  function detectContainer(netlistObj) {
    if (!netlistObj || typeof netlistObj !== "object") return {};
    if (netlistObj.components && typeof netlistObj.components === "object") return netlistObj.components;
    const picked = pickComponents(netlistObj);
    return Object.keys(picked).length > 0 ? picked : netlistObj;
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

  // iframe/js/src/app/in-ad-netlist/adParser.js
  function parseADNetlist(content) {
    const netMap = /* @__PURE__ */ new Map();
    const errors = [];
    if (!content || typeof content !== "string") {
      errors.push("网表内容为空");
      return { netMap, errors };
    }
    const blocks = content.match(/\(([\s\S]*?)\)/g);
    if (!blocks || blocks.length === 0) {
      errors.push("未检测到有效的AD网表");
      return { netMap, errors };
    }
    for (const block of blocks) parseBlock(block, netMap, errors);
    return { netMap, errors };
  }
  function parseBlock(block, netMap, errors) {
    const lines = block.replace(/^\(|\)$/g, "").trim().split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
    if (lines.length < 2) return;
    const netName = lines[0];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("-");
      if (parts.length !== 2) {
        errors.push(`行格式异常: ${lines[i]} , 应为 位号-引脚`);
        continue;
      }
      const refDes = parts[0].trim();
      const pinNo = parts[1].trim();
      if (refDes && pinNo) netMap.set(`${refDes}|${pinNo}`, netName);
    }
  }

  // iframe/js/src/core/pins.js
  function netOf(value) {
    if (value && typeof value === "object") return value.net || "";
    return String(value || "");
  }
  function readPinMap(map) {
    const out = {};
    for (const [pin, value] of Object.entries(map)) out[pin] = netOf(value);
    return out;
  }
  function getPins(comp) {
    if (!comp || typeof comp !== "object") return {};
    if (comp.pinInfoMap && typeof comp.pinInfoMap === "object") return readPinMap(comp.pinInfoMap);
    if (comp.pins && typeof comp.pins === "object") return readPinMap(comp.pins);
    return {};
  }
  function writePinInfoMap(comp, pin, net, create) {
    if (comp.pinInfoMap[pin]) {
      comp.pinInfoMap[pin].net = net;
      return true;
    }
    if (!create) return false;
    comp.pinInfoMap[pin] = { name: "", number: pin, net };
    return true;
  }
  function writePins(comp, pin, net, create) {
    if (!create && !Object.prototype.hasOwnProperty.call(comp.pins, pin)) return false;
    comp.pins[pin] = net;
    return true;
  }
  function setPinNet(comp, pin, net, options = {}) {
    if (!comp || typeof comp !== "object") return false;
    const create = options.create === true;
    if (comp.pinInfoMap && typeof comp.pinInfoMap === "object") return writePinInfoMap(comp, pin, net, create);
    if (comp.pins && typeof comp.pins === "object") return writePins(comp, pin, net, create);
    if (!create) return false;
    comp.pins = {};
    comp.pins[pin] = net;
    return true;
  }

  // iframe/js/src/app/in-ad-netlist/compare.js
  var NO_NET = "-";
  function buildDesignatorMap(container) {
    const map = {};
    if (!container || typeof container !== "object") return map;
    for (const key in container) {
      const comp = container[key];
      if (!comp) continue;
      const designator = comp.props && comp.props.Designator || comp.Designator;
      if (designator) map[designator] = comp;
    }
    return map;
  }
  function buildCompareRows(netMap, container) {
    const designators = buildDesignatorMap(container);
    const items = [];
    for (const [key, newNet] of netMap.entries()) {
      const [refDes, pinNo] = key.split("|");
      items.push({ refDes, pinNo, newNet });
    }
    items.sort((a, b) => naturalCompare(a.refDes, b.refDes) || naturalCompare(a.pinNo, b.pinNo));
    return items.map((item) => toCompareRow(item, designators[item.refDes]));
  }
  function missingComponentRow(item) {
    return {
      refDes: item.refDes,
      pinNo: item.pinNo,
      oldNet: "⚠️ 未找到元件",
      newNet: item.newNet,
      isDiff: false,
      warning: true,
      tooltip: `位号 ${item.refDes} 在当前PCB中不存在`
    };
  }
  function oldNetOf(pins, pinNo, hasPin, hasPinData) {
    if (hasPin) return pins[pinNo] || NO_NET;
    return hasPinData ? NO_NET : "? 无引脚数据";
  }
  function tooltipOf(item, unknownShape, missingPin) {
    if (unknownShape) return `元件 ${item.refDes} 引脚信息结构未知`;
    if (missingPin) return `引脚 ${item.pinNo} 在元件 ${item.refDes} 中未定义`;
    return "";
  }
  function toCompareRow(item, comp) {
    if (!comp) return missingComponentRow(item);
    const pins = getPins(comp);
    const hasPinData = comp.pinInfoMap || comp.pins;
    const hasPin = Object.prototype.hasOwnProperty.call(pins, item.pinNo);
    const oldNet = oldNetOf(pins, item.pinNo, hasPin, hasPinData);
    const missingPin = hasPinData && !hasPin;
    const unknownShape = !hasPinData;
    return {
      refDes: item.refDes,
      pinNo: item.pinNo,
      oldNet,
      newNet: item.newNet,
      isDiff: !missingPin && !unknownShape && oldNet !== item.newNet,
      warning: missingPin || unknownShape,
      tooltip: tooltipOf(item, unknownShape, missingPin)
    };
  }
  function applyToCopy(netlistObj, netMap) {
    const updatedObj = JSON.parse(JSON.stringify(netlistObj || {}));
    const container = detectContainer(updatedObj);
    const designators = buildDesignatorMap(container);
    let updateCount = 0;
    let skippedCount = 0;
    for (const [key, newNet] of netMap.entries()) {
      const [refDes, pinNo] = key.split("|");
      const comp = designators[refDes];
      if (!comp) {
        skippedCount++;
        continue;
      }
      if (setPinNet(comp, pinNo, newNet, { create: true })) updateCount++;
      else skippedCount++;
    }
    return { updatedObj, updateCount, skippedCount };
  }

  // iframe/js/src/app/in-ad-netlist/index.js
  var currentNetlistRaw = null;
  var adNetMap = /* @__PURE__ */ new Map();
  var selectFileBtn = document.getElementById("selectFileBtn");
  var pasteNetlistBtn = document.getElementById("pasteNetlistBtn");
  var writeNetlistBtn = document.getElementById("writeNetlistBtn");
  var tableBody = document.getElementById("tableBody");
  var adStatusSpan = document.getElementById("adStatus");
  var parseFeedbackSpan = document.getElementById("parseFeedback");
  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".net, .txt, .asc, */*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  function feedback(message, color, clearMs) {
    if (!parseFeedbackSpan) return;
    parseFeedbackSpan.innerText = message;
    parseFeedbackSpan.style.color = color || "";
    if (clearMs) {
      setTimeout(() => {
        if (parseFeedbackSpan) parseFeedbackSpan.innerText = "";
      }, clearMs);
    }
  }
  async function loadCurrentNetlist() {
    try {
      if (!hasEda()) throw new Error("当前未检测到嘉立创EDA环境，请确保在JLCEDA插件/扩展中运行");
      const { json } = await getNetlist("PCB");
      currentNetlistRaw = JSON.parse(JSON.stringify(json));
      return true;
    } catch (err) {
      console.error("加载PCB网表失败:", err);
      feedback(`加载网表失败: ${err.message}`, "#f28b82");
      return false;
    }
  }
  function renderCompareTable() {
    const rows = currentNetlistRaw && adNetMap.size > 0 ? buildCompareRows(adNetMap, detectContainer(currentNetlistRaw)) : [];
    if (rows.length === 0) {
      const message = currentNetlistRaw && adNetMap.size > 0 ? "解析后的AD网表无有效引脚连接，请检查文件内容" : "暂无网表对比数据，请先选择或粘贴AD格式网表";
      tableBody.innerHTML = `<tr class="empty-table-msg"><td colspan="4">${message}</td></tr>`;
      adStatusSpan.innerText = adNetMap.size === 0 ? "未导入AD网表" : "AD网表无有效连接";
      return;
    }
    tableBody.innerHTML = rows.map((row) => {
      const badge = row.isDiff ? '<span class="diff-badge">→ 变更</span>' : "";
      const tooltip = row.tooltip || (row.isDiff ? "网络将变更" : "");
      return `
					<tr class="${row.warning ? "warning-row" : ""}" title="${escapeHtml(tooltip)}">
						<td><strong>${escapeHtml(row.refDes)}</strong></td>
						<td>${escapeHtml(row.pinNo)}</td>
						<td class="old-net">${escapeHtml(row.oldNet)} ${badge}</td>
						<td class="new-net">${escapeHtml(row.newNet)}</td>
					</tr>
				`;
    }).join("");
    adStatusSpan.innerText = "AD网表已导入";
  }
  function processAdContent(adContent) {
    if (!adContent || adContent.trim() === "") {
      feedback("网表内容为空，请检查文件或剪贴板", "#f28b82");
      return false;
    }
    const { netMap, errors } = parseADNetlist(adContent);
    if (errors.length > 0) feedback(errors.slice(0, 2).join("; "), "#f5a97f");
    else feedback(`解析成功 ${netMap.size} 个引脚`, "#6fcf97");
    if (netMap.size === 0) {
      adNetMap = /* @__PURE__ */ new Map();
      adStatusSpan.innerText = "AD网表无有效连接";
      tableBody.innerHTML = '<tr class="empty-table-msg"><td colspan="4">未解析到任何引脚-网络关系，请确认网表格式（括号分段，位号-引脚）</td></tr>';
      return false;
    }
    adNetMap = netMap;
    renderCompareTable();
    return true;
  }
  async function writeNetlistToPCB() {
    if (adNetMap.size === 0) {
      feedback("没有可写入的AD网表数据，请先导入AD网表", "#f28b82", 2e3);
      return;
    }
    if (!currentNetlistRaw) {
      feedback("当前PCB网表未加载，请刷新重试");
      return;
    }
    try {
      const { updatedObj } = applyToCopy(currentNetlistRaw, adNetMap);
      await setNetlist("PCB", JSON.stringify(updatedObj));
      if (parseFeedbackSpan) parseFeedbackSpan.style.color = "#6fcf97";
      await loadCurrentNetlist();
      renderCompareTable();
      setTimeout(() => {
        if (parseFeedbackSpan) parseFeedbackSpan.innerText = "";
      }, 3e3);
    } catch (err) {
      console.error("写入网表失败:", err);
      feedback(`写入网表失败: ${err.message || err}`, "#f28b82", 4e3);
    }
  }
  async function pasteFromClipboard() {
    try {
      if (!navigator.clipboard) {
        feedback("当前浏览器不支持剪贴板读取，请手动选择文件");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        feedback("剪贴板内容为空");
        return;
      }
      processAdContent(text);
    } catch (err) {
      console.error("读取剪贴板失败:", err);
      feedback(`读取剪贴板失败: ${err.message}，请尝试选择文件`, "#f28b82");
    }
  }
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      processAdContent(await file.text());
    } catch (err) {
      feedback(`读取文件失败: ${err.message}`, "#f28b82");
    } finally {
      fileInput.value = "";
    }
  };
  async function init() {
    if (!hasEda()) {
      feedback("未检测到嘉立创EDA运行环境，演示模式仅限UI，无法读写真实网表");
      console.warn("未检测到 EDA 环境");
      currentNetlistRaw = { components: {} };
    } else if (!await loadCurrentNetlist()) {
      feedback("加载PCB网表失败，请检查权限或重新打开插件");
    }
    renderCompareTable();
    selectFileBtn.addEventListener("click", () => fileInput.click());
    pasteNetlistBtn.addEventListener("click", pasteFromClipboard);
    writeNetlistBtn.addEventListener("click", async () => {
      if (adNetMap.size === 0) {
        feedback("请先导入AD网表（选择文件或粘贴）再执行写入", "#f5a97f", 1800);
        return;
      }
      if (!hasEda()) {
        feedback("当前环境不支持写入网表(eda.pcb_Net不可用)");
        toast("当前环境不支持写入网表", 2);
        return;
      }
      await writeNetlistToPCB();
    });
  }
  void init();
})();
