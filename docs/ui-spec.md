# MWI Electron Desktop - UI Spec

本文档定义 mwi-electron-desktop 主控制台的 UI 设计规范。

适用范围：渲染进程主控制台窗口（src/index.html + src/css/* + src/js/*）。
与本项目其他文档的关系：
- docs/项目背景及方案（交接）20260818.md - 总体架构 + 账号隔离 + 代理 + 指纹设计
- 本文档 - 主控制台的 UI 布局 + 配色 + 组件 + 交互

## 一、UI 决策与演进

### 1.1 架构决策

主控制台采用「主窗口 + WebContentsView 嵌入 + tab 切换」单窗口方案（路径 B），推翻交接文档 3.1 节「多 BrowserWindow 多窗口管理」方案。

理由：
- 多账号浏览器的核心痛点是「开 4~6 个独立窗口分散切换」
- 单窗口方案在一个窗口内通过 tab 切换所有账号，解决此痛点
- WebContentsView API 在 Electron 30+ 已稳定（替代已废弃的 BrowserView）
- 共享主进程的 GPU / 网络服务，资源占用更优
- 每个 view 仍有独立 session partition（cookie / storage / indexedDB 完全隔离）

### 1.2 布局演进

版本演进：v1 (IDE 双栏) -> v2 (中部 = 详情编辑) -> v3 (中部 = tab + WebContentsView)。

v1：双栏 + 底部状态栏（顶 toolbar + 左账号列表 + 右详情编辑 + 底部状态条）。
v2：参考 DSH Web GUI 黑色模式，改为左分组树 + 中详情编辑 + 右侧缩略图网格（可选）+ 底部状态条。
v3：用户调整中部为 tab 栏（每个账号一 tab）+ WebContentsView 嵌入，详情编辑挪到右侧。

### 1.3 配色参考

直接参考 DSH Web GUI（http://127.0.0.1:3670）的深色模式配色 token。
主蓝沿用 DSH 的 #7B9EFF（用户拍板）。
无浅色模式（先不做）。

## 二、配色 Token

所有色值定义在 src/css/tokens.css，全局 CSS 变量引用：

```css
:root {
  --mwi-bg-base:      #0F0F0F;  /* 主控制台底色 */
  --mwi-bg-sidebar:   #0A0A0A;  /* 左侧账号分组树 */
  --mwi-bg-panel:     #1A1A1A;  /* tab / 详情 / 日志卡 */
  --mwi-bg-elevated:  #252525;  /* hover / 选中 / 浮层 */

  --mwi-text-primary:   #F0F0F0;
  --mwi-text-secondary: #A0A0A0;
  --mwi-text-muted:     #666666;

  --mwi-accent:           #7B9EFF;  /* 主蓝 */
  --mwi-status-running:   #4ADE80;
  --mwi-status-stopped:   #6B7280;
  --mwi-status-error:     #F87171;

  --mwi-divider:        #1F1F1F;
  --mwi-border-subtle:  #2A2A2A;

  --mwi-radius:         6px;
  --mwi-toolbar-h:      48px;
  --mwi-tabbar-h:       36px;
  --mwi-statusbar-h:    32px;
  --mwi-sidebar-w:      240px;
  --mwi-right-w:        320px;
}
```

## 三、布局规范

### 3.1 5 栏 Grid

```css
body {
  display: grid;
  grid-template-rows: var(--mwi-toolbar-h) 1fr var(--mwi-statusbar-h);
  grid-template-columns: var(--mwi-sidebar-w) 1fr var(--mwi-right-w);
}
```

### 3.2 尺寸常量

| 栏 | 宽 / 高 | 说明 |
|---- | | ------ |
| 顶 toolbar | 48px 高 | Logo + 应用名 + 全局操作 |
| 左侧 sidebar | 240px 宽 | 账号分组树 |
| 中部 center | 自适应 | 顶部 36px tab 栏 + 主体 WebContentsView 嵌入区 |
| 右侧 panel | 320px 宽 | 详情 + 操作按钮 + 最近日志 |
| 底部 statusbar | 32px 高 | views 数 / 内存 / CPU / 运行时长 |

### 3.3 中部中心视图定位

WebContentsView 的 bounds 计算（lib/views.js computeViewBounds）：

```js
{
  x: 240,
  y: 48 + 36,
  width: window.width - 240 - 320,
  height: window.height - 48 - 36 - 32
}
```

主窗口 resize 时自动同步所有 view 的 bounds（lib/views.js setMainWindow 内监听）。

## 四、组件规范

### 4.1 顶 toolbar

- Logo 区域：白色底 + 黑字 MWI chip + 应用名（次要色）
- 操作按钮：+ 添加账号 / 设置 / 刷新（ghost 风格，hover 显背景）
- 下边框：1px divider

### 4.2 左侧 sidebar（分组树）

- 顶部：+ 新账号（accent 蓝填充按钮，width 100%）
- 分组头：折叠 caret（v / >）+ 分组名 + 账号数（次要色）
- 账号行：状态点（o 已停 / * 运行中 / ! 错误）+ 账号名 + hover 显示 [E] 编辑 / [X] 删除
- 选中态：背景 elevated + 左边框 2px accent 蓝

### 4.3 中部 tab 栏

- 高度 36px
- 每个 tab：状态点 + 账号名（超出省略号）+ [X] 关闭
- 选中 tab：背景 elevated + accent 蓝边框 + 下边线覆盖（视觉上盖住 tabbar 下边框）
- 未启动账号不占 tab（仅在左侧列表显示，启动后才出现）

### 4.4 右侧 panel

- 上半：详情字段（名称 / URL / 分组 / 分辨率 / 指纹预设 / 状态）
  - label：11px 大写 + 0.5px 字距 + muted 色
  - value：13px 主色，URL 用 mono 字体
- 操作按钮组：启动 / 停止 / 刷新 / 编辑 / 复制配置 / 删除
  - 启动：accent 蓝填充（已停止时）
  - 停止：默认 ghost
  - 删除：danger 红色边框（hover 反白）
  - 未运行时按钮 disabled
- 下半：最近日志列表（最多 50 条，超出滚动到顶部）
  - 每行：时间 + 等级（INFO/WARN/ERROR）+ 消息（mono 字体）
  - INFO 次要色 / WARN 黄色 / ERROR 红色
  - 自动滚动到底部

### 4.5 底部 statusbar

- 11px 次要色，分隔符为 muted
- 4 项：views N/6 + 内存 N MB + CPU N% + 运行时长 HH:MM:SS
- 颜色告警：
  - 内存 > 800 MB: warn（黄色）
  - 内存 > 1500 MB: error（红色加粗）
  - CPU > 50%: warn
  - CPU > 80%: error
  - views 满 6/6: warn

### 4.6 Modal（编辑 / 添加账号）

- 半透明 backdrop 覆盖全屏
- 居中卡片：480px 宽 + 80vh 最大高度 + 圆角 6px + 阴影
- 字段：名称 / URL / 分组 / 宽度 / 高度 / 指纹预设 + 代理（fieldset 包裹）
- 代理字段：类型下拉（不使用/SOCKS5/HTTP）+ 主机 + 端口 + 用户名 + 密码（明文输入自动加密）
- 按钮：取消 / 添加（accent 蓝填充）
- 表单验证：name + url 必填

## 五、状态机

账号状态（lib/views.js pool entry.state）：

- stopped：未启动（默认）
- starting：startView 已调用，proxy/UA/TM/fp 串接中，loadURL 未完成
- running：loadURL 完成，view 在主窗口中部显示
- error：render-process-gone 或 did-fail-load 触发，view 仍存在但不渲染

状态转移：
- stopped -> starting（startView 调用）
- starting -> running（loadURL resolve）
- starting -> error（loadURL reject 或 webContents 创建失败）
- running -> stopped（stopView 调用）
- running -> error（render-process-gone 触发）
- error -> stopped（stopView 调用）

## 六、交互流程

### 6.1 添加账号

1. 点击 sidebar 顶部 + 新账号 或 toolbar + 添加账号
2. 弹出 modal 表单
3. 填写名称 + URL（必填）+ 其他字段
4. 提交 -> window.api.accounts.create(input)
5. 主进程 lib/accounts.js 处理：
   - processProxyInput 加密代理密码（明文 -> safeStorage passwordEncrypted）
   - electron-store 持久化到 userData/accounts.json
6. 返回新账号对象 -> sidebar.js refresh() 重新拉取列表 -> 渲染新账号行

### 6.2 启动账号

1. 选中左侧账号 -> panel.js 渲染详情 + 操作按钮
2. 点击 [启动] 按钮
3. window.api.views.start(acc.id)
4. 主进程 lib/views.js startView 流程：
   - 检查池未满（< 6）
   - 创建 WebContentsView（partition = persist:account_<id>）
   - 设置 bounds = 中部区域
   - 注册错误监听（render-process-gone / did-fail-load）
   - 加入 pool（state: starting）
   - proxy.setSessionProxy（socks5/http/direct）
   - setUserAgent（account.userAgent 或 fp.randomUA()）
   - tm.loadTampermonkey（失败降级不抛错）
   - 注册 did-start-loading 注入 fp.injectScript
   - loadURL -> 等 resolve
   - focusView（addChildView + 移除旧的 focused view）
   - state -> running -> 触发 account:state-changed 事件
5. 渲染进程 window.api.views.onStateChanged 接收事件 -> tabbar.js 更新 tab 列表 + panel.js 更新状态文字
6. tab 出现在中部 tab 栏（状态点 *）+ 中部主区显示该账号的游戏视图

### 6.3 切换 tab

1. 点击中部 tab 栏某个 tab
2. window.api.views.focus(acc.id)
3. 主进程 focusView：
   - 移除当前 focused view（mainWindow.contentView.removeChildView）
   - 添加新 view（addChildView + 重设 bounds）
   - focusedId 更新
   - 触发 view:focus-changed 事件
4. 渲染进程 sidebar.js 更新 focusedAccountId + tabbar.js 重渲染（选中下划线）+ panel.js 更新详情

### 6.4 关闭 tab

1. 点击 tab 的 [X] 按钮
2. window.api.views.stop(acc.id)
3. 主进程 stopView：
   - 从主窗口 contentView 移除 view
   - view.webContents.destroy()（释放渲染进程 + 内存）
   - 从 pool 删除
   - state -> stopped -> 触发事件
   - 如果停的是当前 focused，自动聚焦下一个或 focusedId = null
4. 渲染进程 tabbar.js 从 runningIds 移除该 id + panel.js 状态文字回到 已停止

### 6.5 删除账号

1. 点击账号行 hover 显示的 [X] 按钮（或 panel.js 的 删除 按钮）
2. confirm 确认（防止误删）
3. 如果账号正在运行，先 window.api.views.stop(acc.id) 释放 view
4. window.api.accounts.remove(acc.id) -> 主进程从 accounts.json 删除
5. 刷新 sidebar 列表 + 如果该账号当前 focused，清空 focusedAccountId

## 七、性能预算

- 单 view 内存：120~250 MB（含油猴扩展时取上限）
- 最大并发 views：6（超出返回 error: max_views_reached）
- 资源开销：与原生浏览器相比每个实例仍有额外开销，但优于 Docker 容器方案
- 启动时间：主控制台 < 1 秒 / 单 view 加载游戏 URL < 3 秒（取决于网络）

## 八、可访问性

- 键盘导航：tab 切换可访问所有按钮 + 账号行
- 焦点态：input / button focus 时显示 accent 蓝边框
- 状态机文字：详情面板明确显示 运行中 / 已停止 / 错误

## 九、后续迭代项（不在 MVP 范围）

- 脚本市场（一键安装常用油猴脚本）
- 代理池自动切换
- 窗口休眠 / 唤醒（降低不活跃账号的 CPU）
- Canvas / WebGL 完整 noise（puppeteer-extra-plugin-stealth 风格）
- 浅色模式
- 截图缩略图（capturePage 5~10 秒刷新）
- 自动启动账号的外部 API
- Linux 打包 / Windows 代码签名证书

## 十、版本历史

- v0.1.0 (2026-08-18)：Phase 0~6 MVP 完成（骨架 + 账号 + WebContentsView + 日志 + metrics + 代理/指纹/Tampermonkey + electron-builder 打包签名）

