// lib/proxy.js - per-session 代理设置
// 类型：socks5 | http | direct（direct = 不走代理）
// 密码字段从 accounts.proxy.passwordEncrypted 解密（safeStorage）

const safeStorage = require('./safe-storage');
const gateway = require('./socks-gateway');
const subs = require('./subscriptions');
const logs = require('./logs');

function buildProxyRules(proxyConfig) {
  if (!proxyConfig) return null;
  var t = proxyConfig.type;
  var host = proxyConfig.host;
  var port = proxyConfig.port;
  if (!host || !port) return null;
  if (t === 'socks5') {
    return {
      proxyRules: 'socks5://' + host + ':' + port,
      proxyBypassRules: '<local>',
    };
  }
  if (t === 'http') {
    return {
      proxyRules: 'http=' + host + ':' + port + ';https=' + host + ':' + port,
      proxyBypassRules: '<local>',
    };
  }
  return null;
}

async function setSessionProxy(session, proxyConfig) {
  if (!session) return { ok: false, error: 'no_session' };
  var rules = buildProxyRules(proxyConfig);
  if (!rules) {
    // direct 或无效配置：清除代理
    try {
      await session.setProxy({ mode: 'direct' });
      return { ok: true, mode: 'direct' };
    } catch (e) {
      return { ok: false, error: 'clear_failed: ' + e.message };
    }
  }
  try {
    await session.setProxy(rules);
    return { ok: true, mode: proxyConfig.type };
  } catch (e) {
    return { ok: false, error: 'set_failed: ' + e.message };
  }
}

async function clearSessionProxy(session) {
  if (!session) return { ok: false, error: 'no_session' };
  try {
    await session.setProxy({ mode: 'direct' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 解密代理密码（safeStorage.base64 -> 明文）
function decryptProxyPassword(encrypted) {
  if (!encrypted) return '';
  try {
    return safeStorage.decrypt(encrypted);
  } catch (e) {
    return '';
  }
}


// 从订阅池解析节点（解密后返回；找不到抛错）
function resolveSubscriptionNode(accountProxy) {
  if (!accountProxy || accountProxy.source !== 'subscription') return null;
  const sub = subs.getSubscription(accountProxy.subscriptionId);
  if (!sub) throw new Error('subscription_not_found: ' + accountProxy.subscriptionId);
  // 关键：不能用 listNodes（UI 脱敏列表，stripSecretsForList 删了 password/uuid），
  // 必须从订阅原始节点里解密拿完整节点，否则 mihomo config 永远缺密码。
  const node = (sub.nodes || []).map(subs.decryptNodeSecrets).find(n => n.id === accountProxy.nodeId);
  if (!node) throw new Error('node_not_found: ' + accountProxy.nodeId);
  // 解密失败检测：Keychain 密钥变更后旧密文无法解密，节点敏感字段缺失会导致 mihomo 握手失败
  // 此时引导用户刷新订阅（refresh 会重拉明文并用当前密钥重新加密）
  if (node._decryptFailed) {
    throw new Error('node_secret_decrypt_failed: 节点敏感字段解密失败（Keychain 密钥变更）。请在订阅页点「立即刷新」重新拉取并加密订阅。' + accountProxy.nodeId);
  }
  return node;
}

// 统一入口：根据 account.proxy.source 分发
// manual → 原 buildProxyRules 路径；subscription → gateway.allocate + socks5 本地端口
async function bindSessionProxy(session, account, opts) {
  opts = opts || {};
  if (!session) return { ok: false, error: 'no_session' };
  const ap = account && account.proxy;
  if (!ap) {
    await setSessionProxy(session, null);
    return { ok: true, mode: 'direct' };
  }
  if (ap.source === 'subscription') {
    try {
      const node = resolveSubscriptionNode(ap);
      const gw = await gateway.allocate(node, { exclusive: !!ap.exclusive });
      // 绑定 session → gateway id（stopView 时释放）
      if (account.__gatewayId) {
        try { await gateway.release(account.__gatewayId); } catch (e) {}
      }
      account.__gatewayId = gw.id;
      await session.setProxy({ proxyRules: 'socks5://127.0.0.1:' + gw.port, proxyBypassRules: '<local>' });
      // 异步查出口 IP + 位置（不阻塞 view 启动）：ip-api.com JSON API 一次拿全
      // 失败静默：不输出 WARN——节点不通本来就 ERR_CONNECTION_CLOSED 了，IP check 失败是二次信号
      const accId = account && account.id;
      if (accId) {
        gateway.checkProxyIp(gw.port, 4000).then((info) => {
          if (!info) return; // 静默：节点可能首次握手慢 / 不可达，view 已经起来了不重复警告
          const loc = [info.country, info.region, info.city].filter(Boolean).join(' / ') || info.countryCode || '?';
          const net = info.as || info.org || info.isp || '';
          logs.info(accId, 'proxy exit: ' + info.ip + ' | ' + loc + (net ? ' | ' + net : '') + ' (via node ' + node.server + ':' + node.port + ')');
          if (typeof opts.onExit === 'function') { try { opts.onExit(info); } catch (e) { /* ignore */ } }
        }).catch(() => { /* 静默 */ });
      }
      return { ok: true, mode: 'subscription', gatewayId: gw.id, port: gw.port };
    } catch (e) {
      console.error('[proxy] bindSessionProxy subscription path failed:', e.message, 'type=' + e.type);
      // 节点失效降级直连，不抛异常（别让 session 启动失败）
      await session.setProxy({ mode: 'direct' });
      return { ok: false, mode: 'direct_fallback', error: e.message };
    }
  }
  // manual（兼容旧数据）
  return setSessionProxy(session, ap);
}

// 账号停止时释放 gateway（refCount -1）
async function releaseSessionGateway(account) {
  if (account && account.__gatewayId) {
    const gid = account.__gatewayId;
    delete account.__gatewayId;
    try { await gateway.release(gid); } catch (e) {}
  }
}

module.exports = { setSessionProxy, clearSessionProxy, decryptProxyPassword, buildProxyRules, bindSessionProxy, resolveSubscriptionNode, releaseSessionGateway };