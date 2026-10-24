/**
 * @//module/ app/working-hours/charts/legendHtml
 * @//description/ 生成主图 / 工程管理图的图例 HTML（纯函数，只输出字符串）
 * @//exports/ buildLegendHtml
 * @//dependencies/ core/util
 * @//example/ el.innerHTML = buildLegendHtml(data, { startIdx, endIdx, targetUuid: null })
 *
 * 图例只显示「当前缩放窗口里真的出现过」的工程，否则缩到一天也会列出一年的所有工程。
 * 这条规则容易在重构时丢掉，所以单独成模块 + 单测。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { escapeHtml } from '../../../core/util.js';

/**
 * 扫描窗口内出现的工程与是否有空闲时间
 *
 * @param {Array<object>} timeline 时间轴
 * @param {object} opts 参数
 * @param {number} opts.startIdx 起始下标
 * @param {number} opts.endIdx 结束下标
 * @param {string|null} opts.targetUuid 只统计某个工程
 * @returns {{visiblePIds: Set<string>, hasRestTime: boolean}} 扫描结果
 * @sideEffects 无（纯函数）
 */
function scanWindow(timeline, opts) {
	const visiblePIds = new Set();
	let hasRestTime = false;

	for (let i = opts.startIdx; i <= opts.endIdx; i += 1) {
		const slot = timeline[i];
		for (const pid in slot.rest) {
			if (opts.targetUuid && pid !== opts.targetUuid) continue;
			if (slot.rest[pid] > 0) hasRestTime = true;
		}
		for (const pid in slot.work) {
			if (opts.targetUuid && pid !== opts.targetUuid) continue;
			if (slot.work[pid] > 0) visiblePIds.add(pid);
		}
	}
	return { visiblePIds: visiblePIds, hasRestTime: hasRestTime };
}

/**
 * 生成图例 HTML
 *
 * @param {object} data 数据集
 * @param {Array<object>} data.timeline 时间轴
 * @param {Record<string, string>} data.projectMeta 工程名表
 * @param {string[]} data.sortedProjectIds 按工时排序的工程 id
 * @param {Record<string, string>} data.pidColorMap 工程颜色
 * @param {Set<string>} data.hiddenSeries 隐藏的 series 名
 * @param {object} opts 参数
 * @param {number} opts.startIdx 窗口起始下标
 * @param {number} opts.endIdx 窗口结束下标
 * @param {string|null} [opts.targetUuid=null] 只显示某个工程
 * @returns {string} 图例 HTML
 * @sideEffects 无（纯函数）
 */
export function buildLegendHtml(data, opts) {
	const scan = scanWindow(data.timeline, {
		startIdx: opts.startIdx,
		endIdx: opts.endIdx,
		targetUuid: opts.targetUuid || null,
	});
	const targetUuid = opts.targetUuid || null;

	let html = '';
	data.sortedProjectIds.forEach((pId) => {
		if (targetUuid && pId !== targetUuid) return;
		if (!scan.visiblePIds.has(pId)) return;
		const name = data.projectMeta[pId];
		const isHidden = data.hiddenSeries.has(name);
		html += `<div class="legend-item ${isHidden ? 'hidden' : ''}" data-name="${escapeHtml(name)}">
                        <span class="color-block" style="background:${data.pidColorMap[pId]};"></span>
                        <span style="font-size:11px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(name)}</span>
                    </div>`;
	});

	if (scan.visiblePIds.size > 0) {
		const isWorkHidden = data.hiddenSeries.has('工作时间');
		html += `<div class="legend-item ${isWorkHidden ? 'hidden' : ''}" data-name="工作时间">
                    <span class="color-block" style="background: linear-gradient(135deg, #5470c6, #91cc75, #fac858);"></span>
                    <span style="font-size:11px; font-weight:bold;">工作时间</span>
                </div>`;
	}
	if (scan.hasRestTime) {
		const isHidden = data.hiddenSeries.has('空闲时间');
		html += `<div class="legend-item ${isHidden ? 'hidden' : ''}" data-name="空闲时间">
                    <span class="color-block" style="background:var(--vscode-chart-rest);"></span><span style="font-size:11px; color:#aaa;">空闲时间</span>
                </div>`;
	}
	return html || '<div style="color:#666; font-size:11px;">当前区间无记录</div>';
}
