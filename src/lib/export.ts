import { db, PROJECT_TABLES } from './db';
import type { Project } from './types';
import { chineseNumber, downloadFile, uid } from './util';

async function chapterTexts(projectId: string, onlyFinal: boolean) {
  const chapters = await db.chapters.where('projectId').equals(projectId).sortBy('index');
  const out: { title: string; index: number; content: string }[] = [];
  for (const ch of chapters) {
    const vid = onlyFinal ? ch.canonVersionId : ch.workingVersionId;
    if (!vid) continue;
    const v = await db.versions.get(vid);
    if (v?.content.trim()) out.push({ title: ch.title, index: ch.index, content: v.content.trim() });
  }
  return out;
}

export async function exportManuscript(project: Project, format: 'md' | 'txt', onlyFinal: boolean) {
  const chapters = await chapterTexts(project.id, onlyFinal);
  const lines: string[] = [];
  if (format === 'md') {
    lines.push(`# ${project.title}`, '', project.logline ? `> ${project.logline}` : '', '');
    for (const c of chapters) lines.push(`## 第${chineseNumber(c.index)}章 ${c.title}`, '', c.content, '');
  } else {
    lines.push(project.title, '', project.logline, '', '');
    for (const c of chapters) lines.push(`第${chineseNumber(c.index)}章　${c.title}`, '', c.content, '', '');
  }
  downloadFile(`${project.title}.${format}`, lines.join('\n'), format === 'md' ? 'text/markdown;charset=utf-8' : undefined);
  return chapters.length;
}

interface Backup {
  app: 'inkloom';
  version: 1;
  exportedAt: number;
  project: Project;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(project: Project) {
  const tables: Record<string, unknown[]> = {};
  for (const t of PROJECT_TABLES) tables[t] = await db[t].where('projectId').equals(project.id).toArray();
  const data: Backup = { app: 'inkloom', version: 1, exportedAt: Date.now(), project, tables };
  downloadFile(`${project.title}.inkloom.json`, JSON.stringify(data), 'application/json');
}

/** 导入备份为一部新作品（重新生成所有 id，避免与现有作品冲突）。 */
export async function importBackup(file: File): Promise<string> {
  const data = JSON.parse(await file.text()) as Backup;
  if (data.app !== 'inkloom' || !data.project) throw new Error('这不是墨织的备份文件');
  const idMap = new Map<string, string>();
  const remap = (id: unknown) => {
    if (typeof id !== 'string') return id;
    if (!idMap.has(id)) idMap.set(id, uid(id.split('_')[0] + '_'));
    return idMap.get(id)!;
  };
  const newProjectId = remap(data.project.id) as string;
  // 先为所有实体分配新 id，再改写引用字段
  for (const t of PROJECT_TABLES) for (const row of (data.tables[t] ?? []) as any[]) remap(row.id);
  const fix = (row: any, table: string) => {
    const r = { ...row, id: remap(row.id), projectId: newProjectId };
    for (const k of ['chapterId', 'versionId', 'workingVersionId', 'canonVersionId', 'parentId']) if (r[k]) r[k] = idMap.get(r[k]) ?? r[k];
    if (r.blueprint) {
      r.blueprint = {
        ...r.blueprint,
        characterIds: r.blueprint.characterIds.map((x: string) => idMap.get(x) ?? x),
        threadIds: r.blueprint.threadIds.map((x: string) => idMap.get(x) ?? x),
      };
    }
    if (r.payload?.characterId) r.payload = { ...r.payload, characterId: idMap.get(r.payload.characterId) };
    if (r.payload?.threadId) r.payload = { ...r.payload, threadId: idMap.get(r.payload.threadId) };
    if (table === 'daily') r.id = `${newProjectId}:${row.date}`;
    return r;
  };
  await db.transaction('rw', [db.projects, ...PROJECT_TABLES.map((x) => db[x])], async () => {
    await db.projects.add({ ...data.project, id: newProjectId, updatedAt: Date.now() });
    for (const t of PROJECT_TABLES) {
      const rows = ((data.tables[t] ?? []) as any[]).map((row) => fix(row, t));
      await (db[t] as any).bulkAdd(rows);
    }
  });
  return newProjectId;
}
