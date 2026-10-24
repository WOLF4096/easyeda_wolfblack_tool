/**
 * @//module/ ui/download
 * @//description/ 文本/CSV 的生成、分隔符嗅探与文件下载（导出表格、网表、报告的公共底座）
 * @//exports/ sniffDelimiter, parseDelimited, normalizeRows, toCsv, downloadText, downloadBlob
 * @//dependencies/ 无
 * @//example/ const { parseDelimited, toCsv, downloadText } = await import('./ui/download.js')
 *            const rows = normalizeRows(parseDelimited(await navigator.clipboard.readText()), 6)
 *            downloadText('bom.csv', toCsv(rows), { mime: 'text/csv' })
 *
 * 原实现散落在 OutPinNet（3 份 Blob→a.click 模板）、PcbToSch（2 份 escapeCsv）、
 * ImportBom（剪贴板分隔符嗅探）里，此处收敛成一份。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 嗅探分隔符
 *
 * Excel 粘贴过来是制表符、另存的 CSV 是逗号、部分区域设置用分号。取首行里出现最多的那个。
 *
 * @param {string} text 原始文本
 * @returns {'\t'|','|';'} 分隔符（无法判断时按制表符）
 * @sideEffects 无（纯函数）
 */
export function sniffDelimiter(text) {
	const firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
	const count = (ch) => firstLine.split(ch).length - 1;
	const tabs = count('\t');
	const commas = count(',');
	const semis = count(';');
	if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
	if (commas >= semis && commas > 0) return ',';
	if (semis > 0) return ';';
	return '\t';
}

/**
 * 收下一个字段（字段内容已攒在 state.field 里）
 *
 * @param {{row: string[], field: string}} state 解析状态
 * @returns {void}
 * @sideEffects **就地修改** state
 */
function pushField(state) {
	state.row.push(state.field);
	state.field = '';
}

/**
 * 收下一行
 *
 * @param {{rows: string[][], row: string[], field: string}} state 解析状态
 * @returns {void}
 * @sideEffects **就地修改** state
 */
function pushRow(state) {
	pushField(state);
	state.rows.push(state.row);
	state.row = [];
}

/**
 * 处理引号内的一个字符
 *
 * @param {{field: string, quoted: boolean}} state 解析状态
 * @param {string} raw 原文
 * @param {number} i 当前下标
 * @returns {number} 下一个待处理下标（`""` 转义会多吞一个字符）
 * @sideEffects **就地修改** state
 */
function consumeQuoted(state, raw, i) {
	const ch = raw[i];
	if (ch !== '"') {
		state.field += ch;
	} else if (raw[i + 1] === '"') {
		state.field += '"';
		return i + 1;
	} else {
		state.quoted = false;
	}
	return i;
}

/**
 * 处理引号外的一个字符
 *
 * @param {{rows: string[][], row: string[], field: string, quoted: boolean}} state 解析状态
 * @param {string} raw 原文
 * @param {number} i 当前下标
 * @param {string} delimiter 分隔符
 * @returns {number} 下一个待处理下标
 * @sideEffects **就地修改** state
 */
function consumeChar(state, raw, i, delimiter) {
	if (state.quoted) return consumeQuoted(state, raw, i);

	const ch = raw[i];
	if (ch === '"') state.quoted = true;
	else if (ch === delimiter) pushField(state);
	else if (ch === '\n') pushRow(state);
	else if (ch !== '\r') state.field += ch;
	return i;
}

/**
 * 解析分隔文本（支持双引号包裹与 `""` 转义）
 *
 * @param {string} text 原始文本
 * @param {object} [options] 选项
 * @param {'\t'|','|';'} [options.delimiter] 分隔符；不传则自动嗅探
 * @returns {string[][]} 二维数组（末行空行会被丢弃）
 * @sideEffects 无（纯函数）
 */
export function parseDelimited(text, options = {}) {
	const raw = String(text || '');
	const delimiter = options.delimiter || sniffDelimiter(raw);
	const state = { rows: [], row: [], field: '', quoted: false };

	for (let i = 0; i < raw.length; i++) {
		i = consumeChar(state, raw, i, delimiter);
	}

	if (state.field !== '' || state.row.length > 0) {
		state.row.push(state.field);
		state.rows.push(state.row);
	}
	return state.rows.filter((r) => r.length > 1 || (r[0] || '').trim() !== '');
}

/**
 * 补齐/截断每行的列数
 *
 * Excel 粘贴时常有末列缺失（用户只填了前 4 列），后续按下标取值会拿到 undefined。
 *
 * @param {string[][]} rows 二维数组
 * @param {number} width 目标列数
 * @param {string} [fill=''] 补位值
 * @returns {string[][]} 规整后的新数组
 * @sideEffects 无（纯函数）
 */
export function normalizeRows(rows, width, fill = '') {
	const w = Number.isFinite(Number(width)) ? Math.max(0, Math.floor(Number(width))) : 0;
	const list = Array.isArray(rows) ? rows : [];
	return list.map((row) => {
		const cells = Array.isArray(row) ? row.slice(0, w) : [];
		while (cells.length < w) cells.push(fill);
		return cells;
	});
}

/**
 * 生成 CSV 文本
 *
 * @param {string[][]} rows 二维数组
 * @param {object} [options] 选项
 * @param {string} [options.delimiter=','] 分隔符
 * @param {string} [options.newline='\r\n'] 换行（Excel 友好）
 * @returns {string} CSV 文本
 * @sideEffects 无（纯函数）
 */
export function toCsv(rows, options = {}) {
	const delimiter = options.delimiter || ',';
	const newline = options.newline || '\r\n';
	const list = Array.isArray(rows) ? rows : [];
	const escapeCell = (cell) => {
		const text = cell === null || cell === undefined ? '' : String(cell);
		const needsQuote = text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r');
		return needsQuote ? '"' + text.replace(/"/g, '""') + '"' : text;
	};
	return list.map((row) => (Array.isArray(row) ? row : [row]).map(escapeCell).join(delimiter)).join(newline);
}

/**
 * 判断当前环境是否具备「造 <a> + createObjectURL」的能力
 *
 * @param {Document} doc 文档对象
 * @param {object} urlApi URL 实现
 * @returns {boolean} 是否可下载
 * @sideEffects 无（纯函数）
 */
function canDownload(doc, urlApi) {
	return Boolean(doc && typeof doc.createElement === 'function' && urlApi && typeof urlApi.createObjectURL === 'function');
}

/**
 * 挂到 body → 点击 → 立刻摘掉（三步顺序不能调换）
 *
 * @param {Document} doc 文档对象
 * @param {object} a 临时链接元素
 * @returns {void}
 * @sideEffects DOM（appendChild / click / remove）
 */
function mountAndClick(doc, a) {
	if (doc.body && typeof doc.body.appendChild === 'function') doc.body.appendChild(a);
	if (typeof a.click === 'function') a.click();
	if (typeof a.remove === 'function') a.remove();
}

/**
 * 触发浏览器下载
 *
 * @param {string} fileName 文件名
 * @param {Blob} blob 内容
 * @param {object} [options] 选项
 * @param {Document} [options.doc=document] 文档对象（便于测试注入）
 * @param {object} [options.urlApi] URL 实现（默认 globalThis.URL）
 * @returns {boolean} 是否已触发
 * @sideEffects DOM（创建临时 <a> 并点击）、创建与释放 ObjectURL
 */
export function downloadBlob(fileName, blob, options = {}) {
	const doc = options.doc || globalThis.document;
	const urlApi = options.urlApi || globalThis.URL;
	if (!canDownload(doc, urlApi)) return false;

	const href = urlApi.createObjectURL(blob);
	const a = doc.createElement('a');
	a.href = href;
	a.download = fileName;
	mountAndClick(doc, a);
	if (typeof urlApi.revokeObjectURL === 'function') urlApi.revokeObjectURL(href);
	return true;
}

/**
 * 触发文本下载
 *
 * @param {string} fileName 文件名
 * @param {string} text 文本内容
 * @param {object} [options] 选项
 * @param {string} [options.mime='text/plain'] MIME
 * @param {boolean} [options.bom=false] 是否加 UTF-8 BOM（Excel 打开中文不乱码）
 * @param {Document} [options.doc] 文档对象
 * @param {object} [options.urlApi] URL 实现
 * @returns {boolean} 是否已触发
 * @sideEffects 同 downloadBlob
 */
export function downloadText(fileName, text, options = {}) {
	const mime = options.mime || 'text/plain';
	const body = options.bom ? '\ufeff' + String(text) : String(text);
	const blob = new Blob([body], { type: mime + ';charset=utf-8' });
	return downloadBlob(fileName, blob, options);
}
