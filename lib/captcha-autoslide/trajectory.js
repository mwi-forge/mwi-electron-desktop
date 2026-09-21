// lib/captcha-autoslide/trajectory.js - 人手轨迹合成（纯函数）
// 参数模板来自思源底稿 §3.4（真机通过轨迹）：15 点 / 总时长 ~1.6s / y 抖动 ±1.5px /
// x 单调递增、终点精确等于 start+dx（踩坑 #7：过冲不回拉 = 直接失败）。
// 节奏前快后慢（ease-out），模拟人手起手快、临近缺口减速对齐的习惯。

const DEFAULTS = {
  pointCount: 15,     // 路径点数（含起点终点）
  totalMs: 1500,      // 期望总时长（真实节奏落在 1.5s 上下；底稿实测区间 1.6~1.7s 留了事件开销余量）
  jitterAmp: 1.5,     // y 抖动幅度 px
};

/**
 * @param {{startX:number,startY:number,dx:number}} p
 * @param {object} [opts] { pointCount, totalMs, jitterAmp, jitterFn } jitterFn(amp)->number 可注入（单测确定性）
 * @returns {{points:Array<{x:number,y:number}>, stepMs:number}}
 */
function buildPath(p, opts) {
  opts = opts || {};
  const n = opts.pointCount || DEFAULTS.pointCount;
  const totalMs = opts.totalMs || DEFAULTS.totalMs;
  const amp = typeof opts.jitterAmp === 'number' ? opts.jitterAmp : DEFAULTS.jitterAmp;
  const jitterFn = opts.jitterFn || function (a) { return (Math.random() * 2 - 1) * a; };
  if (!(p && p.dx > 0)) return { points: [], stepMs: 0 };

  const points = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);              // 0..1
    const eased = 1 - (1 - t) * (1 - t); // ease-out：前快后慢
    const last = i === n - 1;
    points.push({
      // 终点必须精确等于 start+dx（踩坑 #7），中间点按缓动曲线推进
      x: last ? p.startX + p.dx : p.startX + p.dx * eased,
      y: p.startY + (last ? jitterFn(amp) : jitterFn(amp)),
    });
  }
  points[0].x = p.startX;  // 起点精确在按钮中心（down 事件位置）
  const stepMs = Math.round(totalMs / (n - 1));
  return { points: points, stepMs: stepMs };
}

module.exports = { buildPath, DEFAULTS };
