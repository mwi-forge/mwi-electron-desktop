// lib/captcha-autoslide/match.js - GeeTest v4 滑块缺口定位（亮度回归模板匹配）
// 算法来自思源底稿《20260922-GeeTest滑块验证码自动化求解实录》§3.3（真机 1 次通过验证）：
// 拼图块 PNG 是缺口区域的原像素 + 透明通道，缺口在底图中被半透明暗化叠加，
// 满足线性模型 bg ≈ k×slice + c（实测 k≈0.59）。全列扫描取残差最小且 k∈[kMin,kMax] 的偏移。
//
// 纯函数、零 DOM 依赖：页内侧经 page-scripts.js 以 fn.toString() 注入 OffscreenCanvas 场景，
// Node 侧直接喂数组跑单测。所有入参为 { width, height, data:RGBA } 像素结构。

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// 取 (img, x, y) 的亮度；越界返回 null（调用方跳过该样本）
function lumAt(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  const i = (y * img.width + x) * 4;
  return luminance(img.data[i], img.data[i + 1], img.data[i + 2]);
}

/**
 * 在底图 bg 的 oy 行上扫描拼图块 slice 的水平落点。
 * 本函数会以 fn.toString() 整体注入页内执行：内部使用的辅助函数（lumAt）必须
 * 嵌套在函数体内，页面作用域访问不到模块级符号（2026-09-22 真机踩坑 ×2：
 * DEFAULTS is not defined / lumAt is not defined）。
 * @param {{width:number,height:number,data:ArrayLike}} bg   底图 RGBA
 * @param {{width:number,height:number,data:ArrayLike}} slice 拼图块 RGBA（alpha>128 为块像素）
 * @param {number} oy       拼图块在底图中的行偏移（原生 px，由调用方按元素几何换算）
 * @param {object} [opts]   { step, kMin, kMax }
 * @returns {{ox:number,k:number,c:number,resid:number,samples:number}|null}
 *          null = 无有效样本或无候选满足 k 区间
 */
function solve(bg, slice, oy, opts) {
  opts = opts || {};
  // 默认值必须内联为字面量（理由同上）
  const step = opts.step || 2;        // 拼图块采样步长：2 = 隔行隔列采样，精度足够、速度 ~4x
  const kMin = typeof opts.kMin === 'number' ? opts.kMin : 0.3;   // 暗化系数下限（踩坑清单 #1）
  const kMax = typeof opts.kMax === 'number' ? opts.kMax : 1.2;   // 暗化系数上限
  if (!bg || !slice || !bg.data || !slice.data) return null;

  // 嵌套辅助：取 (img, x, y) 亮度，越界返回 null（调用方跳过该样本）
  function lumAt(img, x, y) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
    const i = (y * img.width + x) * 4;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  }

  // 1) alpha 掩码采样拼图块像素（踩坑 #1：必须带 alpha 掩码，透明区不参与回归）
  const xs = [];
  const ysBase = [];   // slice 像素坐标
  for (let iy = 0; iy < slice.height; iy += step) {
    for (let ix = 0; ix < slice.width; ix += step) {
      const a = slice.data[(iy * slice.width + ix) * 4 + 3];
      if (a > 128) {
        xs.push(lumAt(slice, ix, iy));
        ysBase.push([ix, iy]);
      }
    }
  }
  const n = xs.length;
  if (n < 8) return null;  // 样本过少（贴图异常）直接放弃，不瞎猜

  const sliceMean = xs.reduce((a, b) => a + b, 0) / n;

  // 2) 全列扫描，双模型评分（2026-09-22 真机实测：GeeTest 缺口渲染有两种风格——
  //    「暗化透底」线性模型可解（k≈0.59，底稿验证）；「平板填充」缺口为常数色块，
  //    线性 k≈0 不适用，需方差模型（缺口处 bg 方差≈0）。策略：优先线性命中，
  //    无线性候选时回退平坦区模型（真缺口方差≈0.2，远小于照片纹理区域）。
  let bestLin = null;
  let bestFlat = null;
  let bestAny = null;   // 不做 k 过滤的线性全局最优（诊断用）
  const maxX = bg.width - slice.width;
  for (let ox = 0; ox <= maxX; ox++) {
    const ys = new Array(n);
    let valid = true;
    for (let j = 0; j < n; j++) {
      const ly = lumAt(bg, ox + ysBase[j][0], oy + ysBase[j][1]);
      if (ly === null) { valid = false; break; }
      ys[j] = ly;
    }
    if (!valid) continue;

    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, varY = 0;
    for (let j = 0; j < n; j++) {
      const dxs = xs[j] - sliceMean;
      const dy = ys[j] - meanY;
      sxy += dxs * dy;
      sxx += dxs * dxs;
      varY += dy * dy;
    }
    varY /= n;
    // 平坦模型：缺口为常数填充 → bg 亮度方差趋近 0
    if (!bestFlat || varY < bestFlat.resid) {
      bestFlat = { ox: ox, model: 'flat', resid: varY, samples: n };
    }
    if (sxx === 0) continue;
    const k = sxy / sxx;
    const c = meanY - k * sliceMean;
    let resid = 0;
    for (let j = 0; j < n; j++) {
      const e = ys[j] - (k * xs[j] + c);
      resid += e * e;
    }
    resid /= n;
    if (!bestAny || resid < bestAny.resid) bestAny = { ox: ox, k: k, c: c, resid: resid, samples: n };
    if (!(k >= kMin && k <= kMax)) continue;   // 暗化系数区间过滤
    if (!bestLin || resid < bestLin.resid) {
      bestLin = { ox: ox, model: 'linear', k: k, c: c, resid: resid, samples: n };
    }
  }
  // 判别规则（2026-09-22 真机 attempt 日志教训：平板风格下照片纹理会产生大量
  // k∈[0.3,1.2] 的垃圾线性拟合 resid 90~900，绝不能无条件优先线性）：
  //   平坦 champion 近完美（resid ≤ flatResidMax≈30，即 RMS≈5.5）且比线性 champion
  //   好一个量级 → 平板填充风格，取平坦缺口；否则取线性缺口（暗化风格）。
  const flatResidMax = typeof opts.flatResidMax === 'number' ? opts.flatResidMax : 30;
  const flatDominance = typeof opts.flatDominance === 'number' ? opts.flatDominance : 10;
  let best = null;
  if (bestLin && bestFlat) {
    best = (bestFlat.resid <= flatResidMax && bestLin.resid > bestFlat.resid * flatDominance) ? bestFlat : bestLin;
  } else {
    best = bestLin || bestFlat;
  }
  if (opts.debug) {
    if (best) best.debugChampions = { lin: bestLin, flat: bestFlat };
    else return { noK: true, samples: n, bestAny: bestAny };
  }
  return best;
}

/**
 * 原生像素偏移 → 手柄需拖动的 CSS px 距离。
 * 手柄位移 : 拼图块位移 = 1:1（底稿 §2.2 实测），缺口在底图原生坐标 ox，
 * 底图元素被缩放为 bgElWidth CSS px，故 dx = ox × (bgElWidth / bgImgWidth)。
 */
function nativeToCssDx(ox, bgImgWidth, bgElWidth) {
  if (!(bgImgWidth > 0) || !(bgElWidth > 0)) return 0;
  return (ox * bgElWidth) / bgImgWidth;
}

module.exports = { solve, nativeToCssDx, luminance };
