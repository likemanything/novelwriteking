/**
 * 写作数据同步。
 *
 * 浏览器在本地数据库里编辑，变更按行推送到这里；服务端按角色权限、章节锁逐条裁决，
 * 接受的写入分配一个递增序号（seq），其他成员按序号拉取增量。
 * 同一组织的推送串行执行，保证序号顺序与提交顺序一致，拉取不会漏行。
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import type { ChapterLockInfo, PullChange, PullResponse, PushResult, SyncChange } from '@/shared/api';
import { atLeast, checkWrite, isSyncTable, SYNC_ORDER, type SyncTable } from '@/shared/permissions';
import { withTenant } from './db/pool.ts';
import { readJson, requireOrg, roleInProject, type AppEnv } from './http.ts';
import { badRequest, conflict, forbidden, HttpError } from './lib/errors.ts';
import { notifyInTx, notifyOrg, subscribe } from './realtime.ts';

const MAX_CHANGES = 500;
const MAX_ROW_BYTES = 4 * 1024 * 1024;
const LOCK_TTL_MS = 75_000;

type Row = Record<string, unknown>;

interface RecordRow {
  tbl: SyncTable;
  id: string;
  project_id: string;
  data: Row | null;
  deleted: boolean;
}

export const syncRoutes = new Hono<AppEnv>();

const tooLarge = () => {
  throw new HttpError(413, 'too_large', '一次提交的内容太大，请稍后重试');
};

syncRoutes.post('/push', bodyLimit({ maxSize: 16 * 1024 * 1024, onError: tooLarge }), async (c) => {
  const org = await requireOrg(c);
  const body = await readJson<{ changes?: SyncChange[] }>(c);
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length > MAX_CHANGES) throw badRequest('一次提交的修改太多');

  const results: PushResult[] = [];
  const valid: SyncChange[] = [];
  for (const ch of changes) {
    const table = ch?.table;
    const id = ch?.id;
    const reject = (reason: string) => results.push({ table, id, ok: false, reason, server: null });
    if (!isSyncTable(table) || typeof id !== 'string' || !id || id.length > 120) {
      reject('数据格式不正确');
      continue;
    }
    if (ch.row !== null && (typeof ch.row !== 'object' || Array.isArray(ch.row) || ch.row.id !== id)) {
      reject('数据格式不正确');
      continue;
    }
    if (ch.row && JSON.stringify(ch.row).length > MAX_ROW_BYTES) {
      reject('这一条内容超过 4MB，无法保存');
      continue;
    }
    valid.push(ch);
  }
  // 新建先父后子，删除先子后父
  valid.sort((a, b) => (a.row ? SYNC_ORDER[a.table] : 20 - SYNC_ORDER[a.table]) - (b.row ? SYNC_ORDER[b.table] : 20 - SYNC_ORDER[b.table]));

  if (valid.length) {
    const out = await withTenant(org.orgId, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${org.orgId}))`;
      const tbls = valid.map((v) => v.table);
      const ids = valid.map((v) => v.id);
      const existing = new Map<string, RecordRow>();
      for (const r of await tx<RecordRow[]>`
        select tbl, id, project_id, data, deleted from records
        where (tbl, id) in (select * from unnest(${tbls}::text[], ${ids}::text[]))`)
        existing.set(`${r.tbl}\u0000${r.id}`, r);

      const projectIds = new Set<string>();
      for (const v of valid) {
        if (v.table === 'projects') projectIds.add(v.id);
        else if (typeof v.row?.projectId === 'string') projectIds.add(v.row.projectId);
      }
      const liveProjects = new Set(
        (await tx<{ id: string }[]>`select id from records where tbl = 'projects' and id = any(${[...projectIds]}) and not deleted`).map((r) => r.id),
      );
      const locks = new Map(
        (await tx<{ chapter_id: string; user_id: string; user_name: string }[]>`select chapter_id, user_id, user_name from chapter_locks where expires_at > now()`).map((l) => [l.chapter_id, l]),
      );

      const res: PushResult[] = [];
      let maxSeq = 0;
      for (const ch of valid) {
        const key = `${ch.table}\u0000${ch.id}`;
        const rec = existing.get(key);
        const prev = rec && !rec.deleted ? rec.data : null;
        const next = ch.row;
        const reject = (reason: string) => res.push({ table: ch.table, id: ch.id, ok: false, reason, server: prev });
        if (!prev && !next) {
          res.push({ table: ch.table, id: ch.id, ok: true });
          continue;
        }
        const projectId = ch.table === 'projects' ? ch.id : String(next?.projectId ?? rec?.project_id ?? '');
        if (!projectId || projectId.length > 120) {
          reject('缺少所属作品');
          continue;
        }
        if (rec && rec.project_id !== projectId) {
          reject('不能把内容移到另一部作品');
          continue;
        }
        if (ch.table !== 'projects' && next && !liveProjects.has(projectId)) {
          reject('所属作品不存在或已被删除');
          continue;
        }
        const decision = checkWrite(roleInProject(org, projectId), ch.table, prev, next);
        if (!decision.ok) {
          reject(decision.reason);
          continue;
        }
        const chapterId = ch.table === 'chapters' ? ch.id : ch.table === 'versions' || ch.table === 'critiques' ? String((next ?? prev)?.chapterId ?? '') : '';
        const lock = chapterId ? locks.get(chapterId) : undefined;
        if (lock && lock.user_id !== org.user.id) {
          reject(`「${lock.user_name || '另一位成员'}」正在编辑这一章，暂时不能修改`);
          continue;
        }
        let data: Row | null = next;
        let merged = false;
        if (decision.onlyFields && prev && next) {
          data = { ...prev };
          for (const f of decision.onlyFields) if (f in next) data[f] = next[f];
          merged = true;
        }
        const [{ seq }] = await tx<{ seq: string }[]>`
          insert into records (org_id, tbl, id, project_id, data, deleted, seq, updated_by, updated_at)
          values (${org.orgId}, ${ch.table}, ${ch.id}, ${projectId}, ${data ? tx.json(data as never) : null}, ${!data}, nextval('record_seq'), ${org.user.id}, now())
          on conflict (org_id, tbl, id) do update
            set data = excluded.data, deleted = excluded.deleted, seq = excluded.seq, updated_by = excluded.updated_by, updated_at = now()
          returning seq`;
        maxSeq = Math.max(maxSeq, Number(seq));
        existing.set(key, { tbl: ch.table, id: ch.id, project_id: projectId, data, deleted: !data });
        if (ch.table === 'projects') {
          if (data) liveProjects.add(ch.id);
          else {
            // 删除作品：其下所有内容一并删除，保证其他成员的本地数据也被清理
            liveProjects.delete(ch.id);
            const [r] = await tx<{ seq: string | null }[]>`
              with d as (
                update records set deleted = true, data = null, seq = nextval('record_seq'), updated_by = ${org.user.id}, updated_at = now()
                where project_id = ${ch.id} and tbl <> 'projects' and not deleted returning seq)
              select max(seq) as seq from d`;
            if (r?.seq) maxSeq = Math.max(maxSeq, Number(r.seq));
          }
        }
        res.push({ table: ch.table, id: ch.id, ok: true, seq: Number(seq), ...(merged ? { server: data } : {}) });
      }
      if (maxSeq) await notifyInTx(tx, org.orgId, { type: 'sync', seq: maxSeq, by: org.user.id });
      return res;
    });
    results.push(...out);
  }
  return c.json({ results });
});

syncRoutes.get('/pull', async (c) => {
  const org = await requireOrg(c);
  const since = Math.max(0, Math.floor(Number(c.req.query('since') ?? 0)) || 0);
  const limit = Math.min(2000, Math.max(1, Math.floor(Number(c.req.query('limit') ?? 1000)) || 1000));
  const guest = org.role === 'guest';
  const grants = [...org.grants.keys()];
  const response = await withTenant(org.orgId, async (tx) => {
    const rows = await tx<{ tbl: SyncTable; id: string; data: Row | null; deleted: boolean; seq: string }[]>`
      select tbl, id, data, deleted, seq from records
      where seq > ${since}
        ${guest ? tx`and project_id = any(${grants})` : tx``}
        ${since === 0 ? tx`and not deleted` : tx``}
      order by seq limit ${limit + 1}`;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    let cursor = page.length ? Number(page[page.length - 1].seq) : since;
    if (!more) {
      const [m] = await tx<{ max: string | null }[]>`select max(seq) as max from records`;
      cursor = Math.max(cursor, Number(m?.max ?? 0));
    }
    const changes: PullChange[] = page.map((r) => ({ table: r.tbl, id: r.id, row: r.deleted ? null : r.data, seq: Number(r.seq) }));
    const out: PullResponse = { changes, cursor, more };
    return out;
  });
  return c.json(response);
});

/** 实时通知（SSE）：有新数据、章节锁变化、成员变化时提醒浏览器。 */
syncRoutes.get('/events', async (c) => {
  const org = await requireOrg(c);
  c.header('x-accel-buffering', 'no');
  return streamSSE(c, async (stream) => {
    const unsub = subscribe({
      orgId: org.orgId,
      userId: org.user.id,
      send: (ev) => {
        stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }).catch(() => {});
      },
    });
    stream.onAbort(unsub);
    await stream.writeSSE({ event: 'hello', data: '{}' });
    while (!stream.aborted && !stream.closed) {
      await stream.sleep(25_000);
      if (stream.aborted || stream.closed) break;
      await stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {});
    }
    unsub();
  });
});

// ─────────────────────────── 章节锁 ───────────────────────────

export const lockRoutes = new Hono<AppEnv>();

function lockInfo(l: { chapter_id: string; user_id: string; user_name: string; expires_at: Date }, me: string): ChapterLockInfo {
  return { chapterId: l.chapter_id, userId: l.user_id, userName: l.user_name, expiresAt: l.expires_at.toISOString(), mine: l.user_id === me };
}

lockRoutes.get('/', async (c) => {
  const org = await requireOrg(c);
  const rows = await withTenant(org.orgId, (tx) => tx<{ chapter_id: string; user_id: string; user_name: string; expires_at: Date }[]>`
    select chapter_id, user_id, user_name, expires_at from chapter_locks where expires_at > now()`);
  return c.json({ locks: rows.map((l) => lockInfo(l, org.user.id)) });
});

/** 获取或续期章节锁。别人持有且未过期时返回 409。 */
lockRoutes.post('/:chapterId', async (c) => {
  const org = await requireOrg(c);
  const chapterId = c.req.param('chapterId');
  if (!chapterId || chapterId.length > 120) throw badRequest('章节标识无效');
  const body = await readJson<{ projectId?: string }>(c);
  const projectId = String(body.projectId ?? '');
  if (!atLeast(roleInProject(org, projectId), 'author')) throw forbidden('你在这部作品里没有编辑权限');
  const expires = new Date(Date.now() + LOCK_TTL_MS);
  const result = await withTenant(org.orgId, async (tx) => {
    // 章节已经同步过时，以服务端记录的所属作品为准，防止借别的作品的权限锁住这一章
    const [chapter] = await tx<{ project_id: string }[]>`select project_id from records where tbl = 'chapters' and id = ${chapterId}`;
    if (chapter && chapter.project_id !== projectId) throw forbidden('章节与作品不匹配');
    const [before] = await tx<{ user_id: string; expires_at: Date }[]>`select user_id, expires_at from chapter_locks where chapter_id = ${chapterId}`;
    const rows = await tx<{ chapter_id: string; user_id: string; user_name: string; expires_at: Date }[]>`
      insert into chapter_locks (org_id, chapter_id, user_id, user_name, expires_at)
      values (${org.orgId}, ${chapterId}, ${org.user.id}, ${org.user.name}, ${expires})
      on conflict (org_id, chapter_id) do update set user_id = excluded.user_id, user_name = excluded.user_name, expires_at = excluded.expires_at
        where chapter_locks.user_id = excluded.user_id or chapter_locks.expires_at < now()
      returning chapter_id, user_id, user_name, expires_at`;
    if (rows[0]) {
      const fresh = !before || before.user_id !== org.user.id || before.expires_at.getTime() < Date.now();
      if (fresh) await notifyInTx(tx, org.orgId, { type: 'lock', chapterId });
      return { ok: true as const, lock: rows[0] };
    }
    const [holder] = await tx<{ chapter_id: string; user_id: string; user_name: string; expires_at: Date }[]>`
      select chapter_id, user_id, user_name, expires_at from chapter_locks where chapter_id = ${chapterId}`;
    return { ok: false as const, lock: holder };
  });
  if (!result.ok) throw conflict(`「${result.lock.user_name || '另一位成员'}」正在编辑这一章`, 'locked', { lock: lockInfo(result.lock, org.user.id) });
  return c.json({ lock: lockInfo(result.lock, org.user.id) });
});

async function release(orgId: string, userId: string, chapterId: string) {
  const r = await withTenant(orgId, (tx) => tx`delete from chapter_locks where chapter_id = ${chapterId} and user_id = ${userId}`);
  if (r.count) notifyOrg(orgId, { type: 'lock', chapterId });
}

lockRoutes.delete('/:chapterId', async (c) => {
  const org = await requireOrg(c);
  await release(org.orgId, org.user.id, c.req.param('chapterId'));
  return c.json({ ok: true });
});

/** 关闭页面时用 sendBeacon 释放（只能发 POST，团队标识放在查询参数里） */
lockRoutes.post('/:chapterId/release', async (c) => {
  const org = await requireOrg(c);
  await release(org.orgId, org.user.id, c.req.param('chapterId'));
  return c.json({ ok: true });
});
