# account-form Specification

## Purpose
账号表单（添加 / 编辑）以静态 tab 形式嵌入主窗口中部 canvas，避免被 WebContentsView 游戏画面遮挡。

## Requirements

### Requirement: tab 类型扩展
The system MUST 支持中部 tab 栏展示两种 tab 类型：
- type='game': 已启动账号，绑定 WebContentsView（既有行为）
- type='account-form': 账号表单，绑定静态 HTML（新增）

#### Scenario: 打开添加账号表单 tab
- WHEN 用户点击工具栏「添加账号」按钮
- THEN 一个 type='account-form' 的 tab 出现在中部 tab 栏
- AND 中部 canvas 切换显示表单 HTML（游戏 view 临时隐藏）

#### Scenario: 打开编辑账号表单 tab
- WHEN 用户在侧栏 [E] 或右侧详情面板点击「编辑」按钮
- THEN 一个 type='account-form' 的 tab 出现在中部 tab 栏，title 为「编辑: <name>」
- AND 表单字段预填原账号数据

### Requirement: tab 切换行为 - hideFocused / resumeFocused
The system MUST 在切换到 account-form tab 时临时卸下 focused WebContentsView，并在切回时恢复。

#### Scenario: 切到 form tab
- WHEN 用户点击 form tab
- THEN 主进程调用 views.hideFocused() 卸下当前 focused game view（不销毁）
- AND 中部 canvas 显示 .canvas__form-mount 内的表单 DOM
- AND 隐藏 .canvas__placeholder

#### Scenario: 切回 game tab
- WHEN 用户点击任一 game tab
- THEN 主进程调用 views.resumeFocused() 重新挂上之前卸下的 game view
- AND 中部 canvas 显示游戏画面（WebContentsView 重新渲染）
- AND 隐藏 .canvas__form-mount

#### Scenario: 关闭 form tab
- WHEN 用户点击 form tab 的 close 按钮
- THEN 主进程调用 views.resumeFocused()
- AND form tab 从 tabbar 移除
- AND 如果有剩余 game tab，自动切到第一个；否则 activeTabId 置空

### Requirement: 表单字段
The form MUST 提供以下字段（与原 inline DOM 版本一致）：

#### Scenario: 表单字段集合
- 名称（必填）
- URL（必填）
- 分组（select，从 groups.list()）
- 宽度 / 高度（number，默认 360/640）
- 指纹预设（select，从 fingerprint.listPresets()，原值不在预设列表时附加「自定义」option）
- User-Agent（留空自动生成）
- 代理（fieldset，可选）：类型 / 主机 / 端口 / 用户名 / 密码

### Requirement: 表单提交流程
The form submission MUST 走现有 accounts.create / update IPC，提交成功后通知 sidebar refresh + 关闭 form tab。

#### Scenario: 添加账号提交成功
- WHEN 用户填写必填字段并点击「添加」
- AND window.api.accounts.create(data) 返回成功
- THEN 调用 tabbar closeFormTab() 移除 form tab
- AND 调用 window.mwiSidebar.refresh() 刷新侧栏账号列表

#### Scenario: 编辑账号提交成功
- WHEN 用户修改字段并点击「保存」
- AND window.api.accounts.update(id, data) 返回成功
- THEN 调用 tabbar closeFormTab() 移除 form tab
- AND 调用 window.mwiSidebar.refresh() 刷新侧栏账号列表

#### Scenario: 提交失败
- WHEN 提交过程中 accounts.create / update 抛出异常
- THEN alert 显示错误
- AND 不关闭 form tab（让用户重试）
- AND 不调用 resumeFocused（保持当前 form tab 状态）

### Requirement: IPC 接口契约
The system MUST 暴露以下 preload API 给渲染进程调用：

#### Scenario: api.canvas.hideFocused / resumeFocused / isFocusedHidden
- WHEN 渲染进程调用 window.api.canvas.hideFocused()
- THEN 主进程调用 views.hideFocused()，返回 { ok, hidden }
- WHEN 调用 window.api.canvas.resumeFocused()
- THEN 主进程调用 views.resumeFocused()，返回 { ok, restored }
- WHEN 调用 window.api.canvas.isFocusedHidden()
- THEN 主进程返回 views.isFocusedHidden()，返回 { hidden: boolean }

#### Scenario: api.accountForm.open
- WHEN 渲染进程调用 window.api.accountForm.open({ isEdit, account })
- THEN 主进程 ack { ok: true }（实际表单挂载由 renderer 负责）

### Requirement: 不变更范围
The change MUST NOT modify existing IPC API surface or tabbar game tab behavior; only adds form tab extension.

#### Scenario: 既有 accounts.* IPC API
- THEN accounts.list / get / create / update / remove 调用方式不变
- AND 既有 views.* IPC API（start / stop / focus / reload / listRunning / getFocusedId / getState）不变

#### Scenario: tabbar.js 既有 game tab 行为
- THEN 已启动账号的 tab 渲染、点击切换、close 按钮、onFocusChanged / onStateChanged 订阅逻辑不变
