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
  function findComponentByDesignator(container, designator) {
    const target = String(designator || "").trim().toUpperCase();
    if (!target || !container || typeof container !== "object") return null;
    for (const key in container) {
      const comp = container[key];
      const current = comp && comp.props && comp.props.Designator;
      if (current && String(current).toUpperCase() === target) return { key, comp };
    }
    return null;
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
  function setPinNet(comp, pin, net, options = {}) {
    if (!comp || typeof comp !== "object") return false;
    const create = options.create === true;
    if (comp.pinInfoMap && typeof comp.pinInfoMap === "object") {
      if (comp.pinInfoMap[pin]) {
        comp.pinInfoMap[pin].net = net;
        return true;
      }
      if (create) {
        comp.pinInfoMap[pin] = { name: "", number: pin, net };
        return true;
      }
      return false;
    }
    if (comp.pins && typeof comp.pins === "object") {
      if (Object.prototype.hasOwnProperty.call(comp.pins, pin) || create) {
        comp.pins[pin] = net;
        return true;
      }
      return false;
    }
    if (create) {
      comp.pins = {};
      comp.pins[pin] = net;
      return true;
    }
    return false;
  }
  function sortPinKeys(a, b) {
    const na = Number(a);
    const nb = Number(b);
    const aNum = a !== "" && Number.isFinite(na);
    const bNum = b !== "" && Number.isFinite(nb);
    if (aNum && bNum) return na - nb;
    return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
  }

  // iframe/js/src/app/modify-net/replacePlan.js
  function parseRules(text) {
    const rules = [];
    for (const line of String(text || "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("	").map((item) => item.trim());
      if (parts.length < 2) continue;
      const [oldName, newName] = parts;
      if (oldName && newName) rules.push({ oldName, newName });
    }
    return rules;
  }
  function buildReplaceMap(rules, shouldUpperCase = true) {
    const map = /* @__PURE__ */ new Map();
    for (const rule of Array.isArray(rules) ? rules : []) {
      const newNet = shouldUpperCase ? rule.newName.toUpperCase() : rule.newName;
      map.set(String(rule.oldName).toLowerCase(), newNet);
    }
    return map;
  }
  function applyRenames(container, replaceMap) {
    let count = 0;
    const lines = [];
    for (const key in container) {
      const comp = container[key];
      if (!comp || typeof comp !== "object") continue;
      const designator = comp.props && comp.props.Designator || key;
      const pins = getPins(comp);
      for (const pin of Object.keys(pins).sort(sortPinKeys)) {
        const current = pins[pin];
        const netKey = current ? String(current).toLowerCase() : "";
        if (!netKey || !replaceMap.has(netKey)) continue;
        const next = replaceMap.get(netKey);
        if (setPinNet(comp, pin, next)) {
          lines.push(`替换: ${designator}.${pin} [${current} -> ${next}]`);
          count++;
        }
      }
    }
    return { count, lines };
  }
  function listPinsOf(comp) {
    const pins = getPins(comp);
    return Object.keys(pins).sort(sortPinKeys).map((pin) => ({ pin, net: pins[pin] || "" }));
  }

  // iframe/js/src/app/modify-net/index.js
  var cachedNetlistData = null;
  var resultOutput = document.getElementById("resultOutput");
  var executeBtn = document.getElementById("executeBtn");
  var csvInput = document.getElementById("csvInput");
  var designatorInput = document.getElementById("designatorInput");
  var verLabel = document.getElementById("verLabel");
  var toUpperCheckbox = document.getElementById("toUpper");
  var bar = createStatusBar({ textEl: document.getElementById("status"), baseClass: "status" });
  async function initNetlistData() {
    try {
      bar.text("", "");
      if (!hasEda()) {
        bar.text("⚠️ 未检测到EDA环境，请在嘉立创EDA中运行。", "error");
        return;
      }
      try {
        verLabel.textContent = (getVersionFamily() || "V2.2") + "模式";
      } catch (e) {
        verLabel.textContent = "Error";
      }
      const { json } = await getNetlist("PCB");
      cachedNetlistData = json;
      bar.text("✅ 网表已加载，可直接输入位号查询或粘贴数据替换。", "info");
    } catch (error) {
      console.error("初始化网表失败:", error);
      bar.text("❌ 初始化失败: " + error.message, "error");
    }
  }
  function queryDesignator() {
    const query = designatorInput.value.trim().toUpperCase();
    if (!query) {
      resultOutput.value = "";
      return;
    }
    if (!cachedNetlistData) {
      resultOutput.value = "错误：网表数据未加载，请重新打开插件。";
      return;
    }
    const hit = findComponentByDesignator(getComponentsContainer(cachedNetlistData), query);
    if (!hit) {
      resultOutput.value = `未找到位号为 "${query}" 的器件。`;
      return;
    }
    resultOutput.value = listPinsOf(hit.comp).map((item) => `${item.pin}	${item.net}`).join("\n");
  }
  async function executeReplace() {
    executeBtn.disabled = true;
    executeBtn.textContent = "处理中...";
    resultOutput.value = "";
    bar.text("", "");
    try {
      const content = csvInput.value.trim();
      if (!content) throw new Error("请从 Excel 复制粘贴替换规则");
      const { json } = await getNetlist("PCB");
      cachedNetlistData = json;
      const rules = parseRules(content);
      if (rules.length === 0) throw new Error("未找到有效的替换规则 (请确保使用Tab分隔)");
      resultOutput.value += `找到 ${rules.length} 条替换规则

`;
      const shouldUpperCase = toUpperCheckbox ? toUpperCheckbox.checked : true;
      const replaceMap = buildReplaceMap(rules, shouldUpperCase);
      const { count, lines } = applyRenames(getComponentsContainer(json), replaceMap);
      resultOutput.value += lines.join("\n") + `

完成 ${count} 次替换`;
      await setNetlist("PCB", JSON.stringify(json, null, 2));
      cachedNetlistData = json;
      bar.text(`✅ 成功替换 ${count} 处`, "success");
    } catch (error) {
      console.error("Error:", error);
      bar.text(`❌ 出错: ${error.message}`, "error");
      resultOutput.value += `
错误: ${error.message}`;
    } finally {
      executeBtn.disabled = false;
      executeBtn.textContent = "执行替换";
    }
  }
  designatorInput.addEventListener("input", queryDesignator);
  executeBtn.addEventListener("click", executeReplace);
  setTimeout(initNetlistData, 500);
})();
