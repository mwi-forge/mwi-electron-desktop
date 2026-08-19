// lib/socks-gateway.js - 本地 socks5 gateway 池
// 每个 gateway = 一个 mihomo 子进程（mixed-port 同时提供 http+socks5）
// refCount 共享：多个账号指向同一 (subscriptionId, nodeId) 时复用同一 gateway
// key = subscriptionId:nodeId[:exclusive]

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const logs = require("./logs");

const PORT_RANGE_START = 7890;
const PORT_RANGE_END = 7999;
const STARTUP_TIMEOUT_MS = 8000;
const HEALTH_CHECK_INTERVAL_MS = 300;

// 端口分配器
const availablePorts = new Set();
for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) availablePorts.add(p);
const allocatedPorts = new Map(); // port -> gatewayId

// gateway 池: gatewayId -> { id, key, port, node, child, refCount, workDir }
const pool = new Map();
// key -> gatewayId（共享查找）
const keyIndex = new Map();

function findMihomoBinary() {
  // 优先级：dev 目录 resources/mihomo/mihomo → 打包后 resources/mihomo/mihomo
  const candidates = [
    path.join(__dirname, "..", "resources", "mihomo", "mihomo"),
    path.join(process.resourcesPath || "", "mihomo", "mihomo"),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return null;
}

function gatewayKey(node, opts) {
  const exclusive = (opts && opts.exclusive) ? ":exclusive" : "";
  return (node.id || node.name || "node") + exclusive;
}

function allocPort() {
  for (const p of availablePorts) {
    availablePorts.delete(p);
    return p;
  }
  throw new Error("no_ports_available");
}

function freePort(p) {
  availablePorts.add(p);
  allocatedPorts.delete(p);
}

// TCP 探测端口是否被占用（连接成功 = 被占）
// 注入点：测试可 stub 掉真实网络探测
let _probeOverride = null;
function __setPortProbeOverride(fn) { _probeOverride = fn; }
function __resetPortProbeOverride() { _probeOverride = null; }
function probePort(p) {
  if (_probeOverride) return _probeOverride(p);
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port: p }, () => { sock.destroy(); resolve(true); });
    sock.on("error", () => { sock.destroy(); resolve(false); });
  });
}

// 生成 mihomo 最小 config：mixed-port + 订阅节点 + global 模式
// 布尔归一：YAML fallback 可能把 true 解析成字符串，mihomo 要求 bool
function boolFix(v) {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return undefined;
}

function buildMihomoConfig(node, port) {
  // node 已是解密后的节点对象（含 password / uuid 明文，只进内存 config 文件）
  const proxyEntry = {
    name: "gw",
    type: node.type,
    server: node.server,
    port: node.port,
  };
  if (node.password !== undefined && node.password !== null) proxyEntry.password = node.password;
  if (node.username !== undefined && node.username !== null) proxyEntry.username = node.username;
  if (node.uuid !== undefined && node.uuid !== null) proxyEntry.uuid = node.uuid;
  if (node.cipher !== undefined && node.cipher !== null) proxyEntry.cipher = node.cipher;
  if (node.alterId !== undefined && node.alterId !== null) proxyEntry.alterId = node.alterId;
  if (node.network) proxyEntry.network = node.network;
  if (node.tls) { const b = boolFix(node.tls); if (b !== undefined) proxyEntry.tls = b; }
  if (node.sni) proxyEntry.sni = node.sni;
  if (node["ws-opts"]) proxyEntry["ws-opts"] = node["ws-opts"];
  if (node.servername) proxyEntry.servername = node.servername;
  if (node["skip-cert-verify"]) { const b = boolFix(node["skip-cert-verify"]); if (b !== undefined) proxyEntry["skip-cert-verify"] = b; }
  if (node.flow) proxyEntry.flow = node.flow;
  if (node["reality-opts"]) proxyEntry["reality-opts"] = node["reality-opts"];
  if (node["client-fingerprint"]) proxyEntry["client-fingerprint"] = node["client-fingerprint"];
  if (node.obfs) proxyEntry.obfs = node.obfs;
  if (node["obfs-password"]) proxyEntry["obfs-password"] = node["obfs-password"];

  const cfg = {
    "mixed-port": port,
    mode: "global",
    "log-level": "warning",
    "allow-lan": false,
    "external-controller": "127.0.0.1:" + (port + 10000),
    proxies: [proxyEntry],
    "proxy-groups": [{
      name: "GLOBAL",
      type: "select",
      proxies: ["gw", "DIRECT"],
    }],
    // mihomo 1.19.x 不接受 rules 简写（MATCH,GLOBAL 解析 fatal）；global 模式下不需要 rules，
    // 全部流量自然走 GLOBAL 选择组。
    rules: [],
  };
  return JSON.stringify(cfg, null, 2);
}

// 等待 mihomo 开始监听该端口（端口"就绪" = TCP 能连上）
// 注意：不能只测"端口空闲"（空闲=连接被拒），因为 mihomo 需要时间 bind；
// 正确语义 = 轮询直到 TCP 连接成功 或 超时
let _waitPortOverride = null;
function __setWaitPortOverride(fn) { _waitPortOverride = fn; }
function __resetWaitPortOverride() { _waitPortOverride = null; }

// 通过本地 socks5 端口查出口 IP + 地理位置（ip-api.com JSON API，一次拿全）
// 返回 {ip, country, countryCode, region, city, lat, lon, org, as, isp} 或 null（超时/失败）
// 调用方不要 await 阻塞主流程
function checkProxyIp(port, timeoutMs) {
  timeoutMs = timeoutMs || 6000;
  return new Promise((resolve) => {
    const args = [
      "--socks5", "127.0.0.1:" + port,
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "-s",
      "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,org,as,isp,query"
    ];
    const c = spawn("curl", args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    c.stdout.on("data", (d) => { out += d.toString(); });
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    c.on("error", () => finish(null));
    c.on("close", (code) => {
      if (code !== 0) return finish(null);
      try {
        const info = JSON.parse(out);
        if (info.status !== "success" || !info.query) return finish(null);
        resolve({
          ip: info.query,
          country: info.country || "",
          countryCode: info.countryCode || "",
          region: info.regionName || "",
          city: info.city || "",
          lat: typeof info.lat === "number" ? info.lat : null,
          lon: typeof info.lon === "number" ? info.lon : null,
          org: info.org || "",
          as: info.as || "",
          isp: info.isp || ""
        });
      } catch (e) { finish(null); }
    });
    setTimeout(() => finish(null), timeoutMs + 500);
  });
}

function waitPort(port, timeoutMs) {
  if (_waitPortOverride) return _waitPortOverride(port, timeoutMs);
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
        return;
      }
      const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
        sock.destroy();
        clearInterval(timer);
        resolve(true);
      });
      sock.on("error", () => { sock.destroy(); });
    }, HEALTH_CHECK_INTERVAL_MS);
  });
}

// ---- 测试注入点（生产不用，集成测试可 stub 掉真实 spawn） ----
let _spawnOverride = null;
function __setSpawnOverride(fn) { _spawnOverride = fn; }
function __resetSpawnOverride() { _spawnOverride = null; }

async function spawnGateway(node, port, workDir) {
  if (_spawnOverride) return _spawnOverride(node, port, workDir);
  const mihomoBin = findMihomoBinary();
  if (!mihomoBin) throw Object.assign(new Error("mihomo_binary_not_found"), { type: "spawn_failed" });

  // 写 config 到 workDir
  const configPath = path.join(workDir, "config.yaml");
  fs.writeFileSync(configPath, buildMihomoConfig(node, port));

  const child = spawn(mihomoBin, ["-d", workDir, "-f", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stderrBuf = "";
  child.stderr.on("data", d => { stderrBuf += d.toString(); });
  child.stdout.on("data", d => { /* mihomo 日志走 stderr */ });
  child.on("error", (e) => {
    console.error("[gateway] mihomo spawn error:", e.message);
    logs.error("gateway", "mihomo spawn error: " + e.message);
  });
  // 关键：捕获 spawn 后立即 crash（macOS Gatekeeper / 签名 / 权限问题常导致 mihomo 一启动就 exit）
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error("[gateway] mihomo exited code=" + code + " signal=" + signal + " stderr=" + stderrBuf.slice(-500));
      logs.error("gateway", "mihomo early-exit code=" + code + " signal=" + signal + " stderr=" + stderrBuf.slice(-500));
    }
  });

  // 等待端口就绪
  const ok = await waitPort(port, STARTUP_TIMEOUT_MS);
  if (!ok) {
    child.kill("SIGTERM");
    throw Object.assign(new Error("startup_timeout: " + (stderrBuf.slice(-300) || "no output")), { type: "startup_timeout" });
  }
  return child;
}

// allocate: 返回 gateway id + host + port
async function allocate(node, opts) {
  if (!node || !node.server || !node.port) {
    throw Object.assign(new Error("invalid_node"), { type: "invalid_node" });
  }
  const key = gatewayKey(node, opts);
  // 共享：同 key 已有 gateway 直接复用
  if (keyIndex.has(key)) {
    const gid = keyIndex.get(key);
    const gw = pool.get(gid);
    if (gw) {
      gw.refCount += 1;
      return { id: gid, host: "127.0.0.1", port: gw.port, shared: true };
    }
  }

  // 顺序探测端口池，跳过被外部进程占用的端口（如上次应用退出残留的孤儿 mihomo），
  // 直到找到空闲端口；全忙才报错。测试模式（_spawnOverride）跳过探测。
  let port = null;
  const triedBusy = [];
  while (availablePorts.size > 0) {
    const p = allocPort();
    // 始终探测（生产=真实 TCP；测试=probeOverride 注入）；spawnOverride 只跳过 spawn 不跳过探测
    const busy = await probePort(p);
    if (!busy) { port = p; break; }
    triedBusy.push(p); // 被外部占用：本轮丢弃，顺延下一个端口
  }
  if (port === null) {
    for (const p of triedBusy) freePort(p); // 全部归还，下次 allocate 重试
    throw Object.assign(new Error("no_free_port_in_range"), { type: "no_free_port" });
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mwi-gw-"));
  try {
    const child = await spawnGateway(node, port, workDir);
    const gid = "gw-" + port;
    const gw = { id: gid, key, port, node, child, refCount: 1, workDir };
    pool.set(gid, gw);
    keyIndex.set(key, gid);
    allocatedPorts.set(port, gid);
    return { id: gid, host: "127.0.0.1", port, shared: false };
  } catch (e) {
    freePort(port);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e2) {}
    throw e;
  }
}

// release: refCount -1，归 0 时真正释放
async function release(gatewayId) {
  const gw = pool.get(gatewayId);
  if (!gw) return { ok: true, alreadyGone: true };
  gw.refCount -= 1;
  if (gw.refCount > 0) return { ok: true, refCount: gw.refCount };
  // 真正释放
  pool.delete(gatewayId);
  keyIndex.delete(gw.key);
  // 先 kill + 等子进程退出（最多 3s），再归还端口——TCP 端口要等进程死才真正空闲
  if (gw.child && typeof gw.child.once === "function" && typeof gw.child.kill === "function") {
    try { gw.child.kill("SIGTERM"); } catch (e) {}
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      gw.child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  freePort(gw.port);
  try { fs.rmSync(gw.workDir, { recursive: true, force: true }); } catch (e) {}
  return { ok: true, released: true };
}

async function releaseAll() {
  const ids = [...pool.keys()];
  for (const id of ids) {
    const gw = pool.get(id);
    if (!gw) continue;
    try { gw.child.kill("SIGKILL"); } catch (e) {} // 退出清理用 SIGKILL：mihomo 必须死，否则成孤儿占端口
    try { fs.rmSync(gw.workDir, { recursive: true, force: true }); } catch (e) {}
  }
  pool.clear();
  keyIndex.clear();
  for (const p of [...allocatedPorts.keys()]) availablePorts.add(p);
  allocatedPorts.clear();
}

function getGateway(id) { return pool.get(id) || null; }
function listGateways() { return [...pool.values()].map(g => ({ id: g.id, port: g.port, key: g.key, refCount: g.refCount })); }

module.exports = {
  allocate, release, releaseAll, getGateway, listGateways,
  findMihomoBinary, buildMihomoConfig, waitPort,
  __setSpawnOverride, __resetSpawnOverride, __setWaitPortOverride, __resetWaitPortOverride,
  __setPortProbeOverride, __resetPortProbeOverride, probePort, checkProxyIp,
  PORT_RANGE_START, PORT_RANGE_END,
};