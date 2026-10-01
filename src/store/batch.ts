/**
 * 连写队列的进度状态（与织机任务分开存放，便于任何页面展示逐章进度）。
 */
import { create } from 'zustand';

export type BatchStatus = 'waiting' | 'skipped' | 'drafting' | 'reviewing' | 'revising' | 'done' | 'failed' | 'stopped';

export interface BatchItem {
  chapterId: string;
  index: number;
  title: string;
  status: BatchStatus;
  words: number;
  note?: string;
}

interface BatchState {
  projectId: string | null;
  items: BatchItem[];
  running: boolean;
  pauseRequested: boolean;
  review: boolean;
  startedAt: number;
  finishedAt?: number;
}

export const useBatch = create<BatchState>()(() => ({
  projectId: null,
  items: [],
  running: false,
  pauseRequested: false,
  review: false,
  startedAt: 0,
}));

export function patchBatchItem(chapterId: string, patch: Partial<BatchItem>) {
  useBatch.setState((s) => ({ items: s.items.map((it) => (it.chapterId === chapterId ? { ...it, ...patch } : it)) }));
}

/** 写完当前这一章后停下（不打断正在生成的章节）。 */
export function requestBatchPause(on = true) {
  useBatch.setState({ pauseRequested: on });
}

export function clearBatch() {
  if (useBatch.getState().running) return;
  useBatch.setState({ projectId: null, items: [], pauseRequested: false, finishedAt: undefined });
}
