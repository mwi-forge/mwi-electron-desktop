// lib/__tests__/captcha-match.test.js - 缺口定位纯函数单测（issue #47）
// 用合成图验证：亮度回归能在已知 ox 处零残差命中、k 区间过滤拒绝异常暗化、
// 样本不足返回 null。同一份 solve 函数同时被 page-scripts 注入页内执行。
// 注意：solve 默认 step=2（x/y 均隔 2 采样），合成图案必须保证偶数列间存在亮度对比，
// 故用「成对竖条纹」而不是 (x+y)%2 棋盘（后者在偶数网格上退化为常数，sxx=0）。
// 运行：node --test lib/__tests__/captcha-match.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { solve, nativeToCssDx } = require('../captcha-autoslide/match');

// 灰度便捷构造：v(x,y) -> 0..255；alpha 恒 255
function gray(width, height, v) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = Math.max(0, Math.min(255, Math.round(v(x, y))));
      data[i] = l; data[i + 1] = l; data[i + 2] = l; data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function withAlpha(img, mask) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      img.data[(y * img.width + x) * 4 + 3] = mask(x, y) ? 255 : 0;
    }
  }
  return img;
}

// 成对竖条纹：x=0,1→A；x=2,3→B…… 偶数采样步长下仍保持双值对比
const stripes = (a, b) => (x) => (Math.floor(x / 2) % 2 === 0 ? a : b);

test('solve：背景均匀 + 已知 ox 处 k 暗化区域 → 零残差命中', () => {
  const OX = 123, OY = 82, K = 0.6, C = 20;
  // 拼图块：竖条纹（保证 sxx>0），中心 56x56 区域不透明
  const slice = gray(60, 60, stripes(220, 60));
  withAlpha(slice, (x, y) => x >= 2 && x < 58 && y >= 2 && y < 58);

  // 底图：纯均匀背景，缺口区域 = K*slice + C
  const bg = gray(300, 200, () => 150);
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 60; x++) {
      const i = ((OY + y) * 300 + (OX + x)) * 4;
      const s = slice.data[(y * 60 + x) * 4];
      const l = Math.round(K * s + C);
      bg.data[i] = l; bg.data[i + 1] = l; bg.data[i + 2] = l;
    }
  }

  const r = solve(bg, slice, OY);
  assert.ok(r, '应命中');
  assert.strictEqual(r.ox, OX);
  assert.ok(Math.abs(r.k - K) < 0.02, 'k≈0.6, got ' + r.k);
  assert.ok(r.resid < 1, 'resid≈0, got ' + r.resid);
  assert.ok(r.samples > 0);
});

test('solve：平板填充风格（缺口为常数色块）→ 平坦模型命中', () => {
  // 2026-09-22 真机风格：缺口区域不是暗化透底，而是近似常数色块（方差≈0）。
  // 背景=确定性纹理，仅 gap 区域涂成常数 203。
  const OX = 123, OY = 82;
  const slice = gray(60, 60, stripes(220, 60));
  withAlpha(slice, (x, y) => x >= 2 && x < 58 && y >= 2 && y < 58);
  const bg = gray(300, 200, (x, y) => 120 + ((x * 7 + y * 13) % 60));
  // 仅在 alpha 掩码范围内涂平坦色（与采样范围一致，避免制造多像素宽的零方差平台）
  for (let y = 2; y < 58; y++) {
    for (let x = 2; x < 58; x++) {
      const i = ((OY + y) * 300 + (OX + x)) * 4;
      bg.data[i] = 203; bg.data[i + 1] = 203; bg.data[i + 2] = 203;
    }
  }
  const r = solve(bg, slice, OY);
  assert.ok(r, '应命中');
  assert.strictEqual(r.model, 'flat');
  assert.strictEqual(r.ox, OX);
  assert.ok(r.resid < 1, '平坦区残差应≈0, got ' + r.resid);
});

test('solve：k 越界的真实缺口位置永远不会被返回（深色画稿误配防护）', () => {
  // 唯一精确匹配区用 k=2.0（亮化，越界）合成：ox=77 处残差本应为 0 但被 kMax 过滤。
  // 算法保证：任何返回的候选要么 null，要么不在 k=2.0 的真实位置上、且 k∈[0.3,1.2]。
  const slice = gray(40, 40, stripes(40, 20));
  withAlpha(slice, (x, y) => x >= 1 && y >= 1);
  const bg = gray(200, 100, () => 100);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const i = ((30 + y) * 200 + (77 + x)) * 4;
      const s = slice.data[(y * 40 + x) * 4];
      const l = Math.round(2.0 * s);   // k=2 越界（40→80, 20→40，不触顶）
      bg.data[i] = l; bg.data[i + 1] = l; bg.data[i + 2] = l;
    }
  }
  const r = solve(bg, slice, 30);
  if (r !== null) {
    assert.notStrictEqual(r.ox, 77, 'k=2.0 的真实位置必须被 k 区间过滤');
    if (r.model === 'linear') {
      assert.ok(r.k >= 0.3 && r.k <= 1.2, '线性候选的 k 必须在区间内');
    }
  }
});

test('solve：alpha 全透明 → 样本不足返回 null', () => {
  const slice = gray(40, 40, () => 128);
  withAlpha(slice, () => false);
  const bg = gray(200, 100, () => 100);
  assert.strictEqual(solve(bg, slice, 10), null);
});

test('nativeToCssDx：底稿实测换算（ox=196, 300 原生 → 301.8 CSS）', () => {
  const dx = nativeToCssDx(196, 300, 301.8);
  assert.ok(Math.abs(dx - 197.176) < 0.01, 'dx=' + dx);
});

test('nativeToCssDx：非法尺寸回退 0', () => {
  assert.strictEqual(nativeToCssDx(10, 0, 100), 0);
  assert.strictEqual(nativeToCssDx(10, 100, 0), 0);
});
