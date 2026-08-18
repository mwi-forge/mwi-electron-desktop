# MWI Electron Desktop

基于 Electron 的桌面端多账号浏览器：在同一台电脑上同时登录多个网页游戏账号，账号环境完全隔离，支持油猴脚本扩展，资源占用尽可能低，并具备一定的反关联能力。

## 功能特性

- 多账号同时在线：每个账号对应一个独立窗口，各自使用独立的 session 分区，Cookies / Local Storage / IndexedDB / 缓存完全隔离
- 油猴脚本支持：基于 Chromium 直接加载 Tampermonkey 扩展，每个分区单独加载，脚本数据互不影响
- 资源优化：默认手机分辨率窗口（360x640）、禁用 GPU 加速、限制渲染进程数、按需限制 V8 堆
- 反关联能力：支持为每个账号设置独立代理（SOCKS5 / HTTP），提供浏览器指纹扰动方案
- 主控制台管理：账号列表展示、添加/删除/编辑、启动/停止、批量操作

## 技术选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| Electron | 基于 Chromium 可直接加载 Chrome 扩展（油猴）；session 分区机制天然支持多账号隔离；跨平台一致性好 | 相比原生浏览器有额外内存开销 | 采用 |
| Tauri | 资源占用低 | WebView 对 Chrome 扩展支持差，无法直接运行油猴 | 放弃 |
| 原生 WebView2 | 系统集成度高 | 仅限 Windows，跨平台能力弱 | 放弃 |
| 便携版浏览器 + 启动器 | 无需开发 | 用户体验和封装程度低 | 放弃 |

## 整体架构

- 单实例应用，多窗口管理：启动后展示主控制台窗口，每个账号对应一个独立的 BrowserWindow
- Session 分区：使用 `session.fromPartition('persist:account_<ID>')` 为每个账号创建持久化分区
- 主进程与渲染进程隔离：禁用 nodeIntegration，启用 contextIsolation，主窗口与账号窗口间通信走 IPC 并严格校验消息来源

### 账号隔离

- 存储隔离：每个账号独立 `persist:account_<ID>` 分区
- IP 隔离：每个账号窗口的 session 设置独立代理（SOCKS5 / HTTP），账号配置中存储代理信息
- 指纹伪装：通过注入 JS 覆盖 User-Agent / screen / Canvas / WebGL / 时区 / 硬件并发数 / 设备内存 / WebRTC 等指纹项
- 油猴插件：每个分区加载独立的 Tampermonkey 扩展实例

## 快速开始

环境要求：Node.js 18+（建议使用 LTS），npm 或 yarn。

```bash
# 安装依赖
npm install

# 开发模式启动
npm start

# 打包（electron-builder，输出到 dist/）
npm run dist
```

## 目录结构（规划）

```
mwi-electron-desktop/
├── main.js                  # 主进程：窗口管理、session 分区加载
├── fingerprint.js           # 指纹注入模块
├── proxy.js                 # 代理设置模块
├── resources/
│   └── tampermonkey/        # Tampermonkey 扩展目录（含 manifest.json）
├── userData/
│   └── accounts.json        # 账号配置存储（ID、名称、URL、代理、UA 等）
├── docs/                    # 项目文档
└── package.json
```

## 打包与分发

- 使用 electron-builder，支持 Windows NSIS、macOS DMG、Linux AppImage
- Tampermonkey 扩展目录通过 `extraResources` 打包进应用资源
- 代理配置由用户填写，不硬编码
- 注意签名问题：未签名应用在 macOS 上可能被 Gatekeeper 阻止，Windows 上可能被 SmartScreen 警告

## 安全说明

- 主窗口与账号窗口之间通信使用 IPC，严格校验消息来源
- 禁用 nodeIntegration，启用 contextIsolation，防止游戏页面访问 Node.js 环境
- 代理密码等敏感信息使用 Electron `safeStorage` API 加密存储

## 已知限制

1. 浏览器指纹伪装有限：Electron 无法像专业指纹浏览器一样彻底改变底层指纹（如 Canvas 硬件级差异）
2. 部分油猴脚本可能依赖 Chrome 特有 API，在 Electron 中可能运行异常，需要逐个测试
3. 系统资源占用：与原生浏览器相比每个实例仍有额外开销
4. 即使做了 IP 隔离和指纹随机化，仍可能被高级风控系统识别，建议配合住宅代理使用
5. macOS 上部分命令行开关可能无效，需要针对平台适配

## 后续迭代方向

- 集成更专业的指纹伪装库
- 支持代理池自动切换
- 增加脚本市场功能（一键安装常用油猴脚本）
- 优化内存管理，实现窗口休眠/唤醒
- 提供 API 供外部调用（如自动化启动账号）

## 参考文档

- [项目背景及方案（交接）](docs/项目背景及方案（交接）#20260818.md)
