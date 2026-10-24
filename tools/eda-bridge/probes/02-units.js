/**
 * 探针 02：坐标量级与图元载荷对比
 *
 * 背景：`docs/FORMATLOG.md` 记着「V4 的 PCB 坐标改 mil、网格 ×10」。这条如果成立，
 * 那么「点合并容差」「坐标搬运」这类死数值就得跟着换算。判据只有一个：
 * **同一个 PCB 文档在两个版本里，同一批图元的坐标数值是否差 10 倍。**
 *
 * 做法：读当前文档源码，按格式取前几个 LINE / ARC / PAD / VIA / POLY，
 * 原样回传载荷（截断），由外部对比数值，不在探针里猜字段位置。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

const src = await eda.sys_FileManager.getDocumentSource();
const lines = String(src || '')
	.split('\n')
	.filter((l) => l.trim());
const isLog = lines.length > 0 && lines[0].includes('||');

/**
 * 取一行的图元类型
 *
 * 不能直接 `line.includes('"PAD"')`：V2 源码里有 `["PRIMITIVE","PAD",1,1]` 这类**声明行**，
 * 会把数量算多。这里解析后按真实结构取类型。
 */
function typeOf(line) {
	try {
		if (isLog) {
			const i = line.indexOf('||');
			if (i < 0) return null;
			return JSON.parse(line.slice(0, i)).type || null;
		}
		const arr = JSON.parse(line);
		if (!Array.isArray(arr)) return null;
		if (arr[0] === 'PRIMITIVE') return null; // 声明行，不是图元实例
		return typeof arr[0] === 'string' ? arr[0] : null;
	} catch (e) {
		return null;
	}
}

const WANT = ['LINE', 'ARC', 'PAD', 'VIA', 'POLY', 'REGION', 'FILL'];
const byType = {};
const samples = {};
for (const t of WANT) {
	byType[t] = 0;
	samples[t] = [];
}
for (const line of lines) {
	const t = typeOf(line);
	if (!t || !(t in byType)) continue;
	byType[t]++;
	if (samples[t].length < 2) samples[t].push(line.slice(0, 400));
}

// CANVAS 行单独取：里面写着单位与网格步长
const canvasLine = lines.find((l) => typeOf(l) === 'CANVAS') || '';

return {
	version: eda.sys_Environment.getEditorCurrentVersion(),
	format: isLog ? 'LOG(V3/V4)' : 'ARRAY(V2)',
	totalLines: lines.length,
	canvas: canvasLine.slice(0, 400),
	counts: byType,
	samples,
};
