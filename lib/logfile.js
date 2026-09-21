// lib/logfile.js - 日志文件落盘器（按天滚动 + 超期清理）
// 目录由调用方注入（main.js 传 userData/logs；测试传 tmpdir），
// 时间函数可注入（测试模拟跨天滚动），保持纯模块可测。
// 写入用 appendFileSync：日志频率低（环形缓冲级别），同步追加
// 简单可靠，避免流生命周期管理；崩溃路径同样安全（无缓冲延迟）。

const fs = require('fs');
const path = require('path');

const PREFIX = 'main-';

function dayKey(now) {
  const d = new Date(now());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + mm + dd;
}

function fileNameFor(day) {
  return PREFIX + day + '.log';
}

// 清理超过 maxDays 的旧日志（按文件名里的日期判断，不依赖 mtime——
// 文件名即滚动依据，跨设备拷贝/系统时间漂移都不影响）
function pruneOldFiles(dir, maxDays, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_e) { return; }
  const today = dayKey(now);
  for (const name of names) {
    if (!name.startsWith(PREFIX) || !name.endsWith('.log')) continue;
    const day = name.slice(PREFIX.length, -4);
    if (!/^\d{8}$/.test(day) || day >= today) continue;
    // 简化保留策略：日期早于今天减 (maxDays-1) 天即删
    const cutoff = new Date(now() - (maxDays - 1) * 86400000);
    const cm = String(cutoff.getMonth() + 1).padStart(2, '0');
    const cd = String(cutoff.getDate()).padStart(2, '0');
    const cutoffKey = cutoff.getFullYear() + cm + cd;
    if (day < cutoffKey) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch (_e) { /* 删不掉就留着 */ }
    }
  }
}

function createLogFileWriter(opts) {
  const dir = (opts && opts.dir) || '.';
  const maxDays = (opts && opts.maxDays) || 7;
  const now = (opts && typeof opts.now === 'function') ? opts.now : Date.now;
  let currentDay = null;
  let inited = false;

  function ensureDirAndPrune() {
    if (inited) return;
    inited = true;
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) { /* 目录建不了则每条写入都会失败并静默 */ }
    pruneOldFiles(dir, maxDays, now);
  }

  // 常规写入：经 logs.setSink 注入，格式 `ISO [level] [accountId] message`
  function append(accountId, entry) {
    ensureDirAndPrune();
    const day = dayKey(now);
    if (day !== currentDay) currentDay = day;
    const line = new Date(entry.timestamp).toISOString() +
      ' [' + entry.level + '] [' + accountId + '] ' + entry.message + '\n';
    try { fs.appendFileSync(path.join(dir, fileNameFor(day)), line); } catch (_e) { /* 落盘失败静默，内存日志仍在 */ }
  }

  // 崩溃直写：不依赖 entry 结构，appendFileSync 保证进程退出前落盘
  function crashLine(level, msg) {
    ensureDirAndPrune();
    const line = new Date(now()).toISOString() + ' [' + level + '] [app] ' + String(msg) + '\n';
    try { fs.appendFileSync(path.join(dir, fileNameFor(dayKey(now))), line); } catch (_e) { /* 尽力而为 */ }
  }

  // 诊断包用：读取最近 N 天日志文件内容（按天倒序，缺文件跳过）
  function readRecentFiles(days) {
    ensureDirAndPrune();
    const n = days || maxDays;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = now() - i * 86400000;
      const name = fileNameFor(dayKey(() => t));
      try {
        const content = fs.readFileSync(path.join(dir, name), 'utf8');
        if (content) out.push({ file: name, content });
      } catch (_e) { /* 当天无文件正常 */ }
    }
    return out;
  }

  // 构造即建目录 + 清理超期文件（"启动清理"语义：writer 创建于应用启动时，
  // 不等首条日志才触发——诊断包读取/纯构造场景同样需要干净的目录状态）
  ensureDirAndPrune();

  return { append, crashLine, readRecentFiles, dir, maxDays };
}

module.exports = { createLogFileWriter, dayKey, fileNameFor, pruneOldFiles, PREFIX };
