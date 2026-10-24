/**
 * 样本装载层
 *
 * 职责：把「工程文件」变成结构化的 `{ 样本 → 文档 → 行 }`，不关心具体断言。
 *
 * 支持三种形态（依据实测，见 docs/FORMATLOG.md 与 测试样本/ 真实文件）：
 *   V2.2  `.epro`   —— zip 包，每个文档一个文件：SHEET/<uuid>/<id>.esch、PCB/<uuid>.epcb …
 *   V3.x  `.epro2`  —— zip 包，project2.json + 单个 .epru（全部文档的日志行连在一起）
 *   V4.x  `.epro2`  —— 同上，格式同构，DOCHEAD 字段与 ticket 习惯不同
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';

/** 样本扩展名 */
export const SAMPLE_EXTENSIONS = ['.epro', '.epro2'];

/** V2 包内「文档文件」扩展名 → docType */
const V2_DOC_EXTENSIONS = {
	'.esch': 'SCH_PAGE',
	'.epcb': 'PCB',
	'.esym': 'SYMBOL',
	'.efoo': 'FOOTPRINT',
	'.epan': 'PANEL',
};

/**
 * 扫描目录下的样本文件（按文件名排序，保证输出稳定）
 * @param {string} dir
 * @returns {string[]} 绝对路径
 */
export function discoverSamples(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => SAMPLE_EXTENSIONS.includes(path.extname(name).toLowerCase()))
		.sort()
		.map((name) => path.join(dir, name));
}

/**
 * 把文本按行拆开，保留行号（1-based），自动忽略空行
 * @param {string} text
 * @returns {{no: number, text: string}[]}
 */
export function toLines(text) {
	const out = [];
	const raw = text.split('\n');
	for (let i = 0; i < raw.length; i++) {
		const line = raw[i].replace(/\r$/, '');
		if (!line.trim()) continue;
		out.push({ no: i + 1, text: line });
	}
	return out;
}

/**
 * 取版本主号（'3.2.149.88089769' → 3）
 * @param {string} version
 * @returns {number|null}
 */
export function majorOf(version) {
	const m = String(version || '').match(/^(\d+)/);
	return m ? Number(m[1]) : null;
}

/**
 * 主版本号 → 版本族
 * @param {number|null} major
 * @returns {'V2'|'V3'|'V4'|'unknown'}
 */
export function versionFamilyOf(major) {
	if (major === 2) return 'V2';
	if (major === 3) return 'V3';
	if (major === 4) return 'V4';
	return 'unknown';
}

/**
 * 装载单个样本
 * @param {string} file - 样本绝对路径
 * @returns {Promise<Object>} 样本对象
 */
export async function loadSample(file) {
	const sizeBytes = fs.statSync(file).size;
	const zip = await JSZip.loadAsync(fs.readFileSync(file));
	const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

	const sample = {
		file,
		name: path.basename(file),
		sizeBytes,
		entries,
		packageKind: null,
		version: 'unknown',
		editorVersion: '',
		docs: [],
		loadErrors: [],
	};

	if (entries.includes('project2.json')) {
		await loadModernPackage(zip, sample);
	} else if (entries.includes('project.json')) {
		await loadLegacyPackage(zip, sample);
	} else {
		sample.loadErrors.push({
			where: sample.name,
			message: '既不是 .epro2（缺 project2.json）也不是 .epro（缺 project.json），无法识别包形态',
			expected: 'project2.json 或 project.json',
			actual: entries.slice(0, 5).join(', ') || '（空包）',
		});
	}

	return sample;
}

/** V3/V4 包：project2.json + 单个 .epru，按 DOCHEAD 切段 */
async function loadModernPackage(zip, sample) {
	sample.packageKind = 'epro2';

	let project = null;
	try {
		project = JSON.parse(await zip.file('project2.json').async('string'));
	} catch (e) {
		sample.loadErrors.push({ where: 'project2.json', message: 'JSON 解析失败: ' + e.message, expected: '合法 JSON', actual: '' });
	}
	sample.editorVersion = project?.editorVersion || '';
	sample.version = versionFamilyOf(majorOf(sample.editorVersion));

	const epruName = sample.entries.find((name) => name.toLowerCase().endsWith('.epru'));
	if (!epruName) {
		sample.loadErrors.push({ where: sample.name, message: '缺少 .epru 文档源文件', expected: '*.epru', actual: sample.entries.join(', ') });
		return;
	}

	const text = await zip.file(epruName).async('string');
	const lines = toLines(text);

	// 按 DOCHEAD 切段：每个 DOCHEAD 开启一个新文档
	let current = null;
	for (const line of lines) {
		let outer = null;
		const sep = line.text.indexOf('||');
		if (sep > 0) {
			try {
				outer = JSON.parse(line.text.slice(0, sep));
			} catch (e) {
				/* 交给 doc-parse 用例报告 */
			}
		}
		if (outer && outer.type === 'DOCHEAD') {
			let inner = null;
			try {
				const tail = line.text.endsWith('|');
				inner = JSON.parse(line.text.slice(sep + 2, tail ? -1 : undefined));
			} catch (e) {
				/* 同上 */
			}
			current = {
				index: sample.docs.length,
				docType: inner?.docType || '(unknown)',
				uuid: inner?.uuid || '',
				head: inner || null,
				entry: epruName,
				format: 'log',
				lines: [],
			};
			sample.docs.push(current);
		}
		if (current) current.lines.push(line);
	}

	if (sample.docs.length === 0) {
		sample.loadErrors.push({ where: epruName, message: '未找到任何 DOCHEAD，无法切分文档', expected: '≥1 个 DOCHEAD', actual: '0' });
	}
}

/** V2 包：project.json + 每文档一个文件（数组格式） */
async function loadLegacyPackage(zip, sample) {
	sample.packageKind = 'epro';

	let project = null;
	try {
		project = JSON.parse(await zip.file('project.json').async('string'));
	} catch (e) {
		sample.loadErrors.push({ where: 'project.json', message: 'JSON 解析失败: ' + e.message, expected: '合法 JSON', actual: '' });
	}
	sample.project = project || null;

	const docEntries = sample.entries.filter((name) => Object.keys(V2_DOC_EXTENSIONS).some((ext) => name.toLowerCase().endsWith(ext)));
	for (const entry of docEntries.sort()) {
		const text = await zip.file(entry).async('string');
		const ext = path.extname(entry).toLowerCase();
		const firstLine = toLines(text)[0];
		let docType = V2_DOC_EXTENSIONS[ext];
		let uuid = path.basename(entry, ext);
		if (firstLine) {
			try {
				const arr = JSON.parse(firstLine.text);
				if (Array.isArray(arr) && arr[0] === 'DOCTYPE' && typeof arr[1] === 'string') docType = arr[1];
			} catch (e) {
				/* 交给 doc-parse */
			}
		}
		// V2 包内路径形如 SHEET/<schUuid>/<sheetId>.esch，文件名是 sheetId 而非 uuid
		const parts = entry.split('/');
		if (parts.length >= 2 && ext === '.esch') uuid = parts[1];

		sample.docs.push({
			index: sample.docs.length,
			docType,
			uuid,
			head: null,
			entry,
			format: 'array',
			lines: toLines(text),
		});
	}

	// V2 版本号藏在 .epcb 的 HEAD 里
	const pcbDoc = sample.docs.find((doc) => doc.docType === 'PCB');
	if (pcbDoc) {
		for (const line of pcbDoc.lines) {
			try {
				const arr = JSON.parse(line.text);
				if (arr[0] === 'HEAD' && arr[1] && typeof arr[1].editorVersion === 'string') {
					sample.editorVersion = arr[1].editorVersion;
					break;
				}
			} catch (e) {
				/* ignore */
			}
		}
	}
	sample.version = versionFamilyOf(majorOf(sample.editorVersion));

	if (sample.docs.length === 0) {
		sample.loadErrors.push({
			where: sample.name,
			message: '包内没有任何文档文件',
			expected: '.esch/.epcb/.esym/.efoo',
			actual: sample.entries.join(', '),
		});
	}
}

/**
 * 装载目录下全部样本
 * @param {string} dir
 * @returns {Promise<Object[]>}
 */
export async function loadAllSamples(dir) {
	const files = discoverSamples(dir);
	const samples = [];
	for (const file of files) {
		samples.push(await loadSample(file));
	}
	return samples;
}
