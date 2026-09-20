const puppeteer = require('puppeteer-core');
const http = require('http');

async function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(function (p) { return p.url().includes('index.html'); }) || pages[0];
  await sleep(2000);

  // 直接调 setIdleConfig(-1) 看返回
  const r = await page.evaluate(function () {
    try {
      var ret = window.api.views.setIdleConfig({ timeoutMs: -1 });
      return { type: 'no-throw', promise: !!ret && typeof ret.then === 'function', value: ret };
    } catch (e) {
      return { type: 'sync-throw', msg: e.message };
    }
  });
  console.log('sync call result:', JSON.stringify(r, null, 2));

  // 试 await
  const r2 = await page.evaluate(async function () {
    try {
      var ret = await window.api.views.setIdleConfig({ timeoutMs: -1 });
      return { type: 'no-throw', value: ret };
    } catch (e) {
      return { type: 'async-throw', msg: e.message };
    }
  });
  console.log('async call result:', JSON.stringify(r2, null, 2));

  await browser.disconnect();
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });