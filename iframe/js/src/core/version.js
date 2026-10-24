/**
 * @//module/ core/version
 * @//description/ 编辑器版本号与「版本族」判定（V2 / V2.2 / V3 / V4），带穿透缓存
 * @//exports/ getEditorVersion, getVersionFamily, isV2, isV3, isV4, isModern, classifyVersionSupport, resetVersionCache
 * @//dependencies/ core/eda
 * @//example/ const { isModern, getVersionFamily, classifyVersionSupport } = await import('./core/version.js')
 *            isModern() // true 表示 V3/V4，应走日志式源码格式
 *            classifyVersionSupport('2.2.44') // 'tooOld'
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import { getEda } from './eda.js';

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
 * 取编辑器版本号字符串（如 "3.0.12" / "2.2.45.1"）
 *
 * 取不到时返回空字符串（调用方按「非新版」处理），永不抛错。
 * 结果会被缓存，因此可以在循环里安全调用。
 *
 * @returns {string} 版本号；不可用时为空字符串
 * @sideEffects eda API（sys_Environment.getEditorCurrentVersion，首次调用）
 */
export function getEditorVersion() {
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
 * 取版本族
 *
 * 为什么要单独有「族」的概念：EDA 已进入 V4，而文件格式在 V3→V4 之间是**同构**的
 * （日志式增量存储、`||` 分隔、行尾 `|`、ticket 机制一致，差异见 docs/FORMATLOG.md）。
 * 因此判断「用新格式还是旧 V2 格式」必须用「3 或 4」，否则 V4 会被误判成 V2、
 * 按 V2 数组格式写入，直接写坏文档。
 *
 * @returns {'V2'|'V2.2'|'V3'|'V4'|''} 版本族；不可用时为空字符串
 * @sideEffects eda API（经 getEditorVersion，首次调用）
 */
export function getVersionFamily() {
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
 *
 * 只用于「确实只对 3.x 成立」的判断；判断文件格式请用 isModern。
 *
 * @returns {boolean}
 * @sideEffects eda API（首次调用）
 */
export function isV3() {
	return getVersionFamily() === 'V3';
}

/**
 * 是否 V4 系列（4.x）
 *
 * @returns {boolean}
 * @sideEffects eda API（首次调用）
 */
export function isV4() {
	return getVersionFamily() === 'V4';
}

/**
 * 是否「新格式」客户端（V3 或 V4）
 *
 * 所有「写源码 / 选解析器」的分支都应该用它，而不是 isV3()。
 *
 * @returns {boolean}
 * @sideEffects eda API（首次调用）
 */
export function isModern() {
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
 * @sideEffects eda API（首次调用）
 */
export function isV2() {
	const family = getVersionFamily();
	return family === 'V2' || family === 'V2.2';
}

/**
 * 清空版本号缓存
 *
 * 缓存的存在是为了「一次跨 iframe 调用，之后全用本地值」，但两种场景需要主动失效：
 *   - 单元测试要在同一个进程里模拟多个版本环境；
 *   - 宿主重连/切换工程后，编辑器版本可能已经变了。
 *
 * @returns {void}
 * @sideEffects 清空模块级缓存
 */
export function resetVersionCache() {
	// 缓存用 null 表示「尚未取过」（undefined 会被当成已缓存）
	cachedVersion = null;
}

/* ===== 版本适配区间 ===== */

/**
 * 适配的最低版本
 *
 * 2.2.45 之前缺少本工具依赖的几个 API（`sch_ManufactureData.getNetlistFile`、
 * 快捷键、部分源码写入能力），所以下限卡在这里，而不是笼统的「V2.2」。
 *
 * @type {string}
 */
const MIN_SUPPORTED_VERSION = '2.2.45';

/**
 * 适配过的最高主版本
 *
 * 4.*.* 都算适配过；5 及以后没测过，不该向用户承诺「可用」。
 *
 * @type {number}
 */
const MAX_SUPPORTED_MAJOR = 4;

/**
 * 把版本号拆成数字段
 *
 * @param {string} version 版本号（如 `4.1.78` / `2.2.45.5`）
 * @returns {number[]|null} 数字段；含非数字段或为空时为 null
 */
function parseVersionParts(version) {
	const text = String(version === null || version === undefined ? '' : version).trim();
	if (!text) return null;
	const parts = text.split('.').map((segment) => Number.parseInt(segment, 10));
	if (parts.some((value) => !Number.isFinite(value))) return null;
	return parts;
}

/**
 * 比较两个版本（按段补零后逐段比较）
 *
 * @param {number[]} left 版本段
 * @param {number[]} right 版本段
 * @returns {number} left 大于 right 为 1，小于为 -1，相等为 0
 */
function compareVersionParts(left, right) {
	const length = Math.max(left.length, right.length);
	for (let i = 0; i < length; i++) {
		const a = left[i] || 0;
		const b = right[i] || 0;
		if (a !== b) return a > b ? 1 : -1;
	}
	return 0;
}

/**
 * 判断某个版本号是否在适配区间内
 *
 * 三档结论（界面据此显示不同提示）：
 *   - `tooOld`   低于 2.2.45 → 建议更新 EDA
 *   - `supported` 2.2.45 ~ 4.*.* → 功能可用
 *   - `tooNew`   主版本大于 4 → 暂未做适配
 *
 * 版本号解析不出来（空串、`abc`、不在 EDA 环境）时返回空字符串，由调用方自己决定怎么显示。
 *
 * @param {string} version 版本号字符串
 * @returns {'tooOld'|'supported'|'tooNew'|''} 适配结论
 */
export function classifyVersionSupport(version) {
	const parts = parseVersionParts(version);
	if (!parts) return '';
	const minParts = parseVersionParts(MIN_SUPPORTED_VERSION);
	if (compareVersionParts(parts, minParts) < 0) return 'tooOld';
	if (parts[0] > MAX_SUPPORTED_MAJOR) return 'tooNew';
	return 'supported';
}
