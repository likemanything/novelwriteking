/**
 * 个人偏好（只保存在这台设备上）：主题、字号、参考资料预算等。
 * 模型接入与环节分工属于团队配置，保存在服务端，见 src/cloud/models.ts。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Stage } from '@/shared/api';

export type { Stage };
export { profileFor, DEMO_PROFILE, type StageProfile } from '@/cloud/models';

export const STAGE_LABEL: Record<Stage, { label: string; hint: string }> = {
  plan: { label: '构思', hint: '开书、大纲、整理设定' },
  write: { label: '写作', hint: '章节草稿与修订' },
  review: { label: '审稿', hint: '结构化审稿报告' },
  muse: { label: '改写', hint: '划词改写、续写、角色访谈' },
};

/** DeepSeek 一键接入：OpenAI 兼容协议，只需要 Key。模型名以接口返回的列表为准。 */
export const DEEPSEEK_URL = 'https://api.deepseek.com';

/** 通用接入的常见地址示例（只是填入地址，协议仍由自动识别决定）。 */
export const URL_EXAMPLES: { label: string; url: string }[] = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'Claude', url: 'https://api.anthropic.com' },
  { label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: 'Kimi', url: 'https://api.moonshot.cn/v1' },
  { label: '智谱', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
];

interface SettingsState {
  theme: 'paper' | 'night' | 'system';
  contextBudget: number;
  editorSize: number;
  typewriter: boolean;
  reducedMotion: boolean;
  setTheme: (t: SettingsState['theme']) => void;
  patch: (p: Partial<Pick<SettingsState, 'contextBudget' | 'editorSize' | 'typewriter' | 'reducedMotion'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      contextBudget: 12000,
      editorSize: 18,
      typewriter: false,
      reducedMotion: false,
      setTheme: (theme) => set({ theme }),
      patch: (p) => set(p),
    }),
    {
      name: 'inkloom.settings',
      version: 2,
      // 单机版的模型配置（含明文 Key）不再使用，升级时丢弃
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { theme: p.theme ?? 'system', contextBudget: p.contextBudget ?? 12000, editorSize: p.editorSize ?? 18, typewriter: !!p.typewriter, reducedMotion: !!p.reducedMotion } as SettingsState;
      },
    },
  ),
);
