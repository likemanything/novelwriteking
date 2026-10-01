/** AI 任务的结构化输出约定（提示词里要求模型严格按此 JSON 返回）。 */

export interface GenesisCharacter {
  name: string;
  role: string;
  summary: string;
  appearance: string;
  personality: string;
  desire: string;
  need: string;
  wound: string;
  voice: string;
  arc: string;
}

export interface GenesisResult {
  titles: string[];
  logline: string;
  premise: string;
  genre: string;
  tags: string[];
  style: { voice: string; pov: string; tense: string; tone: string; rules: string[] };
  characters: GenesisCharacter[];
  world: { category: string; name: string; content: string; keywords: string[] }[];
  threads: { name: string; kind: string; description: string }[];
}

export interface OutlineChapter {
  title: string;
  act: string;
  goal: string;
  beats: string[];
  pov: string;
  location: string;
  characters: string[]; // 角色名
  threads: string[]; // 故事线名
  hook: string;
}

export interface CritiqueResult {
  scores: Record<string, number>;
  verdict: string;
  beats: { beat: string; status: string; evidence: string }[];
  issues: { severity: string; type: string; quote: string; problem: string; suggestion: string }[];
  strengths: string[];
}

export interface ExtractionResult {
  summary: string;
  storySoFar: string;
  characterUpdates: { name: string; location: string; condition: string; knowledge: string; change: string }[];
  newCharacters: { name: string; role: string; summary: string }[];
  worldFacts: { category: string; name: string; content: string }[];
  threadProgress: { thread: string; progress: string; resolved: boolean }[];
}

export interface StyleAnalysis {
  voice: string;
  pov: string;
  tense: string;
  tone: string;
  rules: string[];
}

export type MuseAction = 'continue' | 'expand' | 'condense' | 'polish' | 'show' | 'dialogue' | 'tone' | 'custom';

export const MUSE_ACTIONS: { id: MuseAction; label: string; hint: string }[] = [
  { id: 'expand', label: '扩写', hint: '补充细节、动作与感官' },
  { id: 'condense', label: '精简', hint: '删去冗余，保留力度' },
  { id: 'polish', label: '润色', hint: '让句子更有质感' },
  { id: 'show', label: '展示', hint: '把“告诉”改为“展示”' },
  { id: 'dialogue', label: '对白', hint: '让对话更像这个人' },
  { id: 'tone', label: '换气氛', hint: '换一种情绪基调' },
  { id: 'custom', label: '指令', hint: '按你的要求改' },
];
