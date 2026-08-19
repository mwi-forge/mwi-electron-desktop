# MWI Multi-Account Manager 界面重新设计需求（OpenDesign 输入）

## 一、产品背景
MWI（Milky Way Idle 银河奶牛放置）多账号管理器：Electron 桌面应用，在单窗口内同时管理多个网页游戏账号（每个账号一个独立 WebContentsView 会话，浏览器环境完全隔离），支持油猴脚本扩展、代理、浏览器指纹伪装。目标用户是 MWI 游戏多开玩家，核心价值是「开一堆账号挂机，一眼看清每个账号状态」。

## 二、技术硬约束（必须遵守，否则实现无法落地）
1. 技术栈：Electron 43 + WebContentsView，vanilla HTML/CSS/JS，无前端框架、无构建工具。所有产物必须是纯静态 HTML/CSS/JS 文件。
2. 现有前端 JS（sidebar.js / tabbar.js / panel.js / statusbar.js / store.js）通过 DOM id 和 class 驱动交互，**以下标识符必须原样保留，只允许改视觉样式，不允许改结构语义**：
   - id：toolbar、btn-add-account、btn-settings、btn-refresh、btn-quick-add、sidebar、sidebar-groups、tabbar、canvas、panel、panel-body、panel-logs、logs-list、statusbar、stat-views、stat-mem、stat-cpu、stat-uptime
   - class 语义：group / group__header / group__caret / group__name / group__count / account / account--focused / account__dot / account__name / account__actions / tab / tab--focused / tab__dot / tab__name / tab__close / panel__account / panel__row / panel__label / panel__value / panel__actions / btn / btn--accent / btn--ghost / btn--block / btn--danger / btn-icon / modal / modal-backdrop / modal__title / modal__form / modal__actions / log / log--info|warn|error / log__time / log__level / log__msg / statusbar__item / statusbar__item--warn|error / statusbar__sep / canvas__placeholder / canvas__hint / tabbar__empty / sidebar__empty / panel__empty
   - data 属性：data-action（start/stop/reload/edit/copy/remove/close）、data-account-id、data-group-id、data-id、data-toggle
3. 中部游戏视图区（canvas）由 WebContentsView 原生嵌入，Web 技术无法渲染其内容——设计时该区域必须留空（只有占位提示），不要设计假游戏画面。
4. 布局骨架：顶部工具栏 + 左侧账号分组树 + 中部（tab 栏 + 游戏视图）+ 右侧（详情 + 日志）+ 底部状态条。现有尺寸 token：toolbar 48px / tabbar 36px / statusbar 32px / sidebar 240px / 右侧面板 320px，可微调但整体结构不变。
5. 单窗口、无浅色模式：只做深色主题。

## 三、视觉现状（供参考，新设计可超越但保留风格基因）
当前为 DSH 深色风格：温暖暗色基底（#141414 / #1A1A1A / #1F1F1F / #2A2A2A 层级）、主蓝 #7B9EFF、状态色（运行绿 #4ADE80 / 停止灰 #6B7280 / 错误红 #F87171）、10-16px 圆角、毛玻璃工具栏/状态条（backdrop-filter blur 12px）、柔和阴影。

## 四、当前界面问题（重新设计要解决的痛点）
1. 视觉粗糙，未达桌面软件质感：账号列表用文本符号（o / [E] / [X]）代替图标，tab 用文本 [X] 关闭，按钮全是文字。
2. 信息层级弱：状态只有文字/符号，没有直观的视觉反馈（色点、进度、动效）；运行中 vs 停止视觉区分不够。
3. 空状态简陋：未选中账号、无日志、无账号时只有一行灰字。
4. 细节缺失：无图标、无过渡动效、分组树无拖拽/徽标、日志区无级别颜色条、状态条无图形。

## 五、设计目标
1. 高端桌面工具质感：参考 Linear / Raycast / Arc 的暗色界面语言——克制配色、清晰层级、精致图标（用内联 SVG，不引入图标库）、细腻动效。
2. 信息一眼可读：每个账号卡片的运行状态用「色点 + 状态标签」双通道表达；tab 带状态点与关闭按钮图标；日志按级别带左侧色条。
3. 完整状态覆盖：启动中（spinner/脉冲）、运行中（绿点）、错误（红点+错误信息）、停止（灰点）；空状态（无账号/未选中/无日志）有设计感的插画式占位。
4. 可实现的动效：按钮 hover/active 微动效、面板切换淡入、状态点脉冲动画（纯 CSS 可实现）。

## 六、交付物要求
1. 完整 index.html + CSS（可拆 tokens/layout/sidebar/tabbar/panel/statusbar 多个文件，与现有结构一致）+ 内联 SVG 图标。
2. 必须同时交付：设计说明（配色/字体/间距 token、组件规范）与可运行的 HTML/CSS。
3. 保持现有 id/class/data 属性约定不变（见第二节），让现有 JS 零改动直接工作。