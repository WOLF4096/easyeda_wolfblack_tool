/**
 * @//module/ app/pcb-to-sch/symbolParser
 * @//description/ 解析 `.esym` 符号源码，按部件（PART）取出引脚坐标与包围盒（纯函数）
 * @//exports/ parseSymbolSource, PIN_MARGIN, DEFAULT_BBOX
 * @//dependencies/ 无
 * @//example/ const { parseSymbolSource } = await import('./symbolParser.js')
 *            const parts = parseSymbolSource(esymText)
 *            parts[0].pins['1'] // { x, y, angle, name }
 *
 * 一个符号文件可以有多个 PART（多部件器件），每个 PART 内的 PIN 行先记到 `pinById`，
 * 再用 ATTR 行补 `NUMBER` / `NAME`，最后按 NUMBER 归并成 `pins[引脚号]`。
 * 包围盒由引脚坐标外扩 `PIN_MARGIN` 得到，用于原理图的自动排布。
 */

/** 引脚包围盒相对引脚坐标的外扩量（mil） */
export const PIN_MARGIN = 40;

/** 符号里一个引脚都没有时使用的兜底包围盒 */
export const DEFAULT_BBOX = Object.freeze([-20, -20, 20, 20]);

/**
 * 汇总一个部件的引脚表与包围盒
 *
 * 只统计**有引脚号**的引脚（没有 NUMBER 的 PIN 是装饰用的）。
 *
 * @param {object} part 部件（`{ name, pins }`）
 * @param {Record<string, object>} pinById 引脚 id → 引脚
 * @returns {object} 补齐了 `pins` 与 `pinBbox` 的部件
 * @sideEffects 无（纯函数）
 */
function finishPart(part, pinById) {
	const pinsByNumber = {};
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let hasPin = false;

	for (const pinId in pinById) {
		const pin = pinById[pinId];
		if (!pin.number) continue;
		pinsByNumber[pin.number] = { x: pin.x, y: pin.y, angle: pin.angle, name: pin.name };
		minX = Math.min(minX, pin.x);
		maxX = Math.max(maxX, pin.x);
		minY = Math.min(minY, pin.y);
		maxY = Math.max(maxY, pin.y);
		hasPin = true;
	}

	part.pins = pinsByNumber;
	part.pinBbox = hasPin
		? [minX - PIN_MARGIN, minY - PIN_MARGIN, maxX + PIN_MARGIN, maxY + PIN_MARGIN]
		: DEFAULT_BBOX.slice();
	return part;
}

/**
 * 解析符号源码
 *
 * @param {string} content `.esym` 文本
 * @returns {Array<object>} 部件数组，每项 `{ name, pins, pinBbox }`
 * @sideEffects 无（纯函数）
 */
export function parseSymbolSource(content) {
	const parts = [];
	let currentPart = null;
	let pinById = {};

	for (const line of String(content || '').split('\n')) {
		if (!line.trim()) continue;
		let data;
		try {
			data = JSON.parse(line);
		} catch {
			continue; // 忽略解析错误的行
		}
		if (!Array.isArray(data)) continue;

		const type = data[0];

		if (type === 'PART') {
			if (currentPart) parts.push(finishPart(currentPart, pinById));
			currentPart = { name: data[1], pins: {} };
			pinById = {};
			continue;
		}

		if (!currentPart) continue;

		if (type === 'PIN') {
			pinById[data[1]] = {
				id: data[1],
				type: data[2],
				x: data[4],
				y: data[5],
				length: data[6],
				angle: data[7],
				number: null,
				name: null,
			};
		} else if (type === 'ATTR') {
			// ATTR 形如 ["ATTR", attrId, parentId, 名称, 值, ...]
			const parent = pinById[data[2]];
			if (!parent) continue;
			if (data[3] === 'NUMBER') parent.number = data[4];
			else if (data[3] === 'NAME') parent.name = data[4];
		}
	}

	if (currentPart) parts.push(finishPart(currentPart, pinById));
	return parts;
}
