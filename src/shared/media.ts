/**
 * 媒体模型（图像 / 视频 / 配音）的「声明式适配」：
 * 不为每家厂商写一套代码，而是用一份 JSON 描述「怎么调用」——怎么认证、怎么提交任务、怎么轮询、
 * 结果在响应的哪里。服务端有一个通用执行器读这份声明去调用，所以接入新厂商只需要填写声明。
 *
 * 请求模板里可用的变量（与厂商无关）：
 *   {{prompt}} {{negative}} {{model}} {{ratio}} {{size}} {{duration}} {{seed}}
 *   {{first_frame}} {{last_frame}} {{text}} {{voice}} {{emotion}} {{task_id}}
 * 整个字符串恰好是一个变量时，会替换成原始类型（数字仍是数字）；值不存在时，该字段会被省略。
 * 响应里的取值用路径表达，例如 data[0].url、output.task_status。
 */

export type MediaKind = 'image' | 'video' | 'tts';

export type AuthSpec =
  | { type: 'none' }
  | { type: 'bearer' }
  | { type: 'header'; name: string; prefix?: string }
  | { type: 'query'; name: string }
  | { type: 'basic' }
  /** 访问密钥 + 签名密钥生成 JWT（HS256），iss 为访问密钥 */
  | { type: 'jwt-hs256'; ttlSec?: number };

export interface SubmitSpec {
  method?: 'POST' | 'GET';
  path: string;
  body?: unknown;
  bodyType?: 'json' | 'form';
  response: {
    /** 异步任务：提交后返回任务号，需要轮询 */
    taskId?: string;
    /** 同步：响应里直接带结果的地址 / base64 */
    resultUrl?: string;
    resultB64?: string;
    error?: string;
  };
}

export interface PollSpec {
  method?: 'GET' | 'POST';
  /** 可包含 {{task_id}} */
  path: string;
  body?: unknown;
  intervalSec?: number;
  timeoutSec?: number;
  statusPath: string;
  running?: string[];
  success: string[];
  failed: string[];
  resultUrl: string;
  error?: string;
}

export interface Capabilities {
  modes?: ('t2v' | 'i2v' | 'first-last' | 'ref-images' | 't2i' | 'i2i' | 'tts')[];
  durations?: number[];
  ratios?: string[];
  maxPromptChars?: number;
  audio?: 'native' | 'none';
}

export interface ProviderSpec {
  kind: MediaKind;
  baseUrl: string;
  auth: AuthSpec;
  headers?: Record<string, string>;
  model?: string;
  capabilities?: Capabilities;
  submit: SubmitSpec;
  poll?: PollSpec;
  /** 放行前估价用 */
  cost?: { unit: 'call' | 'second'; price: number; currency?: string };
}

export interface ProviderInfo {
  id: string;
  kind: MediaKind;
  name: string;
  spec: ProviderSpec;
  keyHint: string;
  hasSecret: boolean;
  createdAt: string;
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
  /** 每种用途当前使用的服务 id */
  assigned: Record<MediaKind, string | null>;
}

export const KIND_LABEL: Record<MediaKind, { label: string; hint: string }> = {
  image: { label: '图像', hint: '角色定妆照、场景概念图、首帧图' },
  video: { label: '视频', hint: '把分镜生成视频镜头' },
  tts: { label: '配音', hint: '角色台词与旁白' },
};

export interface GenInput {
  prompt: string;
  negative?: string;
  ratio?: string;
  size?: string;
  duration?: number;
  seed?: number;
  firstFrame?: string;
  lastFrame?: string;
  text?: string;
  voice?: string;
  emotion?: string;
}

export interface MediaAssetDTO {
  id: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  createdAt: string;
}

/** 内置预设：选一个、填 Key 就能用。其余厂商用「空白模板」按其官方文档填写。 */
export interface ProviderPreset {
  id: string;
  label: string;
  hint: string;
  name: string;
  secretLabel?: string;
  spec: ProviderSpec;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'openai-image',
    label: 'OpenAI 兼容 · 图像',
    hint: '遵循 /images/generations 的服务（OpenAI 以及许多兼容服务）。地址与模型名按你的服务商改。',
    name: '图像模型',
    spec: {
      kind: 'image',
      baseUrl: 'https://api.openai.com/v1',
      auth: { type: 'bearer' },
      model: 'gpt-image-1',
      capabilities: { modes: ['t2i'], ratios: ['1:1', '9:16', '16:9'], maxPromptChars: 4000, audio: 'none' },
      submit: {
        method: 'POST',
        path: '/images/generations',
        body: { model: '{{model}}', prompt: '{{prompt}}', size: '{{size}}', n: 1 },
        response: { resultB64: 'data[0].b64_json', resultUrl: 'data[0].url', error: 'error.message' },
      },
    },
  },
  {
    id: 'blank-async-video',
    label: '空白模板 · 异步视频',
    hint: '「提交任务 → 轮询状态 → 取结果」型接口的骨架。按厂商官方文档改写地址、请求体与响应路径，再用「试一条」验证。',
    name: '视频模型',
    secretLabel: '签名密钥（仅 JWT 认证需要）',
    spec: {
      kind: 'video',
      baseUrl: 'https://api.example.com',
      auth: { type: 'bearer' },
      model: 'your-video-model',
      capabilities: { modes: ['t2v', 'i2v'], durations: [5, 10], ratios: ['9:16', '16:9'], maxPromptChars: 2000, audio: 'none' },
      submit: {
        method: 'POST',
        path: '/v1/videos',
        body: { model: '{{model}}', prompt: '{{prompt}}', image: '{{first_frame}}', duration: '{{duration}}', aspect_ratio: '{{ratio}}' },
        response: { taskId: 'data.task_id', error: 'message' },
      },
      poll: {
        method: 'GET',
        path: '/v1/videos/{{task_id}}',
        intervalSec: 5,
        timeoutSec: 600,
        statusPath: 'data.status',
        running: ['queued', 'processing', 'running'],
        success: ['succeeded', 'completed'],
        failed: ['failed', 'error'],
        resultUrl: 'data.video_url',
        error: 'data.error',
      },
    },
  },
  {
    id: 'blank-tts',
    label: '空白模板 · 配音',
    hint: '同步返回音频地址或 base64 的语音合成接口骨架。',
    name: '配音模型',
    spec: {
      kind: 'tts',
      baseUrl: 'https://api.example.com',
      auth: { type: 'bearer' },
      model: 'your-tts-model',
      submit: {
        method: 'POST',
        path: '/v1/tts',
        body: { model: '{{model}}', text: '{{text}}', voice: '{{voice}}', emotion: '{{emotion}}' },
        response: { resultUrl: 'data.audio_url', resultB64: 'data.audio_base64', error: 'message' },
      },
    },
  },
];
