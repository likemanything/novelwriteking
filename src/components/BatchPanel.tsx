/**
 * 连写面板：一口气为多章起草。
 * 队列像一排待织的经线，逐根点亮；随时可以“写完这章就停”或立即停止。
 */
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, CircleSlash, FastForward, Feather, Loader, Pause, Play, Quote, Square, Wand2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { batchWrite } from '@/ai/tasks';
import type { Chapter } from '@/lib/types';
import { chineseNumber, cx, isAbort } from '@/lib/util';
import { clearBatch, requestBatchPause, useBatch, type BatchStatus } from '@/store/batch';
import { abortJob, useJob } from '@/store/jobs';
import { profileFor } from '@/store/settings';
import { toast, toastError } from '@/store/ui';
import { Button, Field, IconButton, Segmented, Toggle } from './ui';

const STATUS: Record<BatchStatus, { label: string; icon: ReactNode; cls: string }> = {
  waiting: { label: '等待', icon: <span className="size-1.5 rounded-full bg-current" />, cls: 'text-ink-3' },
  skipped: { label: '跳过', icon: <CircleSlash className="size-3.5" />, cls: 'text-ink-3' },
  drafting: { label: '起草中', icon: <Feather className="size-3.5" />, cls: 'text-seal' },
  reviewing: { label: '审稿中', icon: <Quote className="size-3.5" />, cls: 'text-gold' },
  revising: { label: '修订中', icon: <Wand2 className="size-3.5" />, cls: 'text-indigo' },
  done: { label: '完成', icon: <Check className="size-3.5" strokeWidth={3} />, cls: 'text-jade' },
  failed: { label: '失败', icon: <AlertCircle className="size-3.5" />, cls: 'text-seal' },
  stopped: { label: '未进行', icon: <Pause className="size-3.5" />, cls: 'text-ink-3' },
};

const ACTIVE: BatchStatus[] = ['drafting', 'reviewing', 'revising'];

export function BatchPanel({ projectId, chapters, initialFrom, onClose }: { projectId: string; chapters: Chapter[]; initialFrom?: number; onClose: () => void }) {
  const navigate = useNavigate();
  const batch = useBatch();
  const mine = batch.projectId === projectId && batch.items.length > 0;
  const firstEmpty = chapters.find((c) => !c.words)?.index ?? 1;
  const [from, setFrom] = useState(Math.min(initialFrom ?? firstEmpty, Math.max(1, chapters.length)));
  const [count, setCount] = useState(3);
  const [review, setReview] = useState(false);
  const busyElsewhere = batch.running && batch.projectId !== projectId;

  const range = useMemo(() => chapters.filter((c) => c.index >= from).slice(0, count), [chapters, from, count]);
  const toWrite = range.filter((c) => !c.words);
  const demo = profileFor('write').provider === 'demo';

  const start = async () => {
    try {
      const n = await batchWrite({ projectId, chapterIds: range.map((c) => c.id), review });
      const s = useBatch.getState();
      const failed = s.items.find((i) => i.status === 'failed');
      if (failed) toast(`批量写作在第${failed.index}章停下了`, { tone: 'error', detail: failed.note });
      else toast(`批量写作完成 ${n} 章`, { tone: 'seal', detail: '都是草稿，逐章审阅后再定稿。' });
    } catch (error) {
      if (!isAbort(error)) toastError(error, '批量写作没能开始');
    }
  };

  return (
    <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
      <div className="relative mt-8 overflow-hidden rounded-3xl border border-line bg-paper-2 p-6 shadow-[var(--shadow-float)]">
        <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-indigo/10 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink text-paper">
            <FastForward className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-fs-lg font-semibold">批量写作</h2>
            <p className="text-fs-xs leading-relaxed text-ink-3">按顺序为多章起草。已有正文的章节会被跳过；这里只生成草稿，不会自动定稿。</p>
          </div>
        </div>

        {mine ? (
          <Progress projectId={projectId} onOpen={(id) => navigate(`/p/${projectId}/write/${id}`)} onDone={() => (clearBatch(), onClose())} onAgain={clearBatch} />
        ) : (
          <div className="relative mt-6">
            <div className="grid gap-5 md:grid-cols-[auto_auto_1fr]">
              <Field group label="从第几章开始">
                <div className="flex items-center gap-2">
                  <IconButton label="减一" size="sm" onClick={() => setFrom(Math.max(1, from - 1))} className="border border-line">
                    −
                  </IconButton>
                  <span className="w-10 text-center font-serif text-xl tabular-nums">{from}</span>
                  <IconButton label="加一" size="sm" onClick={() => setFrom(Math.min(chapters.length, from + 1))} className="border border-line">
                    +
                  </IconButton>
                </div>
              </Field>
              <Field group label="写几章">
                <Segmented value={count} onChange={setCount} options={[1, 3, 5, 10].map((v) => ({ value: v, label: `${v} 章` }))} />
              </Field>
              <label className="flex items-center justify-between gap-4 self-end rounded-xl border border-line bg-paper px-4 py-2.5">
                <span>
                  <span className="block text-fs-sm font-medium">每章自动审稿并修订</span>
                  <span className="block text-fs-xs text-ink-3">采纳“重要”与“建议”级意见，补全未写到的情节点</span>
                </span>
                <Toggle checked={review} onChange={setReview} label="自动审稿并修订" />
              </label>
            </div>

            <ol className="mt-5 flex flex-wrap gap-1.5" aria-label="批量写作范围">
              {range.map((c) => (
                <li key={c.id} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-fs-xs', c.words ? 'border-dashed border-line-2 text-ink-3' : 'border-line bg-paper text-ink-2')} title={c.words ? '已有正文，将跳过' : ''}>
                  <span className="font-serif text-seal">{chineseNumber(c.index)}</span>
                  <span className={cx('max-w-[9em] truncate', c.words > 0 && 'line-through decoration-ink/25')}>{c.title}</span>
                </li>
              ))}
            </ol>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-fs-xs text-ink-3">
                {toWrite.length ? `将起草 ${toWrite.length} 章${review ? '，每章多两次调用（审稿、修订）' : ''}` : '范围内的章节都已有正文'}
                {!demo && toWrite.length > 0 && ` · 约 ${toWrite.length * (review ? 3 : 1)} 次模型调用`}
                {busyElsewhere && ' · 另一部作品正在批量写作'}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  收起
                </Button>
                <Button variant="ink" icon={<Play className="size-3.5" />} onClick={start} disabled={!toWrite.length || batch.running}>
                  开始批量写作
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}

function Progress({ projectId, onOpen, onDone, onAgain }: { projectId: string; onOpen: (chapterId: string) => void; onDone: () => void; onAgain: () => void }) {
  const { items, running, pauseRequested, review } = useBatch();
  const active = items.find((i) => ACTIVE.includes(i.status));
  const writeJob = useJob(active ? `write:${active.chapterId}` : undefined);
  const finished = items.filter((i) => i.status === 'done').length;
  const toWrite = items.filter((i) => i.status !== 'skipped').length;
  const words = items.reduce((s, i) => s + (i.status === 'done' ? i.words : 0), 0);

  return (
    <div className="relative mt-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[.07]">
          <motion.div className="h-full rounded-full bg-seal" initial={false} animate={{ width: `${(finished / Math.max(1, toWrite)) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
        </div>
        <span className="text-fs-xs text-ink-3 tabular-nums">
          {finished} / {toWrite} 章 · {words.toLocaleString('zh-CN')} 字
        </span>
      </div>

      <ol className="space-y-1.5">
        <AnimatePresence initial={false}>
          {items.map((it, i) => {
            const meta = STATUS[it.status];
            const live = ACTIVE.includes(it.status);
            const liveWords = live && it.status !== 'reviewing' && writeJob ? writeJob.text.replace(/\s/g, '').length : it.words;
            return (
              <motion.li
                key={it.chapterId}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className={cx('flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors duration-500', live ? 'border-seal/30 bg-seal/[.04]' : it.status === 'done' ? 'border-line bg-paper' : 'border-transparent')}
              >
                <span className="w-8 shrink-0 font-serif text-fs-sm text-ink-3">{chineseNumber(it.index)}</span>
                <span className={cx('min-w-0 flex-1 truncate text-fs-sm', it.status === 'skipped' || it.status === 'stopped' ? 'text-ink-3' : 'text-ink')}>{it.title}</span>
                {it.note && <span className="hidden max-w-[40%] truncate text-fs-xs text-ink-3 md:inline" title={it.note}>{it.note}</span>}
                {liveWords > 0 && <span className="w-16 text-right text-fs-xs text-ink-3 tabular-nums">{liveWords.toLocaleString('zh-CN')} 字</span>}
                <span className={cx('flex w-[4.5rem] shrink-0 items-center justify-end gap-1.5 text-fs-xs', meta.cls)}>
                  {live ? <Loader className="size-3.5 animate-spin" /> : meta.icon}
                  {meta.label}
                </span>
                {(it.status === 'done' || it.status === 'failed' || live) && (
                  <button onClick={() => onOpen(it.chapterId)} className="shrink-0 rounded-md px-2 py-0.5 text-fs-xs text-ink-2 transition hover:bg-ink/[.05] hover:text-seal">
                    {live ? '看直播' : '打开'}
                  </button>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-fs-xs text-ink-3">
          {running
            ? pauseRequested
              ? '写完当前这一章后就会停下。'
              : `正在进行${review ? '「起草 → 审稿 → 修订」' : '起草'}。可以离开这个页面，批量写作会在后台继续。`
            : '批量写作已结束。逐章审阅后，在写作台定稿。'}
        </p>
        <div className="flex gap-2">
          {running ? (
            <>
              <Button variant="ghost" size="sm" icon={<Pause className="size-3.5" />} onClick={() => requestBatchPause(!pauseRequested)}>
                {pauseRequested ? '取消暂停' : '写完这章就停'}
              </Button>
              <Button variant="outline" size="sm" icon={<Square className="size-3 fill-current" />} onClick={() => abortJob(`batch:${projectId}`)}>
                立即停止
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onAgain}>
                再写一批
              </Button>
              <Button variant="ink" size="sm" onClick={onDone}>
                完成
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
