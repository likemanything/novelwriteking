/** 首页顶部：标语、灵感输入框与会写小说的小墨团。登录前后共用。 */
import { motion } from 'motion/react';
import { ArrowRight, Dices, Eye, Layers, Stamp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { composeMany, fetchInspiration, prefetchInspirations } from '@/ai/inspiration';
import { useStageProfile } from '@/cloud/models';
import { ThreadField } from '@/components/ThreadField';
import { WritingScene } from '@/components/WritingScene';
import { Button, Kbd } from '@/components/ui';
import { toast } from '@/store/ui';

export function useTypewriter(lines: string[], active: boolean) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!active) return;
    let line = Math.floor(Math.random() * lines.length);
    let i = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const target = lines[line];
      if (!deleting) {
        i++;
        setText(target.slice(0, i));
        if (i >= target.length) {
          deleting = true;
          timer = setTimeout(step, 2200);
          return;
        }
        timer = setTimeout(step, 55 + Math.random() * 60);
      } else {
        i -= 2;
        setText(target.slice(0, Math.max(0, i)));
        if (i <= 0) {
          deleting = false;
          line = (line + 1) % lines.length;
          timer = setTimeout(step, 400);
          return;
        }
        timer = setTimeout(step, 22);
      }
    };
    timer = setTimeout(step, 900);
    return () => clearTimeout(timer);
  }, [active, lines]);
  return text;
}

function RevealLine({ text, delay, accent }: { text: string; delay: number; accent?: [number, number] }) {
  return (
    <span className="block" aria-hidden="true">
      {[...text].map((ch, i) => {
        const isAccent = accent && i >= accent[0] && i < accent[1];
        return (
          <motion.span
            key={i}
            className={isAccent ? 'relative inline-block text-seal' : 'inline-block'}
            initial={{ opacity: 0, y: '0.35em', filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: delay + i * 0.055, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {ch}
            {isAccent && i === accent![1] - 1 && (
              <motion.svg viewBox="0 0 200 20" className="absolute -bottom-[0.12em] right-0 h-[0.22em] w-[200%] overflow-visible" preserveAspectRatio="none">
                <motion.path
                  d="M2 12 C 50 4, 120 18, 198 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: delay + text.length * 0.055 + 0.3, duration: 0.9, ease: 'easeInOut' }}
                />
              </motion.svg>
            )}
          </motion.span>
        );
      })}
    </span>
  );
}

function SeedBox({ onEnergy, onSubmit }: { onEnergy: () => void; onSubmit: (seed: string) => void }) {
  const [seed, setSeed] = useState('');
  const [focused, setFocused] = useState(false);
  const lines = useMemo(() => composeMany(6), []);
  const placeholder = useTypewriter(lines, !seed && !focused);
  const ref = useRef<HTMLTextAreaElement>(null);
  const diceTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(diceTimer.current), []);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    clearInterval(diceTimer.current);
    if (seed.trim()) onSubmit(seed.trim());
  };

  const [rolling, setRolling] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  // 有模型时，提前在后台备好一批灵感，点「随机灵感」就能立刻出
  const plan = useStageProfile('plan');
  useEffect(() => {
    if (plan.provider === 'cloud') void prefetchInspirations();
  }, [plan.provider]);

  /** 随机灵感：有模型时由模型现写（边写边显示），没有时本地组合。 */
  const dice = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    clearInterval(diceTimer.current);
    setRolling(true);
    onEnergy();
    try {
      const r = await fetchInspiration({ signal: c.signal });
      if (c.signal.aborted) return;
      if (r.fellBack) toast('模型暂时没有响应，这条灵感来自本地组合', { tone: 'info' });
      if (r.source === 'local') {
        // 本地组合：逐字落进输入框
        let i = 0;
        await new Promise<void>((resolve) => {
          diceTimer.current = setInterval(() => {
            i += 2;
            setSeed(r.text.slice(0, i));
            onEnergy();
            if (i >= r.text.length) {
              clearInterval(diceTimer.current);
              resolve();
            }
          }, 24);
        });
      } else {
        // 模型写的灵感同样逐字落进输入框
        let i = 0;
        await new Promise<void>((resolve) => {
          diceTimer.current = setInterval(() => {
            i += 2;
            setSeed(r.text.slice(0, i));
            onEnergy();
            if (i >= r.text.length) {
              clearInterval(diceTimer.current);
              resolve();
            }
          }, 24);
        });
      }
      ref.current?.focus();
    } catch {
      /* 被新的一次取代或已取消 */
    } finally {
      if (ctrl.current === c) setRolling(false);
    }
  };

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.1, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      className="group relative mt-10 max-w-2xl text-left lg:mx-0 mx-auto"
    >
      <div className="absolute -inset-px rounded-[26px] bg-gradient-to-br from-seal/40 via-gold/20 to-indigo/30 opacity-0 blur-md transition-opacity duration-700 group-focus-within:opacity-100" />
      <div className="relative rounded-[24px] border border-line bg-paper-2/90 p-2 shadow-[var(--shadow-float)] backdrop-blur-md">
        <div className="relative">
          <textarea
            ref={ref}
            value={seed}
            rows={2}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              clearInterval(diceTimer.current);
              setSeed(e.target.value);
              onEnergy();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            aria-label="写下你的一句灵感"
            className="block min-h-[104px] w-full resize-none bg-transparent px-5 pt-5 pb-2 font-serif text-[21px] leading-relaxed text-ink outline-none"
          />
          {!seed && (
            <div className="pointer-events-none absolute top-5 left-5 right-5 font-serif text-[21px] leading-relaxed text-ink-3">
              {focused ? '写下你的一句灵感……' : placeholder}
              {!focused && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-seal/70 animate-[caret_1.05s_steps(1)_infinite]" />}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <Button type="button" variant="ghost" size="sm" icon={<Dices className="size-4" />} onClick={dice} loading={rolling}>
            {rolling ? '正在想……' : '随机灵感'}
          </Button>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button type="submit" variant="seal" disabled={!seed.trim()} className="group/btn">
              开始创作
              <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />
            </Button>
          </div>
        </div>
      </div>
    </motion.form>
  );
}

const PILLARS = [
  { icon: Layers, title: '先搭框架', text: '一句灵感生成人物、世界观、故事线和章节细纲' },
  { icon: Eye, title: '资料透明', text: '每次生成用了哪些设定和前文，一目了然' },
  { icon: Stamp, title: '作者把关', text: 'AI 只给建议，写进设定集的每一条都由你确认' },
];

export function Hero({ topBar, onStart, children }: { topBar: ReactNode; onStart: (seed: string) => void; children?: ReactNode }) {
  const [energy, setEnergy] = useState(0);
  const [converge, setConverge] = useState(0);

  // 打字能量随时间衰减
  useEffect(() => {
    if (energy <= 0.01) return;
    const t = setTimeout(() => setEnergy((e) => (e < 0.02 ? 0 : e * 0.88)), 90);
    return () => clearTimeout(t);
  }, [energy]);

  const start = (seed: string) => {
    setConverge(1);
    setEnergy(1);
    setTimeout(() => onStart(seed), 520);
  };

  return (
    <section className="relative isolate min-h-[88vh] overflow-hidden">
      <ThreadField className="absolute inset-0 -z-10 h-full w-full" energy={energy} converge={converge} />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-paper" />
      {topBar}
      <div className="mx-auto grid max-w-6xl items-center gap-6 px-6 pt-[5vh] pb-16 lg:grid-cols-[1.1fr_.9fr]">
        <div className="text-center lg:text-left">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="mb-7 inline-flex items-center gap-2 rounded-full border border-line bg-paper-2/60 px-3.5 py-1 text-[12px] tracking-[.18em] text-ink-2 backdrop-blur">
            <span className="size-1.5 rounded-full bg-seal" />
            AI 长篇小说 · 短剧创作工具
          </motion.div>
          <h1 className="font-serif text-[clamp(38px,6vw,76px)] leading-[1.18] font-semibold tracking-[.06em] text-ink" aria-label="把一句灵感，写成一部长篇。">
            <RevealLine text="把一句灵感，" delay={0.15} />
            <RevealLine text="写成一部长篇。" delay={0.55} accent={[4, 6]} />
          </h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 1 }} className="mt-7 max-w-xl text-[15px] leading-8 text-ink-2 max-lg:mx-auto">
            先定人物、世界观和大纲，再一章一章写、审、改。
            <br className="hidden sm:block" />
            写完的小说，还能一键改编成短剧。
          </motion.p>
          <SeedBox onEnergy={() => setEnergy(1)} onSubmit={start} />
          {children}
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5, duration: 1 }} className="mx-auto aspect-[560/440] w-full max-w-[540px]">
          <WritingScene className="h-full w-full" />
        </motion.div>
      </div>
      <motion.ul initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.12, delayChildren: 1.6 } } }} className="mx-auto grid max-w-4xl gap-4 px-6 pb-16 sm:grid-cols-3">
        {PILLARS.map((p) => (
          <motion.li key={p.title} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="flex items-start gap-3 text-left">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-paper-2/70 text-seal backdrop-blur">
              <p.icon className="size-4" strokeWidth={1.8} />
            </span>
            <span>
              <span className="block text-[13px] font-medium text-ink">{p.title}</span>
              <span className="block text-[12px] leading-relaxed text-ink-3">{p.text}</span>
            </span>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
