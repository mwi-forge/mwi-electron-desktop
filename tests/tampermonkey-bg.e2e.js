// tests/tampermonkey-bg.e2e.js - 油猴扩展后台连通性回归（Electron 直跑）
// 用法: node_modules/.bin/electron tests/tampermonkey-bg.e2e.js
//
// 回归背景：Electron 43 未实现 chrome.notifications / contextMenus / cookies /
//           downloads / commands，Violentmonkey 2.48 的 MV2 后台初始化早期
//           browser.notifications.onClicked.addListener 抛 TypeError → 后台脚本中断，
//           runtime.onMessage 监听永不注册 → options 页红字
//           "Violentmonkey cannot connect to the background page."。
//           修复 = background/mwi-shim.js + manifest background.scripts 注入。
//           本测试断言 shim 生效：后台完整初始化（handleCommandMessage 就位 +
//           onMessage 监听已注册），且 options → background 消息往返成功。
const { app, session, BrowserWindow, webContents } = require('electron');
const path = require('path');
const os = require('os');

const EXT = path.join(__dirname, '..', 'resources', 'tampermonkey');
const PARTITION = 'persist:tm_bg_test';

let failures = [];
let finishCalled = false;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (cond ? '' : '  [' + (detail || '') + ']'));
  if (!cond) failures.push(name);
}

function evalIn(wc, code) {
  return Promise.race([
    wc.executeJavaScript(code).then((v) => String(v)).catch((e) => 'EXEC-ERR: ' + e.message),
    new Promise((r) => setTimeout(() => r('EXEC-TIMEOUT'), 8000)),
  ]);
}

app.setPath('userData', path.join(os.tmpdir(), 'mwi-tm-bg-' + Date.now()));

const hardExit = setTimeout(() => {
  console.log('FAIL - 整体超时 30s');
  process.exit(1);
}, 30000);

app.whenReady().then(async () => {
  let ext = null;
  try {
    ext = await session.fromPartition(PARTITION).loadExtension(EXT, { allowFileAccess: true });
  } catch (e) {
    check('loadExtension', false, e.message);
    return finish();
  }
  check('extension loaded', !!(ext && ext.id), JSON.stringify(ext && { id: ext.id }));

  const win = new BrowserWindow({
    width: 900, height: 700, show: false,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadURL('chrome-extension://' + ext.id + '/options/index.html').catch(() => { /* 页面可能不触发 finish-load，忽略 */ });

  const findBg = () => webContents.getAllWebContents().find((w) => w.getType() === 'backgroundPage');

  // 等后台页出现
  let bg = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    bg = findBg();
    if (bg) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  check('background page created', !!bg, '10s 内未出现 backgroundPage webContents');
  if (!bg) return finish();

  // 等后台完整初始化（shim 生效后 handleCommandMessage 为 function、onMessage 有监听）
  let initState = '';
  let initOk = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 12000) {
    initState = await evalIn(bg, [
      'JSON.stringify({',
      '  hcm: typeof window.handleCommandMessage,',
      '  onMsg: (chrome.runtime.onMessage.hasListeners ? chrome.runtime.onMessage.hasListeners() : false),',
      '})',
    ].join('\n'));
    try {
      const st = JSON.parse(initState);
      if (st.hcm === 'function' && st.onMsg === true) { initOk = true; break; }
    } catch (e) { /* 状态未就绪，继续轮询 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  check('background initialized (handleCommandMessage + onMessage listener)', initOk, initState);

  // options → background 消息往返（VM options 页实际使用的 GetData 命令）
  const ping = await evalIn(win.webContents, [
    'new Promise((resolve) => {',
    '  let done = false;',
    '  const fin = (v) => { if (!done) { done = true; resolve(v); } };',
    '  try {',
    '    chrome.runtime.sendMessage({ cmd: "GetData", data: { id: "", sizes: false } }, (resp) => {',
    '      fin("RESP:" + (resp === undefined ? "undefined" : JSON.stringify(resp).slice(0, 160)) + "|err:" + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "none"));',
    '    });',
    '  } catch (e) { fin("THROW:" + e.message); }',
    '  setTimeout(() => fin("TIMEOUT"), 6000);',
    '})',
  ].join('\n'));
  const pingOk = ping.indexOf('RESP:') === 0 && ping.indexOf('|err:none') !== -1;
  check('options -> background message round-trip', pingOk, ping);

  finish();
});

function finish() {
  if (finishCalled) { console.log('WARN - finish() 被重复调用'); return; }
  finishCalled = true;
  clearTimeout(hardExit);
  if (failures.length) {
    console.log('RESULT: FAIL (' + failures.join(' | ') + ')');
    process.exit(1);
  }
  console.log('RESULT: PASS');
  process.exit(0);
}
