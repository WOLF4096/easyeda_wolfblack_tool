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
  function safeJson(value, depth = 0) {
    if (value === null) return null;
    if (value === void 0) return null;
    const type = typeof value;
    if (type === "number" || type === "boolean" || type === "string") return value;
    if (type === "bigint") return String(value);
    if (type === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (type === "symbol") return String(value);
    if (depth > SAFE_JSON_LIMITS.maxDepth) return "[MaxDepth]";
    if (Array.isArray(value)) {
      return value.slice(0, SAFE_JSON_LIMITS.maxArray).map((item) => safeJson(item, depth + 1));
    }
    if (typeof value.then === "function") return "[Promise]";
    if (typeof Blob !== "undefined" && value instanceof Blob) return "[Blob " + value.size + "B]";
    if (typeof Node !== "undefined" && value instanceof Node) return "[Node " + value.nodeName + "]";
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

  // iframe/js/src/app/eda-bridge/commands.js
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
      const item = list[i];
      try {
        if (item.type === "component") {
          const uuid = item.uuid || await resolveUuid(item.cno, host);
          await host.pcb_PrimitiveComponent.create({ libraryUuid: sysLibUuid, uuid }, item.layer || 1, item.x, item.y, item.rot || 0, !!item.lock);
        } else if (item.type === "via") {
          await host.pcb_PrimitiveVia.create("", item.x, item.y, item.innerD, item.outerD, 0, null, null, false);
        } else if (item.type === "line") {
          await host.pcb_PrimitiveLine.create("", item.layer || 1, item.x1, item.y1, item.x2, item.y2, item.width || 0.5, false);
        } else {
          errors.push(`第${i + 1}个：未知类型 ${item.type}`);
          continue;
        }
        count++;
      } catch (err) {
        errors.push(`第${i + 1}个(${item.type})：${err && err.message || err}`);
      }
    }
    if (log2) log2(`导入完成：成功 ${count}${errors.length ? "，失败 " + errors.length : ""}`);
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
  function createCommandHandler(deps) {
    const getHost = deps.getHost;
    const send2 = deps.send;
    const log2 = deps.log || (() => {
    });
    const debugAllowed2 = deps.debugAllowed;
    const hasApi = () => {
      const host = getHost();
      return !!host && !!host.pcb_PrimitiveVia;
    };
    async function handleEval(cmd) {
      const startedAt = Date.now();
      try {
        if (typeof cmd.code !== "string" || !cmd.code.trim()) throw new Error("eval 缺少 code");
        const fn = new Function("eda", "arg", "WolfCommon", "return (async () => {\n" + cmd.code + "\n})();");
        const raw = await fn(getHost() || null, cmd.arg, globalThis.WolfCommon || null);
        send2({ id: cmd.id, ok: true, value: safeJson(raw), ms: Date.now() - startedAt });
      } catch (e) {
        send2({ id: cmd.id, ok: false, error: String(e && (e.stack || e.message) || e), ms: Date.now() - startedAt });
      }
    }
    return async function handle(cmd) {
      if (!cmd || !cmd.id) return;
      if (cmd.cmd === "ping") {
        send2({ id: cmd.id, ver: deps.ver, ok: true, hasEda: hasApi(), debug: debugAllowed2() });
        return;
      }
      if (cmd.cmd === "eval" || cmd.cmd === "probe") {
        if (!debugAllowed2()) {
          send2({ id: cmd.id, ok: false, error: "调试指令未开启：请勾选「调试指令」后重试" });
          return;
        }
        if (cmd.cmd === "eval") await handleEval(cmd);
        else send2({ id: cmd.id, ok: true, value: probePaths(cmd.paths, getHost()) });
        return;
      }
      if (cmd.cmd !== "import") {
        send2({ id: cmd.id, ok: false, error: "未知指令 " + cmd.cmd });
        return;
      }
      const items = cmd.items || [];
      log2("收到指令：导入 " + items.length + " 个对象");
      try {
        const result = await execItems(items, getHost(), log2);
        result.errors.slice(0, 5).forEach((item) => log2(item));
        send2({ id: cmd.id, ok: result.ok, count: result.count, errors: result.errors });
      } catch (e) {
        log2("执行异常：" + (e && e.message || e));
        send2({ id: cmd.id, ok: false, count: 0, error: String(e && e.message || e) });
      }
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
    const el = $("allowEval");
    return !!(el && el.checked);
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
  async function sampleSelection() {
    if (selBusy) return;
    selBusy = true;
    try {
      const host = getEda();
      if (host && host.pcb_SelectControl && host.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId && host.pcb_PrimitiveObject && host.pcb_PrimitiveObject.get) {
        const ids = await host.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
        const list = Array.isArray(ids) ? ids : ids && typeof ids.length === "number" ? Array.prototype.slice.call(ids) : [];
        for (let i = 0; i < list.length; i++) {
          try {
            const obj = await host.pcb_PrimitiveObject.get(list[i]);
            if (obj && obj.primitiveType === "Object" && typeof obj.width === "number" && typeof obj.height === "number") {
              lastSel = {
                topLeftX: obj.topLeftX,
                topLeftY: obj.topLeftY,
                width: obj.width,
                height: obj.height,
                rotation: obj.rotation || 0,
                mirror: !!obj.mirror,
                primitiveId: obj.primitiveId || String(list[i])
              };
              break;
            }
          } catch (e) {
          }
        }
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
