/**
 * @//module/ tools/check-eext
 * @//description/ .eext 内容门禁：按白名单校验包内文件，并检查页面/图片/入口引用是否完整
 * @//exports/ 无（CLI 脚本）
 * @//dependencies/ node:path, tools/eext-manifest
 * @//example/ npm run check:eext      # 有无关内容或引用缺失时退出码 1，可直接串进 CI
 *
 * 与 `build/packaged.ts` 共用 `eext-manifest.mjs` 这一个实现，所以「打包打进去的东西」
 * 和「门禁检查的东西」永远一致 —— 不会再出现「检查通过但包是坏的」这种自欺欺人。
 *
 * 打印顺序按类别分组，方便一眼看出某个类别是不是突然多了文件。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import fs from 'node:fs';
import path from 'node:path';

import { assertEextContent, listEextFiles } from './eext-manifest.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

let files;
try {
	files = listEextFiles(ROOT);
} catch (error) {
	process.stdout.write(`✗ check:eext — ${error.message}\n`);
	process.exit(1);
}

const bytes = files.reduce((sum, rel) => sum + fs.statSync(path.join(ROOT, rel)).size, 0);
const { problems, stats } = assertEextContent(files, ROOT);

process.stdout.write(`check:eext — ${files.length} 个文件，解压后 ${(bytes / 1024 / 1024).toFixed(2)} MB\n`);
const order = [...stats.keys()].sort((a, b) => stats.get(b) - stats.get(a));
process.stdout.write(`  ${order.map((k) => `${k} ${stats.get(k)}`).join(' · ')}\n`);

if (problems.length === 0) {
	process.stdout.write('✓ 无无关内容，页面与入口引用完整\n');
	process.exit(0);
}

process.stdout.write(`✗ 发现 ${problems.length} 个问题：\n`);
for (const item of problems) process.stdout.write(`  - ${item}\n`);
process.stdout.write('  修法：文件类别 → 改 tools/eext-manifest.mjs 的 ALLOW_RULES；该剔除 → 改 .edaignore\n');
process.exit(1);
