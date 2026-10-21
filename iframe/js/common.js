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
	 * 是否 V3 系列（3.x）
	 *
	 * 统一采用 `startsWith('3')`：历史上各处混用 `startsWith('3')` 与
	 * `startsWith('3.')`，对真实版本号（3.0.x / 3.1.x…）判定结果一致。
	 *
	 * @returns {boolean}
	 */
	function isV3() {
		return getEditorVersion().startsWith('3');
	}

	/**
	 * 是否 V2.2 系列（2.2.x）
	 *
	 * 注意：`2.2.43` / `2.2.45` 这类**具体小版本**的 API 能力判断不要用本函数，
	 * 那是「某补丁版本才有的行为」，需要各自精确匹配。
	 *
	 * @returns {boolean}
	 */
	function isV2() {
		return getEditorVersion().startsWith('2.2');
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
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
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

	global.WolfCommon = {
		NETLIST_KEY: NETLIST_KEY,
		getEda: getEda,
		hasEda: hasEda,
		getEditorVersion: getEditorVersion,
		isV3: isV3,
		isV2: isV2,
		getComponentsContainer: getComponentsContainer,
		escapeHtml: escapeHtml,
		getNetlist: getNetlist,
		setNetlist: setNetlist,
	};
})(window);
