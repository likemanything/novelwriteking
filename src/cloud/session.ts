/**
 * 登录状态与当前团队（工作区）。
 *
 * 启动流程：读取 /api/me → 选定团队（上次使用的，或个人空间）→ 打开该团队的本地数据库 →
 * 首次进入时等待完整同步 → 渲染页面。切换团队会整页刷新，保证所有页面状态干净。
 */
import Dexie from 'dexie';
import { create } from 'zustand';
import { closeWorkspaceDb, openWorkspaceDb } from '@/lib/db';
import type { MeResponse, OrgSummary } from '@/shared/api';
import { capabilities, type Capabilities, type EffectiveRole } from '@/shared/permissions';
import { toast } from '@/store/ui';
import { api, ApiError, onUnauthorized, setApiOrg } from './api';
import { refreshModels } from './models';
import { flushSync, forgetWorkspace, markChanged, onServerEvent, pendingCount, startSync, stopSync } from './sync';

type Status = 'loading' | 'anon' | 'opening' | 'ready' | 'error';

interface SessionState {
  status: Status;
  me: MeResponse | null;
  orgId: string | null;
  error: string | null;
  firstTime: boolean;
}

export const useSession = create<SessionState>()(() => ({ status: 'loading', me: null, orgId: null, error: null, firstTime: false }));

const KNOWN = 'inkloom.workspaces';
const lastOrgKey = (userId: string) => `inkloom.org.${userId}`;
const wsName = (userId: string, orgId: string) => `inkloom-${userId}-${orgId}`;

function knownWorkspaces(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KNOWN) ?? '[]');
  } catch {
    return [];
  }
}

function remember(name: string) {
  const list = new Set(knownWorkspaces());
  list.add(name);
  localStorage.setItem(KNOWN, JSON.stringify([...list]));
}

async function forget(name: string) {
  forgetWorkspace(name);
  localStorage.setItem(KNOWN, JSON.stringify(knownWorkspaces().filter((n) => n !== name)));
  await Dexie.delete(name).catch(() => {});
}

export function currentOrg(): OrgSummary | null {
  const s = useSession.getState();
  return s.me?.orgs.find((o) => o.id === s.orgId) ?? null;
}

/** 在某部作品里的实际角色（外部协作者按授权）。 */
export function roleIn(org: OrgSummary | null, projectId?: string | null): EffectiveRole | null {
  if (!org) return null;
  if (org.role !== 'guest') return org.role;
  if (!projectId) return null;
  return org.grants?.find((g) => g.projectId === projectId)?.role ?? null;
}

export function useOrg(): OrgSummary | null {
  return useSession((s) => s.me?.orgs.find((o) => o.id === s.orgId) ?? null);
}

export function useCaps(projectId?: string | null): Capabilities {
  const org = useOrg();
  return capabilities(roleIn(org, projectId), org?.role);
}

export function capsNow(projectId?: string | null): Capabilities {
  const org = currentOrg();
  return capabilities(roleIn(org, projectId), org?.role);
}

export function setMe(me: MeResponse) {
  useSession.setState({ me });
}

let started = false;
/** 启动一次会话（重复调用无效）。标志与会话状态放在同一个模块里，热更新时一起重置。 */
export function ensureSession() {
  if (started) return;
  started = true;
  void loadSession();
}

export async function loadSession(): Promise<void> {
  try {
    const me = await api<MeResponse>('GET', '/api/me', undefined, { org: null });
    useSession.setState({ me, status: 'opening', error: null });
    await openOrg(me);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) useSession.setState({ status: 'anon', me: null });
    else useSession.setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

async function openOrg(me: MeResponse) {
  const userId = me.user.id;
  const wanted = localStorage.getItem(lastOrgKey(userId));
  const org = me.orgs.find((o) => o.id === wanted) ?? me.orgs[0];
  if (!org) throw new Error('账号没有可用的空间');
  localStorage.setItem(lastOrgKey(userId), org.id);

  // 已经不在其中的团队：删除本机缓存
  const valid = new Set(me.orgs.map((o) => wsName(userId, o.id)));
  for (const name of knownWorkspaces()) {
    if (name.startsWith(`inkloom-${userId}-`) && !valid.has(name)) await forget(name);
  }

  const name = wsName(userId, org.id);
  remember(name);
  setApiOrg(org.id);
  openWorkspaceDb(name, userId, markChanged, (table) => {
    const role = currentOrg()?.role;
    if (role === 'viewer') return '你是只读成员，不能修改内容';
    if (role === 'author' && (table === 'characters' || table === 'world' || table === 'threads' || table === 'proposals')) return '作者不能修改设定集，请联系编辑';
    return null;
  });
  useSession.setState({ orgId: org.id });

  let rejectToastAt = 0;
  try {
    const { firstTime } = await startSync({
      workspace: name,
      orgId: org.id,
      onRejected: (reasons) => {
        if (Date.now() - rejectToastAt < 4000) return;
        rejectToastAt = Date.now();
        toast('有修改没能保存到云端', { tone: 'error', detail: `${reasons.slice(0, 2).join('；')}。你的内容已暂存，可在「设置 → 数据」里找回。`, duration: 8000 });
      },
      onFatal: (error) => {
        if (error.status === 401) useSession.setState({ status: 'anon' });
        else {
          toast('你已不在这个团队中', { tone: 'error', detail: '即将返回个人空间。' });
          localStorage.removeItem(lastOrgKey(userId));
          setTimeout(() => location.assign('/'), 1500);
        }
      },
    });
    useSession.setState({ firstTime });
  } catch (error) {
    // 首次进入且无法连接：没有本地缓存可用
    if (error instanceof ApiError && error.status === 0) throw new Error('无法连接服务器，请检查网络后重试');
    throw error;
  }
  void refreshModels();
  onServerEvent('models', () => void refreshModels());
  onServerEvent('members', () => void refreshMe());
  useSession.setState({ status: 'ready' });
}

/** 成员或角色变化后刷新（例如被管理员调整了角色） */
export async function refreshMe() {
  try {
    const me = await api<MeResponse>('GET', '/api/me', undefined, { org: null });
    const s = useSession.getState();
    if (s.orgId && !me.orgs.some((o) => o.id === s.orgId)) {
      toast('你已被移出这个团队', { tone: 'error' });
      setTimeout(() => location.assign('/'), 1500);
    }
    useSession.setState({ me });
  } catch {
    /* 忽略：下次再试 */
  }
}

/** 下次启动时打开指定团队（用于接受邀请、新建团队之后）。 */
export function setLastOrg(userId: string, orgId: string) {
  localStorage.setItem(lastOrgKey(userId), orgId);
}

export function switchOrg(orgId: string) {
  const me = useSession.getState().me;
  if (!me) return;
  localStorage.setItem(lastOrgKey(me.user.id), orgId);
  void flushSync(4000).finally(() => location.assign('/'));
}

/** 退出登录：先尽量推送未同步的修改，然后删除本机缓存。 */
export async function logout(force = false): Promise<{ ok: boolean; pending: number }> {
  if (!force) {
    const ok = await flushSync(8000);
    if (!ok) return { ok: false, pending: pendingCount() };
  }
  const me = useSession.getState().me;
  stopSync();
  await closeWorkspaceDb();
  await api('POST', '/api/auth/logout', {}).catch(() => {});
  if (me) {
    for (const name of knownWorkspaces()) if (name.startsWith(`inkloom-${me.user.id}-`)) await forget(name);
    localStorage.removeItem(lastOrgKey(me.user.id));
  }
  for (const k of Object.keys(sessionStorage)) if (k.startsWith('inkloom.')) sessionStorage.removeItem(k);
  location.assign('/login');
  return { ok: true, pending: 0 };
}

onUnauthorized(() => {
  if (useSession.getState().status === 'ready') {
    toast('登录已过期，请重新登录', { tone: 'error' });
    setTimeout(() => location.assign('/login'), 1200);
  }
});
