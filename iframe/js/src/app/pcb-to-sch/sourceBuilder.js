/**
 * @//module/ app/pcb-to-sch/sourceBuilder
 * @//description/ 把器件列表发射成原理图源码（V2 数组格式 / V3V4 日志格式两套）
 * @//exports/ classifyGroups, buildSchSource
 * @//dependencies/ app/pcb-to-sch/layout, app/pcb-to-sch/wirePlan, app/pcb-to-sch/symbolParser
 * @//example/ const { buildSchSource } = await import('./sourceBuilder.js')
 *            const src = buildSchSource({ components, symbolDb, format: 'modern',
 *              options: { classify: 'ref', startX: 200, startY: -200, genFrame: true, genWire: true } })
 *
 * ⚠️ V3/V4 的三条硬约束（写错任何一条，符号都会"凭空消失"），改动前务必读完：
 *   1. COMPONENT 行**必须带 attrs**（Footprints/Devices/DeviceName/FootprintName/pinClass/
 *      differentialPairClass/Symbols 这 7 个键）。缺了 attrs，`setDocumentSource` 仍返回 true，
 *      但器件会被静默丢弃 → 表现就是「导线都在、符号一个都没有」。
 *   2. ATTR 行**必须字段齐全**（x/y/rotation/color/.../zIndex 全写），只写 parentId/key/value
 *      会让整份源码写入直接返回 false。
 *   3. 每个器件**必须有一条 `Channel ID` 属性**（空串即可），否则同样整份拒写。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { GROUP_GAP, layoutGroup } from './layout.js';
import { planWires } from './wirePlan.js';

/** 边框/标题的内边距（mil） */
const PADDING = 120;

/**
 * 规范化选项（补齐默认值）
 *
 * @param {object} [raw] 原始选项
 * @returns {object} 规范化后的选项
 * @sideEffects 无（纯函数）
 */
function normalizeOptions(raw) {
	const o = raw || {};
	return {
		classify: o.classify || 'ref',
		genTitle: !!o.genTitle,
		genFrame: !!o.genFrame,
		genWire: !!o.genWire,
		yvalue: !!o.yvalue,
		startX: o.startX === undefined ? 100 : o.startX,
		startY: o.startY === undefined ? -200 : o.startY,
		wireLength: o.wireLength === undefined ? 40 : o.wireLength,
		colSpacing: o.colSpacing === undefined ? 150 : o.colSpacing,
		rowSpacing: o.rowSpacing === undefined ? 150 : o.rowSpacing,
		perRow: o.perRow === undefined ? 20 : o.perRow,
	};
}

/**
 * 取部件名（COMPONENT 行的 partId，形如 `R.1`）
 *
 * 符号文件缺失时 `symbolDb` 里是占位对象（没有 name），原实现会写出字面量 `undefined`，
 * 这里按 `符号名 → 'Unknown'` 兜底。
 *
 * @param {Record<string, Array<object>>} symbolDb 符号引脚库
 * @param {object} comp 器件
 * @param {number} partIdx 部件序号
 * @returns {string} 部件名
 * @sideEffects 无（纯函数）
 */
function partNameOf(symbolDb, comp, partIdx) {
	const parts = symbolDb[comp.symbolUuid];
	const part = parts && parts[partIdx];
	return (part && part.name) || comp.symbolName || 'Unknown';
}

/**
 * 生成一个合法的 JSON 字符串字面量（含引号）
 *
 * 原来是把值直接拼进模板串：器件名里有 `"` 就会生成非法源码、整份写不进去。
 *
 * @param {*} value 值
 * @returns {string} JSON 字符串字面量
 * @sideEffects 无（纯函数）
 */
function q(value) {
	return JSON.stringify(value === null || value === undefined ? '' : String(value));
}

/**
 * 按分类方式把器件分组
 *
 * @param {Array<object>} components 器件列表
 * @param {string} classify 分类方式：`ref` / `device` / `pkg` / `coord`
 * @returns {Array<{name: string, items: Array<object>}>} 分组
 * @sideEffects 无（纯函数）
 */
export function classifyGroups(components, classify) {
	const list = Array.isArray(components) ? components : [];

	if (classify === 'coord') return [{ name: '坐标布局', items: list }];

	const keyOf = classify === 'device' ? deviceKey : classify === 'pkg' ? packageKey : refKey;
	const buckets = new Map();

	for (const comp of list) {
		const key = keyOf(comp);
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push(comp);
	}

	return [...buckets.keys()].sort().map((name) => {
		const items = buckets.get(name);
		if (classify === 'ref') items.sort(byDesignatorNumber);
		return { name: name, items: items };
	});
}

/**
 * 位号分类键：取开头的字母前缀（`R1` → `R`），没有字母的归到「其他」
 *
 * @param {object} comp 器件
 * @returns {string} 分组键
 * @sideEffects 无（纯函数）
 */
function refKey(comp) {
	const match = String(comp.designator || '').match(/^([A-Za-z]+)/);
	return match ? match[1] : '其他';
}

/**
 * 器件名分类键
 *
 * @param {object} comp 器件
 * @returns {string} 分组键
 * @sideEffects 无（纯函数）
 */
function deviceKey(comp) {
	return comp.deviceName || '未知器件';
}

/**
 * 封装名分类键
 *
 * @param {object} comp 器件
 * @returns {string} 分组键
 * @sideEffects 无（纯函数）
 */
function packageKey(comp) {
	return comp.footprintName || '未知封装';
}

/**
 * 按位号里的数字升序（`C2` 在 `C10` 前）；没有数字的视为 0
 *
 * @param {object} a 器件
 * @param {object} b 器件
 * @returns {number} 比较结果
 * @sideEffects 无（纯函数）
 */
function byDesignatorNumber(a, b) {
	const numOf = (comp) => parseInt((String(comp.designator || '').match(/\d+/) || ['0'])[0], 10) || 0;
	return numOf(a) - numOf(b);
}

/** V2 头部 6 行 */
function emitHeaderV2(ctx) {
	ctx.lines.push('["DOCTYPE","SCH","1.1"]');
	ctx.lines.push('["HEAD",{"originX":0,"originY":0,"version":"2","maxId":11517}]');
	ctx.lines.push('["FONTSTYLE","st1",null,null,null,null,null,null,null,null,null,null]');
	ctx.lines.push('["FONTSTYLE","st2",null,null,null,60,null,null,null,null,1,0]');
	ctx.lines.push('["LINESTYLE","st3",null,null,null,2,null]');
	ctx.lines.push('["LINESTYLE","st4",null,null,null,null,null]');
}

/** V3/V4 头部两行（DOCHEAD + CANVAS） */
function emitHeaderModern(ctx) {
	const stamp = ctx.options.now();
	const rand = () => Math.random().toString(36).substr(2, 8);
	const client = 'client_' + stamp + '_' + rand();
	const uuid = 'uuid_' + stamp + '_' + rand();

	ctx.lines.push(`{"type":"DOCHEAD"}||{"docType":"SCH_PAGE","client":"${client}","uuid":"${uuid}","updateTime":${stamp},"version":${stamp}}|`);
	ctx.lines.push(`{"type":"CANVAS","ticket":${ctx.nextId()},"id":"CANVAS"}||{"originX":0,"originY":0}|`);
}

/**
 * V2 的一行 ATTR
 *
 * `topZero` 对应原实现里 `y` 位置写 `0`（Device/Symbol/Unique ID）还是 `null`（Designator/Name）。
 *
 * @param {object} ctx 构建上下文
 * @param {string} compId 器件 id
 * @param {string} key 属性名
 * @param {*} value 值
 * @param {boolean} topZero y 位置是否写 0
 * @returns {string} 源码行
 * @sideEffects 推进 `ctx.nextId()`
 */
function v2AttrLine(ctx, compId, key, value, topZero) {
	return `["ATTR","e${ctx.nextId()}","${compId}","${key}",${q(value)},${topZero ? 0 : 'null'},0,null,null,null,"st1",0]`;
}

/**
 * 发射一个部件（V2 格式）
 *
 * @param {object} ctx 构建上下文
 * @param {{comp: object, partIdx: number, x: number, y: number}} part 部件
 * @returns {void}
 * @sideEffects 修改 `ctx.lines`、推进计数器
 */
function emitV2Component(ctx, part) {
	const comp = part.comp;
	const compId = 'e' + ctx.nextId();
	const outY = ctx.options.yvalue ? -part.y : part.y;

	ctx.lines.push(`["COMPONENT","${compId}",${q(partNameOf(ctx.symbolDb, comp, part.partIdx))},${part.x},${outY},0,0,{},0]`);
	ctx.lines.push(v2AttrLine(ctx, compId, 'Device', comp.deviceUuid || '', true));
	ctx.lines.push(v2AttrLine(ctx, compId, 'Symbol', comp.symbolUuid || '', true));
	ctx.lines.push(v2AttrLine(ctx, compId, 'Designator', comp.designator || '', false));
	ctx.lines.push(v2AttrLine(ctx, compId, 'Name', comp.name || '', false));
	ctx.lines.push(v2AttrLine(ctx, compId, 'Unique ID', comp.uniqueId || '', true));

	if (ctx.options.genWire) ctx.lines.push(...planWires(wireInput(ctx, part, part.x, outY)));
}

/**
 * V3/V4 的 COMPONENT 行
 *
 * @param {object} ctx 构建上下文
 * @param {string} partId 部件名
 * @param {number} x 放置 X
 * @param {number} y 放置 Y
 * @returns {{id: string, line: string}} 器件 id 与源码行
 * @sideEffects 推进计数器
 */
function modernComponentLine(ctx, partId, x, y) {
	const ticket = ctx.nextId();
	const body = {
		partId: partId,
		x: x,
		y: y,
		rotation: 0,
		isMirror: false,
		attrs: {
			Footprints: '[]',
			Devices: '[]',
			DeviceName: null,
			FootprintName: null,
			pinClass: {},
			differentialPairClass: {},
			Symbols: '[]',
		},
		zIndex: ticket,
	};
	return { id: 'e' + ticket, line: `{"type":"COMPONENT","ticket":${ticket},"id":"e${ticket}"}||${JSON.stringify(body)}|` };
}

/**
 * V3/V4 的 ATTR 行（字段必须齐全，见文件头约束 2）
 *
 * @param {object} ctx 构建上下文
 * @param {string} parentId 父图元 id
 * @param {string} key 属性名
 * @param {*} value 值
 * @param {object} [extra] 额外字段（rotation / keyVisible / valueVisible）
 * @returns {string} 源码行
 * @sideEffects 推进计数器
 */
function modernAttrLine(ctx, parentId, key, value, extra) {
	const e = extra || {};
	const ticket = ctx.nextId();
	const body = {
		x: e.x === undefined ? null : e.x,
		y: e.y === undefined ? null : e.y,
		rotation: e.rotation === undefined ? null : e.rotation,
		color: null,
		fontFamily: null,
		fontSize: null,
		fontWeight: null,
		italic: null,
		underline: null,
		align: null,
		value: value === undefined ? null : value,
		keyVisible: e.keyVisible === undefined ? null : e.keyVisible,
		valueVisible: e.valueVisible === undefined ? null : e.valueVisible,
		key: key,
		fillColor: null,
		parentId: parentId,
		zIndex: ticket,
	};
	return `{"type":"ATTR","ticket":${ticket},"id":"e${ticket}"}||${JSON.stringify(body)}|`;
}

/**
 * 发射一个部件（V3/V4 格式）
 *
 * 属性顺序与 EDA 自己写盘的顺序一致：Device / Symbol / Unique ID / Designator / Name /
 * Channel ID / Group ID / Reuse Block（`Channel ID` 缺失会导致整份源码被拒写）。
 *
 * @param {object} ctx 构建上下文
 * @param {{comp: object, partIdx: number, x: number, y: number}} part 部件
 * @returns {void}
 * @sideEffects 修改 `ctx.lines`、推进计数器
 */
function emitModernComponent(ctx, part) {
	const comp = part.comp;
	const outY = ctx.options.yvalue ? -part.y : part.y;
	const compLine = modernComponentLine(ctx, partNameOf(ctx.symbolDb, comp, part.partIdx), part.x, outY);
	const compId = compLine.id;
	const lines = ctx.lines;

	lines.push(compLine.line);
	lines.push(modernAttrLine(ctx, compId, 'Device', comp.deviceUuid || ''));
	lines.push(modernAttrLine(ctx, compId, 'Symbol', comp.symbolUuid || ''));
	lines.push(modernAttrLine(ctx, compId, 'Unique ID', comp.uniqueId || ''));
	lines.push(modernAttrLine(ctx, compId, 'Designator', comp.designator || '', { rotation: 0, keyVisible: false, valueVisible: true }));
	lines.push(modernAttrLine(ctx, compId, 'Name', comp.name || '', { rotation: 0, keyVisible: false, valueVisible: true }));
	lines.push(modernAttrLine(ctx, compId, 'Channel ID', ''));
	lines.push(modernAttrLine(ctx, compId, 'Group ID', ''));
	lines.push(modernAttrLine(ctx, compId, 'Reuse Block', ''));

	if (ctx.options.genWire) lines.push(...planWires(wireInput(ctx, part, part.x, outY)));
}

/**
 * 组装 `planWires` 的入参
 *
 * @param {object} ctx 构建上下文
 * @param {object} part 部件
 * @param {number} compX 放置 X
 * @param {number} compY 放置 Y
 * @returns {object} planWires 入参
 * @sideEffects 无（纯函数）
 */
function wireInput(ctx, part, compX, compY) {
	return {
		comp: part.comp,
		partIdx: part.partIdx,
		compX: compX,
		compY: compY,
		wireLength: ctx.options.wireLength,
		symbolDb: ctx.symbolDb,
		isV2: ctx.isV2,
		nextId: ctx.nextId,
	};
}

/**
 * 发射分组标题（仅当勾选「生成框线」且本组有坐标时）
 *
 * @param {object} ctx 构建上下文
 * @param {{name: string}} group 分组
 * @param {object} bounds 本组包围盒
 * @returns {void}
 * @sideEffects 修改 `ctx.lines`、推进计数器
 */
function emitFrame(ctx, group, bounds) {
	if (!ctx.options.genFrame || bounds.minX === Infinity) return;

	const flip = ctx.options.yvalue;
	const x = bounds.minX - PADDING + 10;

	if (ctx.isV2) {
		const y = flip ? -bounds.maxY - PADDING + 30 : bounds.maxY + PADDING - 30;
		ctx.lines.push(`["TEXT","e${ctx.nextId()}",${x},${y},0,${q(group.name)},"st2",0]`);
		return;
	}

	const ticket = ctx.nextId();
	const y = flip ? -bounds.maxY - PADDING + 30 : bounds.maxY + PADDING - 30;
	const body = { x: x, y: y, value: group.name, fontSize: 60, align: 'LEFT_MIDDLE', rotation: 0 };
	ctx.lines.push(`{"type":"TEXT","ticket":${ticket},"id":"e${ticket}"}||${JSON.stringify(body)}|`);
}

/**
 * 逐组排布并发射
 *
 * @param {object} ctx 构建上下文
 * @returns {void}
 * @sideEffects 修改 `ctx.lines`
 */
function emitGroups(ctx) {
	let currentTopY = ctx.options.startY;

	for (const group of ctx.groups) {
		if (!group.items || group.items.length === 0) continue;

		const layout = layoutGroup(group.items, {
			classify: ctx.options.classify,
			startX: ctx.options.startX,
			startTopY: currentTopY,
			symbolDb: ctx.symbolDb,
		});

		for (const part of layout.parts) ctx.emitPart(ctx, part);
		emitFrame(ctx, group, layout.bounds);

		// 下一组接到本组最下边缘之下
		if (ctx.options.classify !== 'coord') currentTopY = layout.bounds.minY - GROUP_GAP;
	}
}

/**
 * V3/V4 的最后一行不能带行尾 `|`（EDA 自己写盘就是这样）
 *
 * @param {string[]} lines 源码行（就地修改）
 * @returns {void}
 * @sideEffects 修改 `lines` 的最后一个元素
 */
function stripTrailingPipe(lines) {
	const last = lines.length - 1;
	if (last >= 0 && lines[last].endsWith('|')) lines[last] = lines[last].slice(0, -1);
}

/**
 * 构建原理图源码
 *
 * @param {object} payload 参数对象
 * @param {Array<object>} payload.components 器件列表
 * @param {Record<string, Array<object>>} payload.symbolDb 符号引脚库
 * @param {'v2'|'modern'} payload.format 源码格式
 * @param {number} [payload.startId=1] 起始 id/ticket（该页面 id 与 ticket 共用一个计数器）
 * @param {object} [payload.options] 布局与输出选项
 * @param {() => number} [payload.options.now] 时间源（测试注入）
 * @returns {string} 源码全文（行以 `\n` 连接）
 * @sideEffects 调用 `options.now` / `Math.random`（仅 V3/V4 头部需要）
 */
export function buildSchSource(payload) {
	const input = payload || {};
	const options = normalizeOptions(input.options);
	options.now = (input.options && input.options.now) || (() => Date.now());

	let counter = Number(input.startId) || 1;

	const ctx = {
		lines: [],
		symbolDb: input.symbolDb || {},
		options: options,
		isV2: input.format === 'v2',
		nextId: () => counter++,
		groups: classifyGroups(input.components || [], options.classify),
		emitPart: null,
	};
	ctx.emitPart = ctx.isV2 ? emitV2Component : emitModernComponent;

	if (ctx.isV2) emitHeaderV2(ctx);
	else emitHeaderModern(ctx);

	emitGroups(ctx);
	if (!ctx.isV2) stripTrailingPipe(ctx.lines);

	return ctx.lines.join('\n');
}
