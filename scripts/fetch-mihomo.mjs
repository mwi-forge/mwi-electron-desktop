// scripts/fetch-mihomo.mjs - mihomo 二进制拉取脚本（二进制不入 git）
// resources/mihomo/ 已从仓库移除；dev / CI / 打包前经本脚本从 GitHub Releases 拉取：
//   node scripts/fetch-mihomo.mjs                # 拉当前平台
//   node scripts/fetch-mihomo.mjs --all          # 拉全部平台（交叉打包前）
//   node scripts/fetch-mihomo.mjs --platform=win32
// 幂等：目标文件已存在且 >1MB 时跳过。挂载点：npm start / dev / prepack / dist*。
// 完整性：下载后按 EXPECTED_SHA256 强校验（官方 sha256，经 GitHub API assets digest 核对）。
import { writeFileSync, statSync, mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEST_BASE = path.join(ROOT, 'resources', 'mihomo');

// 与上一个入库版本保持一致（resources/mihomo 出库前的 v1.19.25）
const MIHOMO_VERSION = 'v1.19.25';
const RELEASE_BASE = 'https://github.com/MetaCubeX/mihomo/releases/download/' + MIHOMO_VERSION;

// 资产名 → 官方 sha256（来源 GitHub API release assets digest，2026-09-16 对 v1.19.25 核对）。
// 升级 MIHOMO_VERSION 时必须同步更新此表；缺失或不匹配直接 fail，防代理/镜像篡改。
const EXPECTED_SHA256 = {
  'mihomo-darwin-arm64-v1.19.25.gz': '0478c9619d327fcb2b8e9998ac278142db931ba2087f1929a84b816a3f570836',
  'mihomo-darwin-amd64-v1.19.25.gz': '946b0c1034782bdb014e92916601f8f1430e3efa8374292fdd8a811457676430',
  'mihomo-linux-amd64-v1.19.25.gz': 'de371dac9f97acc0c1d020d1fbff9ab72ad713bbcb6dfb51bce038a5e6a5430f',
  'mihomo-windows-amd64-v1.19.25.zip': '33a4fbe6af61f200d97493688b636d17b0885a62813e8ed5ad53d5d4655a40ff',
};

// 平台 → [{ url: release 资产, out: 相对 DEST_BASE 的目标文件, gz: 解压方式 }]
function assetsFor(platform) {
  const v = MIHOMO_VERSION;
  if (platform === 'darwin') {
    return [
      { url: `${RELEASE_BASE}/mihomo-darwin-arm64-${v}.gz`, out: 'macos/mihomo', kind: 'gz' },
      { url: `${RELEASE_BASE}/mihomo-darwin-amd64-${v}.gz`, out: 'macos/mihomo-amd64', kind: 'gz' },
    ];
  }
  if (platform === 'linux') {
    return [{ url: `${RELEASE_BASE}/mihomo-linux-amd64-${v}.gz`, out: 'linux/mihomo', kind: 'gz' }];
  }
  if (platform === 'win32') {
    // windows 资产是 zip，内含 mihomo-windows-amd64-<v>.exe，解压后重命名为 mihomo.exe
    return [{ url: `${RELEASE_BASE}/mihomo-windows-amd64-${v}.zip`, out: 'win/mihomo.exe', kind: 'zip' }];
  }
  throw new Error('unsupported platform: ' + platform);
}

function isFetched(relOut) {
  const abs = path.join(DEST_BASE, relOut);
  try {
    return statSync(abs).size > 1024 * 1024; // 真实二进制 ~40MB，>1MB 视为已就绪
  } catch (e) {
    return false;
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function verifySha256(buf, url) {
  const assetName = url.split('/').pop();
  const expected = EXPECTED_SHA256[assetName];
  if (!expected) {
    throw new Error(`no pinned sha256 for ${assetName}（升级 ${MIHOMO_VERSION} 时请同步更新 EXPECTED_SHA256）`);
  }
  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== expected) {
    throw new Error(`sha256 mismatch for ${assetName}:\n  expected ${expected}\n  actual   ${actual}\n  下载内容与官方 digest 不符，拒绝落盘（检查代理/镜像是否被篡改）`);
  }
}

function extractZip(zipPath, destDir) {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`]);
    return;
  }
  // Linux 最小镜像常缺 unzip；按 unzip → bsdtar → python3 顺序尝试
  const candidates = [
    { cmd: 'unzip', args: ['-o', zipPath, '-d', destDir] },
    { cmd: 'bsdtar', args: ['-xf', zipPath, '-C', destDir] },
    { cmd: 'python3', args: ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, destDir] },
  ];
  const errs = [];
  for (const c of candidates) {
    try {
      execFileSync(c.cmd, c.args, { stdio: 'pipe' });
      return;
    } catch (e) {
      errs.push(c.cmd + ': ' + String(e.message).split('\n')[0]);
    }
  }
  throw new Error('zip 解压失败（unzip/bsdtar/python3 均不可用），请安装其一后重试:\n  ' + errs.join('\n  '));
}

async function fetchOne(asset) {
  const outAbs = path.join(DEST_BASE, asset.out);
  if (isFetched(asset.out)) {
    console.log(`[fetch-mihomo] skip (exists): ${asset.out}`);
    return;
  }
  console.log(`[fetch-mihomo] downloading ${asset.url}`);
  const buf = await download(asset.url);
  verifySha256(buf, asset.url);
  mkdirSync(path.dirname(outAbs), { recursive: true });

  if (asset.kind === 'gz') {
    const bin = gunzipSync(buf);
    writeFileSync(outAbs, bin, { mode: 0o755 });
  } else {
    // zip：落临时目录解压，找 mihomo*.exe 移到目标名
    const tmpDir = path.join(DEST_BASE, '.tmp-zip-' + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    try {
      const zipPath = path.join(tmpDir, 'mihomo.zip');
      writeFileSync(zipPath, buf);
      extractZip(zipPath, tmpDir);
      const exe = readdirSync(tmpDir).find((f) => /^mihomo.*\.exe$/i.test(f) && f !== 'mihomo.zip');
      if (!exe) throw new Error('mihomo exe not found inside zip');
      renameSync(path.join(tmpDir, exe), outAbs);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  console.log(`[fetch-mihomo] ok: ${asset.out} (${(statSync(outAbs).size / 1048576).toFixed(1)} MB, sha256 verified)`);
}

async function main() {
  let platform = process.platform;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--all') platform = 'all';
    else if (arg.startsWith('--platform=')) platform = arg.slice('--platform='.length);
  }
  const platforms = platform === 'all' ? ['darwin', 'linux', 'win32'] : [platform];
  for (const p of platforms) {
    for (const asset of assetsFor(p)) {
      await fetchOne(asset);
    }
  }
  console.log('[fetch-mihomo] done');
}

main().catch((e) => {
  console.error('[fetch-mihomo] FAILED:', e.message);
  console.error('[fetch-mihomo] 可手动下载后放入 resources/mihomo/，或配置代理后重试');
  process.exit(1);
});
