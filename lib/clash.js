// lib/clash.js - Clash 订阅解析（Clash YAML + base64 行式 + 节点标准化）
// 输出统一节点 schema：{ id, name, type, server, port, password?, uuid?, cipher?, ... }
// 节点 id 用 name 做稳定标识（订阅刷新后同节点保持同一 id，供 account.proxy.nodeId 引用）

const https = require("https");
const http = require("http");
const urlMod = require("url");

// 尝试加载 yaml 解析器；没有则回退到轻量正则（够覆盖机场订阅的常见形态）
let yaml = null;
try { yaml = require("yaml"); } catch (e) { yaml = null; }

function stableNodeId(node) {
  // 订阅内节点名可能重复，追加 server:port 保证唯一且稳定
  const base = String(node.name || "node").replace(/^["']|["']$/g, "").trim();
  return base + "@" + (node.server || "?") + ":" + (node.port || "?");
}

function normalizeNode(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "").toLowerCase();
  if (!type) return null;
  const server = raw.server || raw.host || raw.address || null;
  const port = Number(raw.port || 0);
  if (!server || !port) return null;
  const node = {
    id: stableNodeId({ name: raw.name, server, port }),
    name: String(raw.name || server + ":" + port).replace(/^["']|["']$/g, "").trim(),
    type: type,
    server: server,
    port: port,
  };
  // 协议特有字段（按需透传，socks-gateway 交给 mihomo 消费）
  const extra = ["password", "uuid", "cipher", "username", "tls", "sni", "network", "ws-opts", "alterId", "udp", "skip-cert-verify", "servername", "flow", "reality-opts", "client-fingerprint", "obfs", "obfs-password"];
  for (const k of extra) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") node[k] = raw[k];
  }
  return node;
}

// ---- Clash YAML 解析 ----
function parseClashYaml(text) {
  const nodes = [];
  if (!text || typeof text !== "string") return nodes;
  let data = null;
  if (yaml) {
    try { data = yaml.parse(text); } catch (e) { data = null; }
  }
  if (!data) {
    // 无 yaml 库或解析失败：轻量正则兜底提取 proxies 段
    nodes.push.apply(nodes, parseYamlFallback(text));
    return nodes;
  }
  const proxies = Array.isArray(data.proxies) ? data.proxies : [];
  for (const p of proxies) {
    const n = normalizeNode(p);
    if (n) nodes.push(n);
  }
  return nodes;
}

// 轻量 YAML fallback：只提取 "  - name: X / type: Y / server: Z / port: N" 结构
function parseYamlFallback(text) {
  const nodes = [];
  const lines = String(text).split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    if (t.startsWith("- ")) {
      if (cur) { const n = normalizeNode(cur); if (n) nodes.push(n); }
      cur = {};
      const kv = t.slice(2).trim();
      const m = kv.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) cur[m[1]] = m[2];
      continue;
    }
    if (cur) {
      const m = t.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) cur[m[1]] = m[2];
    }
  }
  if (cur) { const n = normalizeNode(cur); if (n) nodes.push(n); }
  return nodes;
}

// ---- base64 行式订阅解析（ss:// / trojan:// / vmess:// 等） ----
function parseBase64Subscriptions(b64Text) {
  const nodes = [];
  if (!b64Text) return nodes;
  let decoded = "";
  try {
    // 兼容带前缀的 base64（如 data: 或夹在 yaml 里的 base64 段）
    const clean = String(b64Text).replace(/\s+/g, "");
    decoded = Buffer.from(clean, "base64").toString("utf8");
  } catch (e) {
    decoded = String(b64Text);
  }
  if (!/ss:\/\/|trojan:\/\/|vmess:\/\//.test(decoded)) {
    // base64 解码后仍无 uri 特征，可能是明文行式
    decoded = String(b64Text);
  }
  const lines = decoded.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const n = parseUriNode(t);
    if (n) nodes.push(n);
  }
  return nodes;
}

function parseUriNode(uri) {
  try {
    if (uri.startsWith("ss://")) return parseSsUri(uri);
    if (uri.startsWith("trojan://")) return parseTrojanUri(uri);
    if (uri.startsWith("vmess://")) return parseVmessUri(uri);
  } catch (e) {
    return null;
  }
  return null;
}

function parseSsUri(uri) {
  // ss://base64(method:password)@host:port#name 或 ss://base64(method:password@host:port)#name
  const m = uri.match(/^ss:\/\/([^#]+?)(?:#(.*))?$/);
  if (!m) return null;
  const frag = m[1];
  const name = m[2] ? decodeURIComponent(m[2]) : "";
  let method = "", password = "", server = "", port = 0;
  if (frag.includes("@")) {
    const at = frag.indexOf("@");
    const cred = Buffer.from(frag.slice(0, at), "base64").toString("utf8");
    const hostpart = frag.slice(at + 1);
    const colon = cred.indexOf(":");
    method = cred.slice(0, colon);
    password = cred.slice(colon + 1);
    const hp = hostpart.split(":");
    server = hp[0];
    port = Number(hp[1] || 0);
  } else {
    const dec = Buffer.from(frag, "base64").toString("utf8");
    const at = dec.lastIndexOf("@");
    const cred = dec.slice(0, at);
    const hostpart = dec.slice(at + 1);
    const colon = cred.indexOf(":");
    method = cred.slice(0, colon);
    password = cred.slice(colon + 1);
    const hp = hostpart.split(":");
    server = hp[0];
    port = Number(hp[1] || 0);
  }
  if (!server || !port) return null;
  return normalizeNode({ name, type: "ss", server, port, method, password });
}

function parseTrojanUri(uri) {
  // trojan://password@host:port?sni=...#name
  const m = uri.match(/^trojan:\/\/([^@]+)@([^:?#]+):(\d+)(?:[^#]*)?(?:#(.*))?$/);
  if (!m) return null;
  const name = m[4] ? decodeURIComponent(m[4]) : "";
  return normalizeNode({
    name, type: "trojan",
    server: m[2], port: Number(m[3]),
    password: decodeURIComponent(m[1]),
  });
}

function parseVmessUri(uri) {
  // vmess://base64(json)
  const m = uri.match(/^vmess:\/\/(.+)$/);
  if (!m) return null;
  const json = Buffer.from(m[1], "base64").toString("utf8");
  const j = JSON.parse(json);
  const name = j.ps || "";
  const node = normalizeNode({
    name, type: "vmess",
    server: j.add || j.host,
    port: Number(j.port || 0),
    uuid: j.id || j.uuid,
    alterId: j.aid,
    network: j.net || "tcp",
    tls: j.tls ? "tls" : undefined,
    "ws-opts": j.ws ? { path: j.path, headers: { Host: j.host } } : undefined,
  });
  return node;
}

// ---- HTTP 拉取 + 格式嗅探 ----
function fetchText(urlStr, userAgent, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new urlMod.URL(urlStr); } catch (e) {
      reject(new Error("invalid_url: " + urlStr));
      return;
    }
    const lib = u.protocol === "https:" ? https : (u.protocol === "http:" ? http : null);
    if (!lib) { reject(new Error("unsupported_protocol: " + u.protocol)); return; }
    const req = lib.get(urlStr, {
      headers: {
        "User-Agent": userAgent || "ClashForWindows/0.20.0",
        Accept: "application/x-yaml, text/plain, */*",
      },
      timeout: timeoutMs || 15000,
    }, (res) => {
      const code = res.statusCode || 0;
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error("http_" + code));
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
  });
}

function sniffFormat(text) {
  const t = String(text || "").trim();
  if (!t) return "unknown";
  // base64 特征：ey（json base64 头）或全 base64 字符 + 行式 uri
  if (/^ey/.test(t) && /^(?:[A-Za-z0-9+/]{4})*[A-Za-z0-9+/]{0,3}={0,2}$/.test(t.replace(/\s/g, ""))) return "base64";
  if (/^(ss|trojan|vmess):\/\//m.test(t)) return "uri-lines";
  if (/^proxies:/m.test(t) || /^-\s+name:/m.test(t)) return "clash-yaml";
  if (/^mixed-port:|^port:|^mode:/m.test(t)) return "clash-yaml";
  return "unknown";
}

async function fetchAndParse(urlStr, userAgent, timeoutMs) {
  const text = await fetchText(urlStr, userAgent, timeoutMs);
  const fmt = sniffFormat(text);
  let nodes = [];
  if (fmt === "clash-yaml") nodes = parseClashYaml(text);
  else if (fmt === "base64" || fmt === "uri-lines") nodes = parseBase64Subscriptions(text);
  else {
    // unknown：先试 yaml，再试 base64 行式
    nodes = parseClashYaml(text);
    if (nodes.length === 0) nodes = parseBase64Subscriptions(text);
  }
  return { format: fmt, nodes, rawLength: text.length };
}

module.exports = {
  parseClashYaml,
  parseBase64Subscriptions,
  parseYamlFallback,
  parseUriNode,
  fetchAndParse,
  fetchText,
  sniffFormat,
  stableNodeId,
  normalizeNode,
};
