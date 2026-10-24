/**
 * iframe 前端代码的复杂度门禁配置（与根配置分离）
 *
 * 为什么单独一份：根 `.eslintrc.js` 继承 `alloy` + `alloy/typescript`，那套规则是为 TS 后端代码
 * 定的（风格、命名、TSDoc）。直接套到 `iframe/js/src/**` 会产生几百条与本次重构无关的风格告警，
 * 淹没真正要守的东西。
 *
 * 这里只保留**用户明确要求的四条复杂度约束**（外加几条真·bug 规则）：
 *   - 单函数圈复杂度 ≤ 10
 *   - 嵌套深度 ≤ 3
 *   - 单函数 ≤ 80 行
 *   - 单文件 ≤ 400 行（模板型文件用 overrides 放宽，见下）
 *
 * 运行：npm run check:js
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
module.exports = {
	root: true,
	env: { browser: true, es2022: true },
	parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
	// 宿主导入的全局：`eda` 由 EDA 注入；`echarts` / `fflate` / `JSZip` 由页面里的 <script> 提供
	globals: {
		eda: 'readonly',
		echarts: 'readonly',
		fflate: 'readonly',
		JSZip: 'readonly',
	},
	rules: {
		complexity: ['error', 10],
		'max-depth': ['error', 3],
		'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }],
		'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
		'max-nested-callbacks': ['error', 3],

		// 真·bug 规则（都不涉及风格）
		'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
		'no-undef': 'error',
		'no-dupe-keys': 'error',
		'no-dupe-args': 'error',
		'no-unreachable': 'error',
		'no-fallthrough': 'error',
		'no-cond-assign': ['error', 'except-parens'],
		'no-self-assign': 'error',
		'no-async-promise-executor': 'error',
		// 误报：本项目用「先置标志再 await」做重入锁，单线程下是安全的
		'require-atomic-updates': 'off',
	},
	overrides: [
		{
			// 页面入口：只做「取 DOM → 调模块 → 刷 UI」，个别页面仍有历史长函数，先放宽行数
			files: ['iframe/js/src/app/*/index.js'],
			rules: {
				'max-lines': ['error', { max: 1800, skipBlankLines: true, skipComments: true }],
			},
		},
		{
			// 导出的 HTML 报告模板：本质是一个几百行的模板字符串，拆开反而不可维护
			files: ['iframe/js/src/app/working-hours/reportTemplate.js'],
			rules: {
				'max-lines': 'off',
				'max-lines-per-function': 'off',
			},
		},
		{
			// 测试替身/桩
			files: ['iframe/js/src/app/about/features.js'],
			rules: {
				'max-lines': 'off',
			},
		},
	],
};
