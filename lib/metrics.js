// lib/metrics.js - app.getAppMetrics 聚合 + 推流
// 每 2 秒聚合一次：总内存 / 平均 CPU / views 数 / 运行时长 / renderer 数

const { app } = require('electron');
const views = require('./views');

const MAX_VIEWS = 6;
const subscribers = new Set();
let loopHandle = null;
let appStartedAt = Date.now();

function aggregate() {
  const uptimeSec = Math.floor((Date.now() - appStartedAt) / 1000);
  const running = views.listRunning();

  let renderers = [];
  try {
    const all = app.getAppMetrics();
    // Electron 43 里网页 renderer 的 processMetric.type 是 'Tab'（旧版是 'renderer'）
    renderers = all.filter(function (m) { return m.type === 'Tab' || m.type === 'renderer'; });
  } catch (e) {
    console.error('[metrics] app.getAppMetrics failed:', e);
  }

  // 注意单位：ProcessMetric.memory.workingSetSize 是 KB（不是 bytes）
  const memKB = renderers.reduce(function (sum, m) {
    return sum + (m && m.memory && m.memory.workingSetSize || 0);
  }, 0);
  const memMB = Math.round(memKB / 1024);

  let cpuSum = 0;
  for (const m of renderers) {
    cpuSum += (m && m.cpu && m.cpu.percentCPUUsage || 0);
  }
  const cpuPct = renderers.length > 0
    ? Math.round((cpuSum / renderers.length) * 10) / 10
    : 0;

  return {
    memMB: memMB,
    cpuPct: cpuPct,
    viewsCount: running.length,
    maxViews: MAX_VIEWS,
    uptimeSec: uptimeSec,
    rendererCount: renderers.length,
  };
}

function emit(snapshot) {
  for (const cb of subscribers) {
    try { cb(snapshot); } catch (e) { console.error('[metrics] subscriber err', e); }
  }
}

function tick() {
  try {
    emit(aggregate());
  } catch (e) {
    console.error('[metrics] tick failed:', e);
  }
}

function startMetricsLoop(intervalMs) {
  if (loopHandle) return;
  intervalMs = intervalMs || 2000;
  appStartedAt = Date.now();
  tick();
  loopHandle = setInterval(tick, intervalMs);
}

function stopMetricsLoop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

function onUpdate(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function snapshot() {
  return aggregate();
}

module.exports = {
  startMetricsLoop, stopMetricsLoop,
  onUpdate, snapshot, aggregate,
};
