/**
 * 本地数据库：每个「用户 × 团队」一个独立的 IndexedDB，作为云端数据的本地副本。
 *
 * 页面直接读写这里（离线也能写），写入会被变更追踪中间件记下来，由同步引擎推送到云端；
 * 云端的新数据则通过 rawDb（不经过追踪中间件的第二个连接）写回本地，避免回声。
 */
import Dexie, { type DBCore, type DBCoreMutateRequest, type EntityTable, type Middleware } from 'dexie';
import { SYNC_TABLES, type SyncTable } from '@/shared/permissions';
import type { Chapter, Character, Critique, DailyWords, Project, Proposal, Thread, Version, WorldEntry } from './types';

/** 推送被拒绝时暂存的本地内容，方便作者找回 */
export interface RescuedItem {
  id: string;
  table: SyncTable;
  rowId: string;
  row: Record<string, unknown>;
  reason: string;
  createdAt: number;
}

export type InkDb = Dexie & {
  projects: EntityTable<Project, 'id'>;
  characters: EntityTable<Character, 'id'>;
  world: EntityTable<WorldEntry, 'id'>;
  threads: EntityTable<Thread, 'id'>;
  chapters: EntityTable<Chapter, 'id'>;
  versions: EntityTable<Version, 'id'>;
  critiques: EntityTable<Critique, 'id'>;
  proposals: EntityTable<Proposal, 'id'>;
  daily: EntityTable<DailyWords, 'id'>;
  rescued: EntityTable<RescuedItem, 'id'>;
};

export const V1_SCHEMA = {
  projects: 'id, updatedAt',
  characters: 'id, projectId',
  world: 'id, projectId',
  threads: 'id, projectId',
  chapters: 'id, projectId, [projectId+index]',
  versions: 'id, projectId, chapterId',
  critiques: 'id, projectId, chapterId, versionId',
  proposals: 'id, projectId, status',
  daily: 'id, projectId',
};

function define(d: Dexie) {
  d.version(1).stores(V1_SCHEMA);
  d.version(2).stores({ rescued: 'id, createdAt' });
  return d as InkDb;
}

const SYNCED = new Set<string>(SYNC_TABLES);

export type ChangeListener = (table: SyncTable, keys: string[]) => void;
export type WriteGuard = (table: SyncTable) => string | null;

function tracker(onChange: ChangeListener, guard: WriteGuard): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'inkloom-change-tracker',
    create(down) {
      return {
        ...down,
        table(name) {
          const t = down.table(name);
          if (!SYNCED.has(name)) return t;
          const table = name as SyncTable;
          const pk = t.schema.primaryKey;
          return {
            ...t,
            async mutate(req: DBCoreMutateRequest) {
              const denied = guard(table);
              if (denied) throw new Dexie.ReadOnlyError(denied);
              let keys: unknown[] = [];
              if (req.type === 'add' || req.type === 'put') {
                keys = req.keys ?? (req.values as unknown[]).map((v) => pk.extractKey!(v));
              } else if (req.type === 'delete') {
                keys = req.keys;
              } else if (req.type === 'deleteRange') {
                // 按主键范围删除时，先查出会被删掉的键
                const r = await t.query({ trans: req.trans, values: false, query: { index: pk, range: req.range } });
                keys = r.result;
              }
              const res = await t.mutate(req);
              onChange(table, keys.map(String));
              return res;
            },
          };
        },
      };
    },
  };
}

// 在打开工作区之前访问数据库属于程序错误：用一个会报错的占位对象让问题尽早暴露
const notOpen = new Proxy({}, {
  get() {
    throw new Error('本地数据库尚未打开');
  },
}) as InkDb;

/** 页面使用的连接（带变更追踪） */
export let db: InkDb = notOpen;
/** 同步引擎写入云端数据用的连接（不追踪） */
export let rawDb: InkDb = notOpen;
export let workspaceName = '';
let currentUserId = '';

export function openWorkspaceDb(name: string, userId: string, onChange: ChangeListener, guard: WriteGuard) {
  const tracked = define(new Dexie(name));
  tracked.use(tracker(onChange, guard));
  db = tracked;
  rawDb = define(new Dexie(name));
  workspaceName = name;
  currentUserId = userId;
}

export async function closeWorkspaceDb() {
  if (db !== notOpen) db.close();
  if (rawDb !== notOpen) rawDb.close();
  db = notOpen;
  rawDb = notOpen;
  workspaceName = '';
}

export const PROJECT_TABLES = ['characters', 'world', 'threads', 'chapters', 'versions', 'critiques', 'proposals', 'daily'] as const;

export async function touchProject(projectId: string) {
  await db.projects.update(projectId, { updatedAt: Date.now() });
}

export async function deleteProject(projectId: string) {
  await db.transaction('rw', [db.projects, ...PROJECT_TABLES.map((t) => db[t])], async () => {
    for (const t of PROJECT_TABLES) await db[t].where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 记录当日新增字数（用于写作日历与连续天数）。每位成员各记各的，避免多人同时写时互相覆盖。 */
export async function logWords(projectId: string, delta: number) {
  if (delta <= 0) return;
  const date = today();
  const id = `${projectId}:${date}:${currentUserId.slice(0, 8)}`;
  const existing = await db.daily.get(id);
  if (existing) await db.daily.update(id, { words: existing.words + delta });
  else await db.daily.add({ id, projectId, date, words: delta });
}
