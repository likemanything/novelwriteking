/**
 * 织布：把整部书摊开成一匹布。
 * 竖线是章节（经线），彩色丝线是线索或人物（纬线）。
 * 丝线在它出场的章节“浮”到经线之上、打一个结；缺席时沉到经线之下。
 * 一眼就能看出：哪条伏笔久未回收，哪个人物被遗忘了。
 */
import { motion } from 'motion/react';
import { AlertTriangle, ArrowRight, Feather, ListTree, Sparkles, Users } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Empty, SectionTitle, Segmented } from '@/components/ui';
import { useChapters, useCharacters, useCurrentProject, useThreads } from '@/hooks/data';
import { STATUS_META, THREAD_KIND_LABEL, type Chapter } from '@/lib/types';
import { chineseNumber, cx } from '@/lib/util';
import { STATUS_COLOR } from './Overview';

type Mode = 'threads' | 'characters';

interface Row {
  id: string;
  name: string;
  color: string;
  sub: string;
  done: boolean;
  on: boolean[];
}

interface Insight {
  id: string;
  tone: 'warn' | 'info';
  text: string;
}

const MIN_COL = 52;
const ROW = 58;
const HEAD = 66;
const PAD = 14;
const LABEL = 196;

function weavePath(row: number, n: number, COL: number) {
  const cy = HEAD + row * ROW + ROW / 2;
  const y = (i: number) => cy + ((i + row) % 2 === 0 ? -3.5 : 3.5);
  let d = `M${PAD - 6} ${y(0)}`;
  for (let i = 0; i < n; i++) {
    const x = PAD + i * COL + COL / 2;
    const px = i === 0 ? PAD - 6 : PAD + (i - 1) * COL + COL / 2;
    const py = i === 0 ? y(0) : y(i - 1);
    d += ` C${px + COL / 2} ${py} ${x - COL / 2} ${y(i)} ${x} ${y(i)}`;
  }
  const endX = PAD + n * COL + 6;
  d += ` C${endX - COL / 4} ${y(n - 1)} ${endX - COL / 4} ${y(n - 1)} ${endX} ${y(n - 1)}`;
  return { d, y };
}

function findGaps(on: boolean[]) {
  const idx = on.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  let worst = { from: 0, to: 0, len: 0 };
  for (let k = 1; k < idx.length; k++) {
    const len = idx[k] - idx[k - 1] - 1;
    if (len > worst.len) worst = { from: idx[k - 1] + 1, to: idx[k] - 1, len };
  }
  return { idx, worst };
}

export default function Loom() {
  const project = useCurrentProject();
  const navigate = useNavigate();
  const chapters = useChapters(project.id);
  const threads = useThreads(project.id);
  const characters = useCharacters(project.id);
  const [mode, setMode] = useState<Mode>('threads');
  const [hover, setHover] = useState<number | null>(null);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const [boxWidth, setBoxWidth] = useState(1000);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width));
    observer.current.observe(el);
  }, []);
  const base = `/p/${project.id}`;

  const rows = useMemo<Row[]>(
    () =>
      mode === 'threads'
        ? threads.map((t) => ({ id: t.id, name: t.name, color: t.color, sub: THREAD_KIND_LABEL[t.kind], done: t.status === 'resolved', on: chapters.map((c) => c.blueprint.threadIds.includes(t.id)) }))
        : characters.map((c) => ({ id: c.id, name: c.name, color: c.color, sub: c.role, done: false, on: chapters.map((ch) => ch.blueprint.characterIds.includes(c.id)) })),
    [mode, threads, characters, chapters],
  );

  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    const n = chapters.length;
    if (!n) return out;
    const threshold = Math.max(4, Math.round(n / 4));
    for (const r of rows) {
      const { idx, worst } = findGaps(r.on);
      if (!idx.length) {
        out.push({ id: r.id + 'none', tone: 'warn', text: mode === 'threads' ? `「${r.name}」还没有出现在任何一章的细纲里。` : `${r.name}还没有在任何一章出场。` });
        continue;
      }
      if (r.done) continue;
      if (worst.len >= threshold) {
        out.push({ id: r.id + 'gap', tone: 'warn', text: `「${r.name}」在第${worst.from + 1}–${worst.to + 1}章之间消失了 ${worst.len} 章，读者可能会忘记它。` });
      }
      const tail = n - 1 - idx[idx.length - 1];
      if (tail >= threshold && n >= 6) {
        out.push({ id: r.id + 'tail', tone: 'info', text: `「${r.name}」最后一次出现是第${idx[idx.length - 1] + 1}章，之后 ${tail} 章都没有再推进。` });
      }
    }
    if (mode === 'threads') {
      const main = threads.find((t) => t.kind === 'main');
      const row = main && rows.find((r) => r.id === main.id);
      if (row) {
        const ratio = row.on.filter(Boolean).length / n;
        if (ratio < 0.5 && n >= 4) out.push({ id: 'main-thin', tone: 'info', text: `主线「${row.name}」只贯穿了 ${Math.round(ratio * 100)}% 的章节，可以考虑让更多章节回应它。` });
      }
    }
    return out.slice(0, 6);
  }, [rows, chapters.length, mode, threads]);

  if (!chapters.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty icon={<ListTree />} title="还没有章节" action={<Button variant="seal" onClick={() => navigate(`${base}/outline`)}>去写大纲</Button>}>
          有了章节细纲，这里会显示每条故事线和每个人物分别在哪些章节出现。
        </Empty>
      </div>
    );
  }

  const n = chapters.length;
  // 章节少时拉宽经线间距，让布面铺满卡片
  const COL = Math.max(MIN_COL, Math.min(120, (boxWidth - LABEL - PAD * 2) / n));
  const width = PAD * 2 + n * COL;
  const height = HEAD + rows.length * ROW + 12;
  const hovered: Chapter | undefined = hover !== null ? chapters[hover] : undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] px-8 pt-10 pb-24">
        <SectionTitle eyebrow="故事线" title="故事线与人物出场">
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setFocusRow(null);
            }}
            options={[
              { value: 'threads', label: <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" />故事线</span> },
              { value: 'characters', label: <span className="flex items-center gap-1.5"><Users className="size-3.5" />人物</span> },
            ]}
          />
        </SectionTitle>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          每一列是一章，每一行是一条{mode === 'threads' ? '故事线' : '人物'}。圆点表示这一章{mode === 'threads' ? '推进了这条故事线' : '有这个人物出场'}，长时间没有圆点就说明它被冷落了。点击左侧名称可以单独查看。
        </p>

        <div ref={measure} className="surface mt-8 overflow-hidden rounded-3xl">
          {!rows.length ? (
            <Empty icon={mode === 'threads' ? <Sparkles /> : <Users />} title={mode === 'threads' ? '还没有故事线' : '还没有人物'} action={<Button variant="ink" onClick={() => navigate(`${base}/bible?tab=${mode}`)}>去设定集添加</Button>} />
          ) : (
            <div className="relative flex overflow-x-auto" onMouseLeave={() => setHover(null)}>
              {/* 左侧名称（固定） */}
              <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-paper-2" style={{ width: LABEL }}>
                <div style={{ height: HEAD }} className="flex items-end px-5 pb-3 text-[11px] tracking-[.2em] text-ink-3">
                  {mode === 'threads' ? '故事线' : '人物'} · 章节
                </div>
                {rows.map((r) => {
                  const count = r.on.filter(Boolean).length;
                  const active = !focusRow || focusRow === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setFocusRow(focusRow === r.id ? null : r.id)}
                      aria-pressed={focusRow === r.id}
                      className={cx('flex w-full items-center gap-3 px-5 text-left transition-opacity', active ? 'opacity-100' : 'opacity-35 hover:opacity-70')}
                      style={{ height: ROW }}
                    >
                      <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: r.color }} />
                      <span className="min-w-0">
                        <span className={cx('block truncate text-[13.5px] font-medium', r.done && 'text-ink-3 line-through decoration-ink/30')}>{r.name}</span>
                        <span className="block text-[11px] text-ink-3">
                          {r.sub} · {count} 章{r.done ? ' · 已完结' : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 布面 */}
              <svg width={width} height={height} className="block shrink-0" role="img" aria-label={`${mode === 'threads' ? '故事线' : '人物'}出场分布图`}>
                <defs>
                  {rows.map((r, ri) => (
                    <clipPath key={r.id} id={`over-${ri}`}>
                      {r.on.map((v, i) => (v ? <rect key={i} x={PAD + i * COL - 0.5} y={0} width={COL + 1} height={height} /> : null))}
                    </clipPath>
                  ))}
                </defs>

                {/* 悬停列 */}
                {hover !== null && <rect x={PAD + hover * COL} y={0} width={COL} height={height} fill="var(--ink)" opacity={0.04} rx={8} />}

                {/* 卷分隔与章节头 */}
                {chapters.map((c, i) => {
                  const x = PAD + i * COL + COL / 2;
                  const newAct = c.act && c.act !== chapters[i - 1]?.act;
                  return (
                    <g key={c.id}>
                      {newAct && (
                        <>
                          <line x1={PAD + i * COL} y1={10} x2={PAD + i * COL} y2={height - 6} stroke="var(--seal)" strokeOpacity={0.25} strokeDasharray="2 4" />
                          <text x={PAD + i * COL + 6} y={16} fontSize="10.5" fill="var(--seal)" letterSpacing="1.5" fontFamily="var(--font-serif)">
                            {c.act}
                          </text>
                        </>
                      )}
                      <text x={x} y={40} textAnchor="middle" fontSize="12" fill={hover === i ? 'var(--ink)' : 'var(--ink-3)'} fontFamily="var(--font-serif)">
                        {chineseNumber(c.index)}
                      </text>
                      <circle cx={x} cy={54} r={3} fill={STATUS_COLOR[c.status]} />
                    </g>
                  );
                })}

                {/* 纬线底层（沉在经线之下的部分） */}
                {rows.map((r, ri) => {
                  const { d } = weavePath(ri, n, COL);
                  const active = !focusRow || focusRow === r.id;
                  return (
                    <motion.path
                      key={`under-${mode}-${r.id}`}
                      d={d}
                      fill="none"
                      stroke={r.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: active ? 0.28 : 0.07 }}
                      transition={{ pathLength: { delay: ri * 0.08, duration: 1.4, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.3 } }}
                    />
                  );
                })}

                {/* 经线 */}
                {chapters.map((c, i) => {
                  const x = PAD + i * COL + COL / 2;
                  return <line key={c.id} x1={x} y1={HEAD - 2} x2={x} y2={height - 8} stroke={c.status === 'final' ? 'var(--seal)' : 'var(--line-2)'} strokeOpacity={c.status === 'final' ? 0.35 : 1} strokeWidth={c.status === 'final' ? 1.5 : 1} />;
                })}

                {/* 纬线浮层（出场的章节浮到经线之上） + 结 */}
                {rows.map((r, ri) => {
                  const { d, y } = weavePath(ri, n, COL);
                  const active = !focusRow || focusRow === r.id;
                  return (
                    <motion.g key={`over-${mode}-${r.id}`} animate={{ opacity: active ? 1 : 0.12 }} transition={{ duration: 0.3 }}>
                      <motion.path d={d} fill="none" stroke={r.color} strokeWidth={3.6} strokeLinecap="round" clipPath={`url(#over-${ri})`} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: ri * 0.08 + 0.1, duration: 1.4, ease: [0.22, 1, 0.36, 1] }} />
                      {r.on.map((v, i) =>
                        v ? (
                          <motion.circle
                            key={i}
                            cx={PAD + i * COL + COL / 2}
                            cy={y(i)}
                            r={hover === i ? 6.5 : 5}
                            fill={r.color}
                            stroke="var(--paper-2)"
                            strokeWidth={2}
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.5 + ri * 0.08 + i * 0.025, type: 'spring', stiffness: 400, damping: 18 }}
                            style={{ transformOrigin: `${PAD + i * COL + COL / 2}px ${y(i)}px` }}
                          />
                        ) : null,
                      )}
                    </motion.g>
                  );
                })}

                {/* 交互热区 */}
                {chapters.map((c, i) => (
                  <rect
                    key={c.id}
                    x={PAD + i * COL}
                    y={0}
                    width={COL}
                    height={height}
                    fill="transparent"
                    className="cursor-pointer outline-none"
                    tabIndex={0}
                    role="button"
                    aria-label={`第${c.index}章 ${c.title}`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onClick={() => navigate(`${base}/write/${c.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`${base}/write/${c.id}`)}
                  />
                ))}
              </svg>
            </div>
          )}

          {/* 章节详情条 */}
          <div className="flex min-h-[76px] items-center gap-4 border-t border-line bg-ink/[.015] px-6 py-4">
            {hovered ? (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-[12.5px] text-seal">第{chineseNumber(hovered.index)}章</span>
                    <span className="truncate font-serif text-[16px] font-semibold">{hovered.title}</span>
                    <Badge>{STATUS_META[hovered.status].label}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{hovered.summary || hovered.blueprint.goal || '还没有本章目标'}</p>
                </div>
                <div className="hidden max-w-[40%] flex-wrap justify-end gap-1.5 md:flex">
                  {rows
                    .filter((r) => r.on[hover!])
                    .map((r) => (
                      <span key={r.id} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line px-2 text-[11.5px] text-ink-2">
                        <span className="size-1.5 rounded-full" style={{ background: r.color }} />
                        {r.name}
                      </span>
                    ))}
                </div>
                <Button variant="ink" size="sm" icon={<Feather className="size-3.5" />} onClick={() => navigate(`${base}/write/${hovered.id}`)}>
                  写这一章
                </Button>
              </>
            ) : (
              <span className="text-[12.5px] text-ink-3">把鼠标移到某一章上查看详情，点击进入写作台。</span>
            )}
          </div>
        </div>

        {/* 织工的提醒 */}
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] tracking-[.3em] text-seal">结构提醒</h2>
          {insights.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {insights.map((it, i) => (
                <motion.div key={it.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.06 }} className="surface flex items-start gap-3 rounded-2xl px-4 py-3.5">
                  <span className={cx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', it.tone === 'warn' ? 'bg-gold/15 text-gold' : 'bg-indigo/12 text-indigo')}>
                    {it.tone === 'warn' ? <AlertTriangle className="size-3.5" /> : <Sparkles className="size-3.5" />}
                  </span>
                  <p className="flex-1 text-[13px] leading-relaxed text-ink-2">{it.text}</p>
                  <Button variant="ghost" size="xs" onClick={() => navigate(`${base}/outline`)}>
                    调整 <ArrowRight className="size-3" />
                  </Button>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">各条线分布均匀，没有被冷落的。</p>
          )}
        </section>
      </div>
    </div>
  );
}
