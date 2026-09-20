# Spec: socks-gateway

## Purpose

本地 socks5 server 池。每个 gateway 对应一个 mihomo 子进程，把任意订阅协议节点（ss / trojan / vmess / vless ...）转换为 socks5 出口，给 Electron session.setProxy() 用。

## ADDED Requirements

### Requirement: gateway 实例生命周期

The system MUST 通过 `lib/socks-gateway.js` 的 `allocate` / `release` 管理 gateway 实例。

#### Scenario: allocate(node) 成功路径
- WHEN 调 `allocate({ id: "sub-xxx", nodeId: "HK-01" })`
- THEN 内部：从 7890-7999 取最小空闲端口 → spawn mihomo 子进程绑定 127.0.0.1:<port> 纯 socks5 模式 → 起 Node socks5 listener → 等到 port listen + 子进程 health-check 通过（5s 内）→ 写入 pool Map → 返回 `{ id, host: "127.0.0.1", port }`

#### Scenario: allocate 失败路径
- WHEN 端口被占 / mihomo spawn 失败 / 启动超时
- THEN 抛带 type 的 Error: `err.type = "port_in_use" | "spawn_failed" | "startup_timeout"`
  - 已 spawn 的子进程若还在跑，必须 SIGTERM + wait reaped 后再抛

#### Scenario: release(id)
- WHEN 调 `release(id)`
- THEN 找到对应 gateway 实例：SIGTERM mihomo 子进程 → close socks5 listener → 释放端口到空闲池 → 从 pool Map 移除
  - 若 id 不存在，幂等返回 ok

#### Scenario: app before-quit 清理
- WHEN Electron 主进程准备退出
- THEN `app.on("before-quit", ...)` 中遍历 pool Map 全部 release（kill mihomo + close listener）

### Requirement: 端口分配

The system MUST 在 7890-7999 范围内 LRU 分配端口。

#### Scenario: 端口池初始化
- WHEN 模块加载
- THEN `availablePorts = new Set([7890..7999])` = 110 个端口

#### Scenario: 分配最小空闲端口
- WHEN allocate 需要端口
- THEN 取 availablePorts 中最小的（Set 迭代顺序按插入），分出去

#### Scenario: 释放回收
- WHEN release 把端口归还
- THEN 端口重新插入 availablePorts

### Requirement: Node socks5 server 实现

The system MUST 用 Node 内置 `net` 模块实现 socks5 监听。

#### Scenario: socks5 handshake
- WHEN 客户端连接 + 发 socks5 握手 (0x05 0x01 0x00)
- THEN server 回复 (0x05 0x00) → 进入 CONNECT 命令阶段
  - 本期仅支持 CONNECT（不支持 BIND / UDP ASSOCIATE）

#### Scenario: CONNECT 命令
- WHEN 收到 CONNECT 请求
- THEN 解析目标地址（IPv4 / 域名）
  - 创建到 mihomo 子进程端口的 socket 转发
  - 双向 pipe 字节流
  - 完成后双端 reply (0x05 0x00 0x00 ...)

### Requirement: mihomo 子进程管理

The system MUST 把 mihomo 作为受管子进程 spawn。

#### Scenario: 子进程 spawn
- WHEN allocate 需要 mihomo 实例
- THEN 通过 mihomo npm 包调 `launch({ port, mode: "socks5" })` 或等价 API（待 Phase 1 POC 确认具体 API）
  - 子进程 stdout / stderr 通过 `lib/logs.js` 转发（mihomo.<gatewayId>.log）

#### Scenario: 子进程 crash
- WHEN mihomo 子进程异常退出
- THEN pool Map 中对应 entry 移除 + 端口归还 + 主进程 emit `gateway:crashed` 事件给 IPC 层
  - 绑定此 gateway 的 session 在下次请求时会失败（由 browser 自愈）

### Requirement: 健康检查

The system MUST 在 allocate 期间等待 gateway 就绪。

#### Scenario: connect-back probe
- WHEN mihomo spawn 之后
- THEN 用 net.connect 试探 127.0.0.1:<port> 端口（不是 socks5 协议握手，只是 TCP 端口可达）
  - 5s 内连不上视为启动超时

## Modified Requirements

### Requirement: lib/proxy.js

The system MUST 扩展 `bindSessionProxy(session, accountId)` 取代现有 `setSessionProxy` 调用入口。

#### Scenario: 三种 source 分发
- WHEN bindSessionProxy 被调
  - AND account.proxy === null → setProxy({mode:"direct"})
  - AND account.proxy.source === "manual" → 走原 buildProxyRules 路径
  - AND account.proxy.source === "subscription" → socksGateway.allocate(node) → setProxy({proxyRules: "socks5://127.0.0.1:<port>"})

#### Scenario: 节点失效降级
- WHEN subscription 节点已删除（subscriptions.listNodes 返回空 / 没有此 nodeId）
- AND bindSessionProxy 执行时检测到
- THEN setProxy({mode:"direct"}) + lib/logs.js 记录 warning
  - 不会抛异常（不要让 session 启动失败）
### Requirement: 节点共享 + 独占

The system MUST 默认让多个账号共用同一个 gateway 实例；高级用户可显式选择独占。

#### Scenario: 默认共享语义
- WHEN bindSessionProxy(session, accountId) 处理 source="subscription" 账号 A
  - AND 已有账号 B 已用同一 `(subscriptionId, nodeId)` gateway
  - THEN socksGateway 复用 B 的 gateway（refCount +1），不新起 mihomo 子进程
  - AND session A 指向与 B 相同的 127.0.0.1:<port>（per-session 是 socket pool 隔离，socks5 协议层无状态，不会泄露 cookie 或指纹）

#### Scenario: refCount 释放
- WHEN 所有引用某 gateway 的账号都 stopView 完成
  - THEN gateway refCount 归 0 → 自动 release（SIGTERM mihomo + close listener）

#### Scenario: 高级用户显式独占
- WHEN 账号 A 的 proxy 配置带 `exclusive: true` 字段（高级 UI 复选框）
  - THEN socksGateway.allocate(node, { exclusive: true }) 起**独立** gateway，即使节点相同也不复用别人的
  - 典型场景：用户怀疑节点被多账号共用时触发"污染指纹"风险，要专用

#### Scenario: 共享安全论证
- WHEN 多个 session 指同一 socks5:gateway
  - AND Electron per-session 创建独立 socket pool（不会因 SOCKS5 共用而串 session）
  - AND mihomo 是无状态 proxy（不维护 session 内的 IP/地理/UA 等指纹绑定）
  - THEN 不会因共享导致账号指纹交叉污染（ref 注释：fingerprint 由 lib/fingerprint.js 在每个 session 启动时注入 webContents，socks5 层只透传字节流，不参与指纹合成）
