// tests/verify-packaged.js - 打包产物全链路验证（修复回归测试）
// 用法: node tests/verify-packaged.js [unpackedDir]
// 验证: 1) app.asar 不含 mihomo/tampermonkey 冗余副本
//       2) extraResources 解包副本存在
//       3) 模拟打包后环境（__dirname=app.asar/lib, resourcesPath）spawn mihomo 真实启动成功
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const cwd = process.cwd();
const unpacked = path.resolve(process.argv[2] || path.join(cwd, 'dist', 'win-unpacked'));

function loadWithFakeDirname(entry, fakeDirname) {
  const code = fs.readFileSync(entry, 'utf8');
  const m = new Module(entry, null);
  m.filename = entry;
  m.paths = Module._nodeModulePaths(path.dirname(entry));
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', code);
  fn(m, m.exports, m.require.bind(m), entry, fakeDirname);
  return m.exports;
}

(async () => {
  let fail = false;
  // 1) asar 检查
  const asarPath = path.join(unpacked, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) { console.log('FAIL: app.asar 不存在 ' + asarPath); process.exit(1); }
  const asarSizeMB = (fs.statSync(asarPath).size / 1048576).toFixed(1);
  let listOut = '';
  try {
    listOut = execFileSync('npx', ['asar', 'list', asarPath], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000 });
  } catch (e) {
    console.log('WARN: asar list 失败（不影响其余验证）: ' + String(e.message).slice(0, 200));
  }
  console.log('app.asar size : ' + asarSizeMB + ' MB');
  const hasMihomo = listOut.includes('mihomo');
  const hasTm = listOut.includes('tampermonkey');
  console.log('asar 含 mihomo       : ' + hasMihomo + (hasMihomo ? '  <-- FAIL' : '  ok'));
  console.log('asar 含 tampermonkey : ' + hasTm + (hasTm ? '  <-- FAIL' : '  ok'));
  if (hasMihomo || hasTm) fail = true;

  // 2) 解包副本
  const exeName = process.platform === 'win32' ? 'mihomo.exe' : 'mihomo';
  const unpackedMihomo = path.join(unpacked, 'resources', 'mihomo', exeName);
  console.log('解包副本存在: ' + fs.existsSync(unpackedMihomo) + '  (' + unpackedMihomo + ')');
  if (!fs.existsSync(unpackedMihomo)) fail = true;

  // 3) 模拟打包后环境全链路 spawn
  const gw = loadWithFakeDirname(
    path.join(cwd, 'lib', 'socks-gateway.js'),
    path.join(unpacked, 'resources', 'app.asar', 'lib')
  );
  const orig = process.resourcesPath;
  process.resourcesPath = path.join(unpacked, 'resources');
  try {
    const bin = gw.findMihomoBinary();
    console.log('findMihomoBinary  : ' + bin);
    if (!bin || bin.includes('app.asar') || path.resolve(bin) !== path.resolve(unpackedMihomo)) {
      console.log('FAIL: 路径解析不符合预期'); fail = true;
    } else {
      gw.__setPortProbeOverride(async () => false);
      const fakeNode = { id: 'verify-packaged', type: 'socks5', server: '127.0.0.1', port: 65534 };
      const t0 = Date.now();
      try {
        const alloc = await gw.allocate(fakeNode, {});
        console.log('mihomo spawn + 端口就绪: 127.0.0.1:' + alloc.port + ' 耗时 ' + (Date.now() - t0) + 'ms  ok');
        await gw.release(alloc.id);
      } catch (e2) {
        console.log('FAIL: mihomo spawn 失败: ' + e2.message); fail = true;
      }
      gw.__resetPortProbeOverride();
    }

    // 4) 模拟打包后环境验证 tampermonkey 扩展路径解析
    //    （win-setup 事故同源根因：lib/tampermonkey.js 打包态仍拼 __dirname 相对路径，
    //     指向 app.asar/resources/tampermonkey → 不存在 → tampermonkey_not_installed
    //     → tmId 未写 → 面板按钮报 tampermonkey_not_loaded）
    const tm = loadWithFakeDirname(
      path.join(cwd, 'lib', 'tampermonkey.js'),
      path.join(unpacked, 'resources', 'app.asar', 'lib')
    );
    const tmPath = tm.getDefaultExtPath();
    const expectedTm = path.join(unpacked, 'resources', 'tampermonkey');
    console.log('tampermonkey 路径 : ' + tmPath);
    if (!tmPath || tmPath.includes('app.asar') || path.resolve(tmPath) !== path.resolve(expectedTm)) {
      console.log('FAIL: tampermonkey 路径解析不符合预期（期望 ' + expectedTm + '）'); fail = true;
    } else if (!tm.isExtensionReady()) {
      console.log('FAIL: tampermonkey 解包副本 manifest 校验失败'); fail = true;
    } else {
      console.log('tampermonkey isExtensionReady: true  ok');
    }

    // 5) 打包副本校验油猴 shim 已注入（Electron 43 兼容层回归：
    //    缺 chrome.notifications/contextMenus/cookies 等 API 会让 VM/TM 后台初始化
    //    崩溃 → options 页 "cannot connect to the background page."）
    try {
      const pkgManifest = JSON.parse(fs.readFileSync(path.join(unpacked, 'resources', 'tampermonkey', 'manifest.json'), 'utf8'));
      const scripts = (pkgManifest.background && Array.isArray(pkgManifest.background.scripts)) ? pkgManifest.background.scripts : [];
      console.log('打包 background.scripts : ' + JSON.stringify(scripts));
      const shimExists = fs.existsSync(path.join(unpacked, 'resources', 'tampermonkey', 'background', 'mwi-shim.js'));
      if (!shimExists || scripts[0] !== 'background/mwi-shim.js') {
        console.log('FAIL: 打包副本缺少 mwi-shim.js 注入（background.scripts[0] 应为 background/mwi-shim.js）'); fail = true;
      } else {
        console.log('tampermonkey shim 注入: ok');
      }
    } catch (e) {
      console.log('FAIL: 打包副本 tampermonkey manifest 校验失败: ' + e.message); fail = true;
    }
  } finally {
    process.resourcesPath = orig;
  }
  console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(fail ? 1 : 0);
})();
