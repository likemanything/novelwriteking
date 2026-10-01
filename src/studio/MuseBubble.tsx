/**
 * 缪斯气泡：选中一段文字，气泡从墨里浮起。
 * 扩写 / 精简 / 润色 / 展示 / 对白 / 换气氛 / 自定义指令——结果先预览，替换还是插入由你决定。
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, CornerDownRight, RotateCcw, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { muse } from '@/ai/tasks';
import { MUSE_ACTIONS, type MuseAction } from '@/ai/types';
import { Button } from '@/components/ui';
import { cx, isAbort } from '@/lib/util';
import { abortJob, useJob } from '@/store/jobs';
import { toastError } from '@/store/ui';
import type { SelectionInfo } from './Editor';

type Phase = 'menu' | 'input' | 'running' | 'result';

const TONE_PRESETS = ['更紧张', '更温柔', '更冷峻', '更幽默', '更哀伤', '更诡谲'];

export function MuseBubble({ selection, projectId, chapterId, disabled, getDoc, onApply }: { selection: SelectionInfo | null; projectId: string; chapterId: string; disabled: boolean; getDoc: () => string; onApply: (from: number, to: number, text: string) => void }) {
  const [phase, setPhase] = useState<Phase>('menu');
  const [locked, setLocked] = useState<SelectionInfo | null>(null);
  const [action, setAction] = useState<MuseAction>('polish');
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState('');
  const job = useJob(`muse:${chapterId}`);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = phase === 'menu' ? selection : locked;

  useEffect(() => {
    if (phase === 'input') setTimeout(() => inputRef.current?.focus(), 30);
  }, [phase]);

  const reset = () => {
    abortJob(`muse:${chapterId}`);
    setPhase('menu');
    setLocked(null);
    setResult('');
    setInstruction('');
  };

  const run = async (a: MuseAction, sel: SelectionInfo, extra = instruction) => {
    setAction(a);
    setLocked(sel);
    setPhase('running');
    setResult('');
    const doc = getDoc();
    try {
      const text = await muse({ projectId, chapterId, action: a, selection: sel.text, before: doc.slice(0, sel.from), after: doc.slice(sel.to), instruction: extra });
      setResult(text);
      setPhase('result');
    } catch (error) {
      if (!isAbort(error)) toastError(error, 'AI 改写失败');
      reset();
    }
  };

  const pick = (a: MuseAction) => {
    if (!selection) return;
    if (a === 'tone' || a === 'custom') {
      setAction(a);
      setLocked(selection);
      setPhase('input');
    } else run(a, selection, '');
  };

  const apply = (mode: 'replace' | 'after') => {
    if (!locked) return;
    const doc = getDoc();
    let { from, to } = locked;
    // 选区可能因编辑而偏移：按原文重新定位
    if (doc.slice(from, to) !== locked.text) {
      const at = doc.indexOf(locked.text);
      if (at < 0) return toastError(new Error('原文已被修改，无法定位'), '无法应用');
      from = at;
      to = at + locked.text.length;
    }
    if (mode === 'replace') onApply(from, to, result);
    else onApply(to, to, result);
    reset();
  };

  if (!active || disabled) return null;
  const rect = active.rect;
  const vw = window.innerWidth;
  const wide = phase !== 'menu';
  const width = wide ? Math.min(460, vw - 32) : 468;
  const left = Math.max(16, Math.min(vw - width - 16, (rect.left + rect.right) / 2 - width / 2));
  const above = rect.top > 90;
  const top = wide ? rect.bottom + 12 : above ? rect.top - 56 : rect.bottom + 10;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key={wide ? 'card' : 'menu'}
        initial={{ opacity: 0, y: wide ? -6 : 6, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        onMouseDown={(e) => {
          // 保持编辑器焦点与选区（输入框除外）
          if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
        }}
        className="fixed z-[65]"
        style={{ left, top: Math.min(top, window.innerHeight - 80), width: wide ? width : undefined }}
      >
        {phase === 'menu' && (
          <div className="flex items-center gap-0.5 rounded-2xl border border-line bg-ink p-1 text-paper shadow-[var(--shadow-float)]" role="toolbar" aria-label="AI 改写">
            <span className="flex items-center gap-1 px-2 text-fs-2xs text-paper/60">
              <Sparkles className="size-3.5 text-gold" />
              AI 改写
            </span>
            {MUSE_ACTIONS.map((a) => (
              <button key={a.id} onClick={() => pick(a.id)} title={a.hint} className="rounded-xl px-2.5 py-1.5 text-fs-xs transition hover:bg-paper/12">
                {a.label}
              </button>
            ))}
          </div>
        )}

        {phase !== 'menu' && (
          <div className="overflow-hidden rounded-2xl border border-line bg-paper-2 shadow-[var(--shadow-float)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-fs-xs text-ink-3">
              <Sparkles className="size-3.5 text-gold" />
              <span className="font-medium text-ink">AI 改写 · {MUSE_ACTIONS.find((a) => a.id === action)?.label}</span>
              <span className="truncate">「{locked?.text.slice(0, 18)}{(locked?.text.length ?? 0) > 18 ? '…' : ''}」</span>
              <button onClick={reset} className="ml-auto rounded-md p-1 hover:bg-ink/[.06] hover:text-ink" aria-label="关闭改写面板">
                <X className="size-3.5" />
              </button>
            </div>

            {phase === 'input' && (
              <form
                className="space-y-3 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (locked && instruction.trim()) run(action, locked);
                }}
              >
                {action === 'tone' && (
                  <div className="flex flex-wrap gap-1.5">
                    {TONE_PRESETS.map((t) => (
                      <button key={t} type="button" onClick={() => locked && (setInstruction(t), run('tone', locked, t))} className="rounded-full border border-line-2 px-2.5 py-1 text-fs-xs text-ink-2 transition hover:border-seal/50 hover:text-seal">
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input ref={inputRef} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={action === 'tone' ? '或者描述想要的气氛……' : '说说想怎么改，例如：改成他的回忆'} className="field h-9 text-fs-sm" aria-label="改写指令" />
                  <Button type="submit" variant="ink" size="sm" disabled={!instruction.trim()}>
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </form>
            )}

            {(phase === 'running' || phase === 'result') && (
              <div className="p-4">
                <div className="max-h-[38vh] overflow-y-auto font-serif text-fs-md leading-8 text-ink">
                  <span className={cx(phase === 'running' && 'ink-caret')}>{phase === 'running' ? job?.text ?? '' : result}</span>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                  {phase === 'running' ? (
                    <Button variant="ghost" size="xs" onClick={reset}>
                      停止
                    </Button>
                  ) : (
                    <>
                      <Button variant="seal" size="sm" icon={<Check className="size-3.5" />} onClick={() => apply('replace')}>
                        替换
                      </Button>
                      <Button variant="outline" size="sm" icon={<CornerDownRight className="size-3.5" />} onClick={() => apply('after')}>
                        插在后面
                      </Button>
                      <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => locked && run(action, locked)} className="ml-auto">
                        再来一版
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
