// scripts/patch-tampermonkey-shim.js - 幂等补丁：为内置油猴扩展注入 Electron 兼容 shim
// 用法: node scripts/patch-tampermonkey-shim.js
//
// 场景：resources/tampermonkey 被手动更新（重新解压 Violentmonkey / Tampermonkey）后，
//       manifest.json 的 background.scripts 会丢失 mwi-shim.js 入口，导致后台初始化
//       崩溃（Electron 43 缺 chrome.notifications / contextMenus / cookies / downloads /
//       commands），options 页报 "Violentmonkey cannot connect to the background page."。
//       更新扩展后重跑本脚本即可恢复。
const fs = require('fs');
const path = require('path');

const EXT_DIR = path.join(__dirname, '..', 'resources', 'tampermonkey');
const SHIM_FILE = 'background/mwi-shim.js';
const BG_SCRIPT = 'background/index.js';

function main() {
  const manifestPath = path.join(EXT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('FAIL: manifest.json 不存在: ' + manifestPath);
    process.exit(1);
  }
  const shimPath = path.join(EXT_DIR, SHIM_FILE);
  if (!fs.existsSync(shimPath)) {
    console.error('FAIL: shim 文件缺失: ' + shimPath);
    console.error('      请确认 resources/tampermonkey/background/mwi-shim.js 存在（随仓库提供，勿删）。');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error('FAIL: manifest.json 解析失败: ' + e.message);
    process.exit(1);
  }

  const bg = manifest.background;
  const scripts = (bg && Array.isArray(bg.scripts)) ? bg.scripts.slice() : [];
  let changed = false;

  const idx = scripts.indexOf(SHIM_FILE);
  if (idx === -1) {
    scripts.unshift(SHIM_FILE);
    changed = true;
  } else if (idx !== 0) {
    scripts.splice(idx, 1);
    scripts.unshift(SHIM_FILE);
    changed = true;
  }
  if (!scripts.includes(BG_SCRIPT)) {
    scripts.push(BG_SCRIPT);
    changed = true;
  }

  if (changed) {
    if (!manifest.background) manifest.background = {};
    manifest.background.scripts = scripts;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('PATCHED: manifest.json background.scripts = ' + JSON.stringify(scripts));
    console.log('已生效；请重启应用后油猴后台即可正常初始化。');
  } else {
    console.log('OK: 已是补丁状态（background.scripts[0]=' + scripts[0] + '），无需改动。');
  }
}

main();
