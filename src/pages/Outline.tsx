/**
 * 大纲：章节蓝图的总谱。
 * AI 规划时，章节会随着流式输出一张一张“长”出来，而不是等全部结束。
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, FastForward, Feather, Plus, Sparkles, Square, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { generateOutline } from '@/ai/tasks';
import type { OutlineChapter } from '@/ai/types';
import { BatchPanel } from '@/components/BatchPanel';
import { BlueprintEditor } from '@/components/BlueprintEditor';
import { Badge, Button, ConfirmDialog, Empty, Field, IconButton, SectionTitle, Segmented, Textarea } from '@/components/ui';
import { useChapters, useCharacters, useCurrentProject, useThreads } from '@/hooks/data';
import { createBlankChapter, deleteChapter, moveChapter } from '@/lib/repo';
import { STATUS_META, type Chapter, type Character, type Thread } from '@/lib/types';
import { chineseNumber, cx, isAbort } from '@/lib/util';
import { useBatch } from '@/store/batch';
import { abortJob, useJob } from '@/store/jobs';
import { toast, toastError } from '@/store/ui';
import { STATUS_COLOR } from './Overview';

function GeneratePanel({ projectId, nextIndex, existing, target, onClose, welcome }: { projectId: string; nextIndex: number; existing: number; target: number; onClose: () => void; welcome: boolean }) {
  const [from, setFrom] = useState(nextIndex);
  const [count, setCount] = useState(Math.min(10, Math.max(1, target - nextIndex + 1)) || 10);
  const [guidance, setGuidance] = useState('');
  const [partial, setPartial] = useState<OutlineChapter[]>([]);
  const job = useJob(`outline:${projectId}`);
  const running = !!job;
  const overlap = from <= existing;

  const run = async () => {
    setPartial([]);
    try {
      const chapters = await generateOutline({ projectId, from, count, guidance, onPartial: setPartial });
      toast(`已生成 ${chapters.length} 章细纲`, { tone: 'seal', detail: `第${from}–${from + chapters.length - 1}章，随时可以修改。` });
      setPartial([]);
      onClose();
    } catch (error) {
      if (!isAbort(error)) toastError(error, '规划中断');
      setPartial([]);
    }
  };

  return (
    <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
      <div className="relative mt-8 overflow-hidden rounded-3xl border border-line bg-paper-2 p-6 shadow-[var(--shadow-float)]">
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-seal/10 blur-3xl" />
        {welcome && !running && (
          <div className="mb-5 font-serif text-fs-lg leading-relaxed">
            作品已经创建。接下来让 AI 写出前 {count} 章的细纲——
            <span className="text-ink-3">每章的目标、情节点和章末悬念。</span>
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-[auto_auto_1fr]">
          <Field group label="从第几章开始">
            <div className="flex items-center gap-2">
              <IconButton label="减一" size="sm" onClick={() => setFrom(Math.max(1, from - 1))} className="border border-line">
                −
              </IconButton>
              <span className="w-10 text-center font-serif text-xl tabular-nums">{from}</span>
              <IconButton label="加一" size="sm" onClick={() => setFrom(from + 1)} className="border border-line">
                +
              </IconButton>
            </div>
          </Field>
          <Field group label="规划几章">
            <Segmented value={count} onChange={setCount} options={[3, 5, 10, 20].map((v) => ({ value: v, label: `${v} 章` }))} />
          </Field>
          <Field label="这一批的方向" hint="选填">
            <Textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} minRows={1} placeholder="例如：节奏放慢，先让两位主角建立信任；第8章揭开第一个反转。" />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className={cx('text-fs-xs', overlap ? 'text-gold' : 'text-ink-3')}>
            {overlap ? `将更新第 ${from}–${Math.min(existing, from + count - 1)} 章的细纲（已写的正文和版本不受影响）。` : `将新增第 ${from}–${from + count - 1} 章。全书计划 ${target} 章。`}
          </p>
          <div className="flex gap-2">
            {running ? (
              <Button variant="outline" icon={<Square className="size-3 fill-current" />} onClick={() => abortJob(`outline:${projectId}`)}>
                停止
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={onClose}>
                  收起
                </Button>
                <Button variant="seal" icon={<Wand2 className="size-4" />} onClick={run}>
                  开始规划
                </Button>
              </>
            )}
          </div>
        </div>

        {running && (
          <div className="mt-6 border-t border-line pt-5">
            <div className="mb-3 flex items-center gap-2 text-fs-xs text-ink-3">
              <span className="size-1.5 animate-[breathe_1.4s_ease-in-out_infinite] rounded-full bg-seal" />
              <span className="shimmer-text">正在规划第 {from + partial.length} 章</span>
              <span className="ml-auto tabular-nums">
                {partial.length} / {count}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <AnimatePresence>
                {partial.map((c, i) => (
                  <motion.div key={i} layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 26 }} className="rounded-xl border border-line bg-paper px-4 py-3">
                    <div className="flex items-baseline gap-2">
                      <span className="font-serif text-fs-xs text-seal">第{chineseNumber(from + i)}章</span>
                      <span className="truncate font-serif text-fs-md font-semibold">{c.title}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-fs-xs leading-relaxed text-ink-3">{c.goal}</p>
                  </motion.div>
                ))}
                {Array.from({ length: Math.max(0, Math.min(2, count - partial.length)) }).map((_, i) => (
                  <motion.div key={`ghost-${partial.length + i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 - i * 0.5 }} exit={{ opacity: 0 }} className="rounded-xl border border-dashed border-line-2 px-4 py-3">
                    <div className="h-3 w-24 animate-[shimmer_2s_linear_infinite] rounded bg-[linear-gradient(90deg,var(--line),var(--line-2),var(--line))] bg-[length:200%_100%]" />
                    <div className="mt-2 h-2.5 w-full rounded bg-line" />
                    <div className="mt-1.5 h-2.5 w-2/3 rounded bg-line" />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}

function ChapterRow({ chapter, characters, threads, open, onToggle, onDelete, first, last }: { chapter: Chapter; characters: Character[]; threads: Thread[]; open: boolean; onToggle: () => void; onDelete: () => void; first: boolean; last: boolean }) {
  const navigate = useNavigate();
  const cast = characters.filter((c) => chapter.blueprint.characterIds.includes(c.id));
  const ths = threads.filter((t) => chapter.blueprint.threadIds.includes(t.id));
  return (
    <motion.li layout="position" className={cx('group relative rounded-2xl border transition-colors duration-300', open ? 'border-line-2 bg-paper-2 shadow-[var(--shadow-float)]' : 'border-transparent hover:border-line hover:bg-paper-2/60')}>
      <div className="flex items-center gap-4 px-4 py-3.5">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-4 text-left" aria-expanded={open}>
          <span className="w-14 shrink-0 text-center font-serif text-fs-xl leading-none text-ink-3 transition-colors group-hover:text-ink">{chineseNumber(chapter.index)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-serif text-fs-lg font-semibold">{chapter.title}</span>
              <span className="inline-flex items-center gap-1 text-fs-2xs text-ink-3">
                <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[chapter.status] }} />
                {STATUS_META[chapter.status].label}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-fs-xs text-ink-3">{chapter.blueprint.goal || '还没有写本章目标'}</span>
          </span>
          <span className="hidden shrink-0 items-center gap-3 md:flex">
            <span className="flex gap-1">
              {ths.map((t) => (
                <span key={t.id} title={t.name} className="h-1.5 w-4 rounded-full" style={{ background: t.color }} />
              ))}
            </span>
            <span className="flex -space-x-1.5">
              {cast.slice(0, 4).map((c) => (
                <span key={c.id} title={c.name} className="flex size-6 items-center justify-center rounded-full border-2 border-paper font-serif text-fs-2xs text-white" style={{ background: c.color }}>
                  {[...c.name][0]}
                </span>
              ))}
            </span>
            {chapter.words > 0 && <span className="w-16 text-right text-fs-xs text-ink-3 tabular-nums">{chapter.words.toLocaleString('zh-CN')} 字</span>}
          </span>
          <ChevronDown className={cx('size-4 shrink-0 text-ink-3 transition-transform duration-300', open && 'rotate-180')} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="border-t border-line px-6 pt-5 pb-5">
              <BlueprintEditor chapter={chapter} characters={characters} threads={threads} />
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <Button variant="ink" size="sm" icon={<Feather className="size-4" />} onClick={() => navigate(`/p/${chapter.projectId}/write/${chapter.id}`)}>
                  进入写作台
                </Button>
                <IconButton label="上移一章" onClick={() => moveChapter(chapter, -1)} disabled={first}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="下移一章" onClick={() => moveChapter(chapter, 1)} disabled={last}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <Button variant="danger" size="sm" className="ml-auto" icon={<Trash2 className="size-4" />} onClick={onDelete}>
                  删除本章
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export default function Outline() {
  const project = useCurrentProject();
  const chapters = useChapters(project.id);
  const characters = useCharacters(project.id);
  const threads = useThreads(project.id);
  const [params, setParams] = useSearchParams();
  const welcome = params.get('first') === '1';
  const batchFrom = Number(params.get('batch')) || undefined;
  const [panel, setPanel] = useState(welcome);
  const [batchPanel, setBatchPanel] = useState(!!batchFrom);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Chapter | null>(null);
  const running = !!useJob(`outline:${project.id}`);
  const batchMine = useBatch((s) => s.projectId === project.id && s.items.length > 0);

  useEffect(() => {
    if (running) setPanel(true);
  }, [running]);

  // 回到大纲时，若本书有连写进度，自动展开
  useEffect(() => {
    if (batchMine) setBatchPanel(true);
  }, [batchMine]);

  const acts = useMemo(() => {
    const groups: { act: string; items: Chapter[] }[] = [];
    for (const c of chapters) {
      const act = c.act || '未分卷';
      const last = groups[groups.length - 1];
      if (last && last.act === act) last.items.push(c);
      else groups.push({ act, items: [c] });
    }
    return groups;
  }, [chapters]);

  const addBlank = async () => {
    const c = await createBlankChapter(project.id);
    setOpenId(c.id);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 pt-10 pb-24">
        <SectionTitle eyebrow="大纲" title="章节细纲">
          <Button variant="outline" size="sm" icon={<Plus className="size-4" />} onClick={addBlank}>
            添加一章
          </Button>
          {chapters.length > 0 && (
            <Button variant="outline" size="sm" icon={<FastForward className="size-4" />} onClick={() => setBatchPanel(!batchPanel)} aria-expanded={batchPanel}>
              批量写作
            </Button>
          )}
          <Button variant="seal" size="sm" icon={<Sparkles className="size-4" />} onClick={() => setPanel(!panel)} aria-expanded={panel}>
            AI 生成细纲
          </Button>
        </SectionTitle>
        <p className="mt-2 text-fs-sm text-ink-2">
          {chapters.length} / {project.targetChapters} 章已规划。细纲越具体，草稿越不跑题。
        </p>

        <AnimatePresence>
          {panel && (
            <GeneratePanel
              projectId={project.id}
              nextIndex={chapters.length + 1}
              existing={chapters.length}
              target={project.targetChapters}
              welcome={welcome && !chapters.length}
              onClose={() => {
                setPanel(false);
                if (welcome) setParams({}, { replace: true });
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {batchPanel && chapters.length > 0 && (
            <BatchPanel
              projectId={project.id}
              chapters={chapters}
              initialFrom={batchFrom}
              onClose={() => {
                setBatchPanel(false);
                if (batchFrom) setParams({}, { replace: true });
              }}
            />
          )}
        </AnimatePresence>

        {!chapters.length && !panel && (
          <Empty icon={<Sparkles />} title="还没有章节" action={<Button variant="seal" onClick={() => setPanel(true)}>让 AI 写前 10 章细纲</Button>}>
            可以让 AI 根据人物、世界观和故事线规划章节，也可以一章一章手动添加。
          </Empty>
        )}

        <div className="mt-10 space-y-10">
          {acts.map((g) => (
            <section key={g.act + g.items[0].id}>
              <div className="mb-2 flex items-center gap-3 px-4">
                <span className="font-serif text-fs-sm tracking-[.2em] text-seal">{g.act}</span>
                <span className="h-px flex-1 bg-line" />
                <Badge>{g.items.length} 章</Badge>
              </div>
              <ul className="space-y-1">
                {g.items.map((c) => (
                  <ChapterRow
                    key={c.id}
                    chapter={c}
                    characters={characters}
                    threads={threads}
                    open={openId === c.id}
                    onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                    onDelete={() => setPendingDelete(c)}
                    first={c.index === 1}
                    last={c.index === chapters.length}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={`删除第${pendingDelete?.index ?? ''}章？`}
        body={pendingDelete?.words ? `《${pendingDelete.title}》已有 ${pendingDelete.words} 字正文，删除后所有版本与审稿记录都会消失。` : '这一章的细纲会被删除，后面的章节会自动前移。'}
        confirmLabel="删除"
        danger
        onResolve={async (ok) => {
          const c = pendingDelete;
          setPendingDelete(null);
          if (ok && c) {
            await deleteChapter(c);
            toast(`已删除第${c.index}章`);
          }
        }}
      />
    </div>
  );
}
