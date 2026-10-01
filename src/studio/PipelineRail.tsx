/**
 * 工序轨：蓝图 → 草稿 → 审稿 → 修订 → 定稿。
 * 一根丝线穿过五个结点，走过的部分染成朱砂色。
 */
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import type { ChapterStatus } from '@/lib/types';
import { STATUS_META } from '@/lib/types';
import { cx } from '@/lib/util';

const ORDER: ChapterStatus[] = ['planned', 'drafting', 'review', 'revising', 'final'];

export function PipelineRail({ status, onStep, busy }: { status: ChapterStatus; onStep: (s: ChapterStatus) => void; busy?: boolean }) {
  const at = STATUS_META[status].step;
  const pct = (at / (ORDER.length - 1)) * 100;
  return (
    <div className="relative w-[360px] max-w-full" role="list" aria-label="章节进度">
      <div className="absolute inset-x-[10px] top-[9px] h-[2px] rounded-full bg-line-2" />
      <motion.div className="absolute top-[9px] left-[10px] h-[2px] rounded-full bg-seal" initial={false} animate={{ width: `calc(${pct}% - ${(pct / 100) * 20}px)` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
      <div className="relative flex justify-between">
        {ORDER.map((s, i) => {
          const done = i < at || status === 'final';
          const now = i === at && status !== 'final';
          return (
            <button key={s} role="listitem" onClick={() => onStep(s)} className="group flex flex-col items-center gap-1.5" aria-current={now ? 'step' : undefined} title={STATUS_META[s].label}>
              <span
                className={cx(
                  'relative flex size-5 items-center justify-center rounded-full border-2 transition-all duration-500',
                  done ? 'border-seal bg-seal text-white' : now ? 'border-seal bg-paper' : 'border-line-2 bg-paper group-hover:border-ink/40',
                )}
              >
                {done && <Check className="size-3" strokeWidth={3} />}
                {now && <span className={cx('size-2 rounded-full bg-seal', busy && 'animate-[breathe_1.2s_ease-in-out_infinite]')} />}
                {now && <span className="absolute inset-[-5px] animate-[breathe_2.4s_ease-in-out_infinite] rounded-full border border-seal/30" />}
              </span>
              <span className={cx('text-[11px] transition-colors', now ? 'font-medium text-ink' : done ? 'text-seal' : 'text-ink-3')}>{STATUS_META[s].label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
