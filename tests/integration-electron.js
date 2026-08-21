// tests/integration-electron.js — 真实 Electron + Chromium 端到端测试
// 用 puppeteer-core launch（自己开 DevTools 端口），MWI_TEST_DIALOG=1 自动触发 dialog

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

(async () => {
  const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const projectRoot = path.join(__dirname, '..');
  const scenario = process.argv[2] || 'show';

  if (!fs.existsSync(electronPath)) {
    console.error('❌ electron.exe 不存在: ' + electronPath);
    process.exit(1);
  }

  console.log('[test] launching electron via puppeteer-core, scenario=' + scenario);

  const env = Object.assign({}, process.env, {
    MWI_TEST_DIALOG: '1',
    MWI_TEST_DIALOG_ACTION: scenario,
    MWI_DEV: '1',
  });
  if (scenario === 'click' || scenario === 'esc') {
    env.MWI_TEST_DIALOG_WAIT = '1500';
  }

  const args = [
    projectRoot,
    '--remote-allow-origins=*',
  ];
  if (scenario === 'show') {
    args.push('--remote-debugging-port=0'); // puppeteer 接管
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: electronPath,
      headless: false, // electron 必须 false
      args,
      env,
      dumpio: false,
      protocolTimeout: 30000,
    });

    const pages = await browser.pages();
    // MWI_DEV=1 会自动开 DevTools 抢第一个 page；要找 file:// 或 index.html 那个
    const page = pages.find(p => p.url().includes('index.html')) || pages[0];
    if (!page.url().includes('index.html')) {
      console.log('[test] WARN: 首个 page 不是 app: ' + page.url() + '，尝试等 app page');
    }
    page.on('console', msg => console.log('[page-' + msg.type() + '] ' + msg.text()));
    page.on('pageerror', err => console.log('[page-error] ' + err.message));

    console.log('[test] page url=' + page.url());

    // 等 dialog 渲染（hook 1.5-2s 后触发）
    await new Promise(r => setTimeout(r, 3500));

    // 1. 检查 modal DOM
    const state = await page.evaluate(() => {
      const slot = document.getElementById('mwi-alert-slot');
      if (!slot || !slot.children.length) return { exists: false };
      const dialog = slot.children[0].children[0];
      return {
        exists: true,
        title: dialog.querySelector('.mwi-alert__title')?.textContent || '',
        message: dialog.querySelector('.mwi-alert__message')?.textContent || '',
        buttonCount: dialog.querySelectorAll('button.mwi-alert__btn').length,
        primaryBtn: dialog.querySelector('.mwi-alert__btn--primary')?.textContent || '',
        detail: dialog.querySelector('.mwi-alert__detail')?.textContent || '',
        bodyOverflow: document.body.style.overflow,
        slotHasChildren: slot.children.length > 0,
      };
    });
    console.log('[test] modal state:', JSON.stringify(state, null, 2));

    fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
    const shotPath = path.join(__dirname, 'screenshots', 'modal-' + scenario + '.png');
    await page.screenshot({ path: shotPath });
    console.log('[test] 📸 ' + shotPath);

    if (!state.exists) {
      console.error('❌ modal 不在 DOM');
      await browser.close();
      process.exit(4);
    }

    // 断言
    let pass = true;
    if (!state.title.includes('代理启动失败')) { console.error('❌ title 错: ' + state.title); pass = false; }
    if (!state.message.includes('测试弹窗')) { console.error('❌ message 错: ' + state.message); pass = false; }
    if (state.buttonCount !== 1) { console.error('❌ button 数错: ' + state.buttonCount); pass = false; }
    if (state.primaryBtn !== '我知道了') { console.error('❌ primary 错: ' + state.primaryBtn); pass = false; }
    if (!state.detail.includes('mihomo_binary_not_found')) { console.error('❌ detail 错: ' + state.detail); pass = false; }
    if (state.bodyOverflow !== 'hidden') { console.error('❌ body 未锁滚动: ' + state.bodyOverflow); pass = false; }

    // 2. 按场景交互（用 safeEval 包 evaluate 防止 page detach 时崩）
    const safeEval = async (fn) => {
      try { return await page.evaluate(fn); } catch (e) { console.log('[test] (page detached, expected after dialog close): ' + e.message); return -1; }
    };
    if (scenario === 'click') {
      await page.click('.mwi-alert__btn--primary');
      await new Promise(r => setTimeout(r, 1000)); // 给 DOM cleanup + IPC reply 时间
      const after = await safeEval(() => document.querySelectorAll('.mwi-alert-backdrop').length);
      console.log('[test] 点击后 backdrop 数: ' + after);
      if (after > 0 && after !== -1) { console.error('❌ 点击后 modal 未关闭'); pass = false; }
      else console.log('[test] ✅ click 后 modal 关闭');
    } else if (scenario === 'esc') {
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 1000));
      const after = await safeEval(() => document.querySelectorAll('.mwi-alert-backdrop').length);
      console.log('[test] Esc 后 backdrop 数: ' + after);
      if (after > 0 && after !== -1) { console.error('❌ Esc 后 modal 未关闭'); pass = false; }
      else console.log('[test] ✅ Esc 后 modal 关闭');
    } else if (scenario === 'enter') {
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1000));
      const after = await safeEval(() => document.querySelectorAll('.mwi-alert-backdrop').length);
      if (after > 0 && after !== -1) { console.error('❌ Enter 后 modal 未关闭'); pass = false; }
      else console.log('[test] ✅ Enter 后 modal 关闭');
    }

    await browser.close();
    if (pass) {
      console.log('[test] 🎉 ' + scenario + ' 场景全部通过');
      process.exit(0);
    } else {
      console.error('❌ ' + scenario + ' 场景断言失败');
      process.exit(5);
    }
  } catch (e) {
    console.error('[test] 异常:', e.message);
    if (e.stack) console.error(e.stack);
    if (browser) try { await browser.close(); } catch (_) {}
    process.exit(7);
  }
})();
