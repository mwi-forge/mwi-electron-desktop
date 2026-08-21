const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  // 用 Chrome DevTools Protocol 查 WebContentsView 实际尺寸
  const cdpSession = await browser.target().createCDPSession();
  const { targetInfos } = await cdpSession.send('Target.getTargets');
  console.log('Targets:');
  for (const t of targetInfos) {
    console.log('  -', t.type, '|', (t.url || '').slice(0, 60), '|', t.title);
  }

  // 直接截 BrowserWindow 主窗口
  const mainPage = pages.find(p => p.url().includes('index.html'));
  if (mainPage) {
    await mainPage.screenshot({ path: 'tests/screenshots/main-window.png' });
    console.log('📸 main-window.png');
  }
  const gamePage = pages.find(p => p.url().includes('milkywayidle'));
  if (gamePage) {
    await gamePage.screenshot({ path: 'tests/screenshots/game-only.png' });
    console.log('📸 game-only.png');
  }

  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
