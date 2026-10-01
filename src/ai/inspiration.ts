/**
 * 随机灵感。
 *
 * 好灵感不是「随便来一句」：模型在没有标准、没有种子时，会滑向最安全、最平庸的脑洞。所以这里做三件事：
 * 1. 质量标准 + 范例：告诉模型好灵感长什么样（具体、有悖论、有情感内核），并给几条高水平范例做锚点；
 * 2. 随机创作约束：每条候选都被分配不同的「类型 × 情绪 × 必须出现的物件」，从源头上拉开差异；
 * 3. 一次生成一批并缓存：点击即出，不用等；用完后台再补。
 * 没有模型或失败时，用本地的「具体名词 × 悖论规则」组合器兜底。
 */
import { profileFor } from '@/cloud/models';
import { streamChat } from './client';
import { extractJson } from '@/lib/util';

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
function sample<T>(a: readonly T[], n: number): T[] {
  const c = [...a];
  const out: T[] = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  return out;
}

/** 高水平范例：只用来校准品质，要求模型不要沿用它们的题材和句式 */
const ANCHORS = [
  '一个邮差发现，自己每天投递的信里，有一封来自十年前已经去世的人。',
  '她每次说谎，城里就会下一场雪。',
  '一个只能记住七天的侦探，正在调查自己的谋杀案。',
  '老城区的深夜食堂，只在有人失恋的晚上开门。',
  '被贬的龙王在人间开了一家修伞铺。',
  '她继承了祖母的当铺，这里能典当的是记忆。',
  '末日后的图书馆里，最后一个管理员在给机器人讲故事。',
  '人类第一次收到外星信号，内容是一首童谣。',
];

const GENRES = ['悬疑', '奇幻', '科幻', '都市', '古风', '治愈', '民国', '职场', '校园', '海洋', '乡村', '武侠', '家庭', '童话', '赛博朋克', '历史', '美食', '音乐', '体育', '医疗'];
const EMOTIONS = ['愧疚', '思念', '嫉妒', '释怀', '孤独', '不甘', '感激', '悔恨', '希望', '恐惧', '骄傲', '宽恕', '遗憾', '好奇'];
const THINGS = ['雨伞', '旧电话亭', '船票', '药方', '灯塔', '磁带', '风筝', '汤勺', '钟表', '地图', '算盘', '口琴', '邮戳', '钥匙', '镜子', '账本', '收音机', '纸船', '拨浪鼓', '胶片', '浴缸', '电梯', '路灯', '门铃', '行李箱', '蜡烛', '棋盘', '针线', '照相馆', '渡口', '菜市场', '末班车', '旧书', '烟火', '冰箱', '拼图', '指甲刀', '遥控器', '树洞', '黑板'];

const RULES = ['每说一次谎', '每到雨天', '每过一座桥', '每次叹气', '每当有人撒谎', '每逢月圆', '每次关灯', '每读完一封信', '每寄出一件东西', '每次记起一个人'];
const CONSEQ = ['就会少一个人记得她', '城里就会下一场雪', '墙上就会多一道门', '时间就会倒流一分钟', '就会有一件旧物回到原处', '镜子里的人就会慢一秒', '就会有一种声音永远消失'];
const NOUNS = ['邮差', '钟表匠', '灯塔守护人', '摆渡人', '裁缝', '老花匠', '殡仪化妆师', '盲人调音师', '末班车司机', '说书人', '看守图书馆的机器人', '替人排队的人', '深夜电台主持人', '拆弹专家', '补伞的老人'];

/** 本地兜底：具体职业 × 带代价的规则，保证有悖论而不是空洞拼接 */
export function composeInspiration(avoid: string[] = []): string {
  for (let i = 0; i < 10; i++) {
    const s =
      Math.random() < 0.5
        ? `${pick(RULES)}，${pick(CONSEQ)}——而${pick(NOUNS)}发现，这条规则偏偏对他一个人不起作用。`
        : `${pick(NOUNS)}的${pick(THINGS)}里，藏着一个只有他听得见的${pick(['声音', '名字', '约定', '倒计时'])}。`;
    if (!avoid.includes(s)) return s;
  }
  return `${pick(NOUNS)}的${pick(THINGS)}里，藏着一个只有他听得见的约定。`;
}

export function composeMany(n: number): string[] {
  const out: string[] = [];
  while (out.length < n) out.push(composeInspiration(out));
  return out;
}

const SYSTEM = `你是顶尖的长篇小说策划编辑，专门为作者想「一句话灵感」——读完让人立刻想问「然后呢」。

好灵感的四条标准：
1. 具体：有明确的职业、物件、地点或规则，而不是「一个人」「某个地方」。细节越具体，越像真的。
2. 悖论：把两件不该碰在一起的事放在一起，或给平凡事物加上一条有代价的奇怪规则，让读者本能地想知道它为什么、会怎样。
3. 情感内核：灵感背后要有一个人人都懂的情感（愧疚、思念、不甘、宽恕……），不只是点子好玩。
4. 一句话：25–60 个字，一个完整的句子，不解释、不加评论。句式要有变化，不要每条都以「一个……」开头。

要避开的陈词：穿越重生、霸道总裁、系统金手指、失忆、丧尸末日、神秘组织、拯救世界、命运、秘密、神秘的……这类空洞的词；也不要把「具体」写成堆砌形容词。

下面是品质合格的范例，只用来校准水准——不要沿用它们的题材、人物或句式：
${ANCHORS.map((a) => `· ${a}`).join('\n')}

${'只输出一个 JSON 字符串数组，不要任何解释，不要 Markdown 代码块。'}`;

const clean = (t: unknown) =>
  String(t ?? '')
    .trim()
    .replace(/^[「“"'《\d.、)\s-]+|[」”"'》]+$/g, '')
    .trim();

const queue: string[] = [];
const recent: string[] = [];
let inflight: Promise<void> | null = null;

function buildBrief(): string {
  const n = 6;
  const genres = sample(GENRES, n);
  const emotions = sample(EMOTIONS, n);
  const things = sample(THINGS, n);
  return `请写 ${n} 条互不相同的灵感。每条各自遵守下面的创作约束（让它们的题材与气质彼此拉开）：
${genres.map((g, i) => `${i + 1}. 类型倾向「${g}」；情感内核「${emotions[i]}」；故事里要自然地出现「${things[i]}」`).join('\n')}
${recent.length ? `\n最近已经出现过，请避开这些方向：\n${recent.map((r) => `· ${r}`).join('\n')}\n` : ''}
请先在心里各写出两倍数量的候选，淘汰掉最平庸、最像「点子」而缺少情感的一半，只输出最好的 ${n} 条；宁缺毋滥，绝不凑数。
输出格式：["灵感1", "灵感2", …]`;
}

async function refill(signal?: AbortSignal) {
  const profile = profileFor('plan');
  if (profile.provider !== 'cloud') return;
  const raw = await streamChat({
    profile,
    stage: 'plan',
    system: SYSTEM,
    messages: [{ role: 'user', content: buildBrief() }],
    demo: () => '[]',
    signal,
    temperature: 1.15,
    // 带「思考」的模型会先消耗一部分额度再作答，上限太小会得到空内容
    maxTokens: 4000,
  });
  const list = extractJson<unknown[]>(raw).map(clean).filter((s) => s.length >= 12 && s.length <= 100);
  for (const s of list) if (!queue.includes(s) && !recent.includes(s)) queue.push(s);
}

/** 在后台补充候选（同一时刻只会有一个请求在飞）。 */
export function prefetchInspirations(): Promise<void> {
  if (queue.length >= 3 || inflight) return inflight ?? Promise.resolve();
  inflight = refill()
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * 取一句灵感。队列里有就立刻给；没有就等一批。模型不可用时退回本地组合。
 * onText 用于在等待模型时无需显示；返回的文本由调用方做逐字动画。
 */
export async function fetchInspiration(o: { signal?: AbortSignal } = {}): Promise<{ text: string; source: 'model' | 'local'; fellBack?: boolean }> {
  const profile = profileFor('plan');
  const remember = (t: string) => {
    recent.unshift(t);
    recent.length = Math.min(recent.length, 8);
    return t;
  };
  let failed = false;
  if (profile.provider === 'cloud') {
    try {
      if (!queue.length) {
        if (inflight) await inflight;
        if (!queue.length) await refill(o.signal);
      }
      const t = queue.shift();
      if (t) {
        void prefetchInspirations();
        return { text: remember(t), source: 'model' };
      }
    } catch (error) {
      if (o.signal?.aborted) throw error;
    }
    failed = true;
  }
  return { text: remember(composeInspiration(recent)), source: 'local', fellBack: failed };
}
