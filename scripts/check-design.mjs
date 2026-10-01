// 设计体系守门：禁止回到零散字号。全站字号必须使用 text-fs-*（见 docs/design-system.md）。
// 用法：npm run check:design
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../src');
const ALLOWED_DISPLAY = new Set([32, 34, 44]); // 少数大号展示字
const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/text-\[([0-9.]+)px\]/g)) {
        if (!ALLOWED_DISPLAY.has(Number(m[1]))) bad.push(`${p.replace(ROOT, 'src')}: ${m[0]}`);
      }
    }
  }
}
walk(ROOT);
if (bad.length) {
  console.error(`发现 ${bad.length} 处零散字号，请改用 text-fs-2xs / xs / sm / base / md / lg / xl / 2xl：\n${bad.slice(0, 20).join('\n')}`);
  process.exit(1);
}
console.log('字阶检查通过：没有零散字号。');
