/** 画布上的节点卡片：每一种节点用编剧/导演的语言说话，而不是技术参数。 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, BookOpen, Clapperboard, Film, ListOrdered, Play, RefreshCw, ScrollText, Square, Wand2 } from 'lucide-react';
import { createContext, useContext } from 'react';
import { Seal } from '@/components/Seal';
import { InkSpinner } from '@/components/ui';
import { cx } from '@/lib/util';
import { GENRES, NODE_LABEL, type BreakdownOutput, type DramaNodeDTO, type DramaPreset, type OutlineOutput, type ScriptOutput, type StoryboardOutput } from '@/shared/drama';

export interface DramaCtxValue {
  canWrite: boolean;
  preset: DramaPreset;
  onRun: (id: string) => void;
  onCancel: (id: string) => void;
}

export const DramaCtx = createContext<DramaCtxValue | null>(null);

const ICON = { source: BookOpen, breakdown: Wand2, outline: ListOrdered, script: ScrollText, storyboard: Clapperboard } as const;

export type FlowNodeData = { node: DramaNodeDTO } & Record<string, unknown>;

function Status({ n }: { n: DramaNodeDTO }) {
  if (n.type === 'source') return null;
  if (n.status === 'running') return <span className="flex items-center gap-1 text-[11px] text-seal"><InkSpinner className="size-3" />运行中</span>;
  if (n.status === 'failed') return <span className="flex items-center gap-1 text-[11px] text-seal"><AlertTriangle className="size-3" />失败</span>;
  if (n.status === 'done' && n.stale) return <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">已过期</span>;
  if (n.status === 'done') return n.approved ? <span className="text-[11px] text-jade">已审</span> : <span className="text-[11px] text-ink-3">完成</span>;
  return <span className="text-[11px] text-ink-3">待运行</span>;
}

function Summary({ n, preset }: { n: DramaNodeDTO; preset: DramaPreset }) {
  const o = n.output as any;
  const muted = 'text-[12px] leading-relaxed text-ink-3';
  switch (n.type) {
    case 'source':
      return (
        <div className="flex flex-wrap gap-1.5 text-[11.5px] text-ink-2">
          {[`第 ${preset.chapterFrom}–${preset.chapterTo} 章`, `${preset.episodes} 集`, `${preset.episodeSeconds} 秒/集`, preset.ratio, GENRES.find((g) => g.value === preset.genre)?.label].map((t) => (
            <span key={t} className="rounded-full bg-ink/[.06] px-2 py-0.5">
              {t}
            </span>
          ))}
        </div>
      );
    case 'breakdown': {
      const b = o as BreakdownOutput | null;
      if (!b) return <p className={muted}>从小说里提炼主线、关键事件、人物外貌与场景。</p>;
      return (
        <>
          <p className="line-clamp-3 text-[12.5px] leading-relaxed text-ink-2">{b.logline}</p>
          <p className={cx(muted, 'mt-1.5')}>
            人物 {b.characters.length} · 事件 {b.keyEvents.length} · 场景 {b.locations.length}
          </p>
        </>
      );
    }
    case 'outline': {
      const ol = o as OutlineOutput | null;
      if (!ol) return <p className={muted}>规划 {preset.episodes} 集：每集的钩子、反转与结尾悬念。</p>;
      return (
        <>
          <p className="text-[12.5px] text-ink-2">共 {ol.episodes.length} 集</p>
          <ul className={cx(muted, 'mt-1')}>
            {ol.episodes.slice(0, 3).map((e) => (
              <li key={e.n} className="truncate">
                {e.n}. {e.title}
              </li>
            ))}
            {ol.episodes.length > 3 && <li>…</li>}
          </ul>
        </>
      );
    }
    case 'script': {
      const s = o as ScriptOutput | null;
      if (!s) return <p className={muted}>把这一集写成可拍的场景化剧本。</p>;
      const lines = s.scenes.reduce((k, x) => k + x.lines.length, 0);
      return (
        <>
          <p className="truncate text-[12.5px] text-ink-2">{s.title}</p>
          <p className={cx(muted, 'mt-1')}>
            {s.scenes.length} 场 · {lines} 条
          </p>
        </>
      );
    }
    case 'storyboard': {
      const s = o as StoryboardOutput | null;
      if (!s) return <p className={muted}>拆成 3–6 秒的镜头，含景别、运镜与首帧。</p>;
      return (
        <p className="text-[12.5px] text-ink-2">
          {s.shots.length} 个镜头 · {s.totalSeconds} 秒
        </p>
      );
    }
  }
}

export function DramaNode({ data, selected }: NodeProps) {
  const n = (data as FlowNodeData).node;
  const ctx = useContext(DramaCtx)!;
  const Icon = ICON[n.type];
  const running = n.status === 'running';
  const runnable = n.type !== 'source';
  const rerun = n.status === 'done' || n.status === 'failed';
  return (
    <div
      className={cx(
        'surface w-[300px] rounded-2xl p-4 transition-shadow',
        selected && 'ring-2 ring-seal/50 shadow-[var(--shadow-float)]',
        n.status === 'failed' && 'ring-1 ring-seal/40',
        n.stale && n.status === 'done' && 'border-dashed',
        running && 'animate-[breathe_2.4s_ease-in-out_infinite]',
      )}
    >
      {n.type !== 'source' && <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-paper-2 !bg-ink-3" />}
      {n.type !== 'storyboard' && <Handle type="source" position={Position.Right} className="!size-2.5 !border-2 !border-paper-2 !bg-ink-3" />}

      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-seal/10 text-seal">
          <Icon className="size-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-[14.5px] font-semibold">{n.type === 'source' ? n.title : n.title || NODE_LABEL[n.type].title}</div>
          <div className="text-[10.5px] tracking-wide text-ink-3">{NODE_LABEL[n.type].title}</div>
        </div>
        <Status n={n} />
      </div>

      <div className="mt-3 min-h-10">
        <Summary n={n} preset={ctx.preset} />
        {n.status === 'failed' && n.error && <p className="mt-2 line-clamp-3 text-[11.5px] leading-snug text-seal">{n.error}</p>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {runnable && ctx.canWrite && (
          running ? (
            <button onClick={() => ctx.onCancel(n.id)} className="nodrag flex h-7 items-center gap-1 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 hover:text-ink">
              <Square className="size-3 fill-current" />
              停止
            </button>
          ) : (
            <button onClick={() => ctx.onRun(n.id)} className={cx('nodrag flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12px] transition', n.stale || n.status === 'failed' ? 'bg-seal text-white hover:bg-seal-2' : 'border border-line text-ink-2 hover:border-line-2 hover:text-ink')}>
              {rerun ? <RefreshCw className="size-3" /> : <Play className="size-3 fill-current" />}
              {n.status === 'failed' ? '重试' : n.stale ? '重算' : rerun ? '重跑' : '运行'}
            </button>
          )
        )}
        {n.status === 'done' && n.runMs > 0 && <span className="text-[10.5px] text-ink-3">{(n.runMs / 1000).toFixed(0)}s</span>}
        {n.approved && n.status === 'done' && <Seal chars="审" size={22} className="ml-auto" seed={n.type.length} />}
        {n.type === 'storyboard' && n.status === 'done' && !n.approved && <Film className="ml-auto size-3.5 text-ink-3/60" aria-hidden="true" />}
      </div>
    </div>
  );
}

export const nodeTypes = { drama: DramaNode };
