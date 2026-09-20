// scripts/layout-tokens.mjs - 构建期把 lib/layout-metrics.js 同步进 src/css/tokens.css
// 幂等：数值一致时不写文件。由 build-icon-assets.mjs 在 start/dev/test/build 链路统一触发，
// 也可独立执行：node scripts/layout-tokens.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { LAYOUT, TOKEN_TO_CSS } = require('../lib/layout-metrics');

const cssPath = path.join(here, '..', 'src', 'css', 'tokens.css');
let css = fs.readFileSync(cssPath, 'utf8');
let changed = false;

for (const [key, varName] of Object.entries(TOKEN_TO_CSS)) {
  const re = new RegExp('(' + varName + ':\\s*)\\d+px');
  const next = css.replace(re, '$1' + LAYOUT[key] + 'px');
  if (next !== css) {
    changed = true;
    css = next;
    console.log('[layout-tokens] ' + varName + ' -> ' + LAYOUT[key] + 'px');
  }
}

if (changed) {
  fs.writeFileSync(cssPath, css);
  console.warn('[layout-tokens] tokens.css 与 lib/layout-metrics.js 不同步，已再生覆盖；请勿手改 tokens.css（会被覆盖），改 lib/layout-metrics.js');
  console.log('[layout-tokens] tokens.css synced from lib/layout-metrics.js');
}
