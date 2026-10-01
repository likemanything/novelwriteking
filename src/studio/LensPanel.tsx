/**
 * 本章参考资料面板：AI 这一次“记得”什么，一目了然。
 * 每块资料都有来源、入选理由与 token 成本；作者可以关掉任何一块，或调整预算。
 */
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Eye, EyeOff, FileSearch, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildLens, LENS_KIND_META, planLens, renderLens, type LensBlock } from '@/ai/lens';
import { Button, IconButton, InkSpinner, Modal } from '@/components/ui';
import type { Chapter, Project } from '@/lib/types';
import { cx } from '@/lib/util';
import { useSettings } from '@/store/settings';

export function LensPanel({ project, chapter, excluded, onToggle }: { project: Project; chapter: Chapter; excluded: Set<string>; onToggle: (id: string) => void }) {
  const budget = useSettings((s) => s.contextBudget);
  const patch = useSettings((s) => s.patch);
  const [blocks, setBlocks] = useState<LensBlock[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => buildLens(project.id, chapter.id).then((b) => alive && setBlocks(b)), 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [project.id, project.updatedAt, chapter.id, chapter.updatedAt]);

  const plan = useMemo(() => (blocks ? planLens(blocks, budget, excluded) : null), [blocks, budget, excluded]);
  if (!blocks || !plan) {
    return (
      <div className="flex justify-center py-16 text-ink-3">
        <InkSpinner className="size-5" />
      </div>
    );
  }
  const included = new Set(plan.included.map((b) => b.id));
  const ordered = [...blocks].sort((a, b) => Number(included.has(b.id)) - Number(included.has(a.id)) || b.priority - a.priority);
  const over = plan.used > budget;

  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="font-serif text-fs-md font-semibold">本章参考资料</h3>
          <span className={cx('text-fs-xs tabular-nums', over ? 'text-seal' : 'text-ink-3')}>
            {plan.used.toLocaleString('zh-CN')} / {budget.toLocaleString('zh-CN')} tokens
          </span>
        </div>
        <p className="mt-1 text-fs-xs leading-relaxed text-ink-3">生成本章时，这些资料会按优先级装进模型的“记忆”。关掉的、放不下的会被省略。</p>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ink/[.06]" role="img" aria-label={`已使用 ${Math.round((plan.used / budget) * 100)}% 预算`}>
          {plan.included.map((b) => (
            <motion.span key={b.id} layout initial={{ width: 0 }} animate={{ width: `${(b.tokens / Math.max(budget, plan.used)) * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="h-full border-r border-paper-2/60 last:border-0" style={{ background: LENS_KIND_META[b.kind].color }} title={`${b.label} · ${b.tokens} tokens`} />
          ))}
        </div>
        <label className="mt-4 flex items-center gap-3 text-fs-xs text-ink-3">
          预算
          <input type="range" min={2000} max={64000} step={1000} value={budget} onChange={(e) => patch({ contextBudget: Number(e.target.value) })} className="flex-1 accent-[var(--seal)]" aria-label="上下文预算" />
        </label>
      </div>

      <ul className="space-y-1.5">
        {ordered.map((b) => {
          const on = included.has(b.id);
          const off = excluded.has(b.id);
          const meta = LENS_KIND_META[b.kind];
          return (
            <motion.li key={b.id} layout className={cx('rounded-xl border transition-colors', on ? 'border-line bg-paper' : 'border-dashed border-line bg-transparent')}>
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="mt-1.5 h-3 w-1 shrink-0 rounded-full" style={{ background: meta.color, opacity: on ? 1 : 0.35 }} />
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                  <div className={cx('flex items-center gap-1.5 text-fs-sm', on ? 'text-ink' : 'text-ink-3 line-through decoration-ink/30')}>
                    <ChevronRight className={cx('size-3 shrink-0 text-ink-3 transition-transform', open === b.id && 'rotate-90')} />
                    <span className="truncate font-medium">{b.label}</span>
                    <span className="shrink-0 text-fs-2xs text-ink-3">{meta.label}</span>
                  </div>
                  <div className="mt-0.5 pl-[18px] text-fs-xs leading-snug text-ink-3">{off ? '已手动关闭' : on ? b.reason : '超出预算，已省略'}</div>
                </button>
                <span className="mt-0.5 shrink-0 text-fs-2xs text-ink-3 tabular-nums">{b.tokens}</span>
                {b.required ? (
                  <span className="flex size-7 items-center justify-center text-ink-3" title="必需，始终装入">
                    <Lock className="size-3.5" />
                  </span>
                ) : (
                  <IconButton label={off ? '重新装入' : '不使用这份资料'} size="sm" onClick={() => onToggle(b.id)}>
                    {off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </IconButton>
                )}
              </div>
              <AnimatePresence initial={false}>
                {open === b.id && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <pre className="mx-3 mb-3 max-h-56 overflow-auto rounded-lg bg-ink/[.035] p-3 font-serif text-fs-xs leading-relaxed whitespace-pre-wrap text-ink-2">{b.content}</pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ul>

      <Button variant="soft" size="sm" className="w-full" icon={<FileSearch className="size-4" />} onClick={() => setPreview(true)}>
        预览装配后的完整资料
      </Button>
      <Modal open={preview} onClose={() => setPreview(false)} title="本章写作资料（将发送给模型）" width={760}>
        <pre className="max-h-[62vh] overflow-auto rounded-xl bg-ink/[.035] p-4 font-serif text-fs-sm leading-7 whitespace-pre-wrap text-ink-2">{renderLens(plan.included)}</pre>
      </Modal>
    </div>
  );
}
