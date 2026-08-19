// lib/subscriptions.js - Clash 订阅管理（CRUD + 持久化 + 自动刷新 + 测速内存）
// 数据存 userData/subscriptions.json（electron-store）
// 节点敏感字段（password / uuid）经 safeStorage 加密后落盘

const { randomUUID } = require("crypto");
const Store = require("electron-store");
const safeStorage = require("./safe-storage");
const clash = require("./clash");

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const AUTO_TICK_MS = 60 * 60 * 1000;             // 每小时检查一次
const DEFAULT_UA = "ClashForWindows/0.20.0";
const MEASURE_CONCURRENCY = 4;
const MEASURE_TIMEOUT_MS = 5000;

const SCHEMA = {
  version: { type: "number", default: 1 },
  subscriptions: { type: "array", default: [] },
};

const store = new Store({ name: "subscriptions", schema: SCHEMA, clearInvalidConfig: false });

// 测速结果（仅内存，不落盘）: Map<subId, Map<nodeId, {rtt,status,measuredAt}>>
const latencyCache = new Map();

function listSubscriptions() {
  return store.get("subscriptions") || [];
}

function getSubscription(id) {
  return listSubscriptions().find(s => s.id === id) || null;
}

function saveAll(list) {
  store.set("subscriptions", list);
}

// ---- 敏感字段加解密 ----
function encryptNodeSecrets(node) {
  const out = { ...node };
  if (out.password) {
    try { out.password = safeStorage.encrypt(out.password); } catch (e) { delete out.password; }
  }
  if (out.uuid) {
    try { out.uuid = safeStorage.encrypt(out.uuid); } catch (e) { delete out.uuid; }
  }
  return out;
}

function decryptNodeSecrets(node) {
  const out = { ...node };
  if (out.password) {
    try { out.password = safeStorage.decrypt(out.password); } catch (e) { out._decryptFailed = true; }
  }
  if (out.uuid) {
    try { out.uuid = safeStorage.decrypt(out.uuid); } catch (e) { out._decryptFailed = true; }
  }
  return out;
}

function stripSecretsForList(node) {
  // listNodes 给 UI 时只暴露非敏感元数据 + latency
  const out = { ...node };
  delete out.password;
  delete out.uuid;
  return out;
}

// ---- CRUD ----
function createSubscription({ name, url, userAgent }) {
  const list = listSubscriptions();
  const sub = {
    id: "sub-" + randomUUID().slice(0, 8),
    name: name || "未命名订阅",
    url: String(url || "").trim(),
    userAgent: userAgent || DEFAULT_UA,
    createdAt: new Date().toISOString(),
    lastFetchedAt: null,
    nextAutoUpdateAt: null,
    nodes: [],
    status: "idle",
    error: null,
  };
  if (!sub.url) throw new Error("url_required");
  list.push(sub);
  saveAll(list);
  return sub;
}

function updateSubscription(id, patch) {
  const list = listSubscriptions();
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) throw new Error("subscription_not_found: " + id);
  const allow = ["name", "url", "userAgent"];
  for (const k of allow) {
    if (patch[k] !== undefined) list[idx][k] = patch[k];
  }
  saveAll(list);
  return list[idx];
}

function deleteSubscription(id) {
  const list = listSubscriptions().filter(s => s.id !== id);
  saveAll(list);
  latencyCache.delete(id);
  return list;
}

// ---- 刷新 ----
async function refreshSubscription(id) {
  const list = listSubscriptions();
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) throw new Error("subscription_not_found: " + id);
  const sub = list[idx];
  sub.status = "fetching";
  sub.error = null;
  saveAll(list);
  try {
    const { format, nodes } = await clash.fetchAndParse(sub.url, sub.userAgent);
    sub.nodes = nodes.map(encryptNodeSecrets);
    sub.status = "ok";
    sub.lastFetchedAt = Date.now();
    sub.nextAutoUpdateAt = sub.lastFetchedAt + REFRESH_INTERVAL_MS;
    saveAll(list);
    latencyCache.delete(id); // 节点列表可能变了，清测速缓存
    return sub;
  } catch (e) {
    sub.status = "error";
    sub.error = e.message || String(e);
    saveAll(list);
    throw e;
  }
}

// ---- 测速（TCP connect 时间戳；纯内存） ----
function measureNode(node) {
  // node 是已解密对象；测的是到 node.server:node.port 的 TCP RTT
  return new Promise((resolve) => {
    const net = require("net");
    const start = Date.now();
    const sock = net.createConnection({ host: node.server, port: node.port }, () => {
      const rtt = Date.now() - start;
      sock.destroy();
      resolve({ rtt, status: "ok" });
    });
    sock.setTimeout(MEASURE_TIMEOUT_MS, () => {
      sock.destroy();
      resolve({ rtt: null, status: "timeout" });
    });
    sock.on("error", () => {
      sock.destroy();
      resolve({ rtt: null, status: "refused" });
    });
  });
}

async function measureAllNodes(id) {
  const sub = getSubscription(id);
  if (!sub) throw new Error("subscription_not_found: " + id);
  const nodes = sub.nodes.map(decryptNodeSecrets);
  const results = new Map();
  // 并发 4
  const queue = nodes.slice();
  const workers = [];
  for (let i = 0; i < Math.min(MEASURE_CONCURRENCY, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const node = queue.shift();
        const r = await measureNode(node);
        results.set(node.id, { ...r, measuredAt: Date.now() });
      }
    })());
  }
  await Promise.all(workers);
  latencyCache.set(id, results);
  return results;
}

async function measureSingleNode(id, nodeId) {
  const sub = getSubscription(id);
  if (!sub) throw new Error("subscription_not_found: " + id);
  const node = sub.nodes.map(decryptNodeSecrets).find(n => n.id === nodeId);
  if (!node) throw new Error("node_not_found: " + nodeId);
  const r = await measureNode(node);
  const result = { ...r, measuredAt: Date.now() };
  let m = latencyCache.get(id);
  if (!m) { m = new Map(); latencyCache.set(id, m); }
  m.set(nodeId, result);
  return result;
}

// ---- listNodes（UI 用：非敏感字段 + latency） ----
function listNodes(id) {
  const sub = getSubscription(id);
  if (!sub) return [];
  const lat = latencyCache.get(id) || new Map();
  return sub.nodes.map(decryptNodeSecrets).map(n => ({
    ...stripSecretsForList(n),
    latency: lat.get(n.id) || null,
  }));
}

// ---- 自动刷新调度 ----
function autoRefreshTick() {
  const now = Date.now();
  const list = listSubscriptions();
  const due = list.filter(s => s.nextAutoUpdateAt && s.nextAutoUpdateAt <= now);
  // 错峰：每条 refresh 前随机 sleep 1-3s
  let delay = 0;
  for (const sub of due) {
    delay += 1000 + Math.floor(Math.random() * 2000);
    setTimeout(() => {
      refreshSubscription(sub.id).catch(() => {});
    }, delay);
  }
  return due.length;
}

let tickTimer = null;
function startAutoRefresh() {
  if (tickTimer) return;
  tickTimer = setInterval(autoRefreshTick, AUTO_TICK_MS);
}

function stopAutoRefresh() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

module.exports = {
  listSubscriptions, getSubscription, createSubscription,
  updateSubscription, deleteSubscription,
  refreshSubscription,
  measureNode, measureAllNodes, measureSingleNode,
  listNodes,
  autoRefreshTick, startAutoRefresh, stopAutoRefresh,
  encryptNodeSecrets, decryptNodeSecrets, stripSecretsForList,
  latencyCache,
};
