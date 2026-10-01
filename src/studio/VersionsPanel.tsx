/**
 * 版本：每一次 AI 起草、修订与手改都留痕。可对比、可恢复，永不丢稿。
 */
import { motion } from 'motion/react';
import { Camera, GitCompare, PenLine, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Modal } from '@/components/ui';
import type { Chapter, Version } from '@/lib/types';
import { cx, relativeTime } from '@/lib/util';
import { diffStats, diffText } from './diff';

const KIND = {
  draft: { icon: Sparkles, label: 'AI 草稿' },
  revision: { icon: Wand2, label: 'AI 修订' },
  manual: { icon: PenLine, label: '手写' },
};

export function VersionsPanel({ chapter, versions, currentText, onRestore, onSnapshot, locked }: { chapter: Chapter; versions: Version[]; currentText: string; onRestore: (v: Version) => void; onSnapshot: () => void; locked: boolean }) {
  const [compare, setCompare] = useState<Version | null>(null);
  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-serif text-fs-md font-semibold">版本</h3>
          <p className="text-fs-xs text-ink-3">{versions.length} 个版本 · 旧稿永不覆盖</p>
        </div>
        <Button variant="soft" size="xs" icon={<Camera className="size-3.5" />} onClick={onSnapshot} disabled={locked || !currentText.trim()}>
          存快照
        </Button>
      </div>
      <ol className="relative space-y-2 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:w-px before:bg-line-2">
        {versions.map((v, i) => {
          const K = KIND[v.kind];
          const working = v.id === chapter.workingVersionId;
          const canon = v.id === chapter.canonVersionId;
          return (
            <motion.li key={v.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="relative flex gap-3">
              <span className={cx('relative z-10 mt-2 flex size-[30px] shrink-0 items-center justify-center rounded-full border-2', working ? 'border-seal bg-seal text-white' : 'border-line-2 bg-paper text-ink-3')}>
                <K.icon className="size-3.5" />
              </span>
              <div className={cx('group min-w-0 flex-1 rounded-xl border px-3 py-2.5 transition', working ? 'border-seal/30 bg-seal/[.04]' : 'border-line bg-paper hover:border-line-2')}>
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-fs-sm font-medium">{v.label}</span>
                  {working && <Badge tone="seal">当前</Badge>}
                  {canon && <Badge tone="jade">定稿</Badge>}
                </div>
                <div className="mt-0.5 text-fs-xs text-ink-3">
                  {K.label} · {v.words.toLocaleString('zh-CN')} 字 · {relativeTime(v.updatedAt)}
                </div>
                {!working && (
                  <div className="mt-2 flex gap-1 opacity-70 transition group-hover:opacity-100">
                    <Button variant="ghost" size="xs" icon={<GitCompare className="size-3.5" />} onClick={() => setCompare(v)}>
                      对比当前
                    </Button>
                    <Button variant="ghost" size="xs" icon={<RotateCcw className="size-3.5" />} onClick={() => onRestore(v)} disabled={locked}>
                      恢复
                    </Button>
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
        {!versions.length && <li className="pl-12 text-fs-xs text-ink-3">还没有版本。落下第一个字，就有了第一个版本。</li>}
      </ol>
      <DiffModal open={!!compare} onClose={() => setCompare(null)} a={compare?.content ?? ''} b={currentText} aLabel={compare?.label ?? ''} onRestore={compare && !locked ? () => (onRestore(compare), setCompare(null)) : undefined} />
    </div>
  );
}

export function DiffModal({ open, onClose, a, b, aLabel, onRestore }: { open: boolean; onClose: () => void; a: string; b: string; aLabel: string; onRestore?: () => void }) {
  const ops = useMemo(() => (open ? diffText(a, b) : []), [open, a, b]);
  const stats = diffStats(ops);
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={820}
      title={
        <span className="flex items-center gap-3">
          对比：{aLabel} → 当前稿
          <span className="font-sans text-fs-xs font-normal">
            <span className="text-jade">+{stats.added}</span> <span className="text-seal">−{stats.removed}</span> 字
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
          {onRestore && (
            <Button variant="ink" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={onRestore}>
              恢复「{aLabel}」
            </Button>
          )}
        </>
      }
    >
      <div className="max-h-[62vh] overflow-auto rounded-xl bg-paper p-5 font-serif text-fs-md leading-8 whitespace-pre-wrap">
        {ops.map((o, i) =>
          o.type === 'eq' ? (
            <span key={i} className="text-ink-2">
              {o.text}
            </span>
          ) : o.type === 'del' ? (
            <del key={i} className="rounded bg-seal/10 text-seal decoration-seal/60">
              {o.text}
            </del>
          ) : (
            <ins key={i} className="rounded bg-jade/15 text-ink no-underline">
              {o.text}
            </ins>
          ),
        )}
      </div>
    </Modal>
  );
}
