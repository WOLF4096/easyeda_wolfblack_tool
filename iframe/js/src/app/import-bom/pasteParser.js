/**
 * @//module/ app/import-bom/pasteParser
 * @//description/ 解析从 Excel 粘贴来的 BOM 文本（6 列：位号|名称|制造商编号|制造商|供应商编号|供应商）
 * @//exports/ parsePaste
 * @//dependencies/ 无
 * @//example/ const { parsePaste } = await import('./pasteParser.js')
 *            const items = parsePaste(await navigator.clipboard.readText())
 *            // [{ designators: ['R1','R2'], name: '10k', manufacturerPart: '...', ... }]
 */

/**
 * 解析粘贴文本
 *
 * 分隔符规则沿用原实现（不做通用嗅探，因为**位号分隔符与列分隔符是联动的**）：
 *   - 首行含制表符 → 列分隔 `\t`，位号分隔 `,`（Excel 单元格内多值）；
 *   - 否则 → 列分隔 `,`，位号分隔 `、`（中文逗号）。
 * 每行补齐到 6 列并截断多余列；空行跳过。
 *
 * @param {string} text 剪贴板文本
 * @returns {Array<{designators: string[], name: string, manufacturerPart: string, manufacturer: string, supplierPart: string, supplier: string}>} 解析结果
 * @sideEffects 无（纯函数）
 */
export function parsePaste(text) {
	const raw = String(text === null || text === undefined ? '' : text).trim();
	const items = [];
	if (!raw) return items;

	const lines = raw.split('\n');
	const firstLine = lines[0];
	const useTab = firstLine.includes('\t');
	const delimiter = useTab ? '\t' : ',';
	const designatorSeparator = useTab ? ',' : '、';

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const cells = trimmed.split(delimiter).slice(0, 6);
		while (cells.length < 6) cells.push('');
		items.push({
			designators: splitDesignators(cells[0], designatorSeparator),
			name: cells[1].trim(),
			manufacturerPart: cells[2].trim(),
			manufacturer: cells[3].trim(),
			supplierPart: cells[4].trim(),
			supplier: cells[5].trim(),
		});
	}
	return items;
}

/**
 * 拆分位号单元格
 *
 * @param {string} field 单元格原文
 * @param {string} separator 位号分隔符
 * @returns {string[]} 位号数组（空项已剔除）
 * @sideEffects 无（纯函数）
 */
function splitDesignators(field, separator) {
	const text = String(field || '').trim();
	if (!text.includes(separator)) return text ? [text] : [];
	return text
		.split(separator)
		.map((d) => d.trim())
		.filter((d) => d);
}
