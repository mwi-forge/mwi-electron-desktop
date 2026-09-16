#!/usr/bin/env node
/**
 * MWI Multi-Account Manager - 应用图标资源生成器
 *
 * 目的：从单一源图 resources/logo.png 生成 electron-builder 需要的
 *       build/icon.ico（Windows）和 build/icon.icns 占位（macOS 用户
 *       自己跑 scripts/build-brand-assets.py 生成正式 ICNS）。
 *
 * 设计要点：
 *   - 纯 Node 实现，零 npm 依赖（避免 sharp/png-to-ico 等 native 包）
 *   - PNG-in-ICO（Vista+ 格式）：把 1024x1024 PNG 直接作为单一 ICONDIRENTRY
 *     嵌入 ICO，width/height 字段填 0 表示"读取 PNG header 实际尺寸"。
 *     Windows 7/8/10/11 都支持，缩放交给 GDI+，任务栏 16/32/48 渲染清晰。
 *   - 幂等：build/ 已存在且比 logo.png 新则跳过（加速 dev 启动）
 *
 * 调用方式：
 *   - node scripts/build-icon-assets.mjs        （npm start 前自动跑）
 *   - npm run build:icons                       （手动触发）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const LOGO_SRC = path.join(ROOT, 'resources', 'logo.png');
const BUILD_DIR = path.join(ROOT, 'build');
const ICO_OUT = path.join(BUILD_DIR, 'icon.ico');

/**
 * 构造 Windows ICO 字节流（PNG-in-ICO 格式，单尺寸 1024x1024）
 *
 * 结构：
 *   ICONDIR (6 bytes)
 *     uint16 reserved = 0
 *     uint16 type     = 1  (ICO)
 *     uint16 count    = 1
 *   ICONDIRENTRY (16 bytes)
 *     uint8  width    = 0  (PNG-in-ICO: 0 means "actual size from PNG header")
 *     uint8  height   = 0
 *     uint8  colors   = 0
 *     uint8  reserved = 0
 *     uint16 planes   = 1
 *     uint16 bitCount = 32
 *     uint32 bytesInRes = <png.length>
 *     uint32 imageOffset = 6 + 16 = 22
 *   <PNG bytes>
 */
function buildIcoFromPng(pngBuffer) {
  const HEADER_SIZE = 6;
  const ENTRY_SIZE = 16;
  const IMAGE_OFFSET = HEADER_SIZE + ENTRY_SIZE;

  const dir = Buffer.alloc(HEADER_SIZE);
  dir.writeUInt16LE(0, 0);                 // reserved
  dir.writeUInt16LE(1, 2);                 // type = ICO
  dir.writeUInt16LE(1, 4);                 // count = 1

  const entry = Buffer.alloc(ENTRY_SIZE);
  entry.writeUInt8(0, 0);                  // width  = 0 → actual
  entry.writeUInt8(0, 1);                  // height = 0 → actual
  entry.writeUInt8(0, 2);                  // colors = 0
  entry.writeUInt8(0, 3);                  // reserved
  entry.writeUInt16LE(1, 4);               // planes
  entry.writeUInt16LE(32, 6);              // bitCount
  entry.writeUInt32LE(pngBuffer.length, 8);// bytesInRes
  entry.writeUInt32LE(IMAGE_OFFSET, 12);    // imageOffset

  return Buffer.concat([dir, entry, pngBuffer]);
}

function ensureBuildDir() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }
}

function shouldRegenerate() {
  // 缺失或源图比产物新 → 重新生成
  if (!fs.existsSync(ICO_OUT)) return true;
  const srcMtime = fs.statSync(LOGO_SRC).mtimeMs;
  const outMtime = fs.statSync(ICO_OUT).mtimeMs;
  return srcMtime > outMtime;
}

function main() {
  if (!fs.existsSync(LOGO_SRC)) {
    console.error('[build-icon-assets] FAIL: 源图不存在 ' + LOGO_SRC);
    process.exit(1);
  }

  ensureBuildDir();

  if (!shouldRegenerate()) {
    console.log('[build-icon-assets] 跳过（build/icon.ico 已存在且比 logo.png 新）');
    return;
  }

  const png = fs.readFileSync(LOGO_SRC);
  const ico = buildIcoFromPng(png);
  fs.writeFileSync(ICO_OUT, ico);

  console.log('[build-icon-assets] 生成 ' + path.relative(ROOT, ICO_OUT));
  console.log('  源图:  ' + path.relative(ROOT, LOGO_SRC) + ' (' + png.length + ' bytes)');
  console.log('  产物:  icon.ico (' + ico.length + ' bytes, PNG-in-ICO Vista+)');
  console.log('  注意:  macOS ICNS 未生成；如需正式 macOS 图标，请运行');
  console.log('         python3 scripts/build-brand-assets.py （需要源图 cow/milk PNG）');
}

main();
await import('./layout-tokens.mjs');

