/**
 * 「工时统计」离线报告的库内联测试
 *
 * 守的是什么：导出报告以前从 jsdelivr 拉 echarts/fflate，而扩展页面是 blob 文档、
 * `fetch('/iframe/js/x.js')` 必然失败 → 静默回退 CDN → 断网打开图表全空。
 * 现在改成构建期把库源码 gzip 内嵌、导出时还原。这条链路只要有一处编码/解码不对称，
 * 报告就会在对方电脑上白屏，而开发机上看起来一切正常（因为 CDN 兜底曾经存在）。
 *
 * 覆盖：
 *   1. 编码 → 解码 往返一致（用真实 echarts.min.js，1.5MB）
 *   2. 解码失败的三种输入都返回空串（空串 / 非 base64 / 解压函数抛错）
 *   3. `</script` 转义生效（否则报告 HTML 会被库源码里的标签提前闭合）
 *   4. buildLibTags：两库齐全走内联，缺一个走 CDN（源码兜底仍可测）
 *
 * 运行：npm test
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';

import { encodeLibGzip } from '../tools/lib-embed.mjs';
import { decodeEmbeddedLib, getInlineLibs } from '../iframe/js/src/app/working-hours/libInline.js';
import { buildLibTags } from '../iframe/js/src/app/working-hours/reportTemplate.js';

const ROOT = process.cwd();
const ECHARTS_PATH = path.join(ROOT, 'iframe', 'js', 'echarts.min.js');
const FFLATE_PATH = path.join(ROOT, 'iframe', 'js', 'fflate.js');

const readLib = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

describe('工时报告：内嵌库编解码', () => {
	const echartsSource = readLib(ECHARTS_PATH);

	it('真实 echarts 源码编码后能原样解回（逐字符一致）', () => {
		assert.ok(echartsSource.length > 1000000, '应读到真实的 echarts.min.js');
		const b64 = encodeLibGzip(echartsSource);
		const decoded = decodeEmbeddedLib(b64, zlib.gunzipSync);
		assert.equal(decoded.length, echartsSource.length);
		assert.equal(decoded, echartsSource);
	});

	it('压缩后体积远小于原文（否则没必要用 gzip 方案）', () => {
		const b64 = encodeLibGzip(echartsSource);
		assert.ok(b64.length < echartsSource.length / 2, `gzip+base64 应小于原文一半，实际 ${b64.length}`);
	});

	it('空串 / 非法 base64 / 解压失败都返回空串而不是抛错', () => {
		assert.equal(decodeEmbeddedLib('', zlib.gunzipSync), '');
		assert.equal(decodeEmbeddedLib(encodeLibGzip('hello'), null), '');
		assert.equal(decodeEmbeddedLib('bm90LWd6aXA=', zlib.gunzipSync), '');
		assert.equal(
			decodeEmbeddedLib(encodeLibGzip('hello'), () => {
				throw new Error('boom');
			}),
			''
		);
	});

	it('未注入常量时 getInlineLibs 返回两个空串（node 直测环境降级）', () => {
		const libs = getInlineLibs({ gunzipSync: zlib.gunzipSync });
		assert.equal(libs.echarts, '');
		assert.equal(libs.fflate, '');
	});
});

describe('工时报告：库标签拼装', () => {
	const fflateSource = readLib(FFLATE_PATH);

	it('两库齐全时全部内联，不出现任何 CDN 地址', () => {
		const tags = buildLibTags('console.log(1)', 'var fflate={};');
		assert.equal(tags.includes('cdn.jsdelivr.net'), false);
		assert.equal(tags.includes('console.log(1)'), true);
		assert.equal(tags.includes('var fflate={};'), true);
	});

	it('缺任一库时回退 CDN（源码级兜底，构建产物里会被裁掉）', () => {
		for (const tags of [buildLibTags('', 'x'), buildLibTags('x', ''), buildLibTags('', '')]) {
			assert.equal(tags.includes('cdn.jsdelivr.net/npm/echarts'), true);
			assert.equal(tags.includes('cdn.jsdelivr.net/npm/fflate'), true);
		}
	});

	it('fflate 源码不含裸 </script（内联安全性前提）', () => {
		assert.ok(fflateSource.length > 1000, '应读到真实的 fflate.js');
		assert.equal(/<\/script/i.test(fflateSource), false);
	});
});
