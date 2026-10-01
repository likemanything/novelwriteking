/** 团队邀请链接：展示谁邀请你加入哪个团队；已登录直接加入，未登录先登录。 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '@/cloud/api';
import { setLastOrg } from '@/cloud/session';
import { Button, InkSpinner } from '@/components/ui';
import type { InvitationPreview, MeResponse } from '@/shared/api';
import { ROLE_HINT, ROLE_LABEL } from '@/shared/permissions';
import { AuthShell, LoginForm } from './Login';

export default function Invite() {
  const { token = '' } = useParams();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api<InvitationPreview>('GET', `/api/invitations/${encodeURIComponent(token)}`, undefined, { org: null })
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api<MeResponse>('GET', '/api/me', undefined, { org: null })
      .then(setMe)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setMe(null);
        else setMe(null);
      });
  }, [token]);

  const join = async () => {
    setJoining(true);
    try {
      const r = await api<{ orgId: string }>('POST', `/api/invitations/${encodeURIComponent(token)}/accept`, {}, { org: null });
      if (me) setLastOrg(me.user.id, r.orgId);
      window.location.assign('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJoining(false);
    }
  };

  if (error && !preview) {
    return (
      <AuthShell title="邀请链接无法使用" subtitle={error}>
        <Link to="/" className="text-fs-sm text-ink-3 underline-offset-2 hover:text-ink hover:underline">
          回到墨织
        </Link>
      </AuthShell>
    );
  }
  if (!preview || me === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3">
        <InkSpinner className="size-6" />
      </div>
    );
  }

  const who = preview.inviterName ? `${preview.inviterName} 邀请你` : '你收到一份邀请';
  return (
    <AuthShell title={`加入「${preview.orgName}」`} subtitle={`${who}以「${ROLE_LABEL[preview.role]}」身份加入这个团队。${ROLE_HINT[preview.role]}。`}>
      {!preview.valid ? (
        <p role="alert" className="rounded-lg bg-seal/[.07] px-3 py-2 text-fs-sm text-seal">
          {preview.reason ?? '这条邀请已失效'}，请向邀请人要一条新的链接。
        </p>
      ) : me ? (
        <div className="flex flex-col gap-3">
          <p className="text-fs-sm text-ink-2">当前登录账号：{me.user.name}（{me.user.phone}）</p>
          {error && (
            <p role="alert" className="rounded-lg bg-seal/[.07] px-3 py-2 text-fs-xs text-seal">
              {error}
            </p>
          )}
          <Button variant="seal" size="lg" onClick={join} loading={joining}>
            加入团队
          </Button>
        </div>
      ) : (
        <LoginForm invitation={token} inviteOrgName={preview.orgName} onDone={() => window.location.assign('/')} />
      )}
    </AuthShell>
  );
}
