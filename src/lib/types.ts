/**
 * 墨织的领域模型。
 *
 * 核心原则「作者主权」：AI 的任何产出都先以「提案」或「版本」的形式出现，
 * 只有作者确认后才进入「正典」（Canon）。每条设定都带有来源（provenance），
 * 这样后续写作时系统能区分：作者亲手写的、AI 建议后被采纳的、从定稿正文提炼的。
 */

export type Provenance = 'author' | 'ai' | 'canon';

export interface StyleGuide {
  voice: string; // 叙述声音，如「冷峻克制的第三人称」
  pov: string; // 视角
  tense: string; // 时态/语感
  tone: string; // 基调
  rules: string[]; // 写作守则（禁忌、偏好）
  sample: string; // 参考文风片段
}

export interface Project {
  id: string;
  title: string;
  logline: string; // 一句话故事
  premise: string; // 故事梗概
  seed: string; // 最初的一句灵感
  genre: string;
  tags: string[];
  targetChapters: number;
  targetWords: number; // 每章目标字数
  style: StyleGuide;
  storySoFar: string; // 前情提要（定稿后整理的前文摘要）
  cover: CoverSpec;
  createdAt: number;
  updatedAt: number;
}

/** 生成式封面参数：每本书的封面由其线索颜色“织”出，独一无二。 */
export interface CoverSpec {
  hue: number;
  pattern: 'weave' | 'wave' | 'knot' | 'rain';
  seed: number;
}

export interface CharacterState {
  location: string;
  condition: string; // 身体/情绪状态
  knowledge: string; // 目前知道的秘密
  sourceChapter?: number; // 该状态来自哪一章定稿
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  role: string; // 主角 / 反派 / 配角 …
  summary: string;
  appearance: string;
  personality: string;
  desire: string; // 想要（外在目标）
  need: string; // 需要（内在成长）
  wound: string; // 创伤 / 恐惧
  voice: string; // 说话方式
  arc: string;
  state: CharacterState;
  color: string;
  provenance: Provenance;
  order: number;
  createdAt: number;
}

export const WORLD_CATEGORIES = ['地点', '势力', '规则', '物品', '历史', '其他'] as const;
export type WorldCategory = (typeof WORLD_CATEGORIES)[number];

export interface WorldEntry {
  id: string;
  projectId: string;
  category: WorldCategory;
  name: string;
  content: string;
  keywords: string[];
  provenance: Provenance;
  sourceChapter?: number;
  createdAt: number;
}

export type ThreadKind = 'main' | 'sub' | 'mystery' | 'romance' | 'arc';

export interface Thread {
  id: string;
  projectId: string;
  name: string;
  kind: ThreadKind;
  color: string;
  description: string;
  status: 'open' | 'resolved';
  progress: string; // 最近一次推进的描述
  order: number;
}

export interface Blueprint {
  goal: string; // 本章要完成什么
  beats: string[]; // 情节点
  pov: string;
  location: string;
  characterIds: string[];
  threadIds: string[];
  hook: string; // 章末钩子
  notes: string;
}

export type ChapterStatus = 'planned' | 'drafting' | 'review' | 'revising' | 'final';

export interface Chapter {
  id: string;
  projectId: string;
  index: number; // 从 1 开始
  title: string;
  act: string;
  blueprint: Blueprint;
  status: ChapterStatus;
  workingVersionId?: string;
  canonVersionId?: string;
  summary: string; // 定稿后的章节摘要
  words: number;
  updatedAt: number;
}

export type VersionKind = 'draft' | 'revision' | 'manual';

export interface Version {
  id: string;
  projectId: string;
  chapterId: string;
  kind: VersionKind;
  label: string;
  content: string;
  words: number;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
}

export type BeatStatus = 'done' | 'missing' | 'uncertain';

export interface CritiqueIssue {
  id: string;
  severity: 'high' | 'medium' | 'low';
  type: string; // 节奏 / 人物 / 连贯性 / 文笔 …
  quote: string; // 引用原文
  problem: string;
  suggestion: string;
}

export interface Critique {
  id: string;
  projectId: string;
  chapterId: string;
  versionId: string;
  createdAt: number;
  scores: Record<CritiqueDimension, number>; // 1–10
  verdict: string;
  beats: { beat: string; status: BeatStatus; evidence: string }[];
  issues: CritiqueIssue[];
  strengths: string[];
}

export const CRITIQUE_DIMENSIONS = ['节奏', '人物', '张力', '文笔', '连贯'] as const;
export type CritiqueDimension = (typeof CRITIQUE_DIMENSIONS)[number];

export type ProposalKind = 'summary' | 'character-state' | 'new-character' | 'world-fact' | 'thread-progress' | 'story-so-far';

export interface Proposal {
  id: string;
  projectId: string;
  chapterId?: string;
  chapterIndex?: number;
  kind: ProposalKind;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}

export interface DailyWords {
  id: string; // `${projectId}:${yyyy-mm-dd}`
  projectId: string;
  date: string;
  words: number;
}

export interface InterviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const STATUS_META: Record<ChapterStatus, { label: string; step: number }> = {
  planned: { label: '细纲', step: 0 },
  drafting: { label: '草稿', step: 1 },
  review: { label: '审稿', step: 2 },
  revising: { label: '修订', step: 3 },
  final: { label: '定稿', step: 4 },
};

export const THREAD_KIND_LABEL: Record<ThreadKind, string> = {
  main: '主线',
  sub: '支线',
  mystery: '悬念线',
  romance: '感情线',
  arc: '成长线',
};
