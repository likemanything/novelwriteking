// 密钥守门：扫描被 Git 跟踪的文件，发现疑似 API Key / 私钥就失败。
// 用法：npm run check:secrets（已包含在 npm run check 里）
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

const RULES = [
  ['sk- 开头的 API Key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['Google API Key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['AWS Access Key', /\bAKIA[0-9A-Z]{16}\b/],
  ['私钥', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['写死的 MASTER_KEY / SESSION_SECRET', /^(?:MASTER_KEY|SESSION_SECRET)=[A-Za-z0-9+/=_-]{16,}$/m],
];
const SKIP = /\.(png|jpg|jpeg|webp|ico|zip|woff2?|lock)$|package-lock\.json$/;

const hits = [];
for (const f of files) {
  if (SKIP.test(f)) continue;
  let text;
  try {
    text = readFileSync(resolve(ROOT, f), 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of RULES) if (re.test(text)) hits.push(`${f}：${name}`);
}
if (hits.length) {
  console.error(`发现疑似密钥，请移除后再提交（并在服务商处作废该密钥）：\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`密钥检查通过：${files.length} 个被跟踪文件中没有疑似密钥。`);
