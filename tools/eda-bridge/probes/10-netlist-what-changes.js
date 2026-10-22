/**
 * 探针 10：setNetlist 到底能改什么（**结束时还原**）
 *
 * 探针 09 发现：改 `props.Value` 后 `setNetlist` 返回 true，但读回没变化。
 * 必须分清是「属性类字段本来就不吃写回」还是「需要等一会儿才生效」，
 * 否则无法判断 `导入BOM`（改的就是 props）到底有没有用。
 *
 * 做法：分别改「属性」与「引脚网络」两类字段，写回后**立即读**和**延时读**各一次。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

const KEY = 'JLCEDA';
const read = async () => String((await (await eda.pcb_ManufactureData.getNetlistFile(KEY)).text()) || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const original = await read();
const base = JSON.parse(original);
const container = base.components || base;
const key = String(Object.keys(container)[0]);
const item = container[key];

const out = {
	version: eda.sys_Environment.getEditorCurrentVersion(),
	target: { key, designator: item && item.props ? item.props.Designator : null },
	originalValue: item && item.props ? item.props.Value : null,
	originalPin1Net: item && item.pinInfoMap && item.pinInfoMap['1'] ? item.pinInfoMap['1'].net : null,
	steps: [],
};

const readField = async () => {
	const j = JSON.parse(await read());
	const c = j.components || j;
	const it = c[key];
	return {
		value: it && it.props ? it.props.Value : null,
		pin1Net: it && it.pinInfoMap && it.pinInfoMap['1'] ? it.pinInfoMap['1'].net : null,
	};
};

// ---- 1) 改属性 ----
try {
	const m = JSON.parse(original);
	const mc = m.components || m;
	if (!mc[key].props) mc[key].props = {};
	mc[key].props.Value = '__PROP_TEST__';
	await eda.pcb_Net.setNetlist(KEY, JSON.stringify(m));
	out.steps.push({ step: '改 props.Value', immediate: await readField(), after600: await (async () => { await sleep(600); return readField(); })() });
} catch (e) {
	out.steps.push({ step: '改 props.Value', error: String((e && e.message) || e) });
}

// ---- 2) 改引脚网络 ----
try {
	const m = JSON.parse(original);
	const mc = m.components || m;
	if (mc[key].pinInfoMap && mc[key].pinInfoMap['1']) {
		mc[key].pinInfoMap['1'].net = '__NET_TEST__';
		mc[key].pinInfoMap['1'].name = '__NET_TEST__';
	}
	await eda.pcb_Net.setNetlist(KEY, JSON.stringify(m));
	out.steps.push({ step: '改 pinInfoMap[1].net', immediate: await readField(), after600: await (async () => { await sleep(600); return readField(); })() });
} catch (e) {
	out.steps.push({ step: '改 pinInfoMap[1].net', error: String((e && e.message) || e) });
}

// ---- 3) 还原 ----
try {
	await eda.pcb_Net.setNetlist(KEY, original);
	await sleep(300);
	out.restore = { byteIdentical: (await read()) === original, field: await readField() };
} catch (e) {
	out.restoreError = String((e && e.message) || e);
}

return out;
