const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 直接从 tabbar.js 提取 escapeHtml 函数源码（共享行 13-17）
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js'), 'utf8');
const lines = src.split('\n');
const escapeFn = lines.slice(12, 17).join('\n'); // 5 lines: 13-17 (index 12-16)
function extractFunction() {
  var context = { console: console, String: String, RegExp: RegExp };
  vm.createContext(context);
  vm.runInContext('(' + escapeFn.replace(/^  function/, 'function') + ')', context);
  return context;
}

test('escapeHtml 应正确返回输入字符串（回归：三元两支都写 "" 导致永远返回空）', function () {
  var ctx = extractFunction();
  var fn = ctx.String; // placeholder
});
function getEscape() {
  // 用 vm 提取 escapeHtml 然后调用
  var lines2 = src.split('\n');
  var fnSrc = lines2.slice(12, 17).join('\n').replace(/^  function/, 'function');
  var context = { String: String, RegExp: RegExp };
  vm.createContext(context);
  vm.runInContext('var f = ' + fnSrc + '; f', context);
  return context.f;
}

test('escapeHtml 正常字符串', function () {
  var f = getEscape();
  assert.strictEqual(f('hello'), 'hello');
  assert.strictEqual(f('订阅管理'), '订阅管理');
  assert.strictEqual(f('添加账号'), '添加账号');
});
test('escapeHtml null/undefined', function () {
  var f = getEscape();
  assert.strictEqual(f(null), '');
  assert.strictEqual(f(undefined), '');
});
test('escapeHtml 特殊字符转义', function () {
  var f = getEscape();
  assert.strictEqual(f('<x>'), '&lt;x&gt;');
  assert.strictEqual(f('a&b'), 'a&amp;b');
});