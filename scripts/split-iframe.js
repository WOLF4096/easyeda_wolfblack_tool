/**
 * 拆分 iframe HTML 的内联 <style> 与 <script>
 *
 * 将样式抽到 iframe/css/<name>.css，脚本抽到 iframe/js/app/<name>.js，
 * HTML 仅保留结构 + 引用（纯搬运，不改逻辑）。
 *
 * 【v1.17.2 起已废弃——仅作历史参考】
 * 自 v1.17.2 起样式改为「公共样式 iframe/css/common.css + 页面专属 <style>」，
 * 不再生成 iframe/css/<name>.css。本脚本若再次执行，会重新产出已被删除的
 * 独立 CSS 文件并覆盖页面内联样式，请勿在生产分支运行。
 *
 * 注意：不适用于 WorkingHours.html（其主脚本内含生成导出 HTML 的模板字符串，
 * 需手动拆分）。用法：node scripts/split-iframe.js <html文件名> [...]
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
const fs = require('fs');
const path = require('path');

const IFRAME = path.join(__dirname, '..', 'iframe');
const CSS_DIR = path.join(IFRAME, 'css');
const JS_DIR = path.join(IFRAME, 'js', 'app');

fs.mkdirSync(CSS_DIR, { recursive: true });
fs.mkdirSync(JS_DIR, { recursive: true });

function splitOne(fileName) {
    const filePath = path.join(IFRAME, fileName);
    const html = fs.readFileSync(filePath, 'utf8');
    const base = fileName.replace(/\.html$/, '');

    let result = html;

    // 1. 抽取内联 <style> → css 文件
    result = result.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => {
        fs.writeFileSync(path.join(CSS_DIR, base + '.css'), css.trim() + '\n');
        return `<link rel="stylesheet" href="/iframe/css/${base}.css">`;
    });

    // 2. 抽取内联 <script>（无 src 属性）→ js 文件
    result = result.replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => {
        fs.writeFileSync(path.join(JS_DIR, base + '.js'), js.trim() + '\n');
        return `<script src="/iframe/js/app/${base}.js"></script>`;
    });

    fs.writeFileSync(filePath, result);
    console.log('已拆分:', fileName);
}

const names = process.argv.slice(2);
if (names.length === 0) {
    console.error('用法: node scripts/split-iframe.js <html文件> [...]');
    process.exit(1);
}
names.forEach(splitOne);
