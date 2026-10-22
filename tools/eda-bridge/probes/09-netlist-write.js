/**
 * 探针 09：网表字段修改能否落盘（**会写网表并在结束时还原**）
 *
 * `导入BOM` 的真实假设是：改 `components[x].props.Value` 之类的字段 → `setNetlist` 写回
 * → 工程数据真的变了。这里验证：改一个器件 → 读回确认 → **立刻写回原文复原**。
 *
 * 全过程在一个探针里完成，任何中途失败也会尝试复原。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const KEY = 'JLCEDA';
const read = async () => String((await (await eda.pcb_ManufactureData.getNetlistFile(KEY)).text()) || '');

const out = { version: eda.sys_Environment.getEditorCurrentVersion() };
const original = await read();
const beforeJson = JSON.parse(original);
const container = beforeJson.components || beforeJson;
const firstKey = Object.keys(container)[0];
const item = container[firstKey];

out.target = { key: firstKey, designator: item && item.props ? item.props.Designator : null };
out.originalValue = item && item.props ? item.props.Value : null;

const MARK = '__WOLF_TEST__';

try {
	// 1) 改字段并写回
	const mutated = JSON.parse(original);
	const mutContainer = mutated.components || mutated;
	const mutItem = mutContainer[firstKey];
	if (!mutItem.props) mutItem.props = {};
	mutItem.props.Value = MARK;
	const okWrite = await eda.pcb_Net.setNetlist(KEY, JSON.stringify(mutated));
	out.writeReturn = okWrite === undefined ? 'undefined' : okWrite;

	// 2) 读回确认
	const afterText = await read();
	const afterJson = JSON.parse(afterText);
	const afterItem = (afterJson.components || afterJson)[firstKey];
	out.valueAfterWrite = afterItem && afterItem.props ? afterItem.props.Value : null;
	out.landed = out.valueAfterWrite === MARK;
} catch (e) {
	out.error = String((e && e.stack) || e);
}

// 3) 无论成败都复原
try {
	const okRestore = await eda.pcb_Net.setNetlist(KEY, original);
	const restoredText = await read();
	const restoredJson = JSON.parse(restoredText);
	const restoredItem = (restoredJson.components || restoredJson)[firstKey];
	out.restore = {
		writeReturn: okRestore === undefined ? 'undefined' : okRestore,
		value: restoredItem && restoredItem.props ? restoredItem.props.Value : null,
		byteIdentical: restoredText === original,
	};
} catch (e) {
	out.restoreError = String((e && e.stack) || e);
}

return out;
