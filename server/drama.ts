/**
 * 小说 → 短剧画布：画布数据、执行引擎与导出。
 *
 * 一部小说对应一张画布。节点按「小说 → 故事拆解 → 分集大纲 → 每集（剧本 → 分镜）」连成流水线：
 * - 每个节点保存 input_hash（运行时它依赖的一切内容的指纹）。上游任何内容变了，
 *   当前指纹与保存的不一致，节点就显示「已过期」，只需重跑变化的部分。
 * - 运行在服务端后台进行：请求立即返回，进度通过 SSE 事件（type: 'drama'）通知浏览器刷新。
 * - 模型调用走 AI 网关的 runTextModel：同一套密钥、额度与用量记录。
 */
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { AIError } from '@/ai/providers';
import { extractJson } from '@/lib/util';
import {
  DEFAULT_PRESET,
  GENRES,
  NODE_LABEL,
  type BreakdownOutput,
  type DramaEdgeDTO,
  type DramaNodeDTO,
  type DramaNodeStatus,
  type DramaNodeType,
  type DramaPreset,
  type DramaProjectDTO,
  type ImageOutput,
  type OutlineEpisode,
  type OutlineOutput,
  type ScriptOutput,
  type Shot,
  type StoryboardOutput,
} from '@/shared/drama';
import { atLeast } from '@/shared/permissions';
import { runTextModel } from './ai.ts';
import { deleteAssets, generateMedia } from './media.ts';
import { sql, withTenant, type Tx } from './db/pool.ts';
import { breakdownPrompt, outlinePrompt, scriptPrompt, storyboardPrompt } from './drama-prompts.ts';
import { isUuid, readJson, requireOrg, roleInProject, type AppEnv, type OrgContext } from './http.ts';
import { badRequest, conflict, forbidden, HttpError, notFound } from './lib/errors.ts';
import { limit } from './lib/ratelimit.ts';
import { notifyOrg } from './realtime.ts';

// ─────────────────────────── 小工具 ───────────────────────────

type Row = Record<string, any>;

const sha = (x: unknown) => createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x ?? null)).digest('hex').slice(0, 16);
const str = (x: unknown, max = 4000) => (typeof x === 'string' ? x.trim().slice(0, max) : typeof x === 'number' ? String(x) : '');
const arr = <T = unknown>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const int = (x: unknown, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const MAX_RUNNING_PER_ORG = 6;
const BATCH_CONCURRENCY = 3;
const OUTLINE_BATCH = 10;
const NODE_TIMEOUT_MS = 8 * 60_000;

/** 本进程正在执行的节点与整画布批量任务 */
const running = new Map<string, AbortController>();
const batches = new Map<string, { cancelled: boolean }>();
const orgBusy = new Map<string, number>();

function notifyDrama(orgId: string, dramaId: string) {
  notifyOrg(orgId, { type: 'drama', dramaId });
}

// ─────────────────────────── 预设 ───────────────────────────

export function sanitizePreset(input: Partial<DramaPreset> | undefined, chapterCount: number, base: DramaPreset = DEFAULT_PRESET): DramaPreset {
  const p = { ...base, ...(input ?? {}) };
  const maxCh = Math.max(1, chapterCount);
  const from = int(p.chapterFrom, 1, 1, maxCh);
  const to = int(p.chapterTo, maxCh, from, maxCh);
  return {
    chapterFrom: from,
    chapterTo: to,
    episodes: int(p.episodes, 20, 1, 80),
    episodeSeconds: int(p.episodeSeconds, 90, 30, 180),
    ratio: p.ratio === '16:9' ? '16:9' : '9:16',
    genre: GENRES.some((g) => g.value === p.genre) ? p.genre : 'twist',
    style: str(p.style, 300),
  };
}

// ─────────────────────────── 读取小说 ───────────────────────────

interface Chapter {
  id: string;
  index: number;
  title: string;
  summary: string;
  versionId: string;
  /** 内容指纹：正文变了它就变 */
  sig: string;
  content?: string;
}

async function loadChapterRows(tx: Tx, novelId: string): Promise<Chapter[]> {
  const rows = await tx<{ id: string; data: Row }[]>`select id, data from records where tbl = 'chapters' and project_id = ${novelId} and not deleted`;
  return rows
    .map(({ id, data }) => {
      const versionId = str(data.status === 'final' ? (data.canonVersionId ?? data.workingVersionId) : (data.workingVersionId ?? data.canonVersionId), 100);
      return {
        id,
        index: Number(data.index) || 0,
        title: str(data.title, 100),
        summary: str(data.summary, 600),
        versionId,
        sig: `${versionId}:${data.words ?? 0}:${data.updatedAt ?? 0}`,
      };
    })
    .sort((a, b) => a.index - b.index);
}

async function attachContent(tx: Tx, chapters: Chapter[]): Promise<Chapter[]> {
  const ids = chapters.map((c) => c.versionId).filter(Boolean);
  const map = new Map<string, string>();
  if (ids.length) {
    for (const r of await tx<{ id: string; content: string | null }[]>`select id, data->>'content' as content from records where tbl = 'versions' and id = any(${ids}) and not deleted`) {
      map.set(r.id, r.content ?? '');
    }
  }
  return chapters.map((c) => ({ ...c, content: map.get(c.versionId) ?? '' }));
}

async function loadNovelMeta(tx: Tx, novelId: string) {
  const [p] = await tx<{ data: Row }[]>`select data from records where tbl = 'projects' and id = ${novelId} and not deleted`;
  if (!p) throw notFound('找不到这部小说');
  return { title: str(p.data.title, 100), logline: str(p.data.logline, 300), genre: str(p.data.genre, 40) };
}

/** 设定集里的人物与世界观，作为拆解时的参考。 */
async function loadBible(tx: Tx, novelId: string): Promise<string> {
  const rows = await tx<{ tbl: string; data: Row }[]>`
    select tbl, data from records where project_id = ${novelId} and tbl in ('characters', 'world') and not deleted limit 200`;
  const chars = rows
    .filter((r) => r.tbl === 'characters')
    .map((r) => `- ${str(r.data.name, 40)}（${str(r.data.role, 20)}）${clip(str(r.data.summary, 200), 120)}｜外貌：${clip(str(r.data.appearance, 200), 100)}｜说话：${clip(str(r.data.voice, 120), 60)}`);
  const world = rows.filter((r) => r.tbl === 'world').map((r) => `- ${str(r.data.name, 40)}：${clip(str(r.data.content, 300), 120)}`);
  return [chars.length ? `人物：\n${chars.join('\n')}` : '', world.length ? `世界观：\n${world.slice(0, 30).join('\n')}` : ''].filter(Boolean).join('\n\n');
}

/** 把章节正文压成不超过预算的文本：放得下就全文，放不下就每章保留头尾。 */
function digest(chapters: Chapter[], budget: number): string {
  const total = chapters.reduce((n, c) => n + (c.content?.length ?? 0), 0);
  const per = total <= budget ? Infinity : Math.max(400, Math.floor(budget / Math.max(1, chapters.length)));
  return chapters
    .map((c) => {
      const t = c.content ?? '';
      const body = t.length > per ? `${t.slice(0, Math.floor(per * 0.6))}\n……（中间省略）……\n${t.slice(t.length - Math.floor(per * 0.4))}` : t;
      return `[${c.index}] ${c.title}\n${body}`;
    })
    .join('\n\n');
}

function chapterOverview(chapters: Chapter[]): string {
  return chapters.map((c) => `[${c.index}] ${c.title}：${clip(c.summary || (c.content ?? '').replace(/\s+/g, ''), 90)}`).join('\n');
}

// ─────────────────────────── 输出规范化 ───────────────────────────

function normBreakdown(raw: any): BreakdownOutput {
  return {
    logline: str(raw?.logline, 300),
    mainPlot: str(raw?.mainPlot, 1200),
    subplots: arr<Row>(raw?.subplots).slice(0, 12).map((s) => ({ name: str(s?.name, 60), summary: str(s?.summary, 400) })),
    keyEvents: arr<Row>(raw?.keyEvents).slice(0, 30).map((e) => ({
      title: str(e?.title, 80),
      summary: str(e?.summary, 400),
      chapters: arr(e?.chapters).map(Number).filter((n) => Number.isFinite(n)),
      visual: int(e?.visual, 3, 1, 5),
    })),
    characters: arr<Row>(raw?.characters).slice(0, 30).map((c) => ({
      name: str(c?.name, 40),
      role: str(c?.role, 30),
      look: str(c?.look, 400),
      voice: str(c?.voice, 200),
      relations: str(c?.relations, 300),
    })).filter((c) => c.name),
    locations: arr<Row>(raw?.locations).slice(0, 30).map((l) => ({ name: str(l?.name, 60), look: str(l?.look, 400) })).filter((l) => l.name),
    tone: str(raw?.tone, 400),
    notes: str(raw?.notes, 1000),
  };
}

function normEpisode(e: Row, fallbackN: number): OutlineEpisode {
  return {
    n: int(e?.n, fallbackN, 1, 999),
    title: str(e?.title, 60) || `第${fallbackN}集`,
    hook: str(e?.hook, 300),
    conflict: str(e?.conflict, 300),
    twist: str(e?.twist, 300),
    cliffhanger: str(e?.cliffhanger, 300),
    summary: str(e?.summary, 600),
    sourceChapters: arr(e?.sourceChapters).map(Number).filter((n) => Number.isFinite(n) && n > 0),
    characters: arr(e?.characters).map((x) => str(x, 40)).filter(Boolean),
  };
}

function normScript(raw: any, episode: number): ScriptOutput {
  return {
    episode,
    title: str(raw?.title, 60),
    scenes: arr<Row>(raw?.scenes).slice(0, 20).map((s, i) => ({
      n: int(s?.n, i + 1, 1, 99),
      location: str(s?.location, 60),
      time: str(s?.time, 20),
      summary: str(s?.summary, 400),
      source: s?.source && Number(s.source.chapter) > 0 ? { chapter: Number(s.source.chapter), quote: str(s.source.quote, 120) } : undefined,
      lines: arr<Row>(s?.lines).slice(0, 80).map((l) => {
        const type = l?.type === 'dialogue' || l?.type === 'narration' ? l.type : 'action';
        return { type, speaker: type === 'dialogue' ? str(l?.speaker, 40) : undefined, text: str(l?.text, 600), emotion: type === 'dialogue' ? str(l?.emotion, 40) || undefined : undefined };
      }).filter((l) => l.text),
    })),
  };
}

function normStoryboard(raw: any, episode: number): StoryboardOutput {
  const shots: Shot[] = arr<Row>(raw?.shots).slice(0, 80).map((s, i) => {
    const d = s?.dialogue;
    return {
      n: i + 1,
      scene: int(s?.scene, 1, 1, 99),
      size: str(s?.size, 10) || '中景',
      move: str(s?.move, 10) || '固定',
      seconds: int(s?.seconds, 4, 1, 15),
      visual: str(s?.visual, 800),
      dialogue: d && str(d.text, 300) ? { speaker: str(d.speaker, 40), text: str(d.text, 300), emotion: str(d.emotion, 40) || undefined } : undefined,
      narration: str(s?.narration, 300) || undefined,
      sfx: str(s?.sfx, 100) || undefined,
      firstFrame: str(s?.firstFrame, 600) || str(s?.visual, 600),
      lastFrame: str(s?.lastFrame, 600) || undefined,
    };
  });
  return { episode, shots, totalSeconds: shots.reduce((n, s) => n + s.seconds, 0) };
}

// ─────────────────────────── 画布状态 ───────────────────────────

interface NodeRow {
  id: string;
  drama_id: string;
  type: DramaNodeType;
  title: string;
  x: number;
  y: number;
  params: Row;
  status: DramaNodeStatus;
  output: any;
  output_hash: string;
  input_hash: string;
  error: string | null;
  approved: boolean;
  run_ms: number;
  started_at: Date | null;
  updated_at: Date;
}

interface DramaRow {
  id: string;
  novel_id: string;
  preset: DramaPreset;
  created_at: Date;
}

interface State {
  drama: DramaRow;
  preset: DramaPreset;
  nodes: NodeRow[];
  edges: { id: string; from_id: string; to_id: string }[];
  chapters: Chapter[];
  /** 当前启用的图像服务（换了服务，图像节点就该重算） */
  imageProvider: string | null;
}

async function loadState(tx: Tx, dramaId: string): Promise<State> {
  const [drama] = await tx<DramaRow[]>`select id, novel_id, preset, created_at from drama_projects where id = ${dramaId}`;
  if (!drama) throw notFound('找不到这张画布');
  const [nodes, edges, chapters, ip] = await Promise.all([
    tx<NodeRow[]>`select * from drama_nodes where drama_id = ${dramaId} order by x, y`,
    tx<{ id: string; from_id: string; to_id: string }[]>`select id, from_id, to_id from drama_edges where drama_id = ${dramaId}`,
    loadChapterRows(tx, drama.novel_id),
    tx<{ provider_id: string | null }[]>`select provider_id from media_assignments where kind = 'image'`,
  ]);
  return { drama, preset: { ...DEFAULT_PRESET, ...drama.preset }, nodes, edges, chapters, imageProvider: ip[0]?.provider_id ?? null };
}

const find = (s: State, type: DramaNodeType) => s.nodes.find((n) => n.type === type);
const episodeNode = (s: State, type: 'script' | 'storyboard', n: number) => s.nodes.find((x) => x.type === type && Number(x.params.episode) === n);

function chapterSig(s: State, indexes: number[]): string {
  const by = new Map(s.chapters.map((c) => [c.index, c.sig]));
  return sha(indexes.map((i) => `${i}:${by.get(i) ?? ''}`));
}

function rangeIndexes(s: State): number[] {
  return s.chapters.filter((c) => c.index >= s.preset.chapterFrom && c.index <= s.preset.chapterTo).map((c) => c.index);
}

/** 节点此刻运行会依赖的一切内容的指纹；与保存的 input_hash 不同即为「已过期」。 */
function currentInputHash(s: State, node: NodeRow): string {
  const p = s.preset;
  const breakdown = find(s, 'breakdown');
  const outline = find(s, 'outline');
  switch (node.type) {
    case 'breakdown':
      return sha({ p: [p.episodes, p.episodeSeconds, p.genre, p.style], src: chapterSig(s, rangeIndexes(s)) });
    case 'outline':
      return sha({ p: [p.episodes, p.episodeSeconds, p.genre, p.style, p.chapterFrom, p.chapterTo], b: breakdown?.output_hash });
    case 'script': {
      const ep = arr<OutlineEpisode>(outline?.output?.episodes).find((e) => e.n === Number(node.params.episode));
      return sha({ p: [p.episodeSeconds, p.genre, p.style], ep, b: breakdown?.output_hash, src: chapterSig(s, ep?.sourceChapters ?? []) });
    }
    case 'storyboard': {
      const script = episodeNode(s, 'script', Number(node.params.episode));
      return sha({ p: [p.ratio, p.episodeSeconds, p.style], script: script?.output_hash, b: breakdown?.output_hash });
    }
    case 'portrait':
    case 'location': {
      const item = assetSource(s, node);
      return sha({ style: p.style, ratio: node.type === 'location' ? p.ratio : '', item, prompt: node.params.prompt ?? '', provider: s.imageProvider });
    }
    default:
      return '';
  }
}

/** 图像节点对应的拆解条目（人物或场景） */
function assetSource(s: State, node: NodeRow): { name: string; look: string } | null {
  const b = find(s, 'breakdown')?.output as BreakdownOutput | undefined;
  const key = String(node.params.key ?? '');
  const list = node.type === 'portrait' ? b?.characters : b?.locations;
  const it = arr<{ name: string; look: string }>(list).find((x) => x.name === key);
  return it ? { name: it.name, look: it.look } : null;
}

function portraitPrompt(style: string, name: string, look: string): string {
  return `${style ? `${style}。` : ''}角色定妆照：${name}，${look}。全身像，正面站立，表情自然，纯净浅色背景，光线均匀，细节清晰，不要文字。`;
}

function locationPrompt(style: string, name: string, look: string): string {
  return `${style ? `${style}。` : ''}场景概念图：${name}，${look}。空镜，不出现人物，电影感构图，不要文字。`;
}

function isStale(s: State, n: NodeRow): boolean {
  return n.type !== 'source' && n.status === 'done' && n.input_hash !== currentInputHash(s, n);
}

function toDTO(s: State): DramaProjectDTO {
  const nodes: DramaNodeDTO[] = s.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    x: n.x,
    y: n.y,
    params: n.params,
    status: n.type === 'source' ? 'done' : n.status,
    output: n.output,
    error: n.error,
    approved: n.approved,
    stale: isStale(s, n),
    runMs: n.run_ms,
    startedAt: n.started_at?.toISOString() ?? null,
    updatedAt: n.updated_at.toISOString(),
  }));
  const edges: DramaEdgeDTO[] = s.edges.map((e) => ({ id: e.id, from: e.from_id, to: e.to_id }));
  return { id: s.drama.id, novelId: s.drama.novel_id, preset: s.preset, nodes, edges, chapterCount: s.chapters.length, createdAt: s.drama.created_at.toISOString() };
}

// ─────────────────────────── 画布构建 ───────────────────────────

const COL = { source: 0, breakdown: 400, outline: 800, script: 1240, storyboard: 1680 };
const ROW_H = 320;

async function insertNode(tx: Tx, orgId: string, dramaId: string, type: DramaNodeType, title: string, x: number, y: number, params: Row = {}): Promise<string> {
  const [r] = await tx<{ id: string }[]>`
    insert into drama_nodes (org_id, drama_id, type, title, x, y, params) values (${orgId}, ${dramaId}, ${type}, ${title}, ${x}, ${y}, ${tx.json(params)}) returning id`;
  return r.id;
}

async function link(tx: Tx, orgId: string, dramaId: string, from: string, to: string) {
  await tx`insert into drama_edges (org_id, drama_id, from_id, to_id) values (${orgId}, ${dramaId}, ${from}, ${to}) on conflict (from_id, to_id) do nothing`;
}

/** 大纲有了之后，为每一集建好「剧本 → 分镜」两个节点；集数减少时删掉多余的。 */
async function reconcileEpisodes(tx: Tx, orgId: string, dramaId: string, outline: OutlineOutput) {
  const s = await loadState(tx, dramaId);
  const outlineNode = find(s, 'outline')!;
  const wanted = new Set(outline.episodes.map((e) => e.n));
  for (const n of s.nodes) {
    if ((n.type === 'script' || n.type === 'storyboard') && !wanted.has(Number(n.params.episode))) await tx`delete from drama_nodes where id = ${n.id}`;
  }
  for (const ep of outline.episodes) {
    const y = (ep.n - 1) * ROW_H;
    const script = episodeNode(s, 'script', ep.n);
    const board = episodeNode(s, 'storyboard', ep.n);
    const scriptId = script?.id ?? (await insertNode(tx, orgId, dramaId, 'script', `第${ep.n}集 · 剧本`, COL.script, y, { episode: ep.n }));
    const boardId = board?.id ?? (await insertNode(tx, orgId, dramaId, 'storyboard', `第${ep.n}集 · 分镜`, COL.storyboard, y, { episode: ep.n }));
    if (script) await tx`update drama_nodes set title = ${`第${ep.n}集 · 剧本`} where id = ${scriptId}`;
    await link(tx, orgId, dramaId, outlineNode.id, scriptId);
    await link(tx, orgId, dramaId, scriptId, boardId);
  }
}

/** 拆解完成后，为每个人物与场景建一个图像节点（人物在左列、场景在右列，位于大纲下方）。 */
async function reconcileAssets(tx: Tx, orgId: string, dramaId: string, b: BreakdownOutput) {
  const s = await loadState(tx, dramaId);
  const breakdownNode = find(s, 'breakdown')!;
  const groups: { type: 'portrait' | 'location'; names: string[]; x: number; label: string }[] = [
    { type: 'portrait', names: b.characters.map((c) => c.name), x: COL.breakdown, label: '定妆' },
    { type: 'location', names: b.locations.map((l) => l.name), x: COL.outline, label: '场景' },
  ];
  for (const g of groups) {
    const want = new Set(g.names);
    for (const n of s.nodes.filter((x) => x.type === g.type)) {
      if (!want.has(String(n.params.key))) {
        await deleteAssets(tx, { nodeId: n.id });
        await tx`delete from drama_nodes where id = ${n.id}`;
      }
    }
    for (const [i, name] of g.names.entries()) {
      const existing = s.nodes.find((x) => x.type === g.type && x.params.key === name);
      const id = existing?.id ?? (await insertNode(tx, orgId, dramaId, g.type, `${name} · ${g.label}`, g.x, 300 + i * 300, { key: name }));
      await link(tx, orgId, dramaId, breakdownNode.id, id);
    }
  }
}

// ─────────────────────────── 模型调用 ───────────────────────────

async function generateJson(org: OrgContext, novelId: string, prompt: { system: string; user: string }, signal: AbortSignal, maxTokens = 8000): Promise<any> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(NODE_TIMEOUT_MS)]);
  let user = prompt.user;
  for (let attempt = 0; ; attempt++) {
    const text = await runTextModel(org, { stage: 'plan', usageStage: 'drama', projectId: novelId, system: prompt.system, user, maxTokens, temperature: 0.7, signal: combined });
    try {
      return extractJson(text);
    } catch {
      if (attempt >= 1) throw new HttpError(502, 'bad_json', '模型返回的内容不是有效的 JSON（可能因为内容太长被截断）。请重试，或减少集数、缩小章节范围。');
      user = `${prompt.user}\n\n注意：上一次的输出不是合法 JSON。请严格只输出一个 JSON 对象，不要包含任何其他文字。`;
    }
  }
}

function charactersText(b: BreakdownOutput | undefined, names?: string[]): string {
  const list = arr<BreakdownOutput['characters'][number]>(b?.characters).filter((c) => !names?.length || names.includes(c.name) || c.role.includes('主'));
  return list.map((c) => `- ${c.name}（${c.role}）外貌：${c.look}｜声线：${c.voice}`).join('\n') || '（无）';
}

function locationsText(b: BreakdownOutput | undefined): string {
  return arr<BreakdownOutput['locations'][number]>(b?.locations).map((l) => `- ${l.name}：${l.look}`).join('\n') || '（无）';
}

function scriptText(sc: ScriptOutput): string {
  return sc.scenes
    .map((s) => {
      const lines = s.lines.map((l) => (l.type === 'dialogue' ? `${l.speaker}${l.emotion ? `（${l.emotion}）` : ''}：${l.text}` : l.type === 'narration' ? `【旁白】${l.text}` : `△ ${l.text}`)).join('\n');
      return `场 ${s.n}｜${s.location}｜${s.time}\n${s.summary}\n${lines}`;
    })
    .join('\n\n');
}

// ─────────────────────────── 执行 ───────────────────────────

class NeedUpstream extends Error {}

async function execute(org: OrgContext, s: State, node: NodeRow, signal: AbortSignal): Promise<unknown> {
  const novelId = s.drama.novel_id;
  const p = s.preset;
  const breakdown = find(s, 'breakdown');
  const outline = find(s, 'outline');

  switch (node.type) {
    case 'breakdown': {
      const chosen = s.chapters.filter((c) => c.index >= p.chapterFrom && c.index <= p.chapterTo);
      if (!chosen.length) throw new NeedUpstream('所选章节范围内没有章节');
      const { withText, bible } = await withTenant(org.orgId, async (tx) => ({ withText: await attachContent(tx, chosen), bible: await loadBible(tx, novelId) }));
      if (!withText.some((c) => (c.content ?? '').trim())) throw new NeedUpstream('所选章节还没有正文，请先写完再改编');
      const raw = await generateJson(org, novelId, breakdownPrompt(p, digest(withText, 90_000), bible), signal);
      const out = normBreakdown(raw);
      if (!out.characters.length && !out.keyEvents.length) throw new HttpError(502, 'bad_output', '模型没有拆解出人物与事件，请重试');
      return out;
    }
    case 'outline': {
      if (breakdown?.status !== 'done' || !breakdown.output) throw new NeedUpstream('请先运行「故事拆解」');
      const chosen = s.chapters.filter((c) => c.index >= p.chapterFrom && c.index <= p.chapterTo);
      const withSummary = await withTenant(org.orgId, (tx) => attachContent(tx, chosen));
      const overview = chapterOverview(withSummary);
      const b = breakdown.output as BreakdownOutput;
      const brief = `${b.logline}\n主线：${b.mainPlot}\n关键事件：\n${b.keyEvents.map((e) => `- ${e.title}（章${e.chapters.join('、')}）${e.summary}`).join('\n')}\n人物：\n${charactersText(b)}\n基调：${b.tone}\n改编建议：${b.notes}`;
      const episodes: OutlineEpisode[] = [];
      for (let from = 1; from <= p.episodes; from += OUTLINE_BATCH) {
        const to = Math.min(p.episodes, from + OUTLINE_BATCH - 1);
        const done = episodes.map((e) => `第${e.n}集《${e.title}》章${e.sourceChapters.join('、')}｜${clip(e.summary, 60)}｜悬念：${clip(e.cliffhanger, 40)}`).join('\n');
        const raw = await generateJson(org, novelId, outlinePrompt(p, { breakdown: brief, chapters: overview, from, to, total: p.episodes, done }), signal);
        const batch = arr<Row>(raw?.episodes).map((e, i) => normEpisode(e, from + i));
        if (!batch.length) throw new HttpError(502, 'bad_output', `模型没有给出第 ${from}–${to} 集的大纲，请重试`);
        // 序号以我们的顺序为准，避免模型跳号或重号
        batch.slice(0, to - from + 1).forEach((e, i) => episodes.push({ ...e, n: from + i }));
      }
      return { episodes } satisfies OutlineOutput;
    }
    case 'script': {
      const n = Number(node.params.episode);
      const o = outline?.output as OutlineOutput | undefined;
      const ep = o?.episodes.find((e) => e.n === n);
      if (outline?.status !== 'done' || !ep) throw new NeedUpstream('请先运行「分集大纲」');
      if (breakdown?.status !== 'done') throw new NeedUpstream('请先运行「故事拆解」');
      const picked = s.chapters.filter((c) => ep.sourceChapters.includes(c.index));
      const withText = await withTenant(org.orgId, (tx) => attachContent(tx, picked));
      const b = breakdown.output as BreakdownOutput;
      const prev = o!.episodes.find((e) => e.n === n - 1);
      const next = o!.episodes.find((e) => e.n === n + 1);
      const raw = await generateJson(
        org,
        novelId,
        scriptPrompt(p, {
          episode: `第${ep.n}集《${ep.title}》\n钩子：${ep.hook}\n冲突：${ep.conflict}\n反转：${ep.twist}\n结尾悬念：${ep.cliffhanger}\n剧情：${ep.summary}`,
          prev: prev?.cliffhanger ?? '',
          next: next ? `${next.title}：${next.hook}` : '',
          characters: charactersText(b, ep.characters),
          locations: locationsText(b),
          text: digest(withText, 30_000) || '（原文缺失，请依据大纲创作）',
        }),
        signal,
      );
      const out = normScript(raw, n);
      out.title ||= ep.title;
      if (!out.scenes.length) throw new HttpError(502, 'bad_output', '模型没有写出场景，请重试');
      return out;
    }
    case 'storyboard': {
      const n = Number(node.params.episode);
      const script = episodeNode(s, 'script', n);
      if (script?.status !== 'done' || !script.output) throw new NeedUpstream('请先运行这一集的「剧本」');
      const b = breakdown?.output as BreakdownOutput | undefined;
      const sc = script.output as ScriptOutput;
      const names = new Set<string>();
      for (const sceneItem of sc.scenes) for (const l of sceneItem.lines) if (l.speaker) names.add(l.speaker);
      const raw = await generateJson(org, novelId, storyboardPrompt(p, { script: scriptText(sc), characters: charactersText(b, [...names]), locations: locationsText(b) }), signal);
      const out = normStoryboard(raw, n);
      if (!out.shots.length) throw new HttpError(502, 'bad_output', '模型没有拆出镜头，请重试');
      return out;
    }
    case 'portrait':
    case 'location': {
      const item = assetSource(s, node);
      if (breakdown?.status !== 'done' || !item) throw new NeedUpstream('请先运行「故事拆解」');
      const style = p.style;
      const prompt = str(node.params.prompt, 2000) || (node.type === 'portrait' ? portraitPrompt(style, item.name, item.look) : locationPrompt(style, item.name, item.look));
      const asset = await generateMedia(org, { kind: 'image', input: { prompt, ratio: node.type === 'portrait' ? '3:4' : p.ratio }, dramaId: s.drama.id, nodeId: node.id, projectId: novelId, signal });
      // 新图生成成功后，才清理这个节点之前的旧图
      await withTenant(org.orgId, async (tx) => {
        for (const old of await tx<{ id: string }[]>`select id from media_assets where node_id = ${node.id} and id <> ${asset.id}`) await deleteAssets(tx, { assetId: old.id });
      });
      return { assetId: asset.id, prompt, mime: asset.mime } satisfies ImageOutput;
    }
    default:
      throw badRequest('这个节点不需要运行');
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof NeedUpstream) return error.message;
  if (error instanceof HttpError) return error.message;
  if (error instanceof AIError) return error.message;
  if (error instanceof DOMException && error.name === 'TimeoutError') return '运行超时，请稍后重试';
  if (error instanceof DOMException && error.name === 'AbortError') return '已取消';
  return error instanceof Error ? error.message : String(error);
}

/** 运行一个节点（在后台）。结果与状态写回数据库，并通知浏览器刷新。 */
async function runNode(org: OrgContext, dramaId: string, nodeId: string, external?: AbortSignal): Promise<'done' | 'failed'> {
  const ctrl = new AbortController();
  external?.addEventListener('abort', () => ctrl.abort(), { once: true });
  running.set(nodeId, ctrl);
  orgBusy.set(org.orgId, (orgBusy.get(org.orgId) ?? 0) + 1);
  const started = Date.now();
  try {
    const s = await withTenant(org.orgId, async (tx) => {
      await tx`update drama_nodes set status = 'running', error = null, started_at = now(), updated_at = now() where id = ${nodeId}`;
      return loadState(tx, dramaId);
    });
    notifyDrama(org.orgId, dramaId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node) throw notFound('节点不存在');
    const inputHash = currentInputHash(s, node);
    const output = await execute(org, s, node, ctrl.signal);
    await withTenant(org.orgId, async (tx) => {
      await tx`update drama_nodes set status = 'done', output = ${tx.json(output as any)}, output_hash = ${sha(output)}, input_hash = ${inputHash},
        error = null, approved = false, run_ms = ${Date.now() - started}, updated_at = now() where id = ${nodeId}`;
      if (node.type === 'outline') await reconcileEpisodes(tx, org.orgId, dramaId, output as OutlineOutput);
      if (node.type === 'breakdown') await reconcileAssets(tx, org.orgId, dramaId, output as BreakdownOutput);
    });
    return 'done';
  } catch (error) {
    const msg = ctrl.signal.aborted && !(error instanceof NeedUpstream) ? '已取消' : errorMessage(error);
    if (!(error instanceof NeedUpstream) && !ctrl.signal.aborted) console.error('[短剧] 节点运行失败', nodeId, error);
    await withTenant(org.orgId, (tx) => tx`update drama_nodes set status = 'failed', error = ${msg.slice(0, 500)}, run_ms = ${Date.now() - started}, updated_at = now() where id = ${nodeId}`).catch(() => {});
    return 'failed';
  } finally {
    running.delete(nodeId);
    orgBusy.set(org.orgId, Math.max(0, (orgBusy.get(org.orgId) ?? 1) - 1));
    notifyDrama(org.orgId, dramaId);
  }
}

const needsRun = (s: State, n: NodeRow | undefined) => !!n && (n.status !== 'done' || isStale(s, n));

/** 一键运行：按依赖顺序补齐所有没跑过或已过期的节点；某集失败不影响其他集。 */
async function runAll(org: OrgContext, dramaId: string, batch: { cancelled: boolean }) {
  const reload = () => withTenant(org.orgId, (tx) => loadState(tx, dramaId));
  const ctrl = new AbortController();
  const timer = setInterval(() => batch.cancelled && ctrl.abort(), 500);
  try {
    for (const type of ['breakdown', 'outline'] as const) {
      if (batch.cancelled) return;
      const s = await reload();
      const n = find(s, type);
      if (needsRun(s, n) && (await runNode(org, dramaId, n!.id, ctrl.signal)) === 'failed') return;
    }
    const s0 = await reload();
    const eps = arr<OutlineEpisode>(find(s0, 'outline')?.output?.episodes).map((e) => e.n);
    let next = 0;
    const worker = async () => {
      while (!batch.cancelled && next < eps.length) {
        const n = eps[next++];
        let s = await reload();
        const script = episodeNode(s, 'script', n);
        if (needsRun(s, script) && (await runNode(org, dramaId, script!.id, ctrl.signal)) === 'failed') continue;
        s = await reload();
        const board = episodeNode(s, 'storyboard', n);
        if (!batch.cancelled && needsRun(s, board)) await runNode(org, dramaId, board!.id, ctrl.signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, eps.length) }, worker));
  } finally {
    clearInterval(timer);
    batches.delete(dramaId);
    notifyDrama(org.orgId, dramaId);
  }
}

/** 批量生成角色定妆与场景图。图像要花钱，所以不包含在「一键运行」里，由作者单独放行。 */
async function runMedia(org: OrgContext, dramaId: string, batch: { cancelled: boolean }) {
  const reload = () => withTenant(org.orgId, (tx) => loadState(tx, dramaId));
  const ctrl = new AbortController();
  const timer = setInterval(() => batch.cancelled && ctrl.abort(), 500);
  try {
    const s0 = await reload();
    const ids = s0.nodes.filter((n) => (n.type === 'portrait' || n.type === 'location') && needsRun(s0, n)).map((n) => n.id);
    let next = 0;
    const worker = async () => {
      while (!batch.cancelled && next < ids.length) {
        const id = ids[next++];
        if ((await runNode(org, dramaId, id, ctrl.signal)) === 'failed' && ctrl.signal.aborted) return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, ids.length) }, worker));
  } finally {
    clearInterval(timer);
    batches.delete(dramaId);
    notifyDrama(org.orgId, dramaId);
  }
}

// ─────────────────────────── 导出 ───────────────────────────

function exportMarkdown(title: string, s: State): string {
  const b = find(s, 'breakdown')?.output as BreakdownOutput | undefined;
  const o = find(s, 'outline')?.output as OutlineOutput | undefined;
  const out: string[] = [`# 《${title}》短剧改编`, ''];
  out.push(`- 画幅 ${s.preset.ratio} · 每集约 ${s.preset.episodeSeconds} 秒 · 共 ${o?.episodes.length ?? s.preset.episodes} 集`, `- 剧型：${GENRES.find((g) => g.value === s.preset.genre)?.label}${s.preset.style ? ` · ${s.preset.style}` : ''}`, '');
  if (b) {
    out.push('## 故事拆解', '', `**一句话**：${b.logline}`, '', `**主线**：${b.mainPlot}`, '', '### 人物', ...b.characters.map((c) => `- **${c.name}**（${c.role}）：${c.look}｜${c.voice}`), '', '### 场景', ...b.locations.map((l) => `- **${l.name}**：${l.look}`), '');
  }
  for (const ep of o?.episodes ?? []) {
    out.push(`## 第 ${ep.n} 集　${ep.title}`, '', `> 钩子：${ep.hook}`, `> 悬念：${ep.cliffhanger}`, `> 改编自小说第 ${ep.sourceChapters.join('、')} 章`, '');
    const script = episodeNode(s, 'script', ep.n)?.output as ScriptOutput | undefined;
    if (script) {
      out.push('### 剧本', '');
      for (const sc of script.scenes) {
        out.push(`**场 ${sc.n}　${sc.location}　${sc.time}**${sc.source ? `　_（原著第 ${sc.source.chapter} 章：“${sc.source.quote}”）_` : ''}`, '');
        for (const l of sc.lines) out.push(l.type === 'dialogue' ? `- **${l.speaker}**${l.emotion ? `（${l.emotion}）` : ''}：${l.text}` : l.type === 'narration' ? `- 【旁白】${l.text}` : `- △ ${l.text}`);
        out.push('');
      }
    }
    const board = episodeNode(s, 'storyboard', ep.n)?.output as StoryboardOutput | undefined;
    if (board) {
      out.push(`### 分镜（${board.shots.length} 镜 · ${board.totalSeconds} 秒）`, '', '| # | 景别 | 运镜 | 秒 | 画面 | 台词 / 旁白 |', '| --- | --- | --- | --- | --- | --- |');
      for (const sh of board.shots) {
        const say = sh.dialogue ? `${sh.dialogue.speaker}：${sh.dialogue.text}` : sh.narration ? `【旁白】${sh.narration}` : '';
        out.push(`| ${sh.n} | ${sh.size} | ${sh.move} | ${sh.seconds} | ${sh.visual.replace(/\|/g, '/')} | ${say.replace(/\|/g, '/')} |`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}

function csvCell(v: unknown) {
  const t = String(v ?? '');
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function exportCsv(s: State): string {
  const rows = [['集', '镜头', '场景', '景别', '运镜', '秒', '画面描述', '首帧', '尾帧', '说话人', '台词', '情绪', '旁白', '音效']];
  for (const n of s.nodes.filter((x) => x.type === 'storyboard').sort((a, b) => Number(a.params.episode) - Number(b.params.episode))) {
    const board = n.output as StoryboardOutput | null;
    for (const sh of board?.shots ?? []) rows.push([n.params.episode, sh.n, sh.scene, sh.size, sh.move, sh.seconds, sh.visual, sh.firstFrame, sh.lastFrame ?? '', sh.dialogue?.speaker ?? '', sh.dialogue?.text ?? '', sh.dialogue?.emotion ?? '', sh.narration ?? '', sh.sfx ?? ''] as any);
  }
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
}

// ─────────────────────────── 路由 ───────────────────────────

export const dramaRoutes = new Hono<AppEnv>();

async function dramaFor(org: OrgContext, dramaId: string, min: 'viewer' | 'author' | 'editor') {
  if (!isUuid(dramaId)) throw notFound('找不到这张画布');
  const [d] = await withTenant(org.orgId, (tx) => tx<{ novel_id: string }[]>`select novel_id from drama_projects where id = ${dramaId}`);
  if (!d) throw notFound('找不到这张画布');
  const role = roleInProject(org, d.novel_id);
  if (!role) throw forbidden('你没有访问这部作品的权限');
  if (min !== 'viewer' && !atLeast(role, min)) throw forbidden(min === 'author' ? '只读成员不能修改短剧画布' : '需要编辑权限');
  return d.novel_id;
}

async function nodeFor(org: OrgContext, nodeId: string, min: 'viewer' | 'author') {
  if (!isUuid(nodeId)) throw notFound('节点不存在');
  const [n] = await withTenant(org.orgId, (tx) => tx<{ drama_id: string; type: DramaNodeType }[]>`select drama_id, type from drama_nodes where id = ${nodeId}`);
  if (!n) throw notFound('节点不存在');
  await dramaFor(org, n.drama_id, min);
  return n;
}

async function stateDTO(orgId: string, dramaId: string) {
  return toDTO(await withTenant(orgId, (tx) => loadState(tx, dramaId)));
}

dramaRoutes.get('/by-novel/:novelId', async (c) => {
  const org = await requireOrg(c);
  const novelId = c.req.param('novelId');
  if (!roleInProject(org, novelId)) throw forbidden('你没有访问这部作品的权限');
  const [d] = await withTenant(org.orgId, (tx) => tx<{ id: string }[]>`select id from drama_projects where novel_id = ${novelId}`);
  return c.json({ project: d ? await stateDTO(org.orgId, d.id) : null });
});

dramaRoutes.post('/by-novel/:novelId', async (c) => {
  const org = await requireOrg(c);
  const novelId = c.req.param('novelId');
  if (!atLeast(roleInProject(org, novelId), 'author')) throw forbidden('只读成员不能创建短剧画布');
  limit(`drama:create:${org.user.id}`, 30, 3600_000);
  const body = await readJson<{ preset?: Partial<DramaPreset> }>(c);
  const id = await withTenant(org.orgId, async (tx) => {
    const [existing] = await tx<{ id: string }[]>`select id from drama_projects where novel_id = ${novelId}`;
    if (existing) return existing.id;
    const meta = await loadNovelMeta(tx, novelId);
    const chapters = await loadChapterRows(tx, novelId);
    if (!chapters.length) throw badRequest('这部小说还没有章节，先写几章再来改编');
    const base: DramaPreset = { ...DEFAULT_PRESET, chapterTo: chapters.length, episodes: Math.min(40, Math.max(8, chapters.length * 2)) };
    const preset = sanitizePreset(body.preset, chapters.length, base);
    const [d] = await tx<{ id: string }[]>`insert into drama_projects (org_id, novel_id, preset, created_by) values (${org.orgId}, ${novelId}, ${tx.json(preset as any)}, ${org.user.id}) returning id`;
    const src = await insertNode(tx, org.orgId, d.id, 'source', meta.title || '小说', COL.source, 0);
    const bd = await insertNode(tx, org.orgId, d.id, 'breakdown', NODE_LABEL.breakdown.title, COL.breakdown, 0);
    const ol = await insertNode(tx, org.orgId, d.id, 'outline', NODE_LABEL.outline.title, COL.outline, 0);
    await link(tx, org.orgId, d.id, src, bd);
    await link(tx, org.orgId, d.id, bd, ol);
    return d.id;
  });
  return c.json({ project: await stateDTO(org.orgId, id) });
});

dramaRoutes.get('/:id', async (c) => {
  const org = await requireOrg(c);
  await dramaFor(org, c.req.param('id'), 'viewer');
  return c.json({ project: await stateDTO(org.orgId, c.req.param('id')) });
});

dramaRoutes.patch('/:id', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  await dramaFor(org, id, 'author');
  const body = await readJson<{ preset?: Partial<DramaPreset> }>(c);
  await withTenant(org.orgId, async (tx) => {
    const s = await loadState(tx, id);
    const preset = sanitizePreset(body.preset, s.chapters.length, s.preset);
    await tx`update drama_projects set preset = ${tx.json(preset as any)}, updated_at = now() where id = ${id}`;
  });
  notifyDrama(org.orgId, id);
  return c.json({ project: await stateDTO(org.orgId, id) });
});

dramaRoutes.put('/:id/layout', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  await dramaFor(org, id, 'author');
  const body = await readJson<{ positions?: { id: string; x: number; y: number }[] }>(c);
  const list = arr<{ id: string; x: number; y: number }>(body.positions).slice(0, 500).filter((p) => isUuid(p.id) && Number.isFinite(p.x) && Number.isFinite(p.y));
  await withTenant(org.orgId, async (tx) => {
    for (const p of list) await tx`update drama_nodes set x = ${p.x}, y = ${p.y} where id = ${p.id} and drama_id = ${id}`;
  });
  return c.json({ ok: true });
});

dramaRoutes.delete('/:id', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  await dramaFor(org, id, 'editor');
  await withTenant(org.orgId, async (tx) => {
    for (const n of await tx<{ id: string }[]>`select id from drama_nodes where drama_id = ${id}`) running.get(n.id)?.abort();
    await deleteAssets(tx, { dramaId: id });
    await tx`delete from drama_projects where id = ${id}`;
  });
  const b = batches.get(id);
  if (b) b.cancelled = true;
  return c.json({ ok: true });
});

dramaRoutes.post('/:id/run-all', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  await dramaFor(org, id, 'author');
  if (batches.has(id)) throw conflict('这张画布正在批量运行', 'busy');
  limit(`drama:run:${org.user.id}`, 60, 3600_000, '运行太频繁，请稍后再试');
  const batch = { cancelled: false };
  batches.set(id, batch);
  void runAll(org, id, batch).catch((e) => console.error('[短剧] 批量运行出错', e));
  return c.json({ started: true }, 202);
});

dramaRoutes.post('/:id/run-media', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  await dramaFor(org, id, 'author');
  if (batches.has(id)) throw conflict('这张画布正在批量运行', 'busy');
  limit(`drama:media:${org.user.id}`, 20, 3600_000, '运行太频繁，请稍后再试');
  const batch = { cancelled: false };
  batches.set(id, batch);
  void runMedia(org, id, batch).catch((e) => console.error('[短剧] 批量生图出错', e));
  return c.json({ started: true }, 202);
});

dramaRoutes.post('/:id/cancel', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  await dramaFor(org, id, 'author');
  const b = batches.get(id);
  if (b) b.cancelled = true;
  const nodes = await withTenant(org.orgId, (tx) => tx<{ id: string }[]>`select id from drama_nodes where drama_id = ${id} and status = 'running'`);
  for (const n of nodes) {
    const ctrl = running.get(n.id);
    if (ctrl) ctrl.abort();
    else await withTenant(org.orgId, (tx) => tx`update drama_nodes set status = 'failed', error = '已取消' where id = ${n.id}`);
  }
  notifyDrama(org.orgId, id);
  return c.json({ ok: true });
});

dramaRoutes.post('/nodes/:nodeId/run', async (c) => {
  const org = await requireOrg(c);
  const node = await nodeFor(org, c.req.param('nodeId'), 'author');
  if (node.type === 'source') throw badRequest('这个节点不需要运行');
  if (running.has(c.req.param('nodeId'))) throw conflict('这个节点正在运行', 'busy');
  if ((orgBusy.get(org.orgId) ?? 0) >= MAX_RUNNING_PER_ORG) throw new HttpError(429, 'busy', `团队同时运行的节点已达 ${MAX_RUNNING_PER_ORG} 个，请稍后再试`);
  limit(`drama:run:${org.user.id}`, 60, 3600_000, '运行太频繁，请稍后再试');
  void runNode(org, node.drama_id, c.req.param('nodeId')).catch((e) => console.error('[短剧] 运行出错', e));
  return c.json({ started: true }, 202);
});

dramaRoutes.post('/nodes/:nodeId/cancel', async (c) => {
  const org = await requireOrg(c);
  const node = await nodeFor(org, c.req.param('nodeId'), 'author');
  const ctrl = running.get(c.req.param('nodeId'));
  if (ctrl) ctrl.abort();
  else {
    await withTenant(org.orgId, (tx) => tx`update drama_nodes set status = 'failed', error = '已取消' where id = ${c.req.param('nodeId')} and status = 'running'`);
    notifyDrama(org.orgId, node.drama_id);
  }
  return c.json({ ok: true });
});

/** 作者手动修改节点的输出（例如改一句台词）或标记通过。改动会让下游节点变为「已过期」。 */
dramaRoutes.patch('/nodes/:nodeId', async (c) => {
  const org = await requireOrg(c);
  const nodeId = c.req.param('nodeId');
  const node = await nodeFor(org, nodeId, 'author');
  const body = await readJson<{ output?: unknown; approved?: boolean; params?: { prompt?: string } }>(c);
  await withTenant(org.orgId, async (tx) => {
    const [row] = await tx<NodeRow[]>`select * from drama_nodes where id = ${nodeId} for update`;
    if (row.status === 'running') throw conflict('节点正在运行，请稍后再改', 'busy');
    if (body.output !== undefined) {
      if (row.status !== 'done') throw badRequest('节点还没有结果');
      const episode = Number(row.params.episode);
      let out: unknown;
      if (row.type === 'breakdown') out = normBreakdown(body.output);
      else if (row.type === 'outline') {
        out = { episodes: arr<Row>((body.output as Row)?.episodes).map((e, i) => normEpisode(e, i + 1)).map((e, i) => ({ ...e, n: i + 1 })) } satisfies OutlineOutput;
      } else if (row.type === 'script') out = normScript(body.output, episode);
      else if (row.type === 'storyboard') out = normStoryboard(body.output, episode);
      else throw badRequest('图像节点请通过「提示词」修改后重新生成');
      // 改的是内容，不是重新生成：保持 input_hash，让它不显示过期；output_hash 变了，下游自然过期
      await tx`update drama_nodes set output = ${tx.json(out as any)}, output_hash = ${sha(out)}, approved = false, updated_at = now() where id = ${nodeId}`;
      if (row.type === 'outline') await reconcileEpisodes(tx, org.orgId, node.drama_id, out as OutlineOutput);
      if (row.type === 'breakdown') await reconcileAssets(tx, org.orgId, node.drama_id, out as BreakdownOutput);
    }
    if (body.params && (row.type === 'portrait' || row.type === 'location')) {
      const prompt = str(body.params.prompt, 2000);
      await tx`update drama_nodes set params = ${tx.json({ ...row.params, prompt: prompt || undefined } as any)}, updated_at = now() where id = ${nodeId}`;
    }
    if (typeof body.approved === 'boolean') await tx`update drama_nodes set approved = ${body.approved}, updated_at = now() where id = ${nodeId}`;
  });
  notifyDrama(org.orgId, node.drama_id);
  return c.json({ project: await stateDTO(org.orgId, node.drama_id) });
});

dramaRoutes.get('/:id/export', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  const novelId = await dramaFor(org, id, 'viewer');
  const format = c.req.query('format') === 'csv' ? 'csv' : 'md';
  const { s, meta } = await withTenant(org.orgId, async (tx) => ({ s: await loadState(tx, id), meta: await loadNovelMeta(tx, novelId) }));
  const safe = (meta.title || '短剧').replace(/[\\/:*?"<>|]/g, '_');
  return c.json(format === 'csv' ? { filename: `${safe}-分镜表.csv`, mime: 'text/csv;charset=utf-8', content: exportCsv(s) } : { filename: `${safe}-短剧剧本.md`, mime: 'text/markdown;charset=utf-8', content: exportMarkdown(meta.title || '短剧', s) });
});

/** 服务重启后，把上次遗留的「运行中」节点标记为中断。 */
export async function recoverDrama() {
  // 租户表有行级安全：需要逐个团队在其租户上下文里更新
  const orgs = await sql<{ id: string }[]>`select distinct org_id as id from drama_projects`.catch(() => []);
  for (const o of orgs) {
    await withTenant(o.id, (tx) => tx`update drama_nodes set status = 'failed', error = '服务重启，已中断，请重新运行' where status = 'running'`).catch(() => {});
  }
}
