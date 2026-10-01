/**
 * 审稿面板：雷达图 + 逐条情节点核对 + 可勾选的修改意见。
 * 意见不会自动执行——作者勾选哪几条，修订就只处理哪几条。
 */
import { motion } from 'motion/react';
import { Check, CircleHelp, Quote, RefreshCw, Sparkles, Wand2, X, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Empty, Textarea, Toggle } from '@/components/ui';
import { CRITIQUE_DIMENSIONS, type BeatStatus, type Critique } from '@/lib/types';
import { cx, relativeTime } from '@/lib/util';

function Radar({ scores }: { scores: Critique['scores'] }) {
  const size = 236;
  const c = size / 2;
  const r = 70;
  const pts = CRITIQUE_DIMENSIONS.map((d, i) => {
    const a = -Math.PI / 2 + (i / CRITIQUE_DIMENSIONS.length) * Math.PI * 2;
    return { d, a, v: (scores[d] ?? 0) / 10 };
  });
  const poly = (k: (p: (typeof pts)[number]) => number) => pts.map((p) => `${c + Math.cos(p.a) * r * k(p)},${c + Math.sin(p.a) * r * k(p)}`).join(' ');
  const avg = pts.reduce((s, p) => s + p.v * 10, 0) / pts.length;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`审稿评分：${pts.map((p) => `${p.d}${(p.v * 10).toFixed(1)}`).join('，')}`}>
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <polygon key={k} points={poly(() => k)} fill="none" stroke="var(--line-2)" strokeWidth="1" />
        ))}
        {pts.map((p) => (
          <line key={p.d} x1={c} y1={c} x2={c + Math.cos(p.a) * r} y2={c + Math.sin(p.a) * r} stroke="var(--line)" />
        ))}
        <motion.polygon
          points={poly((p) => p.v)}
          fill="color-mix(in oklab, var(--seal) 18%, transparent)"
          stroke="var(--seal)"
          strokeWidth="1.8"
          strokeLinejoin="round"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: `${c}px ${c}px` }}
        />
        {pts.map((p) => (
          <text key={p.d} x={c + Math.cos(p.a) * (r + 18)} y={c + Math.sin(p.a) * (r + 18) + 4} textAnchor="middle" fontSize="11" fill="var(--ink-2)">
            {p.d}
            <tspan fill="var(--ink-3)" fontSize="10">
              {' '}
              {(p.v * 10).toFixed(1)}
            </tspan>
          </text>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="font-serif text-fs-xl font-semibold text-ink tabular-nums">{avg.toFixed(1)}</span>
      </div>
    </div>
  );
}

const BEAT_ICON: Record<BeatStatus, { icon: typeof Check; cls: string; label: string }> = {
  done: { icon: Check, cls: 'bg-jade/15 text-jade', label: '已完成' },
  missing: { icon: X, cls: 'bg-seal/12 text-seal', label: '未完成' },
  uncertain: { icon: CircleHelp, cls: 'bg-gold/15 text-gold', label: '待核实' },
};

const SEV = { high: { label: '重要', tone: 'seal' as const }, medium: { label: '建议', tone: 'gold' as const }, low: { label: '可选', tone: 'neutral' as const } };

interface Props {
  critique: Critique | undefined;
  stale: boolean;
  critiquing: boolean;
  writing: boolean;
  canCritique: boolean;
  onCritique: () => void;
  onFlash: (quote: string) => void;
  onRevise: (issueIds: string[], instruction: string, includeBeats: boolean) => void;
  /** 作者确认「与前文矛盾」是有意为之，写入连续性台账 */
  onAcknowledge?: (issue: Critique['issues'][number]) => void;
}

export function CritiquePanel({ critique, stale, critiquing, writing, canCritique, onCritique, onFlash, onRevise, onAcknowledge }: Props) {
  if (critiquing) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
        <div className="relative size-16">
          <motion.span className="absolute inset-0 rounded-full border-2 border-seal/30" animate={{ scale: [1, 1.35], opacity: [0.8, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-seal/10 text-seal">
            <Quote className="size-6" />
          </span>
        </div>
        <div className="shimmer-text font-serif text-fs-md">编辑正在逐句阅读……</div>
        <p className="max-w-[240px] text-fs-xs leading-relaxed text-ink-3">会逐条核对细纲里的情节点是否真正写出来了，并给出可勾选的修改意见。</p>
      </div>
    );
  }
  if (!critique) {
    return (
      <Empty icon={<Quote />} title="还没有审稿报告" action={<Button variant="ink" size="sm" icon={<Sparkles className="size-4" />} onClick={onCritique} disabled={!canCritique}>请编辑审稿</Button>}>
        审稿会给出五个维度的评分、逐条情节点核对，以及引用原文的修改意见。
      </Empty>
    );
  }
  return <Report key={critique.id} critique={critique} stale={stale} writing={writing} onCritique={onCritique} onFlash={onFlash} onRevise={onRevise} onAcknowledge={onAcknowledge} canCritique={canCritique} />;
}

function Report({ critique, stale, writing, canCritique, onCritique, onFlash, onRevise, onAcknowledge }: Omit<Props, 'critique' | 'critiquing'> & { critique: Critique }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(critique.issues.filter((i) => i.severity !== 'low').map((i) => i.id)));
  const [instruction, setInstruction] = useState('');
  const pendingBeats = useMemo(() => critique.beats.filter((b) => b.status !== 'done'), [critique.beats]);
  const [includeBeats, setIncludeBeats] = useState(pendingBeats.length > 0);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const doneCount = critique.beats.filter((b) => b.status === 'done').length;
  const stagger = { show: { transition: { staggerChildren: 0.05 } } };
  const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

  return (
    <div className="space-y-6 p-5 pb-8">
      {stale && (
        <div className="flex items-center gap-2 rounded-xl bg-gold/12 px-3 py-2 text-fs-xs text-gold">
          <RefreshCw className="size-3.5 shrink-0" />
          <span className="flex-1">这份报告针对的是较早的版本。</span>
          <button className="font-medium underline-offset-2 hover:underline disabled:opacity-50" onClick={onCritique} disabled={!canCritique}>
            重新审稿
          </button>
        </div>
      )}
      <div>
        <Radar scores={critique.scores} />
        <p className="mt-2 font-serif text-fs-base leading-7 text-ink-2">{critique.verdict}</p>
        <div className="mt-1 text-fs-2xs text-ink-3">
          {relativeTime(critique.createdAt)} · AI 评分仅供参考
        </div>
        {!!critique.dropped && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-jade/10 px-2.5 py-1.5 text-fs-xs leading-relaxed text-jade" role="note">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            已自动过滤 {critique.dropped} 条意见：它们引用的原文在正文里找不到，疑似模型编造。
          </p>
        )}
      </div>

      <section>
        <h4 className="mb-2 flex items-center justify-between text-xs font-medium tracking-wide text-ink-2">
          情节点核对
          <span className="font-normal text-ink-3 tabular-nums">
            {doneCount} / {critique.beats.length} 已完成
          </span>
        </h4>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="space-y-1.5">
          {critique.beats.map((b, i) => {
            const meta = BEAT_ICON[b.status];
            return (
              <motion.li key={i} variants={item} className="rounded-xl border border-line bg-paper px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', meta.cls)} title={meta.label}>
                    <meta.icon className="size-3" strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-fs-sm leading-snug">{b.beat}</div>
                    {b.note && <div className="mt-1 text-fs-xs leading-relaxed text-gold">{b.note}</div>}
                    {b.evidence && (
                      <button onClick={() => onFlash(b.evidence)} className="mt-1 text-left text-fs-xs leading-relaxed text-ink-3 transition hover:text-seal">
                        {b.status === 'done' ? `「${b.evidence.replace(/^[“"「]|[”"」]$/g, '')}」` : b.evidence}
                      </button>
                    )}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      </section>

      <section>
        <h4 className="mb-2 flex items-center justify-between text-xs font-medium tracking-wide text-ink-2">
          修改意见
          <span className="font-normal text-ink-3">勾选要采纳的</span>
        </h4>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="space-y-2">
          {critique.issues.map((is) => {
            const on = picked.has(is.id);
            return (
              <motion.li key={is.id} variants={item} className={cx('rounded-xl border transition-all duration-300', on ? 'border-seal/30 bg-seal/[.04]' : 'border-line bg-paper')}>
                <div className="flex gap-2.5 p-3">
                  <button role="checkbox" aria-checked={on} aria-label={`采纳：${is.problem}`} onClick={() => toggle(is.id)} className={cx('mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border-2 transition-all', on ? 'border-seal bg-seal text-white' : 'border-line-2 hover:border-ink/40')}>
                    {on && <Check className="size-3" strokeWidth={3.5} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={SEV[is.severity].tone}>{SEV[is.severity].label}</Badge>
                      <span className="text-fs-xs text-ink-3">{is.type}</span>
                      {is.verified && is.verified !== 'global' && (
                        <span className="ml-auto flex items-center gap-1 text-fs-2xs text-jade" title={is.verified === 'exact' ? '引文已在正文中精确找到' : '引文与正文有细微出入，已按最接近的原文定位'}>
                          <ShieldCheck className="size-3" />
                          {is.verified === 'exact' ? '已核对原文' : '近似核对'}
                        </span>
                      )}
                    </div>
                    {is.quote && (
                      <button onClick={() => onFlash(is.quote)} className="mt-1.5 block w-full rounded-lg border-l-2 border-seal/50 bg-ink/[.03] px-2.5 py-1.5 text-left font-serif text-fs-xs leading-relaxed text-ink-2 transition hover:bg-seal/[.06]" title="在正文中定位">
                        {is.quote}
                      </button>
                    )}
                    <p className="mt-1.5 text-fs-xs leading-relaxed text-ink">{is.problem}</p>
                    {is.fact && <p className="mt-1 rounded-md bg-ink/[.04] px-2 py-1 text-fs-xs leading-relaxed text-ink-3">对照的前文事实：{is.fact}</p>}
                    {is.fact && is.verified === 'global' && onAcknowledge && (
                      <button onClick={() => onAcknowledge(is)} className="mt-1.5 text-fs-xs text-ink-3 underline-offset-2 transition hover:text-seal hover:underline">
                        这是有意为之（写入台账，后文按此为准）
                      </button>
                    )}
                    <p className="mt-0.5 text-fs-xs leading-relaxed text-ink-3">→ {is.suggestion}</p>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      </section>

      {!!critique.strengths.length && (
        <section>
          <h4 className="mb-2 text-xs font-medium tracking-wide text-ink-2">值得保留</h4>
          <ul className="space-y-1">
            {critique.strengths.map((s) => (
              <li key={s} className="flex gap-2 text-fs-xs leading-relaxed text-ink-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-jade" />
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sticky bottom-0 -mx-5 space-y-3 border-t border-line bg-paper-2/95 px-5 pt-4 pb-1 backdrop-blur">
        {pendingBeats.length > 0 && (
          <label className="flex items-center justify-between gap-3 text-fs-xs text-ink-2">
            <span>同时补全 {pendingBeats.length} 个未完成 / 待核实的情节点</span>
            <Toggle checked={includeBeats} onChange={setIncludeBeats} label="补全情节点" />
          </label>
        )}
        <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} minRows={1} placeholder="额外的修改指示（选填）" className="text-fs-sm" />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onCritique} disabled={!canCritique}>
            重审
          </Button>
          <Button variant="seal" size="sm" className="flex-1" icon={<Wand2 className="size-4" />} disabled={writing || (!picked.size && !includeBeats && !instruction.trim())} onClick={() => onRevise([...picked], instruction, includeBeats)}>
            按选中意见修订{picked.size ? `（${picked.size}）` : ''}
          </Button>
        </div>
      </section>
    </div>
  );
}
