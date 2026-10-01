/**
 * 角色与权限规则：前端（即时提示、隐藏按钮）和服务端（最终裁决）共用同一份规则。
 *
 * 组织角色：所有者、管理员、编辑、作者、只读、外部协作者。
 * 外部协作者没有组织级权限，只能访问被授权的作品，在该作品里按授权角色（编辑/作者/只读）行事。
 */

export type OrgRole = 'owner' | 'admin' | 'editor' | 'author' | 'viewer' | 'guest';
export type ProjectRole = 'editor' | 'author' | 'viewer';
export type EffectiveRole = Exclude<OrgRole, 'guest'>;

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '编辑',
  author: '作者',
  viewer: '只读',
  guest: '外部协作者',
};

export const ROLE_HINT: Record<OrgRole, string> = {
  owner: '全部权限，包括删除团队、转让所有权',
  admin: '管理成员、模型接入和用量额度',
  editor: '管理作品与设定集，可以定稿、采纳设定变化',
  author: '写章节、改细纲、用 AI 起草和审稿，不能定稿、不能改设定集',
  viewer: '只能查看',
  guest: '只能访问被邀请的作品',
};

/** 可以邀请的角色（所有者只能通过转让产生）。 */
export const INVITABLE_ROLES: OrgRole[] = ['admin', 'editor', 'author', 'viewer', 'guest'];

const RANK: Record<EffectiveRole, number> = { viewer: 0, author: 1, editor: 2, admin: 3, owner: 4 };

export function atLeast(role: EffectiveRole | null | undefined, min: EffectiveRole): boolean {
  return !!role && RANK[role] >= RANK[min];
}

/** 写作数据里需要同步的表（与浏览器本地数据库的表名一致）。 */
export const SYNC_TABLES = ['projects', 'characters', 'world', 'threads', 'chapters', 'versions', 'critiques', 'proposals', 'daily'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export function isSyncTable(t: string): t is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(t);
}

/** 推送顺序：先建作品再建章节等子数据；删除则反过来。 */
export const SYNC_ORDER: Record<SyncTable, number> = {
  projects: 0,
  characters: 1,
  world: 1,
  threads: 1,
  chapters: 2,
  versions: 3,
  critiques: 4,
  proposals: 4,
  daily: 4,
};

export interface Capabilities {
  write: boolean; // 可以写正文、细纲
  editSettings: boolean; // 可以修改设定集（人物、世界观、故事线、文风、故事梗概）
  finalize: boolean; // 可以定稿、解除定稿
  acceptProposals: boolean; // 可以采纳设定变化
  manageProjects: boolean; // 可以新建、删除作品
  deleteChapters: boolean;
  manageModels: boolean; // 可以接入模型、调整环节分工
  manageMembers: boolean; // 可以邀请、移除成员，调整角色
  manageOrg: boolean; // 可以改团队名、删除团队
}

export function capabilities(role: EffectiveRole | null | undefined, orgRole?: OrgRole | null): Capabilities {
  const editor = atLeast(role, 'editor');
  const admin = orgRole ? orgRole === 'owner' || orgRole === 'admin' : atLeast(role, 'admin');
  return {
    write: atLeast(role, 'author'),
    editSettings: editor,
    finalize: editor,
    acceptProposals: editor,
    manageProjects: orgRole ? orgRole !== 'guest' && editor : editor,
    deleteChapters: editor,
    manageModels: admin,
    manageMembers: admin,
    manageOrg: orgRole === 'owner',
  };
}

export type WriteDecision = { ok: true; onlyFields?: string[] } | { ok: false; reason: string };

type Row = Record<string, unknown> | null | undefined;

/**
 * 判断某个角色能否对写作数据做这次修改。
 * prev 为修改前的行（新建时为空），next 为修改后的行（删除时为空）。
 * onlyFields：只允许改这些字段，其余字段保持原值（例如作者保存章节时顺带更新作品的“最近修改时间”）。
 */
export function checkWrite(role: EffectiveRole | null | undefined, table: SyncTable, prev: Row, next: Row): WriteDecision {
  if (!role || role === 'viewer') return { ok: false, reason: '只读成员不能修改内容' };
  if (atLeast(role, 'editor')) return { ok: true };

  // 以下是「作者」的限制
  const deny = (reason: string): WriteDecision => ({ ok: false, reason });
  switch (table) {
    case 'projects':
      if (!prev || !next) return deny('作者不能新建或删除作品');
      return { ok: true, onlyFields: ['updatedAt'] };
    case 'characters':
    case 'world':
    case 'threads':
      return deny('作者不能修改设定集，请联系编辑');
    case 'proposals':
      return deny('作者不能处理设定变化，请联系编辑');
    case 'chapters': {
      if (!next) return deny('作者不能删除章节');
      if (prev?.status === 'final') return deny('这一章已定稿，修改前需要编辑解除定稿');
      if (next.status === 'final') return deny('作者不能定稿，请联系编辑');
      if ((prev?.canonVersionId ?? null) !== (next.canonVersionId ?? null)) return deny('作者不能更改定稿版本');
      return { ok: true };
    }
    case 'versions':
    case 'critiques':
      if (!next) return deny('作者不能删除版本或审稿记录');
      return { ok: true };
    case 'daily':
      return { ok: true };
  }
}
