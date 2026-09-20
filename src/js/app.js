// app.js - 渲染进程入口（ES modules）
// 单一 module 入口：显式 import 全部模块并按依赖顺序初始化，
// 替换原先 14 个 IIFE script 标签的隐式加载 + window.mwiXxx 全局通信。
import { initI18n } from './i18n.js';
import { initModal } from './modal.js';
import { initSidebar } from './sidebar.js';
import { initTabbar } from './tabbar.js';
import { initAccountForm } from './account-form.js';
import { initSettingsTab } from './settings-tab.js';
import { initSubscriptionsTab } from './subscription-tab.js';
import { initPanel } from './panel.js';
import { initStatusbar } from './statusbar.js';
import { initLayout } from './layout.js';
import { initBulkActions } from './bulk-actions.js';

console.log('[mwi] app.js loaded');
console.log('[mwi] electron version:', window.api && window.api.app && window.api.app.version || 'unknown');
console.log('[mwi] platform:', window.api && window.api.app && window.api.app.platform || 'unknown');

if (!window.api || !window.api.accounts || !window.api.groups || !window.api.metrics) {
  console.error('[mwi] window.api 部分缺失，preload bridge 配置有误');
}

// 各模块默认互相 import（显式 ES 依赖）；init(deps) 支持测试注入覆盖
// 顺序与原 script 标签加载顺序一致：i18n → modal → sidebar → tabbar →
// 表单/设置/订阅 → panel → statusbar → layout → bulk-actions
// （custom-select 无 init，按需被 account-form 调用 replace）
initI18n();
initModal();
initSidebar();
initTabbar();
initAccountForm();
initSettingsTab();
initSubscriptionsTab();
initPanel();
initStatusbar();
initLayout();
initBulkActions();

console.log('[mwi] app.js init done');
