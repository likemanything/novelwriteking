/**
 * 以“句”为单位的文稿对比。小说修订通常是句子级的增删替换，
 * 句级 diff 比字符级更易读；相邻的删除 + 插入会被配成一对“替换”。
 */
export type DiffOp = { type: 'eq' | 'ins' | 'del'; text: string };

export function tokenize(text: string): string[] {
  return text.match(/[^。！？!?…\n]+[。！？!?…]*[”」』]?|\n+/g) ?? [];
}

export function diffText(a: string, b: string): DiffOp[] {
  const x = tokenize(a);
  const y = tokenize(b);
  const n = x.length;
  const m = y.length;
  // LCS 动态规划（句子数通常只有几百，足够快）
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: DiffOp[] = [];
  const push = (type: DiffOp['type'], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('eq', x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', x[i++]);
    else push('ins', y[j++]);
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('ins', y[j++]);
  return ops;
}

export function diffStats(ops: DiffOp[]) {
  const count = (t: DiffOp['type']) => ops.filter((o) => o.type === t).reduce((s, o) => s + o.text.replace(/\s/g, '').length, 0);
  return { added: count('ins'), removed: count('del') };
}
