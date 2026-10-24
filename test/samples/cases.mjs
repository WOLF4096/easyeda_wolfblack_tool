/**
 * 样本测试用例集
 *
 * 每条用例对全部样本跑一遍，返回 findings 数组：
 *   - level='error' 计入失败（退出码非 0）
 *   - level='warn'  只记录（样本自身的历史瑕疵，不算产品问题）
 *
 * 用例分四类（category，出现在报告里便于定位）：
 *   STRUCTURE 包结构与索引       FORMAT 文件格式
 *   SEMANTIC  语义自洽性         PLUGIN 产品代码行为（直接调 WolfCommon / pcbConstants）
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { majorOf } from './lib/loader.mjs';
import { extractLayer } from './lib/stats.mjs';

/** 构造一条 finding */
function finding(level, category, where, message, extra = {}) {
	return { level, category, where, message, ...extra };
}

/** 截断长文本，便于报告展示 */
function clip(text, max = 120) {
	const s = String(text ?? '');
	return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 行定位串：文档(短uuid) 第 N 行 */
function loc(sample, doc, lineNo) {
	const uid = String(doc.uuid || '').slice(0, 8) || `doc#${doc.index}`;
	return `${sample.name} › ${doc.docType}(${uid}) 第 ${lineNo} 行`;
}

/** 解析日志行（用产品代码，保证与线上行为一致） */
function splitLine(WC, line) {
	return WC.splitSourceLine(line.text);
}

/** V2 数组行解析 */
function parseArrayLine(line) {
	let arr = null;
	let error = null;
	try {
		arr = JSON.parse(line.text);
	} catch (e) {
		error = e.message;
	}
	return { arr, error };
}

/**
 * 图层合法性判断直接复用产品常量 isKnownLayer
 * （官方表 90 个命名层 + 铜层区间 15~46 + 基板层区间 361+）
 */
function buildLayerSet(PCB) {
	return new Set(PCB.VALID_LAYERS);
}

export function createCases() {
	return [
		{
			id: 'pkg.structure',
			category: 'STRUCTURE',
			title: '包结构与索引一致（必需条目、uuid 可寻址）',
			run({ samples }) {
				const findings = [];
				for (const sample of samples) {
					for (const err of sample.loadErrors) {
						findings.push(finding('error', 'STRUCTURE', err.where, err.message, { expected: err.expected, actual: err.actual }));
					}
					if (sample.packageKind === 'epro2') {
						const epru = sample.entries.filter((n) => n.toLowerCase().endsWith('.epru'));
						if (epru.length !== 1) {
							findings.push(
								finding('error', 'STRUCTURE', sample.name, `文档源文件数量应为 1，实际 ${epru.length}`, {
									expected: '1 个 .epru',
									actual: epru.join(', '),
								}),
							);
						}
					}
					if (sample.packageKind === 'epro') {
						const project = sample.project || {};
						for (const [uuid, sch] of Object.entries(project.schematics || {})) {
							const hasDir = sample.entries.some((n) => n.startsWith(`SHEET/${uuid}/`));
							if (!hasDir) {
								findings.push(
									finding(
										'error',
										'STRUCTURE',
										`${sample.name} › project.json`,
										`原理图 ${sch.name || uuid} 在包内找不到对应目录`,
										{
											expected: `SHEET/${uuid}/`,
											actual: '缺失',
										},
									),
								);
							}
						}
						for (const [uuid, name] of Object.entries(project.pcbs || {})) {
							const hasFile = sample.entries.some((n) => n === `PCB/${uuid}.epcb`);
							if (!hasFile) {
								findings.push(
									finding('error', 'STRUCTURE', `${sample.name} › project.json`, `PCB「${name}」找不到对应文件`, {
										expected: `PCB/${uuid}.epcb`,
										actual: '缺失',
									}),
								);
							}
						}
					}
				}
				return findings;
			},
		},

		{
			id: 'pkg.version',
			category: 'STRUCTURE',
			title: '版本可识别，且包内版本号自洽',
			run({ samples }) {
				const findings = [];
				for (const sample of samples) {
					if (sample.version === 'unknown') {
						findings.push(
							finding('error', 'STRUCTURE', sample.name, '无法识别版本族（editorVersion 缺失或主版本非 2/3/4）', {
								expected: 'V2 / V3 / V4',
								actual: sample.editorVersion || '(空)',
							}),
						);
						continue;
					}
					const major = majorOf(sample.editorVersion);
					// 日志格式：DOCHEAD.editVersion 的前两段应与工程 editorVersion 同代
					for (const doc of sample.docs.filter((d) => d.format === 'log' && d.head?.editVersion)) {
						const docMajor = majorOf(doc.head.editVersion);
						if (docMajor !== major) {
							findings.push(
								finding('warn', 'SEMANTIC', loc(sample, doc, 1), 'DOCHEAD.editVersion 与工程版本主号不一致', {
									expected: `主版本 ${major}`,
									actual: `${doc.head.editVersion}（主版本 ${docMajor}）`,
								}),
							);
						}
					}
				}
				return findings;
			},
		},

		{
			id: 'doc.parse',
			category: 'FORMAT',
			title: '每个文档的每一行都能被解析（外层/内层 JSON 合法）',
			run({ samples, WC }) {
				const findings = [];
				for (const sample of samples) {
					for (const doc of sample.docs) {
						for (const line of doc.lines) {
							if (doc.format === 'log') {
								const parsed = splitLine(WC, line);
								if (!parsed) {
									findings.push(
										finding('error', 'FORMAT', loc(sample, doc, line.no), '日志行无法切分或 JSON 非法', {
											expected: '{"type":...}||{...}|',
											actual: clip(line.text),
										}),
									);
									continue;
								}
								if (typeof parsed.leftObj.type !== 'string') {
									findings.push(
										finding('error', 'FORMAT', loc(sample, doc, line.no), '外层缺少字符串 type 字段', {
											expected: 'type: string',
											actual: clip(line.text.slice(0, 80)),
										}),
									);
								}
							} else {
								const { arr, error } = parseArrayLine(line);
								if (error) {
									findings.push(
										finding('error', 'FORMAT', loc(sample, doc, line.no), '数组行 JSON 解析失败: ' + error, {
											expected: '[...]',
											actual: clip(line.text),
										}),
									);
								} else if (Array.isArray(arr) && arr.length === 0) {
									// 样本里确实存在孤立的 [] 行（EDA 写盘残留），不影响解析，降级为警告
									findings.push(
										finding('warn', 'FORMAT', loc(sample, doc, line.no), '存在孤立空数组行 []（EDA 写盘残留）', {
											expected: '["TYPE", ...]',
											actual: '[]',
										}),
									);
								} else if (!Array.isArray(arr) || typeof arr[0] !== 'string') {
									findings.push(
										finding('error', 'FORMAT', loc(sample, doc, line.no), 'V2 行应为以字符串类型开头的数组', {
											expected: '["TYPE", ...]',
											actual: clip(line.text),
										}),
									);
								}
							}
						}
					}
				}
				return findings;
			},
		},

		{
			id: 'doc.head',
			category: 'FORMAT',
			title: '文档头齐全（DOCHEAD / DOCTYPE + HEAD 在首位）',
			run({ samples, WC }) {
				const findings = [];
				for (const sample of samples) {
					if (sample.docs.length === 0) {
						findings.push(finding('error', 'FORMAT', sample.name, '样本内没有任何文档', { expected: '≥1', actual: '0' }));
						continue;
					}
					for (const doc of sample.docs) {
						if (doc.format === 'log') {
							if (!doc.head) {
								findings.push(
									finding('error', 'FORMAT', loc(sample, doc, doc.lines[0]?.no || 1), 'DOCHEAD 内层无法解析', {
										expected: '{docType,uuid,...}',
										actual: clip(doc.lines[0]?.text),
									}),
								);
								continue;
							}
							for (const key of ['docType', 'uuid']) {
								if (!doc.head[key]) {
									findings.push(
										finding('error', 'FORMAT', loc(sample, doc, doc.lines[0]?.no || 1), `DOCHEAD 缺少必需字段 ${key}`, {
											expected: key,
											actual: JSON.stringify(doc.head),
										}),
									);
								}
							}
							const first = splitLine(WC, doc.lines[0]);
							if (!first || first.leftObj.type !== 'DOCHEAD') {
								findings.push(
									finding('error', 'FORMAT', loc(sample, doc, doc.lines[0]?.no || 1), '文档首行不是 DOCHEAD', {
										expected: 'DOCHEAD',
										actual: clip(doc.lines[0]?.text),
									}),
								);
							}
						} else {
							const first = parseArrayLine(doc.lines[0] || { text: '' }).arr;
							if (!first || first[0] !== 'DOCTYPE') {
								findings.push(
									finding('error', 'FORMAT', loc(sample, doc, doc.lines[0]?.no || 1), 'V2 文档首行不是 DOCTYPE', {
										expected: '["DOCTYPE", ...]',
										actual: clip(doc.lines[0]?.text),
									}),
								);
							}
							// 实测：SCH / PCB / SYMBOL 第二行是 HEAD；FOOTPRINT 直接进 LAYER/CANVAS（无 HEAD）
							const second = parseArrayLine(doc.lines[1] || { text: '' }).arr;
							if (doc.docType === 'FOOTPRINT') {
								if (second && second[0] === 'HEAD') {
									findings.push(
										finding(
											'warn',
											'FORMAT',
											loc(sample, doc, doc.lines[1].no),
											'FOOTPRINT 出现 HEAD 行（历史样本中未见过，需确认是否为格式变化）',
											{
												expected: '无 HEAD',
												actual: clip(doc.lines[1].text),
											},
										),
									);
								}
							} else if (!second || second[0] !== 'HEAD') {
								findings.push(
									finding('error', 'FORMAT', loc(sample, doc, doc.lines[1]?.no || 2), `${doc.docType} 文档第二行不是 HEAD`, {
										expected: '["HEAD", {...}]',
										actual: clip(doc.lines[1]?.text),
									}),
								);
							}
						}
					}
				}
				return findings;
			},
		},

		{
			id: 'doc.id-unique',
			category: 'SEMANTIC',
			title: '同一文档内图元 id 唯一',
			run({ samples, WC }) {
				const findings = [];
				for (const sample of samples) {
					for (const doc of sample.docs.filter((d) => d.format === 'log')) {
						const seen = new Map();
						for (const line of doc.lines) {
							const parsed = splitLine(WC, line);
							const id = parsed?.leftObj?.id;
							if (!id) continue;
							if (seen.has(id)) {
								findings.push(
									finding('error', 'SEMANTIC', loc(sample, doc, line.no), `id「${id}」重复（首次出现在第 ${seen.get(id)} 行）`, {
										expected: '同一文档内唯一',
										actual: `${id} × 2`,
									}),
								);
							} else {
								seen.set(id, line.no);
							}
						}
					}
				}
				return findings;
			},
		},

		{
			id: 'atom.ticket',
			category: 'SEMANTIC',
			title: 'ticket 为合法正整数（允许缺省）',
			run({ samples, WC }) {
				const findings = [];
				for (const sample of samples) {
					for (const doc of sample.docs.filter((d) => d.format === 'log')) {
						for (const line of doc.lines) {
							const ticket = splitLine(WC, line)?.leftObj?.ticket;
							if (ticket === undefined) continue;
							if (typeof ticket !== 'number' || !Number.isInteger(ticket) || ticket <= 0) {
								findings.push(
									finding('error', 'SEMANTIC', loc(sample, doc, line.no), 'ticket 必须为正整数或省略', {
										expected: 'integer > 0 | undefined',
										actual: JSON.stringify(ticket),
									}),
								);
							}
						}
					}
				}
				return findings;
			},
		},

		{
			id: 'atom.layer',
			category: 'SEMANTIC',
			title: '图元 layer 落在官方图层表内',
			run({ samples, WC, PCB }) {
				const allowed = buildLayerSet(PCB);
				const findings = [];
				const used = new Map();
				for (const sample of samples) {
					for (const doc of sample.docs) {
						for (const line of doc.lines) {
							const payload = doc.format === 'log' ? splitLine(WC, line)?.rightObj : parseArrayLine(line).arr;
							const layer = extractLayer(doc, payload);
							if (typeof layer !== 'number') continue;
							used.set(layer, (used.get(layer) || 0) + 1);
							if (!PCB.isKnownLayer(layer)) {
								findings.push(
									finding('error', 'SEMANTIC', loc(sample, doc, line.no), `layer=${layer} 不在官方图层表内`, {
										expected: `∈ {${[...allowed].length} 个合法值}`,
										actual: String(layer),
									}),
								);
							}
						}
					}
				}
				this.observedLayers = used;
				// 覆盖面守护：一个含 PCB/FOOTPRINT 的样本应当能观测到图层，否则说明字段名变了（如 layer→layerId）
				if (used.size === 0) {
					findings.push(
						finding('error', 'SEMANTIC', '（全部样本）', '未能从任何样本中提取到 layer，字段名可能已变更（V3/V4 用 layerId）', {
							expected: '≥1 个图层取值',
							actual: '0',
						}),
					);
				}
				return findings;
			},
		},

		{
			id: 'write.roundtrip',
			category: 'PLUGIN',
			title: '源码行「切分→拼装」逐字节可还原（改写不破坏文档）',
			run({ samples, WC }) {
				const findings = [];
				let checked = 0;
				for (const sample of samples) {
					for (const doc of sample.docs.filter((d) => d.format === 'log')) {
						for (const line of doc.lines) {
							const parsed = splitLine(WC, line);
							if (!parsed) continue; // 由 doc.parse 用例报告
							checked++;
							const back = WC.joinSourceLine(parsed.leftStr, parsed.rightStr, parsed.hasTrailingPipe);
							if (back !== line.text) {
								findings.push(
									finding('error', 'PLUGIN', loc(sample, doc, line.no), '往返后与原文不一致（改写会破坏该行）', {
										expected: clip(line.text),
										actual: clip(back),
									}),
								);
							}
						}
					}
				}
				this.checkedLines = checked;
				return findings;
			},
		},

		{
			id: 'write.trailing-pipe',
			category: 'PLUGIN',
			title: '无行尾 | 的行不会被擅自补上',
			run({ samples, WC }) {
				const findings = [];
				let missing = 0;
				for (const sample of samples) {
					for (const doc of sample.docs.filter((d) => d.format === 'log')) {
						for (const line of doc.lines) {
							const parsed = splitLine(WC, line);
							if (!parsed || parsed.hasTrailingPipe) continue;
							missing++;
							const back = WC.joinSourceLine(parsed.leftStr, parsed.rightStr, false);
							if (back.endsWith('|')) {
								findings.push(
									finding('error', 'PLUGIN', loc(sample, doc, line.no), '原行无行尾 |，拼装后却被补上', {
										expected: clip(line.text),
										actual: clip(back),
									}),
								);
							}
						}
					}
				}
				this.missingTailCount = missing;
				if (missing === 0) {
					findings.push(finding('warn', 'PLUGIN', '（全部样本）', '样本中没有「缺行尾 |」的行，该分支未被真实数据覆盖'));
				}
				return findings;
			},
		},

		{
			id: 'plugin.layer-consts',
			category: 'PLUGIN',
			title: '图层常量与样本实际取值一致（MULTI=12、铜层判定）',
			run({ samples, WC, PCB }) {
				const findings = [];
				const observed = new Set();
				for (const sample of samples) {
					for (const doc of sample.docs) {
						for (const line of doc.lines) {
							const payload = doc.format === 'log' ? splitLine(WC, line)?.rightObj : parseArrayLine(line).arr;
							const layer = extractLayer(doc, payload);
							if (typeof layer === 'number') observed.add(layer);
						}
					}
				}
				const expect = (cond, message, expected, actual) => {
					if (!cond) findings.push(finding('error', 'PLUGIN', '（全部样本）', message, { expected, actual }));
				};
				expect(PCB.LAYER.MULTI === 12, 'pcbConstants.LAYER.MULTI 应为 12（多层）', '12', String(PCB.LAYER.MULTI));
				expect(PCB.isThroughHoleLayer(12) === true, '12 应判定为通孔层', 'true', String(PCB.isThroughHoleLayer(12)));
				expect(PCB.isCopperLayer(12) === false, '12 是「多层」，不属于单一铜层', 'false', String(PCB.isCopperLayer(12)));
				expect(PCB.isCopperLayer(1) && PCB.isCopperLayer(2), '顶层/底层应判定为铜层', 'true', String(PCB.isCopperLayer(1)));
				expect(PCB.isInnerLayer(15) && PCB.isInnerLayer(46), '15~46 应判定为内层', 'true', String(PCB.isInnerLayer(46)));
				expect(PCB.isCopperLayer(47) === false, '47（孔层）不属于铜层', 'false', String(PCB.isCopperLayer(47)));
				// 前后端两套 bundle 各有一份 LAYER，同名项必须一致（否则页面用的层号会和后端判断打架）
				for (const [name, value] of Object.entries(WC.LAYER)) {
					if (PCB.LAYER[name] !== value) {
						findings.push(
							finding('error', 'PLUGIN', '（全部样本）', `前端 LAYER.${name} 与后端常量不一致`, {
								expected: `src/js/common/pcbConstants.js → ${PCB.LAYER[name]}`,
								actual: `iframe/js/common.js → ${value}`,
							}),
						);
					}
				}
				if (!observed.has(12)) {
					findings.push(finding('warn', 'PLUGIN', '（全部样本）', '样本中未出现 MULTI(12) 图元，通孔层判定未被真实数据覆盖'));
				}
				this.observedLayers = [...observed].sort((a, b) => a - b);
				return findings;
			},
		},
	];
}
