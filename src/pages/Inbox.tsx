/**
 * 守典人收件箱。
 * 每次定稿后，守典人会从正文里提炼事实：章节摘要、人物状态、新设定、线索进展。
 * 它们不会自动写进设定集——每一条都要作者看过、改过、盖印后才成为正典。
 */
import { useCaps } from '@/cloud/session';
import { AnimatePresence, motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, BookText, Check, History, Inbox as InboxIcon, MapPin, ScrollText, Sparkles, Stamp, UserPlus, UserRound, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Seal } from '@/components/Seal';
import { Badge, Button, Empty, Input, SectionTitle, Textarea, Toggle } from '@/components/ui';
import { useCharacters, useCurrentProject, usePendingProposals, useThreads } from '@/hooks/data';
import { db } from '@/lib/db';
import { acceptProposal, rejectProposal } from '@/lib/repo';
import type { CharacterState, Proposal, ProposalKind } from '@/lib/types';
import { chineseNumber, cx, relativeTime } from '@/lib/util';
import { toast, toastError } from '@/store/ui';

const KIND: Record<ProposalKind, { label: string; icon: ReactNode; tone: 'seal' | 'indigo' | 'jade' | 'gold' | 'neutral' }> = {
  summary: { label: '章节摘要', icon: <BookText />, tone: 'neutral' },
  'story-so-far': { label: '前情提要', icon: <ScrollText />, tone: 'indigo' },
  'character-state': { label: '人物状态', icon: <UserRound />, tone: 'seal' },
  'new-character': { label: '新人物', icon: <UserPlus />, tone: 'gold' },
  'world-fact': { label: '新设定', icon: <MapPin />, tone: 'jade' },
  'thread-progress': { label: '故事线进展', icon: <Sparkles />, tone: 'gold' },
};

const STATE_LABEL: Record<keyof Omit<CharacterState, 'sourceChapter'>, string> = { location: '位置', condition: '状态', knowledge: '已知' };

/** 可编辑的提案正文：作者在盖印前可以改写守典人的措辞。 */
function Editor({ p, value, onChange, characterName }: { p: Proposal; value: Record<string, any>; onChange: (v: Record<string, any>) => void; characterName?: string }) {
  switch (p.kind) {
    case 'summary':
      return <Textarea value={value.summary ?? ''} onChange={(e) => onChange({ ...value, summary: e.target.value })} className="font-serif text-fs-base leading-7" />;
    case 'story-so-far':
      return <Textarea value={value.text ?? ''} onChange={(e) => onChange({ ...value, text: e.target.value })} minRows={3} className="font-serif text-fs-base leading-7" />;
    case 'character-state': {
      const before = (value.before ?? {}) as CharacterState;
      const after = (value.after ?? {}) as CharacterState;
      return (
        <div className="space-y-2">
          {(Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((k) => (
            <div key={k} className="grid grid-cols-[3em_1fr] items-start gap-3">
              <span className="pt-2 text-fs-xs text-ink-3">{STATE_LABEL[k]}</span>
              <div>
                {before[k] && before[k] !== after[k] && <div className="px-3 pb-1 text-fs-xs text-ink-3 line-through decoration-seal/50">{before[k]}</div>}
                <Input value={after[k] ?? ''} onChange={(e) => onChange({ ...value, after: { ...after, [k]: e.target.value } })} className="h-9 text-fs-sm" aria-label={`${characterName ?? ''}${STATE_LABEL[k]}`} />
              </div>
            </div>
          ))}
        </div>
      );
    }
    case 'new-character':
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input value={value.name ?? ''} onChange={(e) => onChange({ ...value, name: e.target.value })} className="h-9 font-serif" aria-label="姓名" />
            <Input value={value.role ?? ''} onChange={(e) => onChange({ ...value, role: e.target.value })} className="h-9" aria-label="角色定位" />
          </div>
          <Textarea value={value.summary ?? ''} onChange={(e) => onChange({ ...value, summary: e.target.value })} className="text-fs-sm" />
        </div>
      );
    case 'world-fact':
      return (
        <div className="space-y-2">
          <Input value={value.name ?? ''} onChange={(e) => onChange({ ...value, name: e.target.value })} className="h-9 font-serif" aria-label="设定名称" />
          <Textarea value={value.content ?? ''} onChange={(e) => onChange({ ...value, content: e.target.value })} className="text-fs-sm" />
        </div>
      );
    case 'thread-progress':
      return (
        <div className="space-y-2">
          <Textarea value={value.progress ?? ''} onChange={(e) => onChange({ ...value, progress: e.target.value })} className="text-fs-sm" />
          <label className="flex items-center justify-between text-fs-xs text-ink-2">
            这条故事线在本章完结了
            <Toggle checked={!!value.resolved} onChange={(v) => onChange({ ...value, resolved: v })} label="标记完结" />
          </label>
        </div>
      );
  }
}

function Preview({ p, characterName }: { p: Proposal; characterName?: string }) {
  if (p.kind === 'character-state') {
    const before = (p.payload.before ?? {}) as CharacterState;
    const after = (p.payload.after ?? {}) as CharacterState;
    return (
      <div className="space-y-1.5">
        <p className="text-fs-sm leading-relaxed text-ink-2">{p.detail}</p>
        <dl className="mt-2 space-y-1 rounded-xl bg-ink/[.03] px-3 py-2.5 text-fs-xs">
          {(Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((k) =>
            after[k] ? (
              <div key={k} className="flex gap-3">
                <dt className="w-8 shrink-0 text-ink-3">{STATE_LABEL[k]}</dt>
                <dd className="min-w-0 flex-1">
                  {before[k] && before[k] !== after[k] && (
                    <>
                      <span className="text-ink-3 line-through decoration-seal/40">{before[k]}</span>
                      <ArrowRight className="mx-1.5 inline size-3 text-ink-3" />
                    </>
                  )}
                  <span className="text-ink">{after[k]}</span>
                </dd>
              </div>
            ) : null,
          )}
        </dl>
        <span className="sr-only">{characterName}</span>
      </div>
    );
  }
  return <p className={cx('text-fs-sm leading-7 text-ink-2', (p.kind === 'summary' || p.kind === 'story-so-far') && 'font-serif text-fs-base')}>{p.detail}</p>;
}

function ProposalCard({ p, index, characterName, threadColor }: { p: Proposal; index: number; characterName?: string; threadColor?: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<Record<string, any>>(p.payload);
  const [stamping, setStamping] = useState(false);
  const meta = KIND[p.kind];

  const accept = async () => {
    setStamping(true);
    await new Promise((r) => setTimeout(r, 520));
    try {
      await acceptProposal(p, editing ? value : undefined);
    } catch (error) {
      setStamping(false);
      toastError(error, '写入失败');
    }
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
      transition={{ delay: index * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="surface relative overflow-hidden rounded-2xl"
    >
      <div className="flex gap-4 p-5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink/[.05] text-ink-2 [&>svg]:size-[18px]" style={threadColor ? { color: threadColor } : undefined}>
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-serif text-fs-md font-semibold">{p.title}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <div className="mt-2">{editing ? <Editor p={p} value={value} onChange={setValue} characterName={characterName} /> : <Preview p={p} characterName={characterName} />}</div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="seal" size="sm" icon={<Stamp className="size-3.5" />} onClick={accept} disabled={stamping}>
              {editing ? '按修改后的内容采纳' : '采纳'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)} disabled={stamping}>
              {editing ? '取消修改' : '修改'}
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto text-ink-3" icon={<X className="size-3.5" />} onClick={() => rejectProposal(p)} disabled={stamping}>
              驳回
            </Button>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {stamping && (
          <motion.div className="pointer-events-none absolute top-4 right-8" initial={{ scale: 2.2, rotate: -25, opacity: 0 }} animate={{ scale: 1, rotate: -10, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
            <Seal chars="准" size={68} fine seed={index + 5} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export default function Inbox() {
  const project = useCurrentProject();
  const caps = useCaps(project.id);
  const navigate = useNavigate();
  const pending = usePendingProposals(project.id);
  const characters = useCharacters(project.id);
  const threads = useThreads(project.id);
  const [showHistory, setShowHistory] = useState(false);
  const [batch, setBatch] = useState(false);
  const history = useLiveQuery(
    () =>
      showHistory
        ? db.proposals
            .where('projectId')
            .equals(project.id)
            .filter((p) => p.status !== 'pending')
            .reverse()
            .sortBy('createdAt')
        : [],
    [project.id, showHistory],
  );

  const groups = useMemo(() => {
    const map = new Map<number, Proposal[]>();
    for (const p of pending) {
      const k = p.chapterIndex ?? 0;
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [pending]);

  const acceptAll = async () => {
    setBatch(true);
    let ok = 0;
    for (const p of pending) {
      try {
        await acceptProposal(p);
        ok++;
      } catch {
        /* 单条失败不影响其它 */
      }
    }
    setBatch(false);
    toast(`已采纳 ${ok} 条`, { tone: 'seal', detail: '设定集与前情已同步更新，下次写作会用上这些新事实。' });
  };

  return (
    <div className="h-full overflow-y-auto">
      {!caps.acceptProposals && (
        <div className="mx-auto max-w-6xl px-8 pt-6" role="status">
          <div className="rounded-xl bg-gold/10 px-4 py-2.5 text-fs-xs text-ink-2">你的角色不能处理设定变化，这里只能查看。</div>
        </div>
      )}
      <fieldset disabled={!caps.acceptProposals} className="contents">
      <div className="mx-auto max-w-3xl px-8 pt-10 pb-24">
        <SectionTitle eyebrow="设定更新" title="待确认的设定变化">
          {pending.length > 1 && (
            <Button variant="outline" size="sm" icon={<Check className="size-3.5" />} onClick={acceptAll} loading={batch}>
              全部采纳（{pending.length}）
            </Button>
          )}
        </SectionTitle>
        <p className="mt-2 text-fs-sm leading-relaxed text-ink-2">每次定稿后，AI 会从正文里整理出人物状态、新设定和故事线进展。它们不会自动写进设定集，需要你逐条确认，确认前可以先修改。</p>

        {!pending.length ? (
          <Empty icon={<InboxIcon />} title="没有待确认的设定变化" action={<Button variant="ink" onClick={() => navigate(`/p/${project.id}/write`)}>去写作台</Button>}>
            定稿一章之后，正文里发生的设定变化会整理到这里。
          </Empty>
        ) : (
          <div className="mt-10 space-y-10">
            {groups.map(([idx, items]) => (
              <section key={idx}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="font-serif text-fs-sm tracking-[.15em] text-seal">{idx ? `第${chineseNumber(idx)}章定稿` : '其它'}</span>
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-fs-xs text-ink-3">{relativeTime(items[0].createdAt)}</span>
                </div>
                <ul className="space-y-3">
                  <AnimatePresence initial={false}>
                    {items.map((p, i) => (
                      <ProposalCard
                        key={p.id}
                        p={p}
                        index={i}
                        characterName={p.kind === 'character-state' ? characters.find((c) => c.id === p.payload.characterId)?.name : undefined}
                        threadColor={p.kind === 'thread-progress' ? threads.find((t) => t.id === p.payload.threadId)?.color : p.kind === 'character-state' ? characters.find((c) => c.id === p.payload.characterId)?.color : undefined}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-14 border-t border-line pt-6">
          <Button variant="ghost" size="sm" icon={<History className="size-4" />} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? '收起处理记录' : '查看处理记录'}
          </Button>
          <AnimatePresence>
            {showHistory && (
              <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 space-y-1 overflow-hidden">
                {(history ?? []).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-fs-sm">
                    <span className={cx('flex size-5 items-center justify-center rounded-full', p.status === 'accepted' ? 'bg-seal/12 text-seal' : 'bg-ink/[.06] text-ink-3')}>
                      {p.status === 'accepted' ? <Check className="size-3" /> : <X className="size-3" />}
                    </span>
                    <span className={cx('flex-1 truncate', p.status === 'rejected' && 'text-ink-3 line-through decoration-ink/20')}>{p.title}</span>
                    <span className="text-fs-xs text-ink-3">{p.chapterIndex ? `第${p.chapterIndex}章` : ''}</span>
                  </li>
                ))}
                {!history?.length && <li className="px-3 py-2 text-fs-xs text-ink-3">还没有处理过的记录。</li>}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </div>
      </fieldset>
    </div>
  );
}
