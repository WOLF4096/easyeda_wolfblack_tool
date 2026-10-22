/** @type {import("prettier").Options}
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
module.exports = {
	printWidth: 150,
	tabWidth: 4,
	useTabs: true,
	semi: true,
	singleQuote: true,
	quoteProps: 'preserve',
	trailingComma: 'all',
	bracketSpacing: true,
	bracketSameLine: false,
	arrowParens: 'always',
	rangeStart: 0,
	rangeEnd: Infinity,
	requirePragma: false,
	insertPragma: false,
	proseWrap: 'preserve',
	htmlWhitespaceSensitivity: 'css',
	endOfLine: 'lf',
	embeddedLanguageFormatting: 'auto',
	singleAttributePerLine: false,
	plugins: ['@trivago/prettier-plugin-sort-imports'],
	importOrder: ['<THIRD_PARTY_MODULES>', '^[./]'],
	importOrderSeparation: true,
	importOrderSortSpecifiers: true,
	importOrderGroupNamespaceSpecifiers: false,
	importOrderCaseInsensitive: false,
};
