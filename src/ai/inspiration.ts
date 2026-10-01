/**
 * 随机灵感：
 * - 接入了模型时，由「构思」环节的模型现场写一句，并避开最近出现过的；
 * - 没有模型（或请求失败）时，用「身份 × 处境 × 转折」的组合生成器兜底——不是固定的几条，而是上万种组合。
 */
import { profileFor } from '@/cloud/models';
import { streamChat } from './client';

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const WHO = ['一个邮差', '退休的灯塔守护人', '刚入职的实习法医', '末代皇帝的御厨', '只在夜里营业的花店老板', '总是迟到的时间管理员', '被贬下凡的龙王', '会修钟表的盲人', '没有影子的转校生', '替人哭丧的少年', '最后一位说书人', '火星殖民地的第一任邮局局长', '专门替亡者寄信的快递员', '记不住自己名字的侦探', '继承了当铺的孙女', '修仙界的外卖小哥', '深海站里唯一的值班员', '每天重复同一天的出租车司机', '能听见建筑说话的设计师', '为机器人读童话的图书管理员'];
const SITUATION = ['发现自己投递的信里，有一封来自十年前已去世的人', '在暴雨夜收到一张写着自己死亡时间的车票', '接手了一家只收「记忆」的当铺', '被困在一座每晚都会换一个楼层的旅馆里', '醒来后发现全城的人都忘了她', '意外送错了一单天劫', '发现自己的日记每天会被人悄悄续写', '在老城区深夜食堂里，遇见了三年前失踪的客人', '受托保管一座只在雾天出现的岛', '每说一次谎，城里就会下一场雪', '收到外星信号，内容是一首童谣', '在一场没有新郎的婚礼上担任司仪', '翻出祖母留下的旧地图，上面标着自己家的位置', '发现镜子里的自己比现实慢了一秒'];
const TWIST = ['而真正的收信人，其实是他自己。', '可没有人相信，因为这座城市从来没有出过这个人。', '代价是，每解开一个谜，他就会忘记一位亲人。', '直到她发现，所有线索都指向十年前的自己。', '但这一切，只是另一个人写下的小说。', '而唯一能帮他的，是他最想躲开的那个人。', '于是他必须在日出之前，把一个秘密带到海的另一边。', '而这座城市的地图，正在悄悄改变。', '可最危险的，是那个一直在帮她的人。', '没想到，这竟是一场写给全人类的告别。'];
const FORMS = [
  (a: string, b: string, c: string) => `${a}${b}，${c}`,
  (a: string, b: string, c: string) => `${a}${b}。${c}`,
  (a: string, b: string, c: string) => `${a}${b}——${c}`,
];

/** 组合出一句灵感。 */
export function composeInspiration(avoid: string[] = []): string {
  for (let i = 0; i < 12; i++) {
    const s = pick(FORMS)(pick(WHO), pick(SITUATION), pick(TWIST));
    if (!avoid.includes(s)) return s;
  }
  return pick(FORMS)(pick(WHO), pick(SITUATION), pick(TWIST));
}

export function composeMany(n: number): string[] {
  const out: string[] = [];
  while (out.length < n) out.push(composeInspiration(out));
  return out;
}

const NUDGES = ['悬疑', '奇幻', '科幻', '都市', '古风', '治愈', '末日', '职场', '校园', '民国', '海洋', '童话', '武侠', '赛博朋克', '家庭'];
const recent: string[] = [];

const clean = (t: string) =>
  t
    .trim()
    .replace(/^[「“"'《]+|[」”"'》]+$/g, '')
    .replace(/^\d+[.、)]\s*/, '')
    .split('\n')[0]
    .trim();

/**
 * 取一句新灵感。onText 会在模型逐字输出时被调用（用于边写边显示）；
 * 返回最终文本与来源（model：模型现写；local：本地组合）。
 */
export async function fetchInspiration(o: { signal?: AbortSignal; onText?: (t: string) => void } = {}): Promise<{ text: string; source: 'model' | 'local' }> {
  const profile = profileFor('plan');
  const remember = (t: string) => {
    recent.unshift(t);
    recent.length = Math.min(recent.length, 8);
    return t;
  };
  if (profile.provider === 'cloud') {
    try {
      const text = await streamChat({
        profile,
        stage: 'plan',
        system: '你是长篇小说的灵感发生器。只输出一句中文故事灵感：有具体的人物、反常的处境和一个钩子，30 到 60 字，不要标题、编号、引号或任何解释。',
        messages: [{ role: 'user', content: `类型倾向：${pick(NUDGES)}。随机种子：${Math.random().toString(36).slice(2, 8)}。\n请避开这些已经出现过的方向：\n${recent.join('\n') || '（无）'}\n现在写一句全新的灵感。` }],
        demo: () => composeInspiration(recent),
        signal: o.signal,
        temperature: 1.1,
        maxTokens: 200,
        onToken: (_c, full) => o.onText?.(clean(full)),
      });
      const t = clean(text);
      if (t.length >= 8) return { text: remember(t), source: 'model' };
    } catch (error) {
      if (o.signal?.aborted) throw error;
      /* 模型出错时退回本地组合，不打断创作 */
    }
  }
  return { text: remember(composeInspiration(recent)), source: 'local' };
}
