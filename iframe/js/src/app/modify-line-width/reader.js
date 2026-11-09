/**
 * @//module/ app/modify-line-width/reader
 * @//description/ 读 PCB 直线/圆弧并归一成统一结构（双形态取值、弧长计算、异常图元计数）
 * @//exports/ arcLengthMil, readPrimitives
 * @//dependencies/ 无
 * @//example/ const { readPrimitives } = await import('./reader.js')
 *            const { items, skipped } = await readPrimitives(eda)
 *            items[0] // { id, kind:'line', layer:1, widthMil:10, lengthMil:310, … }
 *
 * 为什么取值要「字段 → getter」双读：官方文档示例是类实例 + `getState_LineWidth()`，
 * 而真实 `console.log` 打印出来是普通对象字段。只支持一种写法，某个客户端版本就会统计出 0 条。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/** 图元种类 → 宿主 API 名 */
const LINE_API = 'pcb_PrimitiveLine';
const ARC_API = 'pcb_PrimitiveArc';

/**
 * 取数值属性（先读普通字段，再退回 getter）
 *
 * @param {object} prim 图元对象
 * @param {string} key 字段名
 * @param {string} getterName getter 名
 * @returns {number} 数值；取不到返回 `NaN`
 * @sideEffects 无（纯函数）
 */
function readNum(prim, key, getterName) {
	const raw = prim ? prim[key] : undefined;
	if (Number.isFinite(raw)) return raw;
	const getter = prim ? prim[getterName] : undefined;
	return typeof getter === 'function' ? Number(getter.call(prim)) : NaN;
}

/**
 * 取字符串属性（先读普通字段，再退回 getter）
 *
 * @param {object} prim 图元对象
 * @param {string} key 字段名
 * @param {string} getterName getter 名
 * @returns {string} 字符串；取不到返回空串
 * @sideEffects 无（纯函数）
 */
function readStr(prim, key, getterName) {
	const raw = prim ? prim[key] : undefined;
	if (typeof raw === 'string' && raw) return raw;
	const getter = prim ? prim[getterName] : undefined;
	const value = typeof getter === 'function' ? getter.call(prim) : null;
	return typeof value === 'string' ? value : '';
}

/**
 * 取布尔属性（先读普通字段，再退回 getter）
 *
 * @param {object} prim 图元对象
 * @param {string} key 字段名
 * @param {string} getterName getter 名
 * @returns {boolean} 布尔值；取不到返回 false
 * @sideEffects 无（纯函数）
 */
function readBool(prim, key, getterName) {
	const raw = prim ? prim[key] : undefined;
	if (typeof raw === 'boolean') return raw;
	const getter = prim ? prim[getterName] : undefined;
	return typeof getter === 'function' ? !!getter.call(prim) : false;
}

/**
 * 圆弧长度（沿弧量，不是弦长）
 *
 * 由弦长与圆心角反推半径：`R = chord / (2·sin(θ/2))`，弧长 `= R·θ`。
 * 90° 时结果约为弦长的 1.1107 倍；只用弦长会少算 10%。
 * 退化情况（角度缺失/为 0、弦长为 0、异常 ≥360°）一律回退成弦长。
 *
 * @param {number} x1 起点 X（mil）
 * @param {number} y1 起点 Y（mil）
 * @param {number} x2 终点 X（mil）
 * @param {number} y2 终点 Y（mil）
 * @param {number} angleDeg 圆心角（角度制，可负）
 * @returns {number} 弧长（mil）
 * @sideEffects 无（纯函数）
 */
export function arcLengthMil(x1, y1, x2, y2, angleDeg) {
	const chord = Math.hypot(Number(x2) - Number(x1), Number(y2) - Number(y1));
	if (!Number.isFinite(chord) || chord <= 1e-9) return 0;

	const sweep = (Math.abs(Number(angleDeg) || 0) * Math.PI) / 180;
	if (!(sweep > 1e-9) || sweep >= Math.PI * 2) return chord;

	const radius = chord / (2 * Math.sin(sweep / 2));
	const length = radius * sweep;
	return Number.isFinite(length) ? Math.abs(length) : chord;
}

/**
 * 归一单个图元
 *
 * @param {object} prim 宿主图元
 * @param {'line'|'arc'} kind 种类
 * @returns {object|null} 统一结构；缺 id 或坐标异常时返回 null
 * @sideEffects 无（纯函数）
 */
function normalize(prim, kind) {
	const id = readStr(prim, 'primitiveId', 'getState_PrimitiveId');
	if (!id) return null;

	const x1 = readNum(prim, 'startX', 'getState_StartX');
	const y1 = readNum(prim, 'startY', 'getState_StartY');
	const x2 = readNum(prim, 'endX', 'getState_EndX');
	const y2 = readNum(prim, 'endY', 'getState_EndY');
	if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

	const angleDeg = kind === 'arc' ? readNum(prim, 'arcAngle', 'getState_ArcAngle') : 0;
	const lengthMil = kind === 'arc' ? arcLengthMil(x1, y1, x2, y2, angleDeg) : Math.hypot(x2 - x1, y2 - y1);

	return {
		id: id,
		kind: kind,
		layer: readNum(prim, 'layer', 'getState_Layer'),
		widthMil: readNum(prim, 'lineWidth', 'getState_LineWidth'),
		x1: x1,
		y1: y1,
		x2: x2,
		y2: y2,
		angleDeg: Number.isFinite(angleDeg) ? angleDeg : 0,
		lengthMil: lengthMil,
		locked: readBool(prim, 'primitiveLock', 'getState_PrimitiveLock'),
	};
}

/**
 * 取某类图元的全部实例（API 缺失或抛错时返回空数组）
 *
 * 老客户端可能没有 `pcb_PrimitiveArc`，或某个版本 `getAll` 抛错——这半边按空处理，
 * 不能让整页统计失败。
 *
 * @param {object} host 宿主对象
 * @param {string} apiName API 名
 * @returns {Promise<Array<object>>} 图元数组
 * @sideEffects 调用宿主 API（只读）
 */
async function getAllOf(host, apiName) {
	try {
		const api = host ? host[apiName] : null;
		if (!api || typeof api.getAll !== 'function') return [];
		const list = await api.getAll();
		return Array.isArray(list) ? list : [];
	} catch (e) {
		console.error(`读取 ${apiName} 失败:`, e);
		return [];
	}
}

/**
 * 读取当前 PCB 的全部导线（直线 + 圆弧）
 *
 * @param {object} host 宿主对象（`eda`）
 * @returns {Promise<{items: Array<object>, skipped: number}>} 归一图元与跳过数
 * @sideEffects 调用宿主 API（只读）
 */
export async function readPrimitives(host) {
	const [lines, arcs] = await Promise.all([getAllOf(host, LINE_API), getAllOf(host, ARC_API)]);

	const items = [];
	let skipped = 0;

	for (const [list, kind] of [
		[lines, 'line'],
		[arcs, 'arc'],
	]) {
		for (const prim of list) {
			const item = normalize(prim, kind);
			if (!item || !Number.isFinite(item.widthMil) || item.widthMil <= 0) {
				skipped += 1;
				continue;
			}
			items.push(item);
		}
	}

	return { items: items, skipped: skipped };
}
