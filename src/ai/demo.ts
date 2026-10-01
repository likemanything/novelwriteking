/**
 * 离线演示引擎。
 *
 * 没有 API Key 也能走完「开书 → 大纲 → 草稿 → 审稿 → 修订 → 定稿 → 提炼」全流程。
 * 它不是语言模型：用题材语料包 + 作者自己的蓝图拼织出结构正确的结果，
 * 输出格式与真实模型完全一致（JSON 任务同样返回 JSON 字符串），因此整条管线都被真实走过。
 */
import type { Chapter, Character, Critique, Project, Thread } from '@/lib/types';
import { hashString, seededRandom } from '@/lib/util';
import type { CritiqueResult, ExtractionResult, GenesisResult, MuseAction, OutlineChapter, StyleAnalysis } from './types';

type Rand = () => number;

interface Pack {
  genre: string;
  match: RegExp;
  surnames: string;
  given: string[];
  places: string[];
  factions: string[];
  rule: [string, string];
  item: [string, string];
  history: [string, string];
  motifs: string[];
  tone: string;
  voice: string;
  rules: string[];
  senses: string[];
  tags: string[];
}

const PACKS: Pack[] = [
  {
    genre: '仙侠',
    match: /仙侠|玄幻|武侠|修仙|修真|仙|剑|宗门|灵根|灵气|妖|魔尊|道长|道士|丹|江湖|飞升|渡劫|天劫/,
    surnames: '沈陆顾谢云萧楚苏叶林',
    given: ['青崖', '照雪', '无咎', '长离', '听澜', '折枝', '惊鸿', '玄度', '疏影', '拂衣'],
    places: ['栖霞山', '忘川渡', '九嶷剑冢', '白鹿书院', '落星城'],
    factions: ['太一剑宗', '烛阴司', '青丘旧部'],
    rule: ['灵契', '以心头血立契，契主身死，灵兽同殒；强行解契者折寿十年。'],
    item: ['断霜剑', '一柄只剩半截的古剑，剑身会在说谎者面前结霜。'],
    history: ['天倾之役', '三百年前正邪两道共诛魔君，真相却被抹去。'],
    motifs: ['剑冢', '长夜', '霜天', '烬雪', '问心'],
    tone: '苍凉而有侠气',
    voice: '古典白话与现代节奏结合的第三人称',
    rules: ['打斗写因果与代价，不写招式清单', '古风用词克制，避免生僻堆砌', '每章至少一个具体的意象反复出现'],
    senses: ['山风带着松脂的苦味', '檐角铜铃被雨打得发哑', '剑鞘上的旧漆在指腹下起了毛刺', '远处寺钟一声压过一声', '篝火噼啪爆出一粒火星'],
    tags: ['修仙', '宿命', '师徒', '成长'],
  },
  {
    genre: '科幻',
    match: /科幻|星|AI|人工智能|机器|宇宙|飞船|未来|赛博|基因|火星|意识|数据|实验|克隆|末日|外星/,
    surnames: '林陈许程周温江宋严乔',
    given: ['知遥', '砚', '衡', '星野', '未央', '启明', '若川', '一诺', '栖', '朔'],
    places: ['第七环轨道站', '潮汐档案馆', '旧港数据坟场', '零度城', '赫拉斯冰原'],
    factions: ['联合调度署', '回声教团', '深井公司'],
    rule: ['意识备份法', '每个公民每年只能备份一次意识，第二份同时存在即被视为违法复制体。'],
    item: ['灰匣', '一台停产多年的离线终端，内存里有一段无法删除的录音。'],
    history: ['静默之年', '全球网络中断的三百天，官方记录只剩一页空白。'],
    motifs: ['回声', '零度', '潮汐', '黑匣', '第二个黎明'],
    tone: '冷峻、克制，暗含温情',
    voice: '冷静精确的第三人称有限视角',
    rules: ['技术细节服务于人物选择，不做说明书', '少用形容词，多用可观测的细节', '每章结尾留一个信息差'],
    senses: ['循环风扇发出低频的嗡鸣', '舷窗外的地球边缘镀着一层薄蓝', '冷却液的甜腥味从通风口渗出来', '全息屏的光在他脸上切出一道道格栅', '警报灯安静地转着，没有声音'],
    tags: ['近未来', '身份', '记忆', '悬疑'],
  },
  {
    genre: '悬疑',
    match: /悬疑|推理|惊悚|案|谋杀|侦探|失踪|死|去世|凶|秘密|真相|警|尸|罪|嫌疑/,
    surnames: '顾秦韩郑罗孟方唐何邵',
    given: ['澈', '衡', '晚舟', '一鸣', '青', '闻笛', '岑', '予安', '迟', '砚秋'],
    places: ['雾港旧码头', '梧桐里17号', '市立第三医院旧楼', '北岸货运站', '钟楼书店'],
    factions: ['刑侦二队', '港务商会', '旧城拆迁办'],
    rule: ['十年追诉', '当地流传一条“规矩”：旧案满十年便无人再问，而明天正好是第十年。'],
    item: ['褪色的车票', '一张二十年前的夜班车票，背面写着一个不存在的门牌号。'],
    history: ['九七年大火', '码头仓库的大火烧死了七个人，结案报告只有两页。'],
    motifs: ['雾港', '无声证词', '第七个人', '长夜', '旧门牌'],
    tone: '阴郁、紧绷，余味悠长',
    voice: '贴近人物的冷色调第三人称',
    rules: ['线索必须公平地摆在读者面前', '每章至少推翻或加深一个判断', '对白里多用回避与沉默'],
    senses: ['雾气把路灯揉成一团团昏黄', '潮湿的纸张散发出霉味', '远处有船在鸣笛，一声比一声长', '烟灰缸里的烟头还是温的', '楼道里的声控灯亮了又灭'],
    tags: ['悬疑', '旧案', '双线', '人性'],
  },
  {
    genre: '奇幻',
    match: /奇幻|魔幻|魔法|龙|精灵|王国|巫|诅咒|神明|女王|骑士|咒/,
    surnames: '艾洛薇塞兰诺希',
    given: ['瑟琳', '阿尔文', '诺拉', '卡斯', '伊芙', '洛恩', '米拉', '赛勒斯', '维娅', '奥琳'],
    places: ['灰烬王都', '低语森林', '北境钟塔', '镜湖', '无名渡口'],
    factions: ['银蔷薇议会', '守夜人', '流亡的龙裔'],
    rule: ['名字的代价', '说出真名即可施加咒语，因此每个人一生只对三个人说出真名。'],
    item: ['无光之灯', '一盏只在谎言附近亮起的铜灯。'],
    history: ['龙陨之夜', '最后一头龙坠落的那晚，王国失去了所有的魔法。'],
    motifs: ['真名', '灰烬', '钟塔', '无光之灯', '北境'],
    tone: '瑰丽而略带忧伤',
    voice: '童话般明亮、暗处有刺的第三人称',
    rules: ['魔法必须有代价', '世界观通过行动揭示，避免大段设定说明', '每章有一个令人记住的画面'],
    senses: ['风里有苹果与铁锈的味道', '烛火在石壁上投下摇晃的影子', '远处的钟声像是从水底传来', '靴底碾过结霜的落叶', '空气里浮着细小的金色尘埃'],
    tags: ['奇幻', '冒险', '魔法', '成长'],
  },
  {
    genre: '都市',
    match: /都市|言情|现实|公司|城市|职场|高考|家族|婚|恋|爱|同学|青春|创业|直播|咖啡|医生|律师|食堂/,
    surnames: '许江周苏陈沈程温夏林',
    given: ['知夏', '屿', '南栀', '予白', '念', '清和', '一舟', '星禾', '晚', '越'],
    places: ['老城区的巷子口', '二十七楼的会议室', '江边的夜宵摊', '旧书店阁楼', '凌晨的便利店'],
    factions: ['恒远集团', '老街邻里会', '校友群'],
    rule: ['家规', '许家的规矩：家丑不外扬，谁先开口谁就输了。'],
    item: ['旧磁带', '一盒录着一首没发表过的歌的磁带。'],
    history: ['那年夏天', '十年前的夏天，一场事故改变了所有人的轨迹。'],
    motifs: ['夏天', '晚风', '旧磁带', '十年', '凌晨四点'],
    tone: '温暖、细腻，有城市的烟火气',
    voice: '亲切自然的第三人称',
    rules: ['情绪藏在日常细节里', '对白口语化，有生活的毛边', '不靠误会推动冲突'],
    senses: ['楼下传来炒菜的油烟声', '空调外机滴着水', '手机屏幕在黑暗里亮了一下', '晚风吹过梧桐，叶子沙沙作响', '奶茶杯壁上凝着一圈水珠'],
    tags: ['都市', '成长', '情感', '治愈'],
  },
];

const FALLBACK = PACKS[3];

export function detectPack(text: string): Pack {
  return PACKS.find((p) => p.match.test(text)) ?? FALLBACK;
}

function pick<T>(r: Rand, arr: T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

function shuffle<T>(r: Rand, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function names(r: Rand, pack: Pack, n: number): string[] {
  const out = new Set<string>();
  const western = pack.genre === '奇幻';
  const gs = shuffle(r, pack.given);
  let i = 0;
  while (out.size < n && i < 40) {
    const g = gs[i % gs.length];
    out.add(western ? g : pick(r, [...pack.surnames]) + g);
    i++;
  }
  return [...out];
}

/** 从灵感中取一个 2–4 字的核心意象，用于书名。 */
function seedMotif(seed: string): string | null {
  const parts = seed
    .replace(/[，。！？、；：“”‘’（）\s,.!?]/g, '|')
    .split(/[|的了在是和与被把我你他她它一个这那有就都也要会能]/)
    .filter((s) => /^[\u4e00-\u9fff]{2,4}$/.test(s));
  return parts.sort((a, b) => b.length - a.length)[0] ?? null;
}

// ─────────────────────────── 开书 ───────────────────────────

export function demoGenesis(o: { seed: string; genre: string; chapters: number; tone: string }): string {
  const pack = o.genre ? PACKS.find((p) => o.genre.includes(p.genre)) ?? detectPack(o.seed) : detectPack(o.seed);
  const r = seededRandom(hashString(o.seed + o.genre));
  const [hero, rival, mentor, ally, shadow] = names(r, pack, 5);
  const motif = seedMotif(o.seed);
  const m = shuffle(r, pack.motifs);
  const titles = [motif ? `${motif}` : m[0], `${m[1]}之后`, `${pick(r, pack.places).slice(0, 2)}${m[2]}`];
  const place = pack.places[0];
  const seed = o.seed.replace(/[。.！!]+$/, '');

  const result: GenesisResult = {
    titles,
    logline: `${hero}必须在一切无法挽回之前，揭开「${seed.slice(0, 16)}」背后的真相，而代价是失去最珍视的东西。`,
    premise: `故事始于${place}。${seed}。${hero}原本只想过安稳的日子，却因为一次意外被卷入其中。随着${rival}的步步紧逼与${mentor}留下的谜题，${hero}逐渐发现，眼前的一切与「${pack.history[0]}」有关——而那段被抹去的过去，也藏着${hero}自己的来历。要走到真相面前，${hero}必须学会信任，也必须学会放手。`,
    genre: pack.genre,
    tags: pack.tags,
    style: { voice: pack.voice, pov: `以${hero}为主的第三人称有限视角`, tense: '过去时，叙述克制', tone: o.tone || pack.tone, rules: pack.rules },
    characters: [
      { name: hero, role: '主角', summary: `一个习惯把话咽回去的人，被迫站到了风口。`, appearance: '眉眼清淡，左手腕有一道旧疤', personality: '敏锐、隐忍，关键时刻异常固执', desire: `弄清「${seed.slice(0, 12)}」的真相`, need: '承认自己也需要被帮助', wound: '年少时因一次沉默失去了重要的人', voice: '话少，常用反问，紧张时会开冷笑话', arc: '从独自承担到学会托付' },
      { name: rival, role: '反派', summary: `相信“秩序高于一切”的人，手段冷酷，动机却并非私欲。`, appearance: '衣着一丝不苟，总戴着一副黑手套', personality: '理性、耐心、极度自律', desire: `让${pack.history[0]}的真相永远埋藏`, need: '面对自己当年的错误', wound: '曾亲手做出无法挽回的选择', voice: '语速很慢，从不提高声音', arc: '从掩盖到崩塌' },
      { name: mentor, role: '导师', summary: `知道太多却说得太少的长辈，早已消失，只留下线索。`, appearance: '白发，惯用左手写字', personality: '温和、狡黠，喜欢打比方', desire: `保护${hero}`, need: '把真相交给下一代', wound: `${pack.history[0]}的幸存者`, voice: '说话像讲故事，常以“你知道吗”开头', arc: '以缺席的方式完成传承' },
      { name: ally, role: '伙伴', summary: `嘴硬心软的同行者，有自己的秘密任务。`, appearance: '个子不高，笑起来有虎牙', personality: '热烈、冲动、讲义气', desire: '找到失踪的家人', need: '学会停下来思考', wound: '被抛下过一次', voice: '语速快，爱起外号', arc: '从为自己到为彼此' },
      { name: shadow, role: '变数', summary: `立场不明的神秘人，总在关键时刻出现。`, appearance: '面容模糊，令人过目即忘', personality: '冷淡、难以捉摸', desire: '未知', need: '被某个人真正记住', wound: '没有名字', voice: '只说半句话', arc: '身份揭晓后的抉择' },
    ],
    world: [
      { category: '地点', name: place, content: `故事的起点。${pack.senses[0]}，这里的每个人都在回避同一件事。`, keywords: [place.slice(0, 2)] },
      { category: '势力', name: pack.factions[0], content: `掌握着秩序与话语权的势力，${rival}是其中的核心人物。`, keywords: [pack.factions[0].slice(0, 2)] },
      { category: '规则', name: pack.rule[0], content: pack.rule[1], keywords: [pack.rule[0]] },
      { category: '物品', name: pack.item[0], content: pack.item[1], keywords: [pack.item[0]] },
      { category: '历史', name: pack.history[0], content: pack.history[1], keywords: [pack.history[0]] },
    ],
    threads: [
      { name: '真相', kind: 'main', description: `「${seed.slice(0, 14)}」究竟意味着什么？${pack.history[0]}的真相是什么？` },
      { name: `${mentor}的下落`, kind: 'mystery', description: `${mentor}为何消失，留下的线索指向哪里？` },
      { name: `${hero}与${ally}`, kind: 'romance', description: '两个同样骄傲的人，能否真正信任彼此？' },
      { name: `${hero}的成长`, kind: 'arc', description: '从独自承担到学会托付。' },
    ],
  };
  return JSON.stringify(result, null, 2);
}

// ─────────────────────────── 大纲 ───────────────────────────

const ACTS = ['第一卷 · 起', '第二卷 · 承', '第三卷 · 转', '第四卷 · 合'];

const BEAT_SHAPES = [
  (a: string, b: string, p: string, x: string) => [`${a}在${p}发现了与「${x}」有关的异样`, `${a}试图独自查明，却被${b}撞见`, `两人交换条件，暂时结成同盟`, `${a}意识到事情远比想象的复杂`],
  (a: string, b: string, p: string, x: string) => [`${b}带来一个无法拒绝的消息`, `${a}前往${p}，沿途遭遇阻拦`, `${a}用一个小谎言换来关键线索「${x}」`, `谎言在章末被人识破`],
  (a: string, b: string, p: string, x: string) => [`${a}回到${p}，一切看似平静`, `一场意外让${a}与${b}被困在一起`, `被迫的相处中，${b}说出了一段往事`, `${a}在往事里听见了「${x}」`],
  (a: string, b: string, p: string, x: string) => [`${a}按线索在${p}设下圈套`, `${b}没有按预料行动，计划落空`, `${a}付出代价，失去了一件重要的东西`, `废墟里露出「${x}」的一角`],
  (a: string, b: string, p: string, x: string) => [`${a}与${b}爆发争吵，彼此说出了真话`, `${a}独自夜行至${p}`, `${a}想起一个被遗忘的细节，与「${x}」对上了`, `有人在暗处注视着这一切`],
];

const TITLE_SHAPES = ['{m}', '夜访{p}', '{x}', '无声的{m}', '{p}来信', '第{n}个问题', '{m}未央', '回到{p}', '{x}的另一面', '破晓前'];

export function demoOutline(o: { project: Project; characters: Character[]; threads: Thread[]; places: string[]; from: number; count: number }): string {
  const pack = detectPack(o.project.genre + o.project.seed + o.project.premise);
  const r = seededRandom(hashString(o.project.id + o.from + o.count));
  const cast = o.characters.length ? o.characters : [{ name: '主角' } as Character, { name: '对手' } as Character];
  const hero = cast[0].name;
  const places = o.places.length ? o.places : pack.places;
  const clues = [pack.item[0], pack.rule[0], pack.history[0], ...pack.motifs];
  const total = Math.max(o.project.targetChapters, o.from + o.count - 1);
  const out: OutlineChapter[] = [];
  for (let i = 0; i < o.count; i++) {
    const index = o.from + i;
    const act = ACTS[Math.min(3, Math.floor(((index - 1) / total) * 4))];
    const other = cast[1 + ((index + i) % Math.max(1, cast.length - 1))]?.name ?? cast[0].name;
    const place = places[(index + Math.floor(r() * 3)) % places.length];
    const clue = clues[(index * 3 + i) % clues.length];
    const beats = BEAT_SHAPES[(index - 1) % BEAT_SHAPES.length](hero, other, place, clue);
    // 按章号轮转，避免同一批出现重名章节
    const m = pack.motifs[(index * 2 + i) % pack.motifs.length];
    const title = TITLE_SHAPES[(index * 3) % TITLE_SHAPES.length].replace('{m}', m).replace('{p}', place.slice(0, 3)).replace('{x}', clue).replace('{n}', String(index));
    const threadNames = o.threads.filter((_, k) => k === 0 || (index + k) % 3 === 0).map((t) => t.name);
    out.push({
      title,
      act,
      goal: `${hero}${index === 1 ? '被卷入事件，故事的问题被正式提出' : index === total ? '直面最终的选择，所有线索收束' : `在${place}推进关于「${clue}」的调查，并与${other}的关系发生变化`}`,
      beats,
      pov: hero,
      location: place,
      characters: [hero, other],
      threads: threadNames,
      hook: pick(r, [`一个本该死去的人出现在门口`, `${other}留下的纸条上只有三个字`, `${hero}发现自己被跟踪了很久`, `「${clue}」第一次出现了反应`, `真正的委托人另有其人`]),
    });
  }
  return JSON.stringify(out, null, 2);
}

// ─────────────────────────── 正文 ───────────────────────────

const OPENERS = ['就在这时，', '没过多久，', '直到后来，', '那一刻，', '他没有想到，', '事情的转折来得毫无征兆：', ''];

function sentencesOf(text: string): string[] {
  return text.match(/[^。！？!?\n]+[。！？!?]?[”」]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

function asNarration(beat: string): string {
  const b = beat.replace(/[。.]$/, '');
  return `${b}。`;
}

export function demoDraft(o: { project: Project; chapter: Chapter; characters: Character[]; tail?: string }): string {
  const pack = detectPack(o.project.genre + o.project.seed + o.project.premise);
  const r = seededRandom(hashString(o.chapter.id + Date.now().toString().slice(0, -5)));
  const bp = o.chapter.blueprint;
  const cast = o.characters.filter((c) => bp.characterIds.includes(c.id));
  const pov = bp.pov || cast[0]?.name || o.characters[0]?.name || '他';
  const other = cast.find((c) => c.name !== pov) ?? o.characters.find((c) => c.name !== pov);
  const place = bp.location || pick(r, pack.places);
  const senses = shuffle(r, pack.senses);
  const paras: string[] = [];

  paras.push(`${senses[0]}。${pov}站在${place}，${pick(r, ['很久没有动', '把手插进口袋里', '数着自己的呼吸', '看着远处出神'])}。${o.tail ? '刚才发生的事还压在胸口，' : ''}${pick(r, ['有些事一旦开始，就再也停不下来。', '他知道，今晚注定不会平静。', '一切都安静得过分。'])}`);

  const beats = bp.beats.length ? bp.beats : [bp.goal || `${pov}面对新的变化`];
  beats.forEach((beat, i) => {
    const opener = i === 0 ? '' : pick(r, OPENERS);
    paras.push(`${opener}${asNarration(beat)}${senses[(i + 1) % senses.length]}，${pov}${pick(r, ['下意识地屏住了呼吸', '的指尖微微发凉', '却忽然冷静下来', '想起了很久以前的一句话'])}。`);
    if (other && i % 2 === 0) {
      const line1 = pick(r, ['你早就知道，对不对？', '现在回头还来得及。', '你到底想要什么？', '别再装作什么都没发生。', '这件事，和你有关吗？']);
      const line2 = pick(r, ['知道又怎样？', '来不及了，从你打开它的那一刻起。', '我想要的，你给不起。', '我比你更希望什么都没发生。', '你问错人了。']);
      paras.push(`“${line1}”${pov}问。`);
      paras.push(`${other.name}${pick(r, ['沉默了很久', '笑了一下', '别过脸去', '没有立刻回答'])}。“${line2}”`);
    }
    paras.push(pick(r, [
      `${pov}没有说话。有些答案，问出口就会变成另一种东西。`,
      `那一瞬间，${pov}明白自己已经站在了某条线的另一边。`,
      `${senses[(i + 2) % senses.length]}。时间好像被拉得很长。`,
      `他把这件事记在心里，像把一枚钉子按进木头。`,
    ]));
    // 场景肌理：动作 + 心理 + 细节，让每个节拍都“落地”
    paras.push(
      pick(r, [
        `${pov}低头看了看自己的手。掌纹里还留着一点灰，像是从很远的地方带回来的。他想起小时候，有人教过他：害怕的时候就数数。一、二、三。数到三，事情就不会更坏。`,
        `他往前走了几步，又停下来。脚下的地板发出一声轻响，在寂静里显得格外刺耳。${senses[(i + 3) % senses.length]}。他忽然意识到，从踏进${place}的那一刻起，就有什么东西在暗处跟着他。`,
        `${pov}把所有的线索在脑子里重新排了一遍。它们像一堆散落的珠子，缺的正是穿起它们的那根线。他隐约觉得，那根线就在眼前，只是自己一直不敢伸手去碰。`,
        `很多年后，${pov}还会记得这个瞬间：${senses[(i + 4) % senses.length]}，他站在原地，心里有个声音说，走吧，别回头。可他的脚没有动。`,
      ]),
    );
  });

  if (bp.hook) paras.push(`${pick(r, ['就在他以为一切告一段落的时候——', '然而，', '可是那天夜里，'])}${bp.hook.replace(/[。.]$/, '')}。`);
  return paras.join('\n\n');
}

export function demoContinue(o: { project: Project; before: string; pov: string }): string {
  const pack = detectPack(o.project.genre + o.project.seed);
  const r = seededRandom(hashString(o.before.slice(-50) + Date.now()));
  const s = shuffle(r, pack.senses);
  const who = o.pov || '他';
  const endsWithBreak = /\n\s*$/.test(o.before) || !o.before.trim();
  return `${endsWithBreak ? '' : ''}${s[0]}。${who}${pick(r, ['往前走了一步，又停下', '回头看了一眼来时的路', '把那句话在心里又念了一遍', '握紧了口袋里的东西'])}。${pick(r, ['有什么正在靠近，他说不清是危险，还是答案。', '也许从一开始，他要找的就不是真相，而是一个理由。', `${s[1]}，像是某种回应。`])}`;
}

// ─────────────────────────── 审稿 ───────────────────────────

const ISSUE_BANK: { type: string; problem: string; suggestion: string }[] = [
  { type: '节奏', problem: '此处叙述节奏偏平，冲突出现前的铺垫略长。', suggestion: '压缩铺垫，用一个具体动作直接切入冲突。' },
  { type: '文笔', problem: '情绪以陈述方式告诉读者，缺少可感的细节。', suggestion: '改为展示：写出人物的一个小动作或身体反应。' },
  { type: '人物', problem: '对白偏功能化，人物的说话方式区分度不够。', suggestion: '给对白加入潜台词，让回答“答非所问”。' },
  { type: '张力', problem: '信息释放过早，削弱了悬念。', suggestion: '把关键信息推迟到章末，或只揭开一半。' },
  { type: '连贯', problem: '与上一段的时间或空间衔接略显突兀。', suggestion: '补一句过渡，交代时间流逝或位置变化。' },
];

export function demoCritique(o: { text: string; chapter: Chapter }): string {
  const r = seededRandom(hashString(o.text.slice(0, 200) + o.text.length));
  const sentences = sentencesOf(o.text).filter((s) => s.length >= 8);
  const score = () => Math.round((6 + r() * 3) * 10) / 10;
  const beats = o.chapter.blueprint.beats.map((beat, i) => {
    const key = beat.replace(/[，。]/g, '').slice(0, 6);
    const hit = sentences.find((s) => s.includes(key));
    const status = hit ? (i === 2 && r() > 0.5 ? 'uncertain' : 'done') : 'missing';
    return {
      beat,
      status,
      evidence: hit ? hit.slice(0, 40) : '正文中没有找到这个节拍真实发生的段落，目前只停留在准备阶段。',
    };
  });
  const quotes = shuffle(r, sentences).slice(0, 4);
  const issues = quotes.map((q, i) => {
    const t = ISSUE_BANK[(i + Math.floor(r() * 5)) % ISSUE_BANK.length];
    return { severity: i === 0 ? 'high' : i < 3 ? 'medium' : 'low', type: t.type, quote: q.slice(0, 40), problem: t.problem, suggestion: t.suggestion };
  });
  const result: CritiqueResult = {
    scores: { 节奏: score(), 人物: score(), 张力: score(), 文笔: score(), 连贯: score() },
    verdict: `本章完成了主要的叙事任务，氛围营造稳定。${beats.some((b) => b.status !== 'done') ? '但有节拍尚未真实落地，' : ''}中段张力略有松弛，建议在对白与细节上再下功夫。`,
    beats,
    issues,
    strengths: ['开场的感官细节迅速建立了氛围', '章末钩子干净有力', '主角的克制让情绪更可信'],
  };
  return JSON.stringify(result, null, 2);
}

export function demoRevise(o: { text: string; critique?: Critique; issueIds: string[]; project: Project }): string {
  const pack = detectPack(o.project.genre + o.project.seed);
  const r = seededRandom(hashString(o.text.length + ':' + o.issueIds.join()));
  let text = o.text;
  const issues = (o.critique?.issues ?? []).filter((i) => o.issueIds.includes(i.id));
  for (const issue of issues) {
    const idx = text.indexOf(issue.quote);
    if (idx < 0) continue;
    const sense = pick(r, pack.senses);
    const replacement =
      issue.type === '节奏'
        ? issue.quote.replace(/^[^，]*，/, '')
        : issue.type === '人物'
          ? `${issue.quote.replace(/[。！？]$/, '')}——话说到一半，又咽了回去。`
          : `${sense}。${issue.quote}`;
    text = text.slice(0, idx) + replacement + text.slice(idx + issue.quote.length);
  }
  const missing = (o.critique?.beats ?? []).filter((b) => b.status !== 'done');
  if (missing.length) {
    const parts = text.split('\n\n');
    const insertAt = Math.max(1, parts.length - 1);
    parts.splice(insertAt, 0, ...missing.map((b) => `${b.beat.replace(/[。.]$/, '')}。这一次，没有人能再假装它没有发生。`));
    text = parts.join('\n\n');
  }
  if (!issues.length && !missing.length) text = text.replace(/。/, `。${pick(r, pack.senses)}。`);
  return text;
}

// ─────────────────────────── 提炼 ───────────────────────────

export function demoExtract(o: { project: Project; chapter: Chapter; text: string; characters: Character[]; threads: Thread[] }): string {
  const bp = o.chapter.blueprint;
  const cast = o.characters.filter((c) => bp.characterIds.includes(c.id) || o.text.includes(c.name)).slice(0, 3);
  const summary = (bp.beats.length ? bp.beats.join('；') : sentencesOf(o.text).slice(0, 3).join('')).slice(0, 120) + '。';
  const prev = o.project.storySoFar ? o.project.storySoFar.replace(/。?$/, '。') : '';
  const storySoFar = (prev + `第${o.chapter.index}章，${summary}`).slice(-300);
  const result: ExtractionResult = {
    summary,
    storySoFar,
    characterUpdates: cast.map((c, i) => ({
      name: c.name,
      location: bp.location || c.state.location || '未知',
      condition: ['疲惫但清醒', '心事重重', '压抑着怒意', '第一次感到动摇'][(o.chapter.index + i) % 4],
      knowledge: bp.beats[i % Math.max(1, bp.beats.length)] ?? c.state.knowledge,
      change: `${c.name}在本章${['做出了第一个真正的选择', '得知了一部分真相', '与他人的关系出现裂痕', '开始怀疑自己的判断'][(o.chapter.index + i) % 4]}。`,
    })),
    newCharacters: [],
    worldFacts: bp.location && !o.text.includes('（已知地点）') ? [{ category: '地点', name: bp.location, content: `第${o.chapter.index}章的主要场景：${sentencesOf(o.text).find((s) => s.includes(bp.location))?.slice(0, 60) ?? '故事在此发生转折。'}` }] : [],
    threadProgress: o.threads
      .filter((t) => bp.threadIds.includes(t.id))
      .map((t) => ({ thread: t.name, progress: bp.goal || '线索向前推进了一步', resolved: false })),
  };
  return JSON.stringify(result, null, 2);
}

// ─────────────────────────── 缪斯 ───────────────────────────

const POLISH: [RegExp, string][] = [
  [/突然/g, '蓦地'], [/慢慢地?/g, '缓缓'], [/非常/g, '分外'], [/很快/g, '转瞬'], [/看着/g, '望着'],
  [/觉得/g, '只觉'], [/走了过去/g, '踱了过去'], [/说道/g, '低声道'], [/很/g, '极'], [/然后/g, '随即'],
];

const SHOW: [RegExp, string][] = [
  [/(很|非常|十分)?(生气|愤怒)/g, '指节捏得发白'], [/(很|非常|十分)?(害怕|恐惧)/g, '后颈一阵发凉'],
  [/(很|非常|十分)?(难过|伤心)/g, '喉咙像被什么堵住'], [/(很|非常|十分)?(紧张)/g, '掌心沁出一层薄汗'],
  [/(很|非常|十分)?(高兴|开心)/g, '嘴角压不住地扬起'],
];

export function demoMuse(o: { action: MuseAction; selection: string; project: Project; instruction: string }): string {
  const pack = detectPack(o.project.genre + o.project.seed);
  const r = seededRandom(hashString(o.selection + o.action + Date.now()));
  const s = sentencesOf(o.selection);
  switch (o.action) {
    case 'expand':
      return s.map((x) => `${x}${pick(r, pack.senses)}。`).join('');
    case 'condense':
      return s.length > 1 ? s.filter((_, i) => i % 2 === 0).join('') : o.selection.replace(/[，,][^，,]*$/, '。');
    case 'polish':
      return POLISH.reduce((t, [re, rep]) => t.replace(re, rep), o.selection);
    case 'show': {
      const shown = SHOW.reduce((t, [re, rep]) => t.replace(re, rep), o.selection);
      return shown === o.selection ? `${o.selection.replace(/[。]$/, '')}，${pick(r, ['却没有人开口', '他的手在身侧慢慢攥紧', '呼吸比刚才重了一些'])}。` : shown;
    }
    case 'dialogue':
      return o.selection.replace(/“([^”]+)”/g, (_m, line: string) => `“${line.replace(/[。！？]$/, '')}……${pick(r, ['算了。', '你不会懂的。', '随你。', '我只说一次。'])}”`);
    case 'tone':
      return `${pick(r, pack.senses)}。${POLISH.reduce((t, [re, rep]) => t.replace(re, rep), o.selection)}`;
    default:
      return `${POLISH.reduce((t, [re, rep]) => t.replace(re, rep), o.selection)}`;
  }
}

// ─────────────────────────── 访谈 & 文风 ───────────────────────────

export function demoInterview(o: { character: Character; question: string }): string {
  const c = o.character;
  const q = o.question;
  const r = seededRandom(hashString(q + c.id));
  const gesture = pick(r, ['（沉默了一会儿）', '（低头看着自己的手）', '（笑了笑，没有马上回答）', '（望向窗外）']);
  if (/想要|目标|为什么|愿望|追求/.test(q)) return `${gesture}我想要的？${c.desire || '说出来就不灵了。'}……不过，你为什么突然问这个？`;
  if (/怕|恐惧|过去|伤|秘密|后悔/.test(q)) return `${gesture}有些事，我不想再提。${c.wound ? `如果你非要知道——${c.wound.replace(/[他她]/g, '我').replace(/[。.]$/, '')}。` : ''}满意了吗？`;
  if (/喜欢|爱|在乎|朋友|信任/.test(q)) return `${gesture}在乎的人……我不太会说这种话。你问别的吧。`;
  if (/你是谁|介绍|自己/.test(q)) return `${gesture}${c.summary || `我叫${c.name}。`}${c.personality ? `别人说我${c.personality.split(/[，、]/)[0]}，我不在乎。` : ''}`;
  return `${gesture}${pick(r, ['这个问题，我得想想。', '你问得太直接了。', '我不确定该不该告诉你。'])}${c.voice ? '' : ''}${c.need ? `也许……我需要的，和我以为的不一样。` : ''}`;
}

export function demoStyle(sample: string): string {
  const sentences = sentencesOf(sample);
  const avg = sentences.length ? Math.round(sample.replace(/\s/g, '').length / sentences.length) : 20;
  const dialogue = (sample.match(/“/g)?.length ?? 0) / Math.max(1, sentences.length);
  const result: StyleAnalysis = {
    voice: avg < 18 ? '短句为主、干净利落的叙述' : '舒展绵长、富有韵律的叙述',
    pov: /我/.test(sample.slice(0, 200)) ? '第一人称' : '第三人称有限视角',
    tense: '过去时',
    tone: dialogue > 0.3 ? '对话驱动、轻快' : '内敛、以描写见长',
    rules: [
      `平均句长约 ${avg} 字，保持${avg < 18 ? '短促' : '舒缓'}的节奏`,
      dialogue > 0.3 ? '对白占比高，用对白推进情节' : '对白克制，以动作与细节推进',
      '避免形容词堆叠，一处细节胜过三个形容词',
      '段落结尾常落在一个具体的画面上',
    ],
  };
  return JSON.stringify(result, null, 2);
}
