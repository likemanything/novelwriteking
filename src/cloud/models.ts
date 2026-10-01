/** 当前团队的模型接入与环节分工（来自服务端，密钥不会下发到浏览器）。 */
import { create } from 'zustand';
import type { CredentialInfo, ModelsResponse, Stage } from '@/shared/api';
import { api } from './api';

interface ModelsState {
  loaded: boolean;
  credentials: CredentialInfo[];
  stages: Record<Stage, string | null>;
}

export const useModels = create<ModelsState>()(() => ({
  loaded: false,
  credentials: [],
  stages: { plan: null, write: null, review: null, muse: null },
}));

export async function refreshModels() {
  try {
    const r = await api<ModelsResponse>('GET', '/api/ai/models');
    useModels.setState({ loaded: true, credentials: r.credentials, stages: r.stages });
  } catch {
    useModels.setState({ loaded: true });
  }
}

export interface StageProfile {
  id: string;
  name: string;
  provider: 'cloud' | 'demo';
  model: string;
}

export const DEMO_PROFILE: StageProfile = { id: 'demo', name: '演示引擎（离线）', provider: 'demo', model: 'inkloom-demo' };

/** 某个环节当前用哪个模型；没有指定时使用离线演示引擎。 */
export function profileFor(stage: Stage): StageProfile {
  const s = useModels.getState();
  const id = s.stages[stage];
  const c = id ? s.credentials.find((x) => x.id === id) : undefined;
  return c ? { id: c.id, name: c.name, provider: 'cloud', model: c.model } : DEMO_PROFILE;
}

export function useStageProfile(stage: Stage): StageProfile {
  useModels((s) => `${s.stages[stage] ?? ''}|${s.credentials.map((c) => c.id + c.name + c.model).join()}`);
  return profileFor(stage);
}
