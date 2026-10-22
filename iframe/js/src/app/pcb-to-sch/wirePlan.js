/**
 * @//module/ app/pcb-to-sch/wirePlan
 * @//description/ 按引脚朝向生成器件引脚的导线（源码行由 sch/emitter 发射）
 * @//exports/ planWires
 * @//dependencies/ sch/emitter
 * @//example/ const { planWires } = await import('./wirePlan.js')
 *            const rows = planWires({ comp, partIdx: 0, compX: 200, compY: -200, wireLength: 40,
 *              symbolDb, isV2: false, nextId: () => counter++ })
 *
 * 引脚朝向（`angle`）决定导线往哪边拉：0 朝左、90 朝上、180 朝右、270 朝下。
 * V2 与 V3/V4 的引脚 Y 方向相反（V2 向上为正、V3+ 向下为正），所以 `y` 取 ±1 参与计算。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { createSchWireLines } from '../../sch/emitter.js';

/**
 * 引脚朝向 → 导线终点
 *
 * 参数说明：`pinX`/`pinY` 为引脚绝对坐标，`len` 导线长度，`y` 为 Y 轴方向（V2 是 +1、V3/V4 是 -1）。
 * 未知朝向按「朝左」处理（与原实现一致）。
 *
 * @type {Readonly<Record<number, (pinX: number, pinY: number, len: number, y: number) => {endX: number, endY: number, netT: number}>>}
 */
const WIRE_END = Object.freeze({
	0: (pinX, pinY, len) => ({ endX: pinX - len, endY: pinY, netT: 0 }),
	90: (pinX, pinY, len, y) => ({ endX: pinX, endY: pinY - len * y, netT: 90 }),
	180: (pinX, pinY, len) => ({ endX: pinX + len, endY: pinY, netT: 0 }),
	270: (pinX, pinY, len, y) => ({ endX: pinX, endY: pinY + len * y, netT: 90 }),
});

/**
 * 生成一个部件上所有「有网络」引脚的导线
 *
 * @param {object} input 参数对象
 * @param {object} input.comp 器件（需含 `symbolUuid` 与 `pins`）
 * @param {number} input.partIdx 部件序号
 * @param {number} input.compX 器件放置 X
 * @param {number} input.compY 器件放置 Y（已按「Y 翻转」处理过）
 * @param {number} input.wireLength 导线长度（mil）
 * @param {Record<string, Array<object>>} input.symbolDb 符号引脚库
 * @param {boolean} input.isV2 是否 V2 格式（决定 Y 方向与行格式）
 * @param {() => number} input.nextId 取下一个 id（该页面 id 与 ticket 共用一个计数器）
 * @returns {string[]} 源码行
 * @sideEffects 调用 `nextId()`（推进调用方的计数器）
 */
export function planWires(input) {
	const parts = input.symbolDb[input.comp.symbolUuid] || [];
	const part = parts[input.partIdx] || parts[0] || { pins: {} };
	const symbolPins = part.pins || {};
	const yDir = input.isV2 ? 1 : -1;
	const lines = [];

	const nextRow = () => {
		const n = input.nextId();
		return { id: n, ticket: n };
	};

	for (const entry of Object.entries(input.comp.pins || {})) {
		pushWireForPin(lines, input, symbolPins, entry, yDir, nextRow);
	}

	return lines;
}

/**
 * 为一个引脚追加导线行（就地追加到 `lines`）
 *
 * @param {string[]} lines 已生成的源码行
 * @param {object} input `planWires` 的入参
 * @param {Record<string, object>} symbolPins 符号里的引脚表
 * @param {Array} entry `[引脚号, 网络名]`
 * @param {number} yDir Y 轴方向
 * @param {() => {id: number, ticket: number}} nextRow 取下一行 id
 * @returns {void}
 * @sideEffects 追加 `lines`、调用 `nextRow()`
 */
function pushWireForPin(lines, input, symbolPins, entry, yDir, nextRow) {
	const pinNumber = entry[0];
	const netName = entry[1];
	if (!netName) return;

	const pinInfo = symbolPins[pinNumber];
	if (!pinInfo) return;

	const pinX = input.compX + pinInfo.x;
	const pinY = input.isV2 ? input.compY + pinInfo.y : input.compY - pinInfo.y;
	const spread = WIRE_END[pinInfo.angle] || WIRE_END[0];
	const end = spread(pinX, pinY, input.wireLength, yDir);

	lines.push(
		...createSchWireLines({
			net: netName,
			startX: pinX,
			startY: pinY,
			endX: end.endX,
			endY: end.endY,
			rotation: end.netT,
			isModern: !input.isV2,
			nextRow: nextRow,
		})
	);
}
