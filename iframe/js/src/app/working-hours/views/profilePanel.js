/**
 * @//module/ app/working-hours/views/profilePanel
 * @//description/ 「更多选项」里的个人信息卡：头像、昵称、账号与累计工时
 * @//exports/ sumWorkSeconds, createProfilePanel
 * @//dependencies/ app/working-hours/time
 * @//example/ const profile = createProfilePanel({ data, getUser })
 *            profile.render()
 *
 * 用户信息不落盘（每次打开页面现取），因此这里只负责「把 getUserInfo 的结果画上去」；
 * 取不到时给出可读的降级文案，而不是留一片空白 —— 未登录 / 宿主 API 缺失都属于正常情况。
 *
 * 头像走网络（`image.lceda.cn`），所以**首次进入「更多选项」才加载**（`showAvatar`）：
 * 只是打开工时页、没看这张卡的人，不应该为一个头像多一次外网请求。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { formatTimeCN } from '../time.js';

/**
 * 累计工作秒数（所有工程的工作时间之和）
 *
 * @param {Record<string, {totalWork?: number}>} projectStats 工程统计表
 * @returns {number} 秒数
 * @sideEffects 无（纯函数）
 */
export function sumWorkSeconds(projectStats) {
	const stats = projectStats || {};
	let total = 0;
	for (const uuid of Object.keys(stats)) {
		const value = stats[uuid] ? stats[uuid].totalWork : 0;
		if (typeof value === 'number' && Number.isFinite(value)) total += value;
	}
	return total;
}

/**
 * 把协议相对的 CDN 头像地址补成绝对地址（blob 文档里 `//host/a.png` 能解析，但不保证）
 *
 * @param {string} src 原始地址
 * @returns {string} 可用的地址；空值返回空串
 * @sideEffects 无（纯函数）
 */
function avatarUrl(src) {
	if (typeof src !== 'string' || src.length === 0) return '';
	return src.startsWith('//') ? `https:${src}` : src;
}

/**
 * 昵称优先，其次用户名
 *
 * @param {object|null} user 用户信息
 * @returns {string} 展示名
 * @sideEffects 无（纯函数）
 */
function displayName(user) {
	if (!user) return '未获取到用户信息';
	return user.nickname || user.username || 'EDA 用户';
}

/**
 * 副标题：账号 / 客户编号
 *
 * @param {object|null} user 用户信息
 * @returns {string} 副标题
 * @sideEffects 无（纯函数）
 */
function subtitleOf(user) {
	if (!user) return '请确认已在 EDA 中登录，登录后重开本页';
	const parts = [];
	if (user.username) parts.push(`@${user.username}`);
	if (user.customerCode) parts.push(`客户编号 ${user.customerCode}`);
	return parts.length > 0 ? parts.join(' · ') : '本地账号';
}

/**
 * 头像加载失败时的占位字符
 *
 * @param {object|null} user 用户信息
 * @returns {string} 单个字符
 * @sideEffects 无（纯函数）
 */
function fallbackText(user) {
	const name = displayName(user);
	return [...name][0] || '狼';
}

/**
 * 写文本（元素缺失时静默跳过，便于脱离完整页面复用）
 *
 * @param {string} id 元素 id
 * @param {string} value 文本
 * @returns {void}
 * @sideEffects DOM
 */
function setText(id, value) {
	const el = document.getElementById(id);
	if (el) el.textContent = value;
}

/**
 * 创建个人信息面板控制器
 *
 * @param {object} ctx 上下文
 * @param {object} ctx.data 聚合数据集（读 projectStats）
 * @param {() => object|null} ctx.getUser 取当前用户信息
 * @returns {{render: Function, showAvatar: Function}} 控制器
 * @sideEffects 无（调用时才写 DOM / 加载头像）
 */
export function createProfilePanel(ctx) {
	let avatarBound = false;
	let avatarVisible = false;

	/**
	 * 绑定头像加载失败的回退（只绑一次）
	 *
	 * @param {HTMLImageElement} img 头像元素
	 * @param {HTMLElement} fallback 占位元素
	 * @returns {void}
	 * @sideEffects DOM 事件
	 */
	function bindAvatarFallback(img, fallback) {
		if (avatarBound) return;
		avatarBound = true;
		img.addEventListener('error', () => {
			img.classList.add('hidden');
			fallback.classList.remove('hidden');
		});
	}

	/**
	 * 画头像（未进入「更多选项」时不发起图片请求）
	 *
	 * @param {object|null} user 用户信息
	 * @returns {void}
	 * @sideEffects DOM（可能触发一次图片加载）
	 */
	function renderAvatar(user) {
		const img = document.getElementById('profile-avatar-img');
		const fallback = document.getElementById('profile-avatar-fallback');
		if (!img || !fallback) return;

		setText('profile-avatar-fallback', fallbackText(user));
		const url = avatarVisible ? avatarUrl(user && user.avatar) : '';
		if (!url) {
			img.classList.add('hidden');
			fallback.classList.remove('hidden');
			return;
		}

		bindAvatarFallback(img, fallback);
		if (img.getAttribute('src') !== url) img.setAttribute('src', url);
		img.classList.remove('hidden');
		fallback.classList.add('hidden');
	}

	/**
	 * 重绘整张卡片（不加载头像）
	 *
	 * @returns {void}
	 * @sideEffects DOM
	 */
	function render() {
		const user = ctx.getUser ? ctx.getUser() : null;
		const stats = (ctx.data && ctx.data.projectStats) || {};

		renderAvatar(user);
		setText('profile-name', displayName(user));
		setText('profile-sub', subtitleOf(user));
		setText('profile-total', formatTimeCN(sumWorkSeconds(stats) / 3600));
		setText('profile-projects', `${Object.keys(stats).length} 个工程`);
	}

	/**
	 * 卡片真正可见时调用：重绘并放行头像请求
	 *
	 * @returns {void}
	 * @sideEffects DOM（可能触发一次图片加载）
	 */
	function showAvatar() {
		avatarVisible = true;
		render();
	}

	return { render: render, showAvatar: showAvatar };
}
