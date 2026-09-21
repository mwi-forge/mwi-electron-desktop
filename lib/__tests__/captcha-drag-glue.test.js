// lib/__tests__/captcha-drag-glue.test.js - drag 事件序列 + facade 装配 + 注入脚本完整性（issue #47）
// drag 事件序列是技术红线的落点：只允许 sendInputEvent 真实事件通道
// （mouseDown → mouseMove×n → mouseUp），终点必须精确落在 start+dx。
// 运行：node --test lib/__tests__/captcha-drag-glue.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { dragHandle, clickAt } = require('../captcha-autoslide/drag');
const pageScripts = require('../captcha-autoslide/page-scripts');
const match = require('../captcha-autoslide/match');
const { buildPath } = require('../captcha-autoslide/trajectory');

function fakeWc() {
  return { events: [], sendInputEvent(e) { this.events.push(e); } };
}

test('dragHandle：mouseDown → mouseMove×(n-1) → mouseUp，终点精确', async () => {
  const wc = fakeWc();
  const path = buildPath(
    { startX: 520.5, startY: 455, dx: 197 },
    { jitterFn: () => 0.5 },
  );
  const r = await dragHandle(wc, path, { sleep: () => Promise.resolve() });
  assert.strictEqual(r.ok, true);
  const ev = wc.events;
  assert.strictEqual(ev[0].type, 'mouseDown');
  assert.strictEqual(ev[0].x, Math.round(520.5));   // sendInputEvent 要求整数坐标
  assert.strictEqual(ev[ev.length - 1].type, 'mouseUp');
  const last = path.points[path.points.length - 1];
  assert.strictEqual(ev[ev.length - 1].x, Math.round(last.x));
  assert.strictEqual(ev[ev.length - 1].y, Math.round(last.y));
  const moves = ev.filter(function (e) { return e.type === 'mouseMove'; });
  assert.strictEqual(moves.length, path.points.length - 1);
  for (const m of moves) assert.strictEqual(m.button, 'left', 'mouseMove 必须携带 button=left 标记按住');
  // 红线：只允许 sendInputEvent 真实事件类型
  for (const e of ev) assert.ok(['mouseDown', 'mouseMove', 'mouseUp'].indexOf(e.type) !== -1);
});

test('dragHandle：非法入参拒绝', async () => {
  assert.strictEqual((await dragHandle(null, { points: [{ x: 0, y: 0 }] })).ok, false);
  assert.strictEqual((await dragHandle(fakeWc(), null)).ok, false);
  assert.strictEqual((await dragHandle(fakeWc(), { points: [], stepMs: 0 })).ok, false);
});

test('clickAt：一对 down/up 真实事件', () => {
  const wc = fakeWc();
  assert.strictEqual(clickAt(wc, 250, 225), true);
  assert.strictEqual(wc.events.length, 2);
  assert.strictEqual(wc.events[0].type, 'mouseDown');
  assert.strictEqual(wc.events[1].type, 'mouseUp');
  assert.strictEqual(clickAt(null, 1, 1), false);
});

test('page-scripts：读状态脚本包含全部 geetest 钩子选择器（防选择器回归）', () => {
  const src = pageScripts.mwiCaptchaReadState.toString();
  for (const sel of ['geetest_bg', 'geetest_slice_bg', 'geetest_btn', 'geetest_refresh', 'geetest_title', '开始验证', '请完成验证码']) {
    assert.ok(src.indexOf(sel) !== -1, '读状态脚本缺少: ' + sel);
  }
  // 2026-09-22 真机踩坑：geetest_box 外层容器是 1017x0 零高占位，不能作为可见性判据
  // （内部 bg/slice/btn 才是真实可见元素）。此处钉住：判定不得依赖 box 的 rect。
  assert.ok(src.indexOf('零高占位') !== -1 || src.indexOf('geetest_box') === -1);
});

test('page-scripts：几何脚本 + 求解脚本内嵌与 Node 同源的 solve 实现', () => {
  const geoScript = pageScripts.buildGeometryScript();
  assert.ok(geoScript.indexOf('mwiCaptchaExtractGeometry') !== -1);
  assert.ok(geoScript.indexOf('geetest_bg') !== -1 && geoScript.indexOf('geetest_slice_bg') !== -1);
  // 求解脚本：data:URL 传入 + OffscreenCanvas 解码 + Node 同源 solve
  const script = pageScripts.buildSolveScript(match, 'data:image/png;base64,QQ==', 'data:image/png;base64,Qg==', {
    bgRect: { x: 1, y: 2, w: 3, h: 4 }, sliceRect: { x: 5, y: 6, w: 7, h: 8 },
  });
  assert.ok(script.indexOf('function solve') !== -1, '应内嵌 solve 源码');
  assert.ok(script.indexOf('function nativeToCssDx') !== -1, '应内嵌 nativeToCssDx 源码');
  assert.ok(script.indexOf('mwiCaptchaSolveBody') !== -1);
  assert.ok(script.indexOf('OffscreenCanvas') !== -1, '应走 OffscreenCanvas 取像素');
  assert.ok(script.indexOf('data:image/png;base64,QQ==') !== -1, 'bg 贴图 data URL 应内嵌');
});

test('facade：attach/detach/getConfig 全链路（注入假依赖）', async () => {
  const CONTROLLER_PATH = require.resolve(path.join(__dirname, '..', 'captcha-autoslide', 'controller.js'));
  delete require.cache[CONTROLLER_PATH];
  const INDEX_PATH = require.resolve(path.join(__dirname, '..', 'captcha-autoslide', 'index.js'));
  delete require.cache[INDEX_PATH];
  const captcha = require('../captcha-autoslide');

  const reads = [];
  captcha.init({
    store: { data: {}, get(k) { return this.data[k]; }, set(k, v) { this.data[k] = v; } },
    pollMs: 10,
    log: { info() {}, warn() {}, error() {} },
    sleep: () => Promise.resolve(),
    evalJs: async function (_wc, script) {
      if (script === 'READ') return reads.length ? reads.shift() : null;
      throw new Error('unexpected');
    },
    clickAt: function () {},
    drag: async function () { return { ok: true, durationMs: 1 }; },
    onDegrade: function () {},
    readScript: function () { return 'READ'; },
    extractScript: function () { return 'EXTRACT'; },
  });
  assert.strictEqual(captcha.isEnabled(), true);
  captcha.setEnabled(false);
  assert.strictEqual(captcha.getConfig().enabled, false);
  captcha.setEnabled(true);

  const wc = { events: [], sendInputEvent() { this.events.push(1); }, executeJavaScript: async () => null };
  captcha.attach('accX', { webContents: wc });
  await new Promise(function (r) { setTimeout(r, 30); });
  captcha.detach('accX');
  assert.strictEqual(captcha.getState('accX'), null);
});
