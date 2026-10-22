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
	const parsed = list.map((file, idx) => {
		const name = String(file && file.name ? file.name : '');
		let match = name.match(NAME_PATTERN);
		if (match) return { idx: idx, type: 'normal', prefix: match[1].toUpperCase(), suffix: match[2].toUpperCase(), valid: true };
		match = name.match(ALIAS_PATTERN);
		if (match) return { idx: idx, type: 'alias', alias: match[1].toUpperCase(), valid: true };
		return { idx: idx, valid: false };
	});

	if (!parsed.every((item) => item.valid)) return { ordered: list, layoutMap: null, useSpecial: false };

	// L 编号最大值：BOT 别名要折成 L{maxL}
	const lNumbers = parsed
		.filter((p) => p.type === 'normal' && p.prefix === 'L' && p.suffix !== 'S')
		.map((p) => parseInt(p.suffix, 10))
		.filter((num) => !isNaN(num));
	const maxL = lNumbers.length > 0 ? Math.max(...lNumbers) : 1;

	const items = parsed.map((p) => {
		if (p.type === 'normal') return { idx: p.idx, prefix: p.prefix, suffix: p.suffix };
		return p.alias === 'TOP' ? { idx: p.idx, prefix: 'L', suffix: '1' } : { idx: p.idx, prefix: 'L', suffix: String(maxL) };
	});

	const tGroup = items.filter((p) => p.prefix === 'T' && p.suffix !== 'S');
	const bGroup = items.filter((p) => p.prefix === 'B' && p.suffix !== 'S');
	const lGroup = items.filter((p) => p.prefix === 'L');
	const tsFile = items.find((p) => p.prefix === 'T' && p.suffix === 'S');
	const bsFile = items.find((p) => p.prefix === 'B' && p.suffix === 'S');

	// T、B 降序，L 升序
	tGroup.sort((a, b) => parseInt(b.suffix, 10) - parseInt(a.suffix, 10));
	bGroup.sort((a, b) => parseInt(b.suffix, 10) - parseInt(a.suffix, 10));
	lGroup.sort((a, b) => parseInt(a.suffix, 10) - parseInt(b.suffix, 10));

	const lCount = lGroup.length;
	const lValid = lCount === 0 || (lCount >= 2 && lCount % 2 === 0);
	if (!lValid) return { ordered: list, layoutMap: null, useSpecial: false };

	const leftOrder = [...tGroup];
	if (tsFile) leftOrder.push(tsFile);
	let rightL = [];
	if (lCount > 0) {
		const half = lCount / 2;
		leftOrder.push(...lGroup.slice(0, half));
		rightL = lGroup.slice(half).reverse(); // 右列 L 降序
	}

	const rightOrder = [...bGroup];
	if (bsFile) rightOrder.push(bsFile);
	rightOrder.push(...rightL);

	// 行优先：每行先左后右
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
