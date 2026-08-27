const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 从 tabbar.js 动态提取 escapeHtml 函数定义范围（不用硬编码 line number）
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js'), 'utf8');

function findEscapeHtmlFn(source) {
  var lines = source.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*function\s+escapeHtml/.test(lines[i])) {
      // 函数起点 = i；终点 = 找到匹配的右大括号（缩进 2 空格的独立 } 行）
      var startLine = i;
      var endLine = i;
      for (var j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '}' && lines[j].startsWith('  ')) { endLine = j; break; }
      }
      return lines.slice(startLine, endLine + 1).join('\n');
    }
  }
  throw new Error('escapeHtml function not found in tabbar.js');
}

var vm = require('node:vm');
function getEscape() {
  var fnSrc = findEscapeHtmlFn(src).replace(/^  function/, 'function');
  var context = { String: String, RegExp: RegExp };
  vm.createContext(context);
  vm.runInContext('var f = ' + fnSrc + '; f', context);
  return context.f;
}

test('escapeHtml 应正确返回输入字符串（回归：三元两支都写 "" 导致永远返回空）', function () {
  var f = getEscape();
  assert.strictEqual(f('hello'), 'hello');
});

test('escapeHtml 正常字符串', function () {
  var f = getEscape();
  assert.strictEqual(f('hello'), 'hello');
  assert.strictEqual(f('订阅管理'), '订阅管理');
  assert.strictEqual(f('a b c 1 2 3'), 'a b c 1 2 3');
});

test('escapeHtml null/undefined', function () {
  var f = getEscape();
  assert.strictEqual(f(null), '');
  assert.strictEqual(f(undefined), '');
});

test('escapeHtml 特殊字符转义', function () {
  var f = getEscape();
  assert.strictEqual(f('<a href="x">y</a>'), '&lt;a href=&quot;x&quot;&gt;y&lt;/a&gt;');
  assert.strictEqual(f('A & B'), 'A &amp; B');
  assert.strictEqual(f("it's"), 'it&#39;s');
});