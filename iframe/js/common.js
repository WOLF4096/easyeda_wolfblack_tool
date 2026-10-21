/**
 * 狼黑工具 - iframe 页面公共模块
 *
 * 收敛各页面重复的「版本判断 / 网表读写 / V2-V3 容器获取」逻辑。
 * 纯浏览器脚本（非 ESM），挂到 `window.WolfCommon`，需在页面自身脚本之前引入：
 *
 *     <script src="/iframe/js/common.js"></script>
 *     <script src="/iframe/js/app/Xxx.js"></script>
 *
 * 用法：
 *
 *     const { isV3, getNetlist, setNetlist, getComponentsContainer } = window.WolfCommon;
 *
 * 设计约束：所有函数都不抛「非预期」异常 —— 除 getNetlist / setNetlist 在
 * EDA 调用确实失败时向上抛出（由调用方决定如何提示用户），其余均为静默降级。
 */
(function (global) {
	'use strict';

	/** 网表类型标识，对齐嘉立创 EDA 专业版 API 约定 */
	const NETLIST_KEY = 'JLCEDA';

	/**
	 * 版本号缓存
	 *
	 * `getEditorCurrentVersion()` 是**同步穿透到宿主**的调用，如果在循环里反复取
	 * （历史问题：GenerateNet 逐行判断版本），上万行源码就是上万次跨 iframe 调用。
	 * 版本号在客户端生命周期内不会变化，取到有效值后缓存即可。
	 *
	 * 只缓存非空值：取不到（不在 EDA 环境）时不缓存，保证后续环境就绪后还能拿到。
	 */
	let cachedVersion = null;

	/**
	 * 取 EDA 运行环境对象
	 *
	 * 兼容三种挂载方式：
	 * 1. iframe 内 `window.eda`（多数页面）；
	 * 2. 父窗口 `window.parent.eda`（ClearEmptyProperties / NetlistUpdate3DModels 用）；
	 * 3. 都不存在（浏览器直开调试）→ 返回 null。
	 *
	 * @returns {object|null}
	 */
	function getEda() {
		try {
			if (typeof eda !== 'undefined' && eda) return eda;
		} catch (e) {
			/* ignore */
		}
		try {
			if (global.parent && global.parent !== global && global.parent.eda) return global.parent.eda;
		} catch (e) {
			/* 跨域访问 parent 会抛错，忽略 */
		}
		return global.eda || null;
	}

	/** EDA 环境是否可用 */
	function hasEda() {
		return !!getEda();
	}

	/**
	 * 取编辑器版本号字符串（如 "3.0.12" / "2.2.45.1"）
	 *
	 * 取不到时返回空字符串（调用方按「非 V3」处理），永不抛错。
	 * 结果会被缓存（见 cachedVersion），因此本函数可以在循环里安全调用。
	 *
	 * @returns {string}
	 */
	function getEditorVersion() {
		if (cachedVersion !== null) return cachedVersion;
		try {
			const edaObj = getEda();
			if (!edaObj || !edaObj.sys_Environment || typeof edaObj.sys_Environment.getEditorCurrentVersion !== 'function') {
				return '';
			}
			const version = edaObj.sys_Environment.getEditorCurrentVersion();
			const text = version === null || version === undefined ? '' : String(version).trim();
			// 只缓存有效值，避免把「环境未就绪」的空结果永久固化
			if (text) cachedVersion = text;
			return text;
		} catch (e) {
			return '';
		}
	}

	/**
	 * PCB 图层常量（官方层定义，与 src/js/common/pcbConstants.js 保持一致）
	 *
	 * MULTI(12) 是「多层」，通孔焊盘与过孔都落在这一层；铜层为 TOP/BOTTOM/内层。
	 */
	const LAYER = Object.freeze({
		TOP: 1,
		BOTTOM: 2,
		TOP_SILKSCREEN: 3,
		BOTTOM_SILKSCREEN: 4,
		TOP_SOLDER_MASK: 5,
		BOTTOM_SOLDER_MASK: 6,
		TOP_PASTE_MASK: 7,
		BOTTOM_PASTE_MASK: 8,
		TOP_ASSEMBLY: 9,
		BOTTOM_ASSEMBLY: 10,
		BOARD_OUTLINE: 11,
		MULTI: 12, // 多层：通孔焊盘 / 过孔
		DOCUMENT: 13,
		MECHANICAL: 14,
		INNER_1: 15,
		INNER_30: 44,
		HOLE: 47,
		COMPONENT_SHAPE: 48,
		COMPONENT_MARKING: 49,
		CUSTOM_1: 71,
		CUSTOM_30: 100,
	});

	/** 内层（铜层）区间：官方口径 15~46 */
	const COPPER_LAYER_MIN = 15;
	const COPPER_LAYER_MAX = 46;

	/** 是否内层 */
	function isInnerLayer(layer) {
		const value = Number(layer);
		return value >= COPPER_LAYER_MIN && value <= COPPER_LAYER_MAX;
	}

	/** 是否铜层（顶层 / 底层 / 内层），不含 MULTI */
	function isCopperLayer(layer) {
		const value = Number(layer);
		return value === LAYER.TOP || value === LAYER.BOTTOM || isInnerLayer(value);
	}

	/** 是否导电层（铜层 + MULTI 多层），用于「哪些图元参与电气连通」这类判断 */
	function isConductiveLayer(layer) {
		const value = Number(layer);
		return isCopperLayer(value) || value === LAYER.MULTI;
	}

	/**
	 * 取版本族（'V2' | 'V2.2' | 'V3' | 'V4' | ''）
	 *
	 * 为什么要单独有「族」的概念：
	 * EDA 已进入 V4，而文件格式在 V3→V4 之间是**同构**的（日志式增量存储、`||` 分隔、
	 * 行尾 `|`、ticket 机制都一致，差异见 docs/FORMATLOG.md）。因此判断「用新格式还是
	 * 旧 V2 格式」必须用「3 或 4」，否则 V4 会被误判成 V2、按 V2 数组格式写入，
	 * 直接写坏文档。
	 *
	 * @returns {'V2'|'V2.2'|'V3'|'V4'|''}
	 */
	function getVersionFamily() {
		const version = getEditorVersion();
		if (!version) return '';
		if (version.startsWith('4')) return 'V4';
		if (version.startsWith('3')) return 'V3';
		if (version.startsWith('2.2')) return 'V2.2';
		if (version.startsWith('2')) return 'V2';
		return '';
	}

	/**
	 * 是否 V3 系列（3.x）
	 * @returns {boolean}
	 */
	function isV3() {
		return getVersionFamily() === 'V3';
	}

	/**
	 * 是否 V4 系列（4.x）
	 * @returns {boolean}
	 */
	function isV4() {
		return getVersionFamily() === 'V4';
	}

	/**
	 * 是否「新格式」客户端（V3 或 V4）
	 *
	 * 所有「写源码 / 选解析器」的分支都应该用它，而不是 isV3()。
	 * 仅当逻辑确实只对 3.x 成立（而不是对格式成立）时才用 isV3()。
	 *
	 * @returns {boolean}
	 */
	function isModern() {
		const family = getVersionFamily();
		return family === 'V3' || family === 'V4';
	}

	/**
	 * 是否 V2 系列（2.x，含 2.2）
	 *
	 * 注意：`2.2.43` / `2.2.45` 这类**具体小版本**的 API 能力判断不要用本函数，
	 * 那是「某补丁版本才有的行为」，需要各自精确匹配。
	 *
	 * @returns {boolean}
	 */
	function isV2() {
		const family = getVersionFamily();
		return family === 'V2' || family === 'V2.2';
	}

	/**
	 * 取网表中的组件容器
	 *
	 * V3 在 `{ components: {...} }` 里，V2 直接是根对象。
	 * 不做深拷贝，返回的是原引用，调用方改属性即改原网表对象。
	 *
	 * @param {object} netlistObj - 已解析的网表对象
	 * @returns {object} 组件容器
	 */
	function getComponentsContainer(netlistObj) {
		if (!netlistObj) return {};
		return netlistObj.components ? netlistObj.components : netlistObj;
	}

	/**
	 * HTML 转义（用于拼 innerHTML / 属性值）
	 *
	 * 覆盖 `& < > " '` 五个字符，既可用于文本节点也可用于属性值。
	 * 此前各页面各写了一份，其中 PcbToSch 那份只转义了双引号，`&`/`<`/`>` 会漏，
	 * 这里统一为唯一实现。
	 *
	 * @param {*} value - 任意值，null/undefined 返回空字符串
	 * @returns {string}
	 */
	function escapeHtml(value) {
		if (value === null || value === undefined) return '';
		return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
	}

	/**
	 * 读取网表
	 *
	 * @param {'AUTO'|'PCB'|'SCH'} [page='AUTO'] - 来源页面；AUTO 先试 PCB 再回退 SCH
	 * @returns {Promise<{page: 'PCB'|'SCH', text: string, json: object}>} 来源、原文、解析结果
	 * @throws {Error} 指定来源读取失败（或 AUTO 下两个来源都失败）时抛出
	 */
	async function getNetlist(page = 'AUTO') {
		const edaObj = getEda();
		if (!edaObj) {
			throw new Error('未检测到 EDA 运行环境');
		}

		if (page === 'PCB') {
			const file = await edaObj.pcb_ManufactureData.getNetlistFile(NETLIST_KEY);
			const text = await file.text();
			return { page: 'PCB', text: text, json: JSON.parse(text) };
		}

		if (page === 'SCH') {
			const file = await edaObj.sch_ManufactureData.getNetlistFile(NETLIST_KEY);
			const text = await file.text();
			return { page: 'SCH', text: text, json: JSON.parse(text) };
		}

		// AUTO：PCB 优先，失败回退 SCH（SCH 的异常向上抛，由调用方提示）
		let text;
		try {
			const file = await edaObj.pcb_ManufactureData.getNetlistFile(NETLIST_KEY);
			text = await file.text();
			return { page: 'PCB', text: text, json: JSON.parse(text) };
		} catch (pcbError) {
			const file = await edaObj.sch_ManufactureData.getNetlistFile(NETLIST_KEY);
			text = await file.text();
			return { page: 'SCH', text: text, json: JSON.parse(text) };
		}
	}

	/**
	 * 写回网表
	 *
	 * PCB 侧与原理图侧的 API 名称不对称（`pcb_Net` vs `sch_Netlist`），在此统一。
	 *
	 * @param {'AUTO'|'PCB'|'SCH'} page - 写回目标；AUTO 先试 PCB 再回退 SCH
	 * @param {string|object} json - 网表 JSON（传对象会自动 JSON.stringify，不美化）
	 * @returns {Promise<'PCB'|'SCH'>} 实际写入的来源
	 * @throws {Error} 写入失败时抛出
	 */
	async function setNetlist(page, json) {
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
	 * 切分 V3/V4 的日志行：`{"type":...}||{...}|`
	 *
	 * 注意两个实测细节（来自 测试样本/ 的真实工程文件）：
	 * 1. **行尾 `|` 不是每行都有**（BOARD 文档的 META 行就缺），必须原样保留，
	 *    改写后再拼回去时不能擅自补上，否则等于改动文件格式；
	 * 2. 外层 JSON 文本要按原样返回（`leftStr`），不能重新序列化，否则键序/浮点
	 *    表示可能漂移。
	 *
	 * @param {string} line - 单行原始文本（不含换行符）
	 * @returns {{leftStr: string, rightStr: string, leftObj: Object, rightObj: Object, hasTrailingPipe: boolean}|null}
	 *          无法切分或任一侧 JSON 非法时返回 null（调用方应保留原行）
	 */
	function splitSourceLine(line) {
		if (typeof line !== 'string') return null;
		const hasTrailingPipe = line.endsWith('|');
		const cleanLine = hasTrailingPipe ? line.slice(0, -1) : line;
		const parts = cleanLine.split('||');
		if (parts.length !== 2) return null;
		let leftObj;
		let rightObj;
		try {
			leftObj = JSON.parse(parts[0]);
			rightObj = JSON.parse(parts[1]);
		} catch (e) {
			return null;
		}
		if (!leftObj || typeof leftObj !== 'object') return null;
		return { leftStr: parts[0], rightStr: parts[1], leftObj: leftObj, rightObj: rightObj, hasTrailingPipe: hasTrailingPipe };
	}

	/**
	 * 拼装日志行（与 splitSourceLine 对称）
	 *
	 * `splitSourceLine(raw)` → `joinSourceLine(...)` 必须与原行逐字节一致，
	 * 这是"改写源码不破坏文档"的底线保证（自动化测试里有对应用例）。
	 *
	 * @param {string} leftStr - 外层 JSON 文本（保持原样）
	 * @param {string} rightStr - 内层 JSON 文本
	 * @param {boolean} hasTrailingPipe - 原行是否带行尾 `|`
	 * @returns {string}
	 */
	function joinSourceLine(leftStr, rightStr, hasTrailingPipe) {
		return leftStr + '||' + rightStr + (hasTrailingPipe ? '|' : '');
	}

	global.WolfCommon = {
		NETLIST_KEY: NETLIST_KEY,
		LAYER: LAYER,
		getEda: getEda,
		hasEda: hasEda,
		getEditorVersion: getEditorVersion,
		getVersionFamily: getVersionFamily,
		isV2: isV2,
		isV3: isV3,
		isV4: isV4,
		isModern: isModern,
		isInnerLayer: isInnerLayer,
		isCopperLayer: isCopperLayer,
		isConductiveLayer: isConductiveLayer,
		getComponentsContainer: getComponentsContainer,
		escapeHtml: escapeHtml,
		splitSourceLine: splitSourceLine,
		joinSourceLine: joinSourceLine,
		getNetlist: getNetlist,
		setNetlist: setNetlist,
	};
})(window);
