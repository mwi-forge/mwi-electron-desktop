// lib/__tests__/captcha-trajectory.test.js - 人手轨迹纯函数单测（issue #47）
// 验收要点：15 点 / x 单调递增 / 终点精确 = start+dx（底稿踩坑 #7：过冲 = 失败）/
// y 抖动 ±1.5px / stepMs ≈ totalMs/(n-1)。
// 运行：node --test lib/__tests__/captcha-trajectory.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPath } = require('../captcha-autoslide/trajectory');

test('默认参数：15 点、终点精确、x 单调、y 在 ±1.5 内', () => {
  const jitter = [];
  const p = buildPath(
    { startX: 529.6, startY: 461.9, dx: 197 },
    { jitterFn: () => { const v = (jitter.length % 2 === 0 ? 1 : -1) * 1.5; jitter.push(v); return v; } },
  );
  assert.strictEqual(p.points.length, 15);
  assert.strictEqual(p.points[0].x, 529.6);
  const last = p.points[p.points.length - 1];
  assert.ok(Math.abs(last.x - (529.6 + 197)) < 1e-9, '终点必须精确 = start+dx, got ' + last.x);
  for (let i = 1; i < p.points.length; i++) {
    assert.ok(p.points[i].x >= p.points[i - 1].x, 'x 必须单调不减');
    assert.ok(Math.abs(p.points[i].y - 461.9) <= 1.5 + 1e-9, 'y 抖动越界: ' + p.points[i].y);
  }
  // 底稿节奏：~1.5s 总时长
  assert.ok(Math.abs(p.stepMs - Math.round(1500 / 14)) <= 1, 'stepMs=' + p.stepMs);
});

test('前快后慢：相邻步长逐段递减（ease-out）', () => {
  const p = buildPath({ startX: 0, startY: 0, dx: 100 }, { jitterFn: () => 0 });
  const mid = p.points[7].x;                    // 第 8 点（t=0.5 → eased 0.75）
  assert.ok(mid > 55, '前半程应走完 >55% 位移, got ' + mid);
  const firstStep = p.points[1].x - p.points[0].x;
  const lateStep = p.points[11].x - p.points[10].x;
  assert.ok(firstStep > lateStep, '步长应递减（前快后慢）: ' + firstStep + ' vs ' + lateStep);
});

test('非法 dx：返回空路径', () => {
  assert.strictEqual(buildPath({ startX: 1, startY: 1, dx: 0 }).points.length, 0);
  assert.strictEqual(buildPath({ startX: 1, startY: 1, dx: -5 }).points.length, 0);
  assert.strictEqual(buildPath(null).points.length, 0);
});

test('默认 jitterFn：随机抖动落在 ±amp 内', () => {
  const p = buildPath({ startX: 0, startY: 100, dx: 50 });  // 默认 Math.random
  for (const pt of p.points) {
    assert.ok(pt.y >= 98.5 && pt.y <= 101.5, 'y=' + pt.y);
  }
});
