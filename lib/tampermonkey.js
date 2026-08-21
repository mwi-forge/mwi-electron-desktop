// lib/tampermonkey.js - per-session 油猴扩展加载（含失败降级）
// 扩展目录：resources/tampermonkey/（含 manifest.json）
// 首次使用需用户手动从 Chrome 商店下载 Tampermonkey CRX 并解压

const path = require('path');
const fs = require('fs');

// 目录布局约定（与 socks-gateway.findMihomoBinary 同一套规则）：
// - dev：<项目根>/resources/tampermonkey（lib/../resources/tampermonkey）
// - 打包：files 里 !resources/tampermonkey/** 把扩展排除出 app.asar，
//   extraResources(to: "tampermonkey") 解包到 <resourcesPath>/tampermonkey
// 打包后 __dirname 位于 app.asar/lib，asar 内没有扩展副本；
// 只信任 process.resourcesPath 的解包副本，跳过 asar 内候选
// （历史坑：fs.existsSync 对 asar 内路径会误报 true，误导 loadExtension 失败）。
function resolveDefaultExtPath() {
  const inAsar = __dirname.includes('app.asar');
  const candidates = [];
  if (!inAsar) {
    candidates.push(path.join(__dirname, '..', 'resources', 'tampermonkey'));
  }
  candidates.push(path.join(process.resourcesPath || '', 'tampermonkey'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'manifest.json'))) return c;
    } catch (e) { /* ignore */ }
  }
  // 兜底：优先返回打包布局路径（安装后补扩展也能被找到）
  return candidates[0] || path.join(__dirname, '..', 'resources', 'tampermonkey');
}

const DEFAULT_EXT_PATH = resolveDefaultExtPath();

// 已加载扩展 ID 缓存（session -> extId），供面板跳转 chrome-extension:// URL 用
const extIdBySession = new WeakMap();

function getExtensionId(session) {
  return session ? extIdBySession.get(session) || null : null;
}

function isExtensionReady(extPath) {
  extPath = extPath || DEFAULT_EXT_PATH;
  try {
    var manifestPath = path.join(extPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return false;
    var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return !!(manifest.name && manifest.version);
  } catch (e) {
    return false;
  }
}

async function loadTampermonkeyForSession(session, extPath) {
  if (!session) return { ok: false, error: 'no_session' };
  extPath = extPath || DEFAULT_EXT_PATH;
  if (!isExtensionReady(extPath)) {
    return { ok: false, error: 'tampermonkey_not_installed', path: extPath };
  }
  try {
    // Electron 43 起 session.loadExtension 已弃用（运行时提示），迁移到 session.extensions.loadExtension；
    // 保留 session.loadExtension 兜底以兼容更早版本。
    var loader = (session.extensions && typeof session.extensions.loadExtension === 'function')
      ? session.extensions.loadExtension.bind(session.extensions)
      : session.loadExtension.bind(session);
    var ext = await loader(extPath, { allowFileAccess: true });
    if (ext && ext.id) extIdBySession.set(session, ext.id);
    return { ok: true, id: ext.id, name: ext.name, version: ext.version };
  } catch (e) {
    return { ok: false, error: 'load_failed: ' + e.message };
  }
}

function getDefaultExtPath() {
  return DEFAULT_EXT_PATH;
}

module.exports = { loadTampermonkeyForSession, isExtensionReady, getDefaultExtPath, getExtensionId };