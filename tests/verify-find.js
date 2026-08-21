// tests/verify-find.js - 验证 findMihomoBinary 在 dev / 打包后两种环境的路径解析
// 用法：
//   node tests/verify-find.js              # dev 布局验证（项目根 resources/mihomo）
//   node tests/verify-find.js --packaged <unpacked-dir>   # 模拟打包后布局（dist/win-unpacked）
// 打包后模拟：__dirname 指到 <unpacked>/resources/app.asar/lib，process.resourcesPath = <unpacked>/resources
const fs = require('fs');
const path = require('path');
const Module = require('module');

function loadWithFakeDirname(entry, fakeDirname) {
  const code = fs.readFileSync(entry, 'utf8');
  const m = new Module(entry, null);
  m.filename = entry;
  m.paths = Module._nodeModulePaths(path.dirname(entry));
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', code);
  fn(m, m.exports, m.require.bind(m), entry, fakeDirname);
  return m.exports;
}

const args = process.argv.slice(2);
const packagedIdx = args.indexOf('--packaged');
const libEntry = path.join(process.cwd(), 'lib', 'socks-gateway.js');
const origResourcesPath = process.resourcesPath;
let found;
if (packagedIdx >= 0) {
  const unpacked = path.resolve(args[packagedIdx + 1] || 'dist/win-unpacked');
  const fakeDirname = path.join(unpacked, 'resources', 'app.asar', 'lib');
  const fakeResourcesPath = path.join(unpacked, 'resources');
  const gw = loadWithFakeDirname(libEntry, fakeDirname);
  process.resourcesPath = fakeResourcesPath;
  try { found = gw.findMihomoBinary(); } finally { process.resourcesPath = origResourcesPath; }
  console.log('mode: packaged (simulated)');
  console.log('fake __dirname      :', fakeDirname);
  console.log('fake resourcesPath  :', fakeResourcesPath);
  console.log('found               :', found);
  if (!found) { console.log('FAIL: 未找到解包副本'); process.exit(1); }
  if (found.includes('app.asar')) { console.log('FAIL: 命中了 asar 内副本'); process.exit(1); }
  const expected = path.join(unpacked, 'resources', 'mihomo', process.platform === 'win32' ? 'mihomo.exe' : 'mihomo');
  if (path.resolve(found) !== expected) { console.log('FAIL: 期望 ' + expected); process.exit(1); }
  console.log('PASS: 命中 extraResources 解包副本，未落入 asar');
} else {
  const gw = loadWithFakeDirname(libEntry, path.join(process.cwd(), 'lib'));
  process.resourcesPath = '';
  try { found = gw.findMihomoBinary(); } finally { process.resourcesPath = origResourcesPath; }
  console.log('mode: dev');
  console.log('found:', found);
  if (!found) { console.log('FAIL: dev 布局未命中'); process.exit(1); }
  if (found.includes('app.asar')) { console.log('FAIL: 命中 asar'); process.exit(1); }
  console.log('PASS: dev 布局命中项目根 resources/mihomo');
}
