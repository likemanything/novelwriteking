/**
 * 模型服务商调用（浏览器与服务端通用，服务端的 AI 网关和协议识别使用它）。
 *
 * - openai：任何兼容 Chat Completions 的服务（DeepSeek、通义、Kimi、OpenRouter、Ollama…）
 * - anthropic：Claude Messages API
 *
 * 请求函数由调用方注入：服务端传入带“禁止访问内网”检查的 fetch。
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderProfile {
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface FetchInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** 与标准 fetch 兼容的最小接口 */
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** 服务商没有返回用量时为 true，数字由字数估算 */
  estimated: boolean;
}

export class AIError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AIError';
    this.status = status;
  }
}

function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, '') + path;
}

export async function rawRequest(fetchImpl: FetchLike, url: string, init: FetchInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, body: init.method === 'GET' ? undefined : init.body });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    const cause = error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : String(error);
    throw new AIError(`无法连接模型服务：${cause}`, 502);
  }
}

export async function toError(res: Response): Promise<AIError> {
  let detail = '';
  try {
    const raw = await res.text();
    try {
      const j = JSON.parse(raw);
      detail = j.error?.message ?? j.message ?? raw;
    } catch {
      detail = raw;
    }
  } catch {
    /* ignore */
  }
  detail = String(detail).slice(0, 240);
  const hint: Record<number, string> = {
    400: '请求被拒绝，检查模型名与参数',
    401: 'API Key 无效或缺失',
    403: '没有访问该模型的权限',
    404: '接口地址或模型名不正确',
    429: '请求过于频繁或额度不足',
    500: '模型服务内部错误',
    502: '模型服务暂不可用',
    503: '模型服务繁忙',
  };
  return new AIError(`${hint[res.status] ?? `请求失败（${res.status}）`}${detail ? `：${detail}` : ''}`, res.status);
}

export interface ProviderCall {
  profile: ProviderProfile;
  system: string;
  messages: ChatMessage[];
  fetch: FetchLike;
  signal?: AbortSignal;
  onToken?: (chunk: string, full: string) => void;
  temperature?: number;
  maxTokens?: number;
}

/** 调用模型并流式读取结果，返回完整文本与用量。 */
export async function callProvider(o: ProviderCall): Promise<{ text: string; usage: Usage }> {
  const p = o.profile;
  const temperature = o.temperature ?? p.temperature;
  const max_tokens = o.maxTokens ?? p.maxTokens;
  let url: string;
  let headers: Record<string, string>;
  let body: unknown;

  if (p.provider === 'anthropic') {
    url = joinUrl(p.baseUrl.replace(/\/v1\/?$/, ''), '/v1/messages');
    headers = { 'content-type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' };
    body = { model: p.model, system: o.system, messages: o.messages, max_tokens, temperature, stream: true };
  } else {
    url = joinUrl(p.baseUrl, '/chat/completions');
    headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
    body = { model: p.model, messages: [{ role: 'system', content: o.system }, ...o.messages], temperature, max_tokens, stream: true };
  }

  const res = await rawRequest(o.fetch, url, { method: 'POST', headers, body: JSON.stringify(body), signal: o.signal });
  if (!res.ok) throw await toError(res);
  const type = res.headers.get('content-type') ?? '';
  const inputChars = o.system + o.messages.map((m) => m.content).join('');

  // 部分服务在不支持流式时直接返回 JSON
  if (!type.includes('event-stream') && type.includes('json')) {
    const data = (await res.json()) as any;
    const text: string = p.provider === 'anthropic' ? (data.content ?? []).map((b: { text?: string }) => b.text ?? '').join('') : (data.choices?.[0]?.message?.content ?? '');
    o.onToken?.(text, text);
    const u = data.usage;
    const usage = u
      ? { inputTokens: u.prompt_tokens ?? u.input_tokens ?? 0, outputTokens: u.completion_tokens ?? u.output_tokens ?? 0, estimated: false }
      : { inputTokens: estimateTokens(inputChars), outputTokens: estimateTokens(text), estimated: true };
    if (!text.trim()) throw new AIError('模型返回了空内容');
    return { text, usage };
  }
  return readSSE(res, o, inputChars);
}

async function readSSE(res: Response, o: ProviderCall, inputChars: string): Promise<{ text: string; usage: Usage }> {
  if (!res.body) throw new AIError('模型没有返回内容');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let input: number | null = null;
  let output: number | null = null;
  const anthropic = o.profile.provider === 'anthropic';

  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.error) throw new AIError(json.error.message ?? '模型返回错误');
    let chunk = '';
    if (anthropic) {
      if (json.type === 'content_block_delta') chunk = json.delta?.text ?? '';
      if (json.type === 'message_start' && json.message?.usage) input = json.message.usage.input_tokens ?? input;
      if (json.type === 'message_delta' && json.usage) output = json.usage.output_tokens ?? output;
    } else {
      // 深度思考模型的 reasoning_content 不计入正文
      chunk = json.choices?.[0]?.delta?.content ?? '';
      if (json.usage) {
        input = json.usage.prompt_tokens ?? input;
        output = json.usage.completion_tokens ?? output;
      }
    }
    if (chunk) {
      full += chunk;
      o.onToken?.(chunk, full);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  if (buffer) handle(buffer);
  if (!full.trim()) throw new AIError('模型返回了空内容');
  const usage: Usage =
    input !== null || output !== null
      ? { inputTokens: input ?? estimateTokens(inputChars), outputTokens: output ?? estimateTokens(full), estimated: input === null || output === null }
      : { inputTokens: estimateTokens(inputChars), outputTokens: estimateTokens(full), estimated: true };
  return { text: full, usage };
}

/** 连接测试：发一个极短的请求。 */
export async function testProvider(profile: ProviderProfile, fetchImpl: FetchLike, signal?: AbortSignal): Promise<string> {
  const { text } = await callProvider({
    profile: { ...profile, temperature: 0, maxTokens: 256 },
    system: '你是连接测试助手。',
    messages: [{ role: 'user', content: '请只回复两个字：你好' }],
    fetch: fetchImpl,
    signal,
  });
  return text.trim().slice(0, 40);
}

/** 粗略 token 估算：CJK ≈ 1 字 / token，其它 ≈ 4 字符 / token。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g)?.length ?? 0;
  return Math.ceil(cjk * 1.05 + (text.length - cjk) / 4);
}
