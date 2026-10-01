/** 小说 → 短剧 各步骤的提示词。输出统一要求为 JSON，由 drama.ts 校验并规范化。 */
import { GENRES, type DramaPreset } from '@/shared/drama';

const JSON_RULE = '只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块。所有字符串使用简体中文。';

export function genreGuide(p: DramaPreset): string {
  const g = GENRES.find((x) => x.value === p.genre);
  const style = p.style.trim();
  return `剧型：${g?.label ?? '短剧'}（${g?.hint ?? ''}）${style ? `\n画风与补充要求：${style}` : ''}`;
}

export const SHORT_DRAMA_CRAFT = `你是资深短剧编剧兼分镜导演。竖屏短剧的创作规律：
- 每集开头 3–5 秒必须有钩子（冲突、悬念或情绪爆点），不铺垫、不交代背景。
- 每集只讲一个核心冲突，节奏快，信息密度高，结尾必须留悬念，让观众点开下一集。
- 对白短促口语化，一句不超过 25 字；能用画面表达的，不用台词解释。
- 忠于原著的人物性格、关系与主要情节，但可以压缩、合并、重排，删去难以拍摄的内心独白。
- 每一处改编都要能追溯到小说的章节。`;

export function breakdownPrompt(p: DramaPreset, digest: string, bible: string): { system: string; user: string } {
  return {
    system: `${SHORT_DRAMA_CRAFT}\n\n现在的任务：把小说拆解为改编短剧所需的素材。${JSON_RULE}`,
    user: `${genreGuide(p)}
计划改编为 ${p.episodes} 集，每集约 ${p.episodeSeconds} 秒。

【设定集】
${bible || '（无）'}

【小说内容（按章节，方括号内是章节序号）】
${digest}

请输出 JSON：
{
  "logline": "一句话故事",
  "mainPlot": "主线（200 字内）",
  "subplots": [{"name": "支线名", "summary": "概述"}],
  "keyEvents": [{"title": "事件", "summary": "概述", "chapters": [章节序号], "visual": 1到5的整数（可视化程度，越高越适合拍）}],
  "characters": [{"name": "", "role": "主角/反派/配角", "look": "外貌与服装（可直接写进画面提示词）", "voice": "声线与说话方式", "relations": "与其他人物的关系"}],
  "locations": [{"name": "", "look": "场景外观、光线与氛围"}],
  "tone": "整体基调与节奏",
  "notes": "改编建议：哪些内容适合删减、合并或强化"
}
keyEvents 按故事顺序，8–20 条；characters 只列会出镜的人物。`,
  };
}

export function outlinePrompt(
  p: DramaPreset,
  o: { breakdown: string; chapters: string; from: number; to: number; total: number; done: string },
): { system: string; user: string } {
  return {
    system: `${SHORT_DRAMA_CRAFT}\n\n现在的任务：写分集大纲。${JSON_RULE}`,
    user: `${genreGuide(p)}
全剧共 ${p.episodes} 集，每集约 ${p.episodeSeconds} 秒。本次只写第 ${o.from} 到第 ${o.to} 集（共 ${o.total} 集中的一段）。

【故事拆解】
${o.breakdown}

【小说章节概览】
${o.chapters}

【已写好的前面几集】
${o.done || '（这是第一批）'}

要求：
- 小说章节要按顺序、均匀地分配到各集；sourceChapters 填写这一集改编自哪几章（序号），相邻两集可以共用章节，但整体不能倒退。
- 每集都要有 hook（开场钩子）、conflict（核心冲突）、twist（反转或升级）、cliffhanger（结尾悬念）。
- 第 ${p.episodes} 集（如果在本批内）要有完整的收束，其余集的结尾都必须留悬念。

输出 JSON：
{"episodes": [{"n": 集序号, "title": "集标题", "hook": "", "conflict": "", "twist": "", "cliffhanger": "", "summary": "本集剧情（120 字内）", "sourceChapters": [章节序号], "characters": ["出场人物名"]}]}`,
  };
}

export function scriptPrompt(
  p: DramaPreset,
  o: { episode: string; prev: string; next: string; characters: string; locations: string; text: string },
): { system: string; user: string } {
  return {
    system: `${SHORT_DRAMA_CRAFT}\n\n现在的任务：把这一集写成可拍摄的场景化剧本。${JSON_RULE}`,
    user: `${genreGuide(p)}
本集时长约 ${p.episodeSeconds} 秒，通常 3–6 场戏，台词总量控制在能在时长内说完的范围。

【本集大纲】
${o.episode}

【上一集结尾】${o.prev || '（无）'}
【下一集开头预告】${o.next || '（无）'}

【人物（保持外貌、声线一致）】
${o.characters}

【场景】
${o.locations}

【对应的小说原文（方括号内是章节序号）】
${o.text}

要求：
- 第一场必须以大纲里的 hook 开场；最后一场落在 cliffhanger 上。
- 台词用 dialogue，动作与画面用 action（写成能拍出来的动作，不写心理活动），旁白用 narration（少用，只在必要时交代信息）。
- 每场戏用 source 标明依据的原文：chapter 是章节序号，quote 是原文中的一句话（原样摘录，不超过 40 字）；改编新增、原文没有的场景可以省略 source。
- dialogue 要给 speaker（人物名）和 emotion（情绪，供配音使用，如“压抑的愤怒”）。

输出 JSON：
{"episode": 集序号, "title": "集标题", "scenes": [{"n": 1, "location": "场景名", "time": "日/夜/黄昏…", "summary": "这场戏发生什么", "source": {"chapter": 章节序号, "quote": "原文摘录"}, "lines": [{"type": "action|dialogue|narration", "speaker": "仅 dialogue", "text": "", "emotion": "仅 dialogue"}]}]}`,
  };
}

export function storyboardPrompt(
  p: DramaPreset,
  o: { script: string; characters: string; locations: string },
): { system: string; user: string } {
  return {
    system: `你是短剧分镜导演，擅长把剧本拆成适合 AI 视频模型生成的镜头。${JSON_RULE}`,
    user: `${genreGuide(p)}
画幅 ${p.ratio}，本集总时长约 ${p.episodeSeconds} 秒。

【人物外貌（每个镜头里出现的人物，都要在画面描述里重复其外貌关键词，保证跨镜头一致）】
${o.characters}

【场景】
${o.locations}

【本集剧本】
${o.script}

要求：
- 每个镜头 3–6 秒（AI 视频单段的合理长度），所有镜头 seconds 之和接近 ${p.episodeSeconds}。
- 一个镜头只表现一个清晰的动作或情绪，不要在一个镜头里切换场景。
- size 取：远景 / 全景 / 中景 / 近景 / 特写；move 取：固定 / 推 / 拉 / 摇 / 移 / 跟 / 手持。
- visual：完整的画面描述，包含人物外貌、动作、表情、场景、光线、画风；可直接作为视频模型的提示词。
- firstFrame：这个镜头第一帧的静态画面描述，可直接用于生成参考图。需要首尾帧衔接时再给 lastFrame。
- 有台词的镜头给 dialogue（speaker、text、emotion）；有旁白给 narration；有重要音效给 sfx。
- scene 填剧本中的场景序号 n。

输出 JSON：
{"episode": 集序号, "shots": [{"n": 1, "scene": 1, "size": "", "move": "", "seconds": 4, "visual": "", "dialogue": {"speaker": "", "text": "", "emotion": ""}, "narration": "", "sfx": "", "firstFrame": "", "lastFrame": ""}]}`,
  };
}
