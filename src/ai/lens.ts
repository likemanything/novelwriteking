/**
 * 上下文透镜（Context Lens）
 *
 * 长篇写作最大的问题不是“模型写不好一段话”，而是“模型不知道此刻该记住什么”。
 * 透镜把本章需要的资料拆成可解释的区块：每块都有来源、入选理由与 token 成本，
 * 按优先级装入预算。作者能看见、能关掉、能钉住，写作不再是黑箱。
 */
import { db } from '@/lib/db';
import type { Chapter, Character, Project, Thread } from '@/lib/types';
import { THREAD_KIND_LABEL } from '@/lib/types';
import { estimateTokens } from '@/lib/util';

export type LensKind = 'blueprint' | 'style' | 'tail' | 'character' | 'story' | 'recent' | 'thread' | 'world' | 'premise' | 'archive' | 'facts';

export interface LensBlock {
  id: string;
  kind: LensKind;
  label: string;
  reason: string;
  content: string;
  tokens: number;
  priority: number;
  required?: boolean;
}

export const LENS_KIND_META: Record<LensKind, { label: string; color: string }> = {
  blueprint: { label: '本章细纲', color: '#c23a2b' },
  style: { label: '文风', color: '#b8872b' },
  tail: { label: '上章结尾', color: '#a3345a' },
  character: { label: '人物', color: '#35607f' },
  story: { label: '前情提要', color: '#6a5a9a' },
  recent: { label: '最近章节', color: '#8a6aaa' },
  thread: { label: '故事线', color: '#3f8a6b' },
  world: { label: '世界观', color: '#4b9bb5' },
  premise: { label: '故事梗概', color: '#a2643a' },
  archive: { label: '更早章节', color: '#9a9284' },
  facts: { label: '已写明的事实', color: '#2f7f7a' },
};

function block(b: Omit<LensBlock, 'tokens'>): LensBlock {
  return { ...b, tokens: estimateTokens(b.content) };
}

export function characterCard(c: Character, brief = false): string {
  const lines = [`【${c.name}】${c.role}`];
  if (c.summary) lines.push(c.summary);
  if (!brief) {
    if (c.personality) lines.push(`性格：${c.personality}`);
    if (c.voice) lines.push(`说话方式：${c.voice}`);
    if (c.desire) lines.push(`想要：${c.desire}`);
    if (c.need) lines.push(`需要：${c.need}`);
    if (c.wound) lines.push(`创伤：${c.wound}`);
  }
  const s = c.state;
  const state = [s.location && `位置：${s.location}`, s.condition && `状态：${s.condition}`, s.knowledge && `已知：${s.knowledge}`].filter(Boolean);
  if (state.length) lines.push(`当前（${s.sourceChapter ? `截至第${s.sourceChapter}章定稿` : '作者设定'}）：${state.join('；')}`);
  return lines.join('\n');
}

export function styleText(p: Project): string {
  const s = p.style;
  const lines = [
    s.voice && `叙述声音：${s.voice}`,
    s.pov && `视角：${s.pov}`,
    s.tense && `语感：${s.tense}`,
    s.tone && `基调：${s.tone}`,
    s.rules.length ? `写作守则：\n${s.rules.map((r) => `- ${r}`).join('\n')}` : '',
    s.sample && `参考文风片段：\n${s.sample.slice(0, 500)}`,
  ].filter(Boolean);
  return lines.join('\n');
}

export function blueprintText(ch: Chapter, characters: Character[], threads: Thread[]): string {
  const b = ch.blueprint;
  const names = b.characterIds.map((id) => characters.find((c) => c.id === id)?.name).filter(Boolean);
  const ths = b.threadIds.map((id) => threads.find((t) => t.id === id)?.name).filter(Boolean);
  return [
    `第${ch.index}章《${ch.title}》${ch.act ? `（${ch.act}）` : ''}`,
    b.goal && `本章目标：${b.goal}`,
    b.beats.length ? `情节点（必须依次完成）：\n${b.beats.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : '',
    b.pov && `视角人物：${b.pov}`,
    b.location && `场景：${b.location}`,
    names.length ? `出场角色：${names.join('、')}` : '',
    ths.length ? `推进故事线：${ths.join('、')}` : '',
    b.hook && `章末悬念：${b.hook}`,
    b.notes && `作者备注：${b.notes}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function chapterText(ch: Chapter): Promise<{ text: string; final: boolean }> {
  const id = ch.canonVersionId ?? ch.workingVersionId;
  if (!id) return { text: '', final: false };
  const v = await db.versions.get(id);
  return { text: v?.content ?? '', final: !!ch.canonVersionId };
}

export async function buildLens(projectId: string, chapterId: string): Promise<LensBlock[]> {
  const [project, chapter, chapters, characters, threads, world] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.get(chapterId),
    db.chapters.where('projectId').equals(projectId).sortBy('index'),
    db.characters.where('projectId').equals(projectId).sortBy('order'),
    db.threads.where('projectId').equals(projectId).sortBy('order'),
    db.world.where('projectId').equals(projectId).toArray(),
  ]);
  if (!project || !chapter) return [];
  const blocks: LensBlock[] = [];
  const bp = chapter.blueprint;

  blocks.push(
    block({ id: 'blueprint', kind: 'blueprint', label: '本章细纲', reason: '本章写作任务，始终使用', content: blueprintText(chapter, characters, threads), priority: 100, required: true }),
  );

  const style = styleText(project);
  if (style) blocks.push(block({ id: 'style', kind: 'style', label: '文风指南', reason: '保证全书声音一致', content: style, priority: 90 }));

  const prev = chapters.filter((c) => c.index < chapter.index);
  const last = prev[prev.length - 1];
  let tail = '';
  if (last) {
    const { text, final } = await chapterText(last);
    if (text) {
      tail = text.slice(-700);
      blocks.push(
        block({
          id: 'tail',
          kind: 'tail',
          label: `第${last.index}章结尾`,
          reason: final ? '定稿原文，用于无缝衔接' : '尚未定稿的草稿原文，衔接时需谨慎',
          content: `${final ? '' : '（注意：以下为未定稿草稿）\n'}……${tail}`,
          priority: 85,
        }),
      );
    }
  }

  // 蓝图指定的角色 + 蓝图文本中提到名字的角色
  const bpText = [bp.goal, ...bp.beats, bp.location, bp.hook, bp.notes, bp.pov].join(' ');
  for (const c of characters) {
    const listed = bp.characterIds.includes(c.id);
    const mentioned = !listed && (bpText.includes(c.name) || tail.includes(c.name));
    if (!listed && !mentioned) continue;
    blocks.push(
      block({
        id: `char:${c.id}`,
        kind: 'character',
        label: c.name,
        reason: listed ? '细纲指定出场' : `细纲或上章提到「${c.name}」`,
        content: characterCard(c, !listed),
        priority: listed ? 80 : 52,
      }),
    );
  }

  if (project.storySoFar) {
    blocks.push(block({ id: 'story', kind: 'story', label: '前情提要', reason: '从定稿整理、经作者确认的前文摘要', content: project.storySoFar, priority: 70 }));
  }

  const recent = prev.slice(-3);
  if (recent.length) {
    blocks.push(
      block({
        id: 'recent',
        kind: 'recent',
        label: `最近 ${recent.length} 章`,
        reason: '保持近期情节与情绪的连续',
        content: recent
          .map((c) => `第${c.index}章《${c.title}》${c.summary ? `（定稿摘要）${c.summary}` : c.digest ? `（草稿摘要）${c.digest.summary}` : `（计划，未必已写成）${c.blueprint.goal}`}`)
          .join('\n'),
        priority: 65,
      }),
    );
  }

  for (const t of threads) {
    if (!bp.threadIds.includes(t.id)) continue;
    blocks.push(
      block({
        id: `thread:${t.id}`,
        kind: 'thread',
        label: t.name,
        reason: '本章推进的故事线',
        content: `【${THREAD_KIND_LABEL[t.kind]}·${t.name}】${t.description}${t.progress ? `\n最新进展：${t.progress}` : ''}${t.status === 'resolved' ? '\n（已完结）' : ''}`,
        priority: 60,
      }),
    );
  }

  const worldHits = world.filter((w) => {
    const keys = [w.name, ...w.keywords].filter((k) => k && k.length >= 2);
    return keys.some((k) => bpText.includes(k) || tail.includes(k));
  });
  for (const w of worldHits) {
    const key = [w.name, ...w.keywords].find((k) => bpText.includes(k) || tail.includes(k));
    blocks.push(
      block({
        id: `world:${w.id}`,
        kind: 'world',
        label: w.name,
        reason: `关键词「${key}」命中`,
        content: `【${w.category}·${w.name}】${w.content}`,
        priority: 55,
      }),
    );
  }

  if (project.premise) {
    blocks.push(block({ id: 'premise', kind: 'premise', label: '故事梗概', reason: '全书方向，防止跑题', content: `${project.logline}\n${project.premise}`, priority: 45 }));
  }

  // 连续性台账：最近几章正文里明确写出的事实（含尚未定稿的草稿），写新章时对照它，避免前后矛盾
  const withFacts = prev.filter((c) => c.digest?.facts.length).slice(-6);
  if (withFacts.length) {
    blocks.push(
      block({
        id: 'facts',
        kind: 'facts',
        label: `已写明的事实（第${withFacts[0].index}–${withFacts[withFacts.length - 1].index}章）`,
        reason: '前文正文里明确写出的细节；与它们矛盾就是连续性错误',
        content: withFacts.map((c) => `第${c.index}章：\n${c.digest!.facts.map((f) => `- ${f}`).join('\n')}`).join('\n'),
        priority: 68,
      }),
    );
  }

  const archive = prev.slice(0, -3).filter((c) => c.summary);
  if (archive.length) {
    blocks.push(
      block({
        id: 'archive',
        kind: 'archive',
        label: `更早的 ${archive.length} 章`,
        reason: '压缩为一行，只保留骨架',
        content: archive.map((c) => `第${c.index}章：${c.summary.slice(0, 60)}`).join('\n'),
        priority: 30,
      }),
    );
  }

  return blocks;
}

export interface LensPlan {
  included: LensBlock[];
  dropped: LensBlock[];
  used: number;
}

/** 按优先级装入预算；作者关闭的区块直接排除，必需区块总会装入。 */
export function planLens(blocks: LensBlock[], budget: number, excluded: Set<string>): LensPlan {
  const sorted = [...blocks].sort((a, b) => b.priority - a.priority);
  const included: LensBlock[] = [];
  const dropped: LensBlock[] = [];
  let used = 0;
  for (const b of sorted) {
    if (excluded.has(b.id) && !b.required) {
      dropped.push(b);
      continue;
    }
    if (b.required || used + b.tokens <= budget) {
      included.push(b);
      used += b.tokens;
    } else dropped.push(b);
  }
  return { included, dropped, used };
}

const SECTION_ORDER: LensKind[] = ['premise', 'style', 'story', 'archive', 'recent', 'facts', 'character', 'world', 'thread', 'tail', 'blueprint'];

/** 渲染为提示词：从宏观到微观，蓝图放在最后，离生成位置最近。 */
export function renderLens(included: LensBlock[]): string {
  const groups = SECTION_ORDER.map((kind) => {
    const items = included.filter((b) => b.kind === kind);
    if (!items.length) return '';
    return `## ${LENS_KIND_META[kind].label}\n${items.map((b) => b.content).join('\n\n')}`;
  });
  return groups.filter(Boolean).join('\n\n');
}
