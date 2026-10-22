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

  // iframe/js/src/ui/poll.js
  function sameIds(a, b) {
    const listA = Array.isArray(a) ? a : [];
    const listB = Array.isArray(b) ? b : [];
    if (listA.length !== listB.length) return false;
    const ids = new Set(listA.map(idOf));
    for (const item of listB) {
      if (!ids.has(idOf(item))) return false;
    }
    return true;
  }
  function idOf(item) {
    if (item === null || item === void 0) return "";
    if (typeof item === "object") return item.id ?? item.primitiveId ?? "";
    return item;
  }
  function createPoll(options = {}) {
    const fetchItems = options.fetchItems;
    const onItems = options.onItems;
    const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 200;
    const isEqual = typeof options.isEqual === "function" ? options.isEqual : sameIds;
    const skipWhenHidden = options.skipWhenHidden !== false;
    const doc = options.doc || globalThis.document || null;
    const timers = options.timers || {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (handle2) => globalThis.clearInterval(handle2)
    };
    let handle = null;
    let busy = false;
    let last = null;
    let stopped = false;
    function shouldSkip() {
      if (busy || stopped) return true;
      if (skipWhenHidden && doc && doc.hidden) return true;
      return typeof fetchItems !== "function";
    }
    function applyItems(items) {
      if (stopped) return false;
      if (last !== null && isEqual(items, last)) return false;
      last = items;
      if (typeof onItems === "function") onItems(items);
      return true;
    }
    async function tick() {
      if (shouldSkip()) return false;
      busy = true;
      try {
        const items = await fetchItems();
        return applyItems(items);
      } catch (e) {
        return false;
      } finally {
        busy = false;
      }
    }
    function start() {
      if (handle !== null) return;
      stopped = false;
      handle = timers.setInterval(() => {
        void tick();
      }, intervalMs);
    }
    function stop() {
      stopped = true;
      if (handle === null) return;
      timers.clearInterval(handle);
      handle = null;
    }
    function running() {
      return handle !== null;
    }
    return { start, stop, running, tick };
  }

  // iframe/js/src/app/pin-sorting/sortKey.js
  function normalizeRotation(rotation) {
    const deg = ((Number(rotation) || 0) % 360 + 360) % 360;
    return deg === 90 || deg === 270 ? 270 : 180;
  }
  function createTransformKey(useSplitSort) {
    return (key) => {
      const text = String(key === null || key === void 0 ? "" : key);
      if (!useSplitSort) return text.split("").reverse().join("");
      const chunks = text.match(/\d+|\D+/g);
      return chunks ? chunks.reverse().join("") : text;
    };
  }
  function createComparator(options) {
    const prop = options.prop;
    const endSort = options.endSort;
    const splitSort = options.splitSort;
    const order = options.order;
    const transformKey = createTransformKey(splitSort);
    const collator = new Intl.Collator(void 0, { numeric: splitSort, sensitivity: "base" });
    return (a, b) => {
      const rawA = (a[prop] || "").toString();
      const rawB = (b[prop] || "").toString();
      const valA = endSort ? transformKey(rawA) : rawA;
      const valB = endSort ? transformKey(rawB) : rawB;
      const result = splitSort ? collator.compare(valA, valB) : valA.localeCompare(valB);
      return order === "asc" ? result : -result;
    };
  }
  function planLayout(pins, options) {
    const list = Array.isArray(pins) ? pins.slice() : [];
    if (list.length === 0) return { sorted: [], targets: [], baseRotation: 180, vertical: true };
    const spacing = Number(options.spacing);
    const step = Number.isFinite(spacing) && spacing !== 0 ? spacing : 10;
    list.sort(createComparator({ prop: options.prop, endSort: options.endSort, splitSort: options.splitSort, order: options.order }));
    let minX = Infinity;
    let maxY = -Infinity;
    for (const pin of list) {
      if (pin.x < minX) minX = pin.x;
      if (pin.y > maxY) maxY = pin.y;
    }
    const baseRotation = normalizeRotation(list[0].rotation);
    const vertical = baseRotation % 180 === 0;
    const targets = list.map((pin, index) => ({
      x: vertical ? minX : minX + index * step,
      y: vertical ? maxY - index * step : maxY,
      rotation: baseRotation
    }));
    return { sorted: list, targets, baseRotation, vertical };
  }

  // iframe/js/src/app/pin-sorting/index.js
  var selectedPins = [];
  var countEl = document.getElementById("pin-count");
  function readOptions() {
    const checked = document.querySelector('input[name="sortTarget"]:checked');
    return {
      prop: checked && checked.value ? checked.value : "name",
      spacing: parseFloat(document.getElementById("spacing").value) || 10,
      splitSort: document.getElementById("splitSort").checked,
      endSort: document.getElementById("endSort").checked
    };
  }
  async function applySort(order) {
    if (selectedPins.length === 0) return;
    const host = getEda();
    if (!host || !host.sch_PrimitivePin) return;
    const options = readOptions();
    const plan = planLayout(selectedPins, { ...options, order });
    for (let i = 0; i < plan.sorted.length; i++) {
      const pin = plan.sorted[i];
      const target = plan.targets[i];
      if (pin.x === target.x && pin.y === target.y && pin.rotation === target.rotation) continue;
      const modifyProperty = { ...pin, x: target.x, y: target.y, rotation: target.rotation };
      try {
        await host.sch_PrimitivePin.modify(pin.primitiveId, modifyProperty);
      } catch (error) {
        console.error(`更新引脚 ${pin.primitiveId} 失败:`, error);
      }
    }
  }
  var poll = createPoll({
    intervalMs: 200,
    fetchItems: async () => {
      const host = getEda();
      if (!host || !host.sch_SelectControl) return [];
      const primitives = await host.sch_SelectControl.getAllSelectedPrimitives();
      return primitives.filter((item) => item.primitiveType === "Pin");
    },
    onItems: (pins) => {
      selectedPins = pins;
      if (countEl) countEl.innerText = String(pins.length);
    },
    isEqual: (a, b) => {
      if (a.length !== b.length) return false;
      const ids = new Set(a.map((p) => p.primitiveId));
      return b.every((p) => ids.has(p.primitiveId));
    }
  });
  document.getElementById("btn-asc").addEventListener("click", () => applySort("asc"));
  document.getElementById("btn-desc").addEventListener("click", () => applySort("desc"));
  window.addEventListener("pagehide", () => poll.stop());
  poll.start();
})();
