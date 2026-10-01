/**
 * 通用媒体适配执行器：读取一份 ProviderSpec，按声明完成「认证 → 提交 → （轮询）→ 取结果」。
 * 不含任何厂商专属代码；模板只做字符串 / JSON 替换，不执行任何用户代码。
 */
import { createHmac } from 'node:crypto';
import type { AuthSpec, Capabilities, GenInput, ProviderSpec } from '@/shared/media';
import type { FetchLike } from '@/ai/providers';

export class MediaError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'MediaError';
  }
}

// ───────── 模板与路径 ─────────

type Vars = Record<string, string | number | undefined>;
const VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([a-z_]+)\s*\}\}$/;

/** 渲染模板：整串恰为一个变量时保持原始类型；变量缺失时省略该字段。 */
export function render(tpl: unknown, vars: Vars): unknown {
  if (typeof tpl === 'string') {
    const whole = tpl.match(WHOLE);
    if (whole) return vars[whole[1]];
    return tpl.replace(VAR, (_m, k) => String(vars[k] ?? ''));
  }
  if (Array.isArray(tpl)) return tpl.map((x) => render(x, vars)).filter((x) => x !== undefined);
  if (tpl && typeof tpl === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tpl)) {
      const r = render(v, vars);
      if (r !== undefined && r !== '') out[k] = r;
    }
    return out;
  }
  return tpl;
}

/** 取值路径：a.b[0].c */
export function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let cur: any = obj;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

const text = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

// ───────── 认证 ─────────

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function jwtHs256(accessKey: string, secret: string, ttlSec = 1800): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: accessKey, exp: now + ttlSec, nbf: now - 5 }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function applyAuth(auth: AuthSpec, key: string, secret: string, url: URL, headers: Record<string, string>) {
  switch (auth.type) {
    case 'bearer':
      if (key) headers.authorization = `Bearer ${key}`;
      break;
    case 'header':
      if (key) headers[auth.name] = `${auth.prefix ?? ''}${key}`;
      break;
    case 'query':
      if (key) url.searchParams.set(auth.name, key);
      break;
    case 'basic':
      headers.authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
      break;
    case 'jwt-hs256':
      headers.authorization = `Bearer ${jwtHs256(key, secret, auth.ttlSec)}`;
      break;
  }
}

// ───────── 能力协商 ─────────

function nearest(values: number[], want: number): number {
  return values.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), values[0]);
}

function ratioValue(r: string): number {
  const [a, b] = r.split(':').map(Number);
  return a && b ? a / b : 1;
}

/** 把中立的镜头参数收敛到这家服务支持的范围内。 */
export function negotiate(cap: Capabilities | undefined, input: GenInput): GenInput {
  const out = { ...input };
  if (cap?.maxPromptChars && out.prompt.length > cap.maxPromptChars) out.prompt = out.prompt.slice(0, cap.maxPromptChars);
  if (cap?.durations?.length && out.duration !== undefined) out.duration = nearest(cap.durations, out.duration);
  if (cap?.ratios?.length && out.ratio && !cap.ratios.includes(out.ratio)) {
    const want = ratioValue(out.ratio);
    out.ratio = cap.ratios.reduce((best, r) => (Math.abs(ratioValue(r) - want) < Math.abs(ratioValue(best) - want) ? r : best), cap.ratios[0]);
  }
  // 没有尾帧能力时，丢掉尾帧（退化为只用首帧）
  if (out.lastFrame && cap?.modes && !cap.modes.includes('first-last')) delete out.lastFrame;
  // 没有图生视频能力时，丢掉首帧（退化为文生视频）
  if (out.firstFrame && cap?.modes && !cap.modes.includes('i2v') && !cap.modes.includes('first-last') && !cap.modes.includes('i2i')) delete out.firstFrame;
  return out;
}

/** 常用画幅对应的像素尺寸（图像接口常用 size 字段） */
export function sizeFor(ratio: string | undefined): string {
  const r = ratio ? ratioValue(ratio) : 1;
  if (r < 0.8) return '1024x1792';
  if (r > 1.25) return '1792x1024';
  return '1024x1024';
}

// ───────── 执行 ─────────

export interface RunOptions {
  spec: ProviderSpec;
  key: string;
  secret: string;
  input: GenInput;
  fetch: FetchLike;
  signal?: AbortSignal;
  onStatus?: (s: string) => void;
}

export interface RunResult {
  /** 结果二进制（同步 base64，或已下载） */
  data: Buffer;
  mime: string;
  /** 厂商返回的地址（用于日志，已下载转存） */
  sourceUrl?: string;
}

const MAX_DOWNLOAD = 300 * 1024 * 1024;

function join(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function call(o: RunOptions, method: 'GET' | 'POST', path: string, body: unknown, bodyType: 'json' | 'form' | undefined, vars: Vars): Promise<unknown> {
  const url = new URL(path.startsWith('http') ? path : join(o.spec.baseUrl, String(render(path, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v === undefined ? undefined : encodeURIComponent(String(v))]))))));
  const headers: Record<string, string> = { accept: 'application/json', ...(o.spec.headers ?? {}) };
  applyAuth(o.spec.auth, o.key, o.secret, url, headers);
  let payload: string | undefined;
  if (body !== undefined && method !== 'GET') {
    const rendered = render(body, vars);
    if (bodyType === 'form') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(Object.entries(rendered as Record<string, unknown>).map(([k, v]) => [k, text(v)])).toString();
    } else {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(rendered);
    }
  }
  const res = await o.fetch(url.toString(), { method, headers, body: payload, signal: o.signal });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { _raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    const msg = getPath(json, o.spec.submit.response.error) ?? getPath(json, 'error.message') ?? getPath(json, 'message') ?? (json as any)?._raw;
    throw new MediaError(`${res.status} ${text(msg) || res.statusText}`.slice(0, 300), res.status);
  }
  return json;
}

async function download(o: RunOptions, url: string): Promise<{ data: Buffer; mime: string }> {
  const res = await o.fetch(url, { method: 'GET', headers: {}, signal: o.signal });
  if (!res.ok) throw new MediaError(`下载结果失败（${res.status}）`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_DOWNLOAD) throw new MediaError('结果文件过大');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new MediaError('结果文件过大');
  const declared = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  // 厂商常把文件标成 octet-stream / 文本：以文件头判断的结果为准
  const sniffed = sniff(buf);
  const mime = sniffed !== 'application/octet-stream' ? sniffed : declared && /^(image|video|audio)\//.test(declared) ? declared : sniffed;
  return { data: buf, mime };
}

/** 根据文件头判断类型（厂商常返回 application/octet-stream） */
export function sniff(b: Buffer): string {
  if (b.length > 12 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.length > 12 && b.slice(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (b.length > 4 && b.slice(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (b.length > 3 && b.slice(0, 3).toString() === 'ID3') return 'audio/mpeg';
  if (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE') return 'audio/wav';
  return 'application/octet-stream';
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Aborted', 'AbortError'))), { once: true });
  });

export async function runGeneration(o: RunOptions): Promise<RunResult> {
  const spec = o.spec;
  const input = negotiate(spec.capabilities, o.input);
  const vars: Vars = {
    prompt: input.prompt,
    negative: input.negative,
    model: spec.model,
    ratio: input.ratio,
    size: input.size ?? sizeFor(input.ratio),
    duration: input.duration,
    seed: input.seed,
    first_frame: input.firstFrame,
    last_frame: input.lastFrame,
    text: input.text,
    voice: input.voice,
    emotion: input.emotion,
  };
  const sub = spec.submit;
  const first = await call(o, sub.method ?? 'POST', sub.path, sub.body, sub.bodyType, vars);
  const r = sub.response;

  const b64 = getPath(first, r.resultB64);
  if (typeof b64 === 'string' && b64) {
    const data = Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64');
    return { data, mime: sniff(data) };
  }
  const direct = getPath(first, r.resultUrl);
  if (typeof direct === 'string' && direct) {
    const d = await download(o, direct);
    return { ...d, sourceUrl: direct };
  }

  const taskId = getPath(first, r.taskId);
  if (taskId === undefined || taskId === null || taskId === '') {
    throw new MediaError(`服务没有返回结果或任务号（请检查适配声明里的响应路径）：${text(first).slice(0, 200)}`);
  }
  const poll = spec.poll;
  if (!poll) throw new MediaError('服务返回了任务号，但适配声明里没有配置轮询（poll）');

  const deadline = Date.now() + (poll.timeoutSec ?? 600) * 1000;
  const interval = Math.max(0.05, poll.intervalSec ?? 5) * 1000;
  const pv: Vars = { ...vars, task_id: String(taskId) };
  for (;;) {
    await sleep(interval, o.signal);
    if (Date.now() > deadline) throw new MediaError('等待生成超时');
    const j = await call(o, poll.method ?? 'GET', poll.path, poll.body, undefined, pv);
    const status = text(getPath(j, poll.statusPath));
    o.onStatus?.(status);
    if (poll.failed.includes(status)) throw new MediaError(`生成失败：${text(getPath(j, poll.error)) || status}`.slice(0, 300));
    if (poll.success.includes(status)) {
      const url = getPath(j, poll.resultUrl);
      if (typeof url !== 'string' || !url) throw new MediaError('任务已完成，但没有找到结果地址（请检查 resultUrl 路径）');
      const d = await download(o, url);
      return { ...d, sourceUrl: url };
    }
    // 状态不在 running 列表里也继续等，但如果声明了 running 且出现未知状态，给出提示
    if (poll.running?.length && !poll.running.includes(status) && status === '') throw new MediaError('轮询响应里没有找到状态（请检查 statusPath）');
  }
}

/** 校验声明的基本结构，给出可读的错误。 */
export function validateSpec(spec: any): string | null {
  if (!spec || typeof spec !== 'object') return '适配声明不是一个对象';
  if (!['image', 'video', 'tts'].includes(spec.kind)) return 'kind 必须是 image / video / tts';
  try {
    const u = new URL(spec.baseUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return 'baseUrl 必须是 http 或 https 地址';
  } catch {
    return 'baseUrl 不是有效的地址';
  }
  if (!spec.auth || !['none', 'bearer', 'header', 'query', 'basic', 'jwt-hs256'].includes(spec.auth.type)) return 'auth.type 无效';
  if ((spec.auth.type === 'header' || spec.auth.type === 'query') && !spec.auth.name) return 'auth.name 不能为空';
  const sub = spec.submit;
  if (!sub || typeof sub.path !== 'string' || !sub.path) return 'submit.path 不能为空';
  if (!sub.response || typeof sub.response !== 'object') return 'submit.response 不能为空';
  const r = sub.response;
  if (!r.taskId && !r.resultUrl && !r.resultB64) return 'submit.response 至少要声明 taskId、resultUrl、resultB64 之一';
  if (r.taskId) {
    const p = spec.poll;
    if (!p || !p.path || !p.statusPath || !Array.isArray(p.success) || !p.success.length || !Array.isArray(p.failed) || !p.resultUrl) {
      return '声明了 taskId（异步任务），需要完整的 poll：path、statusPath、success[]、failed[]、resultUrl';
    }
  }
  if (JSON.stringify(spec).length > 20_000) return '适配声明过大';
  return null;
}
