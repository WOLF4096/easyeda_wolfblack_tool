/**
 * 拆分 iframe HTML 的内联 <style> 与 <script>
 *
 * 将样式抽到 iframe/css/<name>.css，脚本抽到 iframe/js/app/<name>.js，
 * HTML 仅保留结构 + 引用（纯搬运，不改逻辑）。
 *
 * 注意：不适用于 WorkingHours.html（其主脚本内含生成导出 HTML 的模板字符串，
 * 需手动拆分）。用法：node scripts/split-iframe.js <html文件名> [...]
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
