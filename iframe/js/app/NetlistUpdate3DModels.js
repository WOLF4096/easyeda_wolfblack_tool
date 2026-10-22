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

  // iframe/js/src/app/netlist-3d/transform.js
  var DEFAULT_TRANSFORM = "0,0,0,0,0,0,0,0,0";
  var MIL_TO_MM = 0.0254;
  var STATUS_CLASS = Object.freeze({
    待更新: "status-ready",
    已修改: "status-success",
    成功: "status-success",
    跳过: "status-ready",
    未找到: "status-error",
    失败: "status-error",
    校验失败: "status-error",
    无模型: "status-ready"
  });
  function parseTransform(transform) {
    const parts = String(transform || "").split(",").map(Number);
    const at = (index) => Number.isFinite(parts[index]) ? parts[index] : 0;
    return {
      sX: at(0),
      sY: at(1),
      sZ: at(2),
      rZ: at(3),
      rX: at(4),
      rY: at(5),
      oX: at(6),
      oY: at(7),
      oZ: at(8)
    };
  }
  function composeTransform(item) {
    return [item.sX, item.sY, item.sZ, item.rZ, item.rX, item.rY, item.oX, item.oY, item.oZ].join(",");
  }
  function toDisplay(value, unit, isDegree = false) {
    const num = Number(value);
    if (isNaN(num)) return value;
    if (isDegree) return Number(num.toFixed(3));
    if (unit === "mm") return Number((num * MIL_TO_MM).toFixed(3));
    return Number(num.toFixed(3));
  }
  function toRaw(value, unit, isDegree) {
    const num = Number(value);
    if (isNaN(num)) return 0;
    if (isDegree) return num;
    return unit === "mm" ? num / MIL_TO_MM : num;
  }
  function applyInput(item, field, value, unit) {
    const isDegree = field.startsWith("r");
    item[field] = toRaw(value, unit, isDegree);
    item.rawTransform = composeTransform(item);
    item.status = "已修改";
    return item;
  }
  function buildRows(netlist) {
    const rows = [];
    const container = getComponentsContainer(netlist);
    for (const key in container) {
      const component = container[key];
      if (!component || !component.props) continue;
      const props = component.props;
      const designator = props.Designator;
      if (!designator) continue;
      const rawModel = props["3D Model"] || "";
      const transform = props["3D Model Transform"] || DEFAULT_TRANSFORM;
      rows.push({
        id: designator,
        designator,
        footprint: props.FootprintName || props["Footprint Name"] || props.Footprint || "-",
        modelTitle: props["3D Model Title"] || "没有找到 3D 模型",
        rawModel,
        rawTransform: transform,
        ...parseTransform(transform),
        status: rawModel ? "待更新" : "无模型",
        primitiveId: null
      });
    }
    return rows;
  }
  function isModelMatch(item, result) {
    if (!result || !result.otherProperty) return false;
    const ret = result.otherProperty;
    const retModel = String(ret["3D Model"] || "").split("|")[0];
    const targetModel = String(item.rawModel || "").split("|")[0];
    return retModel === targetModel && (ret["3D Model Title"] || "") === item.modelTitle && (ret["3D Model Transform"] || "") === item.rawTransform;
  }

  // iframe/js/src/app/netlist-3d/index.js
  var appState = { data: [], unit: "mm", sortCol: null, sortAsc: true };
  var tbody = document.getElementById("table-body");
  var btnUnit = document.getElementById("btn-unit");
  var btnLoad = document.getElementById("btn-load");
  var btnUpdate = document.getElementById("btn-update");
  var statusText = document.getElementById("status-text");
  var progressBg = document.getElementById("progressBg");
  function renderTable() {
    if (appState.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: #888;">未找到有效的3D模型数据</td></tr>';
      return;
    }
    const renderData = sortRows(appState.data);
    const makeInput = (item, field, isDegree) => {
      const display = toDisplay(item[field], appState.unit, isDegree);
      return `<td class="col-xyz"><input class="xyz-input" type="text" value="${display}" onchange="updateParam('${item.id}', '${field}', this.value)"></td>`;
    };
    tbody.innerHTML = renderData.map((item) => {
      const statusClass = STATUS_CLASS[item.status] || "status-ready";
      const title = item.modelTitle === "没有找到 3D 模型" ? `<span class="text-error">${item.modelTitle}</span>` : item.modelTitle;
      return `<tr>
					<td title="${item.designator}">${item.designator}</td>
					<td title="${item.footprint}">${item.footprint}</td>
					<td title="${item.modelTitle}">${title}</td>
					${makeInput(item, "sX", false)} ${makeInput(item, "sY", false)} ${makeInput(item, "sZ", false)}
					${makeInput(item, "rX", true)} ${makeInput(item, "rY", true)} ${makeInput(item, "rZ", true)}
					${makeInput(item, "oX", false)} ${makeInput(item, "oY", false)} ${makeInput(item, "oZ", false)}
					<td class="${statusClass}" id="status-${item.id}">${item.status}</td>
				</tr>`;
    }).join("");
  }
  function sortRows(rows) {
    const list = rows.slice();
    if (!appState.sortCol) return list;
    const col = appState.sortCol;
    const dir = appState.sortAsc ? 1 : -1;
    list.sort((a, b) => {
      const valA = a[col];
      const valB = b[col];
      if (typeof valA === "string" || typeof valB === "string") {
        return dir * String(valA).localeCompare(String(valB), void 0, { numeric: true });
      }
      return dir * (valA - valB);
    });
    return list;
  }
  function parseNetlist(netlistData) {
    appState.data = buildRows(netlistData);
    btnUpdate.disabled = appState.data.length === 0;
    statusText.textContent = `成功加载 ${appState.data.length} 个器件`;
    appState.sortCol = "modelTitle";
    appState.sortAsc = true;
    renderTable();
  }
  function mockDataLoad() {
    parseNetlist({
      components: {
        comp1: { props: { Designator: "R1", "3D Model": "uuid1", "3D Model Title": "RES_0603", "3D Model Transform": "387,200,300,90,0,45.500,10,20.000,0", Footprint: "R0603" } },
        comp2: { props: { Designator: "C1", "3D Model": "uuid2", "3D Model Title": "CAP_0402", "3D Model Transform": "50,50,50,0,0,0,0,0,0", Footprint: "C0402" } },
        comp3: { props: { Designator: "U1", "3D Model": "uuid3", "3D Model Title": "ESP32-WROOM", "3D Model Transform": "700.00,1000,120,0,0,90,-50,20,10", Footprint: "MODULE-38P" } }
      }
    });
  }
  async function loadFromCurrent() {
    const host = getEda();
    if (!host) {
      toast("未检测到 EDA 运行环境", 2);
      mockDataLoad();
      return;
    }
    try {
      statusText.textContent = "正在获取当前PCB网表...";
      let netlistData;
      try {
        netlistData = (await getNetlist("PCB")).json;
      } catch (apiError) {
        console.error("API 调用失败:", apiError);
        throw new Error("无法读取 PCB 网表，请确保当前处于 PCB 编辑页面");
      }
      parseNetlist(netlistData);
    } catch (error) {
      console.error("获取当前网表失败:", error);
      toast("获取当前网表失败: " + error.message, "error");
      statusText.textContent = "就绪";
    }
  }
  async function loadFromFile() {
    const host = getEda();
    if (!host) {
      toast("未检测到 EDA 运行环境", 2);
      mockDataLoad();
      return;
    }
    try {
      const fileResult = await host.sys_FileSystem.openReadFileDialog();
      if (!fileResult) return;
      const fileContent = typeof fileResult === "object" && fileResult.text ? await fileResult.text() : fileResult;
      const jsonString = Array.isArray(fileContent) ? fileContent.join("") : fileContent;
      parseNetlist(JSON.parse(String(jsonString).trim()));
    } catch (error) {
      toast("网表解析失败: " + error.message, "error");
    }
  }
  function toggleUnit() {
    appState.unit = appState.unit === "mm" ? "mil" : "mm";
    document.getElementById("th-size").textContent = `大小 (${appState.unit})`;
    document.getElementById("th-offset").textContent = `偏移 (${appState.unit})`;
    renderTable();
  }
  async function updateOne(host, item, primId) {
    try {
      const result = await host.pcb_PrimitiveComponent.modify(primId, {
        otherProperty: {
          "3D Model": item.rawModel,
          "3D Model Title": item.modelTitle,
          "3D Model Transform": item.rawTransform
        }
      });
      if (isModelMatch(item, result)) return "成功";
      console.warn(`更新 ${item.designator} 返回值校验不匹配:`, result);
      return "校验失败";
    } catch (err) {
      console.error(`更新 ${item.designator} 失败:`, err);
      return "失败";
    }
  }
  async function batchUpdate() {
    const host = getEda();
    if (!host) return;
    const startTime = performance.now();
    btnUpdate.disabled = true;
    btnLoad.disabled = true;
    btnUnit.disabled = true;
    progressBg.style.width = "0%";
    statusText.textContent = "正在获取PCB器件...";
    try {
      const pcbComps = await host.pcb_PrimitiveComponent.getAll();
      const pcbMap = {};
      for (const comp of pcbComps) {
        if (comp && comp.designator && comp.primitiveId) pcbMap[comp.designator] = comp.primitiveId;
      }
      const total = appState.data.length;
      let successCount = 0;
      for (let i = 0; i < total; i++) {
        const item = appState.data[i];
        const primId = pcbMap[item.designator];
        if (!primId) item.status = "未找到";
        else if (!item.rawModel || item.rawModel.trim() === "") item.status = "跳过";
        else {
          item.status = await updateOne(host, item, primId);
          if (item.status === "成功") successCount++;
        }
        const percent = Math.round((i + 1) / total * 100);
        progressBg.style.width = percent + "%";
        statusText.textContent = `进度：${i + 1} / ${total} (${percent}%)，正在处理: ${item.designator}`;
        renderTable();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const costTime = ((performance.now() - startTime) / 1e3).toFixed(2);
      statusText.textContent = `更新完成: 成功 ${successCount}/${total} | 耗时：${costTime}秒`;
      toast("批量更新完成", "success");
    } catch (error) {
      statusText.textContent = "更新异常中断";
      toast("发生未预期错误", "error");
    } finally {
      btnUpdate.disabled = false;
      btnLoad.disabled = false;
      btnUnit.disabled = false;
    }
  }
  window.updateParam = function updateParam(id, field, value) {
    const item = appState.data.find((row) => row.id === id);
    if (!item) return;
    applyInput(item, field, value, appState.unit);
  };
  document.getElementById("btn-get-current").addEventListener("click", loadFromCurrent);
  btnLoad.addEventListener("click", loadFromFile);
  btnUnit.addEventListener("click", toggleUnit);
  btnUpdate.addEventListener("click", batchUpdate);
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (!col) return;
      if (appState.sortCol === col) appState.sortAsc = !appState.sortAsc;
      else {
        appState.sortCol = col;
        appState.sortAsc = true;
      }
      renderTable();
    });
  });
})();
