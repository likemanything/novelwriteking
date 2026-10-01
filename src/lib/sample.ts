/**
 * 示例作品《雾港邮差》：首次打开时自动放上书架，
 * 让新用户立刻看到一部“正在写”的书——有定稿、有草稿、有审稿、有待确认的提案。
 */
import { db } from './db';
import { blankCharacter, blankThread, blankWorld, emptyBlueprint, makeCover } from './repo';
import type { Chapter, Critique, DailyWords, Project, Proposal, Version } from './types';
import { countWords, seededRandom, uid } from './util';

const CH1 = `雾港的秋天是从雾开始的。

凌晨两点，邮政分拣中心只剩林澈一个人。传送带停了，日光灯管在头顶嗡嗡作响，像一只困在玻璃里的虫。他把最后一袋平信倒在台面上，按街区一封一封地分——梧桐里、北岸、老码头——手比脑子快，这份工作他做了七年。

那封信是从一叠广告单里滑出来的。

牛皮纸信封，没有邮票，没有邮戳。收信人一栏写着：林澈 收。

他的手停在半空。

那笔迹他认得。“澈”字右边那一撇，总是拖得很长，像一个人走着走着回过头来。十年前，哥哥在他的作业本上签家长名，签的就是这样的字。

林澈把信封翻过来，又翻回去。一、二、三。他在心里数。数到三的时候，他撕开了封口。

信纸只有一张，折成三折。上面只有一句话：

“澈，别在门外等。”

窗外的雾贴着玻璃，一层一层地压过来，把路灯揉成一团昏黄。那天晚上也是这样的雾。仓库的火烧红了半边天，他站在门外，手放在门把上——

三秒。他只犹豫了三秒。

“谁在开玩笑？”他对着空荡荡的分拣中心说。没有人回答。传送带尽头的旧邮筒安静地立着，投信口黑洞洞的，像一张没说完话的嘴。

他把信塞进制服内袋，贴着胸口。天亮前，他又把它拿出来看了四次。

字迹没有变，句子也没有变。只有信纸边缘，有一点淡淡的焦痕。

早上七点，林澈交了班，没有回家。他骑车穿过半个雾港，去找唯一可能知道答案的人——退休的老邮差周伯。在雾港，没有哪封信的来历是周伯不知道的。

周伯的小屋在老码头边上。林澈到的时候，门虚掩着，炉子上的水壶早已烧干。

屋里没有人。`;

const CH1_DRAFT = CH1.replace('像一个人走着走着回过头来', '很有特点')
  .replace('窗外的雾贴着玻璃，一层一层地压过来，把路灯揉成一团昏黄。那天晚上也是这样的雾。', '林澈忽然觉得很冷，他想起了那天晚上。')
  .replace('\n\n字迹没有变，句子也没有变。只有信纸边缘，有一点淡淡的焦痕。', '');

const CH2 = `屋里的东西都还在原处。老花镜压在一份没看完的报纸上，茶杯里的茶已经凉透，杯沿落了一层薄灰。只有墙角那只绿色的邮包不见了——周伯出门从来不背它，退休后更不会。

林澈在桌子抽屉里找到了那本投递簿。

蓝色硬皮，边角磨得发白。周伯当了四十年邮差，每一封经手的挂号信都记在上面：日期、地址、收件人、签收时间。字迹工整得像印刷的。林澈一页一页往后翻，翻到最后一页，手指停住了。

最后一行没有日期，只有一个地址：

梧桐里 17½ 号。

梧桐里他送了七年信，17号后面就是19号，从来没有什么“二分之一”。

“找到什么了？”

门口的光被一个人挡住。那人个子很高，风衣领子竖着，手里夹着一支没点的烟。

“顾衡，刑侦二队。”他亮了一下证件，又收回去，“周德海的邻居报了失踪。你是最后一个来找他的人。”

“我今天才来。”

“我知道。”顾衡走进屋，目光在投递簿上停了一瞬，“所以我想知道，你为什么今天来。”

林澈没有回答。他想起内袋里那封信，隔着制服，像一块烧过的炭。

问话在派出所进行了两个小时。顾衡问得很慢，也很细：几点出门，走哪条路，和周伯多久没见。直到最后，他才像随口一提似的说：

“你哥哥的案子，已经结了。”

林澈抬起头。

“十年了。”顾衡把那支烟放回烟盒，“有些东西，翻出来对谁都没有好处。”

“你怎么知道我在翻？”

顾衡看着他，没有笑。“因为十年前，你也是这副表情。”

林澈回到家时已是傍晚。雾又起来了，楼道里的声控灯亮了又灭。他掏钥匙的时候，脚下踩到了什么。

门缝里，塞着第二封信。`;

const CH3 = `第二封信比第一封更短：

“雾最浓的晚上，去北岸灯塔。”

雾港的人都知道，北岸灯塔三十年前就熄了。林澈等了三天，等到天气预报说“能见度不足五十米”的那一晚，才骑车出了门。

北岸的路没有灯。雾很浓，浓得像能用手捧起来。他推着车走了很久，直到听见海浪的声音，才看见那座灯塔的影子——一截灰白的石柱，孤零零地立在礁石上。

塔下的小屋亮着一盏煤油灯。

“你迟到了。”

开门的是一个年轻女人，穿着一件过大的旧雨衣，头发湿漉漉地贴在额头上。她打量了他一眼，语气平淡得像在念天气预报：“今晚东南风三级，雾会持续到凌晨四点。进来吧，外面冷。”

“你知道我要来？”

“每个收到雾信的人，最后都会来这里。”她给他倒了一杯热水，“我叫沈雾。这座灯塔归我管。”

林澈很紧张。他觉得这个女人知道很多事情。

沈雾告诉他，雾港有一个很老的传说：在大雾的夜里，把信投进旧邮筒，它就会被送到“该收到的人”手里——不管那个人在哪里，也不管写信的人还在不在。

“你信吗？”林澈问。

“我信雾。”沈雾说，“雾不会说谎，它只是把东西藏起来。”

他们爬上灯塔顶层。旋梯锈得厉害，每一步都发出呻吟。顶层的玻璃罩早碎了，海风灌进来，带着咸腥的凉意。林澈的手电扫过地面，停住了。

积灰的地板上，有一个湿脚印。很新，边缘的水还没干。

“今晚还有别人来过？”

沈雾没有回答。她走到栏杆边，望着雾里看不见的海面，过了很久才开口：

“你哥哥十年前也来过这里。就站在你现在站的位置。”`;

let seeding: Promise<string> | null = null;

/** 幂等：并发调用（如 React 严格模式下的双重副作用）只会创建一次。 */
export function seedSampleProject(): Promise<string> {
  seeding ??= createSample().finally(() => setTimeout(() => (seeding = null), 1000));
  return seeding;
}

async function createSample(): Promise<string> {
  const now = Date.now();
  const day = 86400000;
  const pid = uid('p_');
  const title = '雾港邮差';

  const project: Project = {
    id: pid,
    title,
    logline: '雾港的夜班邮差收到一封署名十年前死去的哥哥的信——他必须在第十年忌日前找到写信人，否则那场大火的真相将永远沉入海雾。',
    premise:
      '雾港每年秋天起雾九十天。夜班邮差林澈在分拣中心发现一封没有邮戳、写给自己的信，笔迹属于十年前死于码头大火的哥哥林溯。退休老邮差周伯随即失踪，只留下一本记着不存在门牌号的投递簿。刑警顾衡警告他别碰旧案，灯塔守夜人沈雾却告诉他“雾信”的传说。林澈越接近写信人，越发现那场大火并非意外——而真相的最后一块，藏在他自己不敢回想的“三秒”里。',
    seed: '一个邮差发现，自己每天投递的信里，有一封来自十年前已经去世的人。',
    genre: '悬疑 · 奇幻',
    tags: ['悬疑', '雾', '旧案', '兄弟', '轻奇幻'],
    targetChapters: 24,
    targetWords: 3000,
    style: {
      voice: '冷色调、贴近人物的第三人称有限视角',
      pov: '林澈',
      tense: '过去时，短句为主',
      tone: '阴郁克制，余味悠长',
      rules: ['情绪通过动作与细节展示，不直接说“他很紧张”', '雾是贯穿全书的意象，每章至少出现一次新的写法', '对白多用回避与沉默，少解释', '每章结尾停在一个具体的画面上'],
      sample: '',
    },
    storySoFar:
      '夜班邮差林澈在分拣中心发现一封没有邮戳的信，笔迹属于十年前死于码头大火的哥哥林溯，信中只写“澈，别在门外等”。他去找老邮差周伯，却发现周伯已失踪，只留下一本投递簿，最后一页写着不存在的地址“梧桐里17½号”。刑警顾衡以失踪案为由问话，并警告他不要翻旧案。当晚，林澈家门缝里出现了第二封信。',
    cover: { ...makeCover(title + '样例'), hue: 205, pattern: 'rain' },
    createdAt: now - 21 * day,
    updatedAt: now - 2 * 3600000,
  };

  const chars = [
    blankCharacter(pid, 0, {
      name: '林澈',
      role: '主角',
      summary: '雾港的夜班邮差，做了七年，话少，习惯把事情咽回去。',
      appearance: '清瘦，眉眼淡，左手腕有一道旧烫疤',
      personality: '敏锐、隐忍、固执；紧张时会在心里数数',
      desire: '找到写信的人',
      need: '原谅当年在火场门外犹豫的自己',
      wound: '十年前大火那晚，他在仓库门外犹豫了三秒',
      voice: '短句，爱用反问，很少说完整的理由',
      arc: '从“别人的信我只负责送”到亲手打开自己的门',
      color: '#35607f',
      provenance: 'author',
      state: { location: '梧桐里的家中', condition: '失眠，紧绷', knowledge: '收到两封署名哥哥的信；周伯留下“梧桐里17½号”', sourceChapter: 2 },
    }),
    blankCharacter(pid, 1, {
      name: '沈雾',
      role: '伙伴',
      summary: '北岸废弃灯塔的守夜人，知道很多关于雾的事。',
      appearance: '总穿一件过大的旧雨衣，头发常是湿的',
      personality: '平静、疏离、偶尔一针见血',
      desire: '让灯塔重新亮起来',
      need: '停止替别人保守秘密',
      wound: '她的母亲在一个起雾的夜里走进了海',
      voice: '说话像念天气预报，平铺直叙，却藏着判断',
      arc: '从旁观者到同行者',
      color: '#3f8a6b',
      provenance: 'author',
    }),
    blankCharacter(pid, 2, {
      name: '顾衡',
      role: '对手',
      summary: '刑侦二队队长，十年前大火案的年轻经办警员。',
      appearance: '高个，风衣领子总竖着，手里常夹一支不点的烟',
      personality: '耐心、克制、极度自律',
      desire: '让旧案停在结案报告里',
      need: '承认那份报告是错的',
      wound: '他在只有两页的结案报告上签了字',
      voice: '语速很慢，从不提高声音，问题比回答多',
      arc: '从守住报告到亲手推翻它',
      color: '#6a5a9a',
      provenance: 'author',
      state: { location: '刑侦二队', condition: '戒备', knowledge: '林澈在找周伯，可能也在翻旧案', sourceChapter: 2 },
    }),
    blankCharacter(pid, 3, {
      name: '周伯',
      role: '导师',
      summary: '退休的老邮差周德海，雾港每封信的来历他都知道。',
      appearance: '白发，驼背，惯用左手写字',
      personality: '温和、狡黠，喜欢打比方',
      desire: '把一封迟到十年的信送到',
      need: '说出自己看见的事',
      wound: '大火那晚，他就在码头',
      voice: '说话像讲故事，常以“你知道吗”开头',
      arc: '以缺席的方式完成传承',
      color: '#a2643a',
      provenance: 'author',
      state: { location: '下落不明', condition: '失踪', knowledge: '', sourceChapter: 1 },
    }),
    blankCharacter(pid, 4, {
      name: '许曼',
      role: '变数',
      summary: '港务商会的年轻会长，林溯当年的恋人。',
      appearance: '衣着考究，戴一枚旧式男戒',
      personality: '得体、精明，情绪从不写在脸上',
      desire: '保住商会，也保住林溯的名声',
      need: '面对自己当年的选择',
      wound: '大火前一晚，她和林溯大吵一架',
      voice: '礼貌周全，句句留余地',
      arc: '从掩护者到证人',
      color: '#a3345a',
      provenance: 'author',
    }),
  ];
  const [lin, shen, gu, zhou, xu] = chars;

  const world = [
    blankWorld(pid, { category: '地点', name: '雾港', content: '港城，每年秋天起雾九十天。雾里的声音会传得很远，人却看不清三步以外。', keywords: ['雾港'] }),
    blankWorld(pid, { category: '地点', name: '梧桐里', content: '老城区的一条巷子，林家旧居在17号。巷子一半已拆迁，门牌从17号直接跳到19号。', keywords: ['梧桐里', '17号'] }),
    blankWorld(pid, { category: '地点', name: '北岸灯塔', content: '废弃三十年的灯塔，立在北岸礁石上，由沈雾看守。顶层玻璃罩已碎。', keywords: ['灯塔', '北岸'] }),
    blankWorld(pid, { category: '规则', name: '雾信', content: '传说在大雾的夜里投进旧邮筒的信，会被送到“该收到的人”手里——不管写信的人还在不在。', keywords: ['雾信', '旧邮筒'] }),
    blankWorld(pid, { category: '历史', name: '码头大火', content: '十年前北岸仓库大火，七人遇难，其中包括林澈的哥哥林溯。结案报告只有两页，结论为电路老化。', keywords: ['大火', '仓库', '火场'] }),
    blankWorld(pid, { category: '物品', name: '投递簿', content: '周伯留下的蓝皮投递簿，记着四十年的挂号信。最后一页写着“梧桐里 17½ 号”。', keywords: ['投递簿'] }),
    blankWorld(pid, { category: '势力', name: '港务商会', content: '掌管雾港码头的商会，大火后迅速重建了北岸仓库区。现任会长许曼。', keywords: ['商会'] }),
  ];

  const threads = [
    blankThread(pid, 0, { name: '谁在写信', kind: 'main', color: '#c23a2b', description: '署名林溯的信是谁写的？信里的话为何只有哥哥知道？', progress: '第二封信出现，约他去北岸灯塔' }),
    blankThread(pid, 1, { name: '大火真相', kind: 'mystery', color: '#d49a2a', description: '十年前的码头大火是意外还是谋杀？报告为何只有两页？', progress: '顾衡警告林澈不要碰旧案' }),
    blankThread(pid, 2, { name: '周伯的下落', kind: 'mystery', color: '#a2643a', description: '周伯为什么失踪？17½号在哪里？' }),
    blankThread(pid, 3, { name: '林澈与沈雾', kind: 'romance', color: '#3f8a6b', description: '两个都习惯独自守夜的人，能否把门为彼此打开？' }),
    blankThread(pid, 4, { name: '门外的三秒', kind: 'arc', color: '#35607f', description: '林澈能否原谅那晚在门外犹豫的自己？', progress: '信中“别在门外等”刺中了他' }),
  ];
  const [tMain, tFire, tZhou, tRomance, tArc] = threads;

  const plan: { title: string; act: string; goal: string; beats: string[]; location: string; cast: string[]; th: string[]; hook: string }[] = [
    { title: '没有邮戳的信', act: '第一卷 · 雾起', goal: '林澈收到亡兄的来信，故事的核心问题被提出', beats: ['林澈在夜班分拣时发现一封没有邮戳、寄给自己的信', '信封上是哥哥林溯的笔迹', '信里只有一句话：“澈，别在门外等。”', '林澈天亮后去找周伯'], location: '邮政分拣中心', cast: [lin.id, zhou.id], th: [tMain.id, tArc.id], hook: '周伯的小屋门开着，人不见了' },
    { title: '周伯的投递簿', act: '第一卷 · 雾起', goal: '周伯失踪，林澈得到第一条线索，并与顾衡交锋', beats: ['林澈在小屋发现周伯的投递簿', '最后一页写着“梧桐里17½号”', '顾衡以失踪案为由带林澈问话', '顾衡警告他不要碰旧案'], location: '老码头周伯的小屋', cast: [lin.id, gu.id, zhou.id], th: [tZhou.id, tFire.id], hook: '门缝里塞着第二封信' },
    { title: '北岸灯塔', act: '第一卷 · 雾起', goal: '林澈结识沈雾，得知“雾信”的传说，主线与哥哥直接相连', beats: ['第二封信约他“雾最浓的晚上，去灯塔”', '林澈在灯塔遇到守夜人沈雾', '沈雾说出“雾信”的传说', '灯塔顶层有人留下一个湿脚印'], location: '北岸灯塔', cast: [lin.id, shen.id], th: [tMain.id, tRomance.id], hook: '沈雾说：你哥哥十年前也来过这里' },
    { title: '两页纸的报告', act: '第一卷 · 雾起', goal: '林澈查到大火案报告的漏洞，与顾衡正面对峙', beats: ['林澈去档案室调阅大火案', '报告只有两页，签字人是顾衡', '档案管理员暗示有人在他之前借阅过', '林澈与顾衡在雨里对峙'], location: '市档案馆', cast: [lin.id, gu.id], th: [tFire.id], hook: '顾衡说出：那天仓库里，有第八个人' },
    { title: '戴男戒的女人', act: '第二卷 · 雾深', goal: '许曼登场，揭开林溯生前不为人知的一面', beats: ['林澈在商会酒会上见到许曼', '许曼手上戴着林溯的戒指', '许曼承认大火前一晚和林溯吵过架', '许曼请林澈停止调查'], location: '港务商会大楼', cast: [lin.id, xu.id], th: [tFire.id, tMain.id], hook: '林澈在酒会签到簿上看到了哥哥的笔迹' },
    { title: '十七又二分之一号', act: '第二卷 · 雾深', goal: '林澈与沈雾找到17½号，周伯的线索浮出水面', beats: ['沈雾提出在大雾夜里去梧桐里', '雾中17号与19号之间多出一扇门', '门后是周伯的临时住处，空无一人', '墙上贴满了大火当晚的旧报纸'], location: '梧桐里', cast: [lin.id, shen.id], th: [tZhou.id, tRomance.id], hook: '报纸的一张照片里，有少年林澈的背影' },
    { title: '雾里的声音', act: '第二卷 · 雾深', goal: '林澈直面“三秒”的记忆', beats: ['林澈独自回到重建后的仓库区', '雾里传来哥哥喊他名字的声音', '闪回：大火那晚门后的真相片段', '沈雾找到昏倒的林澈'], location: '北岸仓库区', cast: [lin.id, shen.id], th: [tArc.id, tRomance.id], hook: '林澈醒来，枕边放着第三封信' },
    { title: '第八个人', act: '第二卷 · 雾深', goal: '顾衡与林澈暂时联手，追查第八个人', beats: ['顾衡带来一份被撕掉的笔录', '笔录中提到一个穿邮差制服的人', '两人怀疑周伯', '周伯的邮包在海边被发现'], location: '刑侦二队', cast: [lin.id, gu.id], th: [tFire.id, tZhou.id], hook: '邮包里装满了从未寄出的信，收信人都是林澈' },
  ];

  const chapters: Chapter[] = plan.map((p, i) => ({
    id: uid('ch_'),
    projectId: pid,
    index: i + 1,
    title: p.title,
    act: p.act,
    blueprint: { ...emptyBlueprint(), goal: p.goal, beats: p.beats, pov: '林澈', location: p.location, characterIds: p.cast, threadIds: p.th, hook: p.hook },
    status: 'planned',
    summary: '',
    words: 0,
    updatedAt: now - (8 - i) * day,
  }));

  const mkVersion = (ch: Chapter, kind: Version['kind'], label: string, content: string, ago: number, parentId?: string): Version => ({
    id: uid('v_'),
    projectId: pid,
    chapterId: ch.id,
    kind,
    label,
    content,
    words: countWords(content),
    parentId,
    createdAt: now - ago,
    updatedAt: now - ago,
  });

  const [c1, c2, c3] = chapters;
  const v1a = mkVersion(c1, 'draft', 'AI 草稿', CH1_DRAFT, 9 * day);
  const v1b = mkVersion(c1, 'revision', '修订稿 · 采纳 2 条意见', CH1, 8 * day, v1a.id);
  const v2 = mkVersion(c2, 'draft', 'AI 草稿', CH2, 5 * day);
  const v3 = mkVersion(c3, 'draft', 'AI 草稿', CH3, 3 * 3600000);
  Object.assign(c1, { status: 'final', workingVersionId: v1b.id, canonVersionId: v1b.id, words: v1b.words, summary: '林澈在夜班分拣时发现一封没有邮戳的信，笔迹属于十年前死于大火的哥哥，信中只写“澈，别在门外等”。天亮后他去找老邮差周伯，发现小屋空无一人。' });
  Object.assign(c2, { status: 'final', workingVersionId: v2.id, canonVersionId: v2.id, words: v2.words, summary: '林澈在周伯小屋找到投递簿，最后一页写着“梧桐里17½号”。刑警顾衡以失踪案问话，并警告他别碰旧案。当晚门缝里出现第二封信。' });
  Object.assign(c3, { status: 'review', workingVersionId: v3.id, words: v3.words, updatedAt: now - 3 * 3600000 });

  const critique: Critique = {
    id: uid('cr_'),
    projectId: pid,
    chapterId: c3.id,
    versionId: v3.id,
    createdAt: now - 2.5 * 3600000,
    scores: { 节奏: 7.5, 人物: 8.2, 张力: 6.8, 文笔: 7.4, 连贯: 8.6 },
    verdict: '氛围营造出色，沈雾“像念天气预报”的出场很有记忆点。但中段以转述交代“雾信”，信息密度偏高；湿脚印的发现略显仓促，张力没有充分酝酿。',
    beats: [
      { beat: '第二封信约他“雾最浓的晚上，去灯塔”', status: 'done', evidence: '“雾最浓的晚上，去北岸灯塔。”' },
      { beat: '林澈在灯塔遇到守夜人沈雾', status: 'done', evidence: '“我叫沈雾。这座灯塔归我管。”' },
      { beat: '沈雾说出“雾信”的传说', status: 'done', evidence: '把信投进旧邮筒，它就会被送到“该收到的人”手里' },
      { beat: '灯塔顶层有人留下一个湿脚印', status: 'uncertain', evidence: '脚印出现了，但没有交代它的朝向或大小，“有人来过”的暗示尚未落地。' },
    ],
    issues: [
      { id: uid('is_'), severity: 'high', type: '文笔', quote: '林澈很紧张。他觉得这个女人知道很多事情。', problem: '直接告诉读者情绪，与全书“展示而非告知”的守则相悖。', suggestion: '用他数数的习惯、握紧杯子的手或回避对视来展示紧张。' },
      { id: uid('is_'), severity: 'medium', type: '节奏', quote: '沈雾告诉他，雾港有一个很老的传说', problem: '关键设定以转述带过，削弱了传说本身的神秘感。', suggestion: '让沈雾只说一半，把“不管写信的人还在不在”留给林澈自己追问出来。' },
      { id: uid('is_'), severity: 'medium', type: '张力', quote: '积灰的地板上，有一个湿脚印。', problem: '发现来得太快，缺少铺垫与人物反应。', suggestion: '爬旋梯时先加入一个异响或气味，让读者先于林澈感到不安。' },
      { id: uid('is_'), severity: 'low', type: '连贯', quote: '林澈等了三天', problem: '这三天里他是否照常上班、有没有再见顾衡，没有交代。', suggestion: '用一句话带过这三天，顺手埋下“被跟踪”的伏笔。' },
    ],
    strengths: ['沈雾的说话方式让人物一出场就立住了', '结尾一句把主线与哥哥直接相连，钩子有力', '“雾不会说谎，它只是把东西藏起来”可以成为全书的题眼'],
  };

  const proposals: Proposal[] = [
    { id: uid('pr_'), projectId: pid, chapterId: c2.id, chapterIndex: 2, kind: 'world-fact', title: '新设定：17½号', detail: '周伯投递簿最后一页出现的地址“梧桐里17½号”，现实中并不存在，17号之后直接是19号。', payload: { category: '地点', name: '梧桐里17½号', content: '周伯投递簿最后一页出现的地址，现实中并不存在：17号之后直接是19号。' }, status: 'pending', createdAt: now - 5 * day },
    { id: uid('pr_'), projectId: pid, chapterId: c2.id, chapterIndex: 2, kind: 'thread-progress', title: '故事线推进：周伯的下落', detail: '周伯失踪，邮包不见了，只留下投递簿。', payload: { threadId: tZhou.id, progress: '周伯失踪，邮包不见了，只留下投递簿', resolved: false }, status: 'pending', createdAt: now - 5 * day },
    { id: uid('pr_'), projectId: pid, chapterId: c2.id, chapterIndex: 2, kind: 'character-state', title: '周伯的状态变化', detail: '邻居报了失踪，顾衡已立案。', payload: { characterId: zhou.id, before: zhou.state, after: { location: '下落不明（邮包一同消失）', condition: '失踪，已立案', knowledge: '可能知道17½号的秘密', sourceChapter: 2 } }, status: 'pending', createdAt: now - 5 * day },
  ];

  // 近 10 周的写作记录，让热力图有温度
  const r = seededRandom(20260930);
  const daily: DailyWords[] = [];
  for (let i = 1; i <= 70; i++) {
    if (r() < 0.42) continue;
    const d = new Date(now - i * day);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    daily.push({ id: `${pid}:${date}`, projectId: pid, date, words: Math.round(300 + r() * 3200) });
  }

  await db.transaction('rw', [db.projects, db.characters, db.world, db.threads, db.chapters, db.versions, db.critiques, db.proposals, db.daily], async () => {
    await db.projects.add(project);
    await db.characters.bulkAdd(chars);
    await db.world.bulkAdd(world);
    await db.threads.bulkAdd(threads);
    await db.chapters.bulkAdd(chapters);
    await db.versions.bulkAdd([v1a, v1b, v2, v3]);
    await db.critiques.add(critique);
    await db.proposals.bulkAdd(proposals);
    await db.daily.bulkAdd(daily);
  });
  return pid;
}
