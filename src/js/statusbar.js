// src/js/statusbar.js - 底部状态条（Phase 4：metrics 实时数据）
// 订阅主进程推送的 metrics:update 事件，替换 Phase 0 占位的运行时长计时器

(function () {
  var elViews = document.getElementById('stat-views');
  var elMem = document.getElementById('stat-mem');
  var elCpu = document.getElementById('stat-cpu');
  var elUptime = document.getElementById('stat-uptime');

  function fmtUptime(sec) {
    var h = String(Math.floor(sec / 3600)).padStart(2, '0');
    var m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    var s = String(sec % 60).padStart(2, '0');
    return h + ':' + m + ':' + s;
  }

  // i18n 助手（防御 mwiI18n 未就绪）
  function t(key, vars) {
    return (window.mwiI18n && window.mwiI18n.t) ? window.mwiI18n.t(key, vars) : key;
  }

  function render(snap) {
    if (!snap) return;
    if (elViews) {
      elViews.textContent = t('statusbar.label.views', { count: snap.viewsCount, max: snap.maxViews });
      elViews.className = 'statusbar__item' + (snap.viewsCount >= snap.maxViews ? ' statusbar__item--warn' : '');
    }
    if (elMem) {
      elMem.textContent = t('statusbar.label.mem_mb', { n: snap.memMB });
      elMem.className = 'statusbar__item' + (snap.memMB > 1500 ? ' statusbar__item--error' : snap.memMB > 800 ? ' statusbar__item--warn' : '');
    }
    if (elCpu) {
      elCpu.textContent = t('statusbar.label.cpu_pct', { pct: snap.cpuPct });
      elCpu.className = 'statusbar__item' + (snap.cpuPct > 80 ? ' statusbar__item--error' : snap.cpuPct > 50 ? ' statusbar__item--warn' : '');
    }
    if (elUptime) {
      elUptime.textContent = t('statusbar.label.uptime', { time: fmtUptime(snap.uptimeSec) });
      elUptime.className = 'statusbar__item';
    }
  }

  // 订阅 metrics:update 实时推送
  window.api.metrics.onUpdate(render);

  // 初始拉一次快照（主进程 metrics loop 第一 tick 前的兜底）
  window.api.metrics.snapshot().then(render).catch(function (e) { console.error('[statusbar] snapshot failed', e); });

  // 语言切换时重新渲染（用最新一次 metrics 快照）
  // 但 metrics 没主动缓存最后值；用 onChange 触发一次新的 fetch 即可
  if (window.mwiI18n && window.mwiI18n.onChange) {
    window.mwiI18n.onChange(function () {
      window.api.metrics.snapshot().then(render).catch(function () {});
    });
  }

  window.mwiStatusbar = { render: render };
})();
