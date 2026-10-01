/**
 * 高层 AI 任务：把「资料装配 → 提示词 → 模型调用 → 解析 → 写回」串成可复用的动作。
 * 每个任务都挂在织机（runJob）上运行，页面卸载也不会中断。
 */
import { db } from '@/lib/db';
import {
  addChaptersFromOutline,
  createVersion,
  finalizeChapter,
  proposeFromExtraction,
} from '@/lib/repo';
import type { BeatStatus, Chapter, ChapterDigest, Critique, CritiqueIssue, Project, Version } from '@/lib/types';
import { CRITIQUE_DIMENSIONS, THREAD_KIND_LABEL } from '@/lib/types';
import { clamp, cleanProse, extractJson, isAbort, parsePartialArray, uid } from '@/lib/util';
import { patchBatchItem, useBatch } from '@/store/batch';
import { toast } from '@/store/ui';
import { abortJob, runJob, type JobContext } from '@/store/jobs';
import { useSettings, type Stage } from '@/store/settings';
import { profileFor } from '@/cloud/models';
import { holdLock, LockedError } from '@/cloud/locks';
import { ApiError } from '@/cloud/api';
import { AIError, streamChat, type ChatMessage } from './client';
import { BUDGET_MSG } from './providers';
import * as D from './demo';
import { lintProse } from './lint';
import { nameDrift, verifyCritique } from './verify';
import { capsNow } from '@/cloud/session';
import { blueprintText, buildLens, characterCard, planLens, renderLens } from './lens';
import * as P from './prompts';
import type { CritiqueResult, ExtractionResult, GenesisResult, MuseAction, OutlineChapter, StyleAnalysis } from './types';

interface CallExtra {
  maxTokens?: number;
  temperature?: number;
  messages?: ChatMessage[];
  /** 结构化输出：被截断时用两倍额度重试一次 */
  json?: boolean;
  /** 正文：被截断时自动让模型接着写完 */
  continueIfCut?: boolean;
}

/**
 * 调用模型。带「思考」的模型会把一部分输出额度花在思考上，所以额度要给足；
 * 即使如此被截断了：结构化输出会加倍额度重试，正文会自动续写完——而不是留下写到一半的章节或残缺的 JSON。
 */
async function call(stage: Stage, projectId: string | undefined, prompt: { system: string; user: string }, demo: () => string, ctx: JobContext, extra: CallExtra = {}) {
  const base: ChatMessage[] = extra.messages ?? [{ role: 'user', content: prompt.user }];
  let cut = false;
  const run = (messages: ChatMessage[], maxTokens: number | undefined, onToken: JobContext['onToken']) => {
    cut = false;
    return streamChat({
      profile: profileFor(stage),
      stage,
      projectId,
      system: prompt.system,
      messages,
      demo,
      signal: ctx.signal,
      onToken,
      onEnd: (i) => (cut = i.truncated),
      maxTokens,
      temperature: extra.temperature,
    });
  };
  let budget = extra.maxTokens;
  let text: string;
  try {
    text = await run(base, budget, ctx.onToken);
  } catch (error) {
    // 带「思考」的模型有时把整个额度都花在思考上：加倍额度重试一次
    if (!(error instanceof AIError) || !error.message.includes(BUDGET_MSG.slice(0, 12)) || !budget) throw error;
    budget = Math.min(40000, budget * 2);
    text = await run(base, budget, ctx.onToken);
  }
  if (cut && extra.json) {
    text = await run(base, Math.min(40000, (budget ?? 4096) * 2), ctx.onToken);
  } else if (cut && extra.continueIfCut) {
    for (let i = 0; i < 2 && cut; i++) {
      const so_far = text;
      const more = await run(
        [...base, { role: 'assistant', content: so_far }, { role: 'user', content: '你的上一段输出因为长度上限被截断了。请从停下的地方自然接着写完本章（包括章末悬念），不要重复已经写过的内容，不要任何说明。' }],
        budget,
        (chunk, full) => ctx.onToken(chunk, so_far + full),
      );
      text = so_far + more;
    }
  }
  return text;
}

function lintSummaryText(text: string): string {
  const r = lintProse(text);
  return [`比喻 ${r.simileCount} 处（每千字 ${r.similePerK.toFixed(1)}），${r.paraEndSimile.count}/${r.paraEndSimile.total} 个段落以比喻收尾`, r.stock.length ? `套话：${r.stock.slice(0, 5).map((s) => `${s.name}×${s.count}`).join('、')}` : '套话：无明显堆积'].join('；');
}

function parse<T>(raw: string, salvage = false): T {
  try {
    return extractJson<T>(raw, { salvage });
  } catch {
    throw new AIError('模型的输出无法解析为结构化结果。可以重试一次，或换一个更擅长遵循格式的模型。');
  }
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

async function loadProject(projectId: string) {
  const project = await db.projects.get(projectId);
  if (!project) throw new AIError('作品不存在');
  return project;
}

async function loadChapter(chapterId: string) {
  const chapter = await db.chapters.get(chapterId);
  if (!chapter) throw new AIError('章节不存在');
  return chapter;
}

async function workingText(chapter: Chapter): Promise<string> {
  if (!chapter.workingVersionId) return '';
  return (await db.versions.get(chapter.workingVersionId))?.content ?? '';
}

// ─────────────────────────── 连续性台账 ───────────────────────────

/** 简单、稳定的文本指纹（只用来判断正文有没有变） */
function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** 无法写回数据库时（例如作者没有权限改已定稿的章节）的内存缓存 */
const digestCache = new Map<string, ChapterDigest>();

/**
 * 保证某章有一份与当前正文一致的台账（摘要 + 原子事实）。
 * 台账是前后章连续性的基础：写下一章、审稿时都对照它，而不是只靠最后 700 字。
 */
async function ensureDigest(project: Project, chapter: Chapter, names: string[], priorFacts: string, signal?: AbortSignal): Promise<ChapterDigest | null> {
  const text = await workingText(chapter);
  if (text.trim().length < 200) return null;
  const hash = fingerprint(text);
  if (chapter.digest?.hash === hash) return chapter.digest;
  const cached = digestCache.get(`${chapter.id}:${hash}`);
  if (cached) return cached;
  if (profileFor('plan').provider === 'demo') return null;
  try {
    const raw = await streamChat({
      profile: profileFor('plan'),
      stage: 'plan',
      projectId: project.id,
      ...(() => {
        const pr = P.digestPrompt(chapter, text, names, priorFacts);
        return { system: pr.system, messages: [{ role: 'user' as const, content: pr.user }] };
      })(),
      demo: () => '{}',
      signal,
      temperature: 0.2,
      maxTokens: 8000,
    });
    const j = parse<{ summary?: string; facts?: unknown[]; contradictions?: { fact?: unknown; prior?: unknown }[] }>(raw, true);
    const conflicts = arr<{ fact?: unknown; prior?: unknown }>(j.contradictions)
      .map((c) => ({ fact: str(c.fact), prior: str(c.prior) }))
      .filter((c) => c.fact && c.prior)
      .slice(0, 6);
    const digest: ChapterDigest = { hash, summary: str(j.summary), facts: arr<unknown>(j.facts).map((f) => str(f)).filter(Boolean).slice(0, 16), ...(conflicts.length ? { conflicts } : {}), at: Date.now() };
    if (!digest.summary && !digest.facts.length) return null;
    digestCache.set(`${chapter.id}:${hash}`, digest);
    // 已定稿的章节只有编辑能改；没有权限时只缓存在内存里，不去触发被服务端拒绝的写入
    if (chapter.status !== 'final' || capsNow(project.id).finalize) await db.chapters.update(chapter.id, { digest });
    chapter.digest = digest;
    return digest;
  } catch (error) {
    if (isAbort(error)) throw error;
    return null; // 台账是增强项：失败了不影响写作本身
  }
}

/** 为某章之前的最近几章补齐台账（按顺序，最多 6 章）。 */
async function ensureDigestsBefore(projectId: string, index: number, ctx?: { signal?: AbortSignal }) {
  const [project, chapters, characters] = await Promise.all([
    loadProject(projectId),
    db.chapters.where('projectId').equals(projectId).sortBy('index'),
    db.characters.where('projectId').equals(projectId).toArray(),
  ]);
  const names = characters.map((c) => c.name);
  const prior: string[] = [];
  for (const ch of chapters.filter((c) => c.index < index).slice(-6)) {
    const had = ch.digest?.hash;
    const d = await ensureDigest(project, ch, names, prior.join('\n'), ctx?.signal);
    if (d) prior.push(`第${ch.index}章：${d.facts.join('；')}`);
    // 刚刚发现这一章和前文矛盾：提醒作者，并且这些内容没有进入台账
    if (d?.conflicts?.length && d.hash !== had) {
      toast(`第${ch.index}章与前文有 ${d.conflicts.length} 处矛盾`, { tone: 'error', detail: `「${d.conflicts[0].fact}」与「${d.conflicts[0].prior}」冲突。矛盾的内容没有写入连续性台账；建议审稿查看。`, duration: 9000 });
    }
  }
}

async function threadsText(projectId: string) {
  const threads = await db.threads.where('projectId').equals(projectId).sortBy('order');
  return threads.map((t) => `【${THREAD_KIND_LABEL[t.kind]}】${t.name}：${t.description}${t.progress ? `（最新：${t.progress}）` : ''}`).join('\n');
}

// ─────────────────────────── 开书 ───────────────────────────

export interface GenesisInput {
  seed: string;
  genre: string;
  chapters: number;
  words: number;
  tone: string;
  notes: string;
}

export function genesis(input: GenesisInput): Promise<GenesisResult> {
  return runJob({
    key: 'genesis',
    label: '开书 · 搭建故事架构',
    stage: 'plan',
    run: async (ctx) => {
      const raw = await call('plan', undefined, P.genesisPrompt(input), () => D.demoGenesis(input), ctx, { maxTokens: 12000, json: true });
      const g = parse<Partial<GenesisResult>>(raw);
      return {
        titles: arr<string>(g.titles).map((t) => str(t).replace(/[《》]/g, '')).filter(Boolean).slice(0, 3),
        logline: str(g.logline),
        premise: str(g.premise),
        genre: str(g.genre, input.genre),
        tags: arr<string>(g.tags).map((t) => str(t)),
        style: {
          voice: str(g.style?.voice),
          pov: str(g.style?.pov),
          tense: str(g.style?.tense),
          tone: str(g.style?.tone),
          rules: arr<string>(g.style?.rules).map((x) => str(x)),
        },
        characters: arr<any>(g.characters).map((c) => ({
          name: str(c.name, '无名'),
          role: str(c.role, '配角'),
          summary: str(c.summary),
          appearance: str(c.appearance),
          personality: str(c.personality),
          desire: str(c.desire),
          need: str(c.need),
          wound: str(c.wound),
          voice: str(c.voice),
          arc: str(c.arc),
        })),
        world: arr<any>(g.world).map((w) => ({ category: str(w.category, '其他'), name: str(w.name), content: str(w.content), keywords: arr<string>(w.keywords).map((k) => str(k)) })),
        threads: arr<any>(g.threads).map((t) => ({ name: str(t.name), kind: str(t.kind, 'sub'), description: str(t.description) })),
      };
    },
  });
}

/** 从流式文本中判断开书进行到了哪一步（用于生成时的叙事化进度）。 */
export function genesisProgress(raw: string): number {
  const keys = ['"titles"', '"logline"', '"premise"', '"style"', '"characters"', '"world"', '"threads"'];
  let n = 0;
  keys.forEach((k, i) => {
    if (raw.includes(k)) n = i + 1;
  });
  return n;
}

// ─────────────────────────── 大纲 ───────────────────────────

export function generateOutline(o: { projectId: string; from: number; count: number; guidance: string; onPartial?: (chapters: OutlineChapter[]) => void }) {
  return runJob({
    key: `outline:${o.projectId}`,
    label: `大纲 · 第${o.from}–${o.from + o.count - 1}章`,
    stage: 'plan',
    run: async (ctx) => {
      const project = await loadProject(o.projectId);
      const [characters, threads, world, existing] = await Promise.all([
        db.characters.where('projectId').equals(o.projectId).sortBy('order'),
        db.threads.where('projectId').equals(o.projectId).sortBy('order'),
        db.world.where('projectId').equals(o.projectId).toArray(),
        db.chapters.where('projectId').equals(o.projectId).sortBy('index'),
      ]);
      const prompt = P.outlinePrompt({
        project,
        characters,
        threadsText: await threadsText(o.projectId),
        worldText: world.map((w) => `【${w.category}】${w.name}：${w.content}`).join('\n'),
        existing,
        from: o.from,
        count: o.count,
        guidance: o.guidance,
      });
      let seen = 0;
      const raw = await call(
        'plan',
        o.projectId,
        prompt,
        () => D.demoOutline({ project, characters, threads, places: world.filter((w) => w.category === '地点').map((w) => w.name), from: o.from, count: o.count }),
        {
          signal: ctx.signal,
          onToken: (chunk, full) => {
            ctx.onToken(chunk, full);
            const partial = parsePartialArray<OutlineChapter>(full);
            if (partial.length !== seen) {
              seen = partial.length;
              o.onPartial?.(partial);
            }
          },
        },
        { maxTokens: 16000, json: true },
      );
      let chapters = parsePartialArray<OutlineChapter>(raw);
      if (!chapters.length) {
        const parsed = parse<OutlineChapter[] | { chapters: OutlineChapter[] }>(raw, true);
        chapters = Array.isArray(parsed) ? parsed : arr<OutlineChapter>(parsed.chapters);
      }
      chapters = chapters.slice(0, o.count).map((c) => ({
        title: str(c.title),
        act: str(c.act),
        goal: str(c.goal),
        beats: arr<string>(c.beats).map((b) => str(b)),
        pov: str(c.pov),
        location: str(c.location),
        characters: arr<string>(c.characters).map((x) => str(x)),
        threads: arr<string>(c.threads).map((x) => str(x)),
        hook: str(c.hook),
      }));
      if (!chapters.length) throw new AIError('没有得到可用的章节细纲');
      await addChaptersFromOutline(o.projectId, chapters, o.from);
      return chapters;
    },
  });
}

// ─────────────────────────── 透镜装配 ───────────────────────────

export async function assembleLens(projectId: string, chapterId: string, excluded: Set<string>) {
  const blocks = await buildLens(projectId, chapterId);
  const plan = planLens(blocks, useSettings.getState().contextBudget, excluded);
  return { blocks, plan, text: renderLens(plan.included) };
}

// ─────────────────────────── 草稿 & 修订 ───────────────────────────

/** 流式写入的结果无论完成、中断还是出错，只要有正文就保存为版本，绝不丢稿。 */
async function writeInto(chapter: Chapter, kind: 'draft' | 'revision', label: string, produce: (ctx: JobContext, keep: (t: string) => void) => Promise<string>, ctx: JobContext): Promise<Version | null> {
  let latest = '';
  try {
    const text = cleanProse(await produce(ctx, (t) => (latest = t)));
    const fresh = await loadChapter(chapter.id);
    return await createVersion(fresh, kind, text, label);
  } catch (error) {
    const partial = cleanProse(latest);
    if (partial.length > 40) {
      const fresh = await loadChapter(chapter.id);
      await createVersion(fresh, kind, partial, `${label}（${isAbort(error) ? '已中断' : '未完成'}）`);
    }
    if (isAbort(error)) return null;
    throw error;
  }
}

export function draftChapter(projectId: string, chapterId: string, excluded: Set<string>) {
  return runJob({
    key: `write:${chapterId}`,
    label: '生成草稿',
    stage: 'write',
    lock: { projectId, chapterId },
    run: async (ctx) => {
      const [project, chapter] = await Promise.all([loadProject(projectId), loadChapter(chapterId)]);
      // 前面几章（含没定稿的草稿）实际写了什么，先整理成台账，再装配资料
      await ensureDigestsBefore(projectId, chapter.index, ctx);
      const { text: lensText } = await assembleLens(projectId, chapterId, excluded);
      const characters = await db.characters.where('projectId').equals(projectId).sortBy('order');
      const prev = await db.chapters.where('[projectId+index]').equals([projectId, chapter.index - 1]).first();
      const tail = prev ? (await workingText(prev)).slice(-300) : '';
      return writeInto(
        chapter,
        'draft',
        'AI 草稿',
        (c, keep) =>
          call('write', projectId, P.draftPrompt(project, chapter, lensText), () => D.demoDraft({ project, chapter, characters, tail }), {
            signal: c.signal,
            onToken: (chunk, full) => {
              keep(full);
              c.onToken(chunk, full);
            },
          }, { maxTokens: Math.max(8000, Math.round(project.targetWords * 3.2)), continueIfCut: true }),
        ctx,
      );
    },
  });
}

export function reviseChapter(o: { projectId: string; chapterId: string; critique?: Critique; issueIds: string[]; instruction: string; excluded: Set<string> }) {
  return runJob({
    key: `write:${o.chapterId}`,
    lock: { projectId: o.projectId, chapterId: o.chapterId },
    label: '修订 · 按意见改稿',
    stage: 'write',
    run: async (ctx) => {
      const [project, chapter] = await Promise.all([loadProject(o.projectId), loadChapter(o.chapterId)]);
      const text = await workingText(chapter);
      if (!text.trim()) throw new AIError('当前没有可修订的正文');
      const { text: lensText } = await assembleLens(o.projectId, o.chapterId, o.excluded);
      return writeInto(
        chapter,
        'revision',
        o.issueIds.length ? `修订稿 · 采纳 ${o.issueIds.length} 条意见` : '修订稿',
        (c, keep) =>
          call('write', o.projectId, P.revisePrompt({ project, lensText, text, critique: o.critique, issueIds: o.issueIds, instruction: o.instruction }), () => D.demoRevise({ text, critique: o.critique, issueIds: o.issueIds, project }), {
            signal: c.signal,
            onToken: (chunk, full) => {
              keep(full);
              c.onToken(chunk, full);
            },
          }, { maxTokens: Math.max(8000, Math.round(project.targetWords * 3.4)), continueIfCut: true }),
        ctx,
      );
    },
  });
}

// ─────────────────────────── 审稿 ───────────────────────────

const BEAT_STATUS: Record<string, BeatStatus> = { done: 'done', 已完成: 'done', 完成: 'done', missing: 'missing', 未完成: 'missing', 缺失: 'missing', uncertain: 'uncertain', 待核实: 'uncertain' };
const SEVERITY: Record<string, CritiqueIssue['severity']> = { high: 'high', 高: 'high', 严重: 'high', medium: 'medium', 中: 'medium', low: 'low', 低: 'low', 轻微: 'low' };

export function critiqueChapter(projectId: string, chapterId: string) {
  return runJob({
    key: `critique:${chapterId}`,
    lock: { projectId, chapterId },
    label: '审稿 · 编辑正在阅读',
    stage: 'review',
    run: async (ctx) => {
      const [project, chapter] = await Promise.all([loadProject(projectId), loadChapter(chapterId)]);
      const text = await workingText(chapter);
      if (countChars(text) < 50) throw new AIError('正文太短，至少写下几段再审稿吧');
      const [characters, threads] = await Promise.all([
        db.characters.where('projectId').equals(projectId).toArray(),
        db.threads.where('projectId').equals(projectId).toArray(),
      ]);
      // 对照前文：先补齐前几章的台账，把已确立的事实交给审稿
      await ensureDigestsBefore(projectId, chapter.index, ctx);
      const prevChapters = (await db.chapters.where('projectId').equals(projectId).sortBy('index')).filter((c) => c.index < chapter.index).slice(-6);
      const factsText = [
        ...characters.filter((c) => c.state.location || c.state.condition || c.state.knowledge).map((c) => `【${c.name}】${[c.state.location && `位置：${c.state.location}`, c.state.condition && `状态：${c.state.condition}`, c.state.knowledge && `已知：${c.state.knowledge}`].filter(Boolean).join('；')}`),
        ...prevChapters.filter((c) => c.digest?.facts.length).map((c) => `第${c.index}章：\n${c.digest!.facts.map((f) => `- ${f}`).join('\n')}`),
      ].join('\n');
      // 审稿与「本章台账（含与前文的矛盾检查）」并行进行，不增加等待时间
      const priorFacts = prevChapters.filter((c) => c.digest?.facts.length).map((c) => `第${c.index}章：${c.digest!.facts.join('；')}`).join('\n');
      const [raw, curDigest] = await Promise.all([
        call('review', projectId, P.critiquePrompt(project, chapter, blueprintText(chapter, characters, threads), text, lintSummaryText(text), factsText), () => D.demoCritique({ text, chapter }), ctx, { temperature: 0.3, maxTokens: 10000, json: true }),
        ensureDigest(project, chapter, characters.map((c) => c.name), priorFacts, ctx.signal),
      ]);
      const r = parse<Partial<CritiqueResult> & { conflicts?: any[] }>(raw, true);
      const world = await db.world.where('projectId').equals(projectId).toArray();
      const rawIssues = [
        ...arr<any>(r.issues).map((i) => ({
          id: uid('is_'),
          severity: SEVERITY[str(i.severity).toLowerCase()] ?? 'medium',
          type: str(i.type, '其他'),
          quote: str(i.quote),
          problem: str(i.problem),
          suggestion: str(i.suggestion),
        })),
        // 连续性冲突：必须同时给出正文原句和被违背的事实；原句核对不上的会被一并丢弃
        ...arr<any>(r.conflicts).filter((c) => str(c.quote) && str(c.fact)).map((c) => ({
          id: uid('is_'),
          severity: 'high' as CritiqueIssue['severity'],
          type: '连贯',
          quote: str(c.quote),
          problem: str(c.problem) || '与前文已确立的事实矛盾',
          suggestion: str(c.suggestion),
          fact: str(c.fact),
        })),
      ];
      const checked = verifyCritique(text, rawIssues, arr<any>(r.beats).map((b) => ({ beat: str(b.beat), status: (BEAT_STATUS[str(b.status).toLowerCase()] ?? 'uncertain') as BeatStatus, evidence: str(b.evidence) })));
      // 程序自己能查出来的：人名写串
      const drift = nameDrift(text, characters.map((c) => c.name), [...world.map((w) => w.name), ...prevChapters.map((c) => c.title)]);
      const driftIssues = drift.map((d) => ({
        id: uid('is_'),
        severity: 'medium' as CritiqueIssue['severity'],
        type: '连贯',
        quote: d.found,
        problem: `「${d.found}」与设定人物「${d.expected}」只差一个字，出现了 ${d.count} 次，可能是把名字写串了。`,
        suggestion: `核对是不是同一个人；如果是，统一为「${d.expected}」。`,
        verified: 'exact' as const,
      }));
      const digestIssues = (curDigest?.conflicts ?? []).map((c) => ({
        id: uid('is_'),
        severity: 'high' as CritiqueIssue['severity'],
        type: '连贯',
        quote: '',
        problem: `台账对照发现：本章写到「${c.fact}」`,
        suggestion: '核对是前文还是本章写错了，统一后重新审稿。',
        fact: c.prior,
        verified: 'global' as const,
      }));
      const critique: Critique = {
        id: uid('cr_'),
        projectId,
        chapterId,
        versionId: chapter.workingVersionId!,
        createdAt: Date.now(),
        scores: Object.fromEntries(CRITIQUE_DIMENSIONS.map((d) => [d, clamp(Number(r.scores?.[d]) || 6, 1, 10)])) as Critique['scores'],
        verdict: str(r.verdict),
        beats: checked.beats,
        issues: [...checked.issues, ...driftIssues, ...digestIssues],
        strengths: arr<string>(r.strengths).map((s) => str(s)),
        dropped: checked.dropped,
      };
      await db.critiques.add(critique);
      const fresh = await loadChapter(chapterId);
      if (fresh.status !== 'final') await db.chapters.update(chapterId, { status: 'review' });
      return critique;
    },
  });
}

function countChars(text: string) {
  return text.replace(/\s/g, '').length;
}

// ─────────────────────────── 定稿 & 守典人 ───────────────────────────

export async function finalizeWithKeeper(projectId: string, chapterId: string): Promise<number> {
  const chapter = await loadChapter(chapterId);
  await finalizeChapter(chapter);
  return runJob({
    key: `keeper:${chapterId}`,
    lock: { projectId, chapterId },
    label: '整理定稿中的设定变化',
    stage: 'plan',
    run: async (ctx) => {
      const [project, fresh] = await Promise.all([loadProject(projectId), loadChapter(chapterId)]);
      const text = await workingText(fresh);
      const [characters, threads] = await Promise.all([
        db.characters.where('projectId').equals(projectId).sortBy('order'),
        db.threads.where('projectId').equals(projectId).sortBy('order'),
      ]);
      const raw = await call(
        'plan',
        projectId,
        P.extractPrompt(project, fresh, text, characters.map((c) => characterCard(c, true)).join('\n'), await threadsText(projectId)),
        () => D.demoExtract({ project, chapter: fresh, text, characters, threads }),
        ctx,
        { temperature: 0.2, maxTokens: 8000, json: true },
      );
      const r = parse<Partial<ExtractionResult>>(raw, true);
      // 旧的待定提案来自同一章的早先定稿，已经过时
      await db.proposals.where('projectId').equals(projectId).filter((p) => p.chapterId === chapterId && p.status === 'pending').delete();
      return proposeFromExtraction(projectId, fresh, {
        summary: str(r.summary),
        storySoFar: str(r.storySoFar),
        characterUpdates: arr<any>(r.characterUpdates).map((u) => ({ name: str(u.name), location: str(u.location), condition: str(u.condition), knowledge: str(u.knowledge), change: str(u.change) })),
        newCharacters: arr<any>(r.newCharacters).map((n) => ({ name: str(n.name), role: str(n.role), summary: str(n.summary) })).filter((n) => n.name),
        worldFacts: arr<any>(r.worldFacts).map((w) => ({ category: str(w.category, '其他'), name: str(w.name), content: str(w.content) })).filter((w) => w.name),
        threadProgress: arr<any>(r.threadProgress).map((t) => ({ thread: str(t.thread), progress: str(t.progress), resolved: !!t.resolved })),
      });
    },
  });
}

// ─────────────────────────── 缪斯 ───────────────────────────

export function muse(o: { projectId: string; chapterId: string; action: MuseAction; selection: string; before: string; after: string; instruction: string }) {
  return runJob({
    key: `muse:${o.chapterId}`,
    label: 'AI 改写',
    stage: 'muse',
    run: async (ctx) => {
      const [project, chapter] = await Promise.all([loadProject(o.projectId), loadChapter(o.chapterId)]);
      const characters = await db.characters.where('projectId').equals(o.projectId).toArray();
      const involved = characters.filter((c) => chapter.blueprint.characterIds.includes(c.id) || o.selection.includes(c.name));
      const raw = await call(
        'muse',
        o.projectId,
        P.musePrompt({ project, action: o.action, selection: o.selection, before: o.before, after: o.after, instruction: o.instruction, characters: involved.map((c) => characterCard(c, true)).join('\n') }),
        () => D.demoMuse({ action: o.action, selection: o.selection, project, instruction: o.instruction }),
        ctx,
        { maxTokens: Math.max(3000, o.selection.length * 6) },
      );
      return cleanProse(raw).replace(/^[“"]|[”"]$/g, (m) => (o.selection.startsWith(m) || o.selection.endsWith(m) ? m : ''));
    },
  });
}

export function continueWriting(o: { projectId: string; chapterId: string; before: string; after: string }) {
  return runJob({
    key: `ghost:${o.chapterId}`,
    label: 'AI 续写',
    stage: 'muse',
    run: async (ctx) => {
      const [project, chapter] = await Promise.all([loadProject(o.projectId), loadChapter(o.chapterId)]);
      const [characters, threads] = await Promise.all([
        db.characters.where('projectId').equals(o.projectId).toArray(),
        db.threads.where('projectId').equals(o.projectId).toArray(),
      ]);
      const raw = await call(
        'muse',
        o.projectId,
        P.continuePrompt({ project, blueprint: blueprintText(chapter, characters, threads), before: o.before, after: o.after }),
        () => D.demoContinue({ project, before: o.before, pov: chapter.blueprint.pov }),
        ctx,
        { maxTokens: 2500 },
      );
      return cleanProse(raw);
    },
  });
}

// ─────────────────────────── 访谈 & 文风 ───────────────────────────

export function interview(o: { project: Project; characterId: string; history: ChatMessage[] }) {
  return runJob({
    key: `interview:${o.characterId}`,
    label: '角色访谈',
    stage: 'muse',
    run: async (ctx) => {
      const c = await db.characters.get(o.characterId);
      if (!c) throw new AIError('角色不存在');
      const last = o.history[o.history.length - 1]?.content ?? '';
      return call('muse', o.project.id, { system: P.interviewSystem(o.project, c), user: last }, () => D.demoInterview({ character: c, question: last }), ctx, {
        messages: o.history,
        maxTokens: 3000,
      });
    },
  });
}

export function analyzeStyle(projectId: string, sample: string) {
  return runJob({
    key: `style:${projectId}`,
    label: '文风分析',
    stage: 'plan',
    run: async (ctx) => {
      const raw = await call('plan', projectId, P.stylePrompt(sample), () => D.demoStyle(sample), ctx, { temperature: 0.2, maxTokens: 4000, json: true });
      const r = parse<Partial<StyleAnalysis>>(raw);
      return { voice: str(r.voice), pov: str(r.pov), tense: str(r.tense), tone: str(r.tone), rules: arr<string>(r.rules).map((x) => str(x)) };
    },
  });
}

// ─────────────────────────── 连写 ───────────────────────────

/**
 * 连写：按顺序为多章起草（可选：每章自动审稿并按意见修订）。
 *
 * - 已有正文的章节会跳过，绝不覆盖作者的稿子；
 * - 不会自动定稿：连写产出的都是草稿，由作者审阅后盖印；
 * - 后一章通过透镜衔接前一章的草稿结尾（标注为“未定稿”）；
 * - 某一章失败即停止后续章节，避免在错误的前文上继续写；
 * - “暂停”会在当前章节写完后停下，“停止”会立刻中断当前生成（已写的部分仍会保存）。
 */
export async function batchWrite(o: { projectId: string; chapterIds: string[]; review: boolean }) {
  if (useBatch.getState().running) throw new AIError('已有一个批量写作任务在进行中');
  const chapters = (await Promise.all(o.chapterIds.map((id) => db.chapters.get(id)))).filter((c): c is Chapter => !!c);
  if (!chapters.length) throw new AIError('没有可写的章节');
  useBatch.setState({
    projectId: o.projectId,
    running: true,
    pauseRequested: false,
    review: o.review,
    startedAt: Date.now(),
    finishedAt: undefined,
    items: chapters.map((c) => ({ chapterId: c.id, index: c.index, title: c.title, status: 'waiting', words: 0 })),
  });

  const first = chapters[0].index;
  const last = chapters[chapters.length - 1].index;
  let current = '';
  const stopRest = (from: number, note: string) => {
    for (const c of chapters.slice(from)) patchBatchItem(c.id, { status: 'stopped', note });
  };

  try {
    return await runJob({
      key: `batch:${o.projectId}`,
      label: `批量写作 · 第${first}–${last}章`,
      stage: 'write',
      run: async (ctx) => {
        // 停止连写时，同步中断正在进行的单章任务
        ctx.signal.addEventListener('abort', () => {
          abortJob(`write:${current}`);
          abortJob(`critique:${current}`);
        });
        let done = 0;
        for (let i = 0; i < chapters.length; i++) {
          const id = chapters[i].id;
          if (ctx.signal.aborted) {
            stopRest(i, '已停止');
            break;
          }
          if (useBatch.getState().pauseRequested) {
            stopRest(i, '已暂停，可稍后继续');
            break;
          }
          current = id;
          const fresh = await loadChapter(id);
          if ((await workingText(fresh)).trim()) {
            patchBatchItem(id, { status: 'skipped', note: '已有正文，保留原稿', words: fresh.words });
            continue;
          }
          // 整章（起草 → 审稿 → 修订）期间一直持有章节锁
          let releaseLock: (() => void) | null = null;
          try {
            releaseLock = await holdLock(id, o.projectId);
          } catch (error) {
            if (error instanceof LockedError) {
              patchBatchItem(id, { status: 'skipped', note: `${error.message}，已跳过` });
              continue;
            }
            if (!(error instanceof ApiError && error.status === 0)) throw error;
          }
          try {
            patchBatchItem(id, { status: 'drafting' });
            const v = await draftChapter(o.projectId, id, new Set());
            if (!v) {
              patchBatchItem(id, { status: 'stopped', note: '已中断，写好的部分已保存' });
              stopRest(i + 1, '已停止');
              break;
            }
            patchBatchItem(id, { words: v.words });
            if (o.review) {
              patchBatchItem(id, { status: 'reviewing' });
              const critique = await critiqueChapter(o.projectId, id);
              const issueIds = critique.issues.filter((x) => x.severity !== 'low').map((x) => x.id);
              if (issueIds.length || critique.beats.some((b) => b.status !== 'done')) {
                patchBatchItem(id, { status: 'revising' });
                const r = await reviseChapter({ projectId: o.projectId, chapterId: id, critique, issueIds, instruction: '', excluded: new Set() });
                if (!r) {
                  patchBatchItem(id, { status: 'stopped', note: '修订被中断，草稿已保存' });
                  stopRest(i + 1, '已停止');
                  break;
                }
                patchBatchItem(id, { words: r.words, note: `采纳 ${issueIds.length} 条意见` });
              }
            }
            patchBatchItem(id, { status: 'done' });
            done++;
          } catch (error) {
            if (isAbort(error) || ctx.signal.aborted) {
              patchBatchItem(id, { status: 'stopped', note: '已中断' });
              stopRest(i + 1, '已停止');
              break;
            }
            patchBatchItem(id, { status: 'failed', note: error instanceof Error ? error.message : String(error) });
            stopRest(i + 1, '前一章失败，已停止');
            break;
          } finally {
            releaseLock?.();
          }
        }
        return done;
      },
    });
  } finally {
    useBatch.setState({ running: false, pauseRequested: false, finishedAt: Date.now() });
  }
}
