/** 团队管理：成员与角色、邀请链接、AI 用量与额度；平台管理员还能管理内测邀请码。 */
import { ArrowLeft, Copy, Link2, Plus, Trash2, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/cloud/api';
import { logout, refreshMe, useCaps, useOrg, useSession } from '@/cloud/session';
import { TopBar } from '@/components/Brand';
import { Badge, Button, ConfirmDialog, Empty, Field, IconButton, Input, Modal, SectionTitle } from '@/components/ui';
import { formatNumber, relativeTime } from '@/lib/util';
import type { InvitationInfo, MemberInfo, OrgDetail, SignupCodeInfo, UsageResponse } from '@/shared/api';
import { INVITABLE_ROLES, ROLE_HINT, ROLE_LABEL, type OrgRole, type ProjectRole } from '@/shared/permissions';
import { toast, toastError } from '@/store/ui';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

const STAGE_NAME: Record<string, string> = { plan: '构思', write: '写作', review: '审稿', muse: '改写' };
const PROJECT_ROLES: { value: ProjectRole; label: string }[] = [
  { value: 'viewer', label: '只读' },
  { value: 'author', label: '作者' },
  { value: 'editor', label: '编辑' },
];

function useReload<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fn = useCallback(load, deps);
  useEffect(() => {
    let alive = true;
    fn().then((d) => alive && setData(d)).catch((e) => toastError(e));
    return () => {
      alive = false;
    };
  }, [fn, tick]);
  return [data, () => setTick((t) => t + 1)] as const;
}

function Select<T extends string>({ value, onChange, options, disabled, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean; label: string }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} className="field h-8 cursor-pointer appearance-none px-2.5 pr-7 text-fs-xs disabled:cursor-default disabled:opacity-70">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Members({ orgId, canManage, isOwner, kind }: { orgId: string; canManage: boolean; isOwner: boolean; kind: 'personal' | 'team' }) {
  const me = useSession((s) => s.me?.user.id);
  const [data, reload] = useReload(() => api<{ members: MemberInfo[] }>('GET', `/api/orgs/${orgId}/members`), [orgId]);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const [removing, setRemoving] = useState<MemberInfo | null>(null);
  const [transfer, setTransfer] = useState<MemberInfo | null>(null);
  const [editingGrants, setEditingGrants] = useState<MemberInfo | null>(null);

  const setRole = async (m: MemberInfo, role: OrgRole) => {
    try {
      await api('PATCH', `/api/orgs/${orgId}/members/${m.userId}`, { role });
      reload();
    } catch (e) {
      toastError(e, '调整失败');
    }
  };

  if (!data) return null;
  return (
    <section className="mt-12">
      <h2 className="font-serif text-fs-xl font-semibold">成员 <span className="text-ink-3 tabular-nums">{data.members.length}</span></h2>
      <p className="mb-4 text-fs-xs text-ink-3">{kind === 'personal' ? '这是你的个人空间。新建一个团队后，就可以邀请别人一起写。' : '管理员负责成员与模型；编辑负责设定与定稿；作者专注写章节。'}</p>
      <ul className="surface divide-y divide-line rounded-2xl">
        {data.members.map((m) => {
          const self = m.userId === me;
          const locked = !canManage || self || m.role === 'owner' || (m.role === 'admin' && !isOwner);
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-seal/10 font-serif text-fs-sm text-seal">{m.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-fs-base font-medium">
                  <span className="truncate">{m.name}</span>
                  {self && <Badge>我</Badge>}
                </div>
                <div className="text-fs-xs text-ink-3">
                  {m.phone && `${m.phone} · `}加入于 {relativeTime(new Date(m.joinedAt).getTime())} · 本月 {formatNumber(m.monthTokens)} tokens
                  {m.role === 'guest' && m.grants.length > 0 && ` · 可访问 ${m.grants.length} 部作品`}
                </div>
              </div>
              {m.role === 'guest' && canManage && !locked && (
                <Button size="sm" variant="ghost" onClick={() => setEditingGrants(m)}>
                  作品授权
                </Button>
              )}
              {m.role === 'owner' ? (
                <Badge tone="seal">{ROLE_LABEL.owner}</Badge>
              ) : (
                <Select label={`${m.name}的角色`} value={m.role} disabled={locked} onChange={(r) => setRole(m, r)} options={[...(INVITABLE_ROLES.includes(m.role) ? [] : [{ value: m.role, label: ROLE_LABEL[m.role] }]), ...INVITABLE_ROLES.filter((r) => r !== 'admin' || isOwner || m.role === 'admin').map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} />
              )}
              {isOwner && !self && m.role !== 'guest' && kind === 'team' && (
                <Button size="sm" variant="ghost" onClick={() => setTransfer(m)}>
                  转让所有权
                </Button>
              )}
              {canManage && !locked && (
                <IconButton label={`移除${m.name}`} size="sm" onClick={() => setRemoving(m)}>
                  <UserMinus className="size-4" />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!removing}
        title={`移除「${removing?.name ?? ''}」？`}
        body="对方将无法再访问这个团队的作品。已经写好的内容会保留在团队里。"
        confirmLabel="移除"
        danger
        onResolve={async (ok) => {
          const m = removing;
          setRemoving(null);
          if (!ok || !m) return;
          try {
            await api('DELETE', `/api/orgs/${orgId}/members/${m.userId}`);
            reload();
          } catch (e) {
            toastError(e, '移除失败');
          }
        }}
      />
      <ConfirmDialog
        open={!!transfer}
        title={`把所有权转让给「${transfer?.name ?? ''}」？`}
        body="对方会成为所有者，你变为管理员。只有新的所有者可以再转回来。"
        confirmLabel="转让"
        danger
        onResolve={async (ok) => {
          const m = transfer;
          setTransfer(null);
          if (!ok || !m) return;
          try {
            await api('POST', `/api/orgs/${orgId}/transfer`, { userId: m.userId });
            await refreshMe();
            reload();
            toast('所有权已转让', { tone: 'success' });
          } catch (e) {
            toastError(e, '转让失败');
          }
        }}
      />
      <GrantsModal member={editingGrants} orgId={orgId} projects={(projects ?? []).map((p) => ({ id: p.id, title: p.title }))} onClose={(changed) => (setEditingGrants(null), changed && reload())} />
    </section>
  );
}

function GrantsModal({ member, orgId, projects, onClose }: { member: MemberInfo | null; orgId: string; projects: { id: string; title: string }[]; onClose: (changed: boolean) => void }) {
  const [grants, setGrants] = useState<Record<string, ProjectRole | ''>>({});
  useEffect(() => {
    if (member) setGrants(Object.fromEntries(member.grants.map((g) => [g.projectId, g.role])));
  }, [member]);
  const save = async () => {
    if (!member) return;
    try {
      const list = Object.entries(grants).filter(([, r]) => r).map(([projectId, role]) => ({ projectId, role: role as ProjectRole }));
      await api('PATCH', `/api/orgs/${orgId}/members/${member.userId}`, { grants: list });
      onClose(true);
    } catch (e) {
      toastError(e, '保存失败');
    }
  };
  return (
    <Modal open={!!member} onClose={() => onClose(false)} title={`${member?.name ?? ''} 的作品授权`} footer={<><Button variant="ghost" onClick={() => onClose(false)}>取消</Button><Button variant="ink" onClick={save}>保存</Button></>}>
      <p className="mb-3 text-fs-xs text-ink-3">外部协作者只能看到下面被授权的作品。</p>
      {projects.length === 0 && <p className="text-fs-sm text-ink-3">这个团队还没有作品。</p>}
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-fs-sm">{p.title}</span>
            <Select label={`${p.title}的权限`} value={(grants[p.id] ?? '') as ProjectRole | ''} onChange={(v) => setGrants({ ...grants, [p.id]: v })} options={[{ value: '' as const, label: '无权限' }, ...PROJECT_ROLES]} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function Invitations({ orgId, isOwner, kind }: { orgId: string; isOwner: boolean; kind: 'personal' | 'team' }) {
  const [data, reload] = useReload(() => api<{ invitations: InvitationInfo[] }>('GET', `/api/orgs/${orgId}/invitations`), [orgId]);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<OrgRole>('author');
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(7);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [grantRole, setGrantRole] = useState<ProjectRole>('viewer');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ url: string }>('POST', `/api/orgs/${orgId}/invitations`, { role, maxUses, expiresInDays: days, note, projectIds: picked, grantRole });
      setCreated(r.url);
      reload();
    } catch (e) {
      toastError(e, '生成失败');
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast('已复制链接', { tone: 'success' }), () => toast('请手动复制链接'));
  const close = () => {
    setOpen(false);
    setCreated(null);
    setNote('');
    setPicked([]);
  };

  if (!data) return null;
  const active = data.invitations.filter((i) => !i.revoked && new Date(i.expiresAt).getTime() > Date.now() && i.usedCount < i.maxUses);
  return (
    <section className="mt-12">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-fs-xl font-semibold">邀请链接</h2>
          <p className="text-fs-xs text-ink-3">生成一条链接发给对方，对方用手机号登录后自动加入，无需内测邀请码。</p>
        </div>
        <Button variant="ink" size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)} disabled={kind === 'personal'} title={kind === 'personal' ? '个人空间不能邀请成员，请先新建团队' : undefined}>
          新建邀请
        </Button>
      </div>
      {active.length === 0 ? (
        <Empty icon={<Link2 className="size-5" />} title="没有有效的邀请">{kind === 'personal' ? '先新建一个团队，再邀请成员。' : '点右上角「新建邀请」生成链接。'}</Empty>
      ) : (
        <ul className="surface divide-y divide-line rounded-2xl">
          {active.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-fs-sm">
              <Badge tone="indigo">{ROLE_LABEL[i.role]}</Badge>
              <span className="min-w-0 flex-1 truncate text-ink-2">{i.note || '未备注'}</span>
              <span className="text-fs-xs text-ink-3">
                已用 {i.usedCount}/{i.maxUses} · {new Date(i.expiresAt).toLocaleDateString()} 到期 · {i.createdByName}
              </span>
              <IconButton
                label="撤销邀请"
                size="sm"
                onClick={async () => {
                  try {
                    await api('DELETE', `/api/orgs/${orgId}/invitations/${i.id}`);
                    reload();
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-fs-xs text-ink-3">出于安全，链接只在生成时显示一次；忘记复制就撤销后重新生成。</p>

      <Modal open={open} onClose={close} title="新建邀请" footer={created ? <Button variant="ink" onClick={close}>完成</Button> : <><Button variant="ghost" onClick={close}>取消</Button><Button variant="seal" onClick={create} loading={busy} disabled={role === 'guest' && picked.length === 0}>生成链接</Button></>}>
        {created ? (
          <div>
            <p className="mb-2 text-fs-sm text-ink-2">把这条链接发给对方：</p>
            <div className="flex gap-2">
              <Input readOnly value={created} onFocus={(e) => e.currentTarget.select()} className="font-mono text-fs-xs" />
              <Button variant="outline" icon={<Copy className="size-4" />} onClick={() => copy(created)}>
                复制
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <Field label="角色" hint={ROLE_HINT[role]}>
              <Select label="角色" value={role} onChange={setRole} options={INVITABLE_ROLES.filter((r) => r !== 'admin' || isOwner).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </Field>
            {role === 'guest' && (
              <Field label="可访问的作品">
                <div className="space-y-1.5">
                  {(projects ?? []).map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-fs-sm">
                      <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} className="accent-[var(--seal)]" />
                      {p.title}
                    </label>
                  ))}
                  <div className="pt-1">
                    <Select label="作品内的权限" value={grantRole} onChange={setGrantRole} options={PROJECT_ROLES} />
                  </div>
                </div>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="可使用次数">
                <Input type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="有效天数">
                <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 7)))} />
              </Field>
            </div>
            <Field label="备注（可选）">
              <Input value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder="例如：给新来的编辑小周" />
            </Field>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Usage({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [usage, reloadUsage] = useReload(() => api<UsageResponse>('GET', '/api/ai/usage'), [orgId]);
  const [detail, reloadDetail] = useReload(() => api<OrgDetail>('GET', `/api/orgs/${orgId}`), [orgId]);
  const [orgLimit, setOrgLimit] = useState('');
  const [memberLimit, setMemberLimit] = useState('');
  useEffect(() => {
    if (!detail) return;
    setOrgLimit(detail.monthlyTokenLimit === null ? '' : String(detail.monthlyTokenLimit));
    setMemberLimit(detail.memberMonthlyTokenLimit === null ? '' : String(detail.memberMonthlyTokenLimit));
  }, [detail]);

  const saveLimits = async () => {
    try {
      const parse = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))));
      await api('PATCH', `/api/orgs/${orgId}`, { monthlyTokenLimit: parse(orgLimit), memberMonthlyTokenLimit: parse(memberLimit) });
      toast('额度已保存', { tone: 'success' });
      reloadDetail();
      reloadUsage();
    } catch (e) {
      toastError(e, '保存失败');
    }
  };

  if (!usage) return null;
  const pct = usage.limit ? Math.min(100, (usage.totalTokens / usage.limit) * 100) : null;
  return (
    <section className="mt-12">
      <h2 className="font-serif text-fs-xl font-semibold">AI 用量 <span className="text-fs-sm font-normal text-ink-3">{usage.month}</span></h2>
      <p className="mb-4 text-fs-xs text-ink-3">{canManage ? '全团队本月的模型调用，按成员与环节统计。' : '你本月的模型调用。'}</p>
      <div className="surface rounded-2xl p-5">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <span className="font-serif text-fs-2xl font-semibold tabular-nums">{formatNumber(usage.totalTokens)}</span>
            <span className="ml-1.5 text-fs-xs text-ink-3">tokens{usage.limit ? ` / ${formatNumber(usage.limit)}` : '（团队未设上限）'}</span>
          </div>
          {usage.memberLimit !== null && <span className="text-fs-xs text-ink-3">每人每月上限 {formatNumber(usage.memberLimit)}</span>}
        </div>
        {pct !== null && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-seal transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
        )}
        {usage.rows.length > 0 ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-fs-xs">
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1.5 font-medium">成员</th>
                  <th className="py-1.5 font-medium">环节</th>
                  <th className="py-1.5 font-medium">模型</th>
                  <th className="py-1.5 text-right font-medium">调用</th>
                  <th className="py-1.5 text-right font-medium">输入</th>
                  <th className="py-1.5 text-right font-medium">输出</th>
                  <th className="py-1.5 text-right font-medium">失败</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {usage.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1.5">{r.userName}</td>
                    <td className="py-1.5">{STAGE_NAME[r.stage] ?? r.stage}</td>
                    <td className="py-1.5 font-mono text-fs-xs text-ink-3">{r.model}</td>
                    <td className="py-1.5 text-right">{r.calls}</td>
                    <td className="py-1.5 text-right">{formatNumber(r.inputTokens)}</td>
                    <td className="py-1.5 text-right">{formatNumber(r.outputTokens)}</td>
                    <td className="py-1.5 text-right">{r.errors || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-fs-xs text-ink-3">本月还没有调用真实模型（离线演示引擎不计入用量）。</p>
        )}
        {canManage && (
          <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="团队每月上限（tokens）" hint="留空表示不限制">
              <Input type="number" min={0} value={orgLimit} onChange={(e) => setOrgLimit(e.target.value)} placeholder="不限制" />
            </Field>
            <Field label="每人每月上限（tokens）" hint="留空表示不限制">
              <Input type="number" min={0} value={memberLimit} onChange={(e) => setMemberLimit(e.target.value)} placeholder="不限制" />
            </Field>
            <Button variant="ink" onClick={saveLimits}>
              保存额度
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function SignupCodes() {
  const [data, reload] = useReload(() => api<{ codes: SignupCodeInfo[] }>('GET', '/api/admin/signup-codes'), []);
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const create = async () => {
    try {
      const r = await api<{ code: string }>('POST', '/api/admin/signup-codes', { note, maxUses, expiresInDays: 30 });
      await navigator.clipboard?.writeText(r.code).catch(() => {});
      toast(`邀请码 ${r.code}`, { tone: 'success', detail: '已尝试复制到剪贴板' });
      setNote('');
      reload();
    } catch (e) {
      toastError(e, '生成失败');
    }
  };
  if (!data) return null;
  return (
    <section className="mt-12">
      <h2 className="font-serif text-fs-xl font-semibold">内测邀请码 <Badge tone="gold">平台管理员</Badge></h2>
      <p className="mb-4 text-fs-xs text-ink-3">邀请制下，新用户用邀请码注册，并自动获得一个个人空间。</p>
      <div className="surface rounded-2xl p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="备注" className="min-w-48 flex-1">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="发给谁" maxLength={60} />
          </Field>
          <Field label="可用次数" className="w-28">
            <Input type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Button variant="ink" icon={<Plus className="size-4" />} onClick={create}>
            生成邀请码
          </Button>
        </div>
        {data.codes.length > 0 && (
          <ul className="mt-4 divide-y divide-line text-fs-sm">
            {data.codes.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center gap-3 py-2">
                <button className="font-mono font-semibold hover:text-seal" onClick={() => navigator.clipboard?.writeText(c.code).then(() => toast('已复制', { tone: 'success' }))} title="点击复制">
                  {c.code}
                </button>
                <span className="min-w-0 flex-1 truncate text-ink-3">{c.note}</span>
                <span className="text-fs-xs text-ink-3">
                  {c.usedCount}/{c.maxUses}
                  {c.expiresAt ? ` · ${new Date(c.expiresAt).toLocaleDateString()} 到期` : ''}
                </span>
                <IconButton
                  label="删除邀请码"
                  size="sm"
                  onClick={async () => {
                    try {
                      await api('DELETE', `/api/admin/signup-codes/${encodeURIComponent(c.code)}`);
                      reload();
                    } catch (e) {
                      toastError(e);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Danger({ orgId, orgName, kind, isOwner, userId }: { orgId: string; orgName: string; kind: 'personal' | 'team'; isOwner: boolean; userId: string }) {
  const [leave, setLeave] = useState(false);
  const [del, setDel] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  if (kind === 'personal') return null;
  return (
    <section className="mt-12">
      <h2 className="mb-4 font-serif text-fs-xl font-semibold">离开或删除团队</h2>
      <div className="surface flex flex-wrap items-center gap-3 rounded-2xl p-5">
        {!isOwner && (
          <Button variant="outline" onClick={() => setLeave(true)}>
            退出这个团队
          </Button>
        )}
        {isOwner && (
          <>
            <p className="min-w-0 flex-1 text-fs-xs text-ink-3">所有者不能直接退出，请先转让所有权。删除团队会永久删除其中全部作品、成员与模型配置。</p>
            <Button variant="outline" className="text-seal" onClick={() => setDel(true)}>
              删除团队…
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={leave}
        title={`退出「${orgName}」？`}
        body="退出后你将无法再访问这个团队的作品。"
        confirmLabel="退出"
        danger
        onResolve={async (ok) => {
          setLeave(false);
          if (!ok) return;
          try {
            await api('DELETE', `/api/orgs/${orgId}/members/${userId}`);
            localStorage.removeItem(`inkloom.org.${userId}`);
            location.assign('/');
          } catch (e) {
            toastError(e, '退出失败');
          }
        }}
      />
      <Modal open={del} onClose={() => setDel(false)} title="删除团队" footer={<><Button variant="ghost" onClick={() => setDel(false)}>取消</Button><Button variant="seal" disabled={confirmName.trim() !== orgName} onClick={async () => {
        try {
          await api('DELETE', `/api/orgs/${orgId}`, { confirmName });
          localStorage.removeItem(`inkloom.org.${userId}`);
          location.assign('/');
        } catch (e) {
          toastError(e, '删除失败');
        }
      }}>永久删除</Button></>}>
        <p className="mb-3 text-fs-sm leading-relaxed text-ink-2">此操作无法撤销。请输入团队名称 <b className="font-medium">{orgName}</b> 确认。</p>
        <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="团队名称" />
      </Modal>
    </section>
  );
}

export default function Team() {
  const navigate = useNavigate();
  const org = useOrg();
  const caps = useCaps();
  const session = useSession();
  const [name, setName] = useState('');
  useEffect(() => setName(org?.name ?? ''), [org?.name]);
  if (!org || !session.me) return null;

  const rename = async () => {
    if (!name.trim() || name === org.name) return;
    try {
      await api('PATCH', `/api/orgs/${org.id}`, { name });
      await refreshMe();
      toast('已改名', { tone: 'success' });
    } catch (e) {
      toastError(e, '改名失败');
      setName(org.name);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <TopBar />
      <div className="mx-auto max-w-4xl px-6 pt-6 pb-24">
        <button onClick={() => navigate(-1)} className="mb-6 inline-flex items-center gap-1.5 text-fs-sm text-ink-3 transition hover:text-ink">
          <ArrowLeft className="size-4" /> 返回
        </button>
        <SectionTitle eyebrow={org.kind === 'personal' ? '个人空间' : '团队'} title="团队管理" />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} disabled={!caps.manageMembers} maxLength={40} aria-label="团队名称" className="max-w-xs font-serif text-fs-md font-semibold" />
          <Badge tone="seal">我的角色：{ROLE_LABEL[org.role]}</Badge>
        </div>

        <Members orgId={org.id} canManage={caps.manageMembers} isOwner={org.role === 'owner'} kind={org.kind} />
        {caps.manageMembers && <Invitations orgId={org.id} isOwner={org.role === 'owner'} kind={org.kind} />}
        <Usage orgId={org.id} canManage={caps.manageMembers} />
        {session.me.user.platformAdmin && <SignupCodes />}
        <Danger orgId={org.id} orgName={org.name} kind={org.kind} isOwner={org.role === 'owner'} userId={session.me.user.id} />

        <div className="mt-12 flex items-center justify-between border-t border-line pt-6 text-fs-xs text-ink-3">
          <span>
            登录账号：{session.me.user.name}（{session.me.user.phone}）
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await api('POST', '/api/me/logout-all').catch(() => {});
              await logout(true);
            }}
          >
            退出所有设备
          </Button>
        </div>
      </div>
    </div>
  );
}
