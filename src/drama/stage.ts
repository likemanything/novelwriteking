/** 画布的阶段元数据（配色、图标、列位置）与整体统计。 */
import { BookOpen, Clapperboard, ListOrdered, Mountain, ScrollText, UserRound, Wand2, type LucideIcon } from 'lucide-react';
import type { DramaNodeDTO, DramaNodeType, DramaProjectDTO, OutlineOutput, ScriptOutput, StoryboardOutput } from '@/shared/drama';

export interface StageMeta {
  icon: LucideIcon;
  /** 阶段主色：CSS 变量，随日夜主题切换 */
  hue: string;
  label: string;
  step: string;
}

export const STAGE: Record<DramaNodeType, StageMeta> = {
  source: { icon: BookOpen, hue: 'var(--ink-3)', label: '小说', step: '壹' },
  breakdown: { icon: Wand2, hue: 'var(--indigo)', label: '拆解', step: '贰' },
  outline: { icon: ListOrdered, hue: 'var(--gold)', label: '大纲', step: '叁' },
  script: { icon: ScrollText, hue: 'var(--seal)', label: '剧本', step: '肆' },
  storyboard: { icon: Clapperboard, hue: 'var(--jade)', label: '分镜', step: '伍' },
  portrait: { icon: UserRound, hue: 'var(--gold-bright)', label: '定妆', step: '角' },
  location: { icon: Mountain, hue: 'var(--indigo)', label: '场景', step: '景' },
};

/** 泳道（列）的位置，与服务端 COL 保持一致 */
export const COLUMNS: { type: DramaNodeType; x: number; title: string; hint: string }[] = [
  { type: 'source', x: 0, title: '小说', hint: '范围与剧型' },
  { type: 'breakdown', x: 400, title: '故事拆解', hint: '主线 · 人物 · 场景' },
  { type: 'outline', x: 800, title: '分集大纲', hint: '钩子 · 反转 · 悬念' },
  { type: 'script', x: 1240, title: '单集剧本', hint: '场景化对白' },
  { type: 'storyboard', x: 1680, title: '分镜脚本', hint: '镜头 · 景别 · 首帧' },
];

export const CARD_W = 300;

export interface DramaStats {
  episodes: number;
  /** 已写出分镜的集数 */
  episodesDone: number;
  shots: number;
  seconds: number;
  scenes: number;
  portraits: number;
  /** 每一集的进度：用于底部分集进度带 */
  rows: EpisodeRow[];
}

export interface EpisodeRow {
  n: number;
  title: string;
  state: 'idle' | 'running' | 'half' | 'done' | 'stale' | 'failed';
  y: number;
  scriptId?: string;
  boardId?: string;
}

export function projectStats(p: DramaProjectDTO): DramaStats {
  const outline = p.nodes.find((n) => n.type === 'outline')?.output as OutlineOutput | null | undefined;
  const scripts = new Map<number, DramaNodeDTO>();
  const boards = new Map<number, DramaNodeDTO>();
  for (const n of p.nodes) {
    if (n.type === 'script') scripts.set(Number(n.params.episode), n);
    if (n.type === 'storyboard') boards.set(Number(n.params.episode), n);
  }
  const eps = outline?.episodes ?? [];
  let shots = 0;
  let seconds = 0;
  let scenes = 0;
  let episodesDone = 0;
  const rows: EpisodeRow[] = eps.map((e) => {
    const s = scripts.get(e.n);
    const b = boards.get(e.n);
    const so = s?.output as ScriptOutput | null | undefined;
    const bo = b?.output as StoryboardOutput | null | undefined;
    if (so) scenes += so.scenes.length;
    if (bo) {
      shots += bo.shots.length;
      seconds += bo.totalSeconds;
    }
    const states = [s, b].filter(Boolean) as DramaNodeDTO[];
    let state: EpisodeRow['state'] = 'idle';
    if (states.some((x) => x.status === 'failed')) state = 'failed';
    else if (states.some((x) => x.status === 'running')) state = 'running';
    else if (states.some((x) => x.status === 'done' && x.stale)) state = 'stale';
    else if (s?.status === 'done' && b?.status === 'done') {
      state = 'done';
      episodesDone++;
    } else if (s?.status === 'done') state = 'half';
    return { n: e.n, title: e.title, state, y: (e.n - 1) * 320, scriptId: s?.id, boardId: b?.id };
  });
  return { episodes: eps.length, episodesDone, shots, seconds, scenes, portraits: p.nodes.filter((n) => n.type === 'portrait' && n.status === 'done').length, rows };
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}
