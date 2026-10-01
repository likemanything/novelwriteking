/** 右上角账号菜单：当前团队、切换团队、新建团队、团队管理、退出登录；旁边是云端同步状态。 */
import { Check, ChevronDown, CloudOff, LogOut, Plus, Settings, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/cloud/api';
import { logout, setLastOrg, switchOrg, useOrg, useSession } from '@/cloud/session';
import { useSync } from '@/cloud/sync';
import { cx } from '@/lib/util';
import { ROLE_LABEL } from '@/shared/permissions';
import type { MeResponse } from '@/shared/api';
import { toastError } from '@/store/ui';
import { Button, ConfirmDialog, Input, Menu, Modal } from './ui';

export function SyncBadge({ className, label = true }: { className?: string; label?: boolean }) {
  const { status, pending, error } = useSync();
  const offline = status === 'offline';
  const bad = status === 'error';
  const text = offline ? '离线 · 修改会在联网后同步' : bad ? error || '同步出错' : pending > 0 || status === 'syncing' ? '正在同步…' : '已同步到云端';
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-fs-xs text-ink-3', className)} title={text} role="status">
      {offline ? <CloudOff className="size-3.5 text-gold" /> : <span className={cx('size-1.5 rounded-full', bad ? 'bg-seal' : pending > 0 || status === 'syncing' ? 'animate-[var(--animate-breathe)] bg-gold' : 'bg-jade')} />}
      {label && <span className="hidden md:inline">{text}</span>}
    </span>
  );
}

export function AccountMenu() {
  const navigate = useNavigate();
  const me = useSession((s) => s.me);
  const org = useOrg();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [unsynced, setUnsynced] = useState<number | null>(null);
  if (!me || !org) return null;

  const createTeam = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: string; me: MeResponse }>('POST', '/api/orgs', { name }, { org: null });
      setLastOrg(me.user.id, r.id);
      location.assign('/team');
    } catch (e) {
      toastError(e, '新建失败');
      setBusy(false);
    }
  };

  const doLogout = async () => {
    const r = await logout();
    if (!r.ok) setUnsynced(r.pending);
  };

  return (
    <>
      <SyncBadge />
      <Menu
        trigger={(p) => (
          <button {...p} className="flex h-8 items-center gap-2 rounded-full border border-line pr-2 pl-1 text-xs text-ink-2 transition hover:border-line-2 hover:text-ink">
            <span className="flex size-6 items-center justify-center rounded-full bg-seal/10 font-serif text-fs-xs text-seal">{me.user.name.slice(0, 1)}</span>
            <span className="hidden max-w-28 truncate sm:inline">{org.name}</span>
            <ChevronDown className="size-3.5" />
          </button>
        )}
        items={[
          ...me.orgs.map((o) => ({
            label: `${o.name}${o.id === org.id ? '' : ` · ${ROLE_LABEL[o.role]}`}`,
            icon: o.id === org.id ? <Check /> : <span className="size-4" />,
            onClick: () => o.id !== org.id && switchOrg(o.id),
          })),
          { label: '新建团队…', icon: <Plus />, onClick: () => setCreating(true), divider: true },
          { label: '团队管理', icon: <Users />, onClick: () => navigate('/team') },
          { label: '模型与设置', icon: <Settings />, onClick: () => navigate('/settings') },
          { label: `退出登录（${me.user.name}）`, icon: <LogOut />, onClick: doLogout, divider: true, danger: true },
        ]}
      />
      <Modal open={creating} onClose={() => setCreating(false)} title="新建团队" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>取消</Button><Button variant="seal" loading={busy} disabled={!name.trim()} onClick={createTeam}>创建</Button></>}>
        <p className="mb-3 text-fs-sm text-ink-2">团队有独立的作品、成员和模型配置。你会成为所有者，随后可以邀请成员。</p>
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && createTeam()} placeholder="例如：雾港写作组" maxLength={40} aria-label="团队名称" autoFocus />
      </Modal>
      <ConfirmDialog
        open={unsynced !== null}
        title="还有修改没有同步到云端"
        body={`有 ${unsynced} 处修改尚未上传（可能是网络问题）。现在退出会丢失它们。`}
        confirmLabel="仍然退出"
        danger
        onResolve={async (ok) => {
          setUnsynced(null);
          if (ok) await logout(true);
        }}
      />
    </>
  );
}
