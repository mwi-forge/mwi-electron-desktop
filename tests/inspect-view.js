const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const chromePage = pages.find(p => p.url().includes('index.html'));
  const gamePage = pages.find(p => p.url().includes('milkywayidle'));
  console.log('chromePage:', chromePage ? chromePage.url() : 'none');
  console.log('gamePage:', gamePage ? gamePage.url() : 'none');

  if (chromePage) {
    // 从 chrome UI 角度看 view 状态
    const viewInfo = await chromePage.evaluate(() => {
      // 找中央 tab 内容区
      const canvas = document.getElementById('canvas');
      const formMount = document.getElementById('canvas-form-mount');
      const placeholder = document.querySelector('.canvas__placeholder');
      return {
        canvasDisplay: canvas ? getComputedStyle(canvas).display : 'n/a',
        canvasChildren: canvas ? canvas.children.length : 0,
        canvasInnerHTML: canvas ? canvas.innerHTML.slice(0, 300) : 'n/a',
        placeholderDisplay: placeholder ? getComputedStyle(placeholder).display : 'n/a',
        formMountHidden: formMount ? formMount.hidden : 'n/a',
        focusedAccountId: window.mwiStore.get().focusedAccountId,
        runningIds: window.mwiStore.get().runningIds,
      };
    });
    console.log('chrome UI view info:', JSON.stringify(viewInfo, null, 2));
  }

  if (gamePage) {
    const gameInfo = await gamePage.evaluate(() => ({
      title: document.title,
      url: location.href,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      readyState: document.readyState,
    }));
    console.log('game page info:', JSON.stringify(gameInfo, null, 2));
  }

  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error(e.message); console.error(e.stack); process.exit(1); });
