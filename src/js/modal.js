// src/js/modal.js - 应用内统一弹窗管理器
// 单 slot 实例：同时只渲染一个对话框；并发的 showAppAlert 排队。
// 两类入口合并：
//   1) 主进程 IPC `ui:dialog`（lib/alert.js 推送）→ 渲染（代理失败等主进程触发场景）
//   2) 渲染进程 window.mwiAlert.alert/confirm(...) → 渲染（panel/sidebar/tab 等直接调用）
//
// 设计要点：
// - 单例 queue：避免安全告警叠加；告警看完才能看下一个
// - 键盘可达：Enter 触发 defaultId；Esc 触发 cancelId（如有）
// - focus trap：焦点锁在弹窗内，避免 tab 跑到后面的游戏 view
// - body scroll lock：弹窗期间禁止滚动背景

(function () {
  'use strict';

  const api = window.api;

  // 状态：当前正在显示的 dialog（null = 空闲）+ 队列
  let currentEl = null;
  const queue = [];

  function ensureSlot() {
    let slot = document.getElementById('mwi-alert-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'mwi-alert-slot';
      document.body.appendChild(slot);
    }
    return slot;
  }

  function genId() {
    return 'dlg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * 通用内部渲染入口。所有 dialog（IPC 推送 + 渲染直接调用）都走这里。
   * 返回 Promise<number> 用户点击的按钮索引。
   */
  function renderDialog(payload) {
    const slot = ensureSlot();
    const backdrop = document.createElement('div');
    backdrop.className = 'mwi-alert-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'mwi-alert';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const dlgId = payload.id || genId();
    dialog.setAttribute('aria-labelledby', 'mwi-alert-title-' + dlgId);
    dialog.setAttribute('aria-describedby', 'mwi-alert-message-' + dlgId);

    // === header (icon + title) ===
    const header = document.createElement('div');
    header.className = 'mwi-alert__header';
    const icon = document.createElement('div');
    const type = payload.type || 'info';
    icon.className = 'mwi-alert__icon mwi-alert__icon--' + type;
    icon.textContent = type === 'error' ? '!' : type === 'warn' ? '!' : 'i';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('div');
    title.id = 'mwi-alert-title-' + dlgId;
    title.className = 'mwi-alert__title';
    title.textContent = payload.title || '';
    header.appendChild(icon);
    header.appendChild(title);
    dialog.appendChild(header);

    // === message ===
    if (payload.message) {
      const msg = document.createElement('div');
      msg.id = 'mwi-alert-message-' + dlgId;
      msg.className = 'mwi-alert__message';
      msg.textContent = payload.message;
      dialog.appendChild(msg);
    }

    // === detail (monospace block) ===
    if (payload.detail) {
      const detail = document.createElement('div');
      detail.className = 'mwi-alert__detail';
      detail.textContent = payload.detail;
      dialog.appendChild(detail);
    }

    // === actions ===
    const buttons = payload.buttons && payload.buttons.length ? payload.buttons : ['我知道了'];
    const actions = document.createElement('div');
    actions.className = 'mwi-alert__actions';
    const buttonEls = [];
    buttons.forEach((label, idx) => {
      const btn = document.createElement('button');
      btn.className = 'mwi-alert__btn' + (idx === payload.defaultId ? ' mwi-alert__btn--primary' : '');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.idx = String(idx);
      btn.addEventListener('click', () => finish(idx));
      buttonEls.push(btn);
      actions.appendChild(btn);
    });
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    slot.appendChild(backdrop);

    // 焦点默认落到 defaultId 按钮
    const focusIdx = typeof payload.defaultId === 'number' && payload.defaultId >= 0 && payload.defaultId < buttonEls.length
      ? payload.defaultId
      : 0;
    setTimeout(() => { try { buttonEls[focusIdx].focus(); } catch (_) {} }, 0);

    // body scroll lock
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // keyboard
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(typeof payload.defaultId === 'number' ? payload.defaultId : 0);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const cancelIdx = typeof payload.cancelId === 'number' ? payload.cancelId : focusIdx;
        finish(cancelIdx);
      } else if (e.key === 'Tab') {
        // 简单 focus trap：在 buttonEls 间循环
        const activeIdx = buttonEls.indexOf(document.activeElement);
        if (e.shiftKey) {
          if (activeIdx <= 0) { e.preventDefault(); buttonEls[buttonEls.length - 1].focus(); }
        } else {
          if (activeIdx === buttonEls.length - 1) { e.preventDefault(); buttonEls[0].focus(); }
        }
      }
    };
    document.addEventListener('keydown', onKey, true);

    // backdrop click：仅当 dismissOnBackdrop=true 时关闭，否则吞掉
    const onBackdropClick = (e) => {
      if (e.target === backdrop && payload.dismissOnBackdrop) finish(focusIdx);
    };
    backdrop.addEventListener('click', onBackdropClick);

    return new Promise((resolve) => {
      function finish(idx) {
        try { document.removeEventListener('keydown', onKey, true); } catch (_) {}
        try { backdrop.removeEventListener('click', onBackdropClick); } catch (_) {}
        try { backdrop.parentNode && backdrop.parentNode.removeChild(backdrop); } catch (_) {}
        try { document.body.style.overflow = prevOverflow; } catch (_) {}
        currentEl = null;
        // 主进程 IPC 来源的回执
        if (payload._fromMain && api && api.dialog && api.dialog.reply) {
          try { api.dialog.reply(payload.id, idx); } catch (e) { console.error('[modal] reply failed:', e); }
        }
        resolve(idx);
        pump();
      }
      currentEl = dialog;
      // 替换原来的 currentCleanup 直接挂在 finish 上
      // （currentEl 在 finish 内部置 null，pump 会自动续上队列）
      // 但需要让外部能引用到 finish —— 上面 currentCleanup 已移除，改用 currentEl 上的 _finish 引用
      dialog._finish = finish;
    });
  }

  function pump() {
    if (currentEl) return; // 已有对话框在显示
    const next = queue.shift();
    if (!next) return;
    // 标记 fromMain（区分 IPC 来源 vs 渲染进程直接调用）
    if (!next._source) next._source = 'local';
    const promise = renderDialog(next);
    if (next._source === 'local' && next._localResolve) {
      promise.then(next._localResolve);
    }
  }

  // ========== 公开 API ==========

  /**
   * 应用内单向通知（替代 window.alert）。返回 Promise<number>，resolve 用户点击的按钮索引。
   * 自动入队，跟主进程 IPC 推送的 dialog 合并队列。
   *
   * @param {Object} payload
   * @param {'error'|'warn'|'info'} [payload.type='info']
   * @param {string} [payload.title='提示']
   * @param {string} payload.message
   * @param {string} [payload.detail]
   * @param {string[]} [payload.buttons=['我知道了']]
   * @param {number} [payload.defaultId=0]
   */
  function alert(payload) {
    return new Promise((resolve) => {
      const item = {
        id: genId(),
        type: (payload && payload.type) || 'info',
        title: (payload && payload.title) || '提示',
        message: (payload && payload.message) || '',
        detail: (payload && payload.detail) || '',
        buttons: (payload && payload.buttons) || ['我知道了'],
        defaultId: (payload && typeof payload.defaultId === 'number') ? payload.defaultId : 0,
        cancelId: (payload && typeof payload.cancelId === 'number') ? payload.cancelId : 0,
        _source: 'local',
        _localResolve: resolve,
      };
      queue.push(item);
      pump();
    });
  }

  /**
   * 应用内二次确认（替代 window.confirm）。返回 Promise<boolean>。
   *
   * @param {Object} payload
   * @param {string} [payload.title='确认']
   * @param {string} payload.message
   * @param {string} [payload.detail]
   * @param {string} [payload.okLabel='确定']
   * @param {string} [payload.cancelLabel='取消']
   * @param {'error'|'warn'|'info'} [payload.type='warn']
   */
  function confirm(payload) {
    const okLabel = (payload && payload.okLabel) || '确定';
    const cancelLabel = (payload && payload.cancelLabel) || '取消';
    return new Promise((resolve) => {
      const item = {
        id: genId(),
        type: (payload && payload.type) || 'warn',
        title: (payload && payload.title) || '确认',
        message: (payload && payload.message) || '',
        detail: (payload && payload.detail) || '',
        buttons: [cancelLabel, okLabel],
        defaultId: 1, // Enter = 确定
        cancelId: 0,  // Esc = 取消
        _source: 'local',
        _localResolve: (idx) => resolve(idx === 1),
      };
      queue.push(item);
      pump();
    });
  }

  // 暴露给渲染进程
  window.mwiAlert = { alert, confirm };

  // ========== 主进程 IPC 入口（可选）==========

  if (api && api.dialog && api.dialog.onShow) {
    api.dialog.onShow((payload) => {
      if (!payload || !payload.id) {
        console.warn('[modal] received dialog without id, dropping');
        return;
      }
      // 主进程来源：queue item 上不需要 _localResolve；renderDialog 完成后通过 api.dialog.reply 回执
      const item = Object.assign({}, payload, { _source: 'main' });
      queue.push(item);
      pump();
    });
  } else {
    console.warn('[modal] window.api.dialog.onShow unavailable — main process alerts will not appear');
  }

  // 调试用：导出给 DevTools
  if (typeof window !== 'undefined') {
    window.__mwiModal = {
      queueLength: () => queue.length,
      busy: () => !!currentEl,
    };
  }
})();
