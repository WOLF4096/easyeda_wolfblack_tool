/**
 * @//module/ app/working-hours/runtime
 * @//description/ 工时页的共享运行态：聚合数据集 + 页面/图表交互状态（可写单例）
 * @//exports/ data, ui, chartData, applyDataset, resetChartCache, emptyChartCache
 * @//dependencies/ 无
 * @//example/ applyDataset(buildDataset(configs, opts)); ui.activeTab = 'manage'
 *
 * 为什么允许一个可写单例：这个页面的 6 个图表、图例、表格、导出全部共享同一条时间轴，
 * 拆模块时若把状态改成层层传参，函数签名会膨胀到 5~8 个参数且极易传错。
 * 这里只放「状态」，所有计算仍然在 charts/* 的纯函数里完成（它们接收 data 作为入参，不读本模块）。
 */

/** 聚合数据集（由 aggregate.buildDataset 产出后 applyDataset 写入） */
export const data = {
	timeline: [],
	tsMap: new Map(),
	projectMeta: {},
	projectStats: {},
	sortedProjectIds: [],
	pidColorMap: {},
	todayTs: 0,
};

/**
 * 「空」图表缓存：聚簇大小 / 最大 Y / 小时刻度 / 动态 Y 上限
 *
 * @returns {{lastClusterSize: number, lastYMax: number, lastHourInterval: number, lastDynamicYMax: number}} 缓存对象
 * @sideEffects 无（纯函数）
 */
export function emptyChartCache() {
	return { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 };
}

/** 页面与图表交互状态 */
export const ui = {
	activeTab: 'total',
	currentUuid: null,
	currentName: '未命名工程',
	selectedDetailUuid: null,
	selectedManageUuid: null,
	hiddenSeries: new Set(),
	sortField: '',
	sortOrder: 'desc',
	weeklyOffset: 0,
	rhythmMode: 'time',
	rhythmFirstInit: true,
	/** 节律图最近一次聚合结果（图例悬浮汇总要用，原本挂在 echarts 实例的私有字段上） */
	rhythmAgg: null,
	mainClusterSize: 1,
	manageClusterSize: 1,
	/** 主图 / 工程管理图各自的「上次渲染参数」缓存，用于跳过无变化的 setOption */
	chartCache: { main: emptyChartCache(), manage: emptyChartCache() },
};

/**
 * 把 buildDataset 的结果写进共享数据集
 *
 * @param {object} ds buildDataset 的返回值
 * @returns {void}
 * @sideEffects 改写 `data`
 */
export function applyDataset(ds) {
	data.timeline = ds.timeline;
	data.tsMap = ds.tsMap;
	data.projectMeta = ds.projectMeta;
	data.projectStats = ds.projectStats;
	data.sortedProjectIds = ds.sortedProjectIds;
	data.pidColorMap = ds.pidColorMap;
	data.todayTs = ds.todayTs;
}

/**
 * 组装给「图表 option 工厂」用的数据包
 *
 * 工厂是纯函数（不 import 本模块），所以每次渲染都把当前数据快照成入参。
 * `hiddenSeries` 传的是 Set 的**引用**，不是副本 —— tooltip 是用户悬浮时才执行的，
 * 必须读到当下的显隐状态，复制一份就永远停留在渲染那一刻了。
 *
 * @returns {object} 数据包（timeline / tsMap / projectMeta / projectStats / sortedProjectIds / pidColorMap / todayTs / hiddenSeries）
 * @sideEffects 无（每次调用新建一个浅包装对象）
 */
export function chartData() {
	return {
		timeline: data.timeline,
		tsMap: data.tsMap,
		projectMeta: data.projectMeta,
		projectStats: data.projectStats,
		sortedProjectIds: data.sortedProjectIds,
		pidColorMap: data.pidColorMap,
		todayTs: data.todayTs,
		hiddenSeries: ui.hiddenSeries,
	};
}

/**
 * 重置某一路图表的渲染缓存（数据或图例变化后必须调用，否则会跳过重绘）
 *
 * @param {'main'|'manage'} key 缓存键
 * @returns {void}
 * @sideEffects 改写 `ui.chartCache[key]`
 */
export function resetChartCache(key) {
	ui.chartCache[key] = emptyChartCache();
}
