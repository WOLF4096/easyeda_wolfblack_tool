# 项目长期记忆（wolfblack-tool / pro-api-sdk）

> 只记跨会话仍成立的约定与事实。过程日志见 `YYYY-MM-DD.md`；细节查 `docs/`。

## 版本与格式

- 适配目标 **V3 / V4**；V2.2 官方停更，其异常先判平台缺陷，别当插件 bug 修。
- 判"新格式 or V2 格式"必须用 `isModern()`（V3 或 V4），**不能用 `isV3()`**（历史上把 V4 误判成 V2 写坏文档）。
- ⚠️ `docs/FORMATLOG.md` 里「V4 PCB 坐标改 mil 且网格 ×10」**实测不成立**：同一 PCB 文档在 V2.2.45.5 与
  V4.1.78 下 LINE/POLY/CANVAS 的 `unit:"mil"`、栅格 5、数值完全一致 → 坐标搬运与容差**不乘 10**。
- 样本实测：V3/V4 内层字段叫 `layerId`（不是 `layer`）；V2 图元 layer 在下标 4；V3/V4 日志存在缺行尾 `|`
  的行；`[]` 孤立空行是 EDA 写盘残留。

## EDA API 坑（实测，别照类型声明写）

- **数值参数是严格 number**：V4 传 `"2275.00"` 抛 `PcbApiError [VALUE_OUT_OF_RANGE] … 必须为正数`
  ——报错文案是"必须为正数"，真实原因是**类型不对**。凡 `toFixed()` 结果进 API 必须
  `WolfCommon.toApiLength(v, 2)`（现为 `core/num.js`）回成数字。
- `lib_Device.getByLcscIds(单个编号)`：声明数组，V4 返回**单个对象** → 用 `pickDevice()` 归一。
- `component.uuid`：V2/V3 字符串，**V4 是对象** `{name,source,uuid}`；写 ATTR `Device` 取 `.uuid`。
- PCB 器件引用两处：COMPONENT 行 `attrs.DeviceName`（权威）+ ATTR `Device`（投影）。**两处都改**才真正换器件；
  且 V4 **删除临时器件会连带销毁器件定义** → 替换流程必须「先写源码、后删临时器件」。
- `pcb_PrimitiveFill.primitiveType` 是 `Fill` 不是 `Region`；`pcb_PrimitiveRegion.delete()` 删填充返回 false 且不报错；
  `pcb_PrimitivePolyline.delete(regionId)` 返回 true 但不删。
- `pcb_PrimitiveImage.getAll()` 在 V4 会带 Object 图元，对其调 `Image.delete()` 抛 TypeError。
- 多轮廓路径：`pcb_MathPolygon.createPolygon()` 只吃扁平单路径 → 必须用 `createComplexPolygon()`。
- 原理图 COMPONENT 行**必须带完整 `attrs`**，否则 `setDocumentSource` 返回 **true 但器件被静默丢弃**；
  ATTR 行字段须齐全且必须有一条 `Channel ID`，否则整份拒写（false）。
- V4 `setDocumentSource(原文)` 会**丢 `POURED` 行**（铜皮缓存）→ 整份写回类功能要让用户重算铜皮。
- V4 `getAll()` 的 `otherProperty` 无 `Device`/`DeviceName`，器件名在 `comp.component.uuid.name`；
  读名用 `props.Device || comp.component?.uuid?.name || manufacturerId`。
- V4 网表根对象 `{version:"2.0.0",…}`，器件**没有 `pins`**，改 `pinInfoMap` → 读引脚两套都判。
- 角度：Arc 与多边形 `"ARC"` 都是**角度制**，不乘 π/180。V4 焊盘量化 0.1 mil；阻焊默认 V2.2=0.2 / V4=2（差 10×）。
- 非插件问题：V2.2「生成物理网络」丢弧线导线、「批量替换器件」网表取空，都是平台缺陷。

## 图层

- 层表唯一来源：`src/js/common/pcbConstants.js`（后端）+ 前端模块（两套 bundle，改动要同步）。
- TOP=1 BOTTOM=2 丝印3/4 阻焊5/6 锡膏7/8 装配9/10 板框11 **MULTI=12（多层，通孔焊盘/过孔落此层）**
  DOCUMENT=13 MECHANICAL=14 内层15~46（官方只定义到 44）HOLE=47 COMPONENT_SHAPE=48 MARKING=49
  DRILL_DRAWING=56 RATLINE=57 CUSTOM=71~100。
- 官方表之外：真实工程有 `INNER_31=45`/`INNER_32=46`；基板层实际从 **361** 起（官方 `SUBSTRATE_1=101` 对不上）。
  → 合法性用 `pcbConstants.isKnownLayer()`，别只查表。阻焊 `-1000` = EDA 内置默认。

## 宿主加载机制（决定前端架构）

iframe 页面是宿主拼的 **`blob:` 文档**（`location.href = blob:https://pro.lceda.cn/<uuid>`），无 `<base>`，
每个 `<script src>` 都是独立无 MIME 的 blob URL。由此三条硬约束：

1. **不能用原生 ESM**（`type="module"` / `import './x.js'` 都失败）→ 只能「源码 ESM + esbuild 按页打包单文件 IIFE」。
2. **不能 fetch 站内路径**（`fetch('/iframe/js/x.js')` → `Failed to parse URL`）→ 运行时读本地资源一律是死的，
   要内联库只能**构建期**打成字符串常量。
3. 渲染器本身支持 ESM/TLA，别往 polyfill 方向试。

## 工程约定与门禁

- `npm test` 的 `pretest` 跑 `npm run check`：`check:deps`（分层 `core` < `format|pcb|sch|ui` < `app`，页面禁互依、查环）
  + `check:js`（ESLint complexity ≤10 / max-depth ≤3 / 函数 ≤80 行 / 文件 ≤400 行）。
  **2026-10-22 起 `config/eslint-baseline.json` 的 counts 为空 → 门禁是硬 0，没有存量豁免。**
- 源码 `iframe/js/src/`（ESM），产物 `iframe/js/app/<Page>.js`（`npm run build:iframe`）；`common.js` 门面已删除。
- ⚠️ IIFE 化后 HTML 行内 `onclick` 目标必须 `Object.assign(window, {...})`，`test/inlineHandlers.test.mjs` 双重扫描；
  每个 `index.js` **只加一次**该 Object.assign。
  ⚠️ 该测试用**非贪婪**正则截取那个 `{...}`：字面量里出现 `})`（如 `f: () => g({a})`）会提前截断 →
  带参数的箭头函数要提到外层常量。
- 新增/修改模块必须有五标签模块头，`test/moduleHeader.test.mjs` 核对 `@//exports/` 与真实导出。
  ⚠️ `@//example/` 里不能写 `import ... from './x.js'`：check-deps 的正则扫全文件含注释，会判成自依赖。
- 测试：`npm test`（只收 `test/*.test.mjs`；`test/pages/` 是需 Chrome 的冒烟脚本，**别**让默认收集）；
  `npm run test:samples` 跑 `测试样本/` 真实 V2/V3/V4 工程（10 用例/3 样本）——**写盘类改动必跑**。
  它 2026-10-22 前一直是坏的（还在 new Function 注入已删除的 `common.js`），现已改为 import `core/sourceLine.js` + `core/layer.js`。
- `node test/pages/run.mjs` 17/18 PASS；`WorkingHours` 的 `drawImage ... 0` 告警是 **mock 容器无布局**的既有问题，别当回归。
- 写盘类页面（GenerateNet / PcbToSch / ReplaceComponent）重构后必须做**逐字节对照**。
  2026-10-22 验证有效的手法：`git worktree add temp/x HEAD` 取旧快照 → 新旧同名模块跑同一批输入 → 逐项 `deepEqual`
  （含就地副作用与抛错文案）。注意别踩两个自坑：A/B 各调一次随机 `pick()` 会拿到不同输入；带偏移参数的函数两侧要传同一组偏移。
- ⚠️ 别对旧文件整份跑 prettier（工作区 CRLF + 旧文件 4 空格，`.prettierrc` 是 useTabs + lf → 几千行假 diff）。
- 样式只有 `iframe/css/common.css`（18 页共用）；`.hidden` 必须留文件最末且无 `!important`；`--vscode-*` 变量名不能改；
  被 JS 查询的类名改结构时要同步改 JS。版式自检 `npm run check:layout`。

## 工时统计页的架构（v1.20.0 起）

- `index.js` 只做编排（~280 行）。`charts/options/*` 是**纯函数** option 工厂 `(data, theme, opts) => option`，
  `charts/zoomModel.js` 是缩放数值，`charts/zoomApply.js` 把窗口落到图表，`views/*Panel.js` 是各面板控制器。
- option 工厂的入参用 `runtime.chartData()`：它是「data 字段 + `ui.hiddenSeries`」的浅包装。
  工厂不 import runtime，但 tooltip 必须读到**当下**的显隐状态，所以传 Set 的引用而非副本。
- ⚠️ 「今天」的窗口要用 `getDayAlignedIndices(todayTs, todayTs)`，**不能**用 `(Infinity, -Infinity)`：
  只有存在「今天之后的数据」时两者才不同（前者止于明天零点，后者到时间轴末尾）。
- 导出报告的库内联：**构建期** gzip+base64 注入（`tools/lib-embed.mjs` + `define`），运行时用页面已有的
  fflate 解压（`libInline.js`）。`dropLabels:['CDN_FALLBACK']` 把 CDN 兜底裁掉，产物里 grep 不到 CDN 地址。
  WorkingHours.js 因此 108KB → 659KB（字符串字面量直嵌是 1.90MB，echarts 有 24.5 万 tab 要转义）。
- 图表视觉一致性验证：覆写 `window.Date` 固定时钟 + 固定 `STATS_` 种子数据，用
  `echarts.getInstanceByDom(el).getOption()` 拍 JSON 快照再深度比对（实例在 IIFE 里取不到）。


## 业务约束：导线⇄线条

- **必须先删后建**：两导线同时在会被系统自动拆段，之后按原 ID 删不掉 → 流程「删原图元 → 建新图元」，
  失败要用删除前快照 `_restoreItem()` 兜底。
- 导线转线条要**合并连续段**为一条折线（`src/js/common/wireChain.js`，纯函数）：按 `layer+net+线宽` 分组，
  反向段反转、弧反向角度取负，端点容差 1e-3 mil。

## EDA 桥（实机测试通道）

- EDA 内「EDA 桥」页是 **WS 客户端**，连 `ws://127.0.0.1:8233/ws/eda`；服务端 `tools/eda-bridge/server.mjs`
  （自实现 WS，零依赖）→ **服务端不起就连不上**。`npm run bridge` 起服务，桥页勾「调试指令」才能用
  `eval`/`probe`（默认关闭，产品不能自带远程执行入口）。`npm run bridge:run -- --file <probe>`。
- `/__status` 的 `ver` 是**桥协议版本**，EDA 版本问 `sys_Environment.getEditorCurrentVersion()`。
- 排查"写入被拒"：先写基线源码 → `await 300ms` → 写变体，失败重试一次（V4 文档刚重建时会误返回 false）。
- 探针 `tools/eda-bridge/probes/*.js` 顶层有 `return`，非法模块，已在 `.prettierignore`。

## 发布状态（2026-10-22 更新）

- 三条写盘流程 **已由用户人工验证通过**（V4）：从 PCB 转原理图、生成物理网络三种写回、批量替换器件
  → `CHANGELOG` 顶部"V4 待验证项"、评估报告里的 P0-1、汇报 §六"遗留 3 条"都必须改成已完成。
- 仍未解决：V4 整份写回丢 `POURED`（铜皮需重算）；`创建封装` 仅 V2.2 可用。
- 文档体系（v1.21.0 起）：`CHANGELOG.md` = 用户向（只写新增/修复/优化/移除，纯内部版本整段删）；
  `CHANGELOG.dev.md` = 技术档案（原 CHANGELOG 全量）；`README.md` = 用户详情、`README.dev.md` = 构建/测试。
  **功能说明唯一事实源 = `iframe/js/src/app/about/features.js`**（24 条，`brief` ≤32 字，字段 `steps[]`/`note`，
  已删 `purpose`），README 表格由 `test/docConsistency.test.mjs` 强制逐条一致 —— 改文案只改这一处。
  「关于」页版本号由 `build-iframe.mjs` 从 `package.json` 注入 `__APP_VERSION__`，不再手改。
