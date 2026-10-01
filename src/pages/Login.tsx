/**
 * 登录 / 注册：手机号 + 短信验证码。新用户在邀请制下还需要内测邀请码；
 * 通过团队邀请链接进来的人（invitation）不需要邀请码，登录后直接加入团队。
 */
import { motion } from 'motion/react';
import { ArrowRight, KeyRound, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { api, ApiError } from '@/cloud/api';
import { ensureSession, setLastOrg, useSession } from '@/cloud/session';
import { Seal } from '@/components/Seal';
import { ThreadField } from '@/components/ThreadField';
import { Button, Input } from '@/components/ui';
import type { MeResponse } from '@/shared/api';

/** 登录表单本体（登录页和邀请页共用）。onDone 在登录成功后调用。 */
export function LoginForm({ invitation, inviteOrgName, onDone }: { invitation?: string; inviteOrgName?: string; onDone: (me: MeResponse) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [signupCode, setSignupCode] = useState('');
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  const [needInvite, setNeedInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; devCode?: string }>('POST', '/api/auth/otp', { phone }, { org: null });
      setSent(true);
      setCooldown(60);
      setDevCode(r.devCode ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'otp_cooldown') {
        setSent(true);
        setCooldown(Number(e.data.retryAfter) || 60);
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const me = await api<MeResponse>('POST', '/api/auth/verify', { phone, code, invitation, signupCode: signupCode || undefined, name: name || undefined }, { org: null });
      if (invitation && inviteOrgName) {
        const joined = me.orgs.find((o) => o.name === inviteOrgName);
        if (joined) setLastOrg(me.user.id, joined.id);
      }
      onDone(me);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'need_invite') setNeedInvite(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!sent) void sendCode();
    else void verify();
  };

  const validPhone = /^1\d{10}$/.test(phone.replace(/\D/g, '').replace(/^86/, ''));

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <label htmlFor="phone" className="text-xs font-medium tracking-wide text-ink-2">
        手机号
      </label>
      <div className="relative">
        <Smartphone className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input id="phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 位手机号" className="pl-9" disabled={sent && busy} autoFocus />
      </div>

      {sent && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
          <label htmlFor="otp" className="text-xs font-medium tracking-wide text-ink-2">
            验证码
          </label>
          <div className="flex gap-2">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6 位数字" className="font-mono tracking-[.3em]" autoFocus />
            <Button type="button" variant="outline" onClick={sendCode} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `${cooldown} 秒后重发` : '重新发送'}
            </Button>
          </div>
          {devCode && (
            <p className="rounded-lg bg-gold/10 px-3 py-2 text-[12px] text-ink-2">
              开发模式：验证码是 <button type="button" onClick={() => setCode(devCode)} className="font-mono font-semibold underline">{devCode}</button>（点击填入）
            </p>
          )}
          {(needInvite || (!invitation && signupCode)) && !invitation && (
            <>
              <label htmlFor="signup" className="text-xs font-medium tracking-wide text-ink-2">
                内测邀请码 <span className="font-normal text-ink-3">（新用户注册需要）</span>
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                <Input id="signup" value={signupCode} onChange={(e) => setSignupCode(e.target.value.toUpperCase())} placeholder="例如 K7M2-XQ9P" className="pl-9 font-mono" autoComplete="off" />
              </div>
            </>
          )}
          {!invitation && !needInvite && (
            <button type="button" onClick={() => setNeedInvite(true)} className="self-start text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
              第一次来？我有邀请码
            </button>
          )}
          {(needInvite || invitation) && (
            <>
              <label htmlFor="nick" className="text-xs font-medium tracking-wide text-ink-2">
                昵称 <span className="font-normal text-ink-3">（可选，仅新用户）</span>
              </label>
              <Input id="nick" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="团队里显示的名字" />
            </>
          )}
        </motion.div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-seal/[.07] px-3 py-2 text-[12.5px] text-seal">
          {error}
        </p>
      )}

      <Button type="submit" variant="seal" size="lg" loading={busy} disabled={!validPhone || (sent && code.length !== 6)} icon={<ArrowRight className="size-4" />} className="mt-2">
        {sent ? '登录' : '获取验证码'}
      </Button>
    </form>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="relative isolate flex h-full items-center justify-center overflow-y-auto px-5 py-10">
      <ThreadField className="absolute inset-0 -z-10 h-full w-full" energy={0.15} converge={0} />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="surface relative w-full max-w-[420px] rounded-3xl p-8">
        <div className="mb-6 flex items-center gap-3">
          <Seal size={40} />
          <div>
            <div className="font-serif text-[22px] leading-tight font-semibold tracking-[.2em]">墨织</div>
            <div className="text-[10px] tracking-[.32em] text-ink-3 uppercase">Inkloom</div>
          </div>
        </div>
        <h1 className="font-serif text-[20px] font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 mb-5 text-[13px] leading-relaxed text-ink-3">{subtitle}</p>}
        {!subtitle && <div className="mb-5" />}
        {children}
      </motion.div>
    </div>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const next = params.get('next');
  const status = useSession((s) => s.status);
  useEffect(() => ensureSession(), []);
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  // 已经登录的人不需要再看登录页
  if (status === 'ready') return <Navigate to={target} replace />;
  return (
    <AuthShell title="登录墨织" subtitle="用手机号登录。新用户注册需要内测邀请码，或者通过团队的邀请链接加入。">
      <LoginForm
        onDone={() => {
          // 整页跳转，让会话、本地数据库与同步从干净状态启动
          const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
          window.location.assign(target);
        }}
      />
      <Link to="/" className="mt-5 inline-block text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
        ← 回到首页
      </Link>
    </AuthShell>
  );
}
