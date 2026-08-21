const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  console.log('connected, url=' + page.url());

  await new Promise(r => setTimeout(r, 2500));

  const state = await page.evaluate(() => {
    const slot = document.getElementById('mwi-alert-slot');
    if (!slot || !slot.children.length) return { exists: false };
    const dialog = slot.children[0].children[0];
    return {
      exists: true,
      title: dialog.querySelector('.mwi-alert__title')?.textContent,
      message: dialog.querySelector('.mwi-alert__message')?.textContent,
      primaryBtn: dialog.querySelector('.mwi-alert__btn--primary')?.textContent,
      detailLen: dialog.querySelector('.mwi-alert__detail')?.textContent.length,
      backdropOpacity: getComputedStyle(slot.children[0]).opacity,
      bodyOverflow: document.body.style.overflow,
    };
  });
  console.log('state:', JSON.stringify(state, null, 2));

  await page.screenshot({ path: 'tests/screenshots/live-modal.png' });
  console.log('📸 saved: tests/screenshots/live-modal.png');

  await new Promise(r => setTimeout(r, 500));
  const opacity = await page.evaluate(() => {
    const el = document.querySelector('.mwi-alert-backdrop');
    return el ? getComputedStyle(el).opacity : null;
  });
  console.log('backdrop opacity after 500ms: ' + opacity);

  await browser.disconnect();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
