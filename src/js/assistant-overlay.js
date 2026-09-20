// src/js/assistant-overlay.js — 助手小窗交互（拖拽换位 / 单击唤回主窗 / 双击归位）
// 自 src/assistant-overlay.html 内联脚本外置（Closes #21）：补 CSP 后
// script-src 'self' 不再放行内联脚本，交互逻辑移入外链文件，代码逐字保留。
(function () {
  var area = document.getElementById('mascotArea');
  if (!area) return;

  var isDragging = false;
  var dragStartX = 0, dragStartY = 0;
  var hasMoved = false;
  var clickTimer = null;
  var CLICK_DEBOUNCE = 300; // ms
  var DRAG_THRESHOLD = 5;   // px

  function clearClickTimer() {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  }

  area.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    isDragging = true;
    hasMoved = false;
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    area.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  area.addEventListener('pointermove', function (e) {
    if (!isDragging) return;
    var dx = e.screenX - dragStartX;
    var dy = e.screenY - dragStartY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      hasMoved = true;
      try {
        window.overlayAPI.onMoveTo(window.screenX + dx, window.screenY + dy);
        dragStartX = e.screenX;
        dragStartY = e.screenY;
      } catch (er) { /* ignore */ }
    }
    e.preventDefault();
  });

  area.addEventListener('pointerup', function (e) {
    if (!isDragging) return;
    isDragging = false;

    if (!hasMoved) {
      // 单击：区分单击 vs 双击
      if (clickTimer) {
        // 第二次点击（<=300ms）→ 双击：重置位置
        clearClickTimer();
        try { window.overlayAPI.onResetPosition(); } catch (er) { /* ignore */ }
      } else {
        // 第一次点击：等 300ms 确认不是双击
        clickTimer = setTimeout(function () {
          clickTimer = null;
          try { window.overlayAPI.onActivateMain(); } catch (er) { /* ignore */ }
        }, CLICK_DEBOUNCE);
      }
    }
  });

  // 清理定时器（防止 close 后残留）
  area.addEventListener('pointercancel', function () {
    isDragging = false;
  });
})();
