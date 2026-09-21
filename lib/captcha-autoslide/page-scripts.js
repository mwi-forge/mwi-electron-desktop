// lib/captcha-autoslide/page-scripts.js - 页内注入脚本（executeJavaScript 胶水层）
// 求解拆成两步（2026-09-22 真机踩坑：页内直接 fetch static.geetest.com 被 CORS 拦）：
//   ① mwiCaptchaExtractGeometry —— 只读 DOM：贴图 URL + 几何 rect（视口 CSS px，
//      与 webContents.sendInputEvent 坐标空间一致）
//   ② buildSolveScript —— 主进程经 net.fetch(视图 session 同代理) 下载 PNG 后，
//      以 data:URL 回传页内：OffscreenCanvas 解码 → match.solve 定位缺口 → dx。
//      data:URL 不触发跨域污染，createImageBitmap/getImageData 可用。

// 页内执行：读取当前验证码状态。返回普通对象（executeJavaScript 可序列化回传）。
// eslint-disable-next-line no-unused-vars
function mwiCaptchaReadState() {
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  function bgUrlOf(el) {
    var m = (getComputedStyle(el).backgroundImage || '').match(/url\("?([^")]+)"?\)/);
    return m ? m[1] : '';
  }
  var st = { slider: null, interstitial: null, ts: Date.now() };

  // 1) 滑块弹窗：以【可见的 bg 贴图 + slice 贴图】直接判定。
  //    注意不能以 geetest_box 可见为门——2026-09-22 真机探针实测 box 外层容器是
  //    1017x0 的零高占位（内部 bg 302x201 / slice 80x80 / btn 81x51 全部可见正常）。
  //    类名带 hash 后缀如 geetest_btn_162bb922，一律前缀匹配（底稿 §6.3）。
  var bg = document.querySelector('[class*="geetest_bg"]');
  var sliceImg = document.querySelector('[class*="geetest_slice_bg"]');
  var btn = document.querySelector('[class*="geetest_btn"]');
  var refresh = document.querySelector('[class*="geetest_refresh"]');
  if (bg && visible(bg) && bgUrlOf(bg) && sliceImg && visible(sliceImg)) {
    st.slider = {
      type: 'slider',
      bgUrl: bgUrlOf(bg),
      sliceUrl: bgUrlOf(sliceImg),
      bgRect: rectOf(bg),
      sliceRect: rectOf(sliceImg),
      btnRect: btn && visible(btn) ? rectOf(btn) : null,
      refreshRect: refresh && visible(refresh) ? rectOf(refresh) : null,
    };
    return st;
  }

  // 2) 拦截页按钮（游戏入口风控「请完成验证码。点击按钮开始验证」）：
  //    无滑块贴图时，找可见、文字含「开始验证」的 geetest 元素；
  //    先按 body 文本快速短路，避免每 tick 全量扫 DOM。
  if (/请完成验证码/.test(document.body ? document.body.innerText : '')) {
    var nodes = document.querySelectorAll('[class*="geetest"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = (el.textContent || '').trim();
      if (text.length > 40) continue;               // 容器元素：跳过
      if (text.indexOf('开始验证') === -1) continue; // 只认「…开始验证」按钮文案
      if (!visible(el)) continue;
      var r = rectOf(el);
      if (r.w < 40 || r.w > 600 || r.h < 20 || r.h > 120) continue;
      st.interstitial = { rect: r };
      return st;
    }
  }

  // 3) 非滑块题型（文字点选/空间推理等）：弹窗内容可见（title 有文字）但拿不到滑块贴图
  //    → 识别后交由上层直接降级，绝不误拖（issue #47 验收 f）。
  var title = document.querySelector('[class*="geetest_title"]');
  if (title && visible(title) && (title.textContent || '').trim()) {
    st.slider = { type: 'other' };
  }
  return st;
}

// 页内执行：只读几何与贴图 URL（不下载，下载在主进程走视图同款代理 session）。
function buildGeometryScript() {
  return '(' + mwiCaptchaExtractGeometry.toString() + ')()';
}

// eslint-disable-next-line no-unused-vars
function mwiCaptchaExtractGeometry() {
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  function bgUrlOf(el) {
    var m = (getComputedStyle(el).backgroundImage || '').match(/url\("?([^")]+)"?\)/);
    return m ? m[1] : '';
  }
  var bg = document.querySelector('[class*="geetest_bg"]');
  var sliceImg = document.querySelector('[class*="geetest_slice_bg"]');
  var btn = document.querySelector('[class*="geetest_btn"]');
  if (!bg || !visible(bg) || !sliceImg || !visible(sliceImg)) {
    return { ok: false, error: 'slider_dom_missing' };
  }
  var bgUrl = bgUrlOf(bg);
  var sliceUrl = bgUrlOf(sliceImg);
  if (!bgUrl || !sliceUrl) return { ok: false, error: 'bg_url_missing' };
  var btnRect = btn && visible(btn) ? rectOf(btn) : null;
  if (!btnRect) return { ok: false, error: 'btn_missing' };
  return {
    ok: true,
    bgUrl: bgUrl,
    sliceUrl: sliceUrl,
    bgRect: rectOf(bg),
    sliceRect: rectOf(sliceImg),
    btnRect: btnRect,
  };
}

// 页内求解脚本：data:URL 解码 → OffscreenCanvas 取像素 → solve（Node 同源实现注入）→ dx。
// 依赖（solve / nativeToCssDx / mwiCaptchaSolveBody）以源码前置注入。
function buildSolveScript(match, bgDataUrl, sliceDataUrl, geo) {
  return (
    'var solve = ' + match.solve.toString() + ';\n' +
    'var nativeToCssDx = ' + match.nativeToCssDx.toString() + ';\n' +
    '(' + mwiCaptchaSolveBody.toString() + ')(' +
      JSON.stringify(bgDataUrl) + ', ' + JSON.stringify(sliceDataUrl) + ', ' +
      JSON.stringify(geo) + ')'
  );
}

// 页内求解执行体（自由变量：solve / nativeToCssDx 由 buildSolveScript 前置注入）
// eslint-disable-next-line no-unused-vars
async function mwiCaptchaSolveBody(bgDataUrl, sliceDataUrl, geo) {
  async function toPixels(dataUrl) {
    var res = await fetch(dataUrl);
    var blob = await res.blob();
    var bmp = await createImageBitmap(blob);
    var cv = new OffscreenCanvas(bmp.width, bmp.height);
    var cx = cv.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    var id = cx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: bmp.width, height: bmp.height, data: id.data };
  }
  try {
    var bgImg = await toPixels(bgDataUrl);
    var slImg = await toPixels(sliceDataUrl);
    // css→native 缩放与拼图块行偏移（底稿 §3.3：每轮几何全变，必须现算）
    var scale = bgImg.width / geo.bgRect.w;
    var oy = Math.round((geo.sliceRect.y - geo.bgRect.y) * scale);
    var r = solve(bgImg, slImg, oy, { debug: true });
    if (!r) return { ok: false, error: 'no_match' };
    if (r.noK) return { ok: false, error: 'no_match', diag: { samples: r.samples, bestAny: r.bestAny, scale: scale, oy: oy, bgW: bgImg.width, bgH: bgImg.height, slW: slImg.width, slH: slImg.height } };
    var dx = nativeToCssDx(r.ox, bgImg.width, geo.bgRect.w);
    var out = { ok: true, ox: r.ox, model: r.model, k: r.k, resid: r.resid, dx: dx, diag: { scale: scale, oy: oy } };
    if (r.debugChampions) out.diag.champions = r.debugChampions;
    return out;
  } catch (e) {
    return { ok: false, error: 'solve_failed: ' + (e && e.message ? e.message : e) };
  }
}

module.exports = { mwiCaptchaReadState, buildGeometryScript, buildSolveScript };
