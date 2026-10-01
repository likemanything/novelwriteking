/**
 * 导入已有稿件：把 .txt / .md 按章节标题切分，建成一部新作品。
 *
 * - 识别「第X章 / 第X回」「Chapter N」「序章 / 楔子 / 尾声 / 番外」以及 Markdown 二级标题；
 * - 自动识别 UTF-8 与 GBK（很多中文 txt 仍是 GBK 编码）；
 * - 段落统一为空行分隔，去掉行首全角缩进；
 * - 导入的正文保存为「导入稿」版本，章节状态为草稿，不计入当日写作字数；
 * - 开头的一段正文会作为参考文风片段，让后续 AI 写作贴近你自己的声音。
 */
import { db } from './db';
import { emptyBlueprint, emptyStyle, makeCover } from './repo';
import type { Chapter, Project, Version } from './types';
import { countWords, uid } from './util';

export interface ParsedChapter {
  title: string;
  content: string;
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_CHAPTERS = 2000;

const NUM = '0-9０-９一二三四五六七八九十百千万零〇两';
const CN_HEADING = new RegExp(`^\\s*(?:#{1,3}\\s*)?(第[${NUM}]+[章回节])(?:[\\s:：·、.，,—-]+|$)(.*)$`);
const EN_HEADING = /^\s*(?:#{1,3}\s*)?(chapter\s+[\w-]+)(?:[\s:：.—-]+|$)(.*)$/i;
const SPECIAL = /^\s*(?:#{1,3}\s*)?(序章|序言|楔子|引子|尾声|后记|番外[^\s]*)(?:[\s:：·、.—-]+|$)(.*)$/;
const MD_H1 = /^\s*#\s+(.+?)\s*#*\s*$/;
const MD_H2 = /^\s*##\s+(.+?)\s*#*\s*$/;

export function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('gbk').decode(buffer);
  }
}

/** 统一段落格式：一行一段，段与段之间空一行。 */
export function normalizeParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''))
    .filter(Boolean)
    .join('\n\n');
}

function headingOf(line: string): { title: string; label: string } | null {
  for (const re of [CN_HEADING, EN_HEADING, SPECIAL]) {
    const m = line.match(re);
    if (m && line.trim().length <= 60) return { label: m[1].trim(), title: (m[2] ?? '').replace(/[#*]+/g, '').trim() };
  }
  return null;
}

export function splitManuscript(raw: string): { bookTitle?: string; chapters: ParsedChapter[] } {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let bookTitle: string | undefined;

  // 1) 优先识别中文/英文章节标题
  let marks = lines.map((l, i) => ({ i, h: headingOf(l) })).filter((x) => x.h);
  // 2) 退而求其次：Markdown 二级标题
  if (!marks.length) marks = lines.map((l, i) => ({ i, h: MD_H2.test(l) ? { label: '', title: l.match(MD_H2)![1] } : null })).filter((x) => x.h);

  const firstMark = marks[0]?.i ?? lines.length;
  const h1 = lines.slice(0, firstMark).findIndex((l) => MD_H1.test(l));
  if (h1 >= 0) bookTitle = lines[h1].match(MD_H1)![1].replace(/[《》]/g, '').trim();
  else {
    // txt 常见写法：首行《书名》
    const first = lines.find((l) => l.trim())?.trim() ?? '';
    const m = first.match(/^《(.{1,40})》$/);
    if (m && firstMark > 0) bookTitle = m[1];
  }

  const chapters: ParsedChapter[] = [];
  const preface = normalizeParagraphs(lines.slice(0, firstMark).filter((_, i) => i !== h1).join('\n'));
  if (!marks.length) {
    if (preface) chapters.push({ title: '', content: preface });
    return { bookTitle, chapters };
  }
  if (countWords(preface) >= 50) chapters.push({ title: '序', content: preface });

  marks.forEach((m, k) => {
    const end = marks[k + 1]?.i ?? lines.length;
    const content = normalizeParagraphs(lines.slice(m.i + 1, end).join('\n'));
    const special = m.h!.label && !/^第|^chapter/i.test(m.h!.label);
    const title = special ? [m.h!.label, m.h!.title].filter(Boolean).join(' · ') : m.h!.title;
    // 连续的空标题（例如目录）不当作章节
    if (!content && k + 1 < marks.length) return;
    chapters.push({ title, content });
  });
  return { bookTitle, chapters };
}

export async function importManuscript(file: File): Promise<{ projectId: string; chapters: number; words: number }> {
  if (file.size > MAX_BYTES) throw new Error('文件超过 20 MB，请拆分后再导入');
  const text = decodeText(await file.arrayBuffer());
  const { bookTitle, chapters: parsed } = splitManuscript(text);
  const chapters = parsed.filter((c) => c.content.trim()).slice(0, MAX_CHAPTERS);
  if (!chapters.length) throw new Error('没有在文件里找到正文');

  const now = Date.now();
  const projectId = uid('p_');
  const title = bookTitle || file.name.replace(/\.(txt|md|markdown)$/i, '').trim() || '导入的作品';
  const totalWords = chapters.reduce((s, c) => s + countWords(c.content), 0);
  const avg = totalWords / chapters.length;

  const project: Project = {
    id: projectId,
    title,
    logline: '',
    premise: '',
    seed: `导入自「${file.name}」`,
    genre: '',
    tags: ['导入'],
    targetChapters: Math.max(chapters.length, 12),
    targetWords: Math.max(1000, Math.round(avg / 500) * 500),
    style: { ...emptyStyle(), sample: chapters[0].content.slice(0, 1500) },
    storySoFar: '',
    cover: makeCover(title + file.name),
    createdAt: now,
    updatedAt: now,
  };

  const chapterRows: Chapter[] = [];
  const versionRows: Version[] = [];
  chapters.forEach((c, i) => {
    const chapterId = uid('ch_');
    const versionId = uid('v_');
    const words = countWords(c.content);
    versionRows.push({ id: versionId, projectId, chapterId, kind: 'manual', label: '导入稿', content: c.content, words, createdAt: now, updatedAt: now });
    chapterRows.push({
      id: chapterId,
      projectId,
      index: i + 1,
      title: c.title || `第${i + 1}章`,
      act: '',
      blueprint: emptyBlueprint(),
      status: 'drafting',
      workingVersionId: versionId,
      summary: '',
      words,
      updatedAt: now,
    });
  });

  await db.transaction('rw', [db.projects, db.chapters, db.versions], async () => {
    await db.projects.add(project);
    await db.chapters.bulkAdd(chapterRows);
    await db.versions.bulkAdd(versionRows);
  });
  return { projectId, chapters: chapterRows.length, words: totalWords };
}
