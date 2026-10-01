import { create } from 'zustand';
import { uid } from '@/lib/util';

export type ToastTone = 'info' | 'success' | 'error' | 'seal';

export interface Toast {
  id: string;
  message: string;
  detail?: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
  duration: number;
}

interface UIState {
  toasts: Toast[];
  paletteOpen: boolean;
  focusMode: boolean;
  setPalette: (open: boolean) => void;
  setFocus: (on: boolean) => void;
}

export const useUI = create<UIState>()((set) => ({
  toasts: [],
  paletteOpen: false,
  focusMode: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setFocus: (focusMode) => set({ focusMode }),
}));

export function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) {
  const t: Toast = { id: uid('t'), message, tone: 'info', duration: opts.action ? 7000 : 3800, ...opts };
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  setTimeout(() => dismissToast(t.id), t.duration);
  return t.id;
}

export function dismissToast(id: string) {
  useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** 统一的错误提示：中断不提示，其余给出可读信息。 */
export function toastError(error: unknown, prefix = '') {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  const message = error instanceof Error ? error.message : String(error);
  toast(prefix ? `${prefix}` : '出了点问题', { tone: 'error', detail: message, duration: 6500 });
}
