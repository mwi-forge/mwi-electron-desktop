# Tasks: account-form-as-static-tab

## Status legend
- [ ] = pending
- [x] = completed

## 1. 回滚子窗口方案
- [x] 删除 src/modal-account.html
- [x] 删除 src/modal-account.js
- [x] 删除 src/modal-preload.js
- [x] 删除 lib/accountModal.js
- [x] 改回 lib/ipc.js（移除 accounts:modal:* handlers + accountModal require）
- [x] 改回 preload.js（移除 api.modal）
- [x] 改回 src/js/sidebar.js openModal 到 inline DOM 版（暂态：apply 完成后改回 IPC）

## 2. 主进程扩展 WebContentsView 隐藏/恢复 API
- [x] lib/views.js 新增 hideFocused / resumeFocused / isFocusedHidden
- [x] 导出以上三个函数

## 3. 主进程 IPC 通道
- [x] lib/ipc.js 注册 canvas:focused:hide / canvas:focused:resume / canvas:focused:isHidden
- [x] lib/ipc.js 注册 account-form:open

## 4. 渲染进程 preload 暴露新 API
- [x] preload.js 暴露 api.canvas.hideFocused / resumeFocused / isFocusedHidden
- [x] preload.js 暴露 api.accountForm.open

## 5. 渲染进程 tabbar.js 支持 static tab
- [x] tab 数据结构扩展支持 type=account-form（含 formTabs 列表 + activeTabId 状态）
- [x] tabbar 渲染支持 form tab 的 close 按钮 + 标题
- [x] 切换 form tab 时触发 canvas 切换（hideFocused + 显示 form DOM）
- [x] 切换回 game tab 时触发 resumeFocused + 隐藏 form DOM

## 6. 渲染进程 src/index.html 预留表单挂载点
- [x] canvas 区域新增 div id=canvas-form-mount
- [x] form tab 激活时 form HTML 注入该 mount 点

## 7. 新建 src/css/account-form.css
- [x] 中部 canvas 区静态表单样式
- [x] 与 sidebar.css 的 .modal-* 复用

## 8. 新建 src/js/account-form.js
- [x] 暴露 window.mwiAccountForm.open / close
- [x] 拉 groups + presets，构建表单 DOM
- [x] select options 渲染
- [x] 表单字段预填
- [x] submit 调 window.api.accounts.create/update + onClose 回调

## 9. 改 src/js/sidebar.js openModal
- [x] openModal 改为调 window.mwiTabbar.openFormTab(isEdit, account)
- [x] 编辑按钮（panel.js 编辑按钮 + sidebar.js 内 [E]）走同一 openModal 入口

## 10. 静态校验
- [x] node --check 全部 .js（11 个文件）
- [x] 资源引用一致性（HTML link/script 路径存在）
- [x] IPC 字段一致性（主进程 handler 与 preload invoke 命名一致）
- [x] 跨进程 API 命名（api.canvas.* / api.accountForm.* 一致）
- [x] openspec validate account-form-as-static-tab（PASS）

## 11. 归档
- [x] openspec archive account-form-as-static-tab
