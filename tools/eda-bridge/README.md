# EDA 桥（本地测试通道）

让**外部进程**（命令行 / 测试脚本 / Agent）与正在运行的 EDA 通信：在 EDA 里执行代码、读网表、读源码，把结果取回来。

## 组成

| 文件         | 作用                                                                                             |
| :----------- | :----------------------------------------------------------------------------------------------- |
| `server.mjs` | WebSocket 服务端（`ws://127.0.0.1:8233/ws/eda`）+ HTTP 控制面。零依赖，自实现 WS 握手与组帧/解帧 |
| `run.mjs`    | 命令行助手：读代码文件 → `POST /__cmd` → 打印 JSON 结果                                          |
| `probes/`    | 探针脚本，每个文件是一段在 EDA 页面里执行的代码（用 `return` 返回结果）                          |

EDA 里的「EDA 桥」页面是**客户端**，主动连到服务端；服务端不能主动找到 EDA。

## 使用

1. **启动服务端**（保持常驻）：

    ```bash
    npm run bridge            # 等价 node tools/eda-bridge/server.mjs
    ```

2. **在 EDA 里连上**：打开扩展菜单的「EDA 桥」，勾选 **调试指令**（默认关闭），点「连接」。
   地址默认 `127.0.0.1:8233`。

3. **确认联通**：

    ```bash
    npm run bridge:run -- --status
    # { "connected": true, "ver": "2.2", ... }
    ```

4. **下发探针**：

    ```bash
    npm run bridge:run -- --file tools/eda-bridge/probes/00-env.js
    ```

## 指令协议

服务端 → 桥：

| 指令                                                | 说明                                                                                |
| :-------------------------------------------------- | :---------------------------------------------------------------------------------- |
| `{ id, cmd:"ping" }`                                | 探活，回传 `{ ok, ver, hasEda, debug }`                                             |
| `{ id, cmd:"import", items:[...] }`                 | 建图元（`component` / `via` / `line`）                                              |
| `{ id, cmd:"probe", paths:["pcb_Net.getAllNets"] }` | 只探测路径是否存在（`typeof`），不调用                                              |
| `{ id, cmd:"eval", code:"return 1" }`               | 在页面上下文执行代码，`code` 内可用 `eda` / `arg`，用 `return` 返回（支持 `await`） |

桥 → 服务端：`{ id, ok, value|error, ms }`，以及每 500ms 一条 `{ type:"selection", selection:{...} }`（当前选中对象）。

`eval` / `probe` 需要页面里勾选「调试指令」；未勾选时返回 `调试指令未开启`。

## 写探针

探针就是一段在 EDA 页面里跑的 JS，最后 `return` 一个可序列化对象：

```js
const ver = eda.sys_Environment.getEditorCurrentVersion();
const src = await eda.sys_FileManager.getDocumentSource();
return { ver, hasDoublePipe: src.includes('||') };
```

注意：

- 返回值经 `safeJson` 处理（循环引用、函数、DOM 节点、Blob 会被降级为字符串），但**大对象仍会拖慢往返**，取之前先 `slice`；
- `eval` 在 EDA 页面上下文执行，**不要写回文档**（`setDocumentSource` / `setNetlist`）除非你明确要做写入测试，且先在副本工程上试；
- 服务端同一时刻只服务一个桥，新连接会顶掉旧连接。

## 安全边界

`eval` 等于「只要能连上这个端口的本地进程，就能在 EDA 里执行任意代码」。因此：

- 桥页面默认**不允许** `eval` / `probe`，必须手动勾选「调试指令」；
- 服务端默认只监听 `127.0.0.1`，不要改成 `0.0.0.0`；
- 用完把勾选取消、关掉桥页面。

---

> 开发者：WOLF4096
> 辅助开发：DeepSeek-V4.1-Flash
> 本工具为非官方第三方开源扩展
