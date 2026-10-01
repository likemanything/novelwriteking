import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext } from 'react';
import { db } from '@/lib/db';
import type { Chapter, Character, Project, Proposal, Thread, WorldEntry } from '@/lib/types';

/** 实时查询：数据库任何变化（包括后台 AI 任务写入）都会自动刷新界面。 */
export function useProject(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await db.projects.get(id)) ?? null) : null), [id]);
}

export function useProjects() {
  return useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), []);
}

export function useChapters(projectId: string): Chapter[] {
  return useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('index'), [projectId]) ?? [];
}

export function useCharacters(projectId: string): Character[] {
  return useLiveQuery(() => db.characters.where('projectId').equals(projectId).sortBy('order'), [projectId]) ?? [];
}

export function useThreads(projectId: string): Thread[] {
  return useLiveQuery(() => db.threads.where('projectId').equals(projectId).sortBy('order'), [projectId]) ?? [];
}

export function useWorld(projectId: string): WorldEntry[] {
  return useLiveQuery(() => db.world.where('projectId').equals(projectId).sortBy('createdAt'), [projectId]) ?? [];
}

export function usePendingProposals(projectId: string): Proposal[] {
  return (
    useLiveQuery(
      () =>
        db.proposals
          .where('projectId')
          .equals(projectId)
          .filter((p) => p.status === 'pending')
          .sortBy('createdAt'),
      [projectId],
    ) ?? []
  );
}

export const ProjectContext = createContext<Project | null>(null);

export function useCurrentProject(): Project {
  const p = useContext(ProjectContext);
  if (!p) throw new Error('useCurrentProject 必须在作品页面中使用');
  return p;
}
