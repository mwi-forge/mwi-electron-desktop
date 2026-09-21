// lib/captcha-autoslide/drag.js - 浏览器层真实输入事件回放
// 技术红线（issue #47）：只走 webContents.sendInputEvent（浏览器层真实事件，
// isTrusted=true），禁止页面内 dispatchEvent 合成事件（isTrusted=false 会被风控识别）。
// 不触碰游戏 WS 通道——这是纯 UI 层的指针事件。

const DEFAULT_SLEEP = function (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

/**
 * 沿轨迹回放拖拽：mouseDown 起点 → mouseMoved 逐点 → mouseUp 终点。
 * @param {WebContents} wc            目标视图的 webContents（坐标为其视口 CSS px）
 * @param {{points:Array<{x:number,y:number}>, stepMs:number}} path trajectory.buildPath 产物
 * @param {object} [deps] { sleep }   sleep 可注入（单测零等待）
 * @returns {{ok:boolean, moved:number, durationMs:number}}
 */
async function dragHandle(wc, path, deps) {
  deps = deps || {};
  const sleep = deps.sleep || DEFAULT_SLEEP;
  if (!wc || !path || !path.points || path.points.length < 2) {
    return { ok: false, moved: 0, durationMs: 0 };
  }
  const started = Date.now();
  const pts = path.points;
  // sendInputEvent 的 x/y 必须是整数：浮点坐标会直接 throw
  // （2026-09-22 真机踩坑：轨迹含浮点 → 每次拖拽静默异常，手柄从未移动）
  const R = function (v) { return Math.round(v); };

  wc.sendInputEvent({ type: 'mouseDown', x: R(pts[0].x), y: R(pts[0].y), button: 'left', clickCount: 1 });

  let moved = 0;
  for (let i = 1; i < pts.length; i++) {
    await sleep(path.stepMs);
    // button:'left' 随 mouseMove 持续携带，标记按住状态
    // 类型枚举是 mouseMove（Electron 43 d.ts）：'mouseMoved' 会直接 throw Invalid event object
    wc.sendInputEvent({ type: 'mouseMove', x: R(pts[i].x), y: R(pts[i].y), button: 'left' });
    moved++;
  }

  const last = pts[pts.length - 1];
  wc.sendInputEvent({ type: 'mouseUp', x: R(last.x), y: R(last.y), button: 'left', clickCount: 1 });
  return { ok: true, moved: moved, durationMs: Date.now() - started };
}

/**
 * 浏览器层真实单击（拦截页「点击按钮开始验证」、验证失败后的「刷新验证」都走这里，
 * 底稿踩坑 #5：部分弹窗元素对 el.dispatchEvent(click) 无反应，必须是真实指针事件）。
 */
function clickAt(wc, x, y) {
  if (!wc) return false;
  const xi = Math.round(x), yi = Math.round(y);
  wc.sendInputEvent({ type: 'mouseDown', x: xi, y: yi, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: xi, y: yi, button: 'left', clickCount: 1 });
  return true;
}

module.exports = { dragHandle, clickAt };
