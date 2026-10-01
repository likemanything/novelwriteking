/**
 * 通用接入：填一个地址和一把 Key，自动识别协议并连上。
 *
 * 1. 规范地址：补全协议头，去掉用户误粘的 /chat/completions、/v1/messages 等后缀；
 * 2. 识别协议：依次探测 OpenAI 兼容（GET /models）、Anthropic（GET /v1/models）、
 *    Ollama 原生（GET /api/tags），并根据域名与 Key 前缀调整探测顺序；
 * 3. 读取模型列表：过滤掉向量、语音、图像等非对话模型，挑一个适合写作的默认模型；
 * 4. 试写一句：真正发一次流式对话，确认整条链路可用。
 *
 * 若服务不提供模型列表，会请作者补一个模型名，再用对话请求逐个试探协议。
 */
import { AIError, rawRequest, testProvider, type FetchLike, type ProviderProfile } from './providers';

export type DetectStep = 'normalize' | 'protocol' | 'models' | 'reply';
export type StepState = 'idle' | 'active' | 'done' | 'warn' | 'error';

export const DETECT_STEPS: { id: DetectStep; label: string }[] = [
  { id: 'normalize', label: '规范地址' },
  { id: 'protocol', label: '识别协议' },
  { id: 'models', label: '读取模型' },
  { id: 'reply', label: '试写一句' },
];

export interface DetectResult {
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  protocolLabel: string;
  name: string;
  models: string[];
  model: string;
  reply?: string;
  warning?: string;
}

export class DetectError extends Error {
  constructor(
    message: string,
    public step: DetectStep,
    public code: 'invalid-url' | 'unreachable' | 'auth' | 'need-model' | 'no-protocol' | 'reply' = 'no-protocol',
  ) {
    super(message);
    this.name = 'DetectError';
  }
}

const PROBE_TIMEOUT = 9000;

// ─────────────────────────── 地址 ───────────────────────────

const ENDPOINT_SUFFIX = /\/(chat\/completions|completions|v1\/messages|messages|models|api\/tags|api\/chat|api\/generate)\/?$/i;

export function normalizeUrl(input: string): string {
  let s = input.trim().replace(/\s+/g, '');
  if (!s) throw new DetectError('请填写接口地址', 'normalize', 'invalid-url');
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|\[?::1)/i.test(s) ? 'http://' : 'https://') + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new DetectError('这不是一个有效的网址', 'normalize', 'invalid-url');
  }
  let path = u.pathname.replace(/\/+$/, '');
  while (ENDPOINT_SUFFIX.test(path)) path = path.replace(ENDPOINT_SUFFIX, '').replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

const NAMES: [RegExp, string][] = [
  [/deepseek/, 'DeepSeek'],
  [/anthropic/, 'Claude'],
  [/openai\.com/, 'OpenAI'],
  [/openrouter/, 'OpenRouter'],
  [/moonshot|kimi/, 'Kimi'],
  [/dashscope|aliyuncs/, '通义千问'],
  [/bigmodel|zhipu/, '智谱 GLM'],
  [/siliconflow/, '硅基流动'],
  [/volces|ark\./, '火山方舟'],
  [/googleapis|gemini/, 'Gemini'],
  [/minimax/, 'MiniMax'],
  [/x\.ai/, 'xAI'],
  [/groq/, 'Groq'],
  [/mistral/, 'Mistral'],
  [/hunyuan|tencent/, '腾讯混元'],
  [/baidu|qianfan/, '百度千帆'],
  [/:11434/, 'Ollama 本地'],
  [/:1234/, 'LM Studio'],
];

export function friendlyName(url: string, via?: 'ollama'): string {
  const s = url.toLowerCase();
  for (const [re, name] of NAMES) if (re.test(s)) return name;
  if (via === 'ollama') return 'Ollama 本地';
  try {
    const u = new URL(url);
    if (/^(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|\[::1\])/.test(u.hostname)) return `本地模型 :${u.port || (u.protocol === 'https:' ? 443 : 80)}`;
    return u.hostname.replace(/^(api|www)\./, '');
  } catch {
    return '自定义模型';
  }
}

// ─────────────────────────── 模型 ───────────────────────────

const NON_CHAT = /embed|whisper|tts|audio|speech|dall-?e|image|moderation|rerank|transcri|realtime|ocr|bge|clip|sora|davinci|babbage/i;

/** 写作场景的默认偏好：均衡的旗舰 > 快速版；同一族里取别名（最短的 id）。 */
const PREFERENCE = [
  /^deepseek-(flash|chat)$/i,
  /deepseek-v\d/i,
  /deepseek/i,
  /claude.*sonnet/i,
  /claude/i,
  /^gpt-5(\.\d)?$/i,
  /gpt-5/i,
  /gpt-4\.1|gpt-4o/i,
  /qwen-(plus|max)|qwen3/i,
  /kimi|moonshot/i,
  /glm-4/i,
  /gemini.*pro/i,
  /gemini/i,
  /qwen|llama|mistral|yi-|baichuan/i,
];

export function chatModels(models: string[]): string[] {
  return [...new Set(models)].filter((m) => !NON_CHAT.test(m)).sort((a, b) => a.localeCompare(b));
}

export function pickModel(models: string[]): string {
  const list = chatModels(models);
  for (const re of PREFERENCE) {
    const hits = list.filter((m) => re.test(m));
    if (hits.length) return hits.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }
  return list[0] ?? models[0] ?? '';
}

// ─────────────────────────── 探测 ───────────────────────────

interface Candidate {
  kind: 'openai' | 'anthropic' | 'ollama';
  base: string; // 用于对话请求的 baseUrl
}

function candidates(url: string, key: string): Candidate[] {
  const u = new URL(url);
  const path = u.pathname;
  const host = u.host.toLowerCase();
  const versioned = /\/v\d+[a-z0-9]*$|\/openai$|\/compatible-mode\/v1$|\/api\/v\d+$/i.test(path);
  const anthropicHint = /anthropic/i.test(host + path) || key.startsWith('sk-ant-');
  const geminiHint = host.includes('generativelanguage.googleapis.com') || key.startsWith('AIza');

  const openai: Candidate[] = [];
  if (geminiHint && !/openai/.test(path)) openai.push({ kind: 'openai', base: `${u.origin}/v1beta/openai` });
  if (versioned) openai.push({ kind: 'openai', base: url });
  else openai.push({ kind: 'openai', base: `${url}/v1` }, { kind: 'openai', base: url });

  const anthropic: Candidate = { kind: 'anthropic', base: url.replace(/\/v1$/i, '') };
  const ollama: Candidate[] = host.endsWith(':11434') || !key ? [{ kind: 'ollama', base: u.origin }] : [];

  return anthropicHint ? [anthropic, ...openai, ...ollama] : [...openai, anthropic, ...ollama];
}

type ProbeOutcome =
  | { ok: true; provider: 'openai' | 'anthropic'; baseUrl: string; models: string[]; via?: 'ollama' }
  | { ok: false; status: number; message: string; unreachable?: boolean };

function headersFor(kind: Candidate['kind'], key: string): Record<string, string> {
  if (kind === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01', accept: 'application/json' };
  return key ? { authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' };
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text.slice(0, 200) };
  }
}

function errorMessage(j: any): string {
  return String(j?.error?.message ?? j?.error ?? j?.message ?? j?.__raw ?? '').slice(0, 200);
}

async function probe(c: Candidate, key: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<ProbeOutcome> {
  const url = c.kind === 'anthropic' ? `${c.base}/v1/models` : c.kind === 'ollama' ? `${c.base}/api/tags` : `${c.base}/models`;
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await rawRequest(fetchImpl, url, { method: 'GET', headers: headersFor(c.kind, key), signal: merged });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) return { ok: false, status: 0, message: '响应超时', unreachable: true };
    // 连接被拒、域名不存在、被安全策略拦截等
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 502, message, unreachable: true };
  }
  const type = res.headers.get('content-type') ?? '';
  const j = await readJson(res);
  if (res.status === 502 && /无法连接模型服务/.test(errorMessage(j))) return { ok: false, status: 502, message: errorMessage(j), unreachable: true };
  if (!res.ok) return { ok: false, status: res.status, message: errorMessage(j) };
  if (type.includes('html')) return { ok: false, status: 200, message: '返回的是网页而不是接口' };

  if (c.kind === 'ollama' && Array.isArray(j.models)) {
    return { ok: true, provider: 'openai', baseUrl: `${c.base}/v1`, via: 'ollama', models: j.models.map((m: any) => String(m.name ?? m.model)).filter(Boolean) };
  }
  const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : null;
  if (!list) return { ok: false, status: 200, message: '返回格式不像模型列表' };
  const models = list.map((m: any) => String(typeof m === 'string' ? m : (m.id ?? m.name ?? '')).replace(/^models\//, '')).filter(Boolean);
  if (c.kind === 'anthropic') {
    // OpenAI 兼容服务也可能响应 /v1/models：只有 Anthropic 的列表项带 type: "model"
    const looksAnthropic = list.some((m: any) => m?.type === 'model') || /anthropic|claude/i.test(c.base);
    if (!looksAnthropic) return { ok: false, status: 200, message: '不是 Anthropic 格式' };
    return { ok: true, provider: 'anthropic', baseUrl: c.base, models };
  }
  return { ok: true, provider: 'openai', baseUrl: c.base, models };
}

function profileOf(r: Pick<DetectResult, 'provider' | 'baseUrl' | 'model'>, key: string): ProviderProfile {
  return { provider: r.provider, baseUrl: r.baseUrl, apiKey: key, model: r.model, temperature: 0, maxTokens: 256 };
}

const LABEL = { openai: 'OpenAI 兼容', anthropic: 'Anthropic' } as const;

export interface DetectInput {
  url: string;
  key: string;
  model?: string; // 服务不提供模型列表时，由作者手填
  /** 发起请求的函数（服务端传入禁止访问内网的版本） */
  fetch: FetchLike;
  signal?: AbortSignal;
  onStep?: (step: DetectStep, state: StepState, info?: string) => void;
}

export async function detectAndConnect(input: DetectInput): Promise<DetectResult> {
  const key = input.key.trim();
  const step = (s: DetectStep, state: StepState, info?: string) => input.onStep?.(s, state, info);

  step('normalize', 'active');
  const url = normalizeUrl(input.url);
  step('normalize', 'done', url);

  step('protocol', 'active');
  let found: Extract<ProbeOutcome, { ok: true }> | null = null;
  let authFailure: { status: number; message: string; kind: Candidate['kind'] } | null = null;
  const tried = candidates(url, key);
  for (const c of tried) {
    const r = await probe(c, key, input.fetch, input.signal);
    if (r.ok) {
      found = r;
      break;
    }
    if (r.unreachable) {
      const detail = r.message.replace(/^无法连接模型服务：/, '');
      throw new DetectError(r.status === 0 ? '这个地址长时间没有响应，检查网络或地址是否正确' : `连不上这个地址${/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(detail) ? '：服务没有响应，检查地址、端口和网络' : `：${detail}`}`, 'protocol', 'unreachable');
    }
    if ((r.status === 401 || r.status === 403) && !authFailure) authFailure = { ...r, kind: c.kind };
  }

  // 有些服务不开放模型列表：用作者给的模型名，直接发对话请求试探协议
  if (!found && input.model) {
    const model = input.model.trim();
    const chatTries = tried.filter((c) => c.kind !== 'ollama').map((c) => ({ provider: c.kind as 'openai' | 'anthropic', baseUrl: c.base }));
    let lastError = '';
    for (const t of chatTries) {
      step('protocol', 'active', `用对话请求试探 ${LABEL[t.provider]} · ${t.baseUrl}`);
      try {
        const reply = await testProvider(profileOf({ ...t, model }, key), input.fetch, input.signal);
        step('protocol', 'done', `${LABEL[t.provider]} · ${t.baseUrl}`);
        step('models', 'done', `使用 ${model}`);
        step('reply', 'done', `「${reply}」`);
        return { ...t, protocolLabel: LABEL[t.provider], name: friendlyName(url), models: [model], model, reply };
      } catch (error) {
        if (input.signal?.aborted) throw error;
        const status = error instanceof AIError ? error.status : undefined;
        if (status === 401 || status === 403) throw new DetectError(`Key 被拒绝：${(error as Error).message}`, 'protocol', 'auth');
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new DetectError(`用这个模型名也没能连上：${lastError}`, 'protocol', 'no-protocol');
  }

  if (!found) {
    if (authFailure) throw new DetectError(`地址可以访问，但 Key 被拒绝（${authFailure.status}）${authFailure.message ? `：${authFailure.message}` : ''}`, 'protocol', 'auth');
    throw new DetectError('没能自动识别这个服务的协议，它可能不提供模型列表。填一个模型名，墨织会直接用对话请求试探。', 'protocol', 'need-model');
  }
  step('protocol', 'done', `${LABEL[found.provider]} · ${found.baseUrl}`);

  step('models', 'active');
  const models = chatModels(found.models);
  const model = input.model?.trim() || pickModel(found.models);
  if (!model) throw new DetectError('这个服务的模型列表是空的，请填写模型名后重试', 'models', 'need-model');
  step('models', 'done', `${models.length || 1} 个可用模型 · 默认 ${model}`);

  const result: DetectResult = { provider: found.provider, baseUrl: found.baseUrl, protocolLabel: LABEL[found.provider], name: friendlyName(url, found.via), models: models.length ? models : [model], model };

  step('reply', 'active');
  try {
    result.reply = await testProvider(profileOf(result, key), input.fetch, input.signal);
    step('reply', 'done', `「${result.reply}」`);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    // 协议与模型已识别，仍然保存，只提示试写失败的原因（常见：额度不足、模型无权限）
    result.warning = `已识别协议，但试写失败：${error instanceof Error ? error.message : String(error)}`;
    step('reply', 'warn', result.warning);
  }
  return result;
}
