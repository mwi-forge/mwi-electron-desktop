// fp-preload.js - 游戏 WebContentsView 的指纹预注入 preload（snapshot 单一事实源）
// 通道：主进程 views.js 在创建 view 时把每账号 profile 经 webPreferences.additionalArguments
// 传入（--mwi-fp-profile=<base64 json>）；本 preload 在文档创建时、页面脚本执行之前运行，
// 用 webFrame.executeJavaScript 把完整 spoof bundle 注入主世界。
// 为什么不用 did-start-navigation 的 executeJavaScript：它落在旧文档 realm（首次导航为
// about:blank），新页面主世界读不到；为什么不用 CDP Page.addScriptToEvaluateOnNewDocument：
// Electron 43 实测注册后跨导航不生效（连标记脚本都不执行）。preload 通道是 Electron
// 一等公民机制，且保持 contextIsolation=true（页面脚本无法触碰本 preload 的 Node 能力）。
'use strict';

const { webFrame } = require('electron');

try {
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.indexOf('--mwi-fp-profile=') === 0);
  if (!arg) {
    console.warn('[fp-preload] no --mwi-fp-profile argument, skip spoof');
  } else {
    const b64 = arg.slice('--mwi-fp-profile='.length);
    const profile = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const fp = require('./lib/fingerprint');
    const script = fp.generateFullInjectScript(profile);
    // 主世界执行；幂等（window.__MWI_FP__.v 守卫），reload 后再次注入无害
    webFrame.executeJavaScript(script).catch(function (e) {
      console.warn('[fp-preload] inject failed: ' + (e && e.message));
    });
  }
} catch (e) {
  console.warn('[fp-preload] error: ' + (e && e.message));
}
