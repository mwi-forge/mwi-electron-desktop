// lib/accounts.js - 账号数据层（CRUD + 持久化）
// 使用 electron-store，存储于 userData/accounts.json

const { randomUUID } = require('crypto');
const Store = require('electron-store');
const safeStorage = require('./safe-storage');

const SCHEMA = {
  version: { type: 'number', default: 1 },
  groups: {
    type: 'array',
    default: [
      // 2026-08-19 移除 grp_farm 默认分组（per 用户反馈）；已存数据迁移见 migrateRemoveFarm()
      { id: 'grp_default', name: '默认分组', order: 0, collapsed: false },
    ],
  },
  accounts: { type: 'array', default: [] },
};

const store = new Store({
  name: 'accounts',
  schema: SCHEMA,
  clearInvalidConfig: false,
});


// 迁移：删旧 schema 默认的 grp_farm 分组，账号指向 grp_farm 的重映射到首个剩余分组。
// 幂等：仅在数据中存在 grp_farm 时跑一次。
(function migrateRemoveFarm() {
  try {
    var groups = store.get('groups') || [];
    if (!Array.isArray(groups) || !groups.some(function (g) { return g.id === 'grp_farm'; })) return;
    var filtered = groups.filter(function (g) { return g.id !== 'grp_farm'; });
    if (filtered.length === 0) filtered.push({ id: 'grp_default', name: '默认分组', order: 0, collapsed: false });
    store.set('groups', filtered);
    var accounts = store.get('accounts') || [];
    if (Array.isArray(accounts)) {
      var fallbackId = filtered[0].id;
      var changed = false;
      for (var i = 0; i < accounts.length; i++) {
        if (accounts[i] && accounts[i].groupId === 'grp_farm') {
          accounts[i].groupId = fallbackId;
          changed = true;
        }
      }
      if (changed) store.set('accounts', accounts);
    }
    console.log('[migrate] removed grp_farm default group (per 2026-08-19 user feedback)');
  } catch (e) {
    console.error('[migrate] grp_farm removal failed:', e);
  }
})();



function listGroups()    { return store.get('groups'); }
function listAccounts()  { return store.get('accounts'); }
function getAccount(id)  { return listAccounts().find(a => a.id === id) || null; }
function getGroup(id)    { return listGroups().find(g => g.id === id) || null; }

function createGroup(name) {
  const groups = listGroups();
  const g = {
    id: 'grp_' + randomUUID().slice(0, 8),
    name: name || '新分组',
    order: groups.length,
    collapsed: false,
  };
  groups.push(g);
  store.set('groups', groups);
  return g;
}

function updateGroup(id, patch) {
  const groups = listGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) throw new Error('group not found: ' + id);
  groups[idx] = { ...groups[idx], ...patch, id };
  store.set('groups', groups);
  return groups[idx];
}

function removeGroup(id) {
  const groups = listGroups().filter(g => g.id !== id);
  const accounts = listAccounts();
  // 重置指向被删分组的账号到第一个剩余分组
  if (groups.length === 0) throw new Error('cannot remove last group');
  const fallbackId = groups[0].id;
  let changed = false;
  for (const a of accounts) {
    if (a.groupId === id) { a.groupId = fallbackId; changed = true; }
  }
  store.set('groups', groups);
  if (changed) store.set('accounts', accounts);
}

// 加密代理密码（明文 -> passwordEncrypted）
function encryptProxyPassword(plainPassword) {
  if (!plainPassword) return null;
  try {
    if (!safeStorage.isAvailable()) return null;  // Linux 无 keyring 时不加密
    return safeStorage.encrypt(plainPassword);
  } catch (e) {
    return null;
  }
}

// 处理输入：proxy 三态
//   source=manual     → { type, host, port, username?, passwordEncrypted }（password 明文转密文）
//   source=subscription → { source, subscriptionId, nodeId, exclusive? }（无敏感字段，原样保留）
//   proxy=null / undefined → 直连
function processProxyInput(input) {
  if (!input || !input.proxy) return null;
  var p = Object.assign({}, input.proxy);
  if (p.source === 'subscription') {
    // 订阅引用：无明文密码可加密；仅保留引用字段
    return {
      source: 'subscription',
      subscriptionId: p.subscriptionId || null,
      nodeId: p.nodeId || null,
      exclusive: !!p.exclusive,
    };
  }
  // manual（默认）
  p.source = p.source || 'manual';
  if (p.password) {
    p.passwordEncrypted = encryptProxyPassword(p.password);
    delete p.password;  // 不存明文
  }
  return p;
}

function createAccount(input) {
  if (!input.name || !input.url) {
    throw new Error('account.name and account.url are required');
  }
  const groups = listGroups();
  const account = {
    id: 'acc_' + randomUUID().slice(0, 8),
    name: String(input.name),
    groupId: input.groupId || (groups[0] ? groups[0].id : 'grp_default'),
    url: String(input.url),
    // width/height 已移除：WebContentsView bounds 由主进程 computeViewBounds() 根据主窗口
    // 实际尺寸动态算，不再存到账号里。
    userAgent: input.userAgent || null,
    fingerprintPreset: input.fingerprintPreset || 'preset_01',
    timezone: input.timezone || null,
    locale: input.locale || 'zh-CN',
    webRtcPolicy: input.webRtcPolicy || 'disable_non_proxied_udp',
    proxy: processProxyInput(input) || null,
    tampermonkey: input.tampermonkey || { enabled: true, scripts: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const accounts = listAccounts();
  accounts.push(account);
  store.set('accounts', accounts);
  return account;
}

function updateAccount(id, patch) {
  const accounts = listAccounts();
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('account not found: ' + id);
  var merged = Object.assign({}, accounts[idx], patch, { id: id, updatedAt: Date.now() });
  // 处理 patch.proxy.password 加密
  if (patch && patch.proxy && patch.proxy.password) {
    merged.proxy = processProxyInput(patch);
  }
  accounts[idx] = merged;
  store.set('accounts', accounts);
  return accounts[idx];
}

function removeAccount(id) {
  const accounts = listAccounts().filter(a => a.id !== id);
  store.set('accounts', accounts);
}

module.exports = {
  listGroups, getGroup, createGroup, updateGroup, removeGroup,
  listAccounts, getAccount, createAccount, updateAccount, removeAccount,
  storePath: () => store.path,
};