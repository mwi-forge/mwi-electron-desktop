const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  console.log('connected, url=' + page.url());

  // 等 dialog（hook 1.5s 后）
  await new Promise(r => setTimeout(r, 3000));

  const state = await page.evaluate(() => {
    const slot = document.getElementById('mwi-alert-slot');
    const titles = [];
    if (slot) {
      slot.querySelectorAll('.mwi-alert__title').forEach(t => titles.push(t.textContent));
    }
    return { titles };
  });
  console.log('state:', JSON.stringify(state, null, 2));

  // 看主进程 stdout/stderr 通过 electron 自带日志（不在 page 端）—— 已由 terminal 捕获

  await page.screenshot({ path: 'tests/screenshots/after-fix.png' });
  console.log('📸 saved tests/screenshots/after-fix.png');
  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
