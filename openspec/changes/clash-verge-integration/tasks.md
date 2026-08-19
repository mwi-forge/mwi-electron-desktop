# Tasks: clash-verge-integration

## Status legend
- [ ] = pending
- [x] = completed

## Phase 1 — 依赖与可行性 POC

- [x] POC 验证 mihomo 二进制可 spawn + 端口可配 + socks5 真请求（已完成 2026-08-19）
  - 结论：npm 上无 `mihomo` 包（404）；`@niubir/node-mihomo` 混淆代码不可用
  - 改用：捆绑 MetaCubeX/mihomo 官方二进制（本机 Clash Verge 自带 verge-mihomo v1.19.25 40MB arm64）
  - 实测：spawn 后 1.2s 端口 OPEN，`curl --socks5 127.0.0.1:17999 https://www.gstatic.com/generate_204` → HTTP 204 / 0.12s
  - 最小可用 config：mixed-port + mode: global + proxies: []（注意 mihomo 保留 DIRECT 名，不能用自定义 DIRECT proxy）
- [x] 写 `lib/__tests__/clash-gateway.integration.test.js` 验证 spawn + 退出 + 错误捕获（6/6 PASS）
- [x] 验证 mihomo 在 Electron 主进程 require 链能正常加载（MAIN_REQUIRE_CHAIN_OK）

## Phase 2 — 核心数据层与解析

### 2.1 Clash YAML / base64 订阅解析
- [x] 新建 `lib/clash.js`
  - `parseClashYaml(yamlText) -> Node[]`：用 `yaml` npm 包解析 Clash 配置，取 `proxies` 数组
  - `parseBase64Subscriptions(b64Text) -> Node[]`：按行解析 base64（ss://、trojan://、vmess://）
  - `fetchAndParse(url, userAgent) -> Promise<Node[]>`：HTTP GET + 自动嗅探格式
  - 统一节点 schema：{ id, name, type, server, port, password?, uuid?, cipher?, ... }
- [x] 写 `lib/__tests__/clash-gateway.integration.test.js`（含 YAML + base64 + trojan + vmess 解析用例）
  - 用 fixture 覆盖 3 种典型机场 YAML（含 ss / trojan / vmess / vless）
  - 用 fixture 覆盖 base64 行式（涵盖 ss + trojan 至少各 1 例）
  - fixture 文件存 `lib/__tests__/fixtures/clash-*.yaml` 与 `subscriptions-*.txt`

### 2.2 订阅持久化与刷新
- [x] 新建 `lib/subscriptions.js`
  - 数据：`subscriptions.json` 与 `accounts.json` 并列，electron-store 实例
  - 函数：`list() / get(id) / add({name, url, userAgent?}) / update(id, patch) / delete(id) / refresh(id) / autoRefreshTick()`
  - `add` 自动生成 id（`sub-` + 8 字符 base36）
  - `refresh` 拉取 + 解析 + 写回 + 记录 `lastFetchedAt`
  - `autoRefreshTick` 由主进程 setInterval(1h) 触发，过期订阅按 `lastFetchedAt + 24h` 触发 refresh
  - 多订阅刷新错峰：每个订阅 refresh 前 sleep 1-3s 随机
- [ ] 写 `lib/__tests__/subscriptions.test.js`
  - 用内存版 store（不写真文件）覆盖 CRUD + refresh
  - 覆盖自动刷新触发条件（不依赖时间，用 stub）

### 2.3 节点敏感字段加密
- [x] 在 subscriptions.json 写入前过 `lib/safe-storage.js` 加密 node.password / uuid（encryptNodeSecrets）
- [ ] 写 `lib/__tests__/safe-storage-nodes.test.js` 验证加密往返

## Phase 3 — gateway 与 proxy 衔接

### 3.1 本地 socks5 server (Node 内置)
- [x] 新建 `lib/socks-gateway.js`
  - `SocksGateway { id, port, node, mihomoProcess }`
  - `allocate(node) -> Promise<{ id, host: "127.0.0.1", port: number }>`
  - `release(id) -> Promise<void>`
  - 内部：`net.createServer()` 起 socks5 listener；spawn mihomo 子进程绑定 127.0.0.1:<port> socks-only
  - 端口分配：维护 7890-7999 范围 Set + LRU；allocate 时取最小空闲端口，release 时归还
  - 进程级：app.on('before-quit') 全部 SIGTERM
  - 错误：spawn 失败 / 端口占用 / 启动超时 5s 全部抛清晰错误

### 3.2 lib/proxy.js 扩展
- [x] 新增 `bindSessionProxy(session, account, opts) -> Promise<{ ok, mode }>`
  - 读 account.proxy，根据 source 分发
  - source=null → setProxy({mode:"direct"})
  - source="manual" → 走现有 buildProxyRules（旧链路不变）
  - source="subscription" → socksGateway.allocate(node) → setProxy({proxyRules:"socks5://127.0.0.1:<port>"})
- [x] 既有 `setSessionProxy` / `clearSessionProxy` 保留签名不变
- [x] 写 `lib/__tests__/clash-gateway.integration.test.js`（覆盖 allocate/release/refCount/e2e）
  - 三种 source 各覆盖 1 例
  - 节点失效（subscription 节点被删）走降级：direct + 日志警告

### 3.3 lib/accounts.js schema 扩展
- [ ] 注释说明 `account.proxy` 三种形态（附 examples）
- [x] `account.proxy` 写入前校验 schema（processProxyInput 三态）
- [ ] 启动时调用 `bindSessionProxy` 替换原有 `setSessionProxy` 调用点

## Phase 4 — IPC + UI

### 4.1 主进程 IPC
- [x] `lib/ipc.js` 新增 subscriptions.* + gateway.* handler（12 个）
  - `subscriptions:list` → list()
  - `subscriptions:add` → add(...)
  - `subscriptions:update` → update(id, patch)
  - `subscriptions:delete` → delete(id)
  - `subscriptions:refresh` → refresh(id)
  - `subscriptions:listNodes` → get(id).nodes

### 4.2 preload
- [x] `preload.js` 暴露 `api.subscriptions.{list,get,add,update,delete,refresh,listNodes,measureNodes,measureNode}` + `api.gateway`

### 4.3 UI: 订阅管理 tab
- [x] 新建 `src/js/subscription-tab.js`：tab 渲染 + 表单 + 节点列表 + 测速
- [x] 新建 `src/css/subscription-tab.css`：复用 tokens/panel 风格
- [x] `src/index.html` 加 link + script + toolbar 按钮 + mount 点
- [x] `tabbar.js` 扩展支持 proxy-subscriptions 静态 tab（openSubscriptionsTab / focusSubscriptionsTab）
- [x] 节点列表渲染：每行 name + type + server:port + 延迟（含真实测速染色）
- [x] 立即刷新按钮：触发 `subscriptions.refresh(id)` → 重新渲染节点列表

### 4.4 UI: 账号表单 proxyType 扩展
- [x] `src/js/account-form.js` proxy fieldset 扩展（sidebar.js 绑定订阅按钮）
- [ ] 当选择 subscription：显示订阅下拉（list） → 节点下拉（listNodes）
- [ ] submit 写入 `proxy: {source:"subscription", subscriptionId, nodeId}`
- [ ] 编辑模式：原数据是 subscription 时预填两项下拉（custom-select.replace）


## Phase 4.5 — 测速 + 节点共享

### 4.5.1 节点测速（measureNodes）
- [x] 节点测速已实现（subscriptions.js 内 measureNode/measureAllNodes/measureSingleNode，TCP RTT 5s 超时；真实订阅 78 节点实测全通）
- [x] latencyCache 内存 Map（subscriptions.js）
- [x] add 触发自动测速（并发 4）
- [x] `listNodes(id)` 返回携带 `latency` 字段
- [x] UI 节点列表显示 latency，按 status 染色（--ok/--mid/--slow/--timeout）
- [x] UI 单节点「测速」按钮调 subscriptions.measureNode(id, nodeId)
- [x] UI 顶部「全部测速」按钮调 subscriptions.measureNodes(id)
- [ ] 写 `lib/__tests__/clash-measure.test.js`：mock node.server:port，用 fake socket 测时间戳路径

### 4.5.2 socks-gateway 节点共享
- [x] `lib/socks-gateway.js` pool Map<id,GatewayRef> + keyIndex，key = nodeId[:exclusive]
- [x] allocate(node, opts) 实现 refCount 共享 + exclusive 后缀
- [x] release(id) 实现：refCount -1，归 0 时真 release（SIGTERM + 等退出）
- [x] `lib/proxy.js` stopView 路径 releaseSessionGateway（refCount -1）
- [x] app.before-quit 遍历所有 gateway releaseAll
- [x] refCount 共享/释放已由 clash-gateway.integration.test.js 覆盖（stub 模式 2 例）
- [ ] UI 账号表单「代理节点」区加 `独占模式` 复选框（默认 unchecked → shared；checked → exclusive:true）

## Phase 5 — 静态校验 + 真实启动 + archive

### 5.1 静态校验
- [ ] `node --check lib/clash.js lib/subscriptions.js lib/socks-gateway.js lib/proxy.js lib/accounts.js lib/ipc.js lib/safe-storage.js`
- [ ] `node --check src/js/subscription-tab.js src/js/account-form.js src/js/tabbar.js src/js/sidebar.js preload.js`
- [ ] npm test 跑通 `lib/__tests__/*.test.js`（clash / subscriptions / socks-gateway / proxy / safe-storage-nodes / mihomo-poc）
- [ ] grep 验证：subscription tab HTML/CSS 引用都在 index.html
- [ ] grep 验证：preload api.subscriptions.* 与 lib/ipc.js subscriptions:* 命名一致

### 5.2 真实启动验证（反完成感幻觉 SOP 强制）
- [x] 真实订阅验证（2026-08-19 用 jetcamoe 机场）：78 节点解析 + 全量 TCP 测速 + vless+reality / hysteria2+obfs 两种协议真实连通（出口香港 165.101.123.100）
  - 修复 3 个真实缺陷：yaml 库缺失致 fallback 字符串化（npm i yaml）、normalizeNode 漏 reality/obfs 字段、buildMihomoConfig 布尔归一
- [ ] `npm start` 起 Electron 主窗口
- [ ] 创建测试账号，选 "从订阅选节点"，粘一个公开订阅 URL（若可达）
- [ ] 验证：该账号 webContents 启动后能加载外部页面，且中部状态栏显示代理模式 = subscription
- [ ] `pkill -f mwi-electron` 关闭主进程，验证 mihomo 子进程全部退出（无 zombie）
- [ ] 关闭再 `npm start`，验证历史订阅加载 + 节点列表回显

### 5.3 OpenSpec archive
- [ ] `openspec validate clash-verge-integration` (PASS)
- [ ] 同步 delta specs 到主 specs：
  - `openspec/specs/subscriptions/spec.md`
  - `openspec/specs/socks-gateway/spec.md`
- [ ] `openspec archive clash-verge-integration --yes`