/**
 * @//module/ app/import-image/layout
 * @//description/ 由文件名推导放置版式：T/B/L 编号的双列特殊布局，或普通正方形网格
 * @//exports/ parseFileNameOrder, gridSize, computeOrigins
 * @//dependencies/ 无
 * @//example/ const { parseFileNameOrder, computeOrigins } = await import('./layout.js')
 *            const { ordered, layoutMap, useSpecial } = parseFileNameOrder(files)
 *            const origins = computeOrigins({ totalImages: 4, imgWidth: 100, imgHeight: 80,
 *              originX: 0, originY: 0, layoutMap, useSpecial })
 *
 * 命名约定（文件名）：`T{n}` 顶面段、`B{n}` 底面段、`TS`/`BS` 为顶/底整图，`L{n}` 为侧边段；
 * `TOP*` / `BOT*` 视为 `L1` / `L{maxL}` 的别名。左右两列按行优先排列。
 */

/** 文件名主模式：T1 / B2 / LS 之类 */
const NAME_PATTERN = /^(T|B|L)(\d+|S).*\.(png|jpg|jpeg|bmp)$/i;

/** 别名模式：TOP* / BOT* */
const ALIAS_PATTERN = /^(TOP|BOT).*\.(png|jpg|jpeg|bmp)$/i;

/**
 * 正方形网格边长（用于普通布局）
 *
 * @param {number} count 图片数
 * @returns {number} 每行/每列数量
 * @sideEffects 无（纯函数）
 */
export function gridSize(count) {
	return Math.ceil(Math.sqrt(Number(count) || 0));
}

/**
 * 解析文件名并给出排列顺序
 *
 * @param {Array<{name: string}>} files 文件列表
 * @returns {{ordered: Array<object>, layoutMap: Map<number, {col: 'left'|'right', row: number}>|null, useSpecial: boolean}}
 *          排序后的文件、每张图在双列版式中的位置、是否启用特殊布局
 * @sideEffects 无（纯函数）
 */
export function parseFileNameOrder(files) {
	const list = Array.isArray(files) ? files : [];
	const parsed = parseFileNames(list);

	if (!parsed.every((item) => item.valid)) return noSpecialLayout(list);

	const groups = splitGroups(resolveItems(parsed));
	if (!isSideCountValid(groups.lGroup.length)) return noSpecialLayout(list);

	return buildSpecialLayout(list, groups);
}

/**
 * 「不启用特殊布局」的返回（原实现的两处 early return 共用）
 *
 * @param {Array<object>} list 原始文件列表
 * @returns {{ordered: Array<object>, layoutMap: null, useSpecial: boolean}} 结果
 * @sideEffects 无（纯函数）
 */
function noSpecialLayout(list) {
	return { ordered: list, layoutMap: null, useSpecial: false };
}

/**
 * 按文件名模式解析出 T/B/L 段或 TOP/BOT 别名
 *
 * @param {Array<{name: string}>} list 文件列表
 * @returns {Array<object>} 解析结果（含 idx 与 valid）
 * @sideEffects 无（纯函数）
 */
function parseFileNames(list) {
	return list.map((file, idx) => {
		const name = String(file && file.name ? file.name : '');
		let match = name.match(NAME_PATTERN);
		if (match) return { idx: idx, type: 'normal', prefix: match[1].toUpperCase(), suffix: match[2].toUpperCase(), valid: true };
		match = name.match(ALIAS_PATTERN);
		if (match) return { idx: idx, type: 'alias', alias: match[1].toUpperCase(), valid: true };
		return { idx: idx, valid: false };
	});
}

/**
 * L 编号最大值：BOT 别名要折成 L{maxL}
 *
 * @param {Array<object>} parsed parseFileNames 的结果
 * @returns {number} 最大 L 编号（无则 1）
 * @sideEffects 无（纯函数）
 */
function maxSideNumber(parsed) {
	const lNumbers = parsed
		.filter((p) => p.type === 'normal' && p.prefix === 'L' && p.suffix !== 'S')
		.map((p) => parseInt(p.suffix, 10))
		.filter((num) => !isNaN(num));
	return lNumbers.length > 0 ? Math.max(...lNumbers) : 1;
}

/**
 * 把别名折成 L 段，得到统一的 { idx, prefix, suffix }
 *
 * @param {Array<object>} parsed parseFileNames 的结果
 * @returns {Array<{idx: number, prefix: string, suffix: string}>} 统一后的条目
 * @sideEffects 无（纯函数）
 */
function resolveItems(parsed) {
	const maxL = maxSideNumber(parsed);
	return parsed.map((p) => {
		if (p.type === 'normal') return { idx: p.idx, prefix: p.prefix, suffix: p.suffix };
		return p.alias === 'TOP' ? { idx: p.idx, prefix: 'L', suffix: '1' } : { idx: p.idx, prefix: 'L', suffix: String(maxL) };
	});
}

/**
 * 拆成 T/B/L 三组（T、B 降序，L 升序）并取出 TS/BS 整图
 *
 * @param {Array<object>} items resolveItems 的结果
 * @returns {{tGroup: Array<object>, bGroup: Array<object>, lGroup: Array<object>, tsFile: object|undefined, bsFile: object|undefined}} 分组
 * @sideEffects 排序的是 filter 产生的新数组
 */
function splitGroups(items) {
	const tGroup = items.filter((p) => p.prefix === 'T' && p.suffix !== 'S');
	const bGroup = items.filter((p) => p.prefix === 'B' && p.suffix !== 'S');
	const lGroup = items.filter((p) => p.prefix === 'L');
	const tsFile = items.find((p) => p.prefix === 'T' && p.suffix === 'S');
	const bsFile = items.find((p) => p.prefix === 'B' && p.suffix === 'S');

	// T、B 降序，L 升序
	tGroup.sort((a, b) => parseInt(b.suffix, 10) - parseInt(a.suffix, 10));
	bGroup.sort((a, b) => parseInt(b.suffix, 10) - parseInt(a.suffix, 10));
	lGroup.sort((a, b) => parseInt(a.suffix, 10) - parseInt(b.suffix, 10));

	return { tGroup: tGroup, bGroup: bGroup, lGroup: lGroup, tsFile: tsFile, bsFile: bsFile };
}

/**
 * L 段数量是否可用（0 或 偶数且 ≥2）
 *
 * @param {number} lCount L 段数量
 * @returns {boolean} 是否可用
 * @sideEffects 无（纯函数）
 */
function isSideCountValid(lCount) {
	return lCount === 0 || (lCount >= 2 && lCount % 2 === 0);
}

/**
 * 构造左右两列的顺序并交错成行
 *
 * @param {Array<object>} list 原始文件列表
 * @param {object} groups splitGroups 的结果
 * @returns {{ordered: Array<object>, layoutMap: Map<number, {col: string, row: number}>, useSpecial: boolean}} 结果
 * @sideEffects 无（纯函数）
 */
function buildSpecialLayout(list, groups) {
	const leftOrder = [...groups.tGroup];
	if (groups.tsFile) leftOrder.push(groups.tsFile);
	let rightL = [];
	const lCount = groups.lGroup.length;
	if (lCount > 0) {
		const half = lCount / 2;
		leftOrder.push(...groups.lGroup.slice(0, half));
		rightL = groups.lGroup.slice(half).reverse(); // 右列 L 降序
	}

	const rightOrder = [...groups.bGroup];
	if (groups.bsFile) rightOrder.push(groups.bsFile);
	rightOrder.push(...rightL);

	return interleave(list, leftOrder, rightOrder);
}

/**
 * 行优先交错：每行先左后右
 *
 * @param {Array<object>} list 原始文件列表
 * @param {Array<object>} leftOrder 左列顺序
 * @param {Array<object>} rightOrder 右列顺序
 * @returns {{ordered: Array<object>, layoutMap: Map<number, {col: string, row: number}>, useSpecial: boolean}} 结果
 * @sideEffects 无（纯函数）
 */
function interleave(list, leftOrder, rightOrder) {
	const ordered = [];
	const layoutMap = new Map();
	const maxRows = Math.max(leftOrder.length, rightOrder.length);
	for (let row = 0; row < maxRows; row++) {
		if (row < leftOrder.length) {
			layoutMap.set(ordered.length, { col: 'left', row: row });
			ordered.push(list[leftOrder[row].idx]);
		}
		if (row < rightOrder.length) {
			layoutMap.set(ordered.length, { col: 'right', row: row });
			ordered.push(list[rightOrder[row].idx]);
		}
	}

	return { ordered: ordered, layoutMap: layoutMap, useSpecial: true };
}

/**
 * 计算每张图的放置原点
 *
 * 特殊布局：左列贴 originX、右列偏移一个图宽；行号越大 Y 越小（PCB 的 Y 轴向上）。
 * 普通布局：正方形网格，间距取长边。
 *
 * @param {object} input 参数
 * @param {number} input.totalImages 图片数
 * @param {number} input.imgWidth 单图宽（mil）
 * @param {number} input.imgHeight 单图高（mil）
 * @param {number} input.originX 第一张图原点 X
 * @param {number} input.originY 第一张图原点 Y
 * @param {Map<number, {col: string, row: number}>|null} input.layoutMap 双列布局映射
 * @param {boolean} input.useSpecial 是否使用特殊布局
 * @returns {Array<{x: number, y: number}>} 每张图的原点
 * @sideEffects 无（纯函数）
 */
export function computeOrigins(input) {
	const total = Number(input.totalImages) || 0;
	const origins = [];

	if (input.useSpecial && input.layoutMap) {
		for (let i = 0; i < total; i++) {
			const pos = input.layoutMap.get(i);
			if (!pos) {
				origins.push({ x: input.originX, y: input.originY });
				continue;
			}
			origins.push({
				x: input.originX + (pos.col === 'right' ? input.imgWidth : 0),
				y: input.originY - pos.row * input.imgHeight,
			});
		}
		return origins;
	}

	const size = gridSize(total);
	const side = Math.max(input.imgWidth, input.imgHeight);
	for (let idx = 0; idx < total; idx++) {
		const row = Math.floor(idx / size);
		const col = idx % size;
		origins.push({ x: input.originX + col * side, y: input.originY - row * side });
	}
	return origins;
}
