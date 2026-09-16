#!/usr/bin/env node
// coverage-diff-gate.mjs — diff 行覆盖率门禁（GHA pr-check 用）
// 用法: node scripts/coverage-diff-gate.mjs --coverage coverage/coverage-final.json --base origin/main --diff-lines 70
// 口径: 仅统计 git diff(base...HEAD) 新增/修改行中落在「测试实际加载文件」语句范围内的行；
//       未被任何测试加载的 js 文件单独列 WARNING，不计入分母（electron 主进程等无法单测加载的代码不误伤）。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { diffLines: 70, head: 'HEAD' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--coverage') args.coverage = argv[++i];
    else if (k === '--base') args.base = argv[++i];
    else if (k === '--head') args.head = argv[++i];
    else if (k === '--diff-lines') args.diffLines = Number(argv[++i]);
    else throw new Error(`未知参数: ${k}`);
  }
  if (!args.coverage || !args.base) {
    throw new Error('缺少 --coverage 或 --base 参数');
  }
  return args;
}

function changedLinesByFile(base, head) {
  const diff = execFileSync('git', [
    'diff', '-U0', '--no-color', `${base}...${head}`,
    '--', '*.js', '*.mjs', '*.cjs',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  const result = new Map();
  let file = null;
  let newLine = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      if (file === '/dev/null') file = null;
      else if (!result.has(file)) result.set(file, new Set());
    } else if (line.startsWith('@@')) {
      const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) newLine = Number(hunk[1]);
    } else if (file && line.startsWith('+')) {
      result.get(file).add(newLine);
      newLine++;
    } else if (file && (line.startsWith(' ') || line === '')) {
      newLine++;
    }
  }
  return result;
}

function findCoverageEntry(coverage, file) {
  const suffix = `/${file}`;
  for (const key of Object.keys(coverage)) {
    if (key === file || key.endsWith(suffix)) return coverage[key];
  }
  return null;
}

function classifyLines(entry, lines) {
  const statements = Object.keys(entry.statementMap || {}).map((id) => ({
    start: entry.statementMap[id].start.line,
    end: entry.statementMap[id].end.line,
    count: entry.s[id] || 0,
  }));
  let executable = 0;
  let covered = 0;
  for (const ln of lines) {
    const hit = statements.find((st) => ln >= st.start && ln <= st.end);
    if (!hit) continue;
    executable++;
    if (hit.count > 0) covered++;
  }
  return { executable, covered };
}

const args = parseArgs(process.argv);
if (!fs.existsSync(args.coverage)) {
  console.log(`WARNING: 覆盖率文件不存在（${args.coverage}），无插桩数据，diffLines 门禁空转通过`);
  process.exit(0);
}
const coverage = JSON.parse(fs.readFileSync(args.coverage, 'utf8'));
if (Object.keys(coverage).length === 0) {
  console.log('WARNING: 覆盖率报告为空（当前测试范围无 V8 可插桩模块），diffLines 门禁空转通过');
  process.exit(0);
}
const changed = changedLinesByFile(args.base, args.head);

let totalExecutable = 0;
let totalCovered = 0;
const unloaded = [];

for (const [file, lines] of changed) {
  if (lines.size === 0) continue;
  const entry = findCoverageEntry(coverage, file);
  if (!entry) {
    unloaded.push(file);
    continue;
  }
  const { executable, covered } = classifyLines(entry, lines);
  totalExecutable += executable;
  totalCovered += covered;
  const pct = executable > 0 ? ((covered / executable) * 100).toFixed(1) : 'n/a';
  console.log(`  ${file}: ${covered}/${executable} 行覆盖 (${pct}%)`);
}

if (unloaded.length > 0) {
  console.log('\nWARNING: 以下改动文件未被任何测试加载，不计入 diffLines 统计:');
  for (const f of unloaded) console.log(`  - ${f}`);
}

if (totalExecutable === 0) {
  console.log('\ndiffLines 门禁: 无可统计的已加载改动行，视为通过');
  process.exit(0);
}

const totalPct = (totalCovered / totalExecutable) * 100;
const ok = totalPct >= args.diffLines;
console.log(`\ndiffLines 门禁: ${totalCovered}/${totalExecutable} 行覆盖 (${totalPct.toFixed(1)}%)，阈值 ${args.diffLines}% → ${ok ? '通过' : '不通过'}`);
process.exit(ok ? 0 : 1);
