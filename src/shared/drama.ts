/** 小说 → 短剧画布：前后端共用的数据结构与默认值。 */

export type DramaNodeType = 'source' | 'breakdown' | 'outline' | 'script' | 'storyboard';
export type DramaNodeStatus = 'idle' | 'running' | 'done' | 'failed';

export const GENRES = [
  { value: 'twist', label: '爽文反转', hint: '开头三秒抓人，中段打脸或反转，结尾强悬念' },
  { value: 'suspense', label: '悬疑烧脑', hint: '层层设谜，信息差与反转，每集抛一个新疑点' },
  { value: 'sweet', label: '甜宠情感', hint: '高频心动与误会，情绪价值优先，节奏轻快' },
  { value: 'ancient', label: '古风权谋', hint: '身份与布局，台词凝练，冲突来自立场而非吵架' },
  { value: 'custom', label: '自定义', hint: '在「风格补充」里描述你想要的节奏' },
] as const;
export type Genre = (typeof GENRES)[number]['value'];

export interface DramaPreset {
  /** 改编的章节范围（含），从 1 开始 */
  chapterFrom: number;
  chapterTo: number;
  episodes: number;
  episodeSeconds: number;
  ratio: '9:16' | '16:9';
  genre: Genre;
  /** 画风与补充要求，会写进每个分镜的画面描述 */
  style: string;
}

export const DEFAULT_PRESET: DramaPreset = {
  chapterFrom: 1,
  chapterTo: 1,
  episodes: 20,
  episodeSeconds: 90,
  ratio: '9:16',
  genre: 'twist',
  style: '电影感写实，光影自然',
};

// ───────── 各节点的输出 ─────────

export interface BreakdownOutput {
  logline: string;
  mainPlot: string;
  subplots: { name: string; summary: string }[];
  keyEvents: { title: string; summary: string; chapters: number[]; visual: number }[];
  characters: { name: string; role: string; look: string; voice: string; relations: string }[];
  locations: { name: string; look: string }[];
  tone: string;
  notes: string;
}

export interface OutlineEpisode {
  n: number;
  title: string;
  /** 开场钩子（前 3–5 秒） */
  hook: string;
  conflict: string;
  twist: string;
  /** 结尾悬念：让观众点下一集 */
  cliffhanger: string;
  summary: string;
  /** 这一集改编自小说的哪几章 */
  sourceChapters: number[];
  characters: string[];
}

export interface OutlineOutput {
  episodes: OutlineEpisode[];
}

export interface ScriptLine {
  type: 'action' | 'dialogue' | 'narration';
  speaker?: string;
  text: string;
  /** 配音情绪提示，后续配音环节使用 */
  emotion?: string;
}

export interface ScriptScene {
  n: number;
  location: string;
  time: string;
  summary: string;
  /** 溯源：这场戏对应小说哪一章、哪句原文 */
  source?: { chapter: number; quote: string };
  lines: ScriptLine[];
}

export interface ScriptOutput {
  episode: number;
  title: string;
  scenes: ScriptScene[];
}

export interface Shot {
  n: number;
  scene: number;
  /** 景别：远景 / 全景 / 中景 / 近景 / 特写 */
  size: string;
  /** 运镜：固定 / 推 / 拉 / 摇 / 移 / 跟 / 手持 */
  move: string;
  seconds: number;
  visual: string;
  dialogue?: { speaker: string; text: string; emotion?: string };
  narration?: string;
  sfx?: string;
  /** 首帧画面（图生视频的起点） */
  firstFrame: string;
  lastFrame?: string;
}

export interface StoryboardOutput {
  episode: number;
  shots: Shot[];
  totalSeconds: number;
}

// ───────── 接口数据 ─────────

export interface DramaNodeDTO {
  id: string;
  type: DramaNodeType;
  title: string;
  x: number;
  y: number;
  params: Record<string, unknown>;
  status: DramaNodeStatus;
  output: unknown;
  error: string | null;
  approved: boolean;
  /** 上游变了，这个节点的结果已过期 */
  stale: boolean;
  runMs: number;
  startedAt: string | null;
  updatedAt: string;
}

export interface DramaEdgeDTO {
  id: string;
  from: string;
  to: string;
}

export interface DramaProjectDTO {
  id: string;
  novelId: string;
  preset: DramaPreset;
  nodes: DramaNodeDTO[];
  edges: DramaEdgeDTO[];
  chapterCount: number;
  createdAt: string;
}

export const NODE_LABEL: Record<DramaNodeType, { title: string; hint: string }> = {
  source: { title: '小说', hint: '选择章节与剧型' },
  breakdown: { title: '故事拆解', hint: '主线、关键事件、人物与场景' },
  outline: { title: '分集大纲', hint: '每集钩子、反转与结尾悬念' },
  script: { title: '单集剧本', hint: '场景化剧本，含对白与旁白' },
  storyboard: { title: '分镜脚本', hint: '镜头、景别、运镜、台词与首帧' },
};
