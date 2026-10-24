/**
 * @//module/ ui/rewardDialog
 * @//description/ 「感觉不错？」赞赏引导弹窗（自包含 DOM + 样式，不依赖 common.css）
 * @//exports/ showRewardDialog, showRewardImage, closeRewardDialog
 * @//dependencies/ 无
 * @//example/ const { showRewardDialog } = await import('./ui/rewardDialog.js')
 *            showRewardDialog({ count: 20 })
 *
 * 弹窗与「导入 Gerber」工具里的那个是同一个：标题「感觉不错？」+ 一句说明 + 蜜雪赞赏码 /
 * 微信二维码 + 三个按钮（请开发者喝蜜雪 / 联系开发者 / 反馈问题）+ 关闭。
 *
 * 为什么样式自带而不是写进 `common.css`：
 *   1. 18 个页面共用一份样式表，为一个页面的浮层往里加 20 行反而更难维护；
 *   2. `common.css` 有条硬约定（`.hidden` 必须留文件最末、`--vscode-*` 变量名不能改），
 *      往里加东西容易踩到；
 *   3. 只在本页触发、只在本页出现，样式跟着模块走最省心。
 *
 * 关闭方式只有「关闭」按钮和右上角的 ✕：不监听遮罩点击（想扫码时很容易点空）、不监听 ESC。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/** 浮层与样式表的 DOM 标识（幂等创建靠它们判断） */
const OVERLAY_ID = 'reward-modal';
const STYLE_ID = 'reward-style';

/** 反馈入口（与「关于」页一致，指向本扩展的 issues） */
const ISSUE_URL = 'https://github.com/WOLF4096/easyeda_wolfblack_tool/issues';

/**
 * 两张二维码的取图信息
 *
 * `src` 是 EDA 绝对路径（扩展根目录映射），取不到时换 `fallback`（相对本页的路径）。
 *
 * @type {Readonly<Record<'reward'|'wechat', {src: string, fallback: string, caption: string}>>}
 */
const IMAGES = {
	reward: {
		src: '/images/reward_qrcode.png',
		fallback: '../images/reward_qrcode.png',
		caption: '微信扫码 · 请开发者喝蜜雪',
	},
	wechat: {
		src: '/images/wx.png',
		fallback: '../images/wx.png',
		caption: '微信扫码联系开发者',
	},
};

/** 弹窗样式（配色对齐 EDA 的 VSCode 深色主题） */
const DIALOG_STYLE = `
.rw-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 100000;
	background: rgba(0,0,0,0.7); display: none; justify-content: center; align-items: center;
	backdrop-filter: blur(2px); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
.rw-box { width: 440px; max-width: calc(100vw - 40px); max-height: 82vh; background: #252526;
	border: 1px solid #3e3e42; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);
	display: flex; flex-direction: column; overflow: hidden; }
.rw-head { padding: 14px 18px; border-bottom: 1px solid #3e3e42; font-size: 15px; font-weight: bold;
	color: #eee; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
.rw-close { cursor: pointer; color: #999; font-size: 16px; line-height: 1; padding: 2px 7px; border-radius: 4px; user-select: none; }
.rw-close:hover { background: #3c3c3c; color: #fff; }
.rw-body { padding: 16px 18px; overflow-y: auto; font-size: 13px; line-height: 1.7; color: #ccc; background: #1e1e1e; }
.rw-img-area { display: none; margin-top: 14px; text-align: center; background: #fff; border-radius: 6px; padding: 12px; }
.rw-img-area img { max-width: 260px; max-height: min(260px, 36vh); width: auto; height: auto; display: block; margin: 0 auto; }
.rw-cap { margin-top: 8px; font-size: 12px; color: #666; }
.rw-foot { padding: 12px 18px; border-top: 1px solid #3e3e42; display: flex; gap: 8px; flex-wrap: wrap;
	align-items: center; justify-content: flex-end; background: #333337; flex-shrink: 0; }
/* 四个按钮统一成同一尺寸：固定高度 + inline-flex 居中，
   button 与 a 的默认字体/行高不同，不写死的话「反馈问题」会比旁边高一截 */
.rw-btn { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
	height: 30px; padding: 0 14px; border: 1px solid #3e3e42; border-radius: 4px; background: #3c3c3c;
	color: #ddd; font-family: inherit; font-size: 12px; line-height: 1; white-space: nowrap;
	cursor: pointer; transition: opacity 0.15s; }
.rw-btn:hover { background: #4e4e52; color: #fff; }
a.rw-btn { text-decoration: none; }
.rw-btn-reward { background: #c2492f; border-color: #c2492f; color: #fff; font-weight: 600; }
.rw-btn-reward:hover { background: #a93b25; border-color: #a93b25; }
.rw-btn-ghost { background: transparent; }
`;

/** 弹窗结构（与「导入 Gerber」工具逐字一致） */
const DIALOG_HTML = `
<div class="rw-overlay" id="${OVERLAY_ID}">
	<div class="rw-box">
		<div class="rw-head"><span id="rw-title">感觉不错？</span><span class="rw-close" id="rw-btn-x" title="关闭">✕</span></div>
		<div class="rw-body">
			<p id="rw-desc" style="margin:0;"></p>
			<div class="rw-img-area" id="rw-img-area">
				<img id="rw-img" alt="二维码">
				<div class="rw-cap" id="rw-cap"></div>
			</div>
		</div>
		<div class="rw-foot">
			<button class="rw-btn rw-btn-reward" id="rw-btn-reward">请开发者喝蜜雪</button>
			<button class="rw-btn" id="rw-btn-wechat">联系开发者</button>
			<a class="rw-btn" id="rw-btn-issue" href="${ISSUE_URL}" target="_blank" rel="noopener noreferrer">反馈问题</a>
			<button class="rw-btn rw-btn-ghost" id="rw-btn-close">关闭</button>
		</div>
	</div>
</div>
`;

/**
 * 关闭弹窗
 *
 * @returns {void}
 * @sideEffects 改 DOM
 */
export function closeRewardDialog() {
	if (typeof document === 'undefined') return;
	const overlay = document.getElementById(OVERLAY_ID);
	if (overlay) overlay.style.display = 'none';
}

/**
 * 图片加载失败时换相对路径再试一次
 *
 * @param {HTMLImageElement} img 图片元素
 * @param {{src: string, fallback: string}} meta 取图信息
 * @returns {void}
 * @sideEffects 给 img 挂 onerror
 */
function bindImageFallback(img, meta) {
	img.onerror = () => {
		if (img.getAttribute('src') === meta.src) {
			img.setAttribute('src', meta.fallback);
			return;
		}
		img.onerror = null;
	};
}

/**
 * 在弹窗里显示二维码
 *
 * @param {'reward'|'wechat'} [kind='reward'] 图片类型：赞赏码 / 微信二维码
 * @returns {void}
 * @sideEffects 改 DOM
 */
export function showRewardImage(kind = 'reward') {
	const overlay = ensureDialog();
	if (!overlay) return;
	const meta = IMAGES[kind] || IMAGES.reward;
	const img = overlay.querySelector('#rw-img');
	const area = overlay.querySelector('#rw-img-area');
	const caption = overlay.querySelector('#rw-cap');
	if (!img || !area) return;

	bindImageFallback(img, meta);
	img.setAttribute('src', meta.src);
	if (caption) caption.textContent = meta.caption;
	area.style.display = 'block';
}

/**
 * 收起二维码区域
 *
 * @returns {void}
 * @sideEffects 改 DOM
 */
function hideImageArea() {
	if (typeof document === 'undefined') return;
	const area = document.getElementById('rw-img-area');
	if (area) area.style.display = 'none';
}

/**
 * 弹窗不存在时创建（幂等）
 *
 * @returns {HTMLElement|null} 浮层元素；无 DOM 环境（node 测试 / 已卸载）时为 null
 * @sideEffects 往 head 插样式、往 body 插浮层、绑定按钮事件
 */
function ensureDialog() {
	if (typeof document === 'undefined') return null;
	const existing = document.getElementById(OVERLAY_ID);
	if (existing) return existing;

	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = DIALOG_STYLE;
	document.head.appendChild(style);

	const holder = document.createElement('div');
	holder.innerHTML = DIALOG_HTML.trim();
	const overlay = holder.firstElementChild;
	document.body.appendChild(overlay);

	overlay.querySelector('#rw-btn-close').addEventListener('click', closeRewardDialog);
	overlay.querySelector('#rw-btn-x').addEventListener('click', closeRewardDialog);
	overlay.querySelector('#rw-btn-reward').addEventListener('click', () => showRewardImage('reward'));
	overlay.querySelector('#rw-btn-wechat').addEventListener('click', () => showRewardImage('wechat'));
	return overlay;
}

/**
 * 填说明文字
 *
 * 带次数时说明「这是第几次」；带不了（读计数失败）就退回泛化文案，不让弹窗出现空正文。
 *
 * @param {number} [count] 累计使用次数
 * @returns {void}
 * @sideEffects 改 DOM
 */
function fillDescription(count) {
	const desc = document.getElementById('rw-desc');
	if (!desc) return;
	desc.textContent = count
		? `这是你第 ${count} 次使用「PCB转原理图」。如果它帮你省了时间，可以请开发者喝杯蜜雪，遇到问题也欢迎反馈～`
		: '本工具免费开源、持续维护。如果它帮你省了时间，欢迎请开发者喝杯蜜雪，或反馈使用中遇到的问题～';
}

/**
 * 打开「感觉不错？」弹窗
 *
 * @param {object} [options] 选项
 * @param {string} [options.title='感觉不错？'] 标题
 * @param {number} [options.count] 转换次数（写进说明文字）
 * @param {'reward'|'wechat'} [options.show] 打开时直接展示哪张二维码
 * @returns {void}
 * @sideEffects 插入并显示浮层
 */
export function showRewardDialog(options = {}) {
	const overlay = ensureDialog();
	if (!overlay) return;

	const title = overlay.querySelector('#rw-title');
	if (title) title.textContent = options.title || '感觉不错？';
	fillDescription(options.count);
	hideImageArea();
	if (options.show) showRewardImage(options.show);
	overlay.style.display = 'flex';
}
