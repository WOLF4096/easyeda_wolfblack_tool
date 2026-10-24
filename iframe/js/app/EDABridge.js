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

  // iframe/js/src/app/eda-bridge/protocol.js
  var SAFE_JSON_LIMITS = Object.freeze({ maxDepth: 4, maxArray: 200, maxKeys: 100 });
  function parseAddr(input) {
    const raw = String(input || "").trim().replace(/^[a-zA-Z]+:\/\//, "");
    let host = raw;
    let port = "8233";
    const lastColon = raw.lastIndexOf(":");
    if (lastColon >= 0) {
      host = raw.slice(0, lastColon);
      port = raw.slice(lastColon + 1) || "8233";
    }
    host = (host || "").replace(/^:+|:+$/g, "").trim();
    if (!host) host = "127.0.0.1";
    if (!/^\d+$/.test(port)) port = "8233";
    return { host, port };
  }
  var SCALARS = /* @__PURE__ */ new Map([
    ["number", (value) => value],
    ["boolean", (value) => value],
    ["string", (value) => value],
    ["bigint", (value) => String(value)],
    ["function", (value) => "[Function " + (value.name || "anonymous") + "]"],
    ["symbol", (value) => String(value)]
  ]);
  function specialObjectOf(value) {
    if (typeof value.then === "function") return "[Promise]";
    if (typeof Blob !== "undefined" && value instanceof Blob) return "[Blob " + value.size + "B]";
    if (typeof Node !== "undefined" && value instanceof Node) return "[Node " + value.nodeName + "]";
    return void 0;
  }
  function plainObjectOf(value, depth) {
    const out = {};
    let count = 0;
    for (const key in value) {
      if (count++ >= SAFE_JSON_LIMITS.maxKeys) {
        out["…"] = "省略";
        break;
      }
      try {
        out[key] = safeJson(value[key], depth + 1);
      } catch (e) {
        out[key] = "[不可读]";
      }
    }
    return out;
  }
  function safeJson(value, depth = 0) {
    if (value === null || value === void 0) return null;
    const scalar = SCALARS.get(typeof value);
    if (scalar) return scalar(value);
    if (depth > SAFE_JSON_LIMITS.maxDepth) return "[MaxDepth]";
    if (Array.isArray(value)) {
      return value.slice(0, SAFE_JSON_LIMITS.maxArray).map((item) => safeJson(item, depth + 1));
    }
    const special = specialObjectOf(value);
    if (special !== void 0) return special;
    return plainObjectOf(value, depth);
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
  function isV2() {
    const family = getVersionFamily();
    return family === "V2" || family === "V2.2";
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
  var COPPER_LAYER_MIN = 15;
  var COPPER_LAYER_MAX = 46;
  function isInnerLayer(layer) {
    const value = Number(layer);
    return value >= COPPER_LAYER_MIN && value <= COPPER_LAYER_MAX;
  }
  function isCopperLayer(layer) {
    const value = Number(layer);
    return value === LAYER.TOP || value === LAYER.BOTTOM || isInnerLayer(value);
  }
  function isConductiveLayer(layer) {
    const value = Number(layer);
    return isCopperLayer(value) || value === LAYER.MULTI;
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

  // iframe/js/src/core/sourceLine.js
  function splitSourceLine(line) {
    if (typeof line !== "string") return null;
    const hasTrailingPipe = line.endsWith("|");
    const cleanLine = hasTrailingPipe ? line.slice(0, -1) : line;
    const parts = cleanLine.split("||");
    if (parts.length !== 2) return null;
    let leftObj;
    let rightObj;
    try {
      leftObj = JSON.parse(parts[0]);
      rightObj = JSON.parse(parts[1]);
    } catch (e) {
      return null;
    }
    if (!leftObj || typeof leftObj !== "object") return null;
    return { leftStr: parts[0], rightStr: parts[1], leftObj, rightObj, hasTrailingPipe };
  }
  function joinSourceLine(leftStr, rightStr, hasTrailingPipe) {
    return leftStr + "||" + rightStr + (hasTrailingPipe ? "|" : "");
  }

  // iframe/js/src/core/length.js
  function toApiLength(value, digits = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    const rounded = Number(num.toFixed(digits));
    if (rounded === 0 && num !== 0) return num;
    return rounded;
  }

  // iframe/js/src/core/util.js
  function escapeHtml(value) {
    if (value === null || value === void 0) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // iframe/js/src/app/eda-bridge/commands.js
  var EVAL_CONTEXT = Object.freeze({
    NETLIST_KEY,
    getEda,
    hasEda,
    getEditorVersion,
    isV2,
    isModern,
    LAYER,
    isInnerLayer,
    isConductiveLayer,
    getNetlist,
    setNetlist,
    getComponentsContainer,
    splitSourceLine,
    joinSourceLine,
    toApiLength,
    escapeHtml,
    logger
  });
  async function createOne(item, host, sysLibUuid) {
    if (item.type === "component") {
      const uuid = item.uuid || await resolveUuid(item.cno, host);
      await host.pcb_PrimitiveComponent.create({ libraryUuid: sysLibUuid, uuid }, item.layer || 1, item.x, item.y, item.rot || 0, !!item.lock);
      return true;
    }
    if (item.type === "via") {
      await host.pcb_PrimitiveVia.create("", item.x, item.y, item.innerD, item.outerD, 0, null, null, false);
      return true;
    }
    if (item.type === "line") {
      await host.pcb_PrimitiveLine.create("", item.layer || 1, item.x1, item.y1, item.x2, item.y2, item.width || 0.5, false);
      return true;
    }
    return false;
  }
  async function execOne(item, index, host, sysLibUuid, errors) {
    try {
      if (await createOne(item, host, sysLibUuid)) return 1;
      errors.push(`第${index + 1}个：未知类型 ${item.type}`);
    } catch (err) {
      errors.push(`第${index + 1}个(${item.type})：${err && err.message || err}`);
    }
    return 0;
  }
  function importSummary(count, errorCount) {
    return `导入完成：成功 ${count}${errorCount ? "，失败 " + errorCount : ""}`;
  }
  async function execItems(items, host, log2) {
    if (!host || !host.pcb_PrimitiveVia) throw new Error("当前环境未检测到 EDA API，请在立创EDA专业版中运行本页面");
    const list = Array.isArray(items) ? items : [];
    const errors = [];
    let count = 0;
    let sysLibUuid = null;
    if (list.some((item) => item.type === "component")) {
      sysLibUuid = await host.lib_LibrariesList.getSystemLibraryUuid();
    }
    for (let i = 0; i < list.length; i++) {
      count += await execOne(list[i], i, host, sysLibUuid, errors);
    }
    if (log2) log2(importSummary(count, errors.length));
    return { ok: errors.length === 0, count, errors };
  }
  async function resolveUuid(cno, host) {
    const result = await host.lib_Device.getByLcscIds(cno);
    const list = Array.isArray(result) ? result : result ? [result] : [];
    if (list.length === 0) throw new Error("API 未找到 C 编号 " + cno + " 对应的元件");
    return list[0].uuid;
  }
  function probePaths(paths, host) {
    const out = {};
    for (const path of Array.isArray(paths) ? paths : []) {
      let current = host || null;
      let missingAt = null;
      for (const segment of String(path).split(".")) {
        if (current === null || current === void 0 || !(segment in Object(current))) {
          missingAt = segment;
          break;
        }
        current = current[segment];
      }
      out[path] = missingAt ? "MISSING@" + missingAt : typeof current;
    }
    return out;
  }
  async function handleEval(cmd, ctx) {
    const startedAt = Date.now();
    try {
      if (typeof cmd.code !== "string" || !cmd.code.trim()) throw new Error("eval 缺少 code");
      const fn = new Function("eda", "arg", "WolfCommon", "return (async () => {\n" + cmd.code + "\n})();");
      const raw = await fn(ctx.getHost() || null, cmd.arg, EVAL_CONTEXT);
      ctx.send({ id: cmd.id, ok: true, value: safeJson(raw), ms: Date.now() - startedAt });
    } catch (e) {
      ctx.send({ id: cmd.id, ok: false, error: String(e && (e.stack || e.message) || e), ms: Date.now() - startedAt });
    }
  }
  function handlePing(cmd, ctx) {
    ctx.send({ id: cmd.id, ver: ctx.ver, ok: true, hasEda: ctx.hasApi(), debug: ctx.debugAllowed() });
  }
  async function handleDebug(cmd, ctx) {
    if (!ctx.debugAllowed()) {
      ctx.send({ id: cmd.id, ok: false, error: "调试通道未开启：当前页面禁止远程执行代码" });
      return;
    }
    if (cmd.cmd === "eval") await handleEval(cmd, ctx);
    else ctx.send({ id: cmd.id, ok: true, value: probePaths(cmd.paths, ctx.getHost()) });
  }
  async function handleImport(cmd, ctx) {
    const items = cmd.items || [];
    ctx.log("收到指令：导入 " + items.length + " 个对象");
    try {
      const result = await execItems(items, ctx.getHost(), ctx.log);
      result.errors.slice(0, 5).forEach((item) => ctx.log(item));
      ctx.send({ id: cmd.id, ok: result.ok, count: result.count, errors: result.errors });
    } catch (e) {
      ctx.log("执行异常：" + (e && e.message || e));
      ctx.send({ id: cmd.id, ok: false, count: 0, error: String(e && e.message || e) });
    }
  }
  function createCommandHandler(deps) {
    const ctx = {
      getHost: deps.getHost,
      send: deps.send,
      log: deps.log || (() => {
      }),
      debugAllowed: deps.debugAllowed,
      ver: deps.ver,
      hasApi: () => {
        const host = ctx.getHost();
        return !!host && !!host.pcb_PrimitiveVia;
      }
    };
    return async function handle(cmd) {
      if (!cmd || !cmd.id) return;
      if (cmd.cmd === "ping") {
        handlePing(cmd, ctx);
        return;
      }
      if (cmd.cmd === "eval" || cmd.cmd === "probe") {
        await handleDebug(cmd, ctx);
        return;
      }
      if (cmd.cmd !== "import") {
        ctx.send({ id: cmd.id, ok: false, error: "未知指令 " + cmd.cmd });
        return;
      }
      await handleImport(cmd, ctx);
    };
  }

  // iframe/js/src/app/eda-bridge/index.js
  var VER = "2.2";
  var SAMPLE_MS = 100;
  var PUSH_MS = 500;
  var $ = (id) => document.getElementById(id);
  var ws = null;
  var selSampleTimer = null;
  var selPushTimer = null;
  var selBusy = false;
  var watchStarted = false;
  var lastSel = null;
  function log(...args) {
    try {
      console.log("[EDA 桥]", ...args);
    } catch (e) {
    }
  }
  function setStatus(text, ok) {
    const statusEl = $("st");
    const dotEl = $("dot");
    if (statusEl) statusEl.textContent = text;
    if (dotEl && dotEl.classList) dotEl.classList.toggle("ok", !!ok);
  }
  function wsOpen() {
    return !!ws && ws.readyState === 1;
  }
  function debugAllowed() {
    return true;
  }
  function send(payload) {
    if (!wsOpen()) {
      log("未连接，发送失败：", payload);
      return false;
    }
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      log("发送失败：" + (e && e.message || e));
      return false;
    }
  }
  var handleCommand = createCommandHandler({
    getHost: getEda,
    send,
    log,
    debugAllowed,
    ver: VER
  });
  function hasObjectApi(host) {
    return !!(host && host.pcb_SelectControl && host.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId && host.pcb_PrimitiveObject && host.pcb_PrimitiveObject.get);
  }
  function toIdList(ids) {
    if (Array.isArray(ids)) return ids;
    return ids && typeof ids.length === "number" ? Array.prototype.slice.call(ids) : [];
  }
  function isSampledObject(obj) {
    return !!(obj && obj.primitiveType === "Object" && typeof obj.width === "number" && typeof obj.height === "number");
  }
  function selectionOf(obj, fallbackId) {
    return {
      topLeftX: obj.topLeftX,
      topLeftY: obj.topLeftY,
      width: obj.width,
      height: obj.height,
      rotation: obj.rotation || 0,
      mirror: !!obj.mirror,
      primitiveId: obj.primitiveId || String(fallbackId)
    };
  }
  async function findFirstObject(host, list) {
    for (let i = 0; i < list.length; i++) {
      try {
        const obj = await host.pcb_PrimitiveObject.get(list[i]);
        if (isSampledObject(obj)) return selectionOf(obj, list[i]);
      } catch (e) {
      }
    }
    return null;
  }
  async function sampleSelection() {
    if (selBusy) return;
    selBusy = true;
    try {
      const host = getEda();
      if (hasObjectApi(host)) {
        const ids = await host.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
        const found = await findFirstObject(host, toIdList(ids));
        if (found) lastSel = found;
      }
    } catch (e) {
    }
    selBusy = false;
  }
  function pushSelection() {
    send({ type: "selection", selection: lastSel });
  }
  function startWatch() {
    if (watchStarted) return;
    watchStarted = true;
    selSampleTimer = setInterval(sampleSelection, SAMPLE_MS);
    selPushTimer = setInterval(pushSelection, PUSH_MS);
  }
  function stopWatch() {
    if (selSampleTimer) {
      clearInterval(selSampleTimer);
      selSampleTimer = null;
    }
    if (selPushTimer) {
      clearInterval(selPushTimer);
      selPushTimer = null;
    }
    watchStarted = false;
  }
  function connectWS() {
    const prev = ws;
    ws = null;
    if (prev) {
      try {
        prev.close();
      } catch (e) {
        log("关闭旧连接时出错（通常可忽略）");
      }
    }
    stopWatch();
    const addr = parseAddr($("addr") ? $("addr").value : "");
    const url = "ws://" + addr.host + ":" + addr.port + "/ws/eda";
    let sock;
    try {
      sock = new WebSocket(url);
    } catch (e) {
      sock = null;
    }
    if (!sock) {
      setStatus("未连接", false);
      log("WebSocket 创建失败：" + url);
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      setStatus("已连接", true);
      log("WebSocket 已连接 " + url);
      startWatch();
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      let message;
      try {
        message = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      void handleCommand(message);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      stopWatch();
      setStatus("未连接", false);
      log("WebSocket 已断开 " + url);
    };
    sock.onerror = () => {
      try {
        sock.close();
      } catch (e) {
        log("关闭连接时出错（通常可忽略）");
      }
    };
  }
  function disconnect() {
    stopWatch();
    const old = ws;
    ws = null;
    if (old) {
      try {
        old.close();
      } catch (e) {
        log("关闭连接时出错（通常可忽略）");
      }
    }
    setStatus("未连接", false);
  }
  if ($("conn")) $("conn").onclick = () => {
    disconnect();
    connectWS();
  };
  if ($("disc")) $("disc").onclick = disconnect;
  setInterval(() => {
    const on = wsOpen();
    const shown = $("st") && $("st").textContent === "已连接";
    if (on !== shown) setStatus(on ? "已连接" : "未连接", on);
  }, 500);
  setStatus("未连接", false);
  var initial = parseAddr($("addr") ? $("addr").value : "");
  if ($("bar")) $("bar").title = "EDA 桥 v" + VER + "（仅 WebSocket）";
  log("EDA 桥 v" + VER + " 已就绪（只使用 WebSocket），正在自动连接 " + initial.host + ":" + initial.port);
  if (!getEda()) log("提示：未检测到 EDA API —— 请确认本页面在立创EDA专业版环境中打开");
  connectWS();
})();
