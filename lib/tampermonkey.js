// lib/tampermonkey.js - per-session 油猴扩展加载（含失败降级）
// 扩展目录：resources/tampermonkey/（含 manifest.json）
// 首次使用需用户手动从 Chrome 商店下载 Tampermonkey CRX 并解压

const path = require('path');
const fs = require('fs');

const DEFAULT_EXT_PATH = path.join(__dirname, '..', 'resources', 'tampermonkey');

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
    var ext = await session.loadExtension(extPath, { allowFileAccess: true });
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