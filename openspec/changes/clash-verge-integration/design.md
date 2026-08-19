# Design: clash-verge-integration

## Context

参见 proposal.md - Why / What / Alternatives / Risk。当前状态约束：

- mwi-electron-desktop 是单窗口 Electron 43 应用，主窗口 webContents 加载 src/index.html
- 已启动账号通过 WebContentsView 池（lib/views.js）实现 per-session 隔离
- lib/proxy.js 用 session.setProxy() 给每个 session 配 socks5/http outbound
- 现有 IPC 协议：`accounts.* / views.* / layout.* / logs.* / metrics.* / proxy.* / fingerprint.* / tampermonkey.* / groups.* / meta.*`
- 持久化：accounts.json (electron-store)，safeStorage 用于敏感字段加密
- UI：vanilla HTML/CSS/JS，DSH 深色模式，主蓝 #7B9EFF，无前端框架

## Goals / Non-Goals

Goals:
- 客户端支持配置 Clash 订阅 URL，解析为本地节点池
- 多账号共享同一份订阅，每账号启动可选不同节点
- 协议覆盖：ss / trojan / vmess / vless（用 mihomo npm 包覆盖完整协议栈）
- 复用现有 per-session proxy 链路（session.setProxy → 127.0.0.1:<gatewayPort>）
- 向后兼容：现有手填 socks5/http 账号无需迁移

Non-Goals（详见 proposal.md）:
- 不实现规则路由 / 策略组 / TUN / 系统代理接管
- 不订阅自动测速（首版只用手动刷新）
- 不修改现有 accounts.* IPC 协议
- 不引入前端框架

## Decisions

### 1. 协议栈选择：捆绑 mihomo 二进制（spawn 子进程）

选择：在 Node 进程内 spawn mihomo 二进制子进程，作为本地 socks5 gateway 的上游协议实现。POC 已实测（见下）。

理由：
- mihomo 是从 Clash 官方 fork 的现代版本，协议栈完整（ss / trojan / vmess / vless / hysteria / hysteria2 等）
- **npm 上不存在 `mihomo` 包**（POC 实测 404）；真实候选 `@niubir/node-mihomo` 是混淆代码不可用
- 因此捆绑官方二进制：本机 Clash Verge 2.5.1 自带 verge-mihomo v1.19.25（40MB arm64），spawn 后 1.2s 端口 OPEN，socks5 真请求 HTTP 204 / 0.12s
- 跨平台分发：electron-builder extraResources 打包各平台官方 release 二进制

替代考虑：
- 手写 ss / trojan 协议 → 拒绝：协议覆盖不全，AEAD 帧字节序坑多
- `mihomo` npm 包 → POC 确认不存在（404），`@niubir/node-mihomo` 混淆代码不可用
- 最终：捆绑官方 mihomo 二进制（与 Clash Verge 同源，已验证）

### 2. socks5 gateway 用 Node 内置 net 模块

选择：本地 socks5 server 用 Node 内置 `net.createServer()`，每个 gateway 一个实例。

理由：
- 不引入额外网络库依赖
- 协议简单，~150 行实现（CONNECT + 简单 UDP ASSOCIATE 不需要）
- 每个 gateway 监听一个本地端口，username/password 鉴权可选

替代考虑：
- 直接用 mihomo 作为唯一入口（不开 Node socks5）→ 拒绝：mihomo 默认是 http + socks5 混合端口，无法保证纯 socks5，session.setProxy 需要纯净协议端口

### 3. 端口分配策略：预留端口范围 + LRU 回收

选择：端口分配器（lib/ports.js 或 lib/socks-gateway.js 内部状态）维护 7890-7999 范围。

理由：
- 多账号同时启动时每个都需要独立 gateway（避免 session 间流量互通）
- 19 个端口足以应对单用户最多 6 个 WebContentsView 的现状（lib/views.js 上限 6）
- LRU 回收：账号停止时释放端口

### 4. subscriptions.json 与 safeStorage

选择：订阅节点的 password / uuid 等敏感字段加密存；其他字段明文。

理由：
- 与现有 lib/accounts.js 的 proxy.passwordEncrypted 模式一致
- safeStorage 是平台原生机制（macOS Keychain / Windows DPAPI / Linux libsecret），无需自实现加密

### 5. UI 在 tab 层放订阅管理

选择：复用现有「静态 tab」机制（tabbar.js formTabs），新增一个 `type="proxy-subscriptions"` 的静态 tab。

理由：
- 与「添加账号」表单 tab 同层级，UI 一致性
- 中部 canvas 显示静态 HTML，不需要新 BrowserWindow
- 关闭订阅 tab 即释放内存视图

### 6. 账号表单 proxyType 扩字段

选择：在账号表单的代理类型下拉新增两项「Clash 订阅 / 节点名下拉」二选段。

理由：
- 不重构现有账号表单，仅扩展一个 fieldset
- 复用 custom-select 组件（已有）
- 兼容性：source=null/manual 路径完全不变

## Architecture

```
                     [订阅管理 UI]
                            |
                            v
              subscriptions.list/add/update/delete/refresh
                            |
                            v
                [lib/subscriptions.js]
                    |              |
                    v              v
         subscriptions.json   HTTP fetcher (lib/clash.js)
                                    |
                                    v
                          YAML / base64 解析
                                    |
                                    v
                          标准节点数组写入 subscriptions.json

                     [账号启动]
                            |
                            v
              accounts.start(accountId)
                            |
                  if account.proxy.source == "subscription":
                     |
                     v
              socksGateway.allocate(node)
                     |
                     v
              mihomo 子进程 (127.0.0.1:<port>)
                     |
                     v
              session.setProxy({ proxyRules: "socks5://127.0.0.1:<port>" })

                     [账号停止]
                            |
                            v
              accounts.stop(accountId)
                            |
                     v
              socksGateway.release(gatewayId)
                            |
                     v
              mihomo 子进程 SIGTERM
```

## Key Modules

| 文件 | 角色 |
|---|---|
| `lib/clash.js` | Clash YAML / base64 订阅解析，转换为统一节点 schema |
| `lib/subscriptions.js` | 订阅 CRUD + 立即刷新 + 自动刷新调度 + 持久化 |
| `lib/socks-gateway.js` | 本地 socks5 server + 上游 mihomo 子进程管理 + 端口分配 |
| `lib/ports.js` | 端口分配器（可选拆出，便于单测） |
| `lib/proxy.js` | 扩展 `bindSessionProxy(session, accountId)`，分发 manual / subscription 路径 |
| `lib/accounts.js` | `account.proxy` schema 兼容旧数据，启动时绑定 gateway |
| `lib/ipc.js` | 新增 `subscriptions.*` IPC（6 个 handler） |
| `preload.js` | 暴露 `api.subscriptions.*` + 现有 api 同步扩展 |
| `src/js/subscription-tab.js` | 订阅管理 tab 渲染 + 节点列表 + 立即刷新按钮 |
| `src/css/subscription-tab.css` | 订阅 tab 样式（复用 sidebar.css .modal-* 与 custom-select 风格） |
| `src/js/account-form.js` | 扩展 proxy fieldset，新增「从订阅选节点」分支 |
| `src/index.html` | 新增 <link> + <script> 引用 + main 区 mount 点 |
| `lib/__tests__/clash.test.js` | 订阅解析测试（YAML + base64 双格式） |
| `lib/__tests__/socks-gateway.test.js` | gateway 分配 / 释放 / 端口回收测试（用真实 mihomo 子进程或 stub） |

## Open Questions

- mihomo 二进制在 electron-builder 打包后是否能正确解包到 resources 并 spawn？（POC 已验证本机直接 spawn 可行，打包路径待 Phase 5 验证）
- 自动刷新间隔：固定 24h 还是按订阅 expire 字段？
- 多账号同时绑定同一节点是否共用 gateway？会话间是否会泄露 cookie？需要 design 验证
- safeStorage 加密节点 password 的密钥派生是否复用 accounts.* schema 的现有方案？