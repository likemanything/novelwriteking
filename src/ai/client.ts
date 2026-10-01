/**
 * 浏览器端的流式对话：
 * - 演示引擎：本地回放离线生成的内容，不消耗任何额度；
 * - 云端模型：发给墨织服务端的 AI 网关，由服务端解密密钥、调用服务商、记录用量后流式返回。
 */
import { ApiError, apiFetch, readNdjson } from '@/cloud/api';
import type { StageProfile } from '@/cloud/models';
import { sleep } from '@/lib/util';
import type { GatewayEvent, Stage } from '@/shared/api';
import { AIError, type ChatMessage } from './providers';

export { AIError, type ChatMessage };

export interface StreamOptions {
  profile: StageProfile;
  stage: Stage;
  /** 所属作品（服务端据此检查权限并按作品统计用量） */
  projectId?: string;
  system: string;
  messages: ChatMessage[];
  /** 离线演示引擎的输出（仅在使用演示引擎时调用） */
  demo: () => string;
  signal?: AbortSignal;
  onToken?: (chunk: string, full: string) => void;
  temperature?: number;
  maxTokens?: number;
}

export async function streamChat(o: StreamOptions): Promise<string> {
  if (o.profile.provider === 'demo') return playDemo(o);
  let res: Response;
  try {
    res = await apiFetch(
      'POST',
      '/api/ai/chat',
      { stage: o.stage, system: o.system, messages: o.messages, temperature: o.temperature, maxTokens: o.maxTokens, projectId: o.projectId },
      { signal: o.signal },
    );
  } catch (error) {
    if (error instanceof ApiError) throw new AIError(error.message, error.status);
    throw error;
  }
  let full = '';
  let ended = false;
  try {
    await readNdjson<GatewayEvent>(res, (ev) => {
      if (ev.t === 'd') {
        full += ev.v;
        o.onToken?.(ev.v, full);
      } else if (ev.t === 'end') ended = true;
      else if (ev.t === 'err') throw new AIError(ev.message, ev.status);
    });
  } catch (error) {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof AIError) throw error;
    throw new AIError('与服务器的连接中断了，已生成的内容会保留');
  }
  if (!ended) {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new AIError('与服务器的连接中断了，已生成的内容会保留');
  }
  return full;
}

/** 以接近真实模型的节奏回放演示内容。 */
async function playDemo(o: StreamOptions): Promise<string> {
  const text = o.demo();
  await sleep(380, o.signal); // 模拟首字延迟
  const ticks = Math.min(420, Math.max(40, Math.round(text.length / 4)));
  const step = Math.max(1, Math.ceil(text.length / ticks));
  let full = '';
  for (let i = 0; i < text.length; i += step) {
    const chunk = text.slice(i, i + step);
    full += chunk;
    o.onToken?.(chunk, full);
    await sleep(14 + Math.random() * 10, o.signal);
  }
  return full;
}
