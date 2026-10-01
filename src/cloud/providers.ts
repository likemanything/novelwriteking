/** 图像 / 视频 / 配音服务：接口封装与当前团队的配置（密钥不会下发到浏览器）。 */
import { create } from 'zustand';
import type { MediaKind, ProviderInfo, ProviderSpec, ProvidersResponse, MediaAssetDTO } from '@/shared/media';
import { api, getApiOrg } from './api';

interface ProvidersState {
  loaded: boolean;
  providers: ProviderInfo[];
  assigned: Record<MediaKind, string | null>;
}

export const useProviders = create<ProvidersState>()(() => ({ loaded: false, providers: [], assigned: { image: null, video: null, tts: null } }));

export async function refreshProviders() {
  try {
    const r = await api<ProvidersResponse>('GET', '/api/providers');
    useProviders.setState({ loaded: true, providers: r.providers, assigned: r.assigned });
  } catch {
    useProviders.setState({ loaded: true });
  }
}

export const providerApi = {
  create: (body: { name: string; spec: ProviderSpec; apiKey?: string; secretKey?: string }) => api<ProviderInfo>('POST', '/api/providers', body),
  update: (id: string, body: { name?: string; spec?: ProviderSpec; apiKey?: string; secretKey?: string }) => api<ProviderInfo>('PATCH', `/api/providers/${id}`, body),
  remove: (id: string) => api('DELETE', `/api/providers/${id}`),
  assign: (kind: MediaKind, providerId: string | null) => api('PUT', '/api/providers/assign', { kind, providerId }),
  test: (id: string, prompt?: string) => api<{ asset: MediaAssetDTO }>('POST', `/api/providers/${id}/test`, { prompt }),
};

/** 带团队标识的文件地址（<img> / <video> 不能带请求头，所以用查询参数） */
export const mediaUrl = (assetId: string) => `/api/media/${assetId}?org=${encodeURIComponent(getApiOrg())}`;
