// lib/__tests__/clipboard-bridge.e2e.js - 剪贴板快捷键桥接 E2E 验证
// 用真实 electron 进程 + WebContentsView 验证 before-input-event 兜底逻辑：
// Cmd+V 粘贴剪贴板内容到页面 input、Cmd+A 全选 + Cmd+C 复制回剪贴板
// 运行：export PATH=/opt/homebrew/bin:$PATH; npx electron lib/__tests__/clipboard-bridge.e2e.js
// 退出码 0 = 通过；1 = 失败
const { app, BrowserWindow, WebContentsView, clipboard } = require('electron');

app.whenReady().then(async function () {
  try {
    const win = new BrowserWindow({ show: false, width: 900, height: 700 });
    const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: false } });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 900, height: 700 });

    // 与 lib/views.js startView 完全一致的兜底绑定
    view.webContents.on('before-input-event', function (event, input) {
      if (!input || input.type !== 'keyDown') return;
      const mod = process.platform === 'darwin' ? input.meta : input.control;
      if (!mod) return;
      const k = String(input.key || '').toLowerCase();
      try {
        if (k === 'c') view.webContents.copy();
        else if (k === 'v') view.webContents.paste();
        else if (k === 'x') view.webContents.cut();
        else if (k === 'a') view.webContents.selectAll();
      } catch (e) { /* ignore */ }
    });

    await view.webContents.loadFile('/tmp/clip-test.html');
    await new Promise(function (r) { setTimeout(r, 400); });

    // 粘贴测试：预置剪贴板 → 聚焦 input → Cmd+V → 读 value
    clipboard.writeText('CLIP_PASTE_123');
    await view.webContents.executeJavaScript("document.getElementById('in').focus()");
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['meta'] });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['meta'] });
    await new Promise(function (r) { setTimeout(r, 400); });
    const pasted = await view.webContents.executeJavaScript("document.getElementById('in').value");

    // 复制测试：清空剪贴板 → Cmd+A 全选 → Cmd+C → 读剪贴板
    clipboard.writeText('');
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['meta'] });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['meta'] });
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: ['meta'] });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: ['meta'] });
    await new Promise(function (r) { setTimeout(r, 400); });
    const copied = clipboard.readText();

    console.log('pasted:', JSON.stringify(pasted), '| copied:', JSON.stringify(copied));
    const pass = pasted === 'CLIP_PASTE_123' && copied === 'CLIP_PASTE_123';
    console.log(pass ? 'E2E PASS' : 'E2E FAIL');
    win.destroy();
    app.exit(pass ? 0 : 1);
  } catch (e) {
    console.error('E2E exception:', e && e.message);
    app.exit(1);
  }
});