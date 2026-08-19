// lib/__tests__/scrollbar-hide.e2e.js - webView 滚动条隐藏 E2E 验证
// 用真实 electron 进程验证：insertCSS 隐藏 ::-webkit-scrollbar 后，
// getComputedStyle(documentElement, '::-webkit-scrollbar').display 变为 'none'，且页面仍可滚动
// 运行：export PATH=/opt/homebrew/bin:$PATH; npx electron lib/__tests__/scrollbar-hide.e2e.js
// 退出码 0 = 通过；1 = 失败
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async function () {
  try {
    const win = new BrowserWindow({ show: false, width: 800, height: 600 });
    await win.loadFile('/tmp/scroll-test.html');
    await new Promise(function (r) { setTimeout(r, 300); });

    // 注入前基线
    const before = await win.webContents.executeJavaScript("({ display: getComputedStyle(document.documentElement, '::-webkit-scrollbar').display, scrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight })");

    // 与 lib/views.js startView 完全一致的 CSS
    await win.webContents.insertCSS('::-webkit-scrollbar { display: none !important; } * { scrollbar-width: none; }');
    await new Promise(function (r) { setTimeout(r, 300); });

    // 注入后
    const after = await win.webContents.executeJavaScript("({ display: getComputedStyle(document.documentElement, '::-webkit-scrollbar').display, scrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight })");

    console.log('before:', JSON.stringify(before));
    console.log('after:', JSON.stringify(after));

    const pass = before.scrollable === true && after.display === 'none' && after.scrollable === true;
    console.log(pass ? 'E2E PASS' : 'E2E FAIL');
    win.destroy();
    app.exit(pass ? 0 : 1);
  } catch (e) {
    console.error('E2E exception:', e && e.message);
    app.exit(1);
  }
});