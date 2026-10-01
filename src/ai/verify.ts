/**
 * 审稿核验：模型会「编」引文、会把没写出来的情节点说成已完成。这里用确定性的程序，
 * 逐条核对模型给出的证据，核对不上的不让它进入报告——而不是请模型「再保证一次」。
 *
 * - 引文：必须能在正文里找到（精确 → 忽略标点空白 → 近似匹配三级），找不到就丢弃并计数；
 * - 情节点：说「已完成」却拿不出能找到的引文，降为「待核实」；说「未完成」但正文里几乎覆盖了该情节点的关键词，也降为「待核实」；
 * - 人名：正文里出现与设定人物只差一个字的名字，提示可能是笔误。
 */

const PUNCT = /[\s，。！？、；：“”‘’"'「」『』《》【】（）()—…·,.!?;:\-]/g;

export interface Located {
  from: number;
  to: number;
  level: 'exact' | 'fuzzy';
}

/** 去掉标点空白，并记住每个字符在原文里的位置 */
function squash(text: string): { s: string; map: number[] } {
  let s = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (PUNCT.test(text[i])) {
      PUNCT.lastIndex = 0;
      continue;
    }
    PUNCT.lastIndex = 0;
    s += text[i];
    map.push(i);
  }
  return { s, map };
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let inter = 0;
  let total = 0;
  for (const [, n] of a) total += n;
  for (const [, n] of b) total += n;
  for (const [g, n] of a) inter += Math.min(n, b.get(g) ?? 0);
  return total ? (2 * inter) / total : 0;
}

/** 在正文里定位一段引文。找不到返回 null。 */
export function locateQuote(text: string, quote: string): Located | null {
  const q = quote.trim().replace(/^[“"「『]|[”"」』]$/g, '').replace(/[…]+$|\.{3,}$/g, '').trim();
  if (!q) return null;
  const direct = text.indexOf(q);
  if (direct >= 0) return { from: direct, to: direct + q.length, level: 'exact' };

  const { s, map } = squash(text);
  const qs = squash(q).s;
  if (qs.length < 4) return null;
  const at = s.indexOf(qs);
  if (at >= 0) return { from: map[at], to: map[at + qs.length - 1] + 1, level: 'exact' };

  // 近似：模型常常改一两个字。窗口长度与引文相同，用字二元组的相似度判断。
  if (qs.length < 8) return null;
  const qb = bigrams(qs);
  let best = 0;
  let bestAt = -1;
  for (let i = 0; i + qs.length <= s.length; i++) {
    const sim = dice(qb, bigrams(s.slice(i, i + qs.length)));
    if (sim > best) {
      best = sim;
      bestAt = i;
    }
  }
  if (best >= 0.72 && bestAt >= 0) return { from: map[bestAt], to: map[Math.min(map.length - 1, bestAt + qs.length - 1)] + 1, level: 'fuzzy' };
  return null;
}

// ───────── 情节点覆盖度 ─────────

const STOP = new Set([...'的了在是他她它我你不就也都和与着过这那有一把被将对向从到把让给说']);

/** 情节点里有区分度的字二元组（去掉含常用虚词的） */
function keyGrams(beat: string): string[] {
  const s = squash(beat).s;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    if (![...g].some((c) => STOP.has(c))) out.add(g);
  }
  return [...out];
}

/** 正文覆盖了情节点多少比例的关键词（0–1） */
export function beatCoverage(text: string, beat: string): number {
  const grams = keyGrams(beat);
  if (grams.length < 4) return 0;
  const hay = squash(text).s;
  return grams.filter((g) => hay.includes(g)).length / grams.length;
}

// ───────── 对审稿结果的整体核验 ─────────

interface RawIssue {
  quote: string;
  [k: string]: unknown;
}
interface RawBeat {
  beat: string;
  status: 'done' | 'missing' | 'uncertain';
  evidence: string;
}

export interface Verified<I extends RawIssue> {
  issues: (I & { verified: 'exact' | 'fuzzy' | 'global'; loc?: { from: number; to: number } })[];
  /** 因为引文在正文里找不到而被丢弃的意见数 */
  dropped: number;
  beats: (RawBeat & { note?: string })[];
}

export function verifyCritique<I extends RawIssue>(text: string, issues: I[], beats: RawBeat[]): Verified<I> {
  const out: Verified<I>['issues'] = [];
  let dropped = 0;
  for (const is of issues) {
    const q = String(is.quote ?? '').trim();
    if (!q) {
      out.push({ ...is, verified: 'global' }); // 没有引用的整体性意见，保留但不标「已核对」
      continue;
    }
    const at = locateQuote(text, q);
    if (!at) {
      dropped++;
      continue;
    }
    out.push({ ...is, quote: at.level === 'exact' ? q : text.slice(at.from, at.to), verified: at.level, loc: { from: at.from, to: at.to } });
  }

  const checked = beats.map((b) => {
    if (b.status === 'done') {
      const at = b.evidence ? locateQuote(text, b.evidence) : null;
      if (at) return { ...b, evidence: at.level === 'exact' ? b.evidence : text.slice(at.from, at.to) };
      return { ...b, status: 'uncertain' as const, note: '模型说已完成，但它引用的证据在正文里找不到，需要你确认' };
    }
    if (b.status === 'missing' && beatCoverage(text, b.beat) >= 0.6) {
      return { ...b, status: 'uncertain' as const, note: '模型说没写出来，但正文里出现了这个情节点的大部分关键词，可能是误判' };
    }
    return b;
  });
  return { issues: out, dropped, beats: checked };
}

// ───────── 人名一致性 ─────────

export interface NameDrift {
  expected: string;
  found: string;
  count: number;
}

/**
 * 正文里出现与设定人物只差一个字、且出现不止一次的名字，多半是模型写串了（例如「沈雾」写成「沈蘅」）。
 * 差一个字的名字如果本身也是设定里的人物或词条，就不算。
 */
export function nameDrift(text: string, known: string[], otherTerms: string[] = []): NameDrift[] {
  const skip = new Set([...known, ...otherTerms]);
  const found: NameDrift[] = [];
  for (const name of known) {
    if (name.length < 2 || name.length > 4 || !text.includes(name)) continue;
    const seen = new Map<string, number>();
    for (let i = 0; i + name.length <= text.length; i++) {
      if (text[i] !== name[0]) continue;
      const cand = text.slice(i, i + name.length);
      if (cand === name || skip.has(cand)) continue;
      let diff = 0;
      for (let k = 0; k < name.length; k++) if (cand[k] !== name[k]) diff++;
      if (diff === 1 && !PUNCT.test(cand)) seen.set(cand, (seen.get(cand) ?? 0) + 1);
      PUNCT.lastIndex = 0;
    }
    for (const [cand, count] of seen) if (count >= 2) found.push({ expected: name, found: cand, count });
  }
  return found;
}
