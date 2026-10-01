/**
 * 仓储层：所有写入正典的操作都集中在这里，保证来源（provenance）与状态流转一致。
 */
import { db, logWords, touchProject } from './db';
import type {
  Blueprint,
  Chapter,
  Character,
  CoverSpec,
  Project,
  Proposal,
  StyleGuide,
  Thread,
  ThreadKind,
  Version,
  VersionKind,
  WorldCategory,
  WorldEntry,
} from './types';
import { WORLD_CATEGORIES } from './types';
import { countWords, hashString, silk, uid } from './util';
import type { ExtractionResult, GenesisResult, OutlineChapter } from '@/ai/types';

export function emptyStyle(): StyleGuide {
  return { voice: '', pov: '第三人称有限视角', tense: '过去时', tone: '', rules: [], sample: '' };
}

export function emptyBlueprint(): Blueprint {
  return { goal: '', beats: [], pov: '', location: '', characterIds: [], threadIds: [], hook: '', notes: '' };
}

export function makeCover(seedText: string): CoverSpec {
  const h = hashString(seedText);
  const patterns: CoverSpec['pattern'][] = ['weave', 'wave', 'knot', 'rain'];
  return { hue: h % 360, pattern: patterns[h % patterns.length], seed: h };
}

export function blankCharacter(projectId: string, order: number, partial: Partial<Character> = {}): Character {
  return {
    id: uid('c_'),
    projectId,
    name: '新角色',
    role: '配角',
    summary: '',
    appearance: '',
    personality: '',
    desire: '',
    need: '',
    wound: '',
    voice: '',
    arc: '',
    state: { location: '', condition: '', knowledge: '' },
    color: silk(order + 1),
    provenance: 'author',
    order,
    createdAt: Date.now(),
    ...partial,
  };
}

export function blankWorld(projectId: string, partial: Partial<WorldEntry> = {}): WorldEntry {
  return {
    id: uid('w_'),
    projectId,
    category: '地点',
    name: '新条目',
    content: '',
    keywords: [],
    provenance: 'author',
    createdAt: Date.now(),
    ...partial,
  };
}

const KIND_MAP: Record<string, ThreadKind> = {
  main: 'main', 主线: 'main',
  sub: 'sub', 支线: 'sub',
  mystery: 'mystery', 悬念: 'mystery', 谜团: 'mystery',
  romance: 'romance', 情感: 'romance', 感情: 'romance', 爱情: 'romance',
  arc: 'arc', 成长: 'arc', 人物弧: 'arc',
};

export function blankThread(projectId: string, order: number, partial: Partial<Thread> = {}): Thread {
  return {
    id: uid('t_'),
    projectId,
    name: '新故事线',
    kind: 'sub',
    color: silk(order),
    description: '',
    status: 'open',
    progress: '',
    order,
    ...partial,
  };
}

function normalizeCategory(c: string): WorldCategory {
  return (WORLD_CATEGORIES as readonly string[]).includes(c) ? (c as WorldCategory) : '其他';
}

export async function createProjectFromGenesis(
  g: GenesisResult,
  opts: { title: string; seed: string; targetChapters: number; targetWords: number },
): Promise<string> {
  const now = Date.now();
  const projectId = uid('p_');
  const project: Project = {
    id: projectId,
    title: opts.title || g.titles[0] || '未命名作品',
    logline: g.logline,
    premise: g.premise,
    seed: opts.seed,
    genre: g.genre,
    tags: g.tags ?? [],
    targetChapters: opts.targetChapters,
    targetWords: opts.targetWords,
    style: { ...emptyStyle(), ...g.style, rules: g.style?.rules ?? [], sample: '' },
    storySoFar: '',
    cover: makeCover(opts.title + opts.seed),
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', [db.projects, db.characters, db.world, db.threads], async () => {
    await db.projects.add(project);
    await db.characters.bulkAdd(
      (g.characters ?? []).map((c, i) =>
        blankCharacter(projectId, i, { ...c, provenance: 'ai', state: { location: '', condition: '', knowledge: '' } }),
      ),
    );
    await db.world.bulkAdd(
      (g.world ?? []).map((w) =>
        blankWorld(projectId, { ...w, category: normalizeCategory(w.category), keywords: w.keywords ?? [], provenance: 'ai' }),
      ),
    );
    await db.threads.bulkAdd(
      (g.threads ?? []).map((t, i) =>
        blankThread(projectId, i, { name: t.name, description: t.description, kind: KIND_MAP[t.kind] ?? 'sub' }),
      ),
    );
  });
  return projectId;
}

function matchByName<T extends { id: string; name: string }>(items: T[], names: string[]): string[] {
  const ids = new Set<string>();
  for (const raw of names ?? []) {
    const n = raw.trim();
    const hit = items.find((it) => it.name === n) ?? items.find((it) => n.includes(it.name) || it.name.includes(n));
    if (hit) ids.add(hit.id);
  }
  return [...ids];
}

/** 把 AI 生成的大纲写入章节表（按名称关联角色与线索）。 */
export async function addChaptersFromOutline(projectId: string, outline: OutlineChapter[], startIndex: number) {
  const [characters, threads] = await Promise.all([
    db.characters.where('projectId').equals(projectId).toArray(),
    db.threads.where('projectId').equals(projectId).toArray(),
  ]);
  const existing = await db.chapters.where('projectId').equals(projectId).toArray();
  const byIndex = new Map(existing.map((c) => [c.index, c]));
  const now = Date.now();
  const rows: Chapter[] = outline.map((o, i) => {
    const index = startIndex + i;
    const prev = byIndex.get(index);
    const blueprint: Blueprint = {
      goal: o.goal ?? '',
      beats: o.beats ?? [],
      pov: o.pov ?? '',
      location: o.location ?? '',
      characterIds: matchByName(characters, o.characters),
      threadIds: matchByName(threads, o.threads),
      hook: o.hook ?? '',
      notes: '',
    };
    // 已有正文的章节只更新蓝图，不覆盖进度与版本
    if (prev) return { ...prev, title: o.title || prev.title, act: o.act ?? prev.act, blueprint, updatedAt: now };
    return {
      id: uid('ch_'),
      projectId,
      index,
      title: o.title || `第${index}章`,
      act: o.act ?? '',
      blueprint,
      status: 'planned',
      summary: '',
      words: 0,
      updatedAt: now,
    };
  });
  await db.chapters.bulkPut(rows);
  await touchProject(projectId);
}

export async function createBlankChapter(projectId: string): Promise<Chapter> {
  const count = await db.chapters.where('projectId').equals(projectId).count();
  const chapter: Chapter = {
    id: uid('ch_'),
    projectId,
    index: count + 1,
    title: `新的一章`,
    act: '',
    blueprint: emptyBlueprint(),
    status: 'planned',
    summary: '',
    words: 0,
    updatedAt: Date.now(),
  };
  await db.chapters.add(chapter);
  await touchProject(projectId);
  return chapter;
}

export async function deleteChapter(chapter: Chapter) {
  await db.transaction('rw', [db.chapters, db.versions, db.critiques, db.proposals], async () => {
    await db.versions.where('chapterId').equals(chapter.id).delete();
    await db.critiques.where('chapterId').equals(chapter.id).delete();
    // 这一章的待定提案随章节一起作废（已处理的记录保留作历史）
    await db.proposals.where('projectId').equals(chapter.projectId).filter((p) => p.chapterId === chapter.id && p.status === 'pending').delete();
    await db.chapters.delete(chapter.id);
    const rest = await db.chapters.where('projectId').equals(chapter.projectId).sortBy('index');
    await Promise.all(rest.map((c, i) => (c.index !== i + 1 ? db.chapters.update(c.id, { index: i + 1 }) : null)));
  });
}

export async function moveChapter(chapter: Chapter, direction: -1 | 1) {
  const siblings = await db.chapters.where('projectId').equals(chapter.projectId).sortBy('index');
  const i = siblings.findIndex((c) => c.id === chapter.id);
  const j = i + direction;
  if (j < 0 || j >= siblings.length) return;
  await db.transaction('rw', db.chapters, async () => {
    await db.chapters.update(siblings[i].id, { index: siblings[j].index });
    await db.chapters.update(siblings[j].id, { index: siblings[i].index });
  });
}

export async function createVersion(chapter: Chapter, kind: VersionKind, content: string, label: string): Promise<Version> {
  const now = Date.now();
  const version: Version = {
    id: uid('v_'),
    projectId: chapter.projectId,
    chapterId: chapter.id,
    kind,
    label,
    content,
    words: countWords(content),
    parentId: chapter.workingVersionId,
    createdAt: now,
    updatedAt: now,
  };
  const status = kind === 'revision' ? 'revising' : chapter.status === 'planned' ? 'drafting' : chapter.status === 'final' ? 'revising' : chapter.status;
  await db.transaction('rw', [db.versions, db.chapters, db.daily, db.projects], async () => {
    await db.versions.add(version);
    await db.chapters.update(chapter.id, { workingVersionId: version.id, words: version.words, status, updatedAt: now });
    await logWords(chapter.projectId, Math.max(0, version.words - chapter.words));
    await touchProject(chapter.projectId);
  });
  return version;
}

/**
 * 手动编辑保存：更新工作版本内容，并把新增字数计入当日写作记录。
 * 对 AI 版本或定稿版本的第一次手改会分叉出新的「手改稿」，原版保持不变，方便对比。
 * 返回新建版本的 id（若有）。
 */
export async function saveWorkingContent(chapter: Chapter, content: string): Promise<string | null> {
  const words = countWords(content);
  const now = Date.now();
  if (!chapter.workingVersionId) {
    return (await createVersion(chapter, 'manual', content, '手写稿')).id;
  }
  const prev = await db.versions.get(chapter.workingVersionId);
  if (!prev) return (await createVersion(chapter, 'manual', content, '手写稿')).id;
  if (prev.content === content) return null;
  if (prev.kind !== 'manual' || prev.id === chapter.canonVersionId) {
    return (await createVersion(chapter, 'manual', content, prev.id === chapter.canonVersionId ? '定稿后修改' : '手改稿')).id;
  }
  await db.transaction('rw', [db.versions, db.chapters, db.daily, db.projects], async () => {
    await db.versions.update(prev.id, { content, words, updatedAt: now });
    await db.chapters.update(chapter.id, {
      words,
      updatedAt: now,
      status: chapter.status === 'planned' ? 'drafting' : chapter.status,
    });
    await logWords(chapter.projectId, words - prev.words);
    await touchProject(chapter.projectId);
  });
  return null;
}

export async function finalizeChapter(chapter: Chapter) {
  if (!chapter.workingVersionId) return;
  await db.chapters.update(chapter.id, { status: 'final', canonVersionId: chapter.workingVersionId, updatedAt: Date.now() });
  await touchProject(chapter.projectId);
}

export async function unfinalizeChapter(chapter: Chapter) {
  await db.chapters.update(chapter.id, { status: 'revising', updatedAt: Date.now() });
}

/** 把定稿提炼结果转为待审提案。AI 不直接修改正典。 */
export async function proposeFromExtraction(projectId: string, chapter: Chapter, r: ExtractionResult) {
  const [characters, threads] = await Promise.all([
    db.characters.where('projectId').equals(projectId).toArray(),
    db.threads.where('projectId').equals(projectId).toArray(),
  ]);
  const base = { projectId, chapterId: chapter.id, chapterIndex: chapter.index, status: 'pending' as const, createdAt: Date.now() };
  const proposals: Proposal[] = [];
  if (r.summary) {
    proposals.push({ ...base, id: uid('pr_'), kind: 'summary', title: `第${chapter.index}章摘要`, detail: r.summary, payload: { summary: r.summary } });
  }
  if (r.storySoFar) {
    proposals.push({ ...base, id: uid('pr_'), kind: 'story-so-far', title: '更新前情提要', detail: r.storySoFar, payload: { text: r.storySoFar } });
  }
  for (const u of r.characterUpdates ?? []) {
    const c = characters.find((x) => x.name === u.name) ?? characters.find((x) => u.name.includes(x.name));
    if (!c) continue;
    proposals.push({
      ...base,
      id: uid('pr_'),
      kind: 'character-state',
      title: `${c.name}的状态变化`,
      detail: u.change,
      payload: { characterId: c.id, before: c.state, after: { location: u.location, condition: u.condition, knowledge: u.knowledge, sourceChapter: chapter.index } },
    });
  }
  for (const n of r.newCharacters ?? []) {
    if (characters.some((x) => x.name === n.name)) continue;
    proposals.push({ ...base, id: uid('pr_'), kind: 'new-character', title: `新角色登场：${n.name}`, detail: n.summary, payload: { ...n } });
  }
  for (const w of r.worldFacts ?? []) {
    proposals.push({ ...base, id: uid('pr_'), kind: 'world-fact', title: `新设定：${w.name}`, detail: w.content, payload: { ...w } });
  }
  for (const t of r.threadProgress ?? []) {
    const th = threads.find((x) => x.name === t.thread) ?? threads.find((x) => t.thread.includes(x.name) || x.name.includes(t.thread));
    if (!th) continue;
    proposals.push({
      ...base,
      id: uid('pr_'),
      kind: 'thread-progress',
      title: `故事线推进：${th.name}${t.resolved ? '（完结）' : ''}`,
      detail: t.progress,
      payload: { threadId: th.id, progress: t.progress, resolved: !!t.resolved },
    });
  }
  await db.proposals.bulkAdd(proposals);
  return proposals.length;
}

export async function acceptProposal(p: Proposal, override?: Record<string, unknown>) {
  const payload = { ...p.payload, ...override } as Record<string, any>;
  await db.transaction('rw', [db.proposals, db.chapters, db.projects, db.characters, db.world, db.threads], async () => {
    switch (p.kind) {
      case 'summary':
        if (p.chapterId) await db.chapters.update(p.chapterId, { summary: String(payload.summary ?? '') });
        break;
      case 'story-so-far':
        await db.projects.update(p.projectId, { storySoFar: String(payload.text ?? '') });
        break;
      case 'character-state':
        await db.characters.update(String(payload.characterId), { state: payload.after });
        break;
      case 'new-character': {
        const order = await db.characters.where('projectId').equals(p.projectId).count();
        await db.characters.add(
          blankCharacter(p.projectId, order, {
            name: String(payload.name ?? '无名'),
            role: String(payload.role ?? '配角'),
            summary: String(payload.summary ?? ''),
            provenance: 'canon',
            state: { location: '', condition: '', knowledge: '', sourceChapter: p.chapterIndex },
          }),
        );
        break;
      }
      case 'world-fact':
        await db.world.add(
          blankWorld(p.projectId, {
            category: normalizeCategory(String(payload.category ?? '其他')),
            name: String(payload.name ?? ''),
            content: String(payload.content ?? ''),
            keywords: [String(payload.name ?? '')].filter(Boolean),
            provenance: 'canon',
            sourceChapter: p.chapterIndex,
          }),
        );
        break;
      case 'thread-progress':
        await db.threads.update(String(payload.threadId), {
          progress: String(payload.progress ?? ''),
          ...(payload.resolved ? { status: 'resolved' as const } : {}),
        });
        break;
    }
    await db.proposals.update(p.id, { status: 'accepted' });
    await db.projects.update(p.projectId, { updatedAt: Date.now() });
  });
}

export async function rejectProposal(p: Proposal) {
  await db.proposals.update(p.id, { status: 'rejected' });
}
