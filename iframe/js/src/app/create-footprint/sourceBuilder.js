/**
 * @//module/ app/create-footprint/sourceBuilder
 * @//description/ 由选中图元源码生成「封装源码」与「符号源码」（纯字符串拼装，不碰 eda）
 * @//exports/ getCoordsFromSource, transformPath, buildFootprintSource, buildSymbolSource
 * @//dependencies/ core/pins
 * @//example/ const { buildFootprintSource } = await import('./sourceBuilder.js')
 *            const src = buildFootprintSource(primitives, { uuid, deviceName, originX, originY })
 *
 * 这两个格式（FOOTPRINT 的 15 行 LAYER 表、SYMBOL 的 BBOX/PIN/ATTR/RECT）是从真实工程文件里
 * 反推出来的，**改动一个字段就可能生成打不开的库**；所以尽量保持原样，只做参数化。
 * 只有 V2.2 客户端支持本功能（V3/V4 的库源码写入 API 有缺陷，页面会整体拦截）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 1 层…47 HOLE 的官方图层表（封装源码必需，缺行会导致库打不开） */
/**
 * 封装源码头部（15 行官方图层表 + HEAD/CANVAS/ACTIVE_LAYER/NET）
 *
 * @param {string} uuid 封装 uuid
 * @param {string} deviceName 器件名
 * @returns {string} 头部文本
 * @sideEffects 无（纯函数）
 */
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

/** 直接存坐标的类型 → [x 下标, y 下标] */
const DIRECT_COORDS = new Map([
	['PAD', [6, 7]],
	['VIA', [5, 6]],
	['IMAGE', [4, 5]],
]);

/** 坐标在路径字段里的类型 → 数组下标 */
const PATH_FIELDS = new Map([
	['POLY', 6],
	['REGION', 6],
	['FILL', 7],
	['POUR', 8],
]);

/**
 * 取路径里第一对相邻数字
 *
 * @param {Array} pathObj 路径（单层或双层数组）
 * @returns {{x: number|undefined, y: number|undefined}} 坐标
 * @sideEffects 无（纯函数）
 */
function firstCoordOf(pathObj) {
	if (!pathObj) return { x: undefined, y: undefined };
	const polyArr = Array.isArray(pathObj[0]) ? pathObj[0] : pathObj;
	for (let i = 0; i < polyArr.length - 1; i++) {
		if (typeof polyArr[i] === 'number' && typeof polyArr[i + 1] === 'number') return { x: polyArr[i], y: polyArr[i + 1] };
	}
	return { x: undefined, y: undefined };
}

/**
 * 从源码数组里取「基准坐标」
 *
 * 不同类型把坐标放在不同下标（PAD 6/7、VIA 5/6、IMAGE 4/5；POLY/REGION/FILL/POUR 在路径里）。
 *
 * @param {Array} arr 单行源码数组
 * @returns {{x: number|undefined, y: number|undefined}} 坐标
 * @sideEffects 无（纯函数）
 */
export function getCoordsFromSource(arr) {
	const direct = DIRECT_COORDS.get(arr[0]);
	if (direct) return { x: arr[direct[0]], y: arr[direct[1]] };
	const pathField = PATH_FIELDS.get(arr[0]);
	if (pathField === undefined) return { x: undefined, y: undefined };
	return firstCoordOf(arr[pathField]);
}

/**
 * 整体平移一条路径
 *
 * 支持 `["R"/"CIRCLE", x, y, ...]`、裸坐标对、`"L"` 与 `"ARC"` 命令段。
 * 所有坐标保留 4 位小数（与库文件口径一致）。
 *
 * @param {Array} arr 路径数组
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {Array} 平移后的新数组
 * @sideEffects 无（纯函数）
 */
export function transformPath(arr, ox, oy) {
	const out = Array.isArray(arr) ? arr.slice() : [];
	if (out.length === 0) return out;
	const type = out[0];
	const shift = (index, delta) => {
		if (typeof out[index] === 'number') out[index] = parseFloat((out[index] - delta).toFixed(4));
	};

	if (type === 'R' || type === 'CIRCLE') {
		shift(1, ox);
		shift(2, oy);
		return out;
	}

	let i = 0;
	if (typeof out[0] === 'number') {
		shift(0, ox);
		shift(1, oy);
		i = 2;
	}
	while (i < out.length) {
		const cmd = out[i];
		if (typeof cmd === 'number') {
			shift(i, ox);
			shift(i + 1, oy);
			i += 2;
		} else if (cmd === 'L') {
			shift(i + 1, ox);
			shift(i + 2, oy);
			i += 3;
		} else if (cmd === 'ARC') {
			shift(i + 2, ox);
			shift(i + 3, oy);
			i += 4;
		} else {
			i++;
		}
	}
	return out;
}

/**
 * 判断并平移「可能是双层数组」的路径字段
 *
 * @param {Array} value 路径（单层或双层数组）
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {Array} 处理后的数组
 * @sideEffects 无（纯函数）
 */
function shiftPathField(value, ox, oy) {
	if (Array.isArray(value) && Array.isArray(value[0])) return value.map((sub) => transformPath(sub, ox, oy));
	if (Array.isArray(value)) return transformPath(value, ox, oy);
	return value;
}

/**
 * 平移一对方括号里的坐标（保留 4 位小数）
 *
 * @param {Array} p 源码数组（会被就地改写）
 * @param {number} ix X 下标
 * @param {number} iy Y 下标
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {void}
 * @sideEffects 改写 `p`
 */
function shiftXY(p, ix, iy, ox, oy) {
	p[ix] = parseFloat((p[ix] - ox).toFixed(4));
	p[iy] = parseFloat((p[iy] - oy).toFixed(4));
}

/**
 * 平移 PAD（异形焊盘的 POLYGON 路径也要跟着挪）
 *
 * @param {Array} p 源码数组（会被就地改写）
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {void}
 * @sideEffects 改写 `p`
 */
function shiftPad(p, ox, oy) {
	shiftXY(p, 6, 7, ox, oy);
	const padShape = p[10];
	if (Array.isArray(padShape) && padShape[0] === 'POLYGON' && Array.isArray(padShape[1])) {
		padShape[1] = transformPath(padShape[1], ox, oy);
	}
}

/**
 * 平移 IMAGE（坐标 + 图片路径）
 *
 * @param {Array} p 源码数组（会被就地改写）
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {void}
 * @sideEffects 改写 `p`
 */
function shiftImage(p, ox, oy) {
	shiftXY(p, 4, 5, ox, oy);
	p[10] = shiftPathField(p[10], ox, oy);
}

/**
 * 平移 POLY / REGION（路径在下标 6）
 *
 * @param {Array} p 源码数组（会被就地改写）
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {void}
 * @sideEffects 改写 `p`
 */
function shiftPoly(p, ox, oy) {
	p[6] = shiftPathField(p[6], ox, oy);
}

/**
 * 平移 FILL（路径在下标 7）
 *
 * @param {Array} p 源码数组（会被就地改写）
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {void}
 * @sideEffects 改写 `p`
 */
function shiftFill(p, ox, oy) {
	p[7] = shiftPathField(p[7], ox, oy);
}

/**
 * 平移 POUR（路径在下标 8）
 *
 * @param {Array} p 源码数组（会被就地改写）
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {void}
 * @sideEffects 改写 `p`
 */
function shiftPour(p, ox, oy) {
	p[8] = shiftPathField(p[8], ox, oy);
}

/** 图元类型 → 平移函数（未列出的类型原样输出） */
const SHIFTERS = new Map([
	['PAD', shiftPad],
	['VIA', (p, ox, oy) => shiftXY(p, 5, 6, ox, oy)],
	['IMAGE', shiftImage],
	['POLY', shiftPoly],
	['REGION', shiftPoly],
	['FILL', shiftFill],
	['POUR', shiftPour],
]);

/**
 * 按类型平移一条图元
 *
 * @param {Array} p 源码数组（会被就地改写）
 * @param {number} ox X 偏移
 * @param {number} oy Y 偏移
 * @returns {void}
 * @sideEffects 改写 `p`
 */
function shiftPrimitive(p, ox, oy) {
	const shift = SHIFTERS.get(p[0]);
	if (shift) shift(p, ox, oy);
}

/**
 * 生成完整封装源码
 *
 * @param {Array<Array>} primitives 选中的图元源码行（会被复制后改写，不改入参）
 * @param {{uuid: string, deviceName: string, originX: number, originY: number}} options 参数
 * @returns {string} 封装源码
 * @sideEffects 无（纯函数）
 */
export function buildFootprintSource(primitives, options) {
	const { uuid, deviceName, originX, originY } = options;
	let idCounter = 1;
	const lines = [];

	for (const source of Array.isArray(primitives) ? primitives : []) {
		const p = source.slice();
		p[1] = `e${idCounter++}`;
		shiftPrimitive(p, originX, originY);
		lines.push(JSON.stringify(p));
	}

	return footprintHeader(uuid, deviceName) + lines.join('\n') + (lines.length ? '\n' : '');
}

/**
 * 引脚号排序（数字优先，其余自然序）
 *
 * @param {string[]} pins 引脚号
 * @returns {string[]} 排序后的新数组
 * @sideEffects 无（纯函数）
 */
function sortPinNumbers(pins) {
	return pins.slice().sort((a, b) => {
		const na = parseInt(a, 10);
		const nb = parseInt(b, 10);
		if (!isNaN(na) && !isNaN(nb)) return na - nb;
		return a.localeCompare(b);
	});
}

/**
 * 生成完整符号源码（引脚按 CCW 逆时针排布：左列自上而下、右列自下而上）
 *
 * @param {{deviceName: string, pinNumbers: Iterable<string>}} options 参数
 * @returns {string} 符号源码
 * @sideEffects 无（纯函数）
 */
export function buildSymbolSource(options) {
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
		const safeVal = val !== undefined && val !== null && val !== '' ? val : '?';
		return `["ATTR","${id}","${parent}","${key}","${safeVal}",0,1,${x},${y},0,"${font}",0]`;
	};

	let body = '';
	for (let i = 0; i < totalPins; i++) {
		if (i < leftCount) {
			const pinNum = pins[i];
			const y = startY - i * rowHeight;
			const pId = `pL${i}`;
			body += `["PIN","${pId}",1,null,-40,${y},20,0,null,0,0]\n`;
			body += createAttr(`nL${i}`, pId, 'NAME', pinNum, -17, y, 'st1') + '\n';
			body += createAttr(`uL${i}`, pId, 'NUMBER', pinNum, -25, y, 'st2') + '\n';
		} else {
			const rightIndex = i - leftCount;
			const pinIndex = totalPins - 1 - rightIndex;
			const pinNum = pins[pinIndex];
			const y = startY - rightIndex * rowHeight;
			const pId = `pR${i}`;
			body += `["PIN","${pId}",1,null,40,${y},20,180,null,0,0]\n`;
			body += createAttr(`nR${i}`, pId, 'NAME', pinNum, 17, y, 'st3') + '\n';
			body += createAttr(`uR${i}`, pId, 'NUMBER', pinNum, 25, y, 'st4') + '\n';
		}
	}

	const box = `["RECT","box",-20,${boxTop},20,${boxBottom},0,0,0,"st5",0]`;
	return header + styles + body + box;
}
