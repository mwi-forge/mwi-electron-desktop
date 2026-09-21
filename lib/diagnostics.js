// lib/diagnostics.js - 诊断包构建（纯模块，无 electron 依赖，per issue #45）
// 输出一个自包含 JSON 快照：应用元信息 + 内存环形日志 + 落盘日志文件 + 脱敏配置。
// 保存动作（dialog / writeFile）由 lib/ipc.js 的 handler 执行，本模块只负责"收集 + 脱敏"。
//
// 脱敏红线（见 issue #45 清单）：
// - 订阅 url 的 query（token 所在）一律剥除；nodes 全剥（只留数量）
// - 账号代理密文、url query、tampermonkey 脚本明细剥除（脚本只留数量）
// - 日志中的出口 IP 与 (via node host:port) 段替换；127.0.0.1 本地地址保留
// - Partitions/、mihomo tmp config、selftest 产物：根本不进入收集范围

const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g;
const VIA_NODE_RE = /\(via node [^)]*\)/g;
// 自由文本里夹带的凭据型 query 参数（订阅 error 消息常见 `...token=XXX...`）
const CREDS_QUERY_RE = /\b(token|password|passwd|secret|key|uuid)=[^&\s'"]+/gi;

function isLocalIp(ip) {
  return ip === '127.0.0.1' || ip === '0.0.0.0' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
}

// 文本脱敏：IPv4 → <ip>（本地/内网保留，socks5://127.0.0.1:port 这类信息对排障有用）；
// (via node x:x) → (via node <redacted>)；凭据型 query 参数值 → <redacted>
function redactText(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(IPV4_RE, (m) => (isLocalIp(m.split(':')[0]) ? m : '<ip>'));
  s = s.replace(VIA_NODE_RE, '(via node <redacted>)');
  s = s.replace(CREDS_QUERY_RE, '$1=<redacted>');
  return s;
}

// URL 脱敏：剥 query（订阅 token、入口 token 都在 query 里）；保留 origin+path 供排障
function redactUrl(url) {
  const s = String(url == null ? '' : url);
  const q = s.indexOf('?');
  return (q >= 0 ? s.slice(0, q) : s) + (q >= 0 ? '?<query-redacted>' : '');
}

function redactLogEntry(entry) {
  if (!entry) return entry;
  return { timestamp: entry.timestamp, level: entry.level, message: redactText(entry.message) };
}

function redactLogFiles(files) {
  return (files || []).map((f) => ({ file: f.file, content: redactText(f.content) }));
}

// 账号脱敏：剥代理密文 / url query / tampermonkey 脚本明细；保留结构元数据（分组、指纹预设名等）
function redactAccounts(accountsArr) {
  return (accountsArr || []).map((a) => {
    const out = { ...a };
    if (out.url) out.url = redactUrl(out.url);
    if (out.proxy) {
      const p = { ...out.proxy };
      delete p.passwordEncrypted;
      delete p.password;
      if (p.url) p.url = redactUrl(p.url);
      out.proxy = p;
    }
    if (out.tampermonkey && Array.isArray(out.tampermonkey.scripts)) {
      out.tampermonkey = { ...out.tampermonkey, scripts: { count: out.tampermonkey.scripts.length } };
    }
    return out;
  });
}

// 订阅脱敏：url 去 query；nodes 全剥只留 count；error 截断（可能夹带 URL 片段，先 redact 再截）
function redactSubscriptions(subsArr) {
  return (subsArr || []).map((s) => {
    const out = { ...s };
    out.url = redactUrl(out.url);
    if (Array.isArray(out.nodes)) out.nodes = { count: out.nodes.length };
    if (out.error) out.error = redactText(out.error).slice(0, 200);
    return out;
  });
}

// 组装诊断快照。deps 全部可注入（测试传 stub；生产由 ipc.js 传真模块）：
// { app, logsMod, logWriter, accountsMod, subsMod, uptimeSec }
function buildSnapshot(deps) {
  const d = deps || {};
  const logsAll = (d.logsMod && d.logsMod.listAll) ? (d.logsMod.listAll() || {}) : {};
  const redactedLogs = {};
  for (const key of Object.keys(logsAll)) {
    redactedLogs[key] = logsAll[key].map(redactLogEntry);
  }
  const accountsRaw = (d.accountsMod && d.accountsMod.listAccounts) ? d.accountsMod.listAccounts() : [];
  const subsRaw = (d.subsMod && d.subsMod.listSubscriptions) ? d.subsMod.listSubscriptions() : [];
  return {
    meta: {
      appVersion: d.app ? d.app.getVersion() : 'unknown',
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node,
      uptimeSec: Math.round(d.uptimeSec != null ? d.uptimeSec : process.uptime()),
      exportedAt: new Date().toISOString(),
      accountCount: accountsRaw.length,
      subscriptionCount: subsRaw.length,
    },
    ringLogs: redactedLogs,
    logFiles: redactLogFiles((d.logWriter && d.logWriter.readRecentFiles) ? d.logWriter.readRecentFiles() : []),
    config: {
      accounts: redactAccounts(accountsRaw),
      subscriptions: redactSubscriptions(subsRaw),
    },
  };
}

module.exports = { redactText, redactUrl, redactLogEntry, redactAccounts, redactSubscriptions, buildSnapshot };
