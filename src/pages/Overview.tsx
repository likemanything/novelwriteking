/**
 * 概览：一部书的“书房”。
 * 封面、下一步、字数长卷（每章一根墨柱）、墨迹热力图、线索进展。
 */
import { motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, BookOpenCheck, Download, Feather, FileText, Flame, Inbox, ListTree, MoreHorizontal, NotebookPen, PenLine, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Cover } from '@/components/Cover';
import { Badge, Button, Counter, Menu, ProgressRing } from '@/components/ui';
import { useChapters, useCurrentProject, usePendingProposals, useThreads } from '@/hooks/data';
import { db } from '@/lib/db';
import { exportBackup, exportManuscript } from '@/lib/export';
import { STATUS_META, THREAD_KIND_LABEL, type Chapter, type ChapterStatus } from '@/lib/types';
import { chineseNumber, cx, formatNumber } from '@/lib/util';
import { toast } from '@/store/ui';

export const STATUS_COLOR: Record<ChapterStatus, string> = {
  planned: 'var(--line-2)',
  drafting: 'var(--indigo)',
  review: 'var(--gold)',
  revising: '#a3345a',
  final: 'var(--seal)',
};

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Stat({ label, children, sub, icon }: { label: string; children: ReactNode; sub?: ReactNode; icon: ReactNode }) {
  return (
    <div className="surface flex items-center gap-4 rounded-2xl px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-fs-xs text-ink-3">
          <span className="[&>svg]:size-3.5">{icon}</span>
          {label}
        </div>
        <div className="mt-1.5 font-serif text-fs-2xl leading-none font-semibold text-ink">{children}</div>
        {sub && <div className="mt-1.5 text-fs-xs text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}

/** 字数长卷：每章一根墨柱，高度是字数，颜色是进度。未写的章节是一枚小点。 */
function ChapterScroll({ chapters, target, words, onOpen }: { chapters: Chapter[]; target: number; words: number; onOpen: (c: Chapter) => void }) {
  const [hover, setHover] = useState<Chapter | null>(null);
  const slots = Math.max(target, chapters.length);
  const max = Math.max(words * 1.15, ...chapters.map((c) => c.words), 1);
  return (
    <div className="surface relative rounded-2xl p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-lg font-semibold">各章字数</h2>
          <p className="text-fs-xs text-ink-3">每根柱子是一章，虚线是每章目标 {words.toLocaleString('zh-CN')} 字。</p>
        </div>
        <div className="hidden items-center gap-3 text-fs-2xs text-ink-3 sm:flex">
          {(Object.keys(STATUS_META) as ChapterStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>
      <div className="relative h-40 overflow-x-auto overflow-y-hidden no-scrollbar">
        <div className="absolute inset-x-0 border-t border-dashed border-ink/20" style={{ bottom: `${(words / max) * 100}%` }} />
        <div className="flex h-full items-end gap-[3px]" style={{ minWidth: slots * 9 }}>
          {Array.from({ length: slots }).map((_, i) => {
            const c = chapters[i];
            if (!c) return <div key={i} className="flex h-full flex-1 items-end justify-center pb-0.5"><span className="size-1 rounded-full bg-ink/15" /></div>;
            const h = Math.max(c.words ? 6 : 3, (c.words / max) * 100);
            return (
              <button
                key={c.id}
                onClick={() => onOpen(c)}
                onMouseEnter={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(c)}
                onBlur={() => setHover(null)}
                aria-label={`第${c.index}章 ${c.title}，${STATUS_META[c.status].label}，${c.words} 字`}
                className="group relative flex h-full min-w-[6px] flex-1 items-end"
              >
                <motion.span
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ delay: 0.2 + i * 0.025, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className="block w-full rounded-t-[3px] transition-[filter,opacity] group-hover:brightness-110"
                  style={{ background: STATUS_COLOR[c.status], opacity: c.status === 'planned' ? 0.6 : 1 }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex h-5 items-center text-fs-xs text-ink-2">
        {hover ? (
          <span>
            第{chineseNumber(hover.index)}章《{hover.title}》 · {STATUS_META[hover.status].label} · {hover.words.toLocaleString('zh-CN')} 字
          </span>
        ) : (
          <span className="text-ink-3">悬停查看章节，点击进入写作台</span>
        )}
      </div>
    </div>
  );
}

/** 墨迹：近 20 周每日字数。 */
function InkHeatmap({ projectId }: { projectId: string }) {
  const daily = useLiveQuery(() => db.daily.where('projectId').equals(projectId).toArray(), [projectId]) ?? [];
  const { weeks, streak, today, best } = useMemo(() => {
    const map = new Map(daily.map((d) => [d.date, d.words]));
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weeks: { date: string; words: number; future: boolean }[][] = [];
    // 从 19 周前的周一开始，到本周日结束
    const monday = new Date(end);
    monday.setDate(monday.getDate() - ((end.getDay() + 6) % 7) - 7 * 19);
    for (let w = 0; w < 20; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + w * 7 + d);
        const key = dateKey(day);
        col.push({ date: key, words: map.get(key) ?? 0, future: day > end });
      }
      weeks.push(col);
    }
    let streak = 0;
    const probe = new Date(end);
    if (!map.get(dateKey(probe))) probe.setDate(probe.getDate() - 1);
    while (map.get(dateKey(probe))) {
      streak++;
      probe.setDate(probe.getDate() - 1);
    }
    return { weeks, streak, today: map.get(dateKey(end)) ?? 0, best: Math.max(0, ...daily.map((d) => d.words)) };
  }, [daily]);

  const level = (w: number) => (w <= 0 ? 0 : w < 800 ? 1 : w < 1800 ? 2 : w < 3000 ? 3 : 4);
  const shade = ['var(--line)', 'color-mix(in oklab, var(--seal) 25%, transparent)', 'color-mix(in oklab, var(--seal) 48%, transparent)', 'color-mix(in oklab, var(--seal) 72%, transparent)', 'var(--seal)'];

  return (
    <div className="surface rounded-2xl p-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="font-serif text-lg font-semibold">写作日历</h2>
          <p className="text-fs-xs text-ink-3">近二十周每天的写作字数。</p>
        </div>
        <div className="text-right text-fs-xs text-ink-3">
          <div>
            今日 <span className="font-medium text-ink tabular-nums">{today.toLocaleString('zh-CN')}</span> 字
          </div>
          <div>
            单日最多 <span className="tabular-nums">{best.toLocaleString('zh-CN')}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-[3px] overflow-x-auto no-scrollbar" role="img" aria-label={`近二十周写作热力图，连续写作 ${streak} 天`}>
        {weeks.map((col, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {col.map((d, i) => (
              <motion.span
                key={d.date}
                title={d.future ? '' : `${d.date} · ${d.words} 字`}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: d.future ? 0 : 1, scale: 1 }}
                transition={{ delay: 0.3 + (w * 7 + i) * 0.003, duration: 0.4 }}
                className="size-[13px] rounded-[3px]"
                style={{ background: shade[level(d.words)] }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-fs-xs">
        <Flame className={cx('size-4', streak ? 'text-seal' : 'text-ink-3')} />
        {streak ? (
          <span>
            已连续写作 <span className="font-semibold tabular-nums">{streak}</span> 天
          </span>
        ) : (
          <span className="text-ink-3">今天写下第一段，开始新的连续记录</span>
        )}
      </div>
    </div>
  );
}

interface NextStep {
  icon: ReactNode;
  title: string;
  detail: string;
  cta: string;
  to: string;
  primary?: boolean;
}

export default function Overview() {
  const project = useCurrentProject();
  const navigate = useNavigate();
  const chapters = useChapters(project.id);
  const threads = useThreads(project.id);
  const pending = usePendingProposals(project.id);
  const base = `/p/${project.id}`;

  const totalWords = chapters.reduce((s, c) => s + c.words, 0);
  const finals = chapters.filter((c) => c.status === 'final').length;
  const target = Math.max(project.targetChapters, chapters.length);

  const steps = useMemo<NextStep[]>(() => {
    const out: NextStep[] = [];
    if (!chapters.length) {
      out.push({ icon: <ListTree />, title: '写第一批章节细纲', detail: '让 AI 根据人物和故事线，规划前 10 章的目标与情节点。', cta: '去大纲', to: `${base}/outline`, primary: true });
    }
    const inReview = chapters.find((c) => c.status === 'review');
    if (inReview) out.push({ icon: <BookOpenCheck />, title: `第${chineseNumber(inReview.index)}章的审稿报告已出`, detail: `《${inReview.title}》等你挑选要采纳的意见，然后一键修订。`, cta: '去修订', to: `${base}/write/${inReview.id}`, primary: !out.length });
    const drafting = chapters.find((c) => c.status === 'drafting' || c.status === 'revising');
    if (drafting) out.push({ icon: <PenLine />, title: `继续第${chineseNumber(drafting.index)}章`, detail: `《${drafting.title}》已有 ${drafting.words.toLocaleString('zh-CN')} 字，还差一步定稿。`, cta: '继续写', to: `${base}/write/${drafting.id}`, primary: !out.length });
    if (pending.length) out.push({ icon: <Inbox />, title: `有 ${pending.length} 条设定变化待确认`, detail: '从定稿中整理出的人物状态、新设定和故事线进展，等你确认。', cta: '去确认', to: `${base}/updates` });
    const next = chapters.find((c) => c.status === 'planned');
    if (next) out.push({ icon: <Feather />, title: `开始写第${chineseNumber(next.index)}章`, detail: next.blueprint.goal || `《${next.title}》的细纲已就绪。`, cta: '开始写', to: `${base}/write/${next.id}`, primary: !out.length });
    return out.slice(0, 3);
  }, [chapters, pending.length, base]);

  const continueTo = steps.find((s) => s.to.includes('/write/'))?.to ?? `${base}/write`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 pt-8 pb-20 sm:px-8 sm:pt-10">
        {/* 书头 */}
        <section className="flex flex-col gap-8 md:flex-row md:items-end md:gap-10 [&>*]:min-w-0">
          <motion.div initial={{ opacity: 0, y: 20, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} className="shrink-0">
            <Cover spec={project.cover} title={project.title} width={196} />
          </motion.div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="seal">{project.genre || '未分类'}</Badge>
              {project.tags.slice(0, 5).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <h1 className="mt-4 font-serif text-[44px] leading-tight font-semibold tracking-[.04em]">{project.title}</h1>
            <p className="mt-3 max-w-2xl font-serif text-fs-lg leading-8 text-ink-2">{project.logline || '还没有一句话故事。去设定集写一句吧。'}</p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button variant="seal" onClick={() => navigate(continueTo)} icon={<Feather className="size-4" />}>
                继续写作
              </Button>
              <Button variant="outline" onClick={() => navigate(`${base}/bible`)} icon={<NotebookPen className="size-4" />}>
                设定集
              </Button>
              <Menu
                trigger={(p) => (
                  <Button {...p} variant="ghost" icon={<MoreHorizontal className="size-4" />}>
                    导出
                  </Button>
                )}
                align="left"
                items={[
                  { label: '导出全文 Markdown', icon: <FileText />, onClick: () => exportManuscript(project, 'md', false).then((n) => toast(`已导出 ${n} 章`, { tone: 'success' })) },
                  { label: '仅导出定稿 Markdown', icon: <FileText />, onClick: () => exportManuscript(project, 'md', true).then((n) => toast(`已导出 ${n} 章定稿`, { tone: 'success' })) },
                  { label: '导出纯文本', icon: <FileText />, onClick: () => exportManuscript(project, 'txt', false).then((n) => toast(`已导出 ${n} 章`, { tone: 'success' })) },
                  { label: '完整备份（.json）', icon: <Download />, divider: true, onClick: () => exportBackup(project).then(() => toast('备份已下载', { tone: 'success' })) },
                ]}
              />
            </div>
          </div>
        </section>

        {/* 数字 */}
        <section className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
          <Stat label="全书字数" icon={<PenLine />} sub={`目标约 ${formatNumber(project.targetWords * project.targetChapters)} 字`}>
            <Counter value={totalWords} />
          </Stat>
          <div className="surface flex items-center gap-4 rounded-2xl px-5 py-4">
            <ProgressRing value={finals / Math.max(1, target)} size={56} stroke={4}>
              <span className="text-fs-2xs font-medium tabular-nums">{Math.round((finals / Math.max(1, target)) * 100)}%</span>
            </ProgressRing>
            <div>
              <div className="text-fs-xs text-ink-3">定稿</div>
              <div className="mt-1 font-serif text-fs-2xl leading-none font-semibold">
                {finals}
                <span className="text-fs-md text-ink-3"> / {target} 章</span>
              </div>
            </div>
          </div>
          <Stat label="已规划" icon={<ListTree />} sub={`${chapters.filter((c) => c.status !== 'planned').length} 章已动笔`}>
            <Counter value={chapters.length} />
            <span className="text-fs-md text-ink-3"> 章</span>
          </Stat>
          <Stat label="故事线" icon={<Sparkles />} sub={`${threads.filter((t) => t.status === 'resolved').length} 条已完结`}>
            <Counter value={threads.length} />
            <span className="text-fs-md text-ink-3"> 条</span>
          </Stat>
        </section>

        {/* 下一步 */}
        {!!steps.length && (
          <section className="mt-10">
            <h2 className="mb-4 text-fs-2xs tracking-[.3em] text-seal">下一步</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 [&>*]:min-w-0">
              {steps.map((s, i) => (
                <motion.button
                  key={s.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  onClick={() => navigate(s.to)}
                  className={cx(
                    'group relative flex flex-col overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-float)]',
                    s.primary ? 'border-transparent bg-ink text-paper' : 'surface',
                  )}
                >
                  <span className={cx('mb-4 flex size-9 items-center justify-center rounded-xl [&>svg]:size-[18px]', s.primary ? 'bg-paper/10 text-paper' : 'bg-seal/10 text-seal')}>{s.icon}</span>
                  <span className="font-serif text-fs-md font-semibold">{s.title}</span>
                  <span className={cx('mt-1.5 line-clamp-2 text-fs-xs leading-relaxed', s.primary ? 'text-paper/65' : 'text-ink-3')}>{s.detail}</span>
                  <span className={cx('mt-4 inline-flex items-center gap-1 text-fs-sm font-medium', s.primary ? 'text-paper' : 'text-seal')}>
                    {s.cta}
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                  {s.primary && <span className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-seal/40 blur-3xl" />}
                </motion.button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <ChapterScroll chapters={chapters} target={target} words={project.targetWords} onOpen={(c) => navigate(`${base}/write/${c.id}`)} />
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr] [&>*]:min-w-0">
          <InkHeatmap projectId={project.id} />
          <div className="surface rounded-2xl p-6">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="font-serif text-lg font-semibold">故事线进展</h2>
                <p className="text-fs-xs text-ink-3">每条故事线最近一次推进到了哪里。</p>
              </div>
              <Button variant="ghost" size="xs" onClick={() => navigate(`${base}/storylines`)}>
                查看故事线 <ArrowRight className="size-3" />
              </Button>
            </div>
            <ul className="space-y-3">
              {threads.map((t) => (
                <li key={t.id} className="flex items-start gap-3">
                  <span className="mt-2 h-[3px] w-5 shrink-0 rounded-full" style={{ background: t.color }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-fs-sm font-medium">
                      {t.name}
                      <span className="text-fs-2xs font-normal text-ink-3">{THREAD_KIND_LABEL[t.kind]}</span>
                      {t.status === 'resolved' && <Badge tone="jade">已完结</Badge>}
                    </div>
                    <div className="truncate text-fs-xs text-ink-3">{t.progress || t.description || '尚未推进'}</div>
                  </div>
                </li>
              ))}
              {!threads.length && <li className="text-fs-sm text-ink-3">还没有故事线。</li>}
            </ul>
          </div>
        </section>

        {project.storySoFar && (
          <section className="surface mt-6 rounded-2xl p-6">
            <h2 className="font-serif text-lg font-semibold">前情提要</h2>
            <p className="mt-1 text-fs-xs text-ink-3">从定稿中整理、经你确认。写作时会作为参考资料使用。</p>
            <p className="mt-4 font-serif text-fs-md leading-8 text-ink-2">{project.storySoFar}</p>
          </section>
        )}
      </div>
    </div>
  );
}
