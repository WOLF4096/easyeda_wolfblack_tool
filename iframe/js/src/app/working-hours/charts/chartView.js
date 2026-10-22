/**
 * @//module/ app/working-hours/charts/chartView
 * @//description/ ECharts 实例的统一生命周期封装（懒初始化 / setOption / resize / dispose / getDataURL）
 * @//exports/ createChartView
 * @//dependencies/ 无（echarts 走页面全局，避免裸导入）
 * @//example/ const view = createChartView({ el: 'chart-container' })
 *            view.setOption(option); view.resize(); view.destroy()
 *
 * 拆之前 6 个实例各自写一遍 `if (!x) x = echarts.init(dom,'dark')` + 全局 resize 里 6 个 if，
 * 且 dispose 之后忘了把变量置空会留下一半失效的引用（`manageChart.dispose()` 后仍被 resize 调用）。
 * 这里把「有没有 init」「resize 前判空」收敛成一处，页面侧只持有 view 对象。
 */

/**
 * 创建一个图表视图
 *
 * @param {object} options 选项
 * @param {string|HTMLElement|(() => HTMLElement)} options.el 容器（id / 元素 / 惰性求值函数）
 * @param {string} [options.theme='dark'] echarts 主题
 * @param {object} [options.echartsRef] 注入 echarts（测试用；默认取页面全局）
 * @returns {object} 视图对象：init / setOption / on / getOption / resize / destroy / getDataURL / instance
 * @sideEffects 首次 init 时在 DOM 上创建 echarts 实例
 */
export function createChartView(options) {
	const theme = options.theme || 'dark';
	const elRef = options.el;
	const echartsRef = options.echartsRef;
	let instance = null;

	/**
	 * 解析容器元素
	 *
	 * @returns {HTMLElement|null} 容器
	 * @sideEffects 无（纯查询）
	 */
	function resolveEl() {
		if (typeof elRef === 'function') return elRef();
		if (typeof elRef === 'string') return typeof document === 'undefined' ? null : document.getElementById(elRef);
		return elRef || null;
	}

	/**
	 * 解析 echarts 全局
	 *
	 * @returns {object|null} echarts
	 * @sideEffects 无
	 */
	function resolveEcharts() {
		if (echartsRef) return echartsRef;
		return typeof echarts === 'undefined' ? null : echarts;
	}

	const view = {
		/**
		 * 惰性初始化；容器不存在时返回 null（页面某些 tab 未渲染时不报错）
		 *
		 * @returns {object|null} echarts 实例
		 * @sideEffects 创建实例
		 */
		init() {
			if (instance) return instance;
			const api = resolveEcharts();
			const dom = resolveEl();
			if (!api || !dom) return null;
			instance = api.init(dom, theme);
			return instance;
		},

		/**
		 * 是否已经初始化
		 *
		 * @returns {boolean} 已初始化返回 true
		 * @sideEffects 无
		 */
		get isReady() {
			return instance !== null;
		},

		/**
		 * 当前实例（未初始化时为 null）
		 *
		 * @returns {object|null} echarts 实例
		 * @sideEffects 无
		 */
		get instance() {
			return instance;
		},

		/**
		 * 设置 option（未初始化时自动 init）
		 *
		 * @param {object} option echarts option
		 * @param {boolean|object} [notMerge=false] 是否不合并（echarts 的 notMerge 参数）
		 * @returns {boolean} 是否设置成功
		 * @sideEffects 重绘图表
		 */
		setOption(option, notMerge) {
			const inst = view.init();
			if (!inst) return false;
			inst.setOption(option, notMerge === undefined ? false : notMerge);
			return true;
		},

		/**
		 * 读当前 option
		 *
		 * @returns {object|null} option
		 * @sideEffects 无
		 */
		getOption() {
			return instance ? instance.getOption() : null;
		},

		/**
		 * 绑定 echarts 事件（实例销毁后需重新绑定，见 rightDrag）
		 *
		 * @param {string} event 事件名
		 * @param {Function} handler 处理函数
		 * @returns {boolean} 是否绑定成功
		 * @sideEffects 注册监听
		 */
		on(event, handler) {
			const inst = view.init();
			if (!inst) return false;
			inst.on(event, handler);
			return true;
		},

		/**
		 * 分发 action（dataZoom 等）
		 *
		 * @param {object} action action 对象
		 * @returns {boolean} 是否分发成功
		 * @sideEffects 触发图表交互
		 */
		dispatchAction(action) {
			if (!instance) return false;
			instance.dispatchAction(action);
			return true;
		},

		/**
		 * 按容器尺寸重绘（未初始化或已销毁时静默跳过）
		 *
		 * @returns {void}
		 * @sideEffects 重绘
		 */
		resize() {
			if (instance) instance.resize();
		},

		/**
		 * 销毁实例并清空引用
		 *
		 * @returns {void}
		 * @sideEffects 释放 canvas
		 */
		destroy() {
			if (!instance) return;
			instance.dispose();
			instance = null;
		},

		/**
		 * 导出 data URL（周报合成图片用）
		 *
		 * @param {object} [opts] echarts getDataURL 参数
		 * @returns {string} data URL；未初始化返回空串
		 * @sideEffects 生成图片
		 */
		getDataURL(opts) {
			return instance ? instance.getDataURL(opts) : '';
		},

		/**
		 * 取 zrender（右键拖动平移需要）
		 *
		 * @returns {object|null} zrender
		 * @sideEffects 无
		 */
		getZr() {
			return instance ? instance.getZr() : null;
		},
	};

	return view;
}
