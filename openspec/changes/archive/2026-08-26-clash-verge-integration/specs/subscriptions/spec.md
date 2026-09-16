# Spec: subscriptions

## Purpose

全局 Clash 订阅管理。多账号共享同一份订阅（节点池），账号从订阅里选节点启动。

## ADDED Requirements

### Requirement: 数据存储

The system MUST 将订阅持久化到 `subscriptions.json`，与 `accounts.json` 并列在 electron-store 实例。

#### Scenario: 订阅记录 schema
- WHEN 用户新增订阅 `{ name, url, userAgent? }`
- THEN 自动生成 `id: "sub-" + 8 字符 base36`
- AND 写一条记录：
  - id, name, url, userAgent（默认 "ClashForWindows/0.20.0"）
  - createdAt: ISO 字符串
  - lastFetchedAt: 数字（epoch ms，未刷新时为 null）
  - nextAutoUpdateAt: 数字（默认 lastFetchedAt + 24h）
  - nodes: Node[]（解析后的节点数组，初始为空）
  - status: "idle" | "fetching" | "ok" | "error"
  - error: string | null

### Requirement: 订阅解析

The system MUST 支持两种主流订阅格式解析。

#### Scenario: Clash YAML 格式
- WHEN 远程订阅返回 YAML，含 `proxies` 数组
- THEN `parseClashYaml(yamlText)` 返回标准化 Node 数组
  - 节点类型覆盖 ss / trojan / vmess / vless / hysteria / hysteria2
  - 缺字段时记录错误节点（skip，不抛）

#### Scenario: base64 行式格式
- WHEN 远程订阅返回 base64 编码的多行 URI
- THEN `parseBase64Subscriptions(b64Text)` 按行解析 ss:// / trojan:// / vmess:// URI
  - 容忍混合格式（YAML 头 + base64 行）

#### Scenario: HTTP 拉取与格式嗅探
- WHEN 调 `fetchAndParse(url, userAgent)`
- THEN 用 Node 内置 `https` 模块拉取（设 User-Agent）
  - 嗅探首字符判断格式：`<` → YAML；`ey` → base64；其它尝试 YAML
  - 拉取失败 / 解析失败抛带 status code 的清晰错误

### Requirement: 自动刷新调度

The system MUST 按订阅粒度错峰自动刷新。

#### Scenario: 主进程启动时注册定时器
- WHEN app ready
- THEN `setInterval(autoRefreshTick, 3600000)`（每小时检查）

#### Scenario: 单条订阅触发刷新
- WHEN 当前时间 >= subscription.nextAutoUpdateAt
- THEN `refresh(id)` 被调用，写回 `lastFetchedAt` + 重新计算 `nextAutoUpdateAt`

#### Scenario: 多订阅错峰
- WHEN 同一 tick 触发多条订阅刷新
- THEN 每条 refresh 前 `await sleep(jitter)`，jitter = 1000 + random(0, 2000) ms

### Requirement: 节点敏感字段加密

The system MUST 对订阅节点的密码字段走 safeStorage 加密。

#### Scenario: 节点写入前加密
- WHEN 把 Node 写入 subscriptions.json
- THEN `node.password` / `node.uuid` 经 `lib/safe-storage.js` 的 `encrypt` 处理后存盘

#### Scenario: 节点读出后解密
- WHEN UI 拿到 Node 列表渲染
- THEN `subscriptions.listNodes(id)` 返回的 Node 对象已解密（仅内存中存在明文）

### Requirement: IPC 接口契约

The system MUST 暴露以下 preload API 给渲染进程调用。

#### Scenario: subscriptions.list / add / update / delete / refresh / listNodes
- WHEN 渲染进程调 `window.api.subscriptions.list()`
  - THEN 返回 `Subscription[]`（不含 nodes 详细）
- WHEN 调 `add({ name, url, userAgent? })`
  - THEN 同步执行：创建记录（id/status=idle）→ 立即触发 `refresh(id)` → refresh 成功后自动跑一次 `measureNodes(id)`（仅内存结果）→ 返回 `{ ok: true, id: "sub-xxxxxxxx" }`
  - AND 整体操作最长 60s 超时；超时则保留记录但 status=error，UI 显示「导入超时，可手动重试」
- WHEN 调 `update(id, patch)`
  - THEN 返回 `{ ok: true, subscription }`
- WHEN 调 `delete(id)`
  - THEN 返回 `{ ok: true }` 且级联：找到任何 `account.proxy.subscriptionId === id` 的账号，把它的 proxy 字段重置为 null
- WHEN 调 `refresh(id)`
  - THEN 返回 `{ ok: true, subscription }`（刷新完后）
- WHEN 调 `listNodes(id)`
  - THEN 返回 `Node[]`（password 已解密）
### Requirement: 节点测速

The system MUST 提供节点 RTT 单次测量能力，测量结果仅存内存、不落盘。

#### Scenario: measureNodes(id) 全量测
- WHEN 调 `measureNodes(id)`
  - THEN 遍历当前 nodes，对每个 node：
    - 起 mihomo 子进程（用 node 对象拉 gateway → 127.0.0.1:<port> socks5）→ 用 Node `net.connect(80, targetIp)` 时间戳测 RTT
    - 或更轻量：`tcp-ping-style`（建立到 node.server:node.port 的 TCP 连接，记录 connect 时间）
    - 并发 = 4，超过 5s 视为 timeout
  - AND 返回 `Map<nodeId, { rtt: number | null, status: "ok" | "timeout" | "refused" | "error" }>`
  - 不写 subscriptions.json（避免每次刷新都覆盖延迟历史）

#### Scenario: measureNode(id, nodeId) 单点测
- WHEN 调单点 measure
  - THEN 只测一个节点，返回 `{ rtt, status }` 对象
  - 用于 UI 节点列表每行的「测速」小按钮

#### Scenario: 测速结果失效条件
- WHEN 用户手动「立即刷新」订阅
  - THEN subscriptions.refresh(id) 完成后清空内存中此订阅的测速结果（因为节点列表可能已变）
  - AND 用户可再触发 measureNodes(id) 重新测

### Requirement: IPC 接口契约（增量）

The system MUST 暴露测速相关 IPC。

#### Scenario: subscriptions.measureNodes / subscriptions.measureNode
- WHEN 调 `api.subscriptions.measureNodes(id)`
  - THEN 返回 `Map<nodeId, { rtt, status }>`（仅本次有效，不持久化）
- WHEN 调 `api.subscriptions.measureNode(id, nodeId)`
  - THEN 返回 `{ rtt, status }` 或 `{ error: "node_not_found" }`
- 并发限：同一时刻同一订阅最多 4 个并行测量（避免主进程 IO 拥塞）

## MODIFIED Requirements

### Requirement: 节点列表查询（修订）

The system MUST 在 listNodes 返回里携带「该节点的最近一次测速结果」（纯内存，不写盘）。

#### Scenario: listNodes 含 latency
- WHEN 调 `listNodes(id)`
  - THEN 返回 `Node[]`，每项 `node` 多一个字段：
    - `latency: { rtt: number | null, status: string, measuredAt: number } | null`
  - 若此订阅从未测速过，所有 node.latency = null，UI 显示「—」
  - 若 node 因订阅刷新被替换（id 变了），旧 latency 不再显示
