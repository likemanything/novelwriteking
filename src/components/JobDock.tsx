/**
 * 织机坞：右下角的后台任务指示器。任何 AI 任务都在这里可见、可停止。
 */
import { AnimatePresence, motion } from 'motion/react';
import { Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { countWords } from '@/lib/util';
import { abortJob, useJobs } from '@/store/jobs';

function Shuttle() {
  // 一枚来回穿梭的梭子
  return (
    <span className="relative block h-3 w-8 overflow-hidden">
      <span className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      <motion.span
        className="absolute top-1/2 h-1.5 w-3 -translate-y-1/2 rounded-full bg-seal"
        animate={{ left: ['0%', '62%', '0%'] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </span>
  );
}

export function JobDock() {
  const jobs = useJobs((s) => s.jobs);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!jobs.length) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [jobs.length]);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[75] flex flex-col items-end gap-2">
      <AnimatePresence>
        {jobs.map((j) => {
          const secs = Math.round((Date.now() - j.startedAt) / 1000);
          const words = countWords(j.text);
          return (
            <motion.div
              key={j.id}
              layout
              initial={{ opacity: 0, x: 30, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-paper-2/95 py-1.5 pr-1.5 pl-4 shadow-[var(--shadow-float)] backdrop-blur"
            >
              <Shuttle />
              <div className="text-xs leading-tight">
                <div className="font-medium text-ink">{j.label}</div>
                <div className="text-ink-3 tabular-nums">
                  {j.model} · {secs}s{words ? ` · ${words.toLocaleString('zh-CN')} 字` : ''}
                </div>
              </div>
              <button
                onClick={() => abortJob(j.key)}
                aria-label={`停止：${j.label}`}
                title="停止"
                className="flex size-7 items-center justify-center rounded-full text-ink-2 transition hover:bg-seal/10 hover:text-seal"
              >
                <Square className="size-3 fill-current" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
