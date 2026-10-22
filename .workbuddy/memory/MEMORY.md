# 项目长期记忆（wolfblack-tool / pro-api-sdk）

> 只记录跨会话仍然成立的约定与事实。日志见 `YYYY-MM-DD.md`。

## 版本支持策略（2026-10-21 由用户明确）

- 适配目标是 EDA **V3 / V4**；**V2.2 官方已停止更新**，其 API 功能残缺且官方不再修复。
  → 遇到 V2.2 的功能异常，先判断是不是平台缺陷，不要当插件 bug 去改。
- **V4 与 V3 的文件格式同构**：日志式增量存储、行 `{type,id,ticket}||{...}|`、ticket 判优一致。
  逐项差异见 `docs/FORMATLOG.md`（DOCHEAD 增加 updateTime/version、新增 EDIT_HEAD、
  PCB 坐标改 mil 且网格 ×10、ARC/CARC 合并为 ARC+arcType、布尔统一 true/false、
  原理图颜色 null=主题默认 等）。
- **判断"用新格式还是 V2 格式"必须用 `isModern()`（V3 或 V4），不能用 `isV3()`**。
  历史上 `isV3()` 只认 3.x，会把 V4 误判成 V2 并按数组格式写源码 → 写坏文档。
  `isV3()` 现在只用于"确实只对 3.x 成立"的判断。
- ⚠️ **FORMATLOG 里「V4 PCB 坐标改 mil 且网格 ×10」经实测不成立**（2026-10-21，同一 PCB 文档
  在 V2.2.45.5 与 V4.1.78 打开）：同一个 LINE 坐标、同一 POLY path、CANVAS 都是 `unit:"mil"` 栅格 5，
  数值完全一致。→ 坐标搬运与 `GRID_SIZE` 容差**不需要**乘 10。
- 实测确认：`pcb_Net.getAllNets` 在 V2.2 与 V4 **都存在**（类型声明标 Excluded，但运行时保留）；
  两版形参契约一致（Via 9 / Pad 17 / Line 8 / Arc 10 / Polyline 5）；`documentType`：PCB = 3。

## 前端样式约定（2026-10-22 统一重构后，v1.18.0）

- **只有一个 CSS 文件**：`iframe/css/common.css`，18 个页面共用。HTML 里**不写** `<style>`、
  不写 `style=""`（含 `<col style>`）；只有 JS 运行时改进度/尺寸才用内联。
- 想通用就先找公共组件：`.toolbar` / `.title` / `.hint` / `.version-tag` / `.btn`(+`-secondary`
  `-danger` `-success` `-sm`) / `.field-row` / `.segmented` / `.tbl`(+`.col-cb`) / `.status-bar`(+`.accent`)
  / `.status`(+semantic) / `.badge` / `.card` / `.legend-panel` / `.empty-state` / `.mask` / `.spinner`。
- ⚠️ **`.hidden` 必须留在文件最末**：页面段落里有 `display:grid/flex` 的元素（`#gridPreview` 等）
  要在同权重下被它压住；且不能加 `!important`——JS 会写 `style.display` 去覆盖它。
- ⚠️ **CSS 变量名 `--vscode-*` 不能改**：页面 JS 里有 `style.color = 'var(--vscode-link)'`
  这类内联值，改名会静默失效。
- ⚠️ **被 JS 查询的类名不能改**：`.sidebar-item` `.view-container` `.grid-row` `.row-cell`
  `.manual-input` `.table-header .header-cell` `.grid-item` `.unit-option` `.layer-option`
  `.dpi-value-item` `.preview-placeholder` `.main-row` `.details-row` `.sort-icon` `.sort-arrow`
  `.disabled-row` `.row-error` `.row-selector` `.opt-cb` `.cb-*` `.checkbox-cell` `.status`
  `.small-btn` `.stepper` `.list-input` `.legend-item` `.color-block` `.wh-table`。
  改结构类名时**同时**改 JS（例：`CreateFootprint.js` 的 `querySelector('.container')` → `.cf-form`）。
- `.status-bar` 默认灰底（ImportBom 的 JS 会整串替换 `className`），蓝底进度型用 `.status-bar.accent`。
- 版式自检：`npm run check:layout`（`tools/layout-check.mjs`）。尺寸从 `src/index.ts` 的
  `openPage()` 自动读取；Chrome 窗口有最小尺寸（<500px 宽被夹、矮窗口会被压到 4px），
  所以测量走「harness 页 + 精确尺寸 iframe」，别直接用 `--window-size` 当页面视口。

## 已知非插件问题（不要在插件侧修）
- `生成物理网络` V2.2 源码写入后重开会丢弧线导线 → EDA V2.2 平台缺陷。
- `批量替换器件` V2.2 替换后网表取空 / 参数补全失败 → EDA V2.2 API 缺陷。
- `从PCB创建导线` 的"切回原理图"注释写着不生效，但**实测正常**，属陈旧注释（已清理）。

## 官方图层与常量定义

- `MULTI = 12` 是"多层"，**通孔焊盘 / 过孔落在该层**（不是"通孔层"这个专名）。
- 铜层 = 顶层 1 / 底层 2 / 内层 15~46（官方层表把 15~44 定义为内层 1~30，45~46 为保留）。
- 阻焊默认值 `-1000` 是 EDA 内置默认（表示不额外扩展）。
- 完整层表：TOP=1、BOTTOM=2、丝印 3/4、阻焊 5/6、锡膏 7/8、装配 9/10、板框 11、
  MULTI=12、DOCUMENT=13、MECHANICAL=14、INNER_1..30=15..44、HOLE=47、
  COMPONENT_SHAPE=48、COMPONENT_MARKING=49、DRILL_DRAWING=56、RATLINE=57、
  CUSTOM_1..30=71..100、SUBSTRATE_1=101。
- 代码中的唯一来源：`src/js/common/pcbConstants.js`（后端 ESM）与
  `iframe/js/common.js` 的 `WolfCommon.LAYER`（前端 IIFE，两套 bundle 无法共享，改动要同步）。

## 工程约定

- 前端页面统一 `const { ... } = window.WolfCommon;` 引入公共模块（`iframe/js/common.js`），
  HTML 里必须先引 `common.js` 再引页面脚本。
- 样式：公共样式在 `iframe/css/common.css`，页面专属样式写在各 HTML 的 `<style>`。
  不要把 `* { margin:0;padding:0;box-sizing }` 或 `body { font-family/font-size }` 放进公共样式
  （会改变 About 等页面的版式）。
- 测试：`npm test`（node:test，`.mjs`），改 `common.js` / `src/js` 后必须跑；新增前端公共能力要补用例。
- 样本测试：`npm run test:samples`（`test/samples/`，脱离 EDA 跑 `测试样本/` 真实工程文件，覆盖 V2/V3/V4）。
  相关格式事实以样本实测为准：**V3/V4 内层字段叫 `layerId`（不是 `layer`）**；V2 图元 layer 在数组下标 4；
  V3/V4 日志里 **存在缺行尾 `|` 的行**；`[]` 孤立空行是 EDA 写盘残留。
- 改完必须 `npm run build`，产物在 `build/dist/wolfblack-tool_v<version>.eext`。
- `npm test` 只收集 `test/*.test.mjs`。`test/pages/` 是浏览器冒烟脚本（需要 Chrome），
  **不是** node:test 用例，不要让它被默认收集（会必然失败）。

### EDA API 的数值参数是严格类型（别传 toFixed 字符串）

- 类型声明在 `node_modules/@jlceda/pro-api-types/index.d.ts`，`width/height` 等长度参数**就是 `number`**。
- V2.2 内部会强转，**V4 严格校验**：传字符串 `"2275.00"` 直接抛
  `PcbApiError: [VALUE_OUT_OF_RANGE] width: 图像宽度 width=2275.00 必须为正数`
  —— 注意报错文案是"必须为正数"，但真实原因是**类型不对**，不要顺着"值越界"去查。
- 凡是 `toFixed()` 的结果要进 API，必须用 `WolfCommon.toApiLength(v, 2)` 回成数字
  （`iframe/js/common.js`）：极小非零值不会被舍成 0、无法解析返回 `NaN`。
- 已修：`ImportImage`（`pcb_PrimitiveObject.create` ×2）、`ImportQrcode`
  （`pcb_PrimitiveObject.create` / `convertImageToComplexPolygon` / `pcb_PrimitiveImage.create`）。
  其它页面的 `toFixed` 都已套 `parseFloat/Number` 或仅作显示。

### V4 运行时与类型声明不一致的点（实测，别照类型写）

- `lib_Device.getByLcscIds(单个编号)`：声明是数组，**V4 返回单个器件对象** → 一律用 `pickDevice()` 归一。
- `component.uuid`：V2/V3 是字符串，**V4 是对象** `{name,source,uuid}`；写源码 ATTR `Device` 要取 `.uuid`。
- PCB 器件引用有**两处**：COMPONENT 行 `attrs.DeviceName`（权威）+ ATTR `Device`（投影）。V4 只改 ATTR
  → 属性/封装被糊上去但 `component.uuid` 不变（器件没换）。两处一起改才真正切换。
- **删除临时器件会连带销毁器件定义**（V4）→ 批量替换必须「先写源码、后删临时器件」。
- `pcb_PrimitiveFill` 图元的 `primitiveType` 是 **`Fill`**，不是 `Region`；
  `pcb_PrimitiveRegion.delete()` 删填充返回 false 且**不报错**。
- `pcb_PrimitiveImage.getAll()` 在 V4 **会带上 Object 图元**，对其调 `Image.delete()` 抛 TypeError。
- 多轮廓路径（图片/二维码）：`pcb_MathPolygon.createPolygon()` 只吃扁平单路径，会返回 `undefined`；
  必须用 `createComplexPolygon()`（接受 `Array<SubPath>`）。
- 原理图源码 COMPONENT 行**必须带 `attrs`**（`Symbols`/`Devices`/`Footprints`/`DeviceName`/
  `FootprintName`/`pinClass`/`differentialPairClass`），否则 `setDocumentSource` 返回 **true 但器件被静默丢弃**
  → 表现是「导线在、符号全丢」。ATTR 行字段必须齐全、且必须有一条 `Channel ID`，否则整份拒写（返回 false）。

## 实机测试通道（EDA 桥）

- 端口可用 `npm run bridge -- 4178` 改；`/__status` 里的 `ver` 是**桥协议版本**，不是 EDA 版本
  （EDA 版本问 `eda.sys_Environment.getEditorCurrentVersion()`）。
- 定位「写入被拒」这类问题时：先写基线源码、`await 300ms`、再写变体，并失败重试一次；
  V4 在文档刚重建的窗口内会误返回 false。

- 拓扑：EDA 里的「EDA 桥」页面是 **WebSocket 客户端**，主动连 `ws://127.0.0.1:8233/ws/eda`；
  服务端在 `tools/eda-bridge/server.mjs`（自实现 WS，零依赖），**没有服务端桥就连不上**。
- 用法：`npm run bridge` 起服务 → EDA 里开「EDA 桥」并**勾选「调试指令」** → 点连接 →
  `npm run bridge:run -- --file tools/eda-bridge/probes/00-env.js` 下发探针；
  `--status` 看连接状态。业务侧也可用 `POST /__cmd` 同步下发。
- 指令：`ping` / `import`(建图元) / `probe`(只查 API 是否存在) / `eval`(在页面跑代码，可用 `eda`/`arg`)。
  `eval`、`probe` **默认关闭**，必须在桥页面勾「调试指令」——产品不能默认带远程执行入口。
- 探针写在 `tools/eda-bridge/probes/*.js`，内容是「在 EDA 页面里执行的代码片段」，
  顶层 `return` 不是合法模块，已加入 `.prettierignore`。


## 图层实测补充（官方表之外）

- 官方层表只列到「内层 30」，但真实工程里有 `INNER_31=45`、`INNER_32=46`（样本里叫 Inner31/Inner32）。
- 基板层实际编号从 **361** 起（`["LAYER",361,"SUBSTRATE","Dielectric1",...]`），官方表的 `SUBSTRATE_1=101` 对不上。
- 因此图层合法性用 `pcbConstants.isKnownLayer()`（官方表 + 铜层 15~46 + 基板 361+），不要只查表。


## V4 实机差异（2026-10-21 双客户端对照，同一 PCB 文档）

- **器件属性**：V4 `pcb_PrimitiveComponent.getAll()` 的 `otherProperty` **无 `Device`/`DeviceName`**；
  `comp.name` 是模板 `"={Value}"`（值在 `otherProperty.Value`）；**器件名在 `comp.component.uuid.name`**。
  → 读器件名要 `props.Device || comp.component?.uuid?.name || manufacturerId`。
- **网表**：V4 根对象 `{version:"2.0.0", projectId, components, designRule…}`；器件**没有 `pins`**，
  改 `pinInfoMap`（`{pin:{name,number,net,…}}`）。`getComponentsContainer()` 已兼容，读引脚必须两套都判。
- **写源码**：V4 `setDocumentSource(读出来的原文)` 会**丢掉 `POURED` 行**（铜皮填充缓存），V2.2 逐字节一致。
  → 整份写回的功能在 V4 要让用户重算铜皮。
- **`pcb_PrimitivePolyline.delete(regionId)` 返回 true 但不删**；Region 只能用 `pcb_PrimitiveRegion.delete`。
- **角度**：Arc 与多边形路径 `"ARC"` 都是**角度制**（两版一致），不要乘 π/180。
- **量纲**：V4 焊盘尺寸量化到 0.1 mil；阻焊默认 V2.2=0.2 / V4=2（差 10×，不是单位换算）→ 校准值别跨版本复用。
- V4 新增可用：`sys_Environment.isEditorCurrentVersionGreaterThanOrEqual`、`dmt_EditorControl.waitForDocumentReady`。

## 导线⇄线条（用户明确的两条业务约束）

- **必须先删后建**：两根交叉导线（ID1/ID2）一旦同时存在，系统会自动拆成 ID3/4/5/6 四段，
  之后按原 ID 已删不掉。所以转换流程是「删原图元 → 建新图元」，不能反过来。
  代价是失败后原图元已消失 → 每条路径都必须用删除前的快照 `_restoreItem()` 重建兜底。
- **导线转线条要合并连续段**：框选多条首尾相接的导线时输出**一条连续折线**，不是每段一条碎折线。
  实现在 `src/js/common/wireChain.js`（纯函数，可单测）：按 `layer + net + 线宽` 分组，
  反向段自动反转、弧线反向角度取负，端点容差 1e-3 mil。

## 格式化注意（别踩）

- 不要对**旧文件整份**跑 `prettier --write`：工作区是 CRLF、旧文件用 4 空格缩进，
  而 `.prettierrc` 是 `useTabs + endOfLine: lf` → 会把 `GenerateNet.js` 等整体重排（3000+ 行假 diff）。
  改旧文件用手工最小编辑；新文件（如 `wireChain.js`、新测试）按 prettier 风格写。

## 宿主加载机制（2026-10-22 实测，决定前端不能拆成多文件 ESM）

EDA 扩展的 iframe 页面**不是文件 URL**，而是宿主拼出来的 `blob:` 文档：

- `location.href` / `document.baseURI` = `blob:https://pro.lceda.cn/<uuid>`，没有 `<base>` 标签；
- 页面里每个 `<script src>` 都被改写成**独立的、无 MIME 的 blob URL**（结尾连 `.js` 都没有）；
- 宿主**不通过 https 提供**扩展文件：`GET https://pro.lceda.cn/iframe/js/common.js` → 404（返回 IDE 的 SPA 兜底页）。

由此得到三条硬约束（都是实测，不是推测）：

1. **不能用原生 ESM**：`<script type="module">` 与 `import './x.js'` 都会失败。两个独立死因——
   脚本 blob 无 JS MIME（`Failed to fetch dynamically imported module`）、
   `blob:` 基址不是分层 URL（`Invalid relative url or base scheme isn't hierarchical`）。
   → 前端模块化只能「源码写 ESM + **esbuild 按页打包成单文件 IIFE**」。
2. **不能 fetch 站内相对路径**：`fetch('/iframe/js/common.js')` 直接 `Failed to parse URL`。
   → 任何"运行时读本地资源"的写法都是死的。
3. **渲染器本身支持 ESM/TLA**（`import('data:text/javascript,...')`、blob 带正确 MIME 的 import 都成功），
   所以这不是浏览器老，不要往 polyfill 方向试。

**已知遗留 bug（本轮发现，未修）**：`WorkingHours.js` 的 `loadLibForInline()` 用
`fetch('/iframe/js/echarts.min.js')` 想内联本地库实现「离线看报告」，按上面第 2 条**必然失败并静默回退 CDN**
→ 离线打开导出报告图表仍是空的。正解是构建期把库源码作为字符串打进 bundle（`loader: { '.txt': 'text' }`）。

