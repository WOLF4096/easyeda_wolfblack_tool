/**
 * @//module/ app/about/index
 * @//description/ 页面编排：把功能清单渲染成「主行 + 详情行」的手风琴表格，并处理图片浮窗
 * @//exports/ 无
 * @//dependencies/ core/util, app/about/features
 * @//example/ 页面入口，由 iframe/About.html 加载打包产物 app/About.js
 */

import { escapeHtml } from '../../core/util.js';
import { featuresData } from './features.js';

/**
 * 生成环境标签（PCB / 原理图 / 全局）
 *
 * @param {string[]} scope 适用环境
 * @returns {string} HTML 片段
 * @sideEffects 无（纯函数）
 */
function scopeTags(scope) {
	if (!Array.isArray(scope)) return '';
	const classOf = (name) => (name === '原理图' ? 'sch' : name === '全局' ? 'global' : 'pcb');
	const tags = scope.map((name) => `<span class="tag tag-scope ${classOf(name)}">${escapeHtml(name)}</span>`).join('');
	return scope.length > 1 ? `<div class="tag-row">${tags}</div>` : tags;
}

/**
 * 生成名称列（含快捷键标签）
 *
 * @param {object} item 功能条目
 * @returns {string} HTML 片段
 * @sideEffects 无（纯函数）
 */
function nameCell(item) {
	if (!item.shortcut) return escapeHtml(item.name);
	const scType = item.shortcutType || 'sch';
	return `
					<div class="env-stack">
						<span>${escapeHtml(item.name)}</span>
						<span class="tag tag-scope ${escapeHtml(scType)}">${escapeHtml(item.shortcut)}</span>
					</div>
				`;
}

/**
 * 渲染整张功能表
 *
 * @param {HTMLElement} tbody 表格主体
 * @returns {void}
 * @sideEffects DOM
 */
function renderTable(tbody) {
	for (const item of featuresData) {
		const link = item.demoUrl ? `<a href="${escapeHtml(item.demoUrl)}" target="_blank">打开</a>` : '<span class="muted">暂无</span>';
		const envAndVersion = `
				<div class="env-stack">
					${scopeTags(item.scope)}
					<span class="ver-text">${escapeHtml(item.version)}</span>
				</div>
			`;

		const mainRow = document.createElement('tr');
		mainRow.className = 'main-row';
		mainRow.innerHTML = `
				<td class="name-col">${nameCell(item)}</td>
				<td class="brief-col">${escapeHtml(item.brief)}</td>
				<td>${envAndVersion}</td>
				<td>${link}</td>
			`;

		// purpose / usage 允许内嵌简单 HTML（如 <br/>），这里按 HTML 处理
		const detailsRow = document.createElement('tr');
		detailsRow.className = 'details-row';
		detailsRow.innerHTML = `
				<td colspan="4" class="details-cell">
					<div class="details-content">
						<h4><span class="purpose-tag">开发目的</span></h4>
						<p>${item.purpose || ''}</p>
						<h4><span class="usage-tag">使用方法</span></h4>
						<p>${item.usage || ''}</p>
					</div>
				</td>
			`;

		tbody.appendChild(mainRow);
		tbody.appendChild(detailsRow);

		mainRow.addEventListener('click', () => {
			const isActive = mainRow.classList.contains('active');
			document.querySelectorAll('.main-row').forEach((row) => row.classList.remove('active'));
			document.querySelectorAll('.details-row').forEach((row) => row.classList.remove('show'));
			if (!isActive) {
				mainRow.classList.add('active');
				detailsRow.classList.add('show');
			}
		});
	}
}

/**
 * 绑定图片浮窗
 *
 * @returns {void}
 * @sideEffects DOM（注册监听）
 */
function bindImageModal() {
	const modal = document.getElementById('imageModal');
	const modalImg = document.getElementById('modalImage');
	const closeBtn = document.querySelector('.close-btn');
	const triggers = document.querySelectorAll('.popup-trigger');
	if (!modal || !modalImg) return;

	triggers.forEach((trigger) => {
		trigger.addEventListener('click', (e) => {
			e.preventDefault();
			modalImg.src = trigger.getAttribute('data-img');
			modal.style.display = 'flex';
		});
	});

	if (closeBtn) {
		closeBtn.addEventListener('click', () => {
			modal.style.display = 'none';
			modalImg.src = '';
		});
	}

	window.addEventListener('click', (e) => {
		if (e.target === modal) {
			modal.style.display = 'none';
			modalImg.src = '';
		}
	});
}

/**
 * 启动
 *
 * @returns {void}
 * @sideEffects DOM
 */
function start() {
	const tbody = document.querySelector('#featureTable tbody');
	if (tbody) renderTable(tbody);
	bindImageModal();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
