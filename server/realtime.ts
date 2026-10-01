/**
 * 实时通知：任何一台服务器上发生的变更，经 Postgres 的 LISTEN/NOTIFY 广播给所有服务器，
 * 再通过 SSE 推给浏览器。浏览器收到「有新数据」后自己去拉取，通知本身不携带内容。
 * 多实例部署时不需要额外的消息队列。
 */
import { sql, type Tx } from './db/pool.ts';

const CHANNEL = 'inkloom_events';

export type OrgEvent =
  | { type: 'sync'; seq: number; by?: string }
  | { type: 'lock'; chapterId: string }
  | { type: 'members' }
  | { type: 'models' };

interface Subscriber {
  orgId: string;
  userId: string;
  send: (ev: OrgEvent) => void;
}

const subs = new Map<string, Set<Subscriber>>();

export function subscribe(sub: Subscriber): () => void {
  let set = subs.get(sub.orgId);
  if (!set) subs.set(sub.orgId, (set = new Set()));
  set.add(sub);
  return () => {
    set!.delete(sub);
    if (!set!.size) subs.delete(sub.orgId);
  };
}

export function subscriberCount() {
  let n = 0;
  for (const s of subs.values()) n += s.size;
  return n;
}

/** 在事务里发通知：事务提交后才会真正送达。 */
export async function notifyInTx(tx: Tx, orgId: string, ev: OrgEvent) {
  await tx`select pg_notify(${CHANNEL}, ${JSON.stringify({ o: orgId, e: ev })})`;
}

export function notifyOrg(orgId: string, ev: OrgEvent) {
  sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ o: orgId, e: ev })})`.catch((e) => console.error('[通知] 发送失败', e));
}

let started = false;
export async function startRealtime() {
  if (started) return;
  started = true;
  await sql.listen(CHANNEL, (payload) => {
    try {
      const { o, e } = JSON.parse(payload) as { o: string; e: OrgEvent };
      for (const s of subs.get(o) ?? []) s.send(e);
    } catch (error) {
      console.error('[通知] 无法解析', error);
    }
  });
}
