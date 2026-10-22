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

  // iframe/js/src/app/generate-net/padReader.js
  function polygonVertices(pathData) {
    const vertices = [];
    let j = 0;
    while (j < pathData.length) {
      const buffer = [];
      while (j < pathData.length && typeof pathData[j] === "number") {
        buffer.push(pathData[j]);
        j++;
      }
      if (buffer.length >= 2) vertices.push({ x: buffer[buffer.length - 2], y: buffer[buffer.length - 1] });
      if (j < pathData.length && typeof pathData[j] === "string") j++;
    }
    return vertices;
  }
  function padGeometry(pad) {
    const box = padBoxOf(pad);
    const rawHole = pad.hole && pad.hole.length > 1 ? Number(pad.hole[1]) : 0;
    const shaped = shapeOfPad(pad, box);
    return {
      id: pad.primitiveId,
      type: "PAD",
      net: pad.net,
      layer: pad.layer,
      shape: shaped.shape,
      x: Number(pad.x),
      y: Number(pad.y),
      w: shaped.w,
      h: shaped.h,
      r: shaped.radius,
      vertices: shaped.vertices,
      // 孔直径在源码里单位是 10mil，这里换算成一致量纲
      holeSize: rawHole * 10
    };
  }
  function padBoxOf(pad) {
    let w = 10;
    let h = 10;
    let shapeType = "RECT";
    if (pad.pad && pad.pad.length > 1) {
      shapeType = pad.pad[0];
      if (shapeType !== "POLYGON") {
        w = Number(pad.pad[1]);
        h = Number(pad.pad[2] || w);
      }
    }
    return { shapeType, w, h };
  }
  function shapeOfPad(pad, box) {
    if (box.shapeType === "ROUND" || box.shapeType === "ELLIPSE" && Math.abs(box.w - box.h) < 0.1) {
      return { shape: "ROUND", w: box.w, h: box.h, radius: box.w / 2, vertices: null };
    }
    if (box.shapeType === "POLYGON" && Array.isArray(pad.pad[1])) {
      return polyShapeOf(pad, box);
    }
    return { shape: "ROUND", w: box.w, h: box.h, radius: Math.min(box.w, box.h) / 2, vertices: null };
  }
  function polyShapeOf(pad, box) {
    const vertices = polygonVertices(pad.pad[1]);
    if (vertices.length === 0) {
      return { shape: "POLY", w: box.w, h: box.h, radius: 0, vertices };
    }
    const bounds = vertexBounds(vertices);
    pad.x = bounds.x;
    pad.y = bounds.y;
    return { shape: "POLY", w: bounds.w, h: bounds.h, radius: 0, vertices };
  }
  function vertexBounds(vertices) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  }
  async function readAllPads(host) {
    try {
      const allPads = await host.pcb_PrimitivePad.getAll();
      return allPads.map((pad) => padGeometry(pad));
    } catch (e) {
      console.error("获取焊盘数据失败:", e);
      return [];
    }
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

  // iframe/js/src/app/generate-net/geometry.js
  var LAYER_MULTI = LAYER.MULTI;
  var GRID_SIZE = 150;
  function distToSegmentSquared(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2;
  }
  function isTwoLinesTouching(l1, l2) {
    const threshold = l1.w / 2 + l2.w / 2;
    const distSqLimit = threshold * threshold;
    if (distToSegmentSquared(l1.x1, l1.y1, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
    if (distToSegmentSquared(l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2) <= distSqLimit) return true;
    if (distToSegmentSquared(l2.x1, l2.y1, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;
    if (distToSegmentSquared(l2.x2, l2.y2, l1.x1, l1.y1, l1.x2, l1.y2) <= distSqLimit) return true;
    return segmentsIntersect(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
  }
  function segmentsIntersect(a, b, c, d, p, q, r, s) {
    const crossProduct = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    const d1 = crossProduct(p, q, r, s, a, b);
    const d2 = crossProduct(p, q, r, s, c, d);
    const d3 = crossProduct(a, b, c, d, p, q);
    const d4 = crossProduct(a, b, c, d, r, s);
    return (d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0);
  }
  function isPointInRect(x, y, rect) {
    return Math.abs(x - rect.x) <= rect.w / 2 && Math.abs(y - rect.y) <= rect.h / 2;
  }
  function isLineIntersectRect(x1, y1, x2, y2, rect) {
    const left = rect.x - rect.w / 2;
    const right = rect.x + rect.w / 2;
    const top = rect.y - rect.h / 2;
    const bottom = rect.y + rect.h / 2;
    if (isPointInRect(x1, y1, rect) || isPointInRect(x2, y2, rect)) return true;
    return segmentsIntersect(x1, y1, x2, y2, left, top, right, top) || segmentsIntersect(x1, y1, x2, y2, left, bottom, right, bottom) || segmentsIntersect(x1, y1, x2, y2, left, top, left, bottom) || segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom);
  }
  function getPolyVertices(shapeData) {
    const vertices = [];
    const traverse = (node) => {
      if (!Array.isArray(node)) return;
      const numbers = node.filter((n) => typeof n === "number");
      if (numbers.length >= 4 && numbers.length % 2 === 0) {
        for (let i = 0; i < numbers.length; i += 2) vertices.push({ x: numbers[i], y: numbers[i + 1] });
      } else {
        node.forEach((sub) => Array.isArray(sub) && traverse(sub));
      }
    };
    traverse(shapeData);
    return vertices;
  }
  function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return false;
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  }
  function isPointInPoly(px, py, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x;
      const yi = vertices[i].y;
      const xj = vertices[j].x;
      const yj = vertices[j].y;
      const intersect = yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function getRotatedRectVertices(x, y, w, h, rotation, radius = 0, segments = 6) {
    const rad = (rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const maxRadius = Math.min(w, h) / 2;
    const r = Math.max(0, Math.min(radius || 0, maxRadius));
    let offsets = [];
    if (r <= 0) {
      offsets = [
        { dx: 0, dy: 0 },
        { dx: w, dy: 0 },
        { dx: w, dy: -h },
        { dx: 0, dy: -h }
      ];
    } else {
      const addArcPoints = (cx, cy, startAngle, endAngle) => {
        const step = (endAngle - startAngle) / segments;
        for (let i = 0; i <= segments; i++) {
          const theta = startAngle + step * i;
          offsets.push({ dx: cx + r * Math.cos(theta), dy: cy + r * Math.sin(theta) });
        }
      };
      addArcPoints(w - r, -r, Math.PI / 2, 0);
      addArcPoints(w - r, -h + r, 0, -Math.PI / 2);
      addArcPoints(r, -h + r, -Math.PI / 2, -Math.PI);
      addArcPoints(r, -r, Math.PI, Math.PI / 2);
    }
    return offsets.map((p) => ({
      x: x + (p.dx * cos - p.dy * sin),
      y: y + (p.dx * sin + p.dy * cos)
    }));
  }
  function expandArcLines(prim) {
    const out = [];
    const x1 = prim.x1;
    const y1 = prim.y1;
    const x2 = prim.x2;
    const y2 = prim.y2;
    const w = prim.w;
    const angle = Number(prim.angle || 0);
    const ch = Math.hypot(x2 - x1, y2 - y1);
    const th = Math.min(Math.abs(angle) * Math.PI / 180, Math.PI * 2);
    if (!(ch > 1e-9) || !(th > 1e-9)) {
      out.push(prim);
      return out;
    }
    const r = ch / (2 * Math.sin(th / 2));
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const nx = -(y2 - y1) / ch;
    const ny = (x2 - x1) / ch;
    const h = Math.sqrt(Math.max(0, r * r - ch / 2 * (ch / 2)));
    const sgn = angle >= 0 ? 1 : -1;
    const cx = mx + nx * h * sgn;
    const cy = my + ny * h * sgn;
    const a0 = Math.atan2(y1 - cy, x1 - cx);
    const sweep = sgn * th;
    const N = Math.max(2, Math.min(12, Math.ceil(Math.abs(sweep) / (Math.PI / 8))));
    let px = x1;
    let py = y1;
    for (let k = 1; k <= N; k++) {
      const a = a0 + sweep * (k / N);
      const qx = cx + r * Math.cos(a);
      const qy = cy + r * Math.sin(a);
      out.push({ id: prim.id + "_" + k, type: "ARC", net: prim.net, layer: prim.layer, shape: "line", x1: px, y1: py, x2: qx, y2: qy, w });
      px = qx;
      py = qy;
    }
    return out;
  }
  function getEdges(shape) {
    const lines = [];
    if (shape.shape === "POLY" || shape.vertices) {
      const v = shape.vertices;
      for (let i = 0; i < v.length; i++) {
        const p1 = v[i];
        const p2 = v[(i + 1) % v.length];
        lines.push([p1.x, p1.y, p2.x, p2.y]);
      }
      return lines;
    }
    if (shape.shape === "line") {
      lines.push([shape.x1, shape.y1, shape.x2, shape.y2]);
      return lines;
    }
    if (shape.shape === "ROUND") {
      const r0 = shape.r || 0;
      const N = 12;
      for (let i = 0; i < N; i++) {
        const a1 = i / N * Math.PI * 2;
        const a2 = (i + 1) / N * Math.PI * 2;
        lines.push([
          shape.x + r0 * Math.cos(a1),
          shape.y + r0 * Math.sin(a1),
          shape.x + r0 * Math.cos(a2),
          shape.y + r0 * Math.sin(a2)
        ]);
      }
      return lines;
    }
    const hw = shape.w / 2;
    const hh = shape.h / 2;
    const l = shape.x - hw;
    const r = shape.x + hw;
    const t = shape.y - hh;
    const b = shape.y + hh;
    lines.push([l, t, r, t], [r, t, r, b], [r, b, l, b], [l, b, l, t]);
    return lines;
  }
  function areLayersConnected(a, b) {
    const getLayerIds = (obj) => {
      if (obj.blindLayers && obj.blindLayers.length > 0) return obj.blindLayers;
      if (obj.layer === LAYER_MULTI) return "ALL";
      return [obj.layer];
    };
    const layersA = getLayerIds(a);
    const layersB = getLayerIds(b);
    if (layersA === "ALL" || layersB === "ALL") return true;
    return layersA.some((id) => layersB.indexOf(id) !== -1);
  }
  function checkConnectivityHighPrecision(a, b) {
    if (!areLayersConnected(a, b)) return false;
    if (a.shape === "POLY" || b.shape === "POLY") return polyTouchesEither(a, b);
    if (a.shape === "line" && b.shape === "line") return isTwoLinesTouching(a, b);
    const pair = linePartnerPair(a, b);
    if (pair) return linePartnerTouches(pair.linePrim, pair.otherPrim);
    if (a.shape === "ROUND" && b.shape === "ROUND") return roundTouches(a, b);
    return boxTouches(a, b);
  }
  function polyTouchesEither(a, b) {
    const polyA = a.shape === "POLY" ? a : b;
    const other = a.shape === "POLY" ? b : a;
    return polyTouches(polyA, other);
  }
  function linePartnerPair(a, b) {
    const linePrim = a.shape === "line" ? a : b.shape === "line" ? b : null;
    const otherPrim = a.shape === "line" ? b : b.shape === "line" ? a : null;
    return linePrim && otherPrim ? { linePrim, otherPrim } : null;
  }
  function linePartnerTouches(n, r) {
    if (r.shape === "ROUND") {
      const e = distToSegmentSquared(r.x, r.y, n.x1, n.y1, n.x2, n.y2);
      const t = r.r + n.w / 2;
      return e <= t * t;
    }
    if (r.shape === "RECT") {
      const pad = n.w / 2 + 0.1;
      return isLineIntersectRect(n.x1, n.y1, n.x2, n.y2, { x: r.x, y: r.y, w: r.w + 2 * pad, h: r.h + 2 * pad });
    }
    return boxTouches(n, r);
  }
  function roundTouches(a, b) {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.r + b.r) ** 2;
  }
  function boxTouches(a, b) {
    return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
  }
  function polyTouches(polyA, other) {
    if (edgesCross(polyA, other)) return true;
    if (otherInsidePoly(polyA, other)) return true;
    return polyInsideOther(polyA, other);
  }
  function edgesCross(polyA, other) {
    const linesA = getEdges(polyA);
    const linesB = getEdges(other);
    for (const la of linesA) {
      for (const lb of linesB) {
        if (lineIntersect(la[0], la[1], la[2], la[3], lb[0], lb[1], lb[2], lb[3])) return true;
      }
    }
    return false;
  }
  function otherInsidePoly(polyA, other) {
    if (other.vertices) {
      for (const v of other.vertices) if (isPointInPoly(v.x, v.y, polyA.vertices)) return true;
      return false;
    }
    if (other.shape === "line") {
      if (isPointInPoly(other.x1, other.y1, polyA.vertices)) return true;
      return isPointInPoly(other.x2, other.y2, polyA.vertices);
    }
    return isPointInPoly(other.x, other.y, polyA.vertices);
  }
  function polyInsideOther(polyA, other) {
    if (other.vertices) {
      for (const v of polyA.vertices) if (isPointInPoly(v.x, v.y, other.vertices)) return true;
      return false;
    }
    if (other.shape === "RECT") {
      for (const v of polyA.vertices) if (isPointInRect(v.x, v.y, other)) return true;
    }
    return false;
  }
  function getStackIds(innerLayerIds) {
    const LAYER_TOP = 1;
    const LAYER_BOTTOM = 2;
    innerLayerIds.sort((a, b) => a - b);
    const uniqueLayers = [...new Set(innerLayerIds)];
    return [LAYER_TOP, ...uniqueLayers, LAYER_BOTTOM];
  }
  function getRealLayerIdsFromRange(rangeStr, stackIds) {
    if (!rangeStr) return null;
    const parts = String(rangeStr).split("-");
    if (parts.length !== 2) return null;
    let startIdx = parseInt(parts[0], 10);
    let endIdx = parseInt(parts[1], 10);
    if (startIdx < 1) startIdx = 1;
    if (endIdx > stackIds.length) endIdx = stackIds.length;
    const resultIds = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const realId = stackIds[i - 1];
      if (realId !== void 0) resultIds.push(realId);
    }
    return resultIds;
  }
  function addToGrid(prim, gridSize, grid) {
    let minX;
    let maxX;
    let minY;
    let maxY;
    const padding = 10;
    if (prim.shape === "line") {
      const r = prim.w / 2;
      minX = Math.min(prim.x1, prim.x2) - r;
      maxX = Math.max(prim.x1, prim.x2) + r;
      minY = Math.min(prim.y1, prim.y2) - r;
      maxY = Math.max(prim.y1, prim.y2) + r;
    } else {
      minX = prim.x - prim.w / 2;
      maxX = prim.x + prim.w / 2;
      minY = prim.y - prim.h / 2;
      maxY = prim.y + prim.h / 2;
    }
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;
    const startX = Math.floor(minX / gridSize);
    const endX = Math.floor(maxX / gridSize);
    const startY = Math.floor(minY / gridSize);
    const endY = Math.floor(maxY / gridSize);
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        const key = `${x},${y}`;
        if (!grid[key]) grid[key] = [];
        grid[key].push(prim);
      }
    }
  }

  // iframe/js/src/app/generate-net/sourceParser.js
  function polyFromShape(shapeData) {
    const data = unwrapShapeData(shapeData);
    if (!Array.isArray(data) || data.length === 0) return null;
    const rectData = rectDataOf(data);
    let vertices;
    if (rectData) {
      vertices = rectVertices(rectData);
    } else {
      vertices = getPolyVertices(data);
      if (vertices.length <= 2) return null;
    }
    if (vertices.length === 0) return null;
    return { vertices, bounds: boundsOf(vertices) };
  }
  function unwrapShapeData(shapeData) {
    let data = shapeData;
    let safeCounter = 0;
    while (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      if (data[0][0] === "R" || typeof data[0][0] === "number") break;
      data = data[0];
      if (++safeCounter > 5) break;
    }
    return data;
  }
  function rectDataOf(data) {
    if (Array.isArray(data[0]) && data[0][0] === "R") return data[0];
    if (data[0] === "R") return data;
    return null;
  }
  function rectVertices(rectData) {
    const rx = Number(rectData[1]);
    const ry = Number(rectData[2]);
    const rw = Number(rectData[3]);
    const rh = Number(rectData[4]);
    const rot = Number(rectData[5] || 0);
    const radius = Number(rectData[6] || 0);
    return getRotatedRectVertices(rx, ry, rw, rh, rot, radius);
  }
  function boundsOf(vertices) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  }
  function parseV2Primitives(lines, ctx) {
    const state = { primitives: [], innerLayerIds: [], ctx };
    for (const line of lines) {
      const item = parseV2Item(line);
      if (!item) continue;
      if (item[3] && typeof item[3] === "string" && item[3] !== "") ctx.allUsedNetNames.add(item[3]);
      applyV2Item(item, state);
    }
    return { primitives: state.primitives, innerLayerIds: state.innerLayerIds };
  }
  function parseV2Item(line) {
    if (!line.trim() || !line.startsWith("[")) return null;
    try {
      return JSON.parse(line.replace(/^\s*/, ""));
    } catch {
      logger.debug("跳过无法解析的源码行");
      return null;
    }
  }
  function applyV2Item(item, state) {
    const type = item[0];
    const handler = Object.prototype.hasOwnProperty.call(V2_HANDLERS, type) ? V2_HANDLERS[type] : null;
    if (handler) handler(item, state);
  }
  function v2Layer(item, state) {
    if (isInnerLayer(Number(item[1])) && Number(item[4]) === 3) state.innerLayerIds.push(Number(item[1]));
  }
  function v2Line(item, state) {
    state.primitives.push({
      id: item[1],
      type: "LINE",
      net: item[3],
      layer: item[4],
      shape: "line",
      x1: Number(item[5]),
      y1: Number(item[6]),
      x2: Number(item[7]),
      y2: Number(item[8]),
      w: Number(item[9])
    });
  }
  function v2Via(item, state) {
    const dia = Number(item[8]);
    state.primitives.push({
      id: item[1],
      type: "VIA",
      net: item[3],
      layer: LAYER_MULTI,
      _rawRange: item[4],
      shape: "ROUND",
      x: Number(item[5]),
      y: Number(item[6]),
      w: dia,
      h: dia,
      r: dia / 2
    });
  }
  function v2Arc(item, state) {
    state.primitives.push(
      ...expandArcLines({
        id: item[1],
        net: item[3],
        layer: item[4],
        x1: Number(item[5]),
        y1: Number(item[6]),
        x2: Number(item[7]),
        y2: Number(item[8]),
        angle: Number(item[9]),
        w: Number(item[10]) || 0.15
      })
    );
  }
  function v2FillPoly(item, state) {
    if (item[0] === "FILL" && item[4] === LAYER_MULTI) return;
    const poly = polyFromShape(item[7]);
    if (!poly) return;
    state.primitives.push({
      id: item[1],
      type: item[0],
      net: item[3],
      layer: item[4],
      shape: "POLY",
      vertices: poly.vertices,
      ...poly.bounds
    });
  }
  function v2PadNet(item, state) {
    state.ctx.padIdToPinInfo[item[1] + item[4]] = { compId: item[1], pin: item[2] };
  }
  var V2_HANDLERS = Object.freeze({
    LAYER: v2Layer,
    LINE: v2Line,
    VIA: v2Via,
    ARC: v2Arc,
    FILL: v2FillPoly,
    POLY: v2FillPoly,
    PAD_NET: v2PadNet
  });
  function parseV3LineObjects(line) {
    if (!line.trim()) return null;
    let cleanLine = line.trim();
    if (cleanLine.endsWith("|")) cleanLine = cleanLine.slice(0, -1);
    const merged = {};
    let found = false;
    for (const part of cleanLine.split("||")) {
      if (!part.trim()) continue;
      try {
        Object.assign(merged, JSON.parse(part));
        found = true;
      } catch {
        logger.debug("跳过格式异常的源码行");
      }
    }
    return found ? merged : null;
  }
  function netNameOf(item) {
    if (item.type === "PAD_NET" && item.padNet) return item.padNet;
    return item.netName || "";
  }
  function onLayer(item, state) {
    if (isInnerLayer(item.layerId) && item.use === true && !state.innerLayerIds.includes(item.layerId)) {
      state.innerLayerIds.push(item.layerId);
    }
  }
  function onAttr(item, state) {
    if (item.key === "Designator" && item.value && item.parentId) {
      state.compIdToDesignator[item.parentId] = item.value;
    }
  }
  function onComponent(item, state) {
    if (item.id && item.designator) state.compIdToDesignator[item.id] = item.designator;
  }
  function onPadNet(item, state) {
    const idRaw = item.id;
    if (typeof idRaw !== "string" || !idRaw.startsWith("[")) return;
    let idParts;
    try {
      idParts = JSON.parse(idRaw);
    } catch {
      logger.debug("跳过格式异常的源码行");
      return;
    }
    if (!Array.isArray(idParts) || idParts.length < 4) return;
    const pinInfo = { compId: idParts[1], pin: idParts[2] };
    const padSuffix = idParts[3];
    state.padIdToPinInfo[idParts[1] + padSuffix] = pinInfo;
    state.padIdToPinInfo[padSuffix] = pinInfo;
  }
  function onLine(item, state) {
    state.primitives.push({
      id: item.id,
      ticket: item.ticket,
      type: "LINE",
      net: item.netName,
      layer: item.layerId,
      shape: "line",
      x1: item.startX,
      y1: item.startY,
      x2: item.endX,
      y2: item.endY,
      w: item.width
    });
  }
  function onVia(item, state) {
    state.primitives.push({
      id: item.id,
      ticket: item.ticket,
      type: "VIA",
      net: item.netName,
      layer: LAYER_MULTI,
      _rawRange: item.ruleName,
      shape: "ROUND",
      x: item.centerX,
      y: item.centerY,
      w: item.viaDiameter,
      h: item.viaDiameter,
      r: item.viaDiameter / 2
    });
  }
  function onArc(item, state) {
    state.primitives.push(
      ...expandArcLines({
        id: item.id,
        net: item.netName,
        layer: item.layerId,
        x1: item.startX,
        y1: item.startY,
        x2: item.endX,
        y2: item.endY,
        angle: item.angle,
        w: item.width
      })
    );
  }
  function onFill(item, state, netName) {
    if (item.type === "REGION" || item.type === "POLY") return;
    if (item.type === "FILL" && item.layerId === LAYER_MULTI) return;
    const poly = polyFromShape(fillShapeData(item));
    if (!poly) return;
    state.primitives.push({
      id: item.id,
      ticket: item.ticket,
      type: "POLY",
      net: netName,
      layer: item.layerId,
      shape: "POLY",
      vertices: poly.vertices,
      ...poly.bounds
    });
  }
  function fillShapeData(item) {
    if (item.path) return item.path;
    if (item.points) return item.points;
    if (item.width && item.height && item.x !== void 0) {
      return ["R", item.x, item.y, item.width, item.height, item.rotation || 0, item.cornerRadius || 0];
    }
    return null;
  }
  var V3_HANDLERS = Object.freeze({
    ATTR: onAttr,
    COMPONENT: onComponent,
    PAD_NET: onPadNet,
    LINE: onLine,
    VIA: onVia,
    ARC: onArc,
    FILL: onFill,
    REGION: onFill,
    POLY: onFill,
    COPPER_AREA: onFill
  });
  function parseV3Primitives(lines, ctx) {
    const state = {
      primitives: [],
      innerLayerIds: [],
      compIdToDesignator: {},
      padSuffixToTicket: {},
      allUsedNetNames: ctx.allUsedNetNames,
      padIdToPinInfo: ctx.padIdToPinInfo
    };
    for (const line of lines) {
      const item = parseV3LineObjects(line);
      if (!item || item.type === "IMAGE") continue;
      if (item.type === "LAYER") {
        onLayer(item, state);
        continue;
      }
      const netName = netNameOf(item);
      if (netName) ctx.allUsedNetNames.add(netName);
      const handler = V3_HANDLERS[item.type];
      if (handler) handler(item, state, netName);
    }
    for (const padId in ctx.padIdToPinInfo) {
      const info = ctx.padIdToPinInfo[padId];
      info.des = state.compIdToDesignator[info.compId] || null;
    }
    return {
      primitives: state.primitives,
      innerLayerIds: state.innerLayerIds,
      compIdToDesignator: state.compIdToDesignator
    };
  }

  // iframe/js/src/core/unionFind.js
  var UnionFind = class {
    constructor() {
      this.parent = {};
    }
    /**
     * 找根（带路径压缩）
     *
     * @param {string} id 节点
     * @returns {string} 根节点
     * @sideEffects 就地压缩路径
     */
    find(id) {
      if (this.parent[id] === void 0) this.parent[id] = id;
      if (this.parent[id] !== id) this.parent[id] = this.find(this.parent[id]);
      return this.parent[id];
    }
    /**
     * 合并两个节点所在集合
     *
     * @param {string} id1 节点一
     * @param {string} id2 节点二
     * @returns {void}
     * @sideEffects 修改 `parent`
     */
    union(id1, id2) {
      const root1 = this.find(id1);
      const root2 = this.find(id2);
      if (root1 !== root2) this.parent[root1] = root2;
    }
  };

  // iframe/js/src/app/generate-net/connectivity.js
  function applyBlindLayers(primitives, innerLayerIds) {
    const stackIds = getStackIds(innerLayerIds);
    for (const p of primitives) {
      if (p.type === "VIA" && p._rawRange) p.blindLayers = getRealLayerIdsFromRange(p._rawRange, stackIds);
    }
  }
  function clusterByGrid(copperPrimitives) {
    const uf = new UnionFind();
    const grid = {};
    for (const p of copperPrimitives) addToGrid(p, GRID_SIZE, grid);
    const processedPairs = /* @__PURE__ */ new Set();
    for (const key in grid) {
      const cellItems = grid[key];
      if (cellItems.length < 2) continue;
      linkCellPairs(cellItems, uf, processedPairs);
    }
    const clusters = {};
    for (const p of copperPrimitives) {
      const root = uf.find(p.id);
      if (!clusters[root]) clusters[root] = [];
      clusters[root].push(p);
    }
    return clusters;
  }
  function linkCellPairs(cellItems, uf, processedPairs) {
    for (let i = 0; i < cellItems.length; i++) {
      for (let j = i + 1; j < cellItems.length; j++) {
        const a = cellItems[i];
        const b = cellItems[j];
        const pairId = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (processedPairs.has(pairId)) continue;
        processedPairs.add(pairId);
        if (checkConnectivityHighPrecision(a, b)) uf.union(a.id, b.id);
      }
    }
  }
  function attachPinInfo(group, padIdToPinInfo) {
    for (const item of group) {
      if (item.type !== "PAD") continue;
      const pinInfo = padIdToPinInfo[item.id] || findPinInfoBySuffix(String(item.id), padIdToPinInfo);
      if (pinInfo) item._pinInfo = pinInfo;
    }
  }
  function findPinInfoBySuffix(idText, padIdToPinInfo) {
    for (const key in padIdToPinInfo) {
      if (idText.endsWith(key)) return padIdToPinInfo[key];
    }
    return null;
  }
  function computeClusters(primitives, allPads, innerLayerIds, padIdToPinInfo) {
    applyBlindLayers(primitives, innerLayerIds);
    const allPrimitives = primitives.concat(allPads);
    const copperPrimitives = allPrimitives.filter((p) => isConductiveLayer(Number(p.layer)));
    const clusters = clusterByGrid(copperPrimitives);
    for (const rootId in clusters) attachPinInfo(clusters[rootId], padIdToPinInfo);
    return clusters;
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
  function getPinNet(comp, pin) {
    return getPins(comp)[pin] || "";
  }

  // iframe/js/src/app/generate-net/netNamer.js
  function isGenericNet(name) {
    return /^NET\d+$/i.test(String(name));
  }
  function voteNets(group) {
    const votes = /* @__PURE__ */ new Map();
    for (const p of group) {
      const net = p.net;
      if (!net || net === "null" || net === "undefined") continue;
      votes.set(net, (votes.get(net) || 0) + 1);
    }
    return votes;
  }
  function rankNetCandidates(votes) {
    const names = Array.from(votes.keys());
    names.sort((a, b) => {
      const wa = votes.get(a) || 0;
      const wb = votes.get(b) || 0;
      if (wa !== wb) return wb - wa;
      const aGen = isGenericNet(a);
      const bGen = isGenericNet(b);
      if (!aGen && bGen) return -1;
      if (aGen && !bGen) return 1;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });
    return names;
  }
  function createNetNamer(allUsedNetNames) {
    const used = allUsedNetNames || /* @__PURE__ */ new Set();
    let counter = 1;
    function nameFor(votes) {
      if (votes && votes.size > 0) return rankNetCandidates(votes)[0];
      for (; ; ) {
        const candidate = "NET" + counter;
        if (!used.has(candidate)) {
          used.add(candidate);
          return candidate;
        }
        counter += 1;
      }
    }
    return { nameFor };
  }

  // iframe/js/src/app/generate-net/plan.js
  function hasMultiple(group) {
    return group && group.length > 1;
  }
  function planPrimitiveOperations(clusters, allUsedNetNames) {
    const namer = createNetNamer(allUsedNetNames);
    const operations = [];
    for (const rootId of Object.keys(clusters || {})) {
      const group = clusters[rootId];
      if (!hasMultiple(group)) continue;
      const finalNetName = namer.nameFor(voteNets(group));
      for (const item of group) {
        if (item.net === finalNetName) continue;
        operations.push({
          id: item.id,
          ticket: item.ticket,
          type: item.type,
          oldNet: item.net || "—",
          newNet: finalNetName,
          status: "pending"
        });
      }
    }
    return operations;
  }
  function planNetlistOperations(clusters, allUsedNetNames, componentsContainer) {
    const namer = createNetNamer(allUsedNetNames);
    const pinsByDesignator = collectPinUpdates(clusters, namer);
    const designatorToCompId = designatorIndex(componentsContainer);
    const operations = [];
    for (const des in pinsByDesignator) {
      const compId = designatorToCompId[des];
      if (!compId) continue;
      const comp = componentsContainer[compId];
      if (!comp) continue;
      pushDesignatorOperations(operations, des, comp, pinsByDesignator[des]);
    }
    return operations;
  }
  function collectPinUpdates(clusters, namer) {
    const pinsByDesignator = {};
    for (const rootId of Object.keys(clusters || {})) {
      const group = clusters[rootId];
      if (!hasMultiple(group)) continue;
      const finalNetName = namer.nameFor(voteNets(group));
      mergeGroupUpdates(pinsByDesignator, group, finalNetName);
    }
    return pinsByDesignator;
  }
  function mergeGroupUpdates(pinsByDesignator, group, finalNetName) {
    const updates = {};
    for (const item of group) {
      if (item.type !== "PAD" || !item._pinInfo) continue;
      const pinInfo = item._pinInfo;
      if (!updates[pinInfo.des]) updates[pinInfo.des] = {};
      updates[pinInfo.des][pinInfo.pin] = finalNetName;
    }
    for (const des in updates) {
      pinsByDesignator[des] = Object.assign(pinsByDesignator[des] || {}, updates[des]);
    }
  }
  function designatorIndex(componentsContainer) {
    const designatorToCompId = {};
    for (const compId in componentsContainer || {}) {
      const comp = componentsContainer[compId];
      if (comp && comp.props && comp.props.Designator) designatorToCompId[comp.props.Designator] = compId;
    }
    return designatorToCompId;
  }
  function pushDesignatorOperations(operations, des, comp, pinUpdates) {
    for (const pin in pinUpdates) {
      const newNet = pinUpdates[pin];
      const oldNet = getPinNet(comp, pin);
      if (oldNet === newNet) continue;
      operations.push({
        des,
        pin,
        oldNet: oldNet || "—",
        newNet,
        status: "pending"
      });
    }
  }
  function applyPinUpdates(componentsContainer, pinUpdatesByDesignator) {
    let updateCount = 0;
    for (const compId in componentsContainer || {}) {
      const compData = componentsContainer[compId];
      if (!compData || !compData.props) continue;
      const des = compData.props.Designator;
      if (!des) continue;
      const pinUpdates = pinUpdatesByDesignator.get(des);
      if (!pinUpdates) continue;
      if (compData.pinInfoMap) {
        updateCount += applyToPinInfoMap(compData.pinInfoMap, pinUpdates);
        continue;
      }
      updateCount += applyToPins(compData, pinUpdates);
    }
    return updateCount;
  }
  function applyToPinInfoMap(pinInfoMap, pinUpdates) {
    let count = 0;
    for (const pinNum in pinUpdates) {
      const targetNet = pinUpdates[pinNum];
      const pinKey = String(pinNum);
      if (pinInfoMap[pinKey]) {
        if (pinInfoMap[pinKey].net !== targetNet) {
          pinInfoMap[pinKey].net = targetNet;
          count += 1;
        }
        continue;
      }
      pinInfoMap[pinKey] = { net: targetNet, number: pinKey };
      count += 1;
    }
    return count;
  }
  function applyToPins(compData, pinUpdates) {
    if (!compData.pins) compData.pins = {};
    let count = 0;
    for (const pinNum in pinUpdates) {
      const targetNet = pinUpdates[pinNum];
      const pinKey = String(pinNum);
      if (compData.pins[pinKey] !== targetNet) {
        compData.pins[pinKey] = targetNet;
        count += 1;
      }
    }
    return count;
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

  // iframe/js/src/app/generate-net/sourceRewrite.js
  function rewriteV2Line(line, netMap) {
    let item;
    try {
      item = JSON.parse(line.replace(/^\s*/, ""));
    } catch {
      return { line, changedId: null };
    }
    if (!Array.isArray(item)) return { line, changedId: null };
    if (item[0] === "PAD_NET") {
      const fullId = item[1] + item[4];
      if (!netMap.has(fullId)) return { line, changedId: null };
      item[3] = netMap.get(fullId);
      return { line: JSON.stringify(item), changedId: fullId };
    }
    const id = item[1];
    if (netMap.has(id) && item[3] !== void 0 && typeof item[3] === "string") {
      item[3] = netMap.get(id);
      return { line: JSON.stringify(item), changedId: id };
    }
    return { line, changedId: null };
  }
  function rewriteModernLine(line, netMap) {
    const parsed = splitSourceLine(line);
    if (!parsed) return { line, changedId: null };
    const leftObj = parsed.leftObj;
    const rightObj = parsed.rightObj;
    let changedId = null;
    if (leftObj.type === "PAD_NET") {
      changedId = modernPadNetId(leftObj.id, netMap);
      if (changedId) rightObj.padNet = netMap.get(changedId);
    } else if (leftObj.id && netMap.has(leftObj.id)) {
      changedId = leftObj.id;
      rightObj.netName = netMap.get(changedId);
    }
    if (!changedId) return { line, changedId: null };
    return { line: joinSourceLine(parsed.leftStr, JSON.stringify(rightObj), parsed.hasTrailingPipe), changedId };
  }
  function modernPadNetId(idRaw, netMap) {
    if (typeof idRaw !== "string" || !idRaw.startsWith("[")) return null;
    let idParts;
    try {
      idParts = JSON.parse(idRaw);
    } catch {
      logger.debug("跳过无法解析的 PAD_NET 行");
      return null;
    }
    if (!Array.isArray(idParts) || idParts.length < 4) return null;
    const realId = idParts[1] + idParts[3];
    return netMap.has(realId) ? realId : null;
  }
  function createLineRewriter(netMap, v2Mode) {
    return (line) => {
      if (!line || !line.trim()) return { line, changedId: null };
      return v2Mode ? rewriteV2Line(line, netMap) : rewriteModernLine(line, netMap);
    };
  }

  // iframe/js/src/app/generate-net/apiWriter.js
  var WRITER_MAP = Object.freeze({
    VIA: "pcb_PrimitiveVia",
    LINE: "pcb_PrimitiveLine",
    ARC: "pcb_PrimitiveArc",
    FILL: "pcb_PrimitiveFill",
    POLY: "pcb_PrimitivePolyline",
    POUR: "pcb_PrimitivePour",
    REGION: "pcb_PrimitiveFill",
    COPPER_AREA: "pcb_PrimitivePour"
  });
  async function writeNetByApi(host, op) {
    if (op.type === "PAD") return false;
    const apiName = WRITER_MAP[op.type];
    if (!apiName || typeof host[apiName]?.modify !== "function") return false;
    try {
      await host[apiName].modify(op.id, { net: op.newNet });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  // iframe/js/src/app/generate-net/index.js
  var g_pendingOperations = [];
  var g_isAnalyzing = false;
  var g_isExecuting = false;
  var g_currentMethod = "netlist";
  var g_netlistOps = [];
  var g_sourceOps = [];
  var loadingTimeout = null;
  var netlistData = null;
  var rawSource = null;
  var writeTimer = null;
  var statusBar = createStatusBar({
    textEl: document.getElementById("status-left"),
    barEl: document.getElementById("progress-bar"),
    // #status-left 没有类名；#progress-bar 的 `gn-progress-fill` 必须保住（createStatusBar 会覆写 className）
    baseClass: "",
    barBaseClass: "gn-progress-fill"
  });
  function setRightText(text) {
    const rightTxt = document.getElementById("status-right");
    if (rightTxt) rightTxt.innerText = text;
  }
  function updateFooterStatus(current, total, message = null) {
    if (total === 0) {
      statusBar.width(0, "");
      statusBar.text(message || "就绪");
      setRightText("-- / --");
      return;
    }
    const percentage = Math.min(100, Math.round(current / total * 100));
    statusBar.width(percentage, "");
    if (current === 0) statusBar.text(message || `发现 ${total} 个待更新项`);
    else if (current === total) statusBar.text(message || "执行完毕");
    else statusBar.text(message || `执行中 ${percentage}%`);
    setRightText(`${current} / ${total}`);
  }
  function yieldToUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  function updateButtonState() {
    const execBtn = document.getElementById("btn-execute");
    const refreshBtn = document.getElementById("btn-refresh");
    if (!execBtn || !refreshBtn) return;
    execBtn.disabled = g_isAnalyzing || g_isExecuting || g_pendingOperations.length === 0;
    refreshBtn.disabled = g_isAnalyzing || g_isExecuting;
  }
  function setLoading(isLoading, text) {
    const mask = document.getElementById("loading-mask");
    const loadText = document.getElementById("loading-text");
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = null;
    }
    if (!isLoading) {
      mask.style.display = "none";
      updateButtonState();
      return;
    }
    mask.style.display = "flex";
    loadText.innerText = text;
    document.getElementById("btn-execute").disabled = true;
    document.getElementById("btn-refresh").disabled = true;
    if (text === "分析物理拓扑中…") {
      loadingTimeout = setTimeout(() => {
        if (mask.style.display === "flex" && loadText.innerText === "分析物理拓扑中…") {
          loadText.innerText = "计算时间比以往要久，建议重新打开工程重试";
        }
        loadingTimeout = null;
      }, 2e4);
    }
  }
  function startWriteProgress() {
    if (writeTimer) clearInterval(writeTimer);
    let progress = 80;
    writeTimer = setInterval(() => {
      if (progress >= 99) return;
      progress += 1;
      statusBar.width(progress, "");
      statusBar.text(`写入中 ${progress}%`);
    }, 1e3);
  }
  function stopWriteProgress(success = true) {
    if (writeTimer) {
      clearInterval(writeTimer);
      writeTimer = null;
    }
    statusBar.width(success ? 100 : 0, "");
    statusBar.text(success ? "写入完成" : "写入失败");
  }
  function currentOps() {
    return g_currentMethod === "netlist" ? g_netlistOps : g_sourceOps;
  }
  function rerenderTable() {
    renderTable(currentOps());
  }
  function renderTable(ops) {
    const container = document.getElementById("result-list");
    const header = document.getElementById("grid-header");
    g_currentMethod = document.getElementById("method-select").value;
    header.innerHTML = g_currentMethod === "netlist" ? "<div>位号</div><div>编号</div><div>旧网络</div><div>新网络</div><div>状态</div>" : "<div>图元ID</div><div>类型</div><div>旧网络</div><div>新网络</div><div>状态</div>";
    container.innerHTML = "";
    if (!ops || ops.length === 0) {
      container.innerHTML = `
				<div class="empty-state">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
						<polyline points="22 4 12 14.01 9 11.01"></polyline>
					</svg>
					<div>请点击“计算拓扑”按钮生成待更新项</div>
				</div>`;
      g_pendingOperations = [];
      updateFooterStatus(0, 0);
      updateButtonState();
      return;
    }
    g_pendingOperations = ops;
    ops.forEach((op, index) => {
      const row = document.createElement("div");
      row.className = "row-item grid-row-layout";
      row.id = `row-${index}`;
      row.innerHTML = rowHtml(g_currentMethod, op, index);
      container.appendChild(row);
    });
    updateFooterStatus(0, ops.length);
    updateButtonState();
  }
  function rowHtml(method, op, index) {
    const firstCells = method === "netlist" ? `<div class="cell-truncate" title="${op.des}">${op.des}</div>
					<div class="cell-truncate">${op.pin}</div>` : `<div class="cell-truncate" title="${op.id}">${op.id}</div>
					<div class="cell-truncate">${op.type}</div>`;
    return `${firstCells}
					<div class="cell-truncate" title="${op.oldNet}">${op.oldNet}</div>
					<div class="cell-truncate new-net" title="${op.newNet}">${op.newNet}</div>
					<div><span class="st-pending" id="status-${index}">待处理</span></div>`;
  }
  function markAllDone(total) {
    for (let i = 0; i < total; i++) {
      const span = document.getElementById(`status-${i}`);
      if (span) {
        span.innerText = "完成";
        span.className = "st-done";
      }
      const rowDiv = document.getElementById(`row-${i}`);
      if (rowDiv) rowDiv.classList.add("active");
    }
  }
  async function readSource() {
    rawSource = await eda.sys_FileManager.getDocumentSource();
    return rawSource;
  }
  async function analyzePcb() {
    const allPads = await readAllPads(eda);
    const allUsedNetNames = /* @__PURE__ */ new Set();
    for (const p of allPads) if (p.net) allUsedNetNames.add(p.net);
    const padIdToPinInfo = {};
    const lines = rawSource.split("\n");
    const parseResult = isModern() ? parseV3Primitives(lines, { allUsedNetNames, padIdToPinInfo }) : parseV2Primitives(lines, { allUsedNetNames, padIdToPinInfo });
    const clusters = computeClusters(parseResult.primitives, allPads, parseResult.innerLayerIds, padIdToPinInfo);
    return { clusters, allUsedNetNames };
  }
  async function computeTopology() {
    if (g_isExecuting || g_isAnalyzing) return;
    g_isAnalyzing = true;
    setLoading(true, "分析物理拓扑中…");
    const method = document.getElementById("method-select").value;
    try {
      g_netlistOps = [];
      g_sourceOps = [];
      updateFooterStatus(0, 0, "获取版本号");
      getEditorVersion();
      updateFooterStatus(0, 0, "获取源码");
      await readSource();
      if (method === "netlist") {
        updateFooterStatus(0, 0, "获取网表");
        netlistData = await fetchNetlist();
        const { clusters, allUsedNetNames } = await analyzePcb();
        const container = getComponentsContainer(netlistData || {});
        g_netlistOps = planNetlistOperations(clusters, allUsedNetNames, container);
      } else {
        const { clusters, allUsedNetNames } = await analyzePcb();
        g_sourceOps = planPrimitiveOperations(clusters, allUsedNetNames);
      }
    } catch (e) {
      console.error(e);
    }
    rerenderTable();
    setLoading(false);
    g_isAnalyzing = false;
    updateButtonState();
  }
  async function fetchNetlist() {
    try {
      updateFooterStatus(0, 0, "获取网表");
      return (await getNetlist("PCB")).json;
    } catch (e) {
      console.error("获取网表失败", e);
      return null;
    }
  }
  async function writeNetlist(total, startTime) {
    setLoading(true, "正在写入网表...");
    const netlistJson = typeof netlistData === "string" ? JSON.parse(netlistData) : netlistData;
    const compSource = getComponentsContainer(netlistJson);
    const pinUpdatesByDesignator = /* @__PURE__ */ new Map();
    for (const op of g_pendingOperations) {
      if (!pinUpdatesByDesignator.has(op.des)) pinUpdatesByDesignator.set(op.des, {});
      pinUpdatesByDesignator.get(op.des)[op.pin] = op.newNet;
    }
    applyPinUpdates(compSource, pinUpdatesByDesignator);
    markAllDone(total);
    statusBar.width(80, "");
    statusBar.text("修改完成");
    setRightText(`${total} / ${total}`);
    startWriteProgress();
    const duration = ((Date.now() - startTime) / 1e3).toFixed(2);
    const startTimeApi = Date.now();
    await setNetlist("PCB", JSON.stringify(netlistJson));
    stopWriteProgress(true);
    const durationApi = ((Date.now() - startTimeApi) / 1e3).toFixed(2);
    updateFooterStatus(total, total, `写入完成，修改耗时 ${duration} 秒，写入耗时 ${durationApi} 秒`);
  }
  async function writeSource(total, startTime) {
    setLoading(true, "正在修改源码...");
    const netMap = /* @__PURE__ */ new Map();
    for (const op of g_pendingOperations) netMap.set(op.id, op.newNet);
    const rewrite = createLineRewriter(netMap, isV2());
    const lines = (rawSource || "").split("\n");
    const out = [];
    let modifiedCount = 0;
    let lastPercent = -1;
    for (const line of lines) {
      const result = rewrite(line);
      out.push(result.line);
      if (!result.changedId) continue;
      modifiedCount += 1;
      const currentPercent = modifiedCount / total * 80;
      const bucket = Math.floor(currentPercent / 10) * 10;
      if (bucket <= lastPercent) continue;
      lastPercent = bucket;
      const percentStr = currentPercent.toFixed(1);
      statusBar.width(Number(percentStr), "");
      statusBar.text(`修改中 ${percentStr}%`);
      setRightText(`${modifiedCount} / ${total}`);
      await yieldToUi();
    }
    statusBar.width(80, "");
    statusBar.text("修改完成，写入源码中...");
    setLoading(true, "正在写入源码...");
    startWriteProgress();
    const duration = ((Date.now() - startTime) / 1e3).toFixed(2);
    const startTimeApi = Date.now();
    await eda.sys_FileManager.setDocumentSource(out.join("\n"));
    stopWriteProgress(true);
    const durationApi = ((Date.now() - startTimeApi) / 1e3).toFixed(2);
    updateFooterStatus(total, total, `写入完成，修改耗时 ${duration}秒，写入耗时 ${durationApi}秒`);
    markAllDone(total);
  }
  async function writeByApi(total, startTime) {
    const BATCH_SIZE = 192;
    for (let i = 0; i < total; i++) {
      const op = g_pendingOperations[i];
      const success = await writeNetByApi(eda, op);
      markRowResult(i, success);
      const percent = ((i + 1) / total * 100).toFixed(1);
      statusBar.width(Number(percent), "");
      statusBar.text(`修改中 ${percent}%`);
      setRightText(`${i + 1} / ${total}`);
      const rowDiv = document.getElementById(`row-${i}`);
      if (rowDiv) rowDiv.scrollIntoView({ block: "center" });
      if (i > 0) {
        const prev = document.getElementById(`row-${i - 1}`);
        if (prev) prev.classList.remove("active");
      }
      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < total) await yieldToUi();
    }
    const duration = ((Date.now() - startTime) / 1e3).toFixed(2);
    updateFooterStatus(total, total, `API更新完成，耗时 ${duration}秒，修改焊盘API存在Bug，待官方修复后启用`);
  }
  function markRowResult(index, success) {
    const span = document.getElementById(`status-${index}`);
    const rowDiv = document.getElementById(`row-${index}`);
    if (span) {
      span.innerText = success ? "完成" : "错误";
      span.className = success ? "st-done" : "st-err";
    }
    if (rowDiv) rowDiv.classList.add("active");
  }
  async function writeChanges() {
    if (g_isAnalyzing || g_pendingOperations.length === 0 || g_isExecuting) return;
    g_isExecuting = true;
    updateButtonState();
    const total = g_pendingOperations.length;
    const startTime = Date.now();
    try {
      if (g_currentMethod === "netlist") await writeNetlist(total, startTime);
      else if (g_currentMethod === "source") await writeSource(total, startTime);
      else await writeByApi(total, startTime);
    } catch (e) {
      console.error(e);
      stopWriteProgress(false);
      updateFooterStatus(0, total, `${g_currentMethod === "api" ? "API" : "源码"}写入失败`);
    } finally {
      setLoading(false);
    }
    g_isExecuting = false;
    updateButtonState();
    const lastRow = document.getElementById(`row-${total - 1}`);
    if (lastRow) lastRow.classList.remove("active");
  }
  window.onload = async function() {
    document.getElementById("btn-refresh").addEventListener("click", computeTopology);
    document.getElementById("btn-execute").addEventListener("click", writeChanges);
    document.getElementById("method-select").addEventListener("change", () => {
      const method = document.getElementById("method-select").value;
      const warningSpan = document.getElementById("api-warning");
      warningSpan.style.display = method === "api" ? "inline" : "none";
      g_netlistOps = [];
      g_sourceOps = [];
      g_pendingOperations = [];
      renderTable([]);
      updateFooterStatus(0, 0);
      updateButtonState();
    });
    renderTable([]);
  };
})();
