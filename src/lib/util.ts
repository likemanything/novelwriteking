export function uid(prefix = ''): string {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return prefix + Date.now().toString(36) + rand[0].toString(36) + rand[1].toString(36).slice(0, 4);
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 字数：中日韩字符按字计，拉丁文本按词计。 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  const latin = text.replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9’'-]+/g)?.length ?? 0;
  return cjk + latin;
}

/**
 * 粗略 token 估算：CJK ≈ 1 字 / token，其它 ≈ 4 字符 / token。
 * 只用于上下文透镜的预算展示，不追求与服务商计费完全一致。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g)?.length ?? 0;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.05 + rest / 4);
}

export function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)} 万`;
  return n.toLocaleString('zh-CN');
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** 中文数字章节号：1 → 一，12 → 十二，105 → 一百零五 */
export function chineseNumber(n: number): string {
  const digits = '零一二三四五六七八九';
  if (n <= 0) return String(n);
  if (n < 10) return digits[n];
  if (n < 20) return '十' + (n % 10 ? digits[n % 10] : '');
  if (n < 100) return digits[Math.floor(n / 10)] + '十' + (n % 10 ? digits[n % 10] : '');
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (!r) return digits[h] + '百';
    return digits[h] + '百' + (r < 10 ? '零' + digits[r] : r < 20 ? '一' + chineseNumber(r) : chineseNumber(r));
  }
  return String(n);
}

/** 从模型输出中稳健地提取 JSON（兼容 ```json 代码块、前后缀废话、尾逗号）。 */
/**
 * 修复模型常见的 JSON 毛病：字符串里没转义的英文双引号（例如对白）、字符串里的真实换行、尾逗号。
 * 用状态机判断：字符串里遇到 " 时，如果它后面紧跟的不是 , : } ]（忽略空白），就当作正文里的引号并转义。
 */
export function repairJson(text: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      out += ch + (text[i + 1] ?? '');
      i++;
    } else if (ch === '"') {
      const rest = text.slice(i + 1).match(/^\s*(.)/);
      const next = rest ? rest[1] : '';
      if (next === '' || ',:}]'.includes(next)) {
        inStr = false;
        out += ch;
      } else out += '\\"';
    } else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** 把被截断的 JSON 尽量补全（关闭未结束的字符串与括号）。只在明确允许时使用，结果可能缺少末尾内容。 */
export function closeJson(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '').replace(/,?\s*"[^"]*"\s*:\s*$/, '');
  return out + stack.reverse().join('');
}

export function extractJson<T = unknown>(raw: string, opts: { salvage?: boolean } = {}): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  const open = text[0];
  const close = open === '[' ? ']' : '}';
  const end = text.lastIndexOf(close);
  const body = end >= 0 ? text.slice(0, end + 1) : text;
  const attempts = [() => body, () => repairJson(body)];
  if (opts.salvage) attempts.push(() => closeJson(repairJson(text)));
  let lastError: unknown;
  for (const make of attempts) {
    try {
      return JSON.parse(make()) as T;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * 流式解析 JSON 数组：返回目前为止已完整闭合的顶层对象。
 * 让大纲在生成过程中一章一章地“长”出来，而不是等全部结束。
 */
export function parsePartialArray<T = unknown>(raw: string): T[] {
  const start = raw.indexOf('[');
  if (start < 0) return [];
  const out: T[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(raw.slice(objStart, i + 1)) as T);
        } catch {
          /* 不完整或不合法的对象，跳过 */
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
}

/** 去掉模型常见的多余包装：章节标题行、Markdown 标记、代码块。 */
export function cleanProse(text: string): string {
  let t = text.replace(/^```[a-z]*\n?|```$/gim, '').trim();
  const lines = t.split('\n');
  if (lines.length > 1 && /^(#+\s*)?第[\d一二三四五六七八九十百零]+章/.test(lines[0].trim())) lines.shift();
  t = lines.join('\n').replace(/^#+\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** 基于字符串的稳定伪随机数（让演示引擎与生成式封面可复现）。 */
export function seededRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 线索与角色的丝线色板（传统中国色）。 */
export const SILK = [
  { name: '朱砂', hex: '#c23a2b' },
  { name: '靛青', hex: '#35607f' },
  { name: '石绿', hex: '#3f8a6b' },
  { name: '藤黄', hex: '#d49a2a' },
  { name: '胭脂', hex: '#a3345a' },
  { name: '黛紫', hex: '#6a5a9a' },
  { name: '赭石', hex: '#a2643a' },
  { name: '天青', hex: '#4b9bb5' },
  { name: '松花', hex: '#8a9a3c' },
  { name: '藕荷', hex: '#b27c9a' },
];

export function silk(i: number) {
  return SILK[((i % SILK.length) + SILK.length) % SILK.length].hex;
}
