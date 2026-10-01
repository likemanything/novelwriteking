// 开发模式：同时启动接口服务（4318，代码改动自动重启）和前端（5173，热更新）。
// 前端把 /api 请求转发到接口服务，所以浏览器只需要打开 http://127.0.0.1:5173
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const procs = [
  { name: '接口', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev:api'] },
  { name: '前端', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev:web'] },
];

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${p.color}[${p.name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (buf) => {
      for (const line of buf.toString().split('\n')) if (line.trim()) out.write(prefix + line + '\n');
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}已退出（${code}）`);
    shutdown();
  });
  return child;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
