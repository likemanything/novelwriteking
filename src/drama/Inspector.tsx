/** 右侧检查器：查看并修改选中节点的内容。修改保存后，下游节点会自动标记为「已过期」。 */
import { Check, ExternalLink, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Field, IconButton, Input, Segmented, Textarea } from '@/components/ui';
import { mediaUrl } from '@/cloud/providers';
import { cx } from '@/lib/util';
import { GENRES, NODE_LABEL, type BreakdownOutput, type DramaNodeDTO, type DramaPreset, type ImageOutput, type OutlineOutput, type ScriptOutput, type StoryboardOutput } from '@/shared/drama';

interface Props {
  node: DramaNodeDTO;
  novelId: string;
  preset: DramaPreset;
  chapterCount: number;
  /** 小说章节序号 → 章节 id，用于「溯源」跳转 */
  chapterIds: Record<number, string>;
  canWrite: boolean;
  onClose: () => void;
  onSaveOutput: (output: unknown) => Promise<void>;
  onApprove: (approved: boolean) => void;
  onSavePreset: (p: Partial<DramaPreset>) => Promise<void>;
  onSaveParams: (params: { prompt?: string }) => Promise<void>;
}

const Label = ({ children }: { children: ReactNode }) => <div className="mb-1 text-fs-2xs font-medium tracking-wide text-ink-3">{children}</div>;

function Area({ value, onChange, disabled, rows = 2 }: { value: string; onChange: (v: string) => void; disabled?: boolean; rows?: number }) {
  return <Textarea value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} minRows={rows} className="text-fs-sm leading-relaxed" />;
}

function useDraft<T>(node: DramaNodeDTO) {
  const [draft, setDraft] = useState<T>(node.output as T);
  useEffect(() => setDraft(node.output as T), [node.id, node.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(node.output), [draft, node.output]);
  return { draft, setDraft, dirty };
}

function SourceChip({ chapter, quote, chapterIds, novelId }: { chapter: number; quote?: string; chapterIds: Record<number, string>; novelId: string }) {
  const navigate = useNavigate();
  const id = chapterIds[chapter];
  return (
    <button
      type="button"
      disabled={!id}
      onClick={() => id && navigate(`/p/${novelId}/write/${id}`)}
      title={quote ? `原文：${quote}` : '打开原著章节'}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-line px-2 py-0.5 text-fs-2xs text-ink-3 transition hover:border-seal/40 hover:text-seal disabled:opacity-60"
    >
      <ExternalLink className="size-3 shrink-0" />
      <span className="truncate">原著第 {chapter} 章{quote ? `：“${quote}”` : ''}</span>
    </button>
  );
}

// ───────── 小说节点：剧型与范围 ─────────

function SourceForm({ preset, chapterCount, canWrite, onSave }: { preset: DramaPreset; chapterCount: number; canWrite: boolean; onSave: Props['onSavePreset'] }) {
  const [p, setP] = useState(preset);
  const [busy, setBusy] = useState(false);
  useEffect(() => setP(preset), [preset]);
  const dirty = JSON.stringify(p) !== JSON.stringify(preset);
  const num = (k: keyof DramaPreset, min: number, max: number) => (
    <Input type="number" min={min} max={max} value={p[k] as number} disabled={!canWrite} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="从第几章">{num('chapterFrom', 1, chapterCount)}</Field>
        <Field label="到第几章" hint={`共 ${chapterCount} 章`}>{num('chapterTo', 1, chapterCount)}</Field>
        <Field label="集数">{num('episodes', 1, 80)}</Field>
        <Field label="每集秒数">{num('episodeSeconds', 30, 180)}</Field>
      </div>
      <Field label="画幅" group>
        <Segmented size="sm" value={p.ratio} onChange={(v) => setP({ ...p, ratio: v })} options={[{ value: '9:16', label: '竖屏 9:16' }, { value: '16:9', label: '横屏 16:9' }]} />
      </Field>
      <Field label="剧型" hint={GENRES.find((g) => g.value === p.genre)?.hint}>
        <div className="flex flex-wrap gap-1.5">
          {GENRES.map((g) => (
            <button key={g.value} type="button" disabled={!canWrite} onClick={() => setP({ ...p, genre: g.value })} className={cx('rounded-full border px-3 py-1 text-fs-xs transition', p.genre === g.value ? 'border-seal/50 bg-seal/[.07] text-seal' : 'border-line text-ink-2 hover:border-line-2')}>
              {g.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="画风与补充要求" hint="会写进每个分镜的画面描述">
        <Area value={p.style} onChange={(v) => setP({ ...p, style: v })} disabled={!canWrite} rows={2} />
      </Field>
      {canWrite && (
        <Button
          variant="ink"
          disabled={!dirty}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(p);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存设定
        </Button>
      )}
      <p className="text-fs-xs leading-relaxed text-ink-3">改动设定后，受影响的节点会显示「已过期」，点「一键运行」只会重算变化的部分。</p>
    </div>
  );
}

// ───────── 故事拆解 ─────────

function BreakdownView({ d, set, ro }: { d: BreakdownOutput; set: (d: BreakdownOutput) => void; ro: boolean }) {
  return (
    <div className="space-y-5">
      <div><Label>一句话</Label><Area value={d.logline} onChange={(v) => set({ ...d, logline: v })} disabled={ro} /></div>
      <div><Label>主线</Label><Area value={d.mainPlot} onChange={(v) => set({ ...d, mainPlot: v })} disabled={ro} rows={4} /></div>
      <div><Label>基调与节奏</Label><Area value={d.tone} onChange={(v) => set({ ...d, tone: v })} disabled={ro} /></div>
      <div>
        <Label>人物（外貌会写进每个镜头，保证前后一致）</Label>
        <div className="space-y-3">
          {d.characters.map((c, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <div className="mb-1.5 flex items-center gap-2 text-fs-sm font-medium">{c.name}<Badge>{c.role}</Badge></div>
              <Label>外貌</Label>
              <Area value={c.look} onChange={(v) => set({ ...d, characters: d.characters.map((x, j) => (j === i ? { ...x, look: v } : x)) })} disabled={ro} />
              <div className="mt-2"><Label>声线</Label></div>
              <Area value={c.voice} onChange={(v) => set({ ...d, characters: d.characters.map((x, j) => (j === i ? { ...x, voice: v } : x)) })} disabled={ro} rows={1} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Label>场景</Label>
        <div className="space-y-3">
          {d.locations.map((l, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <div className="mb-1.5 text-fs-sm font-medium">{l.name}</div>
              <Area value={l.look} onChange={(v) => set({ ...d, locations: d.locations.map((x, j) => (j === i ? { ...x, look: v } : x)) })} disabled={ro} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Label>关键事件</Label>
        <ul className="space-y-2 text-fs-xs text-ink-2">
          {d.keyEvents.map((e, i) => (
            <li key={i} className="rounded-lg bg-ink/[.03] px-3 py-2">
              <div className="font-medium">{e.title} <span className="font-normal text-ink-3">· 可视化 {'★'.repeat(e.visual)}</span></div>
              <div className="text-ink-3">{e.summary}</div>
            </li>
          ))}
        </ul>
      </div>
      <div><Label>改编建议</Label><Area value={d.notes} onChange={(v) => set({ ...d, notes: v })} disabled={ro} rows={3} /></div>
    </div>
  );
}

// ───────── 分集大纲 ─────────

function OutlineView({ d, set, ro, chapterIds, novelId }: { d: OutlineOutput; set: (d: OutlineOutput) => void; ro: boolean; chapterIds: Record<number, string>; novelId: string }) {
  const upd = (i: number, patch: Partial<OutlineOutput['episodes'][number]>) => set({ episodes: d.episodes.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  return (
    <div className="space-y-4">
      {d.episodes.map((e, i) => (
        <div key={e.n} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-serif text-fs-sm text-seal">第 {e.n} 集</span>
            <Input value={e.title} disabled={ro} onChange={(ev) => upd(i, { title: ev.target.value })} className="h-8 flex-1 text-fs-sm font-medium" aria-label={`第${e.n}集标题`} />
          </div>
          {([['hook', '开场钩子'], ['conflict', '核心冲突'], ['twist', '反转'], ['cliffhanger', '结尾悬念'], ['summary', '剧情']] as const).map(([k, label]) => (
            <div key={k} className="mb-2"><Label>{label}</Label><Area value={e[k]} onChange={(v) => upd(i, { [k]: v })} disabled={ro} rows={1} /></div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {e.sourceChapters.map((c) => <SourceChip key={c} chapter={c} chapterIds={chapterIds} novelId={novelId} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────── 剧本 ─────────

function ScriptView({ d, set, ro, chapterIds, novelId }: { d: ScriptOutput; set: (d: ScriptOutput) => void; ro: boolean; chapterIds: Record<number, string>; novelId: string }) {
  const updLine = (si: number, li: number, patch: object) =>
    set({ ...d, scenes: d.scenes.map((s, a) => (a === si ? { ...s, lines: s.lines.map((l, b) => (b === li ? { ...l, ...patch } : l)) } : s)) });
  return (
    <div className="space-y-5">
      <Input value={d.title} disabled={ro} onChange={(e) => set({ ...d, title: e.target.value })} className="font-serif text-fs-md font-semibold" aria-label="集标题" />
      {d.scenes.map((s, si) => (
        <div key={si} className="rounded-xl border border-line p-3">
          <div className="mb-1 text-fs-sm font-medium">场 {s.n}　{s.location}　<span className="font-normal text-ink-3">{s.time}</span></div>
          <p className="mb-2 text-fs-xs text-ink-3">{s.summary}</p>
          {s.source && <div className="mb-2"><SourceChip chapter={s.source.chapter} quote={s.source.quote} chapterIds={chapterIds} novelId={novelId} /></div>}
          <div className="space-y-2">
            {s.lines.map((l, li) => (
              <div key={li} className="flex gap-2">
                <span className={cx('mt-2 w-10 shrink-0 text-right text-fs-2xs', l.type === 'dialogue' ? 'text-seal' : 'text-ink-3')}>{l.type === 'dialogue' ? l.speaker : l.type === 'narration' ? '旁白' : '△'}</span>
                <div className="min-w-0 flex-1">
                  <Area value={l.text} onChange={(v) => updLine(si, li, { text: v })} disabled={ro} rows={1} />
                  {l.type === 'dialogue' && l.emotion && <div className="mt-0.5 text-fs-2xs text-ink-3">情绪：{l.emotion}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────── 分镜 ─────────

function StoryboardView({ d, set, ro }: { d: StoryboardOutput; set: (d: StoryboardOutput) => void; ro: boolean }) {
  const upd = (i: number, patch: object) => {
    const shots = d.shots.map((s, j) => (j === i ? { ...s, ...patch } : s));
    set({ ...d, shots, totalSeconds: shots.reduce((n, s) => n + s.seconds, 0) });
  };
  return (
    <div className="space-y-3">
      <p className="text-fs-xs text-ink-3">{d.shots.length} 个镜头，共 {d.totalSeconds} 秒。画面描述与首帧将直接作为后续图像 / 视频模型的提示词。</p>
      {d.shots.map((s, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center gap-2 text-fs-xs">
            <span className="font-serif text-seal">镜 {s.n}</span>
            <Badge>{s.size}</Badge>
            <Badge>{s.move}</Badge>
            <label className="ml-auto flex items-center gap-1 text-ink-3">
              <Input type="number" min={1} max={15} value={s.seconds} disabled={ro} onChange={(e) => upd(i, { seconds: Math.min(15, Math.max(1, Number(e.target.value) || 1)) })} className="h-7 w-14 px-2 text-fs-xs" aria-label={`镜${s.n}秒数`} />秒
            </label>
          </div>
          <Label>画面</Label>
          <Area value={s.visual} onChange={(v) => upd(i, { visual: v })} disabled={ro} rows={2} />
          <div className="mt-2"><Label>首帧</Label></div>
          <Area value={s.firstFrame} onChange={(v) => upd(i, { firstFrame: v })} disabled={ro} rows={1} />
          {s.dialogue && (
            <div className="mt-2 rounded-lg bg-seal/[.05] px-2.5 py-1.5 text-fs-xs">
              <span className="text-seal">{s.dialogue.speaker}</span>
              {s.dialogue.emotion && <span className="text-ink-3">（{s.dialogue.emotion}）</span>}：{s.dialogue.text}
            </div>
          )}
          {s.narration && <div className="mt-2 text-fs-xs text-ink-2">【旁白】{s.narration}</div>}
          {s.sfx && <div className="mt-1 text-fs-xs text-ink-3">音效：{s.sfx}</div>}
        </div>
      ))}
    </div>
  );
}

// ───────── 图像节点（人物定妆 / 场景图） ─────────

function ImageView({ node, ro, onSave }: { node: DramaNodeDTO; ro: boolean; onSave: Props['onSaveParams'] }) {
  const out = node.output as ImageOutput | null;
  const custom = typeof node.params.prompt === 'string' ? (node.params.prompt as string) : '';
  const [prompt, setPrompt] = useState(custom || out?.prompt || '');
  useEffect(() => setPrompt(custom || out?.prompt || ''), [custom, out?.prompt, node.updatedAt]);
  const dirty = prompt.trim() !== (custom || out?.prompt || '');
  return (
    <div className="space-y-4">
      {node.status === 'failed' && node.error && <p className="rounded-lg bg-seal/[.07] px-3 py-2 text-fs-xs leading-relaxed text-seal" role="alert">{node.error}</p>}
      {out && <img src={mediaUrl(out.assetId)} alt={node.title} className="w-full rounded-xl border border-line" />}
      <div>
        <Label>提示词{custom ? '（已自定义）' : '（自动生成，可修改）'}</Label>
        <Area value={prompt} onChange={setPrompt} disabled={ro} rows={5} />
        {!ro && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" disabled={!dirty} onClick={() => onSave({ prompt: prompt.trim() })}>保存提示词</Button>
            {custom && <Button size="sm" variant="ghost" onClick={() => onSave({ prompt: '' })}>恢复自动生成</Button>}
          </div>
        )}
        <p className="mt-2 text-fs-xs leading-relaxed text-ink-3">修改提示词后，节点会显示「已过期」，点节点上的「重算」生成新图；旧图会在新图成功后清理。</p>
      </div>
    </div>
  );
}

// ───────── 外壳 ─────────

export function Inspector(p: Props) {
  const { node } = p;
  const ro = !p.canWrite;
  const { draft, setDraft, dirty } = useDraft<any>(node);
  const [saving, setSaving] = useState(false);
  const hasOutput = node.status === 'done' && !!node.output;

  const body = (() => {
    if (node.type === 'source') return <SourceForm preset={p.preset} chapterCount={p.chapterCount} canWrite={p.canWrite} onSave={p.onSavePreset} />;
    if (node.status === 'running') return <p className="text-fs-sm text-ink-3">正在生成……完成后这里会自动刷新。</p>;
    if ((node.type === 'portrait' || node.type === 'location') && !hasOutput) return <ImageView node={node} ro={ro} onSave={p.onSaveParams} />;
    if (node.status === 'failed' && !hasOutput) return <p className="text-fs-sm leading-relaxed text-seal">{node.error ?? '运行失败'}</p>;
    if (!hasOutput && (node.type === 'portrait' || node.type === 'location')) return <ImageView node={node} ro={ro} onSave={p.onSaveParams} />;
    if (!hasOutput) return <p className="text-fs-sm leading-relaxed text-ink-3">{NODE_LABEL[node.type].hint}。点击节点上的「运行」，或在顶部「一键运行」。</p>;
    switch (node.type) {
      case 'breakdown': return <BreakdownView d={draft} set={setDraft} ro={ro} />;
      case 'outline': return <OutlineView d={draft} set={setDraft} ro={ro} chapterIds={p.chapterIds} novelId={p.novelId} />;
      case 'script': return <ScriptView d={draft} set={setDraft} ro={ro} chapterIds={p.chapterIds} novelId={p.novelId} />;
      case 'storyboard': return <StoryboardView d={draft} set={setDraft} ro={ro} />;
      case 'portrait':
      case 'location': return <ImageView node={node} ro={ro} onSave={p.onSaveParams} />;
    }
  })();

  return (
    <aside className="absolute top-0 right-0 bottom-0 z-20 flex w-[min(460px,100%)] flex-col border-l border-line bg-paper shadow-[var(--shadow-float)]" aria-label="节点详情">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-fs-md font-semibold">{node.title || NODE_LABEL[node.type].title}</div>
          <div className="text-fs-2xs text-ink-3">{NODE_LABEL[node.type].title}{node.stale && node.status === 'done' ? ' · 上游已变化，建议重算' : ''}</div>
        </div>
        {hasOutput && p.canWrite && node.type !== 'source' && (
          <Button size="xs" variant={node.approved ? 'soft' : 'outline'} icon={<Check className="size-3.5" />} onClick={() => p.onApprove(!node.approved)}>
            {node.approved ? '已审' : '标记通过'}
          </Button>
        )}
        <IconButton label="关闭" size="sm" onClick={p.onClose}><X className="size-4" /></IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{body}</div>
      {dirty && p.canWrite && node.type !== 'source' && (
        <footer className="flex items-center gap-2 border-t border-line bg-paper-2 px-4 py-3">
          <span className="flex-1 text-fs-xs text-ink-3">有未保存的修改。保存后，依赖它的下游节点会标记为过期。</span>
          <Button size="sm" variant="ghost" onClick={() => setDraft(node.output)}>放弃</Button>
          <Button
            size="sm"
            variant="seal"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await p.onSaveOutput(draft);
              } finally {
                setSaving(false);
              }
            }}
          >
            保存修改
          </Button>
        </footer>
      )}
    </aside>
  );
}
