/**
 * @//module/ app/pin-sorting/index
 * @//description/ 页面编排：轮询选中引脚 → 按名称/编号排序 → 按首脚朝向重排坐标与角度
 * @//exports/ 无
 * @//dependencies/ core/eda, ui/poll, app/pin-sorting/sortKey
 * @//example/ 页面入口，由 iframe/PinSorting.html 加载打包产物 app/PinSorting.js
 *
 * 轮询改用 `ui/poll`：带重入锁（宿主慢时不叠加请求）、结果没变不回调、页面隐藏自动跳过。
 * 原实现是裸 `setInterval(async …)`，宿主卡顿时会堆积请求且永不停止。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../../core/eda.js';
import { createPoll } from '../../ui/poll.js';
import { planLayout } from './sortKey.js';

/** 当前选中的引脚（每次轮询刷新） */
let selectedPins = [];

const countEl = document.getElementById('pin-count');

/**
 * 读取界面参数
 *
 * @returns {{prop: string, spacing: number, endSort: boolean, splitSort: boolean}} 参数
 * @sideEffects DOM（读取控件）
 */
function readOptions() {
	const checked = document.querySelector('input[name="sortTarget"]:checked');
	return {
		prop: checked && checked.value ? checked.value : 'name',
		spacing: parseFloat(document.getElementById('spacing').value) || 10,
		splitSort: document.getElementById('splitSort').checked,
		endSort: document.getElementById('endSort').checked,
	};
}

/**
 * 按当前排序设置重排选中引脚
 *
 * @param {'asc'|'desc'} order 升序 / 降序
 * @returns {Promise<void>}
 * @sideEffects eda API（sch_PrimitivePin.modify）
 */
async function applySort(order) {
	if (selectedPins.length === 0) return;

	const host = getEda();
	if (!host || !host.sch_PrimitivePin) return;

	const options = readOptions();
	const plan = planLayout(selectedPins, { ...options, order: order });

	for (let i = 0; i < plan.sorted.length; i++) {
		const pin = plan.sorted[i];
		const target = plan.targets[i];

		// 已经对齐且朝向正确时跳过，避免无意义的 API 调用
		if (pin.x === target.x && pin.y === target.y && pin.rotation === target.rotation) continue;

		// 必须全盘继承图元对象：漏字段会让系统自行分配未知参数，导致引脚翻转
		const modifyProperty = { ...pin, x: target.x, y: target.y, rotation: target.rotation };
		try {
			await host.sch_PrimitivePin.modify(pin.primitiveId, modifyProperty);
		} catch (error) {
			console.error(`更新引脚 ${pin.primitiveId} 失败:`, error);
		}
	}
}

const poll = createPoll({
	intervalMs: 200,
	fetchItems: async () => {
		const host = getEda();
		if (!host || !host.sch_SelectControl) return [];
		const primitives = await host.sch_SelectControl.getAllSelectedPrimitives();
		return primitives.filter((item) => item.primitiveType === 'Pin');
	},
	onItems: (pins) => {
		selectedPins = pins;
		if (countEl) countEl.innerText = String(pins.length);
	},
	isEqual: (a, b) => {
		if (a.length !== b.length) return false;
		const ids = new Set(a.map((p) => p.primitiveId));
		return b.every((p) => ids.has(p.primitiveId));
	},
});

document.getElementById('btn-asc').addEventListener('click', () => applySort('asc'));
document.getElementById('btn-desc').addEventListener('click', () => applySort('desc'));

// 页面隐藏时自动跳过采样（ui/poll 内建），离开页面则彻底停掉
window.addEventListener('pagehide', () => poll.stop());
poll.start();
