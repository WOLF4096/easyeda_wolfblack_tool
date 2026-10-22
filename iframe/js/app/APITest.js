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

  // iframe/js/src/app/api-test/calibration.js
  var MULTIPLIER_MIN = 1e-3;
  var MULTIPLIER_MAX = 1e3;
  function applyCal(val, cal) {
    const value = parseFloat(val);
    if (isNaN(value) || !cal) return val;
    const op = cal.charAt(0);
    const num = parseFloat(cal.substring(1));
    if (isNaN(num)) return value;
    if (op === "*") return value * num;
    if (op === "/") return value / num;
    if (op === "+") return value + num;
    if (op === "-") return value - num;
    return value;
  }
  function applyCalStr(valStr, calStr) {
    if (!calStr) return valStr;
    const text = String(valStr);
    if (!text.includes(",")) return applyCal(valStr, calStr);
    const parts = text.split(",");
    const fmt = (v) => Number.isInteger(v) ? v : parseFloat(Number(v).toFixed(4));
    return `${fmt(applyCal(parts[0], calStr))},${fmt(applyCal(parts[1], calStr))}`;
  }
  function compare(a, b, tolerance = 0.05) {
    const strA = String(a);
    const strB = String(b);
    if (strA.includes(",") || strB.includes(",")) {
      const partsA = strA.split(",");
      const partsB = strB.split(",");
      if (partsA.length !== partsB.length) return false;
      return partsA.every((part, index) => Math.abs(parseFloat(part) - parseFloat(partsB[index])) < tolerance);
    }
    return Math.abs(parseFloat(a) - parseFloat(b)) < tolerance;
  }
  function ratioToCalInput(ratio) {
    if (!Number.isFinite(ratio) || ratio === 0) return "";
    if (Math.abs(ratio - 1) <= 1e-3) return "";
    const rounded = parseFloat(ratio.toFixed(3));
    if (ratio > 1) return `*${rounded}`;
    return `/${parseFloat((1 / ratio).toFixed(3))}`;
  }
  function calToMultiplier(text) {
    if (!text || text.trim() === "") return 1;
    const op = text.charAt(0);
    const num = parseFloat(text.substring(1));
    if (op === "*" && !isNaN(num)) return roundMultiplier(num);
    if (op === "/" && !isNaN(num) && num !== 0) return roundMultiplier(1 / num);
    const pure = parseFloat(text);
    if (!isNaN(pure) && op !== "+" && op !== "-") return roundMultiplier(pure);
    return 1;
  }
  function roundMultiplier(value) {
    if (!Number.isFinite(value) || value < MULTIPLIER_MIN || value > MULTIPLIER_MAX) return Number.NaN;
    return parseFloat(value.toFixed(6));
  }

  // iframe/js/src/app/api-test/projects.js
  var RAW_SOURCE = {
    "Via": ["VIA", "e1", 0, "", "", 105, 110, 12, 24, 0, 10, 5, 0, []],
    "Pad": ["PAD", "e2", 0, "", 12, "1", 50, 110, 0, ["ROUND", 12, 12], ["ELLIPSE", 24, 24], [], 0, 0, 0, 1, 0, 10, 5, 0, 0, 0, null, null, null, null, []],
    "Line": ["LINE", "e3", 0, "", 1, 57, 75, 87, 75, 10, 0],
    "Arc": ["ARC", "e4", 0, "", 1, 45, 75, 45, 55, 180, 10, 0],
    "Polyline": ["POLY", "e5", 0, "", 1, 10, [57, 54, "L", 87, 54], 0]
  };
  var PROJECTS = [
    { id: "create_via", type: "Via", act: "create", name: "创建过孔", params: ["坐标", "内径", "外径", "阻焊"] },
    { id: "create_pad", type: "Pad", act: "create", name: "创建焊盘", params: ["坐标", "内径", "外径", "阻焊"] },
    { id: "create_poly", type: "Polyline", act: "create", name: "创建折线", params: ["坐标", "线宽"] },
    { id: "create_line", type: "Line", act: "create", name: "创建直线", params: ["坐标", "线宽"] },
    { id: "create_arc", type: "Arc", act: "create", name: "创建弧线", params: ["坐标", "线宽", "圆弧角度"] },
    { id: "get_via", type: "Via", act: "get", name: "获取过孔", params: ["坐标", "内径", "外径", "阻焊"] },
    { id: "get_pad", type: "Pad", act: "get", name: "获取焊盘", params: ["坐标", "内径", "外径", "阻焊"] },
    { id: "get_poly", type: "Polyline", act: "get", name: "获取折线", params: ["坐标", "线宽"] },
    { id: "get_line", type: "Line", act: "get", name: "获取直线", params: ["坐标", "线宽"] },
    { id: "get_arc", type: "Arc", act: "get", name: "获取弧线", params: ["坐标", "线宽", "圆弧角度"] }
  ];

  // iframe/js/src/app/api-test/sourceProbe.js
  var V2_FIELDS = {
    Via: { pos: [5, 6], val1: 7, val2: 8, val3: 10 },
    Pad: { pos: [6, 7], val1: [9, 1], val2: [10, 1], val3: 17 },
    Line: { pos: [5, 6], val1: 9 },
    Arc: { pos: [5, 6], val1: 10, val2: 9 },
    Polyline: { pos: [6, 0], pos2: [6, 1], val1: 5 }
  };
  function findSourceLine(code, id) {
    let rawV2 = null;
    let rawV3 = null;
    for (const line of String(code || "").split("\n")) {
      const text = line.trim();
      if (!text) continue;
      if (text.includes("||") && text.includes(`"id":"${id}"`)) {
        try {
          const parts = text.split("||");
          rawV3 = JSON.parse(parts[1].replace(/\|$/, ""));
          break;
        } catch (e) {
        }
      } else if (text.startsWith("[") && text.includes(`"${id}"`)) {
        try {
          rawV2 = JSON.parse(text.replace(/,$/, ""));
          break;
        } catch (e) {
        }
      }
    }
    return { rawV2, rawV3 };
  }
  function normalizeFromSource(type, rawV2, rawV3) {
    if (!rawV2 && !rawV3) return [];
    if (rawV3) {
      const std2 = { x: 0, y: 0, val1: 0, val2: 0, val3: "0" };
      const solder = (value) => value === null ? "null" : value ?? "0";
      switch (type) {
        case "Via":
          std2.x = rawV3.centerX;
          std2.y = rawV3.centerY;
          std2.val1 = rawV3.holeDiameter;
          std2.val2 = rawV3.viaDiameter;
          std2.val3 = solder(rawV3.topSolderExpansion);
          break;
        case "Pad":
          std2.x = rawV3.centerX;
          std2.y = rawV3.centerY;
          std2.val1 = rawV3.hole?.width;
          std2.val2 = rawV3.defaultPad?.width;
          std2.val3 = solder(rawV3.topSolderExpansion);
          break;
        case "Line":
          std2.x = rawV3.startX;
          std2.y = rawV3.startY;
          std2.val1 = rawV3.width;
          break;
        case "Arc":
          std2.x = rawV3.startX;
          std2.y = rawV3.startY;
          std2.val1 = rawV3.width;
          std2.val2 = rawV3.angle;
          break;
        case "Polyline":
          std2.x = rawV3.path?.[0];
          std2.y = rawV3.path?.[1];
          std2.val1 = rawV3.width;
          break;
        default:
          return [];
      }
      return shape(type, std2);
    }
    const fields = V2_FIELDS[type];
    if (!fields) return [];
    const at = (index) => rawV2[index];
    const nested = (index) => Array.isArray(index) ? at(index[0])?.[index[1]] : at(index);
    const std = {
      x: type === "Polyline" ? rawV2[6]?.[0] : at(fields.pos[0]),
      y: type === "Polyline" ? rawV2[6]?.[1] : at(fields.pos[1]),
      val1: nested(fields.val1),
      val2: nested(fields.val2),
      val3: fields.val3 === void 0 ? "0" : at(fields.val3) === null ? "null" : at(fields.val3) ?? "0"
    };
    return shape(type, std);
  }
  function shape(type, std) {
    const pos = `${std.x},${std.y}`;
    if (type === "Via" || type === "Pad") return [pos, std.val1, std.val2, String(std.val3)];
    if (type === "Arc") return [pos, std.val1, std.val2];
    return [pos, std.val1];
  }
  function extractFromApi(type, obj) {
    const solderOf = (value) => {
      if (value === null) return "null";
      if (value === void 0) return "0";
      if (typeof value !== "object") return value;
      return value.topSolderMask === null ? "null" : value.topSolderMask ?? "0";
    };
    switch (type) {
      case "Via":
        return [`${obj.x},${obj.y}`, obj.holeDiameter, obj.diameter, String(solderOf(obj.solderMaskExpansion))];
      case "Pad":
        return [`${obj.x},${obj.y}`, obj.hole?.[1], obj.pad?.[1], String(solderOf(obj.solderMaskAndPasteMaskExpansion))];
      case "Line":
        return [`${obj.startX.toFixed(2)},${obj.startY.toFixed(2)}`, obj.lineWidth];
      case "Arc":
        return [`${obj.startX},${obj.startY}`, obj.lineWidth, obj.arcAngle];
      case "Polyline":
        return [`${obj.polygon.polygon[0]},${obj.polygon.polygon[1]}`, obj.lineWidth];
      default:
        return [];
    }
  }
  function defaultsOf(type, rawSource) {
    const d = rawSource && rawSource[type];
    if (!d) return [];
    switch (type) {
      case "Via":
        return [`${d[5]},${d[6]}`, d[7], d[8], d[10]];
      case "Pad":
        return [`${d[6]},${d[7]}`, d[9][1], d[10][1], d[17]];
      case "Line":
        return [`${d[5]},${d[6]}`, d[9]];
      case "Arc":
        return [`${d[5]},${d[6]}`, d[10], d[9]];
      case "Polyline":
        return [`${d[6][0]},${d[6][1]}`, d[5]];
      default:
        return [];
    }
  }

  // iframe/js/src/app/api-test/index.js
  var STORAGE_KEY = "APITest";
  var el = (id) => document.getElementById(id);
  function render() {
    const list = el("main-list");
    list.innerHTML = PROJECTS.map((project) => {
      const defaults = defaultsOf(project.type, RAW_SOURCE);
      return `
            <div class="card collapsed" id="card_${project.id}">
                <div class="card-header" onclick="toggle('${project.id}')">
                    <div><strong>${project.name}</strong></div>
                    <span id="stat_${project.id}" class="status-label">待测试</span>
                </div>
                <div class="card-content">
                    <table>
                        <thead><tr><th>参数</th><th>初始</th><th>实际</th><th>校准</th><th>状态</th></tr></thead>
                        <tbody>
                            ${project.params.map(
        (name, i) => `
                                <tr>
                                    <td class="param-name">${name}${name === "圆弧角度" ? '<div class="param-note">1 = 两侧同为角度制<br>0.017453 = 度→弧度<br>57.2958 = 弧度→度</div>' : ""}</td>
                                    <td><input class="val-input" id="set_${project.id}_${i}" value="${defaults[i] || ""}"></td>
                                    <td><input class="val-input" id="act_${project.id}_${i}" readonly></td>
                                    <td><input class="val-input" id="cal_${project.id}_${i}" placeholder="*1"></td>
                                    <td class="row-status" id="res_${project.id}_${i}">-</td>
                                </tr>
                            `
      ).join("")}
                        </tbody>
                    </table>
                </div>
            </div>`;
    }).join("");
  }
  async function loadSavedParams() {
    const host = getEda();
    if (!host) return;
    try {
      const saved = await host.sys_Storage.getExtensionUserConfig(STORAGE_KEY);
      if (!saved) return;
      const config = JSON.parse(saved);
      for (const project of PROJECTS) {
        const savedObj = config[project.name];
        if (!savedObj) continue;
        project.params.forEach((paramName, i) => {
          const input = el(`cal_${project.id}_${i}`);
          const value = savedObj[paramName];
          if (!input || value === void 0) return;
          input.value = value !== 1 ? `*${value}` : "";
        });
      }
    } catch (e) {
      console.error("加载校准参数失败，可能数据格式有误:", e);
    }
  }
  function fillAndVerify(project, actuals) {
    let allPass = true;
    let anyCal = false;
    actuals.forEach((value, i) => {
      const actEl = el(`act_${project.id}_${i}`);
      const setVal = el(`set_${project.id}_${i}`).value;
      const calVal = el(`cal_${project.id}_${i}`).value;
      const resEl = el(`res_${project.id}_${i}`);
      actEl.value = value;
      if (calVal) anyCal = true;
      let isPass;
      if (project.act === "get") {
        isPass = compare(setVal, applyCalStr(value, calVal));
      } else {
        isPass = compare(setVal, value) || calVal && compare(setVal, applyCalStr(value, calVal));
      }
      resEl.innerText = isPass ? "通过测试" : "数据异常";
      resEl.className = "row-status " + (isPass ? "pass" : "fail");
      if (!isPass) allPass = false;
    });
    const stat = el(`stat_${project.id}`);
    const card = el(`card_${project.id}`);
    if (!allPass) {
      stat.innerText = "错误";
      stat.style.color = "var(--vscode-error)";
      card.classList.remove("collapsed");
    } else {
      stat.innerText = anyCal ? "已校准" : "通过";
      stat.style.color = anyCal ? "var(--vscode-warning)" : "var(--vscode-success)";
      card.classList.add("collapsed");
    }
  }
  async function readSourceValues(id, type) {
    const host = getEda();
    const code = await host.sys_FileManager.getDocumentSource();
    const { rawV2, rawV3 } = findSourceLine(code, id);
    return normalizeFromSource(type, rawV2, rawV3);
  }
  async function runGetTest(project, apiObj) {
    const setVals = await readSourceValues(apiObj.primitiveId, project.type);
    setVals.forEach((value, i) => el(`set_${project.id}_${i}`).value = value);
    fillAndVerify(project, extractFromApi(project.type, apiObj));
  }
  var CREATORS = {
    Via: async (host, fx, fy, innerDia, outerDia, solderMask) => {
      const r = await host.pcb_PrimitiveVia.create("", Number(fx), Number(fy), innerDia, outerDia, 0, null, {
        topSolderMask: solderMask,
        bottomSolderMask: solderMask,
        topPasteMask: 0,
        bottomPasteMask: 0
      });
      return r.primitiveId;
    },
    Pad: async (host, fx, fy, innerDia, outerDia, solderMask) => {
      const r = await host.pcb_PrimitivePad.create(
        12,
        "1",
        Number(fx),
        Number(fy),
        0,
        ["ELLIPSE", outerDia, outerDia],
        "",
        ["ROUND", innerDia, innerDia],
        0,
        0,
        0,
        true,
        0,
        [],
        { topSolderMask: solderMask, bottomSolderMask: solderMask, topPasteMask: solderMask, bottomPasteMask: solderMask }
      );
      return r.primitiveId;
    },
    Line: async (host, fx, fy, innerDia) => {
      const r = await host.pcb_PrimitiveLine.create("", 1, Number(fx), Number(fy), Number(fx) + 30, Number(fy), Number(innerDia));
      return r.primitiveId;
    },
    Arc: async (host, fx, fy, innerDia, outerDia) => {
      const r = await host.pcb_PrimitiveArc.create("", 1, Number(fx), Number(fy), Number(fx), Number(fy) - 20, Number(outerDia), Number(innerDia));
      return r.primitiveId;
    },
    Polyline: async (host, fx, fy, innerDia) => {
      const poly = host.pcb_MathPolygon.createPolygon([Number(fx), Number(fy), "L", Number(fx) + 30, Number(fy)]);
      const r = await host.pcb_PrimitivePolyline.create("", 1, poly, Number(innerDia));
      return r.primitiveId;
    }
  };
  async function runCreateTest(project) {
    const host = getEda();
    const readInput = (prefix, index) => {
      const node = el(`${prefix}_${project.id}_${index}`);
      return node ? node.value : "";
    };
    const getV = (index) => readInput("set", index);
    const getC = (index) => readInput("cal", index);
    const [x, y] = getV(0).split(",");
    const fx = applyCal(x, getC(0));
    const fy = applyCal(y, getC(0));
    const innerDia = Number(applyCal(getV(1), getC(1)));
    const outerDia = Number(applyCal(getV(2), getC(2)));
    const solderMask = Number(applyCal(getV(3), getC(3)));
    const creator = CREATORS[project.type];
    if (!creator) return;
    const resId = await creator(host, fx, fy, innerDia, outerDia, solderMask);
    if (!resId) return;
    fillAndVerify(project, await readSourceValues(resId, project.type));
  }
  async function executeBatch(action) {
    const host = getEda();
    try {
      await runBatch(action, host);
    } catch (error) {
      console.error("批量执行失败:", error);
      toast("批量执行失败: " + (error && error.message ? error.message : error), "error");
    }
  }
  async function runBatch(action, host) {
    if (action === "get") {
      const selected = await host.pcb_SelectControl.getAllSelectedPrimitives();
      if (!selected || selected.length === 0) {
        toast("请先选中画布上的元素", "info");
        return;
      }
      for (const project of PROJECTS.filter((item) => item.act === "get")) {
        const target = selected.find((item) => item.primitiveType === project.type);
        if (target) await runGetTest(project, target);
      }
      return;
    }
    for (const project of PROJECTS.filter((item) => item.act === "create")) {
      await runCreateTest(project);
    }
  }
  function autoCalibrateAll() {
    for (const project of PROJECTS) {
      project.params.forEach((_, i) => {
        const setStr = el(`set_${project.id}_${i}`).value;
        const actStr = el(`act_${project.id}_${i}`).value;
        const calInput = el(`cal_${project.id}_${i}`);
        let set = parseFloat(setStr);
        let act = parseFloat(actStr);
        if (String(setStr).includes(",")) {
          const sParts = String(setStr).split(",");
          const aParts = String(actStr).split(",");
          const aX = parseFloat(aParts[0]);
          if (aX !== 0 && !isNaN(aX)) {
            set = parseFloat(sParts[0]);
            act = aX;
          } else {
            set = parseFloat(sParts[1]);
            act = parseFloat(aParts[1]);
          }
        }
        if (isNaN(set) || isNaN(act) || act === 0) return;
        const ratio = project.act === "get" ? set / act : applyCal(set, calInput.value) / act;
        calInput.value = ratioToCalInput(ratio);
      });
      validateManual(project.id);
    }
  }
  function validateManual(id) {
    const project = PROJECTS.find((item) => item.id === id);
    const actuals = project.params.map((_, i) => el(`act_${id}_${i}`).value);
    if (actuals[0]) fillAndVerify(project, actuals);
  }
  async function saveParams() {
    const host = getEda();
    const config = {};
    const invalid = [];
    for (const project of PROJECTS) {
      const paramsObj = {};
      project.params.forEach((paramName, i) => {
        const text = el(`cal_${project.id}_${i}`).value;
        const multiplier = calToMultiplier(text);
        if (Number.isNaN(multiplier)) {
          invalid.push(`${project.name}.${paramName}（${text}）`);
          paramsObj[paramName] = 1;
        } else {
          paramsObj[paramName] = multiplier;
        }
      });
      config[project.name] = { ...paramsObj };
    }
    if (invalid.length > 0) {
      toast(`校准值不合法：${invalid.slice(0, 3).join("、")}，允许范围 ${MULTIPLIER_MIN}~${MULTIPLIER_MAX}`, "error");
      return;
    }
    try {
      const ok = await host.sys_Storage.setExtensionUserConfig(STORAGE_KEY, JSON.stringify(config));
      toast(ok ? "保存成功" : "保存失败", ok ? "success" : "error");
    } catch (error) {
      toast("保存失败", "error");
      if (String(error).includes("Cannot create property")) toast("EDA底层数据写入异常，无法保存，建议重启EDA", "error");
    }
  }
  function toggle(id) {
    el(`card_${id}`).classList.toggle("collapsed");
  }
  window.toggle = toggle;
  window.executeBatch = executeBatch;
  window.autoCalibrateAll = autoCalibrateAll;
  window.saveParams = saveParams;
  window.onload = async () => {
    const host = getEda();
    if (host) el("ver-info").innerText = `EDA版本: ${getEditorVersion()}`;
    render();
    await loadSavedParams();
  };
})();
