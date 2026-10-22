/**
 * @//module/ core/netlist
 * @//description/ 网表读取/写回与 V2-V3 组件容器获取（PCB 与原理图两侧 API 名称在此归一）
 * @//exports/ getNetlist, setNetlist, getComponentsContainer
 * @//dependencies/ core/eda, core/log
 * @//example/ const { getNetlist, setNetlist } = await import('./core/netlist.js')
 *            const { page, json } = await getNetlist('AUTO')
 *            await setNetlist(page, json)
 */

import { NETLIST_KEY, getEda } from './eda.js';
import { logger } from './log.js';

/**
 * 读取一个网表文件并解析
 *
 * 两种「空」都要拦：`getNetlistFile()` 在「当前文档没有网表」时返回 `undefined`，
 * 文件内容为空时也是空串 —— 这两种情况原先都会抛出 `Cannot read properties of undefined`，
 * 用户看到的却是笼统的「网表读取失败」，看不出真实原因。
 *
 * @param {() => Promise<Blob|undefined>} getFile 取文件的方法
 * @param {'PCB'|'SCH'} page 来源
 * @returns {Promise<{page: 'PCB'|'SCH', text: string, json: object}>} 来源、原文、解析结果
 * @throws {Error} 文件不存在 / 内容为空 / JSON 无法解析
 * @sideEffects eda API（经 getFile 间接调用）、读取 Blob
 */
async function readNetlistFile(getFile, page) {
	const file = await getFile();
	if (!file) throw new Error('获取的网表为空');
	const text = await file.text();
	if (!text || !text.trim()) throw new Error('获取的网表为空');
	let json;
	try {
		json = JSON.parse(text);
	} catch (e) {
		throw new Error(`网表格式无法解析（${page}）：${(e && e.message) || e}`);
	}
	return { page: page, text: text, json: json };
}

/**
 * 读取网表
 *
 * @param {'AUTO'|'PCB'|'SCH'} [page='AUTO'] 来源页面；AUTO 先试 PCB 再回退 SCH
 * @returns {Promise<{page: 'PCB'|'SCH', text: string, json: object}>} 来源、原文、解析结果
 * @throws {Error} 指定来源读取失败（或 AUTO 下两个来源都失败）时抛出，消息可直接展示给用户
 * @sideEffects eda API（pcb_ManufactureData / sch_ManufactureData）
 */
export async function getNetlist(page = 'AUTO') {
	const edaObj = getEda();
	if (!edaObj) {
		throw new Error('未检测到 EDA 运行环境');
	}

	const readPcb = () => readNetlistFile(() => edaObj.pcb_ManufactureData.getNetlistFile(NETLIST_KEY), 'PCB');
	const readSch = () => readNetlistFile(() => edaObj.sch_ManufactureData.getNetlistFile(NETLIST_KEY), 'SCH');

	if (page === 'PCB') return readPcb();
	if (page === 'SCH') return readSch();

	// AUTO：PCB 优先，失败回退 SCH（SCH 的异常向上抛，由调用方提示）
	try {
		return await readPcb();
	} catch (pcbError) {
		logger.debug('PCB 网表不可用，回退原理图网表：', pcbError);
		return readSch();
	}
}

/**
 * 写回网表
 *
 * PCB 侧与原理图侧的 API 名称不对称（`pcb_Net` vs `sch_Netlist`），在此统一。
 *
 * @param {'AUTO'|'PCB'|'SCH'} page 写回目标；AUTO 先试 PCB 再回退 SCH
 * @param {string|object} json 网表 JSON（传对象会自动 JSON.stringify，不美化）
 * @returns {Promise<'PCB'|'SCH'>} 实际写入的来源
 * @throws {Error} 写入失败时抛出
 * @sideEffects eda API（pcb_Net / sch_Netlist 写入）
 */
export async function setNetlist(page, json) {
	const edaObj = getEda();
	if (!edaObj) {
		throw new Error('未检测到 EDA 运行环境');
	}
	const text = typeof json === 'string' ? json : JSON.stringify(json);

	const writePcb = () => edaObj.pcb_Net.setNetlist(NETLIST_KEY, text);
	const writeSch = () => edaObj.sch_Netlist.setNetlist(NETLIST_KEY, text);

	if (page === 'PCB') {
		await writePcb();
		return 'PCB';
	}
	if (page === 'SCH') {
		await writeSch();
		return 'SCH';
	}

	try {
		await writePcb();
		return 'PCB';
	} catch (pcbError) {
		await writeSch();
		return 'SCH';
	}
}

/**
 * 取网表中的组件容器
 *
 * V3/V4 在 `{ components: {...} }` 里，V2 直接是根对象。
 * 不做深拷贝，返回的是原引用，调用方改属性即改原网表对象。
 *
 * @param {object} netlistObj 已解析的网表对象
 * @returns {object} 组件容器（入参为假值时返回空对象）
 * @sideEffects 无（纯函数）
 */
export function getComponentsContainer(netlistObj) {
	if (!netlistObj) return {};
	return netlistObj.components ? netlistObj.components : netlistObj;
}
