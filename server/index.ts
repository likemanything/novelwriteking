/**
 * 墨织服务端入口：接口 + 前端静态文件。
 *   开发：npm run dev（前端走 Vite 热更新，接口由本文件提供）
 *   生产：npm run build && npm start
 */
import { serve } from '@hono/node-server';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from './app.ts';
import { recoverDrama } from './drama.ts';
import { assertConfig, config } from './config.ts';
import { assertSafeRole, migrate, sql } from './db/pool.ts';
import { startRealtime } from './realtime.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function main() {
  assertConfig();
  await assertSafeRole();
  if (process.env.AUTO_MIGRATE !== 'false') await migrate();
  await startRealtime();
  await recoverDrama();

  const app = createApp();
  const hasDist = existsSync(join(config.distDir, 'index.html'));

  // 前端静态文件与单页应用回退（开发模式下前端由 Vite 提供）
  if (hasDist) {
    app.get('*', (c) => {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(c.req.url).pathname);
      } catch {
        return c.text('Bad Request', 400);
      }
      let file = normalize(join(config.distDir, pathname));
      if (!file.startsWith(config.distDir)) return c.text('Forbidden', 403);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(config.distDir, 'index.html');
      const ext = extname(file);
      const headers: Record<string, string> = { 'content-type': MIME[ext] ?? 'application/octet-stream' };
      headers['cache-control'] = file.includes(`${join(config.distDir, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
    });
  }

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`墨织服务已启动 → http://${info.address}:${info.port}${hasDist ? '' : '（仅接口；前端请用 npm run dev）'}`);
    console.log(`对外地址：${config.publicUrl} · 注册方式：${config.signupMode === 'invite' ? '邀请制' : '开放注册'} · 短信：${config.smsProvider === 'console' ? '开发模式（验证码打印在日志里）' : '阿里云'}`);
  });

  const shutdown = async () => {
    server.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
