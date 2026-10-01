/**
 * 提示词合同。
 *
 * 写作类任务输出纯正文；结构化任务要求严格 JSON。所有提示词都强调三件事：
 * 1) 服从作者已确认的设定（正典优先）；2) 不替作者“发明”未经确认的重大事实；
 * 3) 输出语言与作品保持一致。
 */
import type { Chapter, Character, Critique, Project } from '@/lib/types';
import { characterCard, styleText } from './lens';
import type { MuseAction } from './types';

export const WRITER_SYSTEM = `你是一位经验丰富的中文长篇小说作家，正在与作者合写一部作品。
你的职责是把作者的细纲写成有血有肉的正文，而不是替作者改变故事方向。

写作准则：
- 严格遵循「本章细纲」的目标与情节点顺序，每个情节点都要在正文中真实发生，而不是一笔带过或只写成计划。
- 设定资料是事实：不要与角色当前状态、世界规则和前情矛盾；资料没有提到的重大事实不要擅自发明。
- 展示而非告知：用动作、对白、细节和感官传递情绪，避免空泛的总结与说教。
- 对白要符合每个人物的说话方式；段落长短有节奏变化。
- 保持文风指南要求的叙述声音、视角与基调。
- 只输出小说正文：不要标题、不要章节号、不要解释、不要 Markdown 格式。`;

export const JSON_RULE = '只输出一个合法的 JSON，不要任何解释文字，不要使用 Markdown 代码块。';

export function genesisPrompt(o: { seed: string; genre: string; chapters: number; words: number; tone: string; notes: string }) {
  const system = `你是一位擅长构建长篇小说的故事架构师。你能从一句模糊的灵感出发，发现其中最有张力的戏剧问题，并据此搭建人物、世界观与故事线。${JSON_RULE}`;
  const user = `作者的一句灵感：「${o.seed}」

创作参数：
- 类型：${o.genre || '由你根据灵感判断'}
- 篇幅：约 ${o.chapters} 章，每章约 ${o.words} 字
- 基调：${o.tone || '由你根据灵感判断'}
${o.notes ? `- 作者补充：${o.notes}\n` : ''}
请据此设计一部长篇小说的基础架构，输出 JSON：
{
  "titles": ["三个风格各异的书名"],
  "logline": "一句话故事：谁，想要什么，被什么阻挡，赌注是什么（40字以内）",
  "premise": "故事梗概：200字左右，交代起点、核心冲突与走向，但不剧透结局细节",
  "genre": "类型",
  "tags": ["3-5个标签"],
  "style": { "voice": "叙述声音", "pov": "视角", "tense": "语感/时态", "tone": "基调", "rules": ["3-5条具体可执行的写作守则"] },
  "characters": [
    { "name": "", "role": "主角/反派/配角/导师…", "summary": "一句话人物", "appearance": "外貌要点", "personality": "性格", "desire": "想要的（外在目标）", "need": "需要的（内在成长）", "wound": "创伤或恐惧", "voice": "说话方式", "arc": "人物弧线" }
  ],
  "world": [ { "category": "地点/势力/规则/物品/历史/其他", "name": "", "content": "", "keywords": ["用于检索的关键词"] } ],
  "threads": [ { "name": "", "kind": "main/sub/mystery/romance/arc", "description": "这条故事线要回答的问题" } ]
}
要求：角色 4-6 个且欲望互相冲突；世界条目 4-6 条且至少一条「规则」；故事线 3-5 条且恰好一条 main。`;
  return { system, user };
}

export function outlinePrompt(o: {
  project: Project;
  characters: Character[];
  threadsText: string;
  worldText: string;
  existing: Chapter[];
  from: number;
  count: number;
  guidance: string;
}) {
  const p = o.project;
  const system = `你是一位长篇小说的结构编辑，擅长设计有节奏、有悬念、能持续推进的章节细纲。${JSON_RULE}`;
  const before = o.existing
    .filter((c) => c.index < o.from)
    .slice(-12)
    .map((c) => `第${c.index}章《${c.title}》：${c.summary || c.blueprint.goal}`)
    .join('\n');
  const after = o.existing
    .filter((c) => c.index >= o.from + o.count)
    .slice(0, 5)
    .map((c) => `第${c.index}章《${c.title}》：${c.blueprint.goal}`)
    .join('\n');
  const user = `# 作品
《${p.title}》 ${p.genre}
一句话故事：${p.logline}
前提：${p.premise}
全书计划 ${p.targetChapters} 章。

# 人物
${o.characters.map((c) => characterCard(c, true)).join('\n')}

# 故事线
${o.threadsText || '（暂无）'}

# 世界
${o.worldText || '（暂无）'}
${before ? `\n# 已有章节（前文）\n${before}\n` : ''}${after ? `\n# 后续已规划章节（需要能衔接上）\n${after}\n` : ''}${o.guidance ? `\n# 作者对这一批的要求\n${o.guidance}\n` : ''}
请为第 ${o.from} 章到第 ${o.from + o.count - 1} 章（共 ${o.count} 章）设计章节细纲，输出 JSON 数组：
[
  { "title": "章节名", "act": "所属幕/卷", "goal": "本章必须完成的叙事目标", "beats": ["3-5个依次发生的具体情节点"], "pov": "视角人物", "location": "主要场景", "characters": ["出场角色名，必须使用上面的名字"], "threads": ["推进的故事线名，必须使用上面的名字"], "hook": "章末悬念" }
]
要求：每章都要有推进与变化；情节点写成具体事件而非抽象概念；在全书 ${p.targetChapters} 章的尺度上控制节奏，不要过早揭开核心悬念。`;
  return { system, user };
}

export function draftPrompt(project: Project, chapter: Chapter, lensText: string) {
  const user = `以下是本章写作所需的资料（已按相关度筛选）：

${lensText}

---
请写出第${chapter.index}章《${chapter.title}》的完整正文，目标约 ${project.targetWords} 字。
从上一章结尾自然衔接（如有），依次完成全部情节点，并以章末悬念收尾。`;
  return { system: WRITER_SYSTEM, user };
}

export function critiquePrompt(project: Project, chapter: Chapter, blueprint: string, text: string) {
  const system = `你是一位严格但建设性的小说编辑。你的审稿以原文证据为依据：判断情节点是否“真实发生”，而不是只被提及、准备或承诺。${JSON_RULE}`;
  const user = `# 作品文风
${styleText(project) || '（未设定）'}

# 本章细纲
${blueprint}

# 待审正文
${text}

---
请审阅第${chapter.index}章《${chapter.title}》（目标约 ${project.targetWords} 字），输出 JSON：
{
  "scores": { "节奏": 1-10, "人物": 1-10, "张力": 1-10, "文笔": 1-10, "连贯": 1-10 },
  "verdict": "两三句总评",
  "beats": [ { "beat": "细纲中的情节点原文", "status": "done/missing/uncertain", "evidence": "引用能证明的原文片段；缺失时说明缺了什么" } ],
  "issues": [ { "severity": "high/medium/low", "type": "节奏/人物/张力/文笔/连贯/设定", "quote": "有问题的原文，逐字引用，不超过40字", "problem": "问题是什么", "suggestion": "具体怎么改" } ],
  "strengths": ["值得保留的 2-3 个亮点"]
}
要求：issues 3-6 条，按严重程度排序；quote 必须能在正文中逐字找到。`;
  return { system, user };
}

export function revisePrompt(o: { project: Project; lensText: string; text: string; critique?: Critique; issueIds: string[]; instruction: string }) {
  const issues = (o.critique?.issues ?? []).filter((i) => o.issueIds.includes(i.id));
  const missing = (o.critique?.beats ?? []).filter((b) => b.status !== 'done');
  const user = `以下是本章资料：

${o.lensText}

---
# 当前稿件
${o.text}

---
# 修订要求
${issues.length ? `作者采纳的审稿意见：\n${issues.map((i, n) => `${n + 1}. 「${i.quote}」— ${i.problem} → ${i.suggestion}`).join('\n')}\n` : ''}${missing.length ? `尚未完成的情节点（请在正文中让它真实发生）：\n${missing.map((b) => `- ${b.beat}`).join('\n')}\n` : ''}${o.instruction ? `作者的额外指示：${o.instruction}\n` : ''}
请输出修订后的完整章节正文。保留原稿中有效的部分与亮点，只做必要的修改；不要解释修改了什么。`;
  return { system: WRITER_SYSTEM, user };
}

export function extractPrompt(project: Project, chapter: Chapter, text: string, charactersText: string, threadsText: string) {
  const system = `你是这部小说的设定编辑，负责从定稿正文中整理设定变化，维护连续性。只记录正文中明确发生的事，不推测、不补完。${JSON_RULE}`;
  const user = `# 此前的前情提要
${project.storySoFar || '（这是第一章，暂无）'}

# 已知人物（含当前状态）
${charactersText}

# 故事线
${threadsText}

# 第${chapter.index}章《${chapter.title}》定稿正文
${text}

---
输出 JSON：
{
  "summary": "本章摘要，100字左右，只写发生了什么",
  "storySoFar": "把本章并入后的前情提要，300字以内，保留对后文重要的因果",
  "characterUpdates": [ { "name": "已知人物名", "location": "章末所在位置", "condition": "章末身体与情绪状态", "knowledge": "他此刻知道的关键信息", "change": "本章带来的变化，一句话" } ],
  "newCharacters": [ { "name": "", "role": "", "summary": "" } ],
  "worldFacts": [ { "category": "地点/势力/规则/物品/历史/其他", "name": "", "content": "正文确立的新事实" } ],
  "threadProgress": [ { "thread": "故事线名", "progress": "本章推进了什么", "resolved": false } ]
}
没有的项给空数组。只记录本章中有实际变化的人物。`;
  return { system, user };
}

const MUSE_INSTRUCTION: Record<MuseAction, string> = {
  continue: '顺着文意续写',
  expand: '扩写这段文字：补充动作、感官细节与心理活动，篇幅约为原文的两倍，不改变事件本身',
  condense: '精简这段文字：删去冗余与重复，保留关键信息与力度，篇幅约为原文的一半',
  polish: '润色这段文字：让用词更精准、句子更有节奏与质感，保持原意与叙述声音',
  show: '把这段文字中“告诉读者”的部分改写为“展示”：用动作、对白与细节替代直接陈述情绪',
  dialogue: '改写这段文字中的对白，让每个人物的说话方式更鲜明、更有潜台词',
  tone: '改写这段文字的情绪基调',
  custom: '按作者指令改写这段文字',
};

export function musePrompt(o: { project: Project; action: MuseAction; selection: string; before: string; after: string; instruction: string; characters: string }) {
  const system = `你是一位文字编辑，擅长对局部文字做精细改写。保持作品的叙述声音。只输出改写后的文字本身，不要引号包裹、不要解释。

${styleText(o.project)}`;
  const user = `${o.characters ? `# 相关人物\n${o.characters}\n\n` : ''}# 上文
……${o.before.slice(-600)}

# 需要处理的文字
${o.selection}

# 下文
${o.after.slice(0, 300)}……

---
任务：${MUSE_INSTRUCTION[o.action]}${o.instruction ? `。要求：${o.instruction}` : ''}。`;
  return { system, user };
}

export function continuePrompt(o: { project: Project; blueprint: string; before: string; after: string }) {
  const user = `# 本章细纲
${o.blueprint}

# 正文（光标之前）
……${o.before.slice(-1500)}
${o.after.trim() ? `\n# 光标之后已有的内容\n${o.after.slice(0, 300)}……\n` : ''}
---
请从光标处续写 80-160 字，自然承接上文，朝本章下一个未完成的情节点推进。只输出续写的文字。`;
  return { system: `${WRITER_SYSTEM}\n\n${styleText(o.project)}`, user };
}

export function interviewSystem(project: Project, c: Character) {
  return `你现在就是《${project.title}》中的人物「${c.name}」。作者正在采访你，以便更好地理解你。

${characterCard(c)}
${c.appearance ? `外貌：${c.appearance}\n` : ''}${c.arc ? `（作者设定的人物弧线，你本人并不自知：${c.arc}）\n` : ''}
故事背景：${project.logline}
${project.storySoFar ? `目前为止发生的事：${project.storySoFar}\n` : ''}
规则：
- 始终以第一人称、用${c.name}的口吻与说话方式回答，可以带动作描写（放在括号里）。
- 你只知道自己当前知道的事，不知道作者的计划。
- 可以回避、撒谎或情绪化，只要符合人物；回答简洁，一般不超过150字。`;
}

export function stylePrompt(sample: string) {
  const system = `你是一位文体分析专家。${JSON_RULE}`;
  const user = `分析下面这段小说文字的文风，输出可以指导续写的文风指南 JSON：
{ "voice": "叙述声音", "pov": "视角", "tense": "语感/时态", "tone": "基调", "rules": ["4-6条具体、可执行的写作守则，例如句长、修辞、对白比例、禁用表达"] }

文字：
${sample.slice(0, 3000)}`;
  return { system, user };
}
