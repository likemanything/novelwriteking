/**
 * 与墨织服务端通信。所有请求带上登录 Cookie 和当前团队（X-Org-Id）。
 * 服务端错误统一是 { error: { code, message } }，这里转成 ApiError，message 可直接展示给用户。
 */

export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

let orgId = '';
let unauthorizedHandler: (() => void) | null = null;

export function setApiOrg(id: string) {
  orgId = id;
}

export function getApiOrg() {
  return orgId;
}

/** 会话失效（被管理员停用、在别处退出等）时的处理。 */
export function onUnauthorized(fn: () => void) {
  unauthorizedHandler = fn;
}

function headers(json: boolean, org: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const o = org === undefined ? orgId : org;
  if (o) h['x-org-id'] = o;
  return h;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = 'http_' + res.status;
  let message = `请求失败（${res.status}）`;
  let data: Record<string, unknown> = {};
  try {
    const j = await res.json();
    if (j?.error) {
      code = j.error.code ?? code;
      message = j.error.message ?? message;
      data = j.error;
    }
  } catch {
    if (res.status === 502 || res.status === 504) message = '服务器暂时无法访问，请稍后重试';
  }
  return new ApiError(res.status, code, message, data);
}

export async function apiFetch(method: string, path: string, body?: unknown, opts: { signal?: AbortSignal; org?: string | null; keepalive?: boolean } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: headers(body !== undefined, opts.org),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
      keepalive: opts.keepalive,
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    throw new ApiError(0, 'network', '网络连接失败，请检查网络后重试');
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (err.status === 401 && !path.startsWith('/api/auth/')) unauthorizedHandler?.();
    throw err;
  }
  return res;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { signal?: AbortSignal; org?: string | null } = {}): Promise<T> {
  const res = await apiFetch(method, path, body, opts);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** 读取逐行 JSON（NDJSON）流，每读到一行调用一次 onEvent。 */
export async function readNdjson<T>(res: Response, onEvent: (ev: T) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as T);
    }
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest) as T);
}
