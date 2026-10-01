// 一键准备开发环境：生成 .env（随机密钥）→ 启动开发数据库 → 执行数据库迁移
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV = resolve(ROOT, '.env');

if (!existsSync(ENV)) {
  const text = readFileSync(resolve(ROOT, '.env.example'), 'utf8')
    .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(32).toString('base64url')}`)
    .replace(/^MASTER_KEY=.*$/m, `MASTER_KEY=${randomBytes(32).toString('base64')}`);
  writeFileSync(ENV, text, { mode: 0o600 });
  console.log('已生成 .env（包含随机生成的开发密钥）');
} else {
  console.log('.env 已存在，跳过生成');
}

execFileSync('node', ['scripts/dev-db.mjs', 'start'], { cwd: ROOT, stdio: 'inherit' });
execFileSync('npx', ['tsx', 'server/cli.ts', 'migrate'], { cwd: ROOT, stdio: 'inherit' });
console.log('\n准备完成。运行 npm run dev 启动开发服务器。');
