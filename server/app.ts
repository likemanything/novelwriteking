/** 组装接口应用：安全头、来源校验、会话、各模块路由、统一错误格式。 */
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { adminRoutes } from './admin.ts';
import { aiRoutes } from './ai.ts';
import { dramaRoutes } from './drama.ts';
import { mediaRoutes, providerRoutes } from './media.ts';
import { authRoutes, meRoutes, sessionMiddleware } from './auth.ts';
import { config } from './config.ts';
import { sql } from './db/pool.ts';
import type { AppEnv } from './http.ts';
import { HttpError } from './lib/errors.ts';
import { invitationRoutes, orgRoutes } from './orgs.ts';
import { lockRoutes, syncRoutes } from './sync.ts';

/** 写操作必须来自本站页面，防止其它网站借用户的登录状态发请求（CSRF）。 */
function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (origin === config.publicOrigin) return true;
  if (!config.production) {
    try {
      const a = new URL(origin);
      const b = new URL(config.publicOrigin);
      return ['127.0.0.1', 'localhost'].includes(a.hostname) && ['127.0.0.1', 'localhost'].includes(b.hostname) && a.port === b.port;
    } catch {
      return false;
    }
  }
  return false;
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: undefined }));

  app.use('/api/*', async (c, next) => {
    c.header('cache-control', 'no-store');
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !allowedOrigin(c.req.header('origin'))) {
      return c.json({ error: { code: 'bad_origin', message: `请求来源不被允许，请通过 ${config.publicUrl} 访问墨织` } }, 403);
    }
    await next();
  });
  app.use('/api/*', sessionMiddleware);

  app.get('/api/health', async (c) => {
    await sql`select 1`;
    return c.json({ ok: true });
  });

  app.route('/api/auth', authRoutes);
  app.route('/api/me', meRoutes);
  app.route('/api/orgs', orgRoutes);
  app.route('/api/invitations', invitationRoutes);
  app.route('/api/sync', syncRoutes);
  app.route('/api/locks', lockRoutes);
  app.route('/api/ai', aiRoutes);
  app.route('/api/drama', dramaRoutes);
  app.route('/api/providers', providerRoutes);
  app.route('/api/media', mediaRoutes);
  app.route('/api/admin', adminRoutes);

  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      if (err.extra?.retryAfter) c.header('retry-after', String(err.extra.retryAfter));
      return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status as 400);
    }
    console.error('[服务端错误]', c.req.method, c.req.path, err);
    return c.json({ error: { code: 'internal', message: '服务器出了点问题，请稍后重试' } }, 500);
  });

  return app;
}
