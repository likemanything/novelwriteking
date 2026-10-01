/**
 * 章节锁：同一章同一时间只有一个人编辑。
 *
 * - 打开写作台、AI 正在为某章起草或修订时持有锁，每 25 秒续期一次，超时 75 秒自动释放；
 * - 同一章可以被多个地方同时“持有”（写作台 + 后台任务），全部放下后才真正释放；
 * - 释放前先把本地修改推送完，避免别人接手后看到旧稿。
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ChapterLockInfo } from '@/shared/api';
import { api, ApiError, getApiOrg } from './api';
import { flushSync, onServerEvent } from './sync';

export class LockedError extends Error {
  lock: ChapterLockInfo | null;
  constructor(lock: ChapterLockInfo | null, message?: string) {
    super(message ?? `「${lock?.userName || '另一位成员'}」正在编辑这一章`);
    this.name = 'LockedError';
    this.lock = lock;
  }
}

interface LocksState {
  /** 别人持有的锁：章节 id → 锁信息 */
  others: Record<string, ChapterLockInfo>;
}

export const useLocks = create<LocksState>()(() => ({ others: {} }));

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let subscribed = false;

export async function refreshLocks() {
  try {
    const r = await api<{ locks: ChapterLockInfo[] }>('GET', '/api/locks');
    useLocks.setState({ others: Object.fromEntries(r.locks.filter((l) => !l.mine).map((l) => [l.chapterId, l])) });
  } catch {
    /* 下次再试 */
  }
}

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  onServerEvent('lock', () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refreshLocks(), 200);
  });
  void refreshLocks();
  setInterval(() => void refreshLocks(), 30_000);
}

interface Held {
  projectId: string;
  count: number;
  timer: ReturnType<typeof setInterval>;
  lost: Set<() => void>;
}

const held = new Map<string, Held>();
/** 正在向服务端申请的锁：同一章的并发申请共用一次请求，释放时也要等它们结束 */
const acquiring = new Map<string, Promise<void>>();

async function acquire(chapterId: string, projectId: string): Promise<void> {
  try {
    await api('POST', `/api/locks/${encodeURIComponent(chapterId)}`, { projectId });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'locked') throw new LockedError((error.data.lock as ChapterLockInfo) ?? null, error.message);
    throw error;
  }
}

/** 持有章节锁，返回释放函数。别人正在编辑时抛出 LockedError。 */
export async function holdLock(chapterId: string, projectId: string, onLost?: () => void): Promise<() => void> {
  ensureSubscribed();
  let h = held.get(chapterId);
  if (!h) {
    let pending = acquiring.get(chapterId);
    if (!pending) {
      pending = acquire(chapterId, projectId).finally(() => acquiring.delete(chapterId));
      acquiring.set(chapterId, pending);
    }
    await pending;
    // 等待期间可能已被另一处持有
    h = held.get(chapterId);
    if (!h) {
      const entry: Held = {
        projectId,
        count: 0,
        lost: new Set(),
        timer: setInterval(() => {
          acquire(chapterId, projectId).catch((error) => {
            if (error instanceof LockedError) {
              // 续期失败：锁已被别人拿走（例如网络中断超过 75 秒）
              clearInterval(entry.timer);
              held.delete(chapterId);
              for (const fn of entry.lost) fn();
              void refreshLocks();
            }
          });
        }, 25_000),
      };
      held.set(chapterId, entry);
      h = entry;
    }
  }
  h.count++;
  if (onLost) h.lost.add(onLost);
  let released = false;
  const entry = h;
  return () => {
    if (released) return;
    released = true;
    if (onLost) entry.lost.delete(onLost);
    entry.count--;
    if (entry.count > 0 || held.get(chapterId) !== entry) return;
    clearInterval(entry.timer);
    held.delete(chapterId);
    void flushSync(6000).finally(() => {
      if (held.has(chapterId) || acquiring.has(chapterId)) return; // 释放过程中又被持有
      api('DELETE', `/api/locks/${encodeURIComponent(chapterId)}`).catch(() => {});
    });
  };
}

/** 页面关闭时尽力释放所有锁 */
window.addEventListener('pagehide', () => {
  const org = getApiOrg();
  for (const id of held.keys()) navigator.sendBeacon?.(`/api/locks/${encodeURIComponent(id)}/release?org=${encodeURIComponent(org)}`);
});

export type LockState = { state: 'off' } | { state: 'acquiring' } | { state: 'mine' } | { state: 'other'; holder: ChapterLockInfo | null } | { state: 'error'; message: string };

/** 写作台用：进入章节时自动加锁；别人在编辑时每 15 秒重试，对方离开后自动接手。 */
export function useChapterLock(chapterId: string, projectId: string, enabled: boolean): LockState {
  const [state, setState] = useState<LockState>(enabled ? { state: 'acquiring' } : { state: 'off' });
  useEffect(() => {
    if (!enabled) {
      setState({ state: 'off' });
      return;
    }
    let alive = true;
    let release: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      try {
        const r = await holdLock(chapterId, projectId, () => {
          if (!alive) return;
          release = null;
          setState({ state: 'other', holder: useLocks.getState().others[chapterId] ?? null });
          retry = setTimeout(attempt, 15_000);
        });
        if (!alive) return r();
        release = r;
        setState({ state: 'mine' });
      } catch (error) {
        if (!alive) return;
        if (error instanceof LockedError) setState({ state: 'other', holder: error.lock });
        else setState({ state: 'error', message: error instanceof Error ? error.message : String(error) });
        retry = setTimeout(attempt, 15_000);
      }
    };
    setState({ state: 'acquiring' });
    void attempt();
    // 对方释放锁时立刻尝试接手
    const off = onServerEvent('lock', (ev: { chapterId: string }) => {
      if (ev.chapterId === chapterId && !release) {
        clearTimeout(retry);
        retry = setTimeout(attempt, 300);
      }
    });
    return () => {
      alive = false;
      clearTimeout(retry);
      off();
      release?.();
    };
  }, [chapterId, projectId, enabled]);
  return state;
}
