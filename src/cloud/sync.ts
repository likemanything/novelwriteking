/**
 * 同步引擎：本地数据库 ⇄ 云端。
 *
 * - 本地每次写入，变更追踪中间件会记下「哪张表的哪一行变了」（只记键，存 localStorage，关掉页面也不丢）；
 * - 推送时读取这些行的最新内容发给服务端；服务端逐条裁决，被拒绝的行恢复为云端版本，
 *   本地内容另存到「未能保存的内容」里供找回；
 * - 拉取按服务端序号增量进行；本地还有未推送修改的行暂不覆盖；
 * - 服务端通过 SSE 提醒有新数据，另外每分钟兜底拉取一次，网络恢复时立刻补齐。
 */
import type Dexie from 'dexie';
import { create } from 'zustand';
import { rawDb } from '@/lib/db';
import { uid } from '@/lib/util';
import type { PullResponse, PushResult, SyncChange } from '@/shared/api';
import { SYNC_TABLES, type SyncTable } from '@/shared/permissions';
import { api, ApiError } from './api';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  pending: number;
  lastSyncedAt: number | null;
  error: string | null;
}

export const useSync = create<SyncState>()(() => ({ status: 'idle', pending: 0, lastSyncedAt: null, error: null }));

type ServerEvent = 'sync' | 'lock' | 'members' | 'models' | 'drama';
type Row = Record<string, unknown>;

const SEP = '\u0001';
const dirty = new Map<string, number>();
const listeners = new Map<ServerEvent, Set<(data: any) => void>>();
let ws = '';
let orgId = '';
let cursor = 0;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pullTimer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;
let pushAgain = false;
let retryDelay = 0;
let pulling: Promise<void> | null = null;
let pullAgain = false;
let es: EventSource | null = null;
let interval: ReturnType<typeof setInterval> | undefined;
let lastFocusPull = 0;
let onRejected: (reasons: string[]) => void = () => {};
let onFatal: (error: ApiError) => void = () => {};
let started = false;

const key = (t: SyncTable, id: string) => `${t}${SEP}${id}`;
const split = (k: string) => {
  const i = k.indexOf(SEP);
  return { table: k.slice(0, i) as SyncTable, id: k.slice(i + 1) };
};
const dirtyKey = () => `inkloom.dirty.${ws}`;
const cursorKey = () => `inkloom.cursor.${ws}`;

function persistDirty() {
  try {
    localStorage.setItem(dirtyKey(), JSON.stringify([...dirty.keys()]));
  } catch {
    /* 存储已满时忽略：数据本身仍在本地数据库里 */
  }
  useSync.setState({ pending: dirty.size });
}

function table(t: SyncTable) {
  return (rawDb as unknown as Dexie).table(t);
}

/** 由本地数据库的变更追踪中间件调用 */
export function markChanged(t: SyncTable, keys: string[]) {
  if (!started) return;
  for (const id of keys) {
    const k = key(t, id);
    dirty.set(k, (dirty.get(k) ?? 0) + 1);
  }
  persistDirty();
  schedulePush();
}

export function onServerEvent(type: ServerEvent, fn: (data: any) => void) {
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

function emit(type: ServerEvent, data: unknown) {
  for (const fn of listeners.get(type) ?? []) fn(data);
}

/** 把云端的行写回本地（不经过变更追踪）。本地还有未推送修改的行跳过。 */
async function applyRemote(changes: { table: SyncTable; id: string; row: Row | null }[], force = false) {
  if (!changes.length) return;
  const groups = new Map<SyncTable, { puts: Row[]; dels: string[] }>();
  for (const ch of changes) {
    if (!force && dirty.has(key(ch.table, ch.id))) continue;
    let g = groups.get(ch.table);
    if (!g) groups.set(ch.table, (g = { puts: [], dels: [] }));
    if (ch.row) g.puts.push(ch.row);
    else g.dels.push(ch.id);
  }
  if (!groups.size) return;
  await (rawDb as unknown as Dexie).transaction('rw', [...groups.keys()].map(table), async () => {
    for (const [t, g] of groups) {
      if (g.puts.length) await table(t).bulkPut(g.puts);
      if (g.dels.length) await table(t).bulkDelete(g.dels);
    }
  });
}

// ─────────────────────────── 推送 ───────────────────────────

function schedulePush(delay = 400) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void runPush(), delay);
}

const MAX_BATCH_BYTES = 6 * 1024 * 1024;

async function pushOnce(): Promise<boolean> {
  const entries = [...dirty.entries()].slice(0, 300);
  if (!entries.length) return false;
  const items = entries.map(([k, counter]) => ({ ...split(k), counter }));
  const byTable = new Map<SyncTable, string[]>();
  for (const it of items) byTable.set(it.table, [...(byTable.get(it.table) ?? []), it.id]);
  const rows = new Map<string, Row | null>();
  for (const [t, ids] of byTable) {
    const got = (await table(t).bulkGet(ids)) as (Row | undefined)[];
    ids.forEach((id, i) => rows.set(key(t, id), got[i] ?? null));
  }
  // 控制单次请求大小
  const changes: SyncChange[] = [];
  const sent: typeof items = [];
  let bytes = 0;
  for (const it of items) {
    const row = rows.get(key(it.table, it.id)) ?? null;
    const size = row ? JSON.stringify(row).length : 50;
    if (changes.length && bytes + size > MAX_BATCH_BYTES) break;
    bytes += size;
    changes.push({ table: it.table, id: it.id, row });
    sent.push(it);
  }

  const res = await api<{ results: PushResult[] }>('POST', '/api/sync/push', { changes });
  const fixes: { table: SyncTable; id: string; row: Row | null }[] = [];
  const reasons: string[] = [];
  const rescues: { t: SyncTable; id: string; row: Row; reason: string }[] = [];
  for (const r of res.results) {
    const k = key(r.table, r.id);
    const item = sent.find((s) => s.table === r.table && s.id === r.id);
    if (!item || dirty.get(k) !== item.counter) continue; // 推送期间又被修改：下一轮再推
    dirty.delete(k);
    if (!r.ok) {
      reasons.push(r.reason ?? '没有权限');
      const local = rows.get(k);
      if (local && r.table !== 'daily' && JSON.stringify(local) !== JSON.stringify(r.server ?? null)) rescues.push({ t: r.table, id: r.id, row: local, reason: r.reason ?? '' });
      fixes.push({ table: r.table, id: r.id, row: r.server ?? null });
    } else if (r.server) {
      fixes.push({ table: r.table, id: r.id, row: r.server });
    }
  }
  persistDirty();
  if (rescues.length) {
    await rawDb.rescued.bulkPut(rescues.map((x) => ({ id: uid('rs_'), table: x.t, rowId: x.id, row: x.row, reason: x.reason, createdAt: Date.now() })));
  }
  await applyRemote(fixes);
  if (reasons.length) onRejected([...new Set(reasons)]);
  return dirty.size > 0;
}

async function runPush() {
  if (!started) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  if (!dirty.size) return;
  pushing = true;
  useSync.setState({ status: 'syncing' });
  try {
    while (await pushOnce()) {
      /* 继续推送剩余修改 */
    }
    retryDelay = 0;
    useSync.setState({ status: 'idle', lastSyncedAt: Date.now(), error: null });
  } catch (error) {
    handleError(error, () => schedulePush(nextDelay()));
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      schedulePush(50);
    }
  }
}

function nextDelay() {
  retryDelay = Math.min(30_000, retryDelay ? retryDelay * 2 : 2000);
  return retryDelay;
}

function handleError(error: unknown, retry: () => void) {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status >= 500) {
      useSync.setState({ status: 'offline', error: error.message });
      retry();
      return;
    }
    if (error.status === 401 || error.code === 'not_member') {
      useSync.setState({ status: 'error', error: error.message });
      onFatal(error);
      return;
    }
    if (error.status === 429) {
      useSync.setState({ status: 'offline', error: error.message });
      retry();
      return;
    }
  }
  console.error('[同步]', error);
  useSync.setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  retry();
}

// ─────────────────────────── 拉取 ───────────────────────────

export function pullNow(): Promise<void> {
  if (!started) return Promise.resolve();
  if (pulling) {
    pullAgain = true;
    return pulling;
  }
  pulling = (async () => {
    do {
      pullAgain = false;
      for (;;) {
        const r = await api<PullResponse>('GET', `/api/sync/pull?since=${cursor}&limit=1000`);
        await applyRemote(r.changes);
        cursor = r.cursor;
        localStorage.setItem(cursorKey(), String(cursor));
        if (!r.more) break;
      }
    } while (pullAgain);
    if (useSync.getState().status !== 'syncing') useSync.setState({ status: 'idle', lastSyncedAt: Date.now(), error: null });
  })()
    .catch((error) => handleError(error, () => schedulePull(nextDelay())))
    .finally(() => {
      pulling = null;
    });
  return pulling;
}

function schedulePull(delay = 200) {
  clearTimeout(pullTimer);
  pullTimer = setTimeout(() => void pullNow(), delay);
}

// ─────────────────────────── 生命周期 ───────────────────────────

function connectEvents() {
  es?.close();
  es = new EventSource(`/api/sync/events?org=${encodeURIComponent(orgId)}`);
  let wasOpen = false;
  es.addEventListener('hello', () => {
    // 断线重连后补齐中间漏掉的变化
    if (wasOpen) schedulePull(0);
    wasOpen = true;
  });
  es.addEventListener('sync', (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    if (data.seq > cursor) schedulePull(150);
    emit('sync', data);
  });
  for (const t of ['lock', 'members', 'models', 'drama'] as const) {
    es.addEventListener(t, (e) => emit(t, JSON.parse((e as MessageEvent).data)));
  }
}

const onOnline = () => {
  retryDelay = 0;
  schedulePush(0);
  schedulePull(0);
};
const onFocus = () => {
  if (Date.now() - lastFocusPull < 10_000) return;
  lastFocusPull = Date.now();
  schedulePull(0);
  if (dirty.size) schedulePush(0);
};

export interface StartOptions {
  workspace: string;
  orgId: string;
  onRejected: (reasons: string[]) => void;
  onFatal: (error: ApiError) => void;
}

/** 开始同步。首次进入某个团队（本地没有缓存）时等待完整拉取，之后后台增量同步。 */
export async function startSync(o: StartOptions): Promise<{ firstTime: boolean }> {
  ws = o.workspace;
  orgId = o.orgId;
  onRejected = o.onRejected;
  onFatal = o.onFatal;
  dirty.clear();
  try {
    for (const k of JSON.parse(localStorage.getItem(dirtyKey()) ?? '[]') as string[]) {
      const { table: t } = split(k);
      if ((SYNC_TABLES as readonly string[]).includes(t)) dirty.set(k, 1);
    }
  } catch {
    /* 忽略损坏的记录 */
  }
  cursor = Number(localStorage.getItem(cursorKey()) ?? 0) || 0;
  started = true;
  useSync.setState({ pending: dirty.size, status: 'idle', error: null });
  const firstTime = cursor === 0;
  const first = pullNow();
  if (firstTime) await first;
  if (dirty.size) schedulePush(0);
  connectEvents();
  interval = setInterval(() => {
    schedulePull(0);
    if (dirty.size && !pushing) schedulePush(0);
  }, 60_000);
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', onFocus);
  return { firstTime };
}

export function stopSync() {
  started = false;
  clearTimeout(pushTimer);
  clearTimeout(pullTimer);
  clearInterval(interval);
  es?.close();
  es = null;
  window.removeEventListener('online', onOnline);
  window.removeEventListener('focus', onFocus);
}

/** 尽快把本地修改推送完（例如释放章节锁、退出登录之前）。返回是否全部推送成功。 */
export async function flushSync(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (dirty.size && Date.now() < deadline) {
    clearTimeout(pushTimer);
    await runPush();
    if (pushing) await new Promise((r) => setTimeout(r, 120));
    if (useSync.getState().status === 'offline') break;
  }
  return dirty.size === 0;
}

export function pendingCount() {
  return dirty.size;
}

/** 清除某个工作区的同步记录（退出登录或被移出团队时） */
export function forgetWorkspace(name: string) {
  localStorage.removeItem(`inkloom.dirty.${name}`);
  localStorage.removeItem(`inkloom.cursor.${name}`);
}
