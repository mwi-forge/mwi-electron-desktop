// lib/captcha-autoslide/controller.js - per-view 求解状态机（issue #47）
// 状态流：轮询页面状态 → 拦截页按钮自动点击（触发点②）或滑块弹窗求解（触发点①）
//        → ≤3 次重试（每轮先「刷新验证」换图）→ 失败降级手动（不阻塞登录/进游戏）。
// 设计约束：
//   - 依赖全部可注入（store/evalJs/drag/clickAt/sleep/log/onDegrade），单测零 Electron
//   - 非滑块题型（type:'other'）立即降级，绝不误拖
//   - degraded 为 per-view 会话级：降级后本视图不再自动尝试，重启视图才恢复

const trajectory = require('./trajectory');

const DEFAULTS = {
  pollMs: 800,            // 页面状态轮询间隔
  cooldownMs: 1200,       // 动作间冷却（点击拦截页按钮后等弹窗打开 / 失败后等换图）
  resultPollMs: 700,      // 拖拽后验证结果轮询间隔
  resultPollCount: 8,     // 结果等待轮数（8 × 700ms ≈ 5.6s，GeeTest 校验 + 换图）
  successGoneStreak: 3,   // 连续 3 次读到「无弹窗」才判定通过，滤掉换图间隙的假消失
  maxAttempts: 3,         // 求解重试上限（issue #47 验收 c）
  refreshWaitMs: 600,     // 点「刷新验证」后等新图加载
};

const STORE_SCHEMA = { captchaAutoslideEnabled: { type: 'boolean', default: true } };

// === 可注入依赖（数值项必须带 DEFAULTS 兜底——2026-09-22 单测抓过 undefined 比较恒 false 的坑）===
let deps = {
  store: null,                                   // electron-store 注入点（单测假 store）
  log: null,                                     // { info, warn, error }(accountId, msg)
  sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
  evalJs: null,                                  // async (wc, script) => 结果
  clickAt: null,                                 // (wc, x, y) => void   浏览器层真实单击
  drag: null,                                    // async (wc, path) => {ok, durationMs}
  onDegrade: null,                               // (accountId, reason) => void
  readScript: null,                              // () => string  页内读状态脚本
  geometryScript: null,                          // () => string  页内读几何+URL 脚本
  solveScript: null,                             // (bgDataUrl, sliceDataUrl, geo) => string 页内求解脚本
  downloadImage: null,                           // async (url, wc) => base64（走视图 session 代理）
  pollMs: DEFAULTS.pollMs,
  cooldownMs: DEFAULTS.cooldownMs,
  resultPollMs: DEFAULTS.resultPollMs,
  resultPollCount: DEFAULTS.resultPollCount,
  successGoneStreak: DEFAULTS.successGoneStreak,
  maxAttempts: DEFAULTS.maxAttempts,
  refreshWaitMs: DEFAULTS.refreshWaitMs,
};
let initialized = false;
let storeInstance = null;
let enabled = true;

function getStore() {
  if (deps.store) return deps.store;
  if (!storeInstance) {
    const Store = require('electron-store');
    storeInstance = new Store({ name: 'captcha', schema: STORE_SCHEMA, clearInvalidConfig: false });
  }
  return storeInstance;
}

function init(d) {
  if (d.store !== undefined) deps.store = d.store;
  if (d.log) deps.log = d.log;
  if (d.sleep) deps.sleep = d.sleep;
  if (d.evalJs) deps.evalJs = d.evalJs;
  if (d.clickAt) deps.clickAt = d.clickAt;
  if (d.drag) deps.drag = d.drag;
  if (d.onDegrade) deps.onDegrade = d.onDegrade;
  if (d.readScript) deps.readScript = d.readScript;
  if (d.geometryScript) deps.geometryScript = d.geometryScript;
  if (d.solveScript) deps.solveScript = d.solveScript;
  if (d.downloadImage) deps.downloadImage = d.downloadImage;
  if (d.pollMs) deps.pollMs = d.pollMs;
  if (d.cooldownMs) deps.cooldownMs = d.cooldownMs;
  if (d.maxAttempts) deps.maxAttempts = d.maxAttempts;
  if (d.resultPollMs) deps.resultPollMs = d.resultPollMs;
  if (d.resultPollCount) deps.resultPollCount = d.resultPollCount;
  if (d.successGoneStreak) deps.successGoneStreak = d.successGoneStreak;
  if (d.refreshWaitMs) deps.refreshWaitMs = d.refreshWaitMs;
  if (initialized) return;
  initialized = true;
  try { enabled = getStore().get('captchaAutoslideEnabled') !== false; } catch (_e) { /* 回退默认开 */ }
}

function ensureReady() {
  if (deps.log && deps.evalJs && deps.clickAt && deps.drag && deps.readScript && deps.geometryScript && deps.solveScript && deps.downloadImage) return;
  // 默认依赖懒装配（生产路径）；单测走 init() 全量注入，不触到这里
  const logs = require('../logs');
  const dragMod = require('./drag');
  const pageScripts = require('./page-scripts');
  const match = require('./match');
  if (!deps.log) deps.log = logs;
  if (!deps.evalJs) deps.evalJs = function (wc, script) { return wc.executeJavaScript(script, true); };
  if (!deps.clickAt) deps.clickAt = dragMod.clickAt;
  if (!deps.drag) deps.drag = function (wc, path) { return dragMod.dragHandle(wc, path); };
  if (!deps.readScript) deps.readScript = function () { return '(' + pageScripts.mwiCaptchaReadState.toString() + ')()'; };
  if (!deps.geometryScript) deps.geometryScript = pageScripts.buildGeometryScript;
  if (!deps.solveScript) deps.solveScript = function (bg, sl, geo) { return pageScripts.buildSolveScript(match, bg, sl, geo); };
  if (!deps.downloadImage) {
    // net.fetch 带视图 session：走该账号同一代理出口下载贴图，主进程直连会泄露真实 IP
    deps.downloadImage = async function (url, wc) {
      const { net } = require('electron');
      const res = await net.fetch(url, { session: wc.session });
      if (!res.ok) throw new Error('download ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      return 'data:image/png;base64,' + buf.toString('base64');
    };
  }
  if (!deps.onDegrade) {
    deps.onDegrade = function (accountId) {
      try {
        const alert = require('../alert');
        alert.showAppAlert({
          type: 'warning',
          title: '验证码自动滑动失败',
          message: '自动求解未通过，请手动完成滑块验证。',
          detail: '已连续 ' + deps.maxAttempts + ' 次尝试失败，为避免风控分继续拉高已停止自动重试。\n手动拖动通过后即可正常进入游戏。',
          buttons: ['我知道了'],
          defaultId: 0,
          cancelId: 0,
        });
      } catch (_e) { /* 弹窗失败不影响降级状态本身 */ }
    };
  }
}

// === 开关持久化（默认开启，issue #47 验收 d）===
function isEnabled() { return !!enabled; }
function getConfig() { return { enabled: !!enabled }; }
function setEnabled(v) {
  init({});
  enabled = !!v;
  try { getStore().set('captchaAutoslideEnabled', enabled); } catch (_e) { /* 写失败不阻塞运行时开关 */ }
  if (!enabled) {
    for (const c of controllers.values()) c.cooldownUntil = Number.MAX_SAFE_INTEGER;  // 立即停手
  } else {
    for (const c of controllers.values()) if (c.cooldownUntil === Number.MAX_SAFE_INTEGER) c.cooldownUntil = 0;
  }
}

// === per-view 控制器 ===
const controllers = new Map();  // accountId -> { wc, busy, degraded, attempts, timer, cooldownUntil }

// attach 由 lifecycle 在 view started 后调用；幂等
function attach(accountId, view) {
  ensureReady();
  if (controllers.has(accountId)) return;
  const c = {
    wc: view && view.webContents ? view.webContents : null,
    busy: false,
    degraded: false,
    attempts: 0,
    timer: null,
    cooldownUntil: 0,
  };
  controllers.set(accountId, c);
  c.timer = setInterval(function () {
    tick(accountId).catch(function () { /* 导航中/页面销毁等瞬时失败静默，下 tick 重试 */ });
  }, deps.pollMs);
  if (typeof c.timer.unref === 'function') c.timer.unref();
}

function detach(accountId) {
  const c = controllers.get(accountId);
  if (!c) return;
  c.stopping = true;
  clearInterval(c.timer);
  controllers.delete(accountId);
}

function getState(accountId) {
  const c = controllers.get(accountId);
  if (!c) return null;
  return { degraded: c.degraded, attempts: c.attempts };
}

async function tick(accountId) {
  if (!enabled) return;
  const c = controllers.get(accountId);
  if (!c || c.stopping || c.busy || c.degraded) return;
  if (c.cooldownUntil && Date.now() < c.cooldownUntil) return;
  if (!c.wc) return;

  let st = null;
  try {
    st = await deps.evalJs(c.wc, deps.readScript());
  } catch (_e) { return; }   // 页面导航/销毁窗口期：本 tick 放弃
  if (!st) return;

  if (st.slider && st.slider.type === 'other') {
    // 非滑块题型：识别后直接降级，不误拖（验收 f）
    degrade(accountId, 'non_slider');
    return;
  }
  if (st.slider && st.slider.type === 'slider') {
    await solveFlow(accountId, st);
    return;
  }
  if (st.interstitial && st.interstitial.rect) {
    // 触发点②：拦截页「点击按钮开始验证」→ 真实点击展开滑块
    const r = st.interstitial.rect;
    deps.clickAt(c.wc, r.x + r.w / 2, r.y + r.h / 2);
    deps.log.info(accountId, '[captcha] 拦截页检测到，已自动点击「开始验证」');
    c.cooldownUntil = Date.now() + deps.cooldownMs;
  }
}

// 求解一轮：读几何 → 主进程下载贴图（视图同代理）→ 页内匹配 → 合成轨迹拖拽 → 等结果
async function solveFlow(accountId, st) {
  const c = controllers.get(accountId);
  // 入口自查 busy：READ 轮询耗时长于 pollMs 时，多个 tick 会同时越过 busy 检查
  // 并发进入 solveFlow（2026-09-22 真机踩坑：attempts 并发叠加到 8 次）
  if (!c || c.busy) return;
  c.busy = true;
  const wc = c.wc;
  try {
    c.attempts++;
    // 第 2/3 轮先点「刷新验证」换新图（底稿踩坑 #2：失败自动换图，几何每轮全变）
    if (c.attempts > 1) {
      if (st.slider.refreshRect) {
        const rf = st.slider.refreshRect;
        deps.clickAt(wc, rf.x + rf.w / 2, rf.y + rf.h / 2);
        await deps.sleep(deps.refreshWaitMs);
      }
    }

    // ① 页内读几何 + 贴图 URL
    let geo = null;
    try {
      geo = await deps.evalJs(wc, deps.geometryScript());
    } catch (e) {
      deps.log.warn(accountId, '[captcha] geometry 执行失败: ' + (e && e.message ? e.message : e));
    }
    if (!geo || !geo.ok) {
      deps.log.warn(accountId, '[captcha] attempt=' + c.attempts + ' geometry 失败: ' + ((geo && geo.error) || 'no_result'));
      return failAttempt(accountId, c, 'geometry_failed');
    }

    // ② 主进程下载两张原图（net.fetch 带视图 session = 走同一代理出口，不泄露真实 IP；
    //    页内直接 fetch 会被 CORS 拦——2026-09-22 真机踩坑）
    let bgB64 = null, slB64 = null;
    try {
      const pair = await Promise.all([
        deps.downloadImage(geo.bgUrl, wc),
        deps.downloadImage(geo.sliceUrl, wc),
      ]);
      bgB64 = pair[0]; slB64 = pair[1];
    } catch (e) {
      deps.log.warn(accountId, '[captcha] attempt=' + c.attempts + ' 贴图下载失败: ' + (e && e.message ? e.message : e));
      return failAttempt(accountId, c, 'download_failed');
    }

    // ③ 页内解码匹配（data:URL 无跨域污染）
    const script = deps.solveScript(bgB64, slB64, {
      bgRect: geo.bgRect, sliceRect: geo.sliceRect,
    });
    let ex = null;
    try {
      ex = await deps.evalJs(wc, script);
    } catch (e) {
      deps.log.warn(accountId, '[captcha] solve 执行失败: ' + (e && e.message ? e.message : e));
    }
    if (!ex || !ex.ok || !(ex.dx > 0)) {
      deps.log.warn(accountId, '[captcha] attempt=' + c.attempts + ' solve 失败: ' + ((ex && ex.error) || 'no_result') + (ex && ex.diag ? ' diag=' + JSON.stringify(ex.diag) : '') + ' [max=' + deps.maxAttempts + ' degraded=' + c.degraded + ']');
      return failAttempt(accountId, c, 'solve_failed');
    }
    if (!(geo.btnRect.x > -1)) return failAttempt(accountId, c, 'btn_missing');

    // ④ 人手轨迹拖拽（sendInputEvent 真实事件）
    const path = trajectory.buildPath({ startX: geo.btnRect.x + geo.btnRect.w / 2, startY: geo.btnRect.y + geo.btnRect.h / 2, dx: ex.dx });
    let res = null;
    try {
      res = await deps.drag(wc, path);
    } catch (e) {
      deps.log.warn(accountId, '[captcha] attempt=' + c.attempts + ' drag 异常: ' + (e && e.message ? e.message : e));
      return failAttempt(accountId, c, 'drag_failed');
    }
    deps.log.info(
      accountId,
      '[captcha] attempt=' + c.attempts +
      ' model=' + (ex.model || 'linear') + ' ox=' + ex.ox + ' k=' + (ex.model === 'flat' ? '-' : Number(ex.k).toFixed(2)) + ' resid=' + Math.round(ex.resid) +
      ' dx=' + Math.round(ex.dx) + 'px dragMs=' + res.durationMs + ' → verifying' +
      (ex.diag && ex.diag.champions ? ' champions=' + JSON.stringify(ex.diag.champions) : '')
    );

    // 等结果：滑块弹窗消失 = 通过。
    // 必须连续多次轮询确认——2026-09-22 真机踩坑：拖拽失败后 GeeTest 立即换图，
    // 换图瞬间 slice 元素短暂消失，单次轮询会误判为通过并清零 attempts（无限重拖）。
    let success = false, goneStreak = 0;
    for (let i = 0; i < deps.resultPollCount; i++) {
      await deps.sleep(deps.resultPollMs);
      let st2 = undefined;
      try { st2 = await deps.evalJs(wc, deps.readScript()); } catch (_e) { st2 = undefined; }
      if (isSliderGone(st2)) { goneStreak++; }      // 明确读到「无弹窗」
      else { goneStreak = 0; }                       // undefined（导航/销毁）与有弹窗都不算
      if (goneStreak >= deps.successGoneStreak) { success = true; break; }
    }

    if (success) {
      deps.log.info(accountId, '[captcha] 求解通过 (attempt=' + c.attempts + ')');
      c.attempts = 0;
    } else {
      deps.log.warn(accountId, '[captcha] attempt=' + c.attempts + ' 未通过（滑块仍在）');
      if (c.attempts >= deps.maxAttempts) {
        degrade(accountId, 'max_attempts');
      } else {
        c.cooldownUntil = Date.now() + deps.cooldownMs;
      }
    }
  } finally {
    c.busy = false;
  }
}

// 成功判定契约（评审 #49 阻塞项修复）：生产 readScript 恒返回对象，
// 「无弹窗」= { slider: null, interstitial: null }；evalJs 异常时为 undefined（不算）。
function isSliderGone(st2) {
  return !!st2 && st2.slider === null && !st2.interstitial;
}

function failAttempt(accountId, c, reason) {
  if (c.attempts >= deps.maxAttempts) {
    degrade(accountId, reason);
  } else {
    c.cooldownUntil = Date.now() + deps.cooldownMs;
  }
}

function degrade(accountId, reason) {
  const c = controllers.get(accountId);
  if (!c || c.degraded) return;
  c.degraded = true;
  deps.log.error(accountId, '[captcha] 降级手动 (' + reason + ')，本视图会话内不再自动尝试');
  try { deps.onDegrade(accountId, reason); } catch (_e) { /* 弹窗失败不影响降级状态 */ }
}

// 测试钩子：清空控制器状态（单测隔离用）
function _resetForTest() {
  for (const c of controllers.values()) clearInterval(c.timer);
  controllers.clear();
}

module.exports = {
  init, ensureReady, isEnabled, getConfig, setEnabled,
  attach, detach, getState, isSliderGone,
  DEFAULTS, _resetForTest,
};
