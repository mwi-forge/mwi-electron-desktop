'use strict';
// tests/fp-e2e-min.js - 指纹注入 e2e 回归（独立 electron 脚本）
// 用法：node_modules\electron\dist\electron.exe tests/fp-e2e-min.js
// 覆盖：生产 fp-preload.js 注入在页面脚本执行前生效 + webContents.setUserAgent 对已存在
// webContents 生效（session.setUserAgent 文档语义不覆盖已存在 WebContents，线上曾因此漏 UA）。
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const LOG = path.join(__dirname, '_e2e-log.txt');
fs.writeFileSync(LOG, '');
const t0 = Date.now();
const log = (s) => { fs.appendFileSync(LOG, '[' + (Date.now() - t0) + 'ms] ' + s + '\n'); };
process.on('uncaughtException', (e) => { log('UNCAUGHT: ' + (e && e.stack || e)); app.exit(2); });
process.on('unhandledRejection', (e) => { log('UNHANDLED: ' + (e && e.stack || e)); });
setTimeout(() => { log('TIMEOUT: force exit'); app.exit(3); }, 30000);
const watchdog = (name, p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('watchdog timeout: ' + name)), ms))]);

async function main() {
  const fails = [];
  const ok = (name, cond) => { log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails.push(name); };
  const fp = require('../lib/fingerprint');
  const profile = fp.buildFingerprint({ id: 'fp-e2e-min' });
  const b64 = Buffer.from(JSON.stringify(profile)).toString('base64');
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
      preload: path.join(__dirname, '..', 'fp-preload.js'),
      additionalArguments: ['--mwi-fp-profile=' + b64],
    },
  });
  // 与生产 views.js 同构：webContents 已存在后设置 UA（session 调用此处省略，聚焦 webContents 通道）
  win.webContents.setUserAgent(profile.ua);

  const html = '<!doctype html><html><head></head><body><script>' +
    'window.__early = {' +
    ' mwiFp: window.__MWI_FP__ ? window.__MWI_FP__.v : null,' +
    ' ua: navigator.userAgent,' +
    ' appVersion: navigator.appVersion,' +
    ' hc: navigator.hardwareConcurrency,' +
    ' dm: navigator.deviceMemory,' +
    ' appName: navigator.appName,' +
    ' posture: navigator.devicePosture ? String(navigator.devicePosture.type) : "absent",' +
    ' uaDataPresent: !!navigator.userAgentData,' +
    ' brands: navigator.userAgentData ? navigator.userAgentData.brands.map(function(b){return b.brand+"@"+b.version;}).join(",") : null,' +
    ' getBatteryType: typeof navigator.getBattery,' +
    ' plugs: [].slice.call(navigator.plugins).map(function(p){return p.name;}).join(","),' +
    ' languages: navigator.languages.join(","),' +
    '};' +
    '</script></body></html>';
  await watchdog('loadURL(data)', win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64')), 8000);
  const early = await watchdog('read early', win.webContents.executeJavaScript('window.__early'), 8000);
  log('early json: ' + JSON.stringify(early));

  ok('spoof 脚本已在主世界运行（__MWI_FP__ == 1）', early.mwiFp === 1);
  ok('webContents.userAgent == 快照 UA（网络级）', win.webContents.userAgent === profile.ua);
  ok('navigator.userAgent == 快照 UA（页面级）', early.ua === profile.ua);
  ok('appVersion 与 UA 一致（快照 getter）', early.appVersion === profile.navigator.appVersion);
  ok('hc == profile(' + profile.hardwareConcurrency + ')', early.hc === profile.hardwareConcurrency);
  ok('deviceMemory undefined', early.dm === undefined);
  ok('appName Netscape', early.appName === 'Netscape');
  ok('devicePosture absent', early.posture === 'absent');
  ok('userAgentData brands == profile', early.uaDataPresent === true && early.brands === profile.userAgentData.brands.map(function (b) { return b.brand + '@' + b.version; }).join(','));
  ok('getBattery 已覆盖', early.getBatteryType === 'function');
  ok('plugins == snapshot 3 项', early.plugs === profile.navigator.plugins.map(function (p) { return p.name; }).join(','));
  ok('languages == profile', early.languages === profile.languages.join(','));
  log('SUMMARY: ' + (fails.length ? fails.length + ' FAIL' : 'ALL PASS'));
  app.exit(fails.length ? 1 : 0);
}
app.whenReady().then(() => { main().catch((e) => { log('MAIN ERROR: ' + (e && e.stack || e)); app.exit(4); }); });
