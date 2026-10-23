/**
 * @//module/ app/working-hours/exportReport
 * @//description/ 三种导出动作：单工程量图、全量趋势图、全量 JSON 备份（含用户信息、压缩、签名）
 * @//exports/ createExporter, safeFileName
 * @//dependencies/ ui/toast, core/log, app/working-hours/payload, app/working-hours/reportTemplate, app/working-hours/libInline, app/working-hours/exportPayload, app/working-hours/dayRange, app/working-hours/projectSummary, app/working-hours/backupCodec
 * @//example/ const exporter = createExporter({ ui, data, getUser })
 *            await exporter.exportTotalChart()
 *
 * 报告的数据组装在 `exportPayload.js`（纯函数、可单测），这里只管下载与错误提示。
 * 导出的 .html 必须能在**断网**环境打开，所以 echarts/fflate 走构建期内联（见 libInline.js）。
 * 全量 JSON 备份走 `backupCodec`：紧凑化 + gzip + 用户签名，导入时能校验归属与完整性。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { toast } from '../../ui/toast.js';
import { logger } from '../../core/log.js';
import { packPayload } from './payload.js';
import { buildLibTags, buildSecureReportHtml } from './reportTemplate.js';
import { getInlineLibs } from './libInline.js';
import { buildProjectPayload, buildTotalTrendPayload } from './exportPayload.js';
import { getDayAlignedIndices } from './dayRange.js';
import { packBackup } from './backupCodec.js';

/**
 * 触发浏览器下载
 *
 * @param {Blob} blob 内容
 * @param {string} fileName 文件名
 * @returns {void}
 * @sideEffects 创建并点击临时链接触发下载
 */
function download(blob, fileName) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * 把文件名里 Windows 不接受的字符换掉
 *
 * @param {string} name 原始名
 * @returns {string} 安全名
 * @sideEffects 无（纯函数）
 */
export function safeFileName(name) {
	return name.replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * 创建导出器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.ui 交互状态（读 activeTab / todayTs 之外的当前工程）
 * @param {object} ctx.data 数据集
 * @param {() => object|null} [ctx.getUser] 取当前用户信息（全量备份要写进文件并签名）
 * @returns {{exportProjectChart: Function, exportTotalChart: Function, exportAllDataJson: Function}} 导出器
 * @sideEffects 无（调用时才产生副作用）
 */
export function createExporter(ctx) {
	const data = ctx.data;

	/**
	 * 组装报告 HTML 并下载
	 *
	 * @param {object} payload 报告数据
	 * @param {string} fileNameBase 文件名（不含扩展名）
	 * @returns {Promise<void>}
	 * @sideEffects 下载文件 + 提示
	 */
	async function triggerSecureExport(payload, fileNameBase) {
		let securePack;
		try {
			securePack = await packPayload(payload);
		} catch (e) {
			logger.error('导出数据打包失败', e);
			toast('数据打包失败', 'error');
			return;
		}

		// 库源码在构建期内嵌（见 libInline.js）；取不到就明确报错，
		// 不再静默回退 CDN —— 那样只会得到一份「导出成功但图表全空」的废文件。
		const libs = getInlineLibs();
		if (!libs.echarts || !libs.fflate) {
			logger.error('导出失败：内嵌图表库缺失（fflate 未加载或构建未注入）');
			toast('导出失败：内置图表库缺失，请重装扩展', 'error');
			return;
		}

		const html = buildSecureReportHtml({
			fileName: fileNameBase,
			libTags: buildLibTags(libs.echarts, libs.fflate),
			data: securePack.data,
			hash: securePack.hash,
		});
		download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fileNameBase}.html`);
		toast('图表导出成功', 'success');
	}

	/**
	 * 导出单个工程的耗时图
	 *
	 * @param {string} uuid 工程 id
	 * @returns {Promise<void>}
	 * @sideEffects 下载文件
	 */
	async function exportProjectChart(uuid) {
		const pStat = data.projectStats[uuid];
		if (!pStat || pStat.startTs === Infinity) {
			toast('当前工程暂无可导出数据', 'warning');
			return;
		}
		const bounds = getDayAlignedIndices(pStat.startTs, pStat.endTs, data.timeline, data.tsMap, data.todayTs);
		await triggerSecureExport(buildProjectPayload(data, uuid, bounds), `工程耗时图_${safeFileName(pStat.name)}`);
	}

	/**
	 * 导出全部工程的总趋势图
	 *
	 * @returns {Promise<void>}
	 * @sideEffects 下载文件
	 */
	async function exportTotalChart() {
		if (data.timeline.length === 0) {
			toast('当前暂无可导出数据', 'warning');
			return;
		}
		const payload = buildTotalTrendPayload(data);
		if (!payload) {
			toast('当前记录全为空，无法导出', 'warning');
			return;
		}
		await triggerSecureExport(payload, '总趋势耗时图');
	}

	/**
	 * 导出全部原始数据为 JSON（备份用）
	 *
	 * 文件内容 = 用户信息 + 紧凑数据体 + gzip + HMAC 签名（见 `backupCodec.js`）：
	 * 同一份数据比旧版明文小一个数量级，且导入时能判断「是不是你的、有没有被改过」。
	 *
	 * @returns {Promise<void>}
	 * @sideEffects 下载文件
	 */
	async function exportAllDataJson() {
		if (data.timeline.length === 0) {
			toast('当前暂无可导出数据', 'warning');
			return;
		}
		const user = ctx.getUser ? ctx.getUser() : null;
		if (!user || !user.uuid) {
			toast('未获取到当前账号信息，无法生成备份', 'error');
			return;
		}

		const hasRecords = data.timeline.some((slot) => Object.keys(slot.work).length > 0 || Object.keys(slot.rest).length > 0);
		if (!hasRecords) {
			toast('所有时间片均为空，无有效数据导出', 'warning');
			return;
		}

		try {
			const envelope = await packBackup({ data: data, user: user });
			const d = new Date();
			const stamp = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`;
			download(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' }), `全部工程耗时数据备份_${stamp}.json`);
			toast('全部数据已压缩并签名导出', 'success');
		} catch (e) {
			logger.error('导出 JSON 失败', e);
			toast('导出失败: ' + (e && e.message ? e.message : '未知错误'), 'error');
		}
	}

	return {
		exportProjectChart: exportProjectChart,
		exportTotalChart: exportTotalChart,
		exportAllDataJson: exportAllDataJson,
	};
}
