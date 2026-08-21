const puppeteer = require('puppeteer-core');
(async () => {
  // 等 3s 让 electron 启动 + view 开始加载
  await new Promise(r => setTimeout(r, 3500));
  let browser;
  for (let i = 0; i < 10; i++) {
    try {
      browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
      break;
    } catch (e) {
      console.log('retry connect', i);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  if (!browser) { console.error('cannot connect'); process.exit(1); }
  const pages = await browser.pages();
  console.log('pages:', pages.map(p => p.url().slice(0, 50)));
  const gamePage = pages.find(p => p.url().includes('milkywayidle'));
  if (gamePage) {
    // 截启动时的状态（loading 还在）
    await gamePage.screenshot({ path: 'tests/screenshots/during-load.png' });
    console.log('📸 during-load.png');
  }
  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
