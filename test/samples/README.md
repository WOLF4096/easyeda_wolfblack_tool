# 测试样本自动化测试

用 `测试样本/` 里的**真实工程文件**验证插件的格式层，**不需要打开 EDA**。

```bash
npm run test:samples                    # 跑全部样本
npm run test:all                        # 单元测试 + 样本测试
node test/samples/run.mjs --list        # 看有哪些用例
node test/samples/run.mjs --only atom   # 只跑某类用例
node test/samples/run.mjs --verbose     # 明细里也打印警告
```

---

## 一、输入

| 项       | 说明                                         |
| :------- | :------------------------------------------- |
| 默认目录 | `测试样本/`（仓库根目录下）                  |
| 支持格式 | `*.epro`（V2.2.45 包）、`*.epro2`（V3 / V4 包） |
| 指定目录 | `--dir <path>`，相对路径以仓库根为基准       |
| 过滤样本 | `--sample V4`（文件名包含该文本）            |
| 过滤用例 | `--only layer`（用例 id 包含该文本）         |

**版本识别不依赖文件名**，只看包内证据：

- 有 `project2.json` → V3/V4 包，版本取自 `project2.json.editorVersion` 主版本（3→V3，4→V4）
- 有 `project.json` → V2 包，版本取自 `.epcb` 里 `["HEAD",{"editorVersion":...}]`
- 包内结构：
    - V2：`SHEET/<uuid>/<id>.esch`、`PCB/<uuid>.epcb`、`SYMBOL/*.esym`、`FOOTPRINT/*.efoo`，`project.json` 做索引
    - V3/V4：`project2.json` + 单个 `.epru`（所有文档的日志行连续存放，按 `DOCHEAD` 切成文档）

## 二、执行流程

```
发现样本（*.epro / *.epro2）
   ↓
装载：解包 → 识别版本 → 枚举文档 → 拆行（保留 1-based 行号）
   ↓
加载产品代码：iframe/js/common.js（假 window 注入）+ src/js/common/pcbConstants.js
   ↓
逐用例执行（每个用例对全部样本跑一遍）
   ↓
汇总 → 控制台报告 + Markdown + JSON → 按结果设置退出码
```

**为什么强调"加载产品代码"**：`splitSourceLine / joinSourceLine / isKnownLayer` 不是测试里另写的副本，而是页面和后端实际在跑的同一份代码。样本只提供数据，断言打在**产品实现**上。

## 三、用例与判定

| 用例                  | 类别      | 判什么                                                 | 失败意味着                         |
| :-------------------- | :-------- | :----------------------------------------------------- | :--------------------------------- | ---- |
| `pkg.structure`       | STRUCTURE | 必需条目存在；`project.json` 索引的 uuid 能在包内寻址  | 工程包结构变了，或索引与文件不一致 |
| `pkg.version`         | STRUCTURE | 版本可识别；`DOCHEAD.editVersion` 与工程版本同代       | 版本识别逻辑失效（会导致写错格式） |
| `doc.parse`           | FORMAT    | 每行可切分、两侧 JSON 合法、外层有 `type`              | 解析器会静默跳过该行 → 图元丢失    |
| `doc.head`            | FORMAT    | 文档头齐全：log=`DOCHEAD`、V2=`DOCTYPE`(+`HEAD`)       | 文档切分错位                       |
| `doc.id-unique`       | SEMANTIC  | 同文档内图元 id 唯一                                   | 改写源码时会改错对象               |
| `atom.ticket`         | SEMANTIC  | `ticket` 为正整数或省略                                | 并发写入判优会出错                 |
| `atom.layer`          | SEMANTIC  | 所有 `layer/layerId` 都在已知图层范围内                | 出现未知图层族（需补常量表）       |
| `write.roundtrip`     | PLUGIN    | 每行 `splitSourceLine → joinSourceLine` **逐字节**还原 | **改写源码会破坏文档**             |
| `write.trailing-pipe` | PLUGIN    | 原行没有行尾 `                                         | ` 时不得被补上                     | 同上 |
| `plugin.layer-consts` | PLUGIN    | 前后端两份 `LAYER` 一致；`MULTI=12` 判定正确           | 页面与后端的图层语义打架           |

判定规则：

- `error` → 计入失败，**退出码 1**
- `warn` → 只记录（样本自身的历史瑕疵，如 EDA 写盘残留的空 `[]` 行），**不影响退出码**
- 用例内部抛异常 → 自动转成一条 `error`，附带堆栈前 3 行

## 四、输出

### 控制台（默认）

四段式：① 样本概览 ② 用例结果 ③ 失败明细 ④ 观测数据。

```
① 样本概览
  样本                  版本  文档  行数  缺|行  结果
  Board_V2.2.45.epro    V2    10    618   0      PASS
  Board_V3.2.149.epro2  V3    17    648   1      PASS
  ProDoc_V4.1.78.epro2  V4    17    650   1      PASS
```

### 落盘报告（默认写入，`--no-write` 可关）

- `build/test-report/samples-report.json`：机读，含每个用例的全部 findings、每个样本的统计
- `build/test-report/samples-report.md`：可直接贴进 PR / 发布说明

四段之外还有 **④ 观测数据**：每个样本的图层集合、坐标量级、文档类型。它的用途是**盯格式漂移**——比如 EDA 某次改版把 PCB 坐标单位换了，`坐标量级` 会一次跳一个数量级。

## 五、不通过时怎么定位与处理

每条失败都带四要素，直接可定位：

```
[ERROR] atom.layer — Board_V2.2.45.epro › PCB(74e0a002) 第 93 行
         layer=361 不在官方图层表内
         期望: ∈ {90 个合法值}
         实际: 361
```

| 要素        | 例子                                          | 用途                                    |
| :---------- | :-------------------------------------------- | :-------------------------------------- |
| 用例 id     | `atom.layer`                                  | 判断问题性质                            |
| 位置        | `Board_V2.2.45.epro › PCB(74e0a002) 第 93 行` | 文件 › 文档(短 uuid) › 行号，可直接跳转 |
| 问题        | `layer=361 不在官方图层表内`                  | 现象                                    |
| 期望 / 实际 | `∈ {90 个合法值}` / `361`                     | 对照原始行内容                          |

处理顺序：

1. **先看是不是产品 bug**：`write.*` 与 `plugin.*` 失败＝产品实现问题，必须修代码；`FORMAT` / `SEMANTIC` 失败＝格式假设与真实文件不符。
2. **再看是不是"常量表过期"**：`atom.layer` 报未知图层，通常是 EDA 新增图层族。处理方式是把新图层补进 `src/js/common/pcbConstants.js`（附一句实测来源注释），而不是放宽断言。本项目就是靠这条发现 `45/46 = Inner31/32`、`361 = Dielectric1` 都不在官方表里。
3. **最后才考虑降级**：确实是样本自身瑕疵（如孤立 `[]` 行）时，把它降为 `warn` 并在用例里写清原因，**不要直接删断言**。
4. 修完重跑：`npm run test:samples`（退出码 0 即通过），再 `npm run build`。

## 六、扩展方式

新增用例只需在 `cases.mjs` 里加一项：

```js
{
  id: 'my.check',
  category: 'FORMAT',
  title: '一句话说明',
  run({ samples, WC, PCB }) {
    const findings = [];
    // ... 遍历 samples → docs → lines
    return findings;   // finding('error'|'warn', category, where, message, {expected, actual})
  },
}
```

`ctx` 里现成的东西：`samples`（已装载）、`WC`（前端公共模块）、`PCB`（后端图层常量）。

## 七、目录结构

```
test/samples/
  run.mjs              命令行入口（参数、调度、汇总、退出码）
  cases.mjs            用例集（10 条）
  lib/loader.mjs       解包、版本识别、文档枚举、拆行
  lib/product.mjs      加载产品代码（common.js / pcbConstants.js）
  lib/stats.mjs        图元字段提取（layer/坐标）与样本统计
  lib/report.mjs       控制台 / Markdown / JSON 三种报告
```

> 该目录在 `.edaignore` 里，**不会打进 `.eext`**，只用于开发期验证。

---

> 开发者：WOLF4096
> 辅助开发：DeepSeek-V4.1-Flash
> 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
