# 开发与构建

面向要改代码、跑测试、自己出包的人。只想用插件的话看 [README.md](README.md)。

## 环境

- Node.js ≥ 20.5（`package.json` 的 `engines`）
- 出包需要 `ts-node`（已随 devDependencies 安装）
- 页面版式自检与冒烟测试需要本机装有 Chrome

```bash
npm install
```

## 目录结构

```
src/                     扩展后端（TypeScript 入口 + 无界面功能）
  index.ts               入口：只做「打开页面 / 调无界面功能 / 注册快捷键」
  js/                    无界面功能（导线⇄线条、焊盘⇄过孔、从 PCB 创建导线…）
    common/              平台内核（图层常量、源码行、拼链、日志、校准配置）
iframe/                  18 个页面（HTML 只有结构 + 引用，无内联 CSS/JS）
  js/src/                页面源码（ESM）
    core/                平台内核（版本、网表、引脚、长度、转义）
    ui/                  通用件（toast、状态栏、表格、轮询、下载、页面壳）
    format|pcb|sch/      基础能力
    app/<page>/          页面入口 + 同目录纯逻辑模型
  js/app/                构建产物（单文件 IIFE，勿手改）
  css/common.css         18 页共用样式
test/                    单元测试（node:test）
  samples/               真实 V2 / V3 / V4 工程回归
  pages/                 页面冒烟（headless Chrome，需单独跑）
tools/                   门禁、版式自检、离线报告库内联、EDA 桥
docs/                    评估报告、格式记录、实施计划
测试样本/                真实工程样本（不进扩展包）
```

## 常用命令

| 命令 | 作用 |
| :--- | :--- |
| `npm run build:iframe` | 把 `iframe/js/src` 按页打包成 `iframe/js/app/<Page>.js`（约 1 秒） |
| `npm run watch:iframe` | 改源码自动重打包 |
| `npm test` | 单元测试；`pretest` 会先跑 `check:deps` + `check:js` |
| `npm run test:samples` | 用真实 V2 / V3 / V4 工程跑格式回归（10 用例 / 3 样本） |
| `npm run check:layout` | headless Chrome 逐页实测溢出与裁切，截图到 `temp/layout-check/` |
| `node test/pages/run.mjs` | 页面冒烟（mock eda，18 页）；`--only About` 只跑单页 |
| `npm run build` | 全量构建：页面打包 → 编译后端 → 出 `.eext` |
| `npm run sign` | 给新增的文档末尾、代码开头补开发者署名（幂等；`-- --dry` 可预演） |

产物：`build/dist/wolfblack-tool_v<版本>.eext`。

## 三条必须知道的平台约束

1. **不能用原生 ESM 直接跑**。宿主把页面渲染成 `blob:` 文档，每个 `<script src>` 被改写成无 MIME 的 blob URL，相对 `import` 无法解析。所以源码写 ESM、构建期打包成单文件 IIFE，HTML 里的 `<script src>` 不随源码变化。
2. **不能在运行时读站内文件**。`fetch('/iframe/xxx')` 在 blob 文档下必然失败。需要随包带的资源（例如工时报告用的图表库）要在**构建期**注入成字符串常量。
3. **行内 `onclick` 必须挂到 `window`**。打包成 IIFE 后，HTML 与模板串里写的函数名不在全局作用域。`test/inlineHandlers.test.mjs` 会双重扫描。

## 代码约定

- 分层单向：`core` < `format|pcb|sch|ui` < `app`，页面之间禁止互相引用，`check:deps` 会查环。
- 复杂度门禁（`check:js`）：单函数圈复杂度 ≤10、嵌套 ≤3、函数 ≤80 行、文件 ≤400 行；当前**硬 0 违规、无存量豁免**。页面入口放宽到 1800 行，`features.js` / `reportTemplate.js` 关闭行数限制。
- 每个模块必须有五标签模块头（`@//module/ @//description/ @//exports/ @//dependencies/ @//example/`），`test/moduleHeader.test.mjs` 会核对 `@//exports/` 与真实导出逐一对应。
- 统一具名导出，不用 `export default`。
- 新增页面数据不要用 JSON 文件（见约束 2），写成随包打包的模块。

## 改写的验证标准

| 改动类型 | 最低验证 |
| :--- | :--- |
| 纯逻辑 / 算法 | 补单测；`npm test` 全绿 |
| 写盘类（源码改写、坐标、属性覆盖顺序） | 逐字节对照旧实现；`npm run test:samples` 全绿 |
| 图表 | 固定时钟 + 固定数据拍 `getOption()` 快照，拆分前后深度比对 |
| 页面样式 / 版式 | `npm run check:layout` 0 溢出 + `node test/pages/run.mjs` 不新增报错 |
| 任何页面 | `npm run build:iframe` 后重跑测试（产物不重新生成，测试与页面看到的是旧代码） |

> `test/pages/run.mjs` 会先 `rmSync(temp/pages-smoke)`。若目录里有几千个文件，某些环境会拦批量删除——把旧目录移走再跑即可。

## 版本号维护点

| 位置 | 谁读 |
| :--- | :--- |
| `package.json` | 构建脚本、「关于」页显示的版本号（构建期注入 `__APP_VERSION__`） |
| `extension.json` | 平台读它，决定安装版本 |
| `CHANGELOG.md` / `CHANGELOG.dev.md` | 用户向摘要 / 技术档案 |

`package.json` 与 `extension.json` 的一致性由 `test/docConsistency.test.mjs` 核对。

## EDA 桥（实机调试通道）

页面「EDA 桥」是 WebSocket 客户端，连 `ws://127.0.0.1:8233/ws/eda`。服务端在仓库内，零依赖：

```bash
npm run bridge                                   # 起服务（自实现 WS + HTTP 控制面）
npm run bridge:run -- --file tools/eda-bridge/probes/00-env.js
```

页面里的「调试指令」默认关闭；只有勾选后才允许下发 `eval` / `probe`。产品包里不能默认开启远程执行入口。

---

> 开发者：WOLF4096
> 辅助开发：DeepSeek-V4.1-Flash
> 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
