/**
 * 文字体检：用确定性规则找出最典型的「AI 腔」，给出可量化的指标，而不是凭感觉说「有点AI味」。
 * - 比喻密度：像 / 仿佛 / 如同 / 宛如 / 好像 / 似乎 …… 每千字出现几次（文学作品里一般不超过 3–4 次）；
 * - 段尾比喻：以比喻句收尾的段落占比（最明显的套路：每段都要补一个比喻）；
 * - 套话：一丝、一抹、不禁、缓缓、深吸一口气、眼中闪过……每千字总次数与最常见的几种。
 */

const SIMILE = /(?:好像|仿佛|如同|宛如|犹如|似乎|像)/g;
const SIMILE_ONE = /(?:好像|仿佛|如同|宛如|犹如|似乎|像)/;

/** 套话：[显示名, 正则]。只收录真正泛滥、几乎没有信息量的表达。 */
const STOCK: [string, RegExp][] = [
  ['一丝/一抹', /一[丝抹]/g],
  ['不禁 / 不由得', /不禁|不由得|不由自主/g],
  ['缓缓 / 微微 / 淡淡', /缓缓|微微|淡淡地|淡淡的/g],
  ['深吸一口气', /深吸一口气|倒吸一口(?:凉)?气|长舒一口气/g],
  ['眼中闪过…', /眼(?:中|底|神)(?:闪过|划过|掠过)|眸(?:中|底)(?:闪过|划过)/g],
  ['嘴角勾起 / 上扬', /嘴角(?:微微)?(?:勾起|上扬|扬起|抽动)|勾起(?:一抹)?唇角/g],
  ['心中一凛 / 一紧…', /心(?:中|头|里)(?:一凛|一紧|一沉|一颤|一震|一跳|一动|一暖|一酸)/g],
  ['空气凝固 / 时间静止', /空气(?:仿佛|好像|似乎)?(?:凝固|静止|停滞|凝滞)|时间(?:仿佛|好像|似乎)?(?:凝固|静止|停滞)/g],
  ['瞳孔骤缩 / 喉结滚动', /瞳孔(?:骤然|猛地|微微)?(?:一?缩|收缩)|喉结(?:上下)?(?:滚动|滑动)|指节(?:因用力)?泛白/g],
  ['五味杂陈 / 复杂的眼神', /五味杂陈|百感交集|眼神复杂|复杂的(?:眼神|情绪|神色)|说不出的|莫名的/g],
  ['心跳漏了一拍', /心跳(?:漏了一拍|加速|骤停)|心脏(?:猛地|狠狠)?(?:一缩|一跳)/g],
];

export interface LintResult {
  chars: number;
  similePerK: number;
  simileCount: number;
  /** 以比喻句收尾的段落数 / 总段落数 */
  paraEndSimile: { count: number; total: number };
  stockPerK: number;
  stock: { name: string; count: number }[];
  /** 综合判断 */
  level: 'ok' | 'high';
  /** 给人看的结论 */
  summary: string;
}

const countChars = (t: string) => t.replace(/\s/g, '').length;

export function lintProse(text: string): LintResult {
  const chars = Math.max(1, countChars(text));
  const simileCount = (text.match(SIMILE) ?? []).length;
  const paras = text.split(/\n+/).map((p) => p.trim()).filter((p) => countChars(p) >= 20);
  const endSim = paras.filter((p) => {
    const last = p.split(/(?<=[。！？!?])/).filter((s) => s.trim()).pop() ?? '';
    return SIMILE_ONE.test(last);
  }).length;
  const stock = STOCK.map(([name, re]) => ({ name, count: (text.match(re) ?? []).length })).filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const stockCount = stock.reduce((n, s) => n + s.count, 0);
  const similePerK = (simileCount / chars) * 1000;
  const stockPerK = (stockCount / chars) * 1000;
  const endRatio = paras.length ? endSim / paras.length : 0;
  const high = chars >= 600 && (similePerK > 5 || stockPerK > 6 || endRatio > 0.3);
  const parts: string[] = [];
  if (similePerK > 5) parts.push(`比喻偏密（每千字 ${similePerK.toFixed(1)} 处，建议 ≤4）`);
  if (endRatio > 0.3) parts.push(`${endSim}/${paras.length} 个段落以比喻收尾`);
  if (stockPerK > 6) parts.push(`套话偏多（每千字 ${stockPerK.toFixed(1)} 处）`);
  return {
    chars,
    similePerK,
    simileCount,
    paraEndSimile: { count: endSim, total: paras.length },
    stockPerK,
    stock,
    level: high ? 'high' : 'ok',
    summary: parts.length ? parts.join('；') : '没有明显的 AI 腔',
  };
}

/** 生成给模型的修订指令：针对检测到的具体问题。 */
export function lintInstruction(r: LintResult): string {
  const lines: string[] = ['去掉「AI 腔」，保持情节、对白信息和篇幅基本不变：'];
  if (r.similePerK > 4) lines.push(`- 比喻太密（${r.simileCount} 处）。只保留最贴切、最有新意的 3–4 处，其余改为直接写动作、物件或感官细节；不要再用「像……」给段落收尾。`);
  if (r.paraEndSimile.total && r.paraEndSimile.count / r.paraEndSimile.total > 0.3) lines.push('- 多个段落都以比喻句结尾。让段落在具体的动作、对白或事实上收住，把比喻藏进叙述中间。');
  if (r.stock.length) lines.push(`- 替换这些套话，换成这个场景里独有的、具体的细节：${r.stock.slice(0, 6).map((s) => `${s.name}（${s.count}）`).join('、')}。`);
  return lines.join('\n');
}
