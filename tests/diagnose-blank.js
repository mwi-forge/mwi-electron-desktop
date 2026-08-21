const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  console.log('Pages:');
  for (const p of pages) {
    console.log(' -', p.url(), '|', (await p.title()).slice(0, 50));
  }
  // 找 milkywayidle 的 page
  const gamePage = pages.find(p => p.url().includes('milkywayidle'));
  if (!gamePage) {
    console.log('No game page found');
    await browser.disconnect();
    process.exit(1);
  }
  console.log('\nGame page url:', gamePage.url());
  console.log('Title:', await gamePage.title());

  // 收集 console 和 pageerror
  const consoleLogs = [];
  gamePage.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text().slice(0, 200) }));
  gamePage.on('pageerror', err => consoleLogs.push({ type: 'pageerror', text: err.message.slice(0, 200) }));

  // 等 3s 让页面加载
  await new Promise(r => setTimeout(r, 3000));

  // 抓页面状态
  const info = await gamePage.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const body = document.body;
    const html = document.documentElement;
    return {
      readyState: document.readyState,
      title: document.title,
      url: location.href,
      hasCanvas: !!canvas,
      canvasSize: canvas ? { w: canvas.width, h: canvas.height, ow: canvas.offsetWidth, oh: canvas.offsetHeight } : null,
      bodyChildren: body.children.length,
      bodyHTMLLen: body.innerHTML.length,
      bodyBgColor: getComputedStyle(body).backgroundColor,
      htmlBgColor: getComputedStyle(html).backgroundColor,
      canvasCount: document.querySelectorAll('canvas').length,
      scripts: document.querySelectorAll('script').length,
      iframes: document.querySelectorAll('iframe').length,
    };
  });
  console.log('\nPage info:', JSON.stringify(info, null, 2));

  // console / error 日志
  console.log('\nConsole logs (' + consoleLogs.length + '):');
  consoleLogs.slice(0, 30).forEach(l => console.log('  [' + l.type + ']', l.text));

  // 截图保存
  await gamePage.screenshot({ path: 'tests/screenshots/blank-page.png' });
  console.log('\n📸 saved tests/screenshots/blank-page.png');

  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
