/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

import esbuild from 'esbuild';

import common from './esbuild.common';

(async () => {
	const ctx = await esbuild.context(common);
	if (process.argv.includes('--watch')) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		process.exit();
	}
})();
