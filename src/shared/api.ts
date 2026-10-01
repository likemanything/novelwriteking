/** 前后端共用的接口数据结构。 */
import type { OrgRole, ProjectRole, SyncTable } from './permissions';

export interface MeUser {
  id: string;
  phone: string; // 已脱敏，例如 138****0000
  name: string;
  platformAdmin: boolean;
}

export interface OrgSummary {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  role: OrgRole;
  /** 外部协作者被授权的作品及角色 */
  grants?: { projectId: string; role: ProjectRole }[];
}

export interface MeResponse {
  user: MeUser;
  orgs: OrgSummary[];
  signupMode: 'open' | 'invite';
}

export interface MemberInfo {
  userId: string;
  name: string;
  phone: string; // 已脱敏
  role: OrgRole;
  joinedAt: string;
  grants: { projectId: string; role: ProjectRole }[];
  monthTokens: number;
}

export interface InvitationInfo {
  id: string;
  role: OrgRole;
  projectIds: string[];
  grantRole: ProjectRole | null;
  note: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revoked: boolean;
  createdAt: string;
  createdByName: string;
}

export interface InvitationPreview {
  orgName: string;
  role: OrgRole;
  inviterName: string;
  valid: boolean;
  reason?: string;
}

export interface OrgDetail {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  monthlyTokenLimit: number | null;
  memberMonthlyTokenLimit: number | null;
}

export interface SyncChange {
  table: SyncTable;
  id: string;
  /** 新的完整行；为 null 表示删除 */
  row: Record<string, unknown> | null;
}

export interface PushResult {
  table: SyncTable;
  id: string;
  ok: boolean;
  seq?: number;
  /** 被拒绝时的原因，以及服务端当前的行（null 表示服务端没有这一行） */
  reason?: string;
  server?: Record<string, unknown> | null;
}

export interface PullChange {
  table: SyncTable;
  id: string;
  row: Record<string, unknown> | null;
  seq: number;
}

export interface PullResponse {
  changes: PullChange[];
  cursor: number;
  more: boolean;
}

export interface ChapterLockInfo {
  chapterId: string;
  userId: string;
  userName: string;
  expiresAt: string;
  mine: boolean;
}

export type Stage = 'plan' | 'write' | 'review' | 'muse';

export interface CredentialInfo {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  models: string[];
  protocolLabel: string;
  temperature: number;
  maxTokens: number;
  keyHint: string;
  createdAt: string;
}

export interface ModelsResponse {
  credentials: CredentialInfo[];
  /** 每个环节使用的模型 id；null 表示离线演示引擎 */
  stages: Record<Stage, string | null>;
}

export interface UsageRow {
  userId: string | null;
  userName: string;
  stage: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
}

export interface UsageResponse {
  month: string;
  totalTokens: number;
  limit: number | null;
  memberLimit: number | null;
  rows: UsageRow[];
}

export interface SignupCodeInfo {
  code: string;
  note: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
}

/** AI 网关的流式事件（NDJSON，每行一个） */
export type GatewayEvent =
  | { t: 'd'; v: string }
  | { t: 'end'; inputTokens: number; outputTokens: number }
  | { t: 'err'; message: string; status?: number };

/** 服务端协议识别的流式事件 */
export type DetectEvent =
  | { t: 'step'; step: 'normalize' | 'protocol' | 'models' | 'reply'; state: 'idle' | 'active' | 'done' | 'warn' | 'error'; info?: string }
  | { t: 'result'; credential: CredentialInfo; reply?: string; warning?: string }
  | { t: 'error'; message: string; code: string; step: 'normalize' | 'protocol' | 'models' | 'reply' };
