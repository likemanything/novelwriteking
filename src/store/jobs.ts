/**
 * 织机：全局 AI 任务调度。
 *
 * 任务在模块作用域内运行，与页面生命周期解耦——作者可以离开写作页去看设定，
 * 草稿仍在后台继续生成，结果直接写入本地数据库。
 */
import { create } from 'zustand';
import { ApiError } from '@/cloud/api';
import { holdLock, LockedError } from '@/cloud/locks';
import { profileFor } from '@/cloud/models';
import type { Stage } from '@/shared/api';

export interface Job {
  id: string;
  key: string; // 同一 key 同时只允许一个任务，例如 `draft:<chapterId>`
  label: string;
  stage: Stage;
  model: string;
  startedAt: number;
  text: string;
}

interface JobsState {
  jobs: Job[];
}

export const useJobs = create<JobsState>()(() => ({ jobs: [] }));

const controllers = new Map<string, AbortController>();

export interface JobContext {
  signal: AbortSignal;
  onToken: (chunk: string, full: string) => void;
}

export class JobBusyError extends Error {
  constructor() {
    super('同类任务正在进行中');
  }
}

/** 某章正在被别人编辑时抛出，提示信息可以直接展示 */
export class ChapterBusyError extends Error {}

export async function runJob<T>(opts: { key: string; label: string; stage: Stage; lock?: { projectId: string; chapterId: string }; run: (ctx: JobContext) => Promise<T> }): Promise<T> {
  if (controllers.has(opts.key)) throw new JobBusyError();
  const controller = new AbortController();
  controllers.set(opts.key, controller);
  // 会写入章节的任务在运行期间持有章节锁，避免与别人的编辑互相覆盖
  let release: (() => void) | null = null;
  if (opts.lock) {
    try {
      release = await holdLock(opts.lock.chapterId, opts.lock.projectId);
    } catch (error) {
      if (error instanceof LockedError) {
        controllers.delete(opts.key);
        throw new ChapterBusyError(`${error.message}，暂时不能用 AI 修改这一章`);
      }
      // 离线时照常进行，恢复联网后再同步
      if (!(error instanceof ApiError && error.status === 0)) {
        controllers.delete(opts.key);
        throw error;
      }
    }
  }
  const id = `${opts.key}:${Date.now()}`;
  const job: Job = { id, key: opts.key, label: opts.label, stage: opts.stage, model: profileFor(opts.stage).name, startedAt: Date.now(), text: '' };
  useJobs.setState((s) => ({ jobs: [...s.jobs, job] }));

  // 以帧为单位合并 token 更新，避免高频重渲染
  let pending: string | null = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    if (pending === null) return;
    const text = pending;
    pending = null;
    useJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, text } : j)) }));
  };

  try {
    return await opts.run({
      signal: controller.signal,
      onToken: (_chunk, full) => {
        pending = full;
        if (!raf) raf = requestAnimationFrame(flush);
      },
    });
  } finally {
    release?.();
    if (raf) cancelAnimationFrame(raf);
    controllers.delete(opts.key);
    useJobs.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
  }
}

export function abortJob(key: string) {
  controllers.get(key)?.abort();
}

export function useJob(key: string | undefined): Job | undefined {
  return useJobs((s) => (key ? s.jobs.find((j) => j.key === key) : undefined));
}
