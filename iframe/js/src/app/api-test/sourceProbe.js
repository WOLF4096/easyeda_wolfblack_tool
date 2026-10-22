/**
 * @//module/ app/api-test/sourceProbe
 * @//description/ 从文档源码 / API 返回值里取出「同一组标准量」（坐标 + 2~3 个尺寸），供测试比对
 * @//exports/ findSourceLine, normalizeFromSource, extractFromApi, defaultsOf
 * @//dependencies/ 无
 * @//example/ const { normalizeFromSource } = await import('./sourceProbe.js')
 *            normalizeFromSource('Via', null, { centerX: 10, centerY: 20, holeDiameter: 12, viaDiameter: 24 })
 *            // ['10,20', 12, 24, '0']
 *
 * 原实现把「V2 下标表 / V3 字段表 / API 形状表 / 默认值表」四张表分散在四个函数里，
 * 改一个字段要同步四处；这里集中到三张表 + `defaultsOf`，仍然是「每类图元一份定义」。
 */

/** V2 源码数组的下标表：[下标, 字段] */
const V2_FIELDS = {
	Via: { pos: [5, 6], val1: 7, val2: 8, val3: 10 },
	Pad: { pos: [6, 7], val1: [9, 1], val2: [10, 1], val3: 17 },
	Line: { pos: [5, 6], val1: 9 },
	Arc: { pos: [5, 6], val1: 10, val2: 9 },
	Polyline: { pos: [6, 0], pos2: [6, 1], val1: 5 },
};

/**
 * 在源码里按 id 找 V2 或 V3 行
 *
 * V3 是日志行（含 `||`，id 在左侧 JSON 里）；V2 是数组行。两条路径都**只解析、不重排**。
 *
 * @param {string} code 文档源码
 * @param {string} id 图元 id
 * @returns {{rawV2: Array|null, rawV3: object|null}} 命中的原始行
 * @sideEffects 无（纯函数）
 */
export function findSourceLine(code, id) {
	let rawV2 = null;
	let rawV3 = null;
	for (const line of String(code || '').split('\n')) {
		const text = line.trim();
		if (!text) continue;
		if (text.includes('||') && text.includes(`"id":"${id}"`)) {
			try {
				const parts = text.split('||');
				rawV3 = JSON.parse(parts[1].replace(/\|$/, ''));
				break;
			} catch (e) {
				/* 解析失败继续找下一行 */
			}
		} else if (text.startsWith('[') && text.includes(`"${id}"`)) {
			try {
				rawV2 = JSON.parse(text.replace(/,$/, ''));
				break;
			} catch (e) {
				/* 解析失败继续找下一行 */
			}
		}
	}
	return { rawV2: rawV2, rawV3: rawV3 };
}

/**
 * 把源码行归一成「界面上的标准量数组」
 *
 * @param {'Via'|'Pad'|'Line'|'Arc'|'Polyline'} type 图元类型
 * @param {Array|null} rawV2 V2 数组行
 * @param {object|null} rawV3 V3 数据体
 * @returns {Array<string|number>} 标准量数组；找不到返回空数组
 * @sideEffects 无（纯函数）
 */
export function normalizeFromSource(type, rawV2, rawV3) {
	if (!rawV2 && !rawV3) return [];

	if (rawV3) {
		const std = { x: 0, y: 0, val1: 0, val2: 0, val3: '0' };
		const solder = (value) => (value === null ? 'null' : (value ?? '0'));
		switch (type) {
			case 'Via':
				std.x = rawV3.centerX;
				std.y = rawV3.centerY;
				std.val1 = rawV3.holeDiameter;
				std.val2 = rawV3.viaDiameter;
				std.val3 = solder(rawV3.topSolderExpansion);
				break;
			case 'Pad':
				std.x = rawV3.centerX;
				std.y = rawV3.centerY;
				std.val1 = rawV3.hole?.width;
				std.val2 = rawV3.defaultPad?.width;
				std.val3 = solder(rawV3.topSolderExpansion);
				break;
			case 'Line':
				std.x = rawV3.startX;
				std.y = rawV3.startY;
				std.val1 = rawV3.width;
				break;
			case 'Arc':
				std.x = rawV3.startX;
				std.y = rawV3.startY;
				std.val1 = rawV3.width;
				std.val2 = rawV3.angle;
				break;
			case 'Polyline':
				std.x = rawV3.path?.[0];
				std.y = rawV3.path?.[1];
				std.val1 = rawV3.width;
				break;
			default:
				return [];
		}
		return shape(type, std);
	}

	const fields = V2_FIELDS[type];
	if (!fields) return [];
	const at = (index) => rawV2[index];
	const nested = (index) => (Array.isArray(index) ? at(index[0])?.[index[1]] : at(index));
	const std = {
		x: type === 'Polyline' ? rawV2[6]?.[0] : at(fields.pos[0]),
		y: type === 'Polyline' ? rawV2[6]?.[1] : at(fields.pos[1]),
		val1: nested(fields.val1),
		val2: nested(fields.val2),
		val3: fields.val3 === undefined ? '0' : at(fields.val3) === null ? 'null' : (at(fields.val3) ?? '0'),
	};
	return shape(type, std);
}

/**
 * 按类型把标准量排成界面顺序
 *
 * @param {string} type 图元类型
 * @param {object} std 标准量
 * @returns {Array<string|number>} 界面数组
 * @sideEffects 无（纯函数）
 */
function shape(type, std) {
	const pos = `${std.x},${std.y}`;
	if (type === 'Via' || type === 'Pad') return [pos, std.val1, std.val2, String(std.val3)];
	if (type === 'Arc') return [pos, std.val1, std.val2];
	return [pos, std.val1];
}

/**
 * 从 API 返回对象里取标准量
 *
 * @param {'Via'|'Pad'|'Line'|'Arc'|'Polyline'} type 图元类型
 * @param {object} obj API 返回的图元对象
 * @returns {Array<string|number>} 标准量数组
 * @sideEffects 无（纯函数）
 */
export function extractFromApi(type, obj) {
	/** 取阻焊扩展（对象/标量/null 三种形状都处理） */
	const solderOf = (value) => {
		if (value === null) return 'null';
		if (value === undefined) return '0';
		if (typeof value !== 'object') return value;
		return value.topSolderMask === null ? 'null' : (value.topSolderMask ?? '0');
	};

	switch (type) {
		case 'Via':
			return [`${obj.x},${obj.y}`, obj.holeDiameter, obj.diameter, String(solderOf(obj.solderMaskExpansion))];
		case 'Pad':
			return [`${obj.x},${obj.y}`, obj.hole?.[1], obj.pad?.[1], String(solderOf(obj.solderMaskAndPasteMaskExpansion))];
		case 'Line':
			return [`${obj.startX.toFixed(2)},${obj.startY.toFixed(2)}`, obj.lineWidth];
		case 'Arc':
			return [`${obj.startX},${obj.startY}`, obj.lineWidth, obj.arcAngle];
		case 'Polyline':
			return [`${obj.polygon.polygon[0]},${obj.polygon.polygon[1]}`, obj.lineWidth];
		default:
			return [];
	}
}

/**
 * 取某类型的默认初始值（来自 V2 源码样本）
 *
 * @param {'Via'|'Pad'|'Line'|'Arc'|'Polyline'} type 图元类型
 * @param {object} rawSource RAW_SOURCE
 * @returns {Array<string|number>} 默认值；未知类型为空数组
 * @sideEffects 无（纯函数）
 */
export function defaultsOf(type, rawSource) {
	const d = rawSource && rawSource[type];
	if (!d) return [];
	switch (type) {
		case 'Via':
			return [`${d[5]},${d[6]}`, d[7], d[8], d[10]];
		case 'Pad':
			return [`${d[6]},${d[7]}`, d[9][1], d[10][1], d[17]];
		case 'Line':
			return [`${d[5]},${d[6]}`, d[9]];
		case 'Arc':
			return [`${d[5]},${d[6]}`, d[10], d[9]];
		case 'Polyline':
			return [`${d[6][0]},${d[6][1]}`, d[5]];
		default:
			return [];
	}
}
