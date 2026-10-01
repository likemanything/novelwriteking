/** 短剧画布的接口封装与实时刷新。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DramaPreset, DramaProjectDTO } from '@/shared/drama';
import { toastError } from '@/store/ui';
import { api, apiFetch } from './api';
import { onServerEvent } from './sync';

export const dramaApi = {
  get: (novelId: string) => api<{ project: DramaProjectDTO | null }>('GET', `/api/drama/by-novel/${encodeURIComponent(novelId)}`),
  create: (novelId: string, preset?: Partial<DramaPreset>) => api<{ project: DramaProjectDTO }>('POST', `/api/drama/by-novel/${encodeURIComponent(novelId)}`, { preset }),
  setPreset: (id: string, preset: Partial<DramaPreset>) => api<{ project: DramaProjectDTO }>('PATCH', `/api/drama/${id}`, { preset }),
  layout: (id: string, positions: { id: string; x: number; y: number }[]) => api('PUT', `/api/drama/${id}/layout`, { positions }),
  runAll: (id: string) => api('POST', `/api/drama/${id}/run-all`, {}),
  cancel: (id: string) => api('POST', `/api/drama/${id}/cancel`, {}),
  remove: (id: string) => api('DELETE', `/api/drama/${id}`),
  runNode: (nodeId: string) => api('POST', `/api/drama/nodes/${nodeId}/run`, {}),
  cancelNode: (nodeId: string) => api('POST', `/api/drama/nodes/${nodeId}/cancel`, {}),
  patchNode: (nodeId: string, body: { output?: unknown; approved?: boolean }) => api<{ project: DramaProjectDTO }>('PATCH', `/api/drama/nodes/${nodeId}`, body),
  export: async (id: string, format: 'md' | 'csv') => {
    const res = await apiFetch('GET', `/api/drama/${id}/export?format=${format}`);
    return (await res.json()) as { filename: string; mime: string; content: string };
  },
};

/** 加载某部小说的画布，并在服务端有进展时自动刷新（SSE，外加运行期间的轻量轮询兜底）。 */
export function useDramaProject(novelId: string) {
  const [project, setProject] = useState<DramaProjectDTO | null | undefined>(undefined);
  const id = useRef<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const r = await dramaApi.get(novelId);
      if (!alive.current) return;
      id.current = r.project?.id ?? null;
      setProject(r.project);
    } catch (e) {
      if (alive.current) toastError(e, '加载短剧画布失败');
      if (alive.current) setProject((p) => p ?? null);
    }
  }, [novelId]);

  useEffect(() => {
    alive.current = true;
    setProject(undefined);
    void reload();
    const off = onServerEvent('drama', (ev: { dramaId: string }) => {
      if (!id.current || ev.dramaId === id.current) void reload();
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [reload]);

  const busy = !!project?.nodes.some((n) => n.status === 'running');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [busy, reload]);

  return { project, setProject, reload };
}
