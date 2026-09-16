// preload-overlay.js — 助手窗口 preload
// 暴露 IPC 接口给助手窗口渲染进程
// contextIsolation: true, nodeIntegration: false 环境下安全通信

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  /** 重置助手窗口位置到主窗口所在屏幕右下角 */
  onResetPosition: function () {
    return ipcRenderer.invoke('overlay:reset-position');
  },
  /** 移动到指定屏幕坐标（JS 拖拽） */
  onMoveTo: function (x, y) {
    return ipcRenderer.invoke('overlay:move-to', x, y);
  },
  /** 单击 mascot：激活主窗口 */
  onActivateMain: function () {
    return ipcRenderer.invoke('overlay:activate-main');
  },
  /** 切换收缩/展开态（预留，方案一 NL 助手对接） */
  onToggleExpand: function () {
    ipcRenderer.send('overlay:toggle-expand');
  },
});
