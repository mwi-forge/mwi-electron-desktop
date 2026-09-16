# MWI Electron Desktop

基于 Electron 的桌面端多账号浏览器：在同一台电脑上同时登录多个网页游戏账号，账号环境完全隔离，支持油猴脚本扩展，资源占用尽可能低，并具备一定的反关联能力。

## 功能特性

- 多账号同时在线：每个账号对应一个独立窗口，各自使用独立的 session 分区，Cookies / Local Storage / IndexedDB / 缓存完全隔离
- 油猴脚本支持：基于 Chromium 直接加载 Tampermonkey 扩展，每个分区单独加载，脚本数据互不影响
- 资源优化：默认手机分辨率窗口（360x640）、默认启用 GPU（反检测需要），可用 MWI_HW_ACCEL=0 环境变量回退禁用（省电模式）、限制渲染进程数、按需限制 V8 堆
- 反关联能力：支持为每个账号设置独立代理（SOCKS5 / HTTP）；每账号由 accountId 派生稳定 seed 生成自洽指纹画像，注入覆盖 User-Agent / navigator.userAgentData（含高熵值）/ languages / screen / 时区 / 硬件并发数 / 设备内存 / WebGL renderer（伪 GPU）/ Canvas 2D 像素扰动，WebRTC 策略实际生效
- 主控制台管理：账号列表展示、添加/删除/编辑、启动/停止、批量操作

## 技术选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| Electron | 基于 Chromium 可直接加载 Chrome 扩展（油猴）；session 分区机制天然支持多账号隔离；跨平台一致性好 | 相比原生浏览器有额外内存开销 | 采用 |
| Tauri | 资源占用低 | WebView 对 Chrome 扩展支持差，无法直接运行油猴 | 放弃 |
| 原生 WebView2 | 系统集成度高 | 仅限 Windows，跨平台能力弱 | 放弃 |
| 便携版浏览器 + 启动器 | 无需开发 | 用户体验和封装程度低 | 放弃 |

## 整体架构

- 单实例应用：启动后展示主控制台窗口（**单窗口 + WebContentsView 嵌入**）
- 多账号视图：每个账号对应一个 WebContentsView，嵌入主窗口中部，通过 tab 栏切换（不是独立 BrowserWindow）
- Session 分区：每个 view 使用独立 `session.fromPartition('persist:account_<ID>')`，Cookies / Local Storage / IndexedDB / 缓存完全隔离
- 主进程与渲染进程隔离：禁用 nodeIntegration，启用 contextIsolation，主窗口与账号视图间通信走 IPC 并严格校验消息来源

### 账号隔离

- 存储隔离：每个账号独立 `persist:account_<ID>` 分区
- IP 隔离：每个账号窗口的 session 设置独立代理（SOCKS5 / HTTP），账号配置中存储代理信息
- 指纹伪装：每账号由 accountId 派生稳定 seed 生成自洽指纹画像，注入覆盖 User-Agent / navigator.userAgentData（含高熵值）/ languages / screen / 时区 / 硬件并发数 / 设备内存 / WebGL renderer（伪 GPU）/ Canvas 2D 像素扰动
- 油猴插件：每个分区加载独立的 Tampermonkey 扩展实例

## 快速开始

环境要求：Node.js 18+（建议使用 LTS），npm 或 yarn。

```bash
# 安装依赖
npm install

# 开发模式启动（MWI_DEV=1 打开 DevTools + 捕获渲染进程 console）
npm start
npm run dev

# 打包（electron-builder，输出到 dist/）
npm run dist              # 当前平台默认 target
npm run dist:mac          # macOS dmg + zip
npm run dist:win          # Windows nsis + portable
npm run dist:linux        # Linux AppImage + deb
npm run dist:dir          # 仅打包成目录（快速验证，不生成安装器）
```

## 目录结构

```
mwi-electron-desktop/
├── main.js                       # 主进程入口
├── preload.js                    # 预加载（contextBridge 暴露 window.api）
├── lib/                          # 主进程模块
│   ├── accounts.js               # 账号数据层（CRUD + 持久化 + 代理密码自动加密）
│   ├── safe-storage.js           # Electron safeStorage 包装
│   ├── proxy.js                  # per-session 代理设置
│   ├── fingerprint.js            # 指纹画像 + 注入脚本（3 预设 + 每账号 seed）
│   ├── tampermonkey.js           # per-session 油猴扩展加载（含失败降级）
│   ├── views.js                  # WebContentsView 池管理（6 上限）
│   ├── logs.js                   # 日志环形缓冲
│   ├── metrics.js                # app.getAppMetrics 聚合 + 推流
│   └── ipc.js                    # IPC handlers 注册
├── src/                          # 渲染进程
│   ├── index.html                # 主控制台 5 栏 DOM
│   ├── css/                      # DSH 深色配色 token + 5 栏布局
│   └── js/                       # store + sidebar + tabbar + panel + statusbar + app
├── resources/
│   └── tampermonkey/             # Tampermonkey 扩展解压目录（含 manifest.json + README 安装说明）
├── docs/
│   └── 项目背景及方案（交接）20260818.md
└── package.json
```

## 打包与分发

- 使用 electron-builder（已配 `build` 字段），输出到 `dist/`
- appId: `com.mwi.desktop`，productName: `MWI Multi-Account Manager`
- macOS target: dmg + zip（ad-hoc 本地签名；`mac.identity=null`）
- Windows target: nsis + portable
- Linux target: AppImage + deb
- Tampermonkey 扩展目录通过 `extraResources` 打包进应用资源
- 代理配置由用户填写，不硬编码
- 国内网络用户：已配 `electronDownload.mirror` 指向 npmmirror，npm run dist 直接走镜像，无需额外设环境变量

## 安全说明

- 主窗口与账号视图之间通信使用 IPC，严格校验消息来源
- 禁用 nodeIntegration，启用 contextIsolation，防止游戏页面访问 Node.js 环境
- 代理密码等敏感信息使用 Electron `safeStorage` API 加密存储（明文不入库，仅在主进程短暂存在）
- WebContentsView 使用独立 session partition，账号间 cookies/storage/IndexedDB 完全隔离

## 已知限制

1. 残余风险：已实现 Canvas/WebGL 像素扰动，但 Electron 底层字体枚举 / GPU 驱动细节 / TCP 时间戳等无法彻底抹平；同出口 IP 多号仍建议每号配独立住宅代理
2. 部分油猴脚本可能依赖 Chrome 特有 API，在 Electron 中可能运行异常，需要逐个测试
3. 系统资源占用：与原生浏览器相比每个实例仍有额外开销
4. 即使做了 IP 隔离和指纹随机化，仍可能被高级风控系统识别，建议配合住宅代理使用
5. macOS 上部分命令行开关可能无效，需要针对平台适配
6. macOS Gatekeeper：未签名应用首次启动需「右键 → 打开」绕过；ad-hoc 签名仍会触发警告
7. Windows SmartScreen：未签名应用首次启动会触发蓝色警告屏幕，需点击「更多信息 → 仍要运行」

## 后续迭代方向

- 集成更专业的指纹伪装库
- 支持代理池自动切换
- 增加脚本市场功能（一键安装常用油猴脚本）
- 优化内存管理，实现窗口休眠/唤醒
- 提供 API 供外部调用（如自动化启动账号）


## 快速验收 5 步

在终端跑 `npm start` 启动主控制台，按以下 5 步确认产品可用：

1. **窗口出现**：macOS Dock 上有蓝色 Electron 图标（MWI Multi-Account Manager），点击切到该窗口
2. **5 栏布局**：顶 toolbar + 左分组树 + 中 tab 区 + 右详情 + 底 statusbar 全部显示，深色主题
3. **添加测试账号**：点击左侧 + 新账号，URL 填 `about:blank`（避免外网依赖），提交
4. **启动 view**：选中测试账号 → 点右侧 [启动] → 中部主区应该立刻显示一个空白 Chromium 页面（说明 addChildView 嵌入工作），状态字段从"已停止"变"运行中"，日志出现 starting view + proxy set + tampermonkey skipped + view started
5. **持久化**：关闭主窗口 → 再 npm start → 测试账号还在左侧列表（accounts.json 持久化）

如果 4 中部 view 真的显示 → MVP 可用；中部仍 placeholder 或报错 → 检查 logs/ 目录或贴错误日志。

## 参考文档

- [项目背景及方案（交接）](docs/项目背景及方案（交接）20260818.md) - 总体架构 + 账号隔离 + 代理 + 指纹设计
- [UI Spec](docs/ui-spec.md) - 主控制台 UI 设计规范（布局 + 配色 token + 组件 + 交互流程 + 状态机）
