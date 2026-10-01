import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 本地草稿 + 防抖保存。
 * 输入框绑定本地副本，避免“写入数据库 → 实时查询回流”造成的光标跳动；
 * 只保存改动过的字段，因此后台任务对其它字段的更新不会被覆盖。
 */
export function useDraft<T extends object>(source: T | undefined | null, save: (patch: Partial<T>) => unknown, delay = 450) {
  const [draft, setDraft] = useState<T | undefined>(source ?? undefined);
  const draftRef = useRef(draft);
  const pending = useRef<Partial<T> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) {
      const patch = pending.current;
      pending.current = null;
      saveRef.current(patch);
    }
  }, []);

  // 外部数据变化：没有未保存的修改时才同步，避免吞掉正在输入的字
  useEffect(() => {
    if (pending.current) return;
    draftRef.current = source ?? undefined;
    setDraft(source ?? undefined);
  }, [source]);

  useEffect(() => flush, [flush]);

  const update = useCallback(
    (patch: Partial<T>) => {
      if (!draftRef.current) return;
      const next = { ...draftRef.current, ...patch };
      draftRef.current = next;
      setDraft(next);
      pending.current = { ...(pending.current ?? {}), ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  return [draft, update, flush] as const;
}
