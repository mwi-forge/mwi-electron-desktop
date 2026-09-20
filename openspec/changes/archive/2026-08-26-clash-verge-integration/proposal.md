# Proposal: clash-verge-integration

## Why

mwi-electron-desktop 的「反关联」能力目前依赖每个账号填写一个固定的代理 host:port (`lib/proxy.js`)。用户希望升级到「Clash Verge 模式」：
- 客户端能配置 Clash 订阅 URL（一份订阅可被多个账号共享）
- 每个账号启动时可从订阅节点池里选一个不同的代理节点
- 同一个账号也能切换节点，无需手动改 host/port

目前能力缺这一层：
- 没有订阅解析能力（YAML / base64 行式订阅）
- 节点都是 ss / trojan / vmess / vless 协议，而 `session.setProxy()` 只认 socks5/http（Electron 限制）
- 多账号共享一份代理的语义没有抽象

如果用户继续给每账号手填 ip:port，则以下场景无法实现：
- 同一个机场订阅，账号 A 用 HK-01，账号 B 用 JP-03
- 节点池里的失效节点被自动跳过
- 切换节点时不需要重启账号


## Capabilities

### New Capabilities

- `subscriptions`: Clash 订阅池（CRUD + 立即刷新 + 自动刷新 + 节点测速）
- `socks-gateway`: 本地 socks5 gateway 池（节点 → mihomo 子进程 → 127.0.0.1:<port> 出口）
- `proxy-extension`: account.proxy 升级为三态 schema（direct / manual / subscription）

### Modified Capabilities

(无 — 现有 accounts.* / views.* / proxy.* IPC 协议保持不变，仅在内部新增 source 分发)

## Impact

- **代码层**：新增 4 个文件 (`lib/clash.js`, `lib/subscriptions.js`, `lib/socks-gateway.js`, `src/js/subscription-tab.js` + 对应 css)，修改 5 个文件 (`lib/proxy.js`, `lib/accounts.js`, `lib/ipc.js`, `preload.js`, `src/js/account-form.js`, `src/js/tabbar.js`, `src/index.html`)。
- **依赖层**：新增 `mihomo` npm 包（含 Go 二进制，安装包约 +15-25MB，每个 gateway 实例运行期内存约 +30MB）；新增 `yaml` npm 包（解析 Clash 订阅）
- **数据层**：新增 `subscriptions.json` 持久化文件（electron-store 实例并列），节点敏感字段（password / uuid）走 safeStorage 加密
- **IPC 层**：preload `window.api.subscriptions.{list,add,update,delete,refresh,listNodes,measureNodes,measureNode}` 共 8 个新方法；主进程 `subscriptions.*` handler 8 个
- **运行时**：账号启动时若 source=subscription，多 1-3s gateway spawn 延迟（一次性，每次 stops 释放）

## What Changes

在主进程侧引入 **本地 socks5 gateway 池**，作为订阅节点（任意协议）与 Electron session（仅 socks5/http）之间的桥梁：

1. **订阅管理**（`lib/subscriptions.js` + `subscriptions.json`）
   - 增删改查 + 立即刷新 + 后台自动刷新（24h）
   - Clash YAML 格式与 base64 行式两种订阅格式兼容
   - 订阅与账号解耦，多账号可共享同一份订阅

2. **socks5 gateway 池**（`lib/socks-gateway.js`）
   - 用 Node 内置 `net` 模块起本地 socks5 server
   - 上游协议（ss / trojan / vmess / vless）通过 **捆绑的 mihomo 二进制**（spawn 子进程）处理——与 Clash Verge 内核同源（MetaCubeX/mihomo v1.19.25 arm64 实测可 spawn + 端口可配 + 0.12s 启动）
   - gateway port 由主进程分配，每次 `allocate(node)` 返回 127.0.0.1:<port>

3. **账号 proxy 字段升级**（`lib/accounts.js` schema）
   - `source: "manual"` + 现有 { type, host, port, ... } —— 兼容旧数据，零迁移
   - `source: "subscription"` + `{ subscriptionId, nodeId }` —— 新增
   - `proxy === null` —— 直连
   - 启动时根据 source 走不同路径：manual 走 session.setProxy（旧链路），subscription 走 gateway + session.setProxy

4. **IPC + preload 扩展**
   - 新增 `subscriptions.*` IPC：`list / add / update / delete / refresh / listNodes`
   - 不新增 `gateway.*` IPC —— gateway 分配由主进程 `accounts.start` 内部自动调用，账号流程对 UI 透明

5. **UI 扩展**
   - 主区新增「代理订阅」tab（在「添加账号」tab 同一层级）
   - tab 内：粘贴订阅 URL → 立即刷新 → 节点列表（含名称 / 类型 / 延迟）
   - 账号表单里 proxyType 字段多一项「从订阅选节点」

## Alternatives Considered

### A. 只支持 socks5/http 节点（订阅过滤）
- 拒绝：90% 机场节点是 ss / trojan，过滤即没作用

### C. 捆绑 mihomo 二进制作为本地 outbound gateway（最终选定）
- 用户拍板「A：mihomo npm 包」，但 **POC 发现 npm 上不存在 `mihomo` 包（404）**
- 真实存在的 `@niubir/node-mihomo` 代码是 javascript-obfuscator 混淆产物（不可审查，单维护者，弃用）
- 因此落地为：**捆绑 MetaCubeX/mihomo 官方二进制**（与 Clash Verge 内核同源，本机 Clash Verge 2.5.1 自带 verge-mihomo v1.19.25 实测可用）
- 本机已有该二进制（/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo），POC 已验证 spawn + 端口 + socks5 真请求全部通过

### B. 手写 ss / trojan 协议解析
- 协议覆盖不全（缺 vmess / vless）
- AEAD 帧字节序坑多
- 已被 A 替代

### D. 当前方案（mihomo npm 包 + 本地 socks5 gateway）
- 协议栈完整（ss / trojan / vmess / vless / hysteria）
- 在 Node 进程内闭环，不暴露 OS 层 sidecar
- 代价：引入 mihomo npm 依赖（含 Go 二进制），安装包约 +15-25MB；启动 mihomo 子进程约 +30MB 内存

## Non-goals

- **不**实现规则路由 / 策略组 / TUN —— 这是 mihomo 全局代理层的能力，本项目是 per-session 隔离，不需要
- **不**实现 TUN 模式或系统代理接管
- **不**修改现有 accounts.* IPC 协议（仅扩展 schema，新增字段向后兼容）
- **不**修改现有 `lib/proxy.js` 的手动代理路径（保持兼容）
- **不**引入前端框架（仍 vanilla HTML/CSS/JS）
- **不**订阅自动测速（首版用「立即手动刷新」，自动测速留后续）
- **不**支持订阅自动切换（如多订阅切换）—— 首版只支持一份或多份订阅，所有账号可共用

## Risk

- **二进制分发**：需随 electron-builder 打包 mihomo 官方二进制（extraResources），覆盖 darwin-arm64 / darwin-x64 / win32-x64 / linux-x64 四平台；用官方 release 下载而非 npm（npm 无此包）
- **gateway 进程生命周期**：mihomo 子进程崩溃未捕获时会留下 zombie；需要 SIGTERM + 重试 + 主进程退出时清理
- **端口冲突**：每个 gateway 占一个端口；多个账号同时启动需要端口分配器；需预留端口范围（如 7890-7999）和释放机制
- **session.setProxy 协议纯度**：必须确保 `127.0.0.1:<gatewayPort>` 是 *纯 socks5*，mihomo 上游不能用 http，避免双重协议混淆
- **密钥保管**：订阅节点 password / uuid 等敏感字段需要走 safeStorage 加密（与现有 proxy.password 一致），不能明文落 subscriptions.json
- **多订阅并发刷新**：自动刷新调度器需要错峰，避免同时拉多个订阅触发源站限流
- **账号启动时 gateway 延迟**：node 拉起 + mihomo 子进程启动约 1-3s，期间可能影响 webContents 启动观感

## Status

APPLY IN PROGRESS —— Phase 1 POC 已完成（mihomo 二进制 spawn + socks5 真请求 HTTP 204 验证通过）。协议库从「mihomo npm 包」修正为「捆绑 mihomo 二进制」（npm 无此包，POC 实测本机 Clash Verge 自带 verge-mihomo v1.19.25 可用）。