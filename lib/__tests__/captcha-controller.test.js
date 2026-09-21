// lib/__tests__/captcha-controller.test.js - 求解状态机单测（issue #47）
// 全量注入假依赖（store/evalJs/clickAt/drag/sleep/log/onDegrade），零 Electron。
// readScript/extractScript 注入标记串（'READ'/'EXTRACT'）便于 evalJs 分流。
// 轮询用真实 setInterval（pollMs=10），流程内等待走注入的 no-op sleep，整体毫秒级。
// 运行：node --test lib/__tests__/captcha-controller.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const CONTROLLER_PATH = require.resolve(path.join(__dirname, '..', 'captcha-autoslide', 'controller.js'));

const INTERSTITIAL = { slider: null, interstitial: { rect: { x: 100, y: 200, w: 300, h: 50 } } };
const SLIDER = {
  slider: {
    type: 'slider',
    bgUrl: 'https://static.geetest.com/bg.png',
    sliceUrl: 'https://static.geetest.com/slice.png',
    bgRect: { x: 400, y: 200, w: 302, h: 201 },
    btnRect: { x: 480, y: 430, w: 81, h: 50 },
    refreshRect: { x: 400, y: 520, w: 26, h: 26 },
  },
  interstitial: null,
};
const EXTRACT_OK = { ok: true, ox: 196, k: 0.59, resid: 845.6, dx: 197 };
const GEO_OK = {
  ok: true,
  bgUrl: 'https://static.geetest.com/bg.png',
  sliceUrl: 'https://static.geetest.com/slice.png',
  bgRect: { x: 400, y: 200, w: 302, h: 201 },
  sliceRect: { x: 400, y: 298, w: 80, h: 80 },
  btnRect: { x: 480, y: 430, w: 81, h: 50 },
  refreshRect: { x: 400, y: 520, w: 26, h: 26 },
};

function freshController(opts) {
  opts = opts || {};
  delete require.cache[CONTROLLER_PATH];
  const controller = require('../captcha-autoslide/controller');

  const store = {
    data: { captchaAutoslideEnabled: opts.enabled === undefined ? true : opts.enabled },
    get(k) { return this.data[k]; },
    set(k, v) { this.data[k] = v; },
  };
  const world = {
    clicks: [],            // { x, y }
    drags: [],             // path 对象
    geos: 0,
    solves: 0,
    downloads: 0,
    readResults: [],       // 队列：每次 READ 依次弹出；空则沿用最后一个
    geoResults: opts.geoResults || [],  // 队列：每次 GEO 依次弹出；空则沿用最后一个
    solveResults: [],      // 队列：每次 SOLVE 依次弹出；空则沿用最后一个
    lastRead: null,
    lastGeo: GEO_OK,
    logs: [],
    degrades: [],
    store,
  };
  const sleep = opts.realSleep ? function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); } : function () { return Promise.resolve(); };

  controller.init({
    store: store,
    pollMs: 10,
    cooldownMs: opts.cooldownMs || 5,   // 默认极短冷却，让重试链在毫秒级跑完；要冻结单轮就传大值
    log: {
      info: function (id, msg) { world.logs.push(['info', id, msg]); },
      warn: function (id, msg) { world.logs.push(['warn', id, msg]); },
      error: function (id, msg) { world.logs.push(['error', id, msg]); },
    },
    sleep: sleep,
    evalJs: async function (wc, script) {
      if (script === 'READ') {
        if (world.readResults.length) { world.lastRead = world.readResults.shift(); }
        return world.lastRead;
      }
      if (script === 'GEO') {
        world.geos++;
        if (world.geoResults.length) { world.lastGeo = world.geoResults.shift(); }
        return world.lastGeo;
      }
      if (script === 'SOLVE') {
        world.solves++;
        return opts.solveResults ? opts.solveResults.shift() : (opts.solveResult || EXTRACT_OK);
      }
      throw new Error('unexpected script');
    },
    clickAt: function (wc, x, y) { world.clicks.push({ x: x, y: y }); },
    drag: async function (wc, p) { world.drags.push(p); return { ok: true, durationMs: 1500 }; },
    downloadImage: async function () { world.downloads++; return 'data:image/png;base64,QQ=='; },
    onDegrade: function (id, reason) { world.degrades.push([id, reason]); },
    readScript: function () { return 'READ'; },
    geometryScript: function () { return 'GEO'; },
    solveScript: function () { return 'SOLVE'; },
    resultPollCount: opts.resultPollCount || 6,
    successGoneStreak: opts.successGoneStreak || 2,
  });
  return { controller: controller, world: world };
}

function realSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('开关：默认启用；setEnabled(false) 持久化且轮询停手', async () => {
  const ctx = freshController();
  assert.strictEqual(ctx.controller.isEnabled(), true);
  ctx.controller.setEnabled(false);
  assert.strictEqual(ctx.world.store.data.captchaAutoslideEnabled, false, '应写 store');

  ctx.controller.attach('acc1', { webContents: {} });
  ctx.world.readResults.push(INTERSTITIAL);
  await realSleep(50);
  assert.strictEqual(ctx.world.clicks.length, 0, '禁用后不应有任何动作');
  ctx.controller.detach('acc1');
});

test('触发点②：拦截页按钮 → 自动真实点击按钮中心（且只点一次）', async () => {
  const ctx = freshController();
  ctx.controller.attach('acc1', { webContents: {} });
  // 第一次 READ：拦截页出现；其后 READ 返回 null（滑块已展开/拦截消失）
  ctx.world.readResults.push(INTERSTITIAL, null);
  await realSleep(50);
  assert.strictEqual(ctx.world.clicks.length, 1);
  assert.strictEqual(ctx.world.clicks[0].x, 250);   // 100 + 300/2
  assert.strictEqual(ctx.world.clicks[0].y, 225);   // 200 + 50/2
  assert.ok(ctx.world.logs.some(function (l) { return l[0] === 'info' && l[2].indexOf('开始验证') !== -1; }));
  ctx.controller.detach('acc1');
});

test('触发点①求解成功：extract → 拖拽到 btnCenter+dx → 等待滑块消失 → attempts 清零', async () => {
  const ctx = freshController();
  ctx.controller.attach('acc1', { webContents: {} });
  // 第一次 READ：滑块出现；其后 READ 返回生产「无弹窗」形状对象（= 通过）
  ctx.world.readResults.push(SLIDER, { slider: null, interstitial: null, ts: 1 });

  await realSleep(80);
  assert.strictEqual(ctx.world.geos, 1);
  assert.strictEqual(ctx.world.downloads, 2, '应下载 bg+slice 两张贴图');
  assert.strictEqual(ctx.world.solves, 1);
  assert.strictEqual(ctx.world.drags.length, 1);
  const path = ctx.world.drags[0];
  assert.strictEqual(path.points[0].x, GEO_OK.btnRect.x + GEO_OK.btnRect.w / 2);
  const last = path.points[path.points.length - 1];
  assert.ok(Math.abs(last.x - (GEO_OK.btnRect.x + GEO_OK.btnRect.w / 2 + EXTRACT_OK.dx)) < 1e-9);
  assert.ok(ctx.world.logs.some(function (l) { return l[2].indexOf('ox=196') !== -1 && l[2].indexOf('k=0.59') !== -1; }), '应记录 ox/k/resid');
  assert.strictEqual(ctx.controller.getState('acc1').attempts, 0, '成功后清零');
  assert.strictEqual(ctx.controller.getState('acc1').degraded, false);
  ctx.controller.detach('acc1');
});

test('失败重试：第 2 轮先点「刷新验证」；连续 3 次失败 → 降级手动', async () => {
  const ctx = freshController({ resultPollCount: 1 });
  ctx.controller.attach('acc1', { webContents: {} });
  // 所有 READ 恒返回滑块可见 = 一直不通过
  ctx.world.lastRead = SLIDER;

  await realSleep(150);
  const st = ctx.controller.getState('acc1');
  assert.strictEqual(st.degraded, true);
  assert.deepStrictEqual(ctx.world.degrades, [['acc1', 'max_attempts']]);
  assert.strictEqual(ctx.world.solves, 3, '恰好尝试 3 次');
  // 第 2/3 轮前应点击刷新按钮（refreshRect 中心 413,533）
  assert.strictEqual(ctx.world.clicks.length, 2);
  assert.strictEqual(ctx.world.clicks[0].x, 413);
  assert.strictEqual(ctx.world.clicks[0].y, 533);
  assert.ok(ctx.world.logs.some(function (l) { return l[0] === 'error' && l[2].indexOf('降级手动') !== -1; }));
  ctx.controller.detach('acc1');
});

test('非滑块题型：识别后立即降级，绝不误拖', async () => {
  const ctx = freshController();
  ctx.controller.attach('acc1', { webContents: {} });
  ctx.world.readResults.push({ slider: { type: 'other' }, interstitial: null });
  await realSleep(50);
  assert.deepStrictEqual(ctx.world.degrades, [['acc1', 'non_slider']]);
  assert.strictEqual(ctx.world.geos, 0);
  assert.strictEqual(ctx.world.drags.length, 0);
  ctx.controller.detach('acc1');
});

test('geometry 失败：计一次失败尝试，未达上限不降级', async () => {
  // 大冷却冻结在首轮：验证单轮 geometry 失败的行为（不拖拽、不降级、attempts=1）
  const ctx = freshController({ cooldownMs: 60000, geoResults: [{ ok: false, error: 'slider_dom_missing' }] });
  ctx.controller.attach('acc1', { webContents: {} });
  ctx.world.readResults.push(SLIDER, SLIDER);   // 首次出现 → 求解后仍可见
  await realSleep(80);
  assert.strictEqual(ctx.world.geos, 1);
  assert.strictEqual(ctx.world.drags.length, 0, 'geometry 失败不应拖拽');
  const st = ctx.controller.getState('acc1');
  assert.strictEqual(st.degraded, false);
  assert.strictEqual(st.attempts, 1);
  ctx.controller.detach('acc1');
});

test('detach 后停止轮询', async () => {
  const ctx = freshController();
  ctx.controller.attach('acc1', { webContents: {} });
  ctx.controller.detach('acc1');
  const before = ctx.world.clicks.length;
  ctx.world.readResults.push(INTERSTITIAL);
  await realSleep(40);
  assert.strictEqual(ctx.world.clicks.length, before);
  assert.strictEqual(ctx.controller.getState('acc1'), null);
});

// === 成功判定契约（评审 #49 阻塞项）：生产 readScript 恒返回对象，永不为 null ===
test('isSliderGone：生产脚本形状契约（{slider:null} = 通过；undefined = 不算）', () => {
  const ctx = freshController();
  const gone = ctx.controller.isSliderGone;
  assert.strictEqual(gone({ slider: null, interstitial: null, ts: 1 }), true, '生产无弹窗形状必须判通过');
  assert.strictEqual(gone({ slider: { type: 'slider' }, interstitial: null }), false, '滑块仍在 = 未通过');
  assert.strictEqual(gone({ slider: { type: 'other' }, interstitial: null }), false);
  assert.strictEqual(gone({ slider: null, interstitial: { rect: {} } }), false, '拦截页出现 = 未通过');
  assert.strictEqual(gone(null), false, 'evalJs 异常回退 undefined 不得误判通过');
  assert.strictEqual(gone(undefined), false);
});
