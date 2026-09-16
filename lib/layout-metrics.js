// lib/layout-metrics.js - 布局尺寸单一事实源（批次 3 ISSUE-248）
// 主进程 WebContentsView bounds 计算与渲染层 CSS token 的唯一数值来源：
// 改这里后任意 npm start / dev / test / build 会经 scripts/layout-tokens.mjs
// 自动同步 src/css/tokens.css 的对应变量（tokens.css 中不再手工维护数值）。

const LAYOUT = {
  TOOLBAR_H: 48,
  TABBAR_H: 36,
  STATUSBAR_H: 32,
  SIDEBAR_W: 240,
  RIGHT_W: 320,
};

const TOKEN_TO_CSS = {
  TOOLBAR_H: '--mwi-toolbar-h',
  TABBAR_H: '--mwi-tabbar-h',
  STATUSBAR_H: '--mwi-statusbar-h',
  SIDEBAR_W: '--mwi-sidebar-w',
  RIGHT_W: '--mwi-right-w',
};

module.exports = { ...LAYOUT, LAYOUT, TOKEN_TO_CSS };
