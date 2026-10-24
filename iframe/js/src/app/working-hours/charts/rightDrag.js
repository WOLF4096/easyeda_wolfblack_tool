/**
 * @//module/ app/working-hours/charts/rightDrag
 * @//description/ 图表右键拖动 = 平移 dataZoom 窗口（主图 / 工程管理图共用）
 * @//exports/ bindRightDrag
 * @//dependencies/ 无
 * @//example/ bindRightDrag(view, { getMaxIndex: () => data.timeline.length - 1 })
 *
 * 为什么不用 echarts 自带的 moveOnMouseMove：那个是左键/中键；这块交互一直是右键，
 * 且必须夹住边界（窗口不能拖出时间轴），所以自己算 delta 再 dispatchAction。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 给图表绑定右键拖动平移
 *
 * @param {object} view createChartView 产出的视图
 * @param {object} options 选项
 * @param {() => number} options.getMaxIndex 时间轴最大下标
 * @returns {boolean} 是否绑定成功（view 无法初始化时 false）
 * @sideEffects 注册 zrender 事件
 */
export function bindRightDrag(view, options) {
	const getMaxIndex = options.getMaxIndex;
	const zr = view.getZr();
	if (!zr) return false;

	let dragging = false;
	let startX = 0;

	zr.on('mousedown', (e) => {
		if (e.event.button !== 2) return;
		dragging = true;
		startX = e.offsetX;
		zr.setCursorStyle('grabbing');
	});

	zr.on('mousemove', (e) => {
		if (!dragging) return;
		const inst = view.instance;
		if (!inst) return;
		const from = inst.convertFromPixel({ seriesIndex: 0 }, [startX, e.offsetY]);
		const to = inst.convertFromPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY]);
		if (!from || !to) return;

		const deltaIndex = from[0] - to[0];
		const currentDz = inst.getOption().dataZoom[0];
		let newStart = currentDz.startValue + deltaIndex;
		let newEnd = currentDz.endValue + deltaIndex;
		const maxIdx = getMaxIndex();
		if (newStart < 0) {
			newEnd -= newStart;
			newStart = 0;
		}
		if (newEnd > maxIdx) {
			newStart -= newEnd - maxIdx;
			newEnd = maxIdx;
		}
		inst.dispatchAction({ type: 'dataZoom', startValue: newStart, endValue: newEnd });
		startX = e.offsetX;
	});

	zr.on('mouseup', (e) => {
		if (e.event.button !== 2) return;
		dragging = false;
		zr.setCursorStyle('default');
	});

	return true;
}
