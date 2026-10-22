/**
 * 通用 API 校准配置读取工具
 *
 * 多个转换工具（焊盘⇄过孔、导线⇄线条等）都需要读取本地存储的
 * "APITest" 校准数据，以动态适配不同版本客户端的坐标/尺寸缩放倍率。
 * 此处抽为公共函数，消除各模块中的重复读取逻辑。
 *
 * --- 模块边界 ---
 * 本模块是「EDA 取数」与「纯计算」之间唯一的交界点：
 * 只做一件事 —— 把 `eda.sys_Storage` 中的字符串读出来并解析成对象，
 * 解析/计算逻辑一律留给调用方。因此它**是唯一需要 mock `eda` 的公共模块**
 * （见 test/apiConfig.test.mjs）。
 *
 * 约束：任何情况下都不抛错，最差返回 `defaultConfig`，
 * 保证首次使用（本地无校准数据）时转换仍以 1:1 比例可用。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 从本地存储读取 API 校准配置，缺失或解析失败时回退到默认配置
 *
 * 三级兜底：
 * 1. 读到字符串 → `JSON.parse` 成功则返回解析结果；
 * 2. 读到字符串但 JSON 非法 → `console.warn` 后回退默认；
 * 3. 存储抛错 / 返回空值 → `console.warn` 或静默回退默认。
 *
 * 注意：读到合法 JSON 但内容是 `null`、`{}` 或缺字段时**不会**与默认配置合并，
 * 字段级兜底由调用方用 `api[分组]?.[字段] ?? 1` 完成。
 *
 * @param {object} defaultConfig - 默认兜底配置（各工具不同，比例为 1:1）
 * @param {string} [storageKey] - 存储键名，默认 'APITest'
 * @returns {Promise<object>} 校准配置对象
 */
export async function loadApiConfig(defaultConfig, storageKey = 'APITest') {
	try {
		const rawData = await eda.sys_Storage.getExtensionUserConfig(storageKey);
		if (rawData) {
			try {
				return JSON.parse(rawData);
			} catch (e) {
				console.warn('API 校准数据解析失败，将使用默认比例 1:1', e);
			}
		}
	} catch (e) {
		console.warn('读取 API 校准数据失败，将使用默认比例 1:1', e);
	}
	return defaultConfig;
}
