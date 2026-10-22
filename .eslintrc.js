/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

module.exports = {
	plugins: ['eslint-plugin-tsdoc'],
	extends: ['alloy', 'alloy/typescript'],
	ignorePatterns: ['/build/dist/', '/coverage/', '/dist/', '/node_modules/', '/temp/', 'debug.log'],
	env: {
		browser: true,
	},
	rules: {
		'no-param-reassign': 'off',
		'max-params': 'off',
		'tsdoc/syntax': 'warn',
	},
	root: true,
};
