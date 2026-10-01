/**
 * 随机灵感。
 *
 * 好灵感不是「随便来一句」：模型在没有标准、没有种子时，会滑向最安全、最平庸的脑洞。所以这里做四件事：
 * 1. 质量标准 + 范例：告诉模型好灵感长什么样（具体、有悖论、有情感内核），并给范例校准水准；
 * 2. 思维算子：每条候选被分配一种「脑洞方法」（让常识反过来、社会推演、错位混搭……），逼它从不同的路径想，而不是各自滑向同一个套路；
 * 3. 随机种子：每条再分配「类型 × 情绪 × 冷门职业或物件」，并明确禁用被写烂的意象；
 * 4. 三档脑洞浓度（温情 / 奇想 / 大脑洞），一次生成一批并按档缓存，点击即出。
 * 没有模型或失败时，用本地的「具体名词 × 悖论规则」组合器兜底。
 */
import { profileFor } from '@/cloud/models';
import { streamChat } from './client';
import { extractJson } from '@/lib/util';

export type WildLevel = 'warm' | 'odd' | 'wild';
export const LEVELS: { value: WildLevel; label: string; hint: string }[] = [
  { value: 'warm', label: '温情', hint: '现实基调，一点点奇想，重在情感' },
  { value: 'odd', label: '奇想', hint: '一条反常的设定撑起一个故事' },
  { value: 'wild', label: '大脑洞', hint: '荒诞但自洽，设定本身就让人愣一下' },
];

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
function sample<T>(a: readonly T[], n: number): T[] {
  const c = [...a];
  const out: T[] = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  return out;
}

/** 范例只用来校准「具体 + 悖论 + 情感」的水准 */
const ANCHORS = [
  '她每次说谎，城里就会下一场雪。',
  '一个只能记住七天的侦探，正在调查自己的谋杀案。',
  '被贬的龙王在人间开了一家修伞铺。',
  '父亲每年除夕都放同一箱烟花，二十八响，而我弟弟只活到二十七岁。',
  '人类第一次收到外星信号，内容是一首童谣。',
];

/** 被写烂了的意象与设定：明确禁用，否则模型会反复回到它们 */
const OVERUSED = '灯塔、邮差、当铺、深夜食堂、旧书店、钟表匠、雨夜便利店、时间循环、失忆、记忆交易、能看见死人、神秘的信、末日图书馆、穿越重生、系统金手指';

interface Operator {
  name: string;
  how: string;
  levels: WildLevel[];
}
/** 思维算子：不是题材，而是「怎么想」 */
const OPERATORS: Operator[] = [
  { name: '规则化', how: '给一件日常事物加上一条有代价的奇怪规则，并写出这条规则逼出的第一个故事', levels: ['warm', 'odd', 'wild'] },
  { name: '让常识反过来', how: '取一个人人默认成立的常识或行业惯例，让它反过来成立（例如：病人给医生开药方）', levels: ['odd', 'wild'] },
  { name: '社会推演', how: '假设一个怪异的事实已经成立了几十年，写它长出来的制度、职业、黑市或禁忌——故事从制度的缝隙里长出来', levels: ['odd', 'wild'] },
  { name: '错位混搭', how: '把两个毫不相干的领域硬接在一起，让它们互相提供规则（例如：天气预报 × 婚姻介绍所）', levels: ['odd', 'wild'] },
  { name: '视角置换', how: '从一个没人想到的「当事者」的角度讲：一件被反复借走的东西、一个只在夜里存在的地方、一种职业里的失败者', levels: ['warm', 'odd'] },
  { name: '极端放大', how: '把一个小烦恼或小习惯放大到荒诞的规模，然后无比认真地对待它', levels: ['odd', 'wild'] },
  { name: '无用的能力', how: '一种真实存在、但几乎没有用处或代价很微妙的超能力，被放进一个具体的、很现实的处境里', levels: ['warm', 'odd', 'wild'] },
  { name: '认真履行的荒谬约定', how: '一个荒谬的承诺被某个人一丝不苟地履行了很多年——读者想知道最初为什么，和它什么时候会停', levels: ['warm', 'odd'] },
  { name: '行业里的幽灵', how: '一个冷门而具体的行业，加上一个与它业务紧密相关的超自然麻烦，让专业细节成为解谜的线索', levels: ['odd', 'wild'] },
  { name: '时间或因果错位', how: '因果、顺序或时间出现一处错位（先有告别后有相遇、结果比原因早到），并只错这一处', levels: ['odd', 'wild'] },
];

const GENRES = ['悬疑', '奇幻', '科幻', '都市', '古风', '治愈', '民国', '职场', '校园', '海洋', '乡村', '武侠', '家庭', '童话', '历史', '美食', '音乐', '体育', '医疗', '工业'];
const EMOTIONS = ['愧疚', '思念', '嫉妒', '释怀', '孤独', '不甘', '感激', '悔恨', '希望', '恐惧', '骄傲', '宽恕', '遗憾', '好奇', '羞耻', '偏执'];
/** 冷门的职业、场所与物件：刻意避开最常见的「文艺意象」 */
const THINGS = [
  '澡堂搓澡师', '公共电话亭维修工', '电影院放映员', '铁路道口看守', '菜市场鱼贩', '火车站失物招领处', '殡仪馆化妆师', '气象站观测员', '补锅匠', '盲道施工队', '驾校教练', '游泳馆救生员', '快递驿站', '养蜂人',
  '拨号上网的调制解调器', '算命摊的二维码', '老式缝纫机', '公交报站器', '共享充电宝', '电梯里的广告屏', '体温计', '保险丝', '驾照上的照片', '外卖袋里的小票', '麻将牌', '胶带', '行李传送带', '候车室的长椅', '澡票', '拆迁办的公章',
  '防空洞', '自来水厂', '废弃的游泳池', '立交桥下的早市', '县城的火葬场', '老干部活动中心', '考场', '长途卧铺车', '海关的无人认领区', '城中村的握手楼',
];

const RULES = ['每说一次谎', '每到雨天', '每过一座桥', '每次叹气', '每当有人撒谎', '每逢月圆', '每次关灯', '每次排队', '每寄出一件东西', '每次道歉'];
const CONSEQ = ['就会少一个人记得她', '城里就会下一场雪', '墙上就会多一道门', '时间就会倒流一分钟', '镜子里的人就会慢一秒', '就会有一种声音永远消失', '欠下的东西就会翻一倍'];
const NOUNS = ['搓澡师', '放映员', '道口看守', '鱼贩', '失物招领员', '殡仪化妆师', '气象员', '补锅匠', '驾校教练', '救生员', '养蜂人', '报站员'];

/** 本地兜底：具体职业 × 带代价的规则，保证有悖论而不是空洞拼接 */
export function composeInspiration(avoid: string[] = []): string {
  for (let i = 0; i < 10; i++) {
    const s =
      Math.random() < 0.5
        ? `${pick(RULES)}，${pick(CONSEQ)}——而一位${pick(NOUNS)}发现，这条规则偏偏对他一个人不起作用。`
        : `一位${pick(NOUNS)}发现，自己手里的${pick(THINGS.slice(14, 30))}，每天夜里都在悄悄记录一件还没发生的事。`;
    if (!avoid.includes(s)) return s;
  }
  return `一位${pick(NOUNS)}发现，自己手里的${pick(THINGS.slice(14, 30))}，每天夜里都在悄悄记录一件还没发生的事。`;
}

export function composeMany(n: number): string[] {
  const out: string[] = [];
  while (out.length < n) out.push(composeInspiration(out));
  return out;
}

const SYSTEM = `你是顶尖的长篇小说策划编辑，专门为作者想「一句话灵感」——读完让人先愣一下，再忍不住问「然后呢」。

好灵感的标准：
1. 具体：有明确的职业、物件、地点或规则，细节具体到像真的。
2. 悖论：把两件不该碰在一起的事放在一起，或给平凡事物加上一条有代价的规则。
3. 情感内核：背后有一个人人都懂的情感，不只是点子好玩。
4. 一句话：25–70 个字，一个完整的句子，不解释、不评论。句式要有变化，不要每条都以「一个……」开头。
5. 新：读者没在别处见过。如果你觉得「这个我好像见过」，就换一个。
6. 只有一个核心设定：一句话里只放一个让人愣一下的点，其余都让位给它；约束里给你的元素不必都用上，塞得越多越不自然。

被写烂的意象与设定，一律不要用：${OVERUSED}。也不要用「神秘的」「命运」「秘密」「拯救世界」这类空洞的词。

下面是品质合格的范例，只用来校准水准——不要沿用它们的题材、人物或句式：
${ANCHORS.map((a) => `· ${a}`).join('\n')}

只输出一个 JSON 字符串数组，不要任何解释，不要 Markdown 代码块。`;

const LEVEL_BRIEF: Record<WildLevel, string> = {
  warm: '浓度：温情。现实基调，只允许一点点奇想；重点是情感的真实，设定要克制。',
  odd: '浓度：奇想。允许有一条明确的反常设定，由它撑起整个故事；设定之外的世界要真实可信。',
  wild: '浓度：大脑洞。要荒诞，但必须自洽——设定本身要让人愣一下，细想之后又觉得心酸或细思极恐；宁可离谱，不要平庸。可以写出一整套奇怪的社会规则，再落到一个具体的人身上。',
};

const clean = (t: unknown) =>
  String(t ?? '')
    .trim()
    .replace(/^[「“"'《\d.、)\s-]+|[」”"'》]+$/g, '')
    .trim();

const queues: Record<WildLevel, string[]> = { warm: [], odd: [], wild: [] };
const recent: string[] = [];
let inflight: Promise<void> | null = null;
let currentLevel: WildLevel = 'odd';

export function getLevel(): WildLevel {
  try {
    const v = localStorage.getItem('inkloom.wild');
    if (v === 'warm' || v === 'odd' || v === 'wild') currentLevel = v;
  } catch {
    /* 忽略 */
  }
  return currentLevel;
}
export function setLevel(l: WildLevel) {
  currentLevel = l;
  try {
    localStorage.setItem('inkloom.wild', l);
  } catch {
    /* 忽略 */
  }
}

function buildBrief(level: WildLevel): string {
  const n = 6;
  const ops = sample(OPERATORS.filter((o) => o.levels.includes(level)), n);
  while (ops.length < n) ops.push(pick(OPERATORS.filter((o) => o.levels.includes(level))));
  const genres = sample(GENRES, n);
  const emotions = sample(EMOTIONS, n);
  const things = sample(THINGS, n);
  return `${LEVEL_BRIEF[level]}

请写 ${n} 条互不相同的灵感。每条各自遵守下面的创作约束，彼此要在题材、气质和「想法的路径」上拉开：
${ops.map((o, i) => `${i + 1}. 思维方法「${o.name}」：${o.how}；类型倾向「${genres[i]}」；情感内核「${emotions[i]}」；可以借用「${things[i]}」作为灵感来源（放进去不自然就舍弃，不要硬塞）`).join('\n')}
${recent.length ? `\n最近已经出现过，请避开这些方向：\n${recent.map((r) => `· ${r}`).join('\n')}\n` : ''}
请先在心里各写出两倍数量的候选，淘汰掉最平庸、最眼熟、最像「点子」而缺少情感的一半，只输出最好的 ${n} 条；宁缺毋滥，绝不凑数。
输出格式：["灵感1", "灵感2", …]`;
}

async function refill(level: WildLevel, signal?: AbortSignal) {
  const profile = profileFor('plan');
  if (profile.provider !== 'cloud') return;
  const raw = await streamChat({
    profile,
    stage: 'plan',
    system: SYSTEM,
    messages: [{ role: 'user', content: buildBrief(level) }],
    demo: () => '[]',
    signal,
    temperature: level === 'wild' ? 1.3 : level === 'odd' ? 1.2 : 1.05,
    // 带「思考」的模型会先消耗一部分额度再作答，上限太小会得到空内容
    maxTokens: 6000,
  });
  const q = queues[level];
  const list = extractJson<unknown[]>(raw, { salvage: true }).map(clean).filter((s) => s.length >= 12 && s.length <= 120);
  for (const s of list) if (!q.includes(s) && !recent.includes(s)) q.push(s);
}

/** 在后台补充当前档的候选（同一时刻只会有一个请求在飞）。 */
export function prefetchInspirations(level: WildLevel = getLevel()): Promise<void> {
  if (queues[level].length >= 3 || inflight) return inflight ?? Promise.resolve();
  inflight = refill(level)
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 取一句灵感。队列里有就立刻给；没有就等一批。模型不可用时退回本地组合。 */
export async function fetchInspiration(o: { signal?: AbortSignal; level?: WildLevel } = {}): Promise<{ text: string; source: 'model' | 'local'; fellBack?: boolean }> {
  const level = o.level ?? getLevel();
  const profile = profileFor('plan');
  const remember = (t: string) => {
    recent.unshift(t);
    recent.length = Math.min(recent.length, 8);
    return t;
  };
  let failed = false;
  if (profile.provider === 'cloud') {
    try {
      if (!queues[level].length) {
        if (inflight) await inflight;
        if (!queues[level].length) await refill(level, o.signal);
      }
      const t = queues[level].shift();
      if (t) {
        void prefetchInspirations(level);
        return { text: remember(t), source: 'model' };
      }
    } catch (error) {
      if (o.signal?.aborted) throw error;
    }
    failed = true;
  }
  return { text: remember(composeInspiration(recent)), source: 'local', fellBack: failed };
}
