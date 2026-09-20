// lib/assistant-overlay.js — 独立助手窗口底座
// transparent/frameless/alwaysOnTop BrowserWindow 承载 mascot IP 形象
// 脱离主窗口 DOM 层级，在所有窗口之上悬浮显示
// 位置记忆持久化，支持拖动和重置到右下角
// 扩展预留：收缩/展开态切换、NL 助手面板对接（方案一）

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');

const OVERLAY_W = 80;
const OVERLAY_H = 60;
const MARGIN = 14;
const MOVE_SAVE_DEBOUNCE_MS = 500;

const store = new Store({ name: 'assistant-overlay' });

class AssistantOverlay {
  constructor(mainWindow, recreateMainWindow) {
    this.mainWindow = mainWindow;
    this.recreateMainWindow = typeof recreateMainWindow === 'function' ? recreateMainWindow : null;
    this.overlayWin = null;
    this._saveTimer = null;
    this.createWindow();
  }

  createWindow() {
    this.overlayWin = new BrowserWindow({
      width: OVERLAY_W,
      height: OVERLAY_H,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload-overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.overlayWin.loadFile(
      path.join(__dirname, '..', 'src', 'assistant-overlay.html'),
    );

    if (process.platform === 'darwin') {
      try { this.overlayWin.setLevel('floating'); } catch (_e) { /* 部分环境不支持 setLevel */ }
    }
    this.overlayWin.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });

    // macOS 修复：setVisibleOnAllWorkspaces(visibleOnFullScreen:true) 会让 app 激活策略
    // 退化为 Accessory —— 整个应用从 Dock 消失（实测：focusable:false 单独无害，组合触发）。
    // app.dock.show() 无效，必须显式恢复 Regular 策略。
    if (process.platform === 'darwin') {
      try { app.setActivationPolicy('regular'); } catch (_e) { /* 非 macOS 无此 API */ }
    }
        const savedPos = this._loadPosition();
    if (savedPos && this._isPositionValid(savedPos)) {
      this.overlayWin.setPosition(savedPos.x, savedPos.y);
    } else {
      this.moveToDefault();
    }

    this.overlayWin.on('move', () => this._debounceSavePosition());

    this.overlayWin.on('closed', () => {
      this.overlayWin = null;
    });
  }

  // 重置到主窗口所在屏幕右下角（而非仅主显示器）
  moveToDefault() {
    if (!this.overlayWin || this.overlayWin.isDestroyed()) return;
    let targetDisplay = null;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const winBounds = this.mainWindow.getContentBounds();
      const cx = winBounds.x + winBounds.width / 2;
      const cy = winBounds.y + winBounds.height / 2;
      targetDisplay = screen.getDisplayNearestPoint({ x: cx, y: cy });
    }
    if (!targetDisplay) {
      const displays = screen.getAllDisplays();
      targetDisplay = displays.find((d) => d.bounds.x === 0 && d.bounds.y === 0) || displays[0];
    }
    if (!targetDisplay) return;
    // 用 workArea（排除菜单栏/Dock/任务栏）而非 bounds，确保窗口在可见区域且不被系统 UI 遮挡
    const x = targetDisplay.workArea.x + targetDisplay.workArea.width - OVERLAY_W - MARGIN;
    const y = targetDisplay.workArea.y + targetDisplay.workArea.height - OVERLAY_H - MARGIN;
    this.overlayWin.setPosition(Math.round(x), Math.round(y));
  }

  // 更新主窗口引用（用于主窗口重建时单例更新）
  setMainWindow(mw) {
    this.mainWindow = mw;
  }

  // 移动到指定屏幕坐标（用于 JS 拖拽）
  moveTo(x, y) {
    if (!this.overlayWin || this.overlayWin.isDestroyed()) return;
    this.overlayWin.setPosition(Math.round(x), Math.round(y));
  }

  // 激活主窗口（最小化时恢复 + 聚焦；若已关闭/销毁则通过回调重建）
  activateMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
      return;
    }
    // 主窗口已关闭/销毁 → 重新创建（通过回调，站长传入 createMainWindow）
    if (typeof this.recreateMainWindow === 'function') {
      this.recreateMainWindow();
    }
  }

  destroy() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this.overlayWin && !this.overlayWin.isDestroyed()) {
      this.overlayWin.close();
    }
  }

  _loadPosition() {
    try {
      const pos = store.get('overlayPos');
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        return pos;
      }
    } catch (_e) { /* 损坏数据忽略 */ }
    return null;
  }

  _isPositionValid(pos) {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
    const displays = screen.getAllDisplays();
    return displays.some((d) => {
      const marginX = OVERLAY_W + MARGIN;
      const marginY = OVERLAY_H + MARGIN;
      return pos.x >= d.workArea.x - marginX && pos.x <= d.workArea.x + d.workArea.width &&
             pos.y >= d.workArea.y - marginY && pos.y <= d.workArea.y + d.workArea.height;
    });
  }

  _debounceSavePosition() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._savePosition();
    }, MOVE_SAVE_DEBOUNCE_MS);
  }

  _savePosition() {
    if (!this.overlayWin || this.overlayWin.isDestroyed()) return;
    const pos = this.overlayWin.getPosition();
    try {
      store.set('overlayPos', { x: pos[0], y: pos[1] });
    } catch (_e) { /* 忽略存储失败 */ }
  }
}

module.exports = AssistantOverlay;
