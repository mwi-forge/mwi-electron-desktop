// tests/verify-idle-autostop-gui.js - GUI 端到端验证 idle-auto-stop（per openspec spec.md Requirement）
// 流程：spawn electron + remote-debugging-port=9222 → puppeteer connect → 改 setIdleConfig 1 分钟 → 启动账号 → 等 60s → 检查 view 列表
// 运行：node tests/verify-idle-autostop-gui.js
const { spawn } = require('child_process');
const path = require('path');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CWD = process.cwd();
const ELECTRON_BIN = process.platform === 'win32' ? path.join(CWD, 'node_modules', 'electron', 'dist', 'electron.exe') : path.join(CWD, 'node_modules', '.bin', 'electron');

let electronProc = null;
function startElectron() {
  return new Promise(function (resolve, reject) {
    electronProc = spawn(ELECTRON_BIN, ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1', '.'], {
      cwd: CWD,
      env: Object.assign({}, process.env, { MWI_DEV: '1', ELECTRON_ENABLE_REMOTE_DEBUGGING: '1',  }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    let stderrBuf = '';
    electronProc.stderr.on('data', function (d) { stderrBuf += d.toString(); });
    electronProc.stdout.on('data', function () {});
    electronProc.on('error', function (e) { reject(e); });
    // poll 9222 端口
    const http = require('http');
    const tryConnect = function (n) {
      if (n > 60) return reject(new Error('electron start timeout'));
      const req = http.get('http://127.0.0.1:9222/json/version', function (res) {
        resolve();
        res.resume();
      });
      req.on('error', function () { setTimeout(function () { tryConnect(n + 1); }, 500); });
      req.setTimeout(2000, function () { req.destroy(); setTimeout(function () { tryConnect(n + 1); }, 500); });
    };
    setTimeout(function () { tryConnect(1); }, 1000);
  });
}

function stopElectron() {
  if (electronProc) {
    try { electronProc.kill('SIGTERM'); } catch (e) {}
    setTimeout(function () { try { electronProc.kill('SIGKILL'); } catch (e) {} }, 2000);
  }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  let fail = false;
  console.log('1. 启动 Electron 主进程 + remote-debugging-port=9222');
  try {
    await startElectron();
    console.log('   OK: Electron 已就绪');
  } catch (e) {
    console.log('   FAIL: ' + e.message);
    stopElectron();
    process.exit(1);
  }

  console.log('2. puppeteer connect 9222');
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    console.log('   OK: connected');
  } catch (e) {
    console.log('   FAIL: ' + e.message);
    stopElectron();
    process.exit(1);
  }

  const pages = await browser.pages();
  const page = pages.find(function (p) { return p.url().includes('index.html'); }) || pages[0];
  if (!page) {
    console.log('   FAIL: 找不到 index.html page');
    stopElectron();
    process.exit(1);
  }
  console.log('   page url=' + page.url());

  // 等主窗口初始化
  await sleep(3000);

  console.log('3. 先重置默认值为 300000 再测');
  await page.evaluate(function () { return window.api.views.setIdleConfig({ timeoutMs: 300000 }); });
  await sleep(200);
  console.log('4. 验证 getIdleConfig 默认值');
  const cfg1 = await page.evaluate(function () {
    return window.api.views.getIdleConfig();
  });
  console.log('   getIdleConfig = ' + JSON.stringify(cfg1));
  if (!cfg1 || cfg1.timeoutMs !== 300000) {
    console.log('   FAIL: 期望 timeoutMs=300000');
    fail = true;
  } else {
    console.log('   OK');
  }

  console.log('5. setIdleConfig timeoutMs=60000（1 分钟）');
  const cfg2 = await page.evaluate(function () {
    return window.api.views.setIdleConfig({ timeoutMs: 60000 });
  });
  console.log('   setIdleConfig = ' + JSON.stringify(cfg2));
  if (!cfg2 || !cfg2.ok || cfg2.timeoutMs !== 60000) {
    console.log('   FAIL: 期望 timeoutMs=60000');
    fail = true;
  } else {
    console.log('   OK');
  }

  console.log('5. 验证 setIdleConfig 非法值抛 Error');
  const cfg3 = await page.evaluate(async function () {
    try {
      var ret = await window.api.views.setIdleConfig({ timeoutMs: -1 }); return { threw: false, ret: ret }; }
    catch (e) { return { threw: true, msg: e.message }; }
  });
  console.log('   非法值返回: ' + JSON.stringify(cfg3));
  if (!cfg3.threw) {
    console.log('   FAIL: 期望抛 Error');
    fail = true;
  } else {
    console.log('   OK');
  }

  console.log('7. 验证 setIdleConfig timeoutMs=0（关闭功能）');
  const cfg4 = await page.evaluate(function () {
    return window.api.views.setIdleConfig({ timeoutMs: 0 });
  });
  console.log('   setIdleConfig(0) = ' + JSON.stringify(cfg4));
  if (!cfg4 || !cfg4.ok || cfg4.timeoutMs !== 0 || cfg4.enabled !== false) {
    console.log('   FAIL: 期望 enabled=false');
    fail = true;
  } else {
    console.log('   OK');
  }

  console.log('8. 截图 settings tab idleAutoStop fieldset');
  // 打开 settings tab 截图
  await page.evaluate(function () {
    if (window.mwiSettings && window.mwiSettings.open) {
      window.mwiSettings.open();
    }
  });
  await sleep(800);
  try {
    const ssDir = path.join(CWD, 'tests', 'screenshots');
    if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
    await page.screenshot({ path: path.join(ssDir, 'idle-autostop-settings.png') });
    console.log('   截图已保存: tests/screenshots/idle-autostop-settings.png');
  } catch (e) {
    console.log('   WARN: 截图失败: ' + e.message);
  }

  console.log('9. 端到端：timeoutMs=3000 启动账号 → 等 5s → 检查 view 列表');
  // 先确保没有 running view
  var initialRunning = await page.evaluate(function () { return window.api.views.listRunning(); });
  console.log('   initial running count: ' + initialRunning.length);
  // 设置 3 秒超时
  await page.evaluate(function () { return window.api.views.setIdleConfig({ timeoutMs: 3000 }); });
  await sleep(200);
  // 创建一个 about:blank 测试账号（通过 accounts.create IPC）
  var created = await page.evaluate(async function () {
    var acc = await window.api.accounts.create({ name: 'idle-test', url: 'about:blank', groupId: 'grp_default' });
    return acc;
  });
  console.log('   创建账号: ' + JSON.stringify(created));
  if (!created || !created.id) {
    console.log('   FAIL: 账号创建失败');
    fail = true;
  } else {
    // 启动账号
    var startResult = await page.evaluate(async function (id) { return await window.api.views.start(id); }, created.id);
    console.log('   startView: ' + JSON.stringify(startResult));
    // 等 1.5 秒（看倒计时显示）
    await sleep(1500);
    // 截图：倒计时显示中
    try {
      var ssDir = path.join(CWD, 'tests', 'screenshots');
      if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
      await page.screenshot({ path: path.join(ssDir, 'idle-autostop-countdown.png') });
      console.log('   截图已保存: tests/screenshots/idle-autostop-countdown.png');
    } catch (e) {
      console.log('   WARN: 截图失败: ' + e.message);
    }
    // 看 statusbar 倒计时文本
    var countdownText = await page.evaluate(function () {
      var el = document.getElementById('stat-idle-countdown');
      if (!el) {
        return {
          error: 'no element',
          bodyHas: document.body.innerHTML.indexOf('stat-idle-countdown') >= 0,
          allIds: Array.prototype.slice.call(document.querySelectorAll('[id]')).map(function (e) { return e.id; }).filter(function (i) { return i.indexOf('stat-') === 0; })
        };
      }
      return { text: el.textContent, hidden: el.classList.contains('statusbar__item--hidden'), classes: el.className };
    });
    console.log('   statusbar idle countdown: ' + JSON.stringify(countdownText));
    // 模拟活动：focus view 触发 resetActivity（focusView 调 resetActivity 是 spec.md Requirement 2 的实现）
    var beforeReset = countdownText.text;
    await page.evaluate(async function (id) {
      await window.api.views.focus(id);
    }, created.id);
    await sleep(1100);  // 等 1.1 秒让 countdown ticker (setInterval 1s) 跑一次
    var afterReset = await page.evaluate(function () {
      var el = document.getElementById('stat-idle-countdown');
      return el ? el.textContent : 'no element';
    });
    console.log('   模拟活动（focusView）后倒计时: ' + afterReset + '（之前: ' + beforeReset + '）');
    // 抓 main process log buffer 看 resetActivity 是否被调
    await sleep(500);  // 等 500ms 确保 IPC 回来
    var logs = await page.evaluate(async function (accId) {
      return await window.api.logs.list(accId, 50);
    }, created.id);
    console.log('   main process logs for ' + created.id + ' (last 10):');
    for (var li = Math.max(0, logs.length - 10); li < logs.length; li++) {
      console.log('     ' + new Date(logs[li].timestamp).toISOString() + ' [' + logs[li].level + '] ' + logs[li].message);
    }
    // 再等 3.5 秒（3 秒超时 + 0.5s 缓冲）
    await sleep(3500);
    // 检查 view 列表
    var finalRunning = await page.evaluate(function () { return window.api.views.listRunning(); });
    console.log('   final running count: ' + finalRunning.length + ' (' + JSON.stringify(finalRunning) + ')');
    var stoppedByIdle = !finalRunning.includes(created.id);
    if (stoppedByIdle) {
      console.log('   OK: view 已自动停止');
      // 检查 tabbar 状态：tabbar 的 localStates[id] 应该是 'stopped:idle_timeout'，runningIds 不应包含 id
      var tabbarState = await page.evaluate(function (accId) {
        var s = window.mwiStore.get();
        var inRunning = (s.runningIds || []).indexOf(accId) >= 0;
        return { runningIds: s.runningIds, viewStates: s.viewStates, inRunning: inRunning };
      }, created.id);
      console.log('   tabbar state: ' + JSON.stringify(tabbarState));
      var viewState = tabbarState.viewStates && tabbarState.viewStates[created.id];
      if (viewState === 'stopped:idle_timeout') {
        console.log('   OK: viewStates[' + created.id + '] = stopped:idle_timeout');
      } else {
        console.log('   FAIL: viewStates = ' + viewState + ' (期望 stopped:idle_timeout)');
        fail = true;
      }
      if (tabbarState.inRunning) {
        console.log('   FAIL: runningIds 仍包含 ' + created.id + ' (tab 不会消失)');
        fail = true;
      } else {
        console.log('   OK: runningIds 已移除 ' + created.id);
      }
      // 截图 idle 停止后的状态
      try {
        var ssDir = path.join(CWD, 'tests', 'screenshots');
        if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
        await page.screenshot({ path: path.join(ssDir, 'idle-autostop-after-stop.png') });
        console.log('   截图已保存: tests/screenshots/idle-autostop-after-stop.png');
      } catch (e) {
        console.log('   WARN: 截图失败: ' + e.message);
      }
    } else {
      console.log('   FAIL: view 未自动停止');
      fail = true;
    }
    // 清理：删除测试账号
    await page.evaluate(async function (id) { return await window.api.accounts.remove(id); }, created.id);
  }
  // 恢复默认超时
  await page.evaluate(function () { return window.api.views.setIdleConfig({ timeoutMs: 300000 }); });

  console.log('10. dump idle fieldset DOM 结构');
  await page.evaluate(function () { if (window.mwiSettings) window.mwiSettings.open(); });
  await sleep(800);
  var domInfo = await page.evaluate(function () {
    var fs = document.querySelector('.settings-tab__idle-fieldset');
    if (!fs) return 'no fieldset';
    function dump(el, depth) {
      depth = depth || 0;
      var pad = '  '.repeat(depth);
      var cs = window.getComputedStyle(el);
      var s = pad + el.tagName + (el.className ? '.' + el.className : '') + ' display=' + cs.display;
      if (el.id) s += ' id=' + el.id;
      if (el.type) s += ' type=' + el.type;
      if (el.value != null && el.value !== '') s += ' value=' + el.value;
      if (el.textContent && el.children.length === 0) s += ' text=' + JSON.stringify(el.textContent.trim().substring(0, 30));
      return s;
    }
    function walk(el, depth, lines) {
      depth = depth || 0;
      lines = lines || [];
      lines.push(dump(el, depth));
      for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1, lines);
      return lines;
    }
    return walk(fs).join('\n');
  });
  console.log(domInfo);
  var rects = await page.evaluate(function () {
    var fs = document.querySelector('.settings-tab__idle-fieldset');
    if (!fs) return 'no fieldset';
    var sels = ['.settings-tab__idle-input-row', '.settings-tab__toggle-row', '.settings-tab__minutes-row', '#settings-idle-enabled', '.settings-tab__toggle-row span', '#settings-idle-minutes', '#settings-idle-minutes-slider'];
    var lines = [];
    sels.forEach(function (s) {
      var el = fs.querySelector(s);
      if (el) {
        var r = el.getBoundingClientRect();
        var cs = window.getComputedStyle(el);
        lines.push(s + ' rect=' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' display=' + cs.display + ' flex-dir=' + cs.flexDirection);
      } else { lines.push(s + ' NOT_FOUND'); }
    });
    return lines.join('\n');
  });
  console.log('Rects:');
  console.log(rects);

  console.log('========== GUI 验证结果 ==========');
  console.log(fail ? 'FAIL' : 'PASS');
  await browser.disconnect();
  stopElectron();
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('UNCAUGHT:', e.message, e.stack);
  stopElectron();
  process.exit(1);
});









