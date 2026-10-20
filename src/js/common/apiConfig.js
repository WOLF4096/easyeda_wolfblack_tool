/**
 * 通用 API 校准配置读取工具
 *
 * 多个转换工具（焊盘⇄过孔、导线⇄线条等）都需要读取本地存储的
 * "APITest" 校准数据，以动态适配不同版本客户端的坐标/尺寸缩放倍率。
 * 此处抽为公共函数，消除各模块中的重复读取逻辑。
 */

/**
 * 从本地存储读取 API 校准配置，缺失或解析失败时回退到默认配置
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
