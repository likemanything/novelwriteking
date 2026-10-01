/**
 * 简单的固定窗口限流（进程内存）。单实例部署够用；
 * 多实例部署时需要换成共享存储（例如数据库或 Redis）。
 */
import { tooMany } from './errors.ts';

const buckets = new Map<string, { count: number; resetAt: number }>();

export function limit(key: string, max: number, windowMs: number, message?: string) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > max) throw tooMany(message, Math.ceil((b.resetAt - now) / 1000));
}

// 定期清理过期桶，避免内存增长
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref();
