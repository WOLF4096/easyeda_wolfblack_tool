/**
 * 探针 01：API 面核对
 *
 * 输入（由 `--arg-file` 传入）：字符串数组，如 ["pcb_Net.getAllNets", "sys_Log.add"]
 * 输出：整体统计 + 缺失清单（附「缺在哪一段」）
 *
 * 用途：源码里出现的每一个 `eda.*` 调用，都在真实 EDA 里验证一次存在性。
 * 这类问题最隐蔽——调用不存在的 API 只会抛 TypeError，然后被 catch 吞掉或提示成别的原因。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const paths = Array.isArray(arg) ? arg : [];
const missing = [];
const present = [];

for (const p of paths) {
	let cur = typeof eda !== 'undefined' ? eda : null;
	let missingAt = null;
	for (const seg of String(p).split('.')) {
		if (cur === null || cur === undefined || !(seg in Object(cur))) {
			missingAt = seg;
			break;
		}
		cur = cur[seg];
	}
	if (missingAt) missing.push({ path: p, missingAt, type: 'MISSING' });
	else present.push({ path: p, type: typeof cur });
}

// 带点的路径应当是函数；若存在但不是函数，说明名字撞上了同名属性，也要报出来
const notFunction = present.filter((x) => x.path.includes('.') && x.type !== 'function');

return {
	version: eda.sys_Environment.getEditorCurrentVersion(),
	total: paths.length,
	present: present.length,
	missingCount: missing.length,
	missing,
	notFunction,
};
