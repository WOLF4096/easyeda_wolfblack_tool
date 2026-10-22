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

  // iframe/js/src/app/create-footprint/sourceBuilder.js
  function footprintHeader(uuid, deviceName) {
    return `["DOCTYPE","FOOTPRINT","1.8"]
["HEAD",{"editorVersion":"2.2.43.4","importFlag":0,"uuid":"${uuid}","source":"generated","title":"${deviceName}"}]
["CANVAS",0,0,"mil",10,10,10,10,100,100,0,0,5]
["LAYER",1,"TOP","Top Layer",3,"#ff0000",1,"#7f0000",1]
["LAYER",2,"BOTTOM","Bottom Layer",3,"#0000ff",1,"#00007f",1]
["LAYER",3,"TOP_SILK","Top Silkscreen Layer",3,"#ffcc00",1,"#7f6600",1]
["LAYER",4,"BOT_SILK","Bottom Silkscreen Layer",3,"#66cc33",1,"#336619",1]
["LAYER",5,"TOP_SOLDER_MASK","Top Solder Mask Layer",3,"#800080",1,"#400040",1]
["LAYER",6,"BOT_SOLDER_MASK","Bottom Solder Mask Layer",3,"#aa00ff",1,"#55007f",1]
["LAYER",7,"TOP_PASTE_MASK","Top Paste Mask Layer",3,"#808080",1,"#404040",1]
["LAYER",8,"BOT_PASTE_MASK","Bottom Paste Mask Layer",3,"#800000",1,"#400000",1]
["LAYER",9,"TOP_ASSEMBLY","Top Assembly Layer",3,"#33cc99",1,"#19664c",1]
["LAYER",10,"BOT_ASSEMBLY","Bottom Assembly Layer",3,"#5555ff",1,"#2a2a7f",1]
["LAYER",11,"OUTLINE","Board Outline Layer",3,"#ff00ff",1,"#7f007f",1]
["LAYER",12,"MULTI","Multi-Layer",3,"#c0c0c0",1,"#606060",1]
["LAYER",13,"DOCUMENT","Document Layer",3,"#ffffff",1,"#7f7f7f",1]
["LAYER",14,"MECHANICAL","Mechanical Layer",3,"#f022f0",1,"#781178",1]
["LAYER",47,"HOLE","Hole Layer",3,"#222222",1,"#111111",1]
["ACTIVE_LAYER",1]
["NET","",null,null,1,null,0,null]
["PRIMITIVE","PAD",1,1]
`;
  }
  var DIRECT_COORDS = /* @__PURE__ */ new Map([
    ["PAD", [6, 7]],
    ["VIA", [5, 6]],
    ["IMAGE", [4, 5]]
  ]);
  var PATH_FIELDS = /* @__PURE__ */ new Map([
    ["POLY", 6],
    ["REGION", 6],
    ["FILL", 7],
    ["POUR", 8]
  ]);
  function firstCoordOf(pathObj) {
    if (!pathObj) return { x: void 0, y: void 0 };
    const polyArr = Array.isArray(pathObj[0]) ? pathObj[0] : pathObj;
    for (let i = 0; i < polyArr.length - 1; i++) {
      if (typeof polyArr[i] === "number" && typeof polyArr[i + 1] === "number") return { x: polyArr[i], y: polyArr[i + 1] };
    }
    return { x: void 0, y: void 0 };
  }
  function getCoordsFromSource(arr) {
    const direct = DIRECT_COORDS.get(arr[0]);
    if (direct) return { x: arr[direct[0]], y: arr[direct[1]] };
    const pathField = PATH_FIELDS.get(arr[0]);
    if (pathField === void 0) return { x: void 0, y: void 0 };
    return firstCoordOf(arr[pathField]);
  }
  function transformPath(arr, ox, oy) {
    const out = Array.isArray(arr) ? arr.slice() : [];
    if (out.length === 0) return out;
    const type = out[0];
    const shift = (index, delta) => {
      if (typeof out[index] === "number") out[index] = parseFloat((out[index] - delta).toFixed(4));
    };
    if (type === "R" || type === "CIRCLE") {
      shift(1, ox);
      shift(2, oy);
      return out;
    }
    let i = 0;
    if (typeof out[0] === "number") {
      shift(0, ox);
      shift(1, oy);
      i = 2;
    }
    while (i < out.length) {
      const cmd = out[i];
      if (typeof cmd === "number") {
        shift(i, ox);
        shift(i + 1, oy);
        i += 2;
      } else if (cmd === "L") {
        shift(i + 1, ox);
        shift(i + 2, oy);
        i += 3;
      } else if (cmd === "ARC") {
        shift(i + 2, ox);
        shift(i + 3, oy);
        i += 4;
      } else {
        i++;
      }
    }
    return out;
  }
  function shiftPathField(value, ox, oy) {
    if (Array.isArray(value) && Array.isArray(value[0])) return value.map((sub) => transformPath(sub, ox, oy));
    if (Array.isArray(value)) return transformPath(value, ox, oy);
    return value;
  }
  function shiftXY(p, ix, iy, ox, oy) {
    p[ix] = parseFloat((p[ix] - ox).toFixed(4));
    p[iy] = parseFloat((p[iy] - oy).toFixed(4));
  }
  function shiftPad(p, ox, oy) {
    shiftXY(p, 6, 7, ox, oy);
    const padShape = p[10];
    if (Array.isArray(padShape) && padShape[0] === "POLYGON" && Array.isArray(padShape[1])) {
      padShape[1] = transformPath(padShape[1], ox, oy);
    }
  }
  function shiftImage(p, ox, oy) {
    shiftXY(p, 4, 5, ox, oy);
    p[10] = shiftPathField(p[10], ox, oy);
  }
  function shiftPoly(p, ox, oy) {
    p[6] = shiftPathField(p[6], ox, oy);
  }
  function shiftFill(p, ox, oy) {
    p[7] = shiftPathField(p[7], ox, oy);
  }
  function shiftPour(p, ox, oy) {
    p[8] = shiftPathField(p[8], ox, oy);
  }
  var SHIFTERS = /* @__PURE__ */ new Map([
    ["PAD", shiftPad],
    ["VIA", (p, ox, oy) => shiftXY(p, 5, 6, ox, oy)],
    ["IMAGE", shiftImage],
    ["POLY", shiftPoly],
    ["REGION", shiftPoly],
    ["FILL", shiftFill],
    ["POUR", shiftPour]
  ]);
  function shiftPrimitive(p, ox, oy) {
    const shift = SHIFTERS.get(p[0]);
    if (shift) shift(p, ox, oy);
  }
  function buildFootprintSource(primitives, options) {
    const { uuid, deviceName, originX, originY } = options;
    let idCounter = 1;
    const lines = [];
    for (const source of Array.isArray(primitives) ? primitives : []) {
      const p = source.slice();
      p[1] = `e${idCounter++}`;
      shiftPrimitive(p, originX, originY);
      lines.push(JSON.stringify(p));
    }
    return footprintHeader(uuid, deviceName) + lines.join("\n") + (lines.length ? "\n" : "");
  }
  function sortPinNumbers(pins) {
    return pins.slice().sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }
  function buildSymbolSource(options) {
    const pins = sortPinNumbers(Array.from(options.pinNumbers || []));
    const deviceName = options.deviceName;
    const totalPins = pins.length;
    const leftCount = Math.ceil(totalPins / 2);
    const rowHeight = 10;
    const topY = 10;
    const maxRows = Math.max(leftCount, totalPins - leftCount);
    const bottomY = 10 - (maxRows - 1) * 10;
    const geometricCenterY = (topY + bottomY) / 2;
    const snappedCenterY = Math.round(geometricCenterY / 10) * 10;
    const startY = 10 - snappedCenterY;
    const boxTop = startY + 10;
    let boxBottom = startY - (maxRows - 1) * rowHeight - 10;
    if (totalPins <= 1) boxBottom = boxTop - 20;
    const bboxStr = `[-40,${boxBottom},40,${boxTop}]`;
    const header = `["DOCTYPE","SYMBOL","1.1"]
["HEAD",{"originX":0,"originY":0,"version":"2","symbolType":2}]
["PART","${deviceName}.1",{"BBOX":${bboxStr}}]
`;
    const styles = `["FONTSTYLE","st1",null,null,null,null,null,null,null,null,1,0]
["FONTSTYLE","st2",null,null,null,null,null,null,null,null,2,2]
["FONTSTYLE","st3",null,null,null,null,null,null,null,null,1,2]
["FONTSTYLE","st4",null,null,null,null,null,null,null,null,2,0]
["LINESTYLE","st5",null,null,null,null,null]
`;
    const createAttr = (id, parent, key, val, x, y, font) => {
      const safeVal = val !== void 0 && val !== null && val !== "" ? val : "?";
      return `["ATTR","${id}","${parent}","${key}","${safeVal}",0,1,${x},${y},0,"${font}",0]`;
    };
    let body = "";
    for (let i = 0; i < totalPins; i++) {
      if (i < leftCount) {
        const pinNum = pins[i];
        const y = startY - i * rowHeight;
        const pId = `pL${i}`;
        body += `["PIN","${pId}",1,null,-40,${y},20,0,null,0,0]
`;
        body += createAttr(`nL${i}`, pId, "NAME", pinNum, -17, y, "st1") + "\n";
        body += createAttr(`uL${i}`, pId, "NUMBER", pinNum, -25, y, "st2") + "\n";
      } else {
        const rightIndex = i - leftCount;
        const pinIndex = totalPins - 1 - rightIndex;
        const pinNum = pins[pinIndex];
        const y = startY - rightIndex * rowHeight;
        const pId = `pR${i}`;
        body += `["PIN","${pId}",1,null,40,${y},20,180,null,0,0]
`;
        body += createAttr(`nR${i}`, pId, "NAME", pinNum, 17, y, "st3") + "\n";
        body += createAttr(`uR${i}`, pId, "NUMBER", pinNum, 25, y, "st4") + "\n";
      }
    }
    const box = `["RECT","box",-20,${boxTop},20,${boxBottom},0,0,0,"st5",0]`;
    return header + styles + body + box;
  }

  // iframe/js/src/app/create-footprint/index.js
  function blockModernClients() {
    try {
      if (!isModern()) return false;
    } catch (e) {
      return false;
    }
    const container = document.querySelector(".cf-form");
    if (container) container.innerHTML = '<div class="notice-center">此功能只支持 EDA V2.2.45 版本</div>';
    return true;
  }
  function padBounds(pads) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pad of pads) {
      if (pad[6] < minX) minX = pad[6];
      if (pad[6] > maxX) maxX = pad[6];
      if (pad[7] < minY) minY = pad[7];
      if (pad[7] > maxY) maxY = pad[7];
    }
    return { minX, minY, maxX, maxY };
  }
  function primitiveBounds(primitives) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of primitives) {
      const { x, y } = getCoordsFromSource(item);
      if (x === void 0 || y === void 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  }
  function computeOrigin(primitives) {
    const pads = primitives.filter((item) => item[0] === "PAD");
    if (pads.length === 1) return { originX: pads[0][6], originY: pads[0][7] };
    const bounds = pads.length > 1 ? padBounds(pads) : primitiveBounds(primitives);
    return { originX: (bounds.minX + bounds.maxX) / 2, originY: (bounds.minY + bounds.maxY) / 2 };
  }
  function collectPadNumbers(primitives) {
    const set = /* @__PURE__ */ new Set();
    for (const item of primitives) {
      if (item[0] !== "PAD") continue;
      const num = item[5];
      if (num !== void 0 && num !== null && String(num).trim() !== "") set.add(String(num).trim());
    }
    return set;
  }
  function deviceNameOf(input, pinCount) {
    if (input && input.length > 0) return input;
    const now = /* @__PURE__ */ new Date();
    const hh = now.getHours().toString().padStart(2, "0");
    const mm = now.getMinutes().toString().padStart(2, "0");
    const ss = now.getSeconds().toString().padStart(2, "0");
    return `NEW-${pinCount}Pin_${hh}${mm}${ss}`;
  }
  function readInputs() {
    return {
      name: document.getElementById("fooNameInput").value.trim(),
      des: document.getElementById("desNameInput").value.trim(),
      libraryUuid: document.getElementById("libSelect").value
    };
  }
  function pickSourceLines(docSource, selectedIds) {
    const primitives = [];
    for (const line of docSource.split("\n")) {
      if (!line.trim()) continue;
      try {
        const arr = JSON.parse(line);
        if (selectedIds.includes(arr[1])) primitives.push(arr);
      } catch (e) {
      }
    }
    return primitives;
  }
  async function readSelection(host) {
    const allSelected = await host.pcb_SelectControl.getAllSelectedPrimitives();
    if (!allSelected || allSelected.length === 0) throw new Error("请先在 PCB 中选中图元！");
    const targets = allSelected.filter((p) => p.primitiveType !== "Component");
    if (targets.length === 0) throw new Error("未选中有效图元");
    const selectedIds = targets.map((p) => p.primitiveId);
    const docSource = await host.sys_FileManager.getDocumentSource();
    const primitives = pickSourceLines(docSource, selectedIds);
    if (primitives.length === 0) throw new Error("无法在源码中匹配到选中的图元数据");
    return { targets, primitives };
  }
  function buildNames(inputs, primitives) {
    const { originX, originY } = computeOrigin(primitives);
    const padNumbers = collectPadNumbers(primitives);
    const deviceName = deviceNameOf(inputs.name, padNumbers.size);
    const desMatch = inputs.des.match(/^[a-zA-Z]+/);
    const finalDesignator = (desMatch ? desMatch[0].toUpperCase() : "U") + "?";
    return { originX, originY, padNumbers, deviceName, finalDesignator };
  }
  async function createLibraryElements(host, libraryUuid, names) {
    const fpUuid = await host.lib_Footprint.create(libraryUuid, names.deviceName);
    const symUuid = await host.lib_Symbol.create(libraryUuid, names.deviceName);
    const devUuid = await host.lib_Device.create(
      libraryUuid,
      names.deviceName,
      void 0,
      {
        symbolType: 2,
        symbol: { uuid: symUuid, libraryUuid },
        footprint: { uuid: fpUuid, libraryUuid }
      },
      void 0,
      { addIntoBom: true, addIntoPcb: true, designator: names.finalDesignator, name: names.deviceName }
    );
    return { fpUuid, symUuid, devUuid };
  }
  async function writeSources(host, libraryUuid, primitives, names, created) {
    await host.lib_Footprint.updateDocumentSource(created.fpUuid, libraryUuid, buildFootprintSource(primitives, { uuid: created.fpUuid, deviceName: names.deviceName, originX: names.originX, originY: names.originY }));
    await host.lib_Symbol.updateDocumentSource(created.symUuid, libraryUuid, buildSymbolSource({ deviceName: names.deviceName, pinNumbers: names.padNumbers }));
  }
  async function placeDevice(host, libraryUuid, devUuid, names) {
    if (getEditorVersion().startsWith("2.2.43")) {
      const created = await host.pcb_PrimitiveComponent.create({ libraryUuid, uuid: devUuid }, host.EPCB_LayerId ? host.EPCB_LayerId.TOP : 1, names.originX, names.originY, 0, false);
      if (created && created.primitiveId) await host.pcb_PrimitiveComponent.delete(created.primitiveId);
    }
    await host.sch_PrimitiveComponent.create({ libraryUuid, uuid: devUuid }, 0, 0, "", 0, false, true, true);
  }
  var DELETE_HANDLERS = /* @__PURE__ */ new Map([
    ["Pad", (host, id) => host.pcb_PrimitivePad.delete(id)],
    ["Polyline", (host, id) => host.pcb_PrimitivePolyline.delete(id)],
    ["Region", (host, id) => host.pcb_PrimitivePour.delete(id)],
    ["Via", (host, id) => host.pcb_PrimitiveVia.delete(id)],
    ["Image", (host, id) => host.pcb_PrimitiveImage.delete(id)]
  ]);
  async function deleteTargets(host, targets) {
    for (const item of targets) {
      try {
        const remove = DELETE_HANDLERS.get(item.primitiveType);
        if (remove) await remove(host, item.primitiveId);
      } catch (e) {
        console.warn("删除临时图元失败", e);
      }
    }
  }
  function finishSuccess(host, deviceName) {
    if (host.sys_IFrame) host.sys_IFrame.hideIFrame("CreateFootprint");
    document.getElementById("fooNameInput").value = "";
    toast("成功创建封装: " + deviceName, "success");
  }
  async function onRunClick() {
    const btn = document.getElementById("runBtn");
    const inputs = readInputs();
    if (!inputs.libraryUuid) {
      toast("请先选择一个目标库！", "warning");
      return;
    }
    const host = getEda();
    if (!host) {
      toast("未检测到 EDA 运行环境", "error");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.innerText = "处理中...";
    }
    try {
      const { targets, primitives } = await readSelection(host);
      const names = buildNames(inputs, primitives);
      const created = await createLibraryElements(host, inputs.libraryUuid, names);
      await writeSources(host, inputs.libraryUuid, primitives, names, created);
      await placeDevice(host, inputs.libraryUuid, created.devUuid, names);
      await deleteTargets(host, targets);
      finishSuccess(host, names.deviceName);
    } catch (err) {
      console.error("执行错误: ", err);
      toast(err.message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = "创建封装";
      }
    }
  }
  async function initLibList() {
    const select = document.getElementById("libSelect");
    const runBtn = document.getElementById("runBtn");
    try {
      const host = getEda();
      const libraries = host && host.lib_LibrariesList ? await host.lib_LibrariesList.getAllLibrariesList() : [];
      for (const lib of libraries) {
        const option = document.createElement("option");
        option.value = lib.uuid || lib.id || "";
        option.textContent = lib.name || lib.title || "未命名库";
        select.appendChild(option);
      }
      if (runBtn) runBtn.disabled = false;
    } catch (err) {
      console.warn("版本检测异常，尝试继续执行...", err);
    }
  }
  if (!blockModernClients()) {
    void initLibList();
    const runBtnEl = document.getElementById("runBtn");
    if (runBtnEl) runBtnEl.addEventListener("click", onRunClick);
  }
})();
