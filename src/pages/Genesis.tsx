/**
 * 开书：一 · 灵感 → 二 · 织造 → 三 · 审阅。
 * 织造时丝线向中心收拢；审阅时作者可以挑书名、删角色、改前提，再“织成此书”。
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BrandMark, ModelStatus } from '@/components/Brand';
import { Cover } from '@/components/Cover';
import { ThreadField } from '@/components/ThreadField';
import { Badge, Button, Chip, Field, Input, Segmented, Textarea } from '@/components/ui';
import { genesis, genesisProgress, type GenesisInput } from '@/ai/tasks';
import type { GenesisResult } from '@/ai/types';
import { createProjectFromGenesis, makeCover } from '@/lib/repo';
import { cx, isAbort, silk } from '@/lib/util';
import { abortJob, useJob } from '@/store/jobs';
import { toast, toastError } from '@/store/ui';
import { INSPIRATIONS } from './Library';

const GENRES = ['悬疑', '奇幻', '仙侠', '科幻', '都市', '历史', '言情', '武侠'];
const TONES = ['温暖', '冷峻', '幽默', '悲怆', '热血', '诡谲', '治愈', '史诗'];
const LENGTHS = [
  { value: 12, label: '短篇 · 12章' },
  { value: 30, label: '中篇 · 30章' },
  { value: 60, label: '长篇 · 60章' },
  { value: 120, label: '超长 · 120章' },
];
const STEPS = ['书名', '一句话故事', '故事梗概', '文风', '人物', '世界观', '故事线'];

type Stage = 'config' | 'weaving' | 'review';

function StepHeader({ stage }: { stage: Stage }) {
  const items: { id: Stage; label: string }[] = [
    { id: 'config', label: '一 · 构思' },
    { id: 'weaving', label: '二 · 生成' },
    { id: 'review', label: '三 · 确认' },
  ];
  const at = items.findIndex((i) => i.id === stage);
  return (
    <ol className="flex items-center gap-2 text-[12px]" aria-label="开书进度">
      {items.map((it, i) => (
        <li key={it.id} className="flex items-center gap-2">
          <span className={cx('transition-colors duration-500', i === at ? 'text-ink' : i < at ? 'text-seal' : 'text-ink-3')} aria-current={i === at ? 'step' : undefined}>
            {it.label}
          </span>
          {i < items.length - 1 && <span className={cx('h-px w-6 transition-colors duration-500', i < at ? 'bg-seal' : 'bg-line-2')} />}
        </li>
      ))}
    </ol>
  );
}

export default function Genesis() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [stage, setStage] = useState<Stage>('config');
  const [input, setInput] = useState<GenesisInput>({ seed: params.get('seed') ?? '', genre: '', chapters: 30, words: 3000, tone: '', notes: '' });
  const [tones, setTones] = useState<string[]>([]);
  const [result, setResult] = useState<GenesisResult | null>(null);
  const job = useJob('genesis');
  const progress = genesisProgress(job?.text ?? '');

  const weave = async () => {
    if (!input.seed.trim()) return;
    setStage('weaving');
    try {
      const r = await genesis({ ...input, tone: tones.join('、') });
      setResult(r);
      setStage('review');
    } catch (error) {
      setStage(result ? 'review' : 'config');
      if (!isAbort(error)) toastError(error, '生成中断了');
    }
  };

  return (
    <div className="relative isolate h-full overflow-y-auto">
      <ThreadField className="fixed inset-0 -z-10 h-full w-full" energy={stage === 'weaving' ? 0.6 : 0} converge={stage === 'weaving' ? 1 : stage === 'review' ? 0.25 : 0} opacity={stage === 'review' ? 0.35 : 1} />
      <header className="sticky top-0 z-30 flex h-16 items-center gap-6 border-b border-transparent bg-paper/70 px-6 backdrop-blur-md">
        <BrandMark />
        <div className="hidden flex-1 justify-center md:flex">
          <StepHeader stage={stage} />
        </div>
        <ModelStatus className="ml-auto md:ml-0" />
      </header>

      <AnimatePresence mode="wait">
        {stage === 'config' && (
          <motion.main key="config" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="mx-auto max-w-3xl px-6 pt-10 pb-24">
            <button onClick={() => navigate('/')} className="mb-8 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition hover:text-ink">
              <ArrowLeft className="size-4" /> 书架
            </button>
            <h1 className="font-serif text-[34px] leading-tight font-semibold tracking-wide">从一句灵感开始。</h1>
            <p className="mt-3 text-[14px] text-ink-2">写下让你心头一动的那句话。模糊没关系，AI 会从中找出最有戏剧张力的问题。</p>

            <div className="surface mt-8 rounded-[22px] p-2 shadow-[var(--shadow-float)]">
              <textarea
                autoFocus
                value={input.seed}
                onChange={(e) => setInput({ ...input, seed: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && weave()}
                rows={3}
                placeholder={INSPIRATIONS[2]}
                aria-label="灵感"
                className="block w-full resize-none bg-transparent px-5 pt-4 pb-3 font-serif text-[21px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
              />
            </div>

            <div className="mt-10 grid gap-8">
              <Field group label="类型" hint="不选则由 AI 判断">
                <div className="flex flex-wrap gap-2">
                  <Chip active={!input.genre} onClick={() => setInput({ ...input, genre: '' })}>
                    自动判断
                  </Chip>
                  {GENRES.map((g) => (
                    <Chip key={g} active={input.genre === g} onClick={() => setInput({ ...input, genre: g })}>
                      {g}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field group label="基调" hint="可多选">
                <div className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <Chip key={t} active={tones.includes(t)} onClick={() => setTones(tones.includes(t) ? tones.filter((x) => x !== t) : [...tones, t])}>
                      {t}
                    </Chip>
                  ))}
                </div>
              </Field>
              <div className="grid gap-8 sm:grid-cols-2">
                <Field group label="篇幅">
                  <div className="flex flex-wrap gap-2">
                    {LENGTHS.map((l) => (
                      <Chip key={l.value} active={input.chapters === l.value} onClick={() => setInput({ ...input, chapters: l.value })}>
                        {l.label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field group label="每章字数">
                  <Segmented value={input.words} onChange={(words) => setInput({ ...input, words })} options={[2000, 3000, 4000, 5000].map((v) => ({ value: v, label: `${v / 1000}k` }))} />
                </Field>
              </div>
              <Field label="其他要求" hint="选填">
                <Textarea value={input.notes} onChange={(e) => setInput({ ...input, notes: e.target.value })} placeholder="例如：主角是女性；不要恋爱线；结局要开放……" minRows={2} />
              </Field>
            </div>

            <div className="mt-12 flex items-center justify-end gap-3">
              <Button variant="seal" size="lg" disabled={!input.seed.trim()} onClick={weave} icon={<Sparkles className="size-4" />}>
                开始生成
              </Button>
            </div>
          </motion.main>
        )}

        {stage === 'weaving' && (
          <motion.main key="weaving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.6 }} className="flex min-h-[calc(100%-4rem)] flex-col items-center justify-center px-6 pb-16 text-center">
            <motion.blockquote initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8 }} className="max-w-2xl rounded-2xl bg-paper/70 px-6 py-4 font-serif text-[24px] leading-relaxed text-ink backdrop-blur-sm">
              「{input.seed}」
            </motion.blockquote>
            <div className="mt-10 flex flex-wrap justify-center gap-x-2 gap-y-3" aria-live="polite">
              {STEPS.map((s, i) => {
                const active = Math.max(0, progress - 1);
                const done = i < active;
                const now = i === active;
                return (
                  <motion.span
                    key={s}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.06 }}
                    className={cx(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[13px] backdrop-blur-sm transition-all duration-500',
                      done ? 'border-seal/30 bg-seal/10 text-seal' : now ? 'border-ink/30 bg-paper-2/80 text-ink' : 'border-line bg-paper/50 text-ink-3',
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : now ? <span className="size-1.5 animate-[breathe_1.4s_ease-in-out_infinite] rounded-full bg-seal" /> : null}
                    {s}
                  </motion.span>
                );
              })}
            </div>
            <div className="mt-8 text-[13px] text-ink-3">
              <span className="shimmer-text">正在生成：{STEPS[Math.min(STEPS.length - 1, Math.max(0, progress - 1))]}</span>
              <span className="mx-2">·</span>
              <span className="tabular-nums">{(job?.text.length ?? 0).toLocaleString('zh-CN')} 字符</span>
            </div>
            <Button variant="ghost" size="sm" className="mt-6" icon={<Square className="size-3 fill-current" />} onClick={() => abortJob('genesis')}>
              停止
            </Button>
          </motion.main>
        )}

        {stage === 'review' && result && (
          <Review
            key="review"
            input={input}
            result={result}
            onChange={setResult}
            onReweave={weave}
            onBack={() => setStage('config')}
            onCreated={(id, title) => {
              toast(`《${title}》已上架`, { tone: 'seal', detail: '接下来，让 AI 写出第一批章节细纲。' });
              navigate(`/p/${id}/outline?first=1`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Review({ input, result, onChange, onReweave, onBack, onCreated }: { input: GenesisInput; result: GenesisResult; onChange: (r: GenesisResult) => void; onReweave: () => void; onBack: () => void; onCreated: (id: string, title: string) => void }) {
  const [title, setTitle] = useState(result.titles[0] ?? '未命名');
  const [drop, setDrop] = useState<{ c: Set<number>; w: Set<number>; t: Set<number> }>({ c: new Set(), w: new Set(), t: new Set() });
  const [creating, setCreating] = useState(false);
  const covers = useMemo(() => result.titles.map((t) => makeCover(t + input.seed)), [result.titles, input.seed]);

  const toggle = (k: 'c' | 'w' | 't', i: number) => {
    const next = new Set(drop[k]);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDrop({ ...drop, [k]: next });
  };

  const create = async () => {
    setCreating(true);
    try {
      const g: GenesisResult = {
        ...result,
        characters: result.characters.filter((_, i) => !drop.c.has(i)),
        world: result.world.filter((_, i) => !drop.w.has(i)),
        threads: result.threads.filter((_, i) => !drop.t.has(i)),
      };
      const id = await createProjectFromGenesis(g, { title: title.trim() || '未命名', seed: input.seed, targetChapters: input.chapters, targetWords: input.words });
      onCreated(id, title.trim() || '未命名');
    } catch (error) {
      toastError(error, '创建失败');
      setCreating(false);
    }
  };

  const stagger = { show: { transition: { staggerChildren: 0.06 } } };
  const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } } };

  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mx-auto max-w-5xl px-6 pt-10 pb-40">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="text-[11px] tracking-[.3em] text-seal">三 · 确认</div>
        <h1 className="mt-2 font-serif text-[32px] font-semibold tracking-wide">AI 生成了以下设定。</h1>
        <p className="mt-2 text-[14px] text-ink-2">留下喜欢的，去掉不要的。所有内容之后都能在设定集里修改。</p>
      </motion.div>

      {/* 书名 */}
      <section className="mt-12">
        <h2 className="mb-5 text-xs font-medium tracking-wider text-ink-2">挑一个书名</h2>
        <div className="flex flex-wrap items-end gap-8">
          {result.titles.map((t, i) => (
            <motion.button
              key={t + i}
              initial={{ opacity: 0, y: 30, rotate: -3 + i * 3 }}
              animate={{ opacity: 1, y: title === t ? -10 : 0, rotate: 0 }}
              transition={{ delay: 0.15 + i * 0.1, type: 'spring', stiffness: 200, damping: 20 }}
              onClick={() => setTitle(t)}
              className="group relative"
              aria-pressed={title === t}
            >
              <Cover spec={covers[i]} title={t} width={132} />
              <div className={cx('mt-3 text-center font-serif text-[14px] transition-colors', title === t ? 'text-seal' : 'text-ink-2')}>{t}</div>
              {title === t && <motion.span layoutId="title-pick" className="absolute -inset-2.5 -z-10 rounded-xl border-2 border-seal/60" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            </motion.button>
          ))}
          <div className="min-w-56 flex-1">
            <Field label="或者自己起一个">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="font-serif text-base" />
            </Field>
          </div>
        </div>
      </section>

      {/* 前提 */}
      <section className="mt-14 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Field label="一句话故事">
            <Textarea value={result.logline} onChange={(e) => onChange({ ...result, logline: e.target.value })} className="font-serif text-[17px]" />
          </Field>
          <Field label="故事梗概">
            <Textarea value={result.premise} onChange={(e) => onChange({ ...result, premise: e.target.value })} minRows={4} className="font-serif text-[15px] leading-8" />
          </Field>
        </div>
        <div className="surface space-y-3 rounded-2xl p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="seal">{result.genre || '未分类'}</Badge>
            {result.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <div className="text-xs font-medium tracking-wider text-ink-2">文风</div>
          <dl className="space-y-1.5 text-[13px]">
            {[
              ['声音', result.style.voice],
              ['视角', result.style.pov],
              ['语感', result.style.tense],
              ['基调', result.style.tone],
            ].map(([k, v]) =>
              v ? (
                <div key={k} className="flex gap-3">
                  <dt className="w-8 shrink-0 text-ink-3">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {!!result.style.rules.length && (
            <ul className="space-y-1 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-2">
              {result.style.rules.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-seal" />
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 人物 */}
      <section className="mt-14">
        <h2 className="mb-5 flex items-baseline gap-2 text-xs font-medium tracking-wider text-ink-2">
          人物 <span className="text-ink-3">点击卡片可移除 / 恢复</span>
        </h2>
        <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.characters.map((c, i) => {
            const off = drop.c.has(i);
            return (
              <motion.button key={c.name + i} variants={item} onClick={() => toggle('c', i)} aria-pressed={!off} className={cx('surface group relative rounded-2xl p-5 text-left transition-all duration-300 hover:-translate-y-0.5', off && 'opacity-40 grayscale')}>
                <span className="absolute inset-y-4 left-0 w-[3px] rounded-full" style={{ background: silk(i + 1) }} />
                <div className="flex items-center gap-2">
                  <span className={cx('font-serif text-[18px] font-semibold', off && 'line-through')}>{c.name}</span>
                  <Badge>{c.role}</Badge>
                  <span className="ml-auto text-ink-3 opacity-0 transition group-hover:opacity-100">{off ? <RotateCcw className="size-4" /> : <X className="size-4" />}</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{c.summary}</p>
                <div className="mt-3 space-y-1 text-[12px] text-ink-3">
                  {c.desire && (
                    <div>
                      <span className="text-ink-2">想要</span> {c.desire}
                    </div>
                  )}
                  {c.need && (
                    <div>
                      <span className="text-ink-2">需要</span> {c.need}
                    </div>
                  )}
                </div>
              </motion.button>
            );
          })}
        </motion.div>
      </section>

      {/* 世界与线索 */}
      <section className="mt-14 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 text-xs font-medium tracking-wider text-ink-2">世界观</h2>
          <motion.ul variants={stagger} initial="hidden" animate="show" className="space-y-2">
            {result.world.map((w, i) => (
              <motion.li key={w.name + i} variants={item}>
                <button onClick={() => toggle('w', i)} aria-pressed={!drop.w.has(i)} className={cx('flex w-full gap-3 rounded-xl border border-line px-4 py-3 text-left transition hover:bg-paper-2', drop.w.has(i) && 'opacity-40')}>
                  <Badge tone="indigo" className="mt-0.5 shrink-0">
                    {w.category}
                  </Badge>
                  <span className="min-w-0">
                    <span className={cx('block text-[14px] font-medium', drop.w.has(i) && 'line-through')}>{w.name}</span>
                    <span className="block text-[12.5px] leading-relaxed text-ink-3">{w.content}</span>
                  </span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        </div>
        <div>
          <h2 className="mb-4 text-xs font-medium tracking-wider text-ink-2">故事线</h2>
          <motion.ul variants={stagger} initial="hidden" animate="show" className="space-y-2">
            {result.threads.map((t, i) => (
              <motion.li key={t.name + i} variants={item}>
                <button onClick={() => toggle('t', i)} aria-pressed={!drop.t.has(i)} className={cx('flex w-full items-start gap-3 rounded-xl border border-line px-4 py-3 text-left transition hover:bg-paper-2', drop.t.has(i) && 'opacity-40')}>
                  <span className="mt-1.5 h-[3px] w-6 shrink-0 rounded-full" style={{ background: silk(i) }} />
                  <span className="min-w-0">
                    <span className={cx('block text-[14px] font-medium', drop.t.has(i) && 'line-through')}>
                      {t.name} {t.kind === 'main' && <Badge tone="seal">主线</Badge>}
                    </span>
                    <span className="block text-[12.5px] leading-relaxed text-ink-3">{t.description}</span>
                  </span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </section>

      <motion.div initial={{ y: 80 }} animate={{ y: 0 }} transition={{ delay: 0.5, type: 'spring', stiffness: 260, damping: 30 }} className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-paper-2/95 p-2 pl-5 shadow-[var(--shadow-float)] backdrop-blur">
          <span className="mr-3 hidden text-[12.5px] text-ink-3 sm:inline">
            {result.characters.length - drop.c.size} 位人物 · {result.world.length - drop.w.size} 条设定 · {result.threads.length - drop.t.size} 条故事线
          </span>
          <Button variant="ghost" size="sm" onClick={onBack}>
            调整灵感
          </Button>
          <Button variant="outline" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={onReweave}>
            重新生成
          </Button>
          <Button variant="seal" onClick={create} loading={creating}>
            创建作品 <ArrowRight className="size-4" />
          </Button>
        </div>
      </motion.div>
    </motion.main>
  );
}
