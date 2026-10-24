/**
 * @//module/ build/packaged
 * @//description/ 把会打进 .eext 的文件压成扩展包（内容清单由 tools/eext-manifest.mjs 决定）
 * @//exports/ 无（构建脚本）
 * @//dependencies/ fs-extra, jszip, node:fs, node:module, node:path, tools/eext-manifest
 * @//example/ npm run build            # build:iframe → compile → packaged → check:eext
 *            node build/packaged.mjs   # 只重新打包（前面两步的产物已就绪时）
 *
 * 为什么从 `.ts` 改成 `.mjs`：清单逻辑现在放在 `tools/eext-manifest.mjs`（ESM），
 * 而本文件原来由 ts-node 按 CommonJS 执行 —— CJS 里 require 一个 .mjs 会抛 ERR_REQUIRE_ESM。
 * 改成 ESM 后与其余构建脚本（build-iframe / check-* / layout-check）保持一致，
 * 顺便把 ts-node 从打包链路里摘掉（少一层转译，出错信息也更直接）。
 *
 * 两条硬约束：
 *   1. **内容清单只有一份实现**（eext-manifest）。这里绝不能再自己遍历目录，
 *      否则「检查通过」和「实际打进去的东西」会各说各话；
 *   2. **打包前先断言**。少一个文件 zip 依然会成功，用户那边却是白屏 ——
 *      宁可在本地构建时就失败，也不要产出一个看起来正常的坏包。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import fsx from 'fs-extra';
import JSZip from 'jszip';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { assertEextContent, listEextFiles } from '../tools/eext-manifest.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const extensionConfig = require(path.join(ROOT, 'extension.json'));

/** 合法的扩展 UUID：32 位小写字母数字，且不能是全 0 */
const UUID_PATTERN = /^[a-z0-9]{32}$/;

/**
 * 校验并（必要时）修正 extension.json 里的 UUID
 *
 * 与原实现一致：UUID 非法时生成一个新的写回 `extension.json`（制表符缩进、LF、UTF-8）。
 *
 * @returns {void}
 * @sideEffects 可能改写 extension.json
 */
function ensureUuid() {
	const uuid = String(extensionConfig.uuid || '').trim();
	if (uuid !== '00000000000000000000000000000000' && UUID_PATTERN.test(uuid)) return;

	extensionConfig.uuid = crypto.randomUUID().replaceAll('-', '');
	fsx.writeJsonSync(path.join(ROOT, 'extension.json'), extensionConfig, { spaces: '\t', EOL: '\n', encoding: 'utf-8' });
	process.stdout.write(`packaged — UUID 非法，已重新生成：${extensionConfig.uuid}\n`);
}

/**
 * 主流程：算清单 → 断言 → 压缩
 *
 * @returns {void}
 * @sideEffects 读文件、写 `build/dist/<name>_v<version>.eext`
 */
function main() {
	ensureUuid();

	const files = listEextFiles(ROOT);
	const { problems } = assertEextContent(files, ROOT);
	if (problems.length > 0) {
		process.stdout.write(`✗ packaged — 内容校验未通过（${problems.length} 项），已中止，未生成 .eext：\n`);
		for (const item of problems) process.stdout.write(`  - ${item}\n`);
		process.exit(1);
	}

	const zip = new JSZip();
	for (const rel of files) {
		zip.file(rel, fs.createReadStream(path.join(ROOT, rel)));
	}

	const outPath = path.join(ROOT, 'build', 'dist', `${extensionConfig.name}_v${extensionConfig.version}.eext`);
	fsx.ensureDirSync(path.dirname(outPath));

	zip.generateNodeStream({
		type: 'nodebuffer',
		streamFiles: true,
		compression: 'DEFLATE',
		compressionOptions: { level: 9 },
	})
		.pipe(fs.createWriteStream(outPath))
		.on('finish', () => {
			process.stdout.write(`✓ packaged — ${files.length} 个文件 → ${path.relative(ROOT, outPath).replaceAll('\\', '/')}\n`);
		})
		.on('error', (error) => {
			process.stdout.write(`✗ packaged — 写 .eext 失败：${error.message}\n`);
			process.exitCode = 1;
		});
}

main();
