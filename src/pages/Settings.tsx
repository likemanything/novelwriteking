/**
 * 模型与设置。
 * 墨织不托管任何模型：接入你自己的服务商，然后为「构思 / 执笔 / 审稿 / 缪斯」四支笔分别指定模型。
 * 例如：便宜快速的模型做缪斯，最强的模型执笔，严谨的模型审稿。
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, Download, Eye, EyeOff, HardDrive, KeyRound, Lightbulb, Pen, Plug, Quote, Radar, ShieldAlert, SlidersHorizontal, Sparkles, Trash2, Users, Wand2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { TopBar } from '@/components/Brand';
import { api } from '@/cloud/api';
import { refreshModels, useModels } from '@/cloud/models';
import { useCaps } from '@/cloud/session';
import { ConnectModel, DetectTrack, useConnector } from '@/components/ConnectModel';
import { Badge, Button, ConfirmDialog, Field, IconButton, Input, SectionTitle, Segmented, Toggle } from '@/components/ui';
import { db, rawDb } from '@/lib/db';
import { exportBackup } from '@/lib/export';
import { seedSampleProject } from '@/lib/sample';
import { cx, formatNumber } from '@/lib/util';
import type { CredentialInfo } from '@/shared/api';
import { DEMO_PROFILE, STAGE_LABEL, useSettings, type Stage } from '@/store/settings';
import { toast, toastError } from '@/store/ui';

const STAGE_ICON: Record<Stage, ReactNode> = {
  plan: <Lightbulb />,
  write: <Pen />,
  review: <Quote />,
  muse: <Sparkles />,
};

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string };

function ProfileCard({ p, canEdit, onRemove }: { p: CredentialInfo; canEdit: boolean; onRemove: () => void }) {
  const stages = useModels((s) => s.stages);
  const [advanced, setAdvanced] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const redetect = useConnector();
  const [draft, setDraft] = useState(p);
  useEffect(() => setDraft(p), [p]);

  const save = async (patch: Partial<CredentialInfo> & { apiKey?: string }) => {
    try {
      await api('PATCH', `/api/ai/credentials/${p.id}`, patch);
      setTest({ status: 'idle' });
      await refreshModels();
    } catch (error) {
      toastError(error, '保存失败');
      setDraft(p);
    }
  };
  const local = /127\.0\.0\.1|localhost/.test(p.baseUrl);
  const uses = (Object.keys(STAGE_LABEL) as Stage[]).filter((k) => stages[k] === p.id);
  const models = p.models?.length ? (p.models.includes(p.model) ? p.models : [p.model, ...p.models]) : [];

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      const { reply } = await api<{ reply: string }>('POST', `/api/ai/credentials/${p.id}/test`, {});
      setTest({ status: 'ok', message: `模型回复：「${reply}」` });
    } catch (error) {
      setTest({ status: 'fail', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const runRedetect = async () => {
    const r = await redetect.run({ credentialId: p.id });
    if (r) toast(`已重新识别「${r.credential.name}」`, { tone: 'success', detail: `${r.credential.protocolLabel} · ${r.credential.models.length} 个模型` });
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className="surface rounded-2xl">
      <div className="flex flex-wrap items-center gap-3 p-4 pl-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink text-paper">
          <Plug className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft.name}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onBlur={() => draft.name.trim() && draft.name !== p.name && save({ name: draft.name })}
              className="field-bare h-7 w-auto max-w-56 px-1.5 font-serif text-[16px] font-semibold"
              style={{ width: `${Math.max(4, [...draft.name].reduce((w, ch) => w + (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.62), 0) + 1.2)}em` }}
              aria-label="模型名称"
            />
            <Badge tone="indigo">{p.protocolLabel}</Badge>
            {uses.map((k) => (
              <Badge key={k} tone="seal">
                {STAGE_LABEL[k].label}
              </Badge>
            ))}
          </div>
          <div className="mt-0.5 truncate px-1.5 font-mono text-[11.5px] text-ink-3" title={p.baseUrl}>
            {p.baseUrl}
            {p.keyHint ? ` · Key ${p.keyHint}` : ''}
          </div>
        </div>
        {canEdit ? (
          <>
            <label className="relative">
              <span className="sr-only">使用的模型</span>
              {models.length ? (
                <select value={p.model} onChange={(e) => save({ model: e.target.value })} className="field h-9 max-w-60 cursor-pointer appearance-none pr-8 font-mono text-[12px]">
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value.trim() })} onBlur={() => draft.model && draft.model !== p.model && save({ model: draft.model })} placeholder="模型名" className="h-9 w-48 font-mono text-[12px]" spellCheck={false} />
              )}
              {models.length > 0 && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[10px] text-ink-3">▼</span>}
            </label>
            <Button variant="outline" size="sm" onClick={runTest} loading={test.status === 'testing'}>
              测试
            </Button>
            <IconButton label={advanced ? '收起高级设置' : '高级设置'} size="sm" active={advanced} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
              <SlidersHorizontal className="size-4" />
            </IconButton>
            <IconButton label="删除模型" size="sm" onClick={onRemove}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        ) : (
          <span className="font-mono text-[12px] text-ink-3">{p.model}</span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {test.status !== 'idle' && test.status !== 'testing' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className={cx('mx-5 mb-4 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[12px]', test.status === 'ok' ? 'bg-jade/10 text-jade' : 'bg-seal/[.07] text-seal')} role={test.status === 'fail' ? 'alert' : 'status'}>
              {test.status === 'ok' ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <X className="mt-0.5 size-3.5 shrink-0" />}
              <span className="break-words">{test.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {advanced && canEdit && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="border-t border-line px-5 pt-4 pb-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="协议" group hint="通常由自动识别决定">
                  <Segmented
                    size="sm"
                    value={p.provider}
                    onChange={(v) => save({ provider: v })}
                    options={[
                      { value: 'openai', label: 'OpenAI 兼容' },
                      { value: 'anthropic', label: 'Anthropic' },
                    ]}
                  />
                </Field>
                <Field label="模型标识" hint="可手动填写列表外的模型">
                  <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value.trim() })} onBlur={() => draft.model && draft.model !== p.model && save({ model: draft.model })} list={`models-${p.id}`} className="font-mono text-[12.5px]" spellCheck={false} />
                  <datalist id={`models-${p.id}`}>
                    {p.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
                <Field label="接口地址" hint={p.provider === 'anthropic' ? '/v1/messages' : '/chat/completions'}>
                  <Input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value.trim() })} onBlur={() => draft.baseUrl !== p.baseUrl && save({ baseUrl: draft.baseUrl })} placeholder="https://api.example.com/v1" className="font-mono text-[12.5px]" spellCheck={false} />
                </Field>
                <Field label="API Key" hint={newKey === null ? `已加密保存${p.keyHint ? `（${p.keyHint}）` : ''}，不会再显示` : local ? '本地模型可留空' : '填写后覆盖原有的 Key'}>
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={newKey ?? ''}
                      onChange={(e) => setNewKey(e.target.value.trim())}
                      onBlur={() => {
                        if (newKey !== null) save({ apiKey: newKey }).then(() => setNewKey(null));
                      }}
                      placeholder="粘贴新的 Key 以更换"
                      className="pr-10 font-mono text-[12.5px]"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" onClick={() => setShowKey(!showKey)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-ink-3 hover:text-ink" aria-label={showKey ? '隐藏密钥' : '显示密钥'}>
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="温度" hint={draft.temperature.toFixed(2)}>
                  <input type="range" min={0} max={1.5} step={0.05} value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })} onPointerUp={() => save({ temperature: draft.temperature })} onKeyUp={() => save({ temperature: draft.temperature })} className="mt-3 w-full accent-[var(--seal)]" aria-label="温度" />
                </Field>
                <Field label="最大输出 tokens">
                  <Input type="number" min={256} max={200000} step={256} value={draft.maxTokens} onChange={(e) => setDraft({ ...draft, maxTokens: Number(e.target.value) || 4096 })} onBlur={() => draft.maxTokens !== p.maxTokens && save({ maxTokens: draft.maxTokens })} />
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4">
                <span className="text-[12px] text-ink-3">密钥由服务器加密保存，团队成员使用模型时不会看到它。</span>
                <Button variant="soft" size="sm" className="ml-auto" icon={<Radar className="size-3.5" />} onClick={runRedetect} loading={redetect.phase === 'running'}>
                  重新识别
                </Button>
              </div>
              {redetect.phase !== 'idle' && (
                <div className="mt-4">
                  <DetectTrack steps={redetect.steps} />
                  {redetect.error && (
                    <p className="mt-3 text-[12px] text-seal" role="alert">
                      {redetect.error.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StageBoard({ canEdit }: { canEdit: boolean }) {
  const credentials = useModels((s) => s.credentials);
  const stages = useModels((s) => s.stages);
  const options = [DEMO_PROFILE, ...credentials.map((c) => ({ id: c.id, name: c.name, provider: 'cloud' as const, model: c.model }))];
  const setStage = async (stage: Stage, id: string) => {
    const prev = useModels.getState().stages;
    useModels.setState({ stages: { ...prev, [stage]: id === DEMO_PROFILE.id ? null : id } });
    try {
      await api('PUT', '/api/ai/stages', { stage, credentialId: id === DEMO_PROFILE.id ? null : id });
    } catch (error) {
      useModels.setState({ stages: prev });
      toastError(error, '保存失败');
    }
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(Object.keys(STAGE_LABEL) as Stage[]).map((s, i) => {
        const current = options.find((p) => p.id === stages[s]) ?? DEMO_PROFILE;
        return (
          <motion.div key={s} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="surface relative overflow-hidden rounded-2xl p-5">
            <span className="absolute -top-8 -right-8 size-24 rounded-full bg-seal/[.07]" />
            <span className="relative flex size-9 items-center justify-center rounded-xl bg-seal/10 text-seal [&>svg]:size-[18px]">{STAGE_ICON[s]}</span>
            <div className="relative mt-4 font-serif text-[18px] font-semibold">{STAGE_LABEL[s].label}</div>
            <div className="relative text-[12px] text-ink-3">{STAGE_LABEL[s].hint}</div>
            <label className="relative mt-4 block">
              <span className="sr-only">{STAGE_LABEL[s].label}使用的模型</span>
              <select value={current.id} disabled={!canEdit} onChange={(e) => setStage(s, e.target.value)} className="field h-9 cursor-pointer appearance-none pr-8 text-[13px] disabled:cursor-not-allowed disabled:opacity-70">
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[10px] text-ink-3">▼</span>
            </label>
            <div className="relative mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
              <span className={cx('size-1.5 rounded-full', current.provider === 'demo' ? 'bg-gold' : 'bg-jade')} />
              {current.provider === 'demo' ? '离线演示，不消耗额度' : current.model}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function StorageInfo() {
  const [usage, setUsage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);
  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      if (est) setUsage({ used: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    })();
  }, []);
  if (!usage) return null;
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
      <HardDrive className="size-4" />
      已用 {mb(usage.used)}
      {usage.quota ? ` / 可用约 ${formatNumber(Math.round(usage.quota / 1024 / 1024))} MB` : ''}
      <Badge tone={usage.persisted ? 'jade' : 'gold'}>{usage.persisted ? '持久存储' : '可能被浏览器清理'}</Badge>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const s = useSettings();
  const caps = useCaps();
  const credentials = useModels((m) => m.credentials);
  const [backingUp, setBackingUp] = useState(false);
  const [removing, setRemoving] = useState<CredentialInfo | null>(null);
  const rescued = useLiveQuery(() => rawRescued(), [], []);

  const backupAll = async () => {
    setBackingUp(true);
    try {
      const projects = await db.projects.toArray();
      for (const p of projects) await exportBackup(p);
      toast(`已导出 ${projects.length} 部作品的备份`, { tone: 'success' });
    } catch (error) {
      toastError(error, '备份失败');
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <TopBar />
      <div className="mx-auto max-w-5xl px-6 pt-6 pb-24">
        <button onClick={() => navigate(-1)} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition hover:text-ink">
          <ArrowLeft className="size-4" /> 返回
        </button>
        <SectionTitle eyebrow="设置" title="模型与偏好" />
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">墨织不提供、不托管任何模型。团队接入自己的服务商后，提示词与上下文只会发送给这里配置的地址。</p>

        {/* 模型 */}
        <section className="mt-12">
          <div className="mb-5">
            <h2 className="font-serif text-[20px] font-semibold">接入模型</h2>
            <p className="text-[12.5px] text-ink-3">
              {caps.manageModels ? '模型属于当前团队，由管理员接入，成员共用。DeepSeek 只要一把 Key；其他服务填地址和 Key，墨织会自动识别协议、读取模型列表，并试写一句确认连通。' : '模型由团队管理员接入，你可以直接在写作中使用。'}
            </p>
          </div>
          {caps.manageModels && <ConnectModel />}

          <div className="mt-10 mb-4 flex items-end justify-between">
            <h3 className="font-serif text-[17px] font-semibold">
              已接入 <span className="text-ink-3 tabular-nums">{credentials.length || ''}</span>
            </h3>
          </div>
          <div className="space-y-3">
            <AnimatePresence>
              {credentials.map((p) => (
                <ProfileCard key={p.id} p={p} canEdit={caps.manageModels} onRemove={() => setRemoving(p)} />
              ))}
            </AnimatePresence>
            {!credentials.length && (
              <div className="flex items-center gap-4 rounded-2xl border border-dashed border-line-2 px-5 py-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
                  <Wand2 className="size-5" />
                </span>
                <div className="text-[13px] leading-relaxed text-ink-2">
                  现在使用的是<b className="font-medium text-ink">离线演示引擎</b>：它不是语言模型，只用于体验完整流程。{caps.manageModels ? '在上面接入一个真实模型后，它会自动接管全部环节。' : '请联系管理员接入模型。'}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-ink/[.03] px-4 py-3 text-[12px] leading-relaxed text-ink-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold" />
            <span>API Key 经服务器加密保存，不会下发到任何成员的浏览器。提示词与上下文会经墨织服务器转发给团队配置的模型服务商，并按成员记录用量。</span>
          </div>
        </section>

        {/* 分工 */}
        <section className="mt-14">
          <h2 className="font-serif text-[20px] font-semibold">环节分工</h2>
          <p className="mb-5 text-[12.5px] text-ink-3">不同环节可以用不同的模型：最强的负责写作，严谨的负责审稿，快速便宜的负责改写。{!caps.manageModels && '（只有管理员可以调整）'}</p>
          <StageBoard canEdit={caps.manageModels} />
        </section>

        <ConfirmDialog
          open={!!removing}
          title={`移除「${removing?.name ?? ''}」？`}
          body="使用它的环节会退回离线演示引擎，直到你指定别的模型。保存的 Key 会一并删除。"
          confirmLabel="移除"
          danger
          onResolve={async (ok) => {
            const c = removing;
            setRemoving(null);
            if (!ok || !c) return;
            try {
              await api('DELETE', `/api/ai/credentials/${c.id}`);
              await refreshModels();
              toast(`已移除「${c.name}」`);
            } catch (error) {
              toastError(error, '移除失败');
            }
          }}
        />

        {/* 偏好 */}
        <section className="mt-14">
          <h2 className="mb-5 font-serif text-[20px] font-semibold">写作偏好</h2>
          <div className="surface divide-y divide-line rounded-2xl">
            <Row title="主题" hint="日间或夜间配色，也可以跟随系统。">
              <Segmented
                size="sm"
                value={s.theme}
                onChange={s.setTheme}
                options={[
                  { value: 'paper', label: '日间' },
                  { value: 'night', label: '夜间' },
                  { value: 'system', label: '跟随系统' },
                ]}
              />
            </Row>
            <Row title="正文字号" hint="稿纸编辑器的字号。">
              <div className="flex items-center gap-3">
                <input type="range" min={14} max={26} value={s.editorSize} onChange={(e) => s.patch({ editorSize: Number(e.target.value) })} className="w-40 accent-[var(--seal)]" aria-label="正文字号" />
                <span className="w-10 text-right font-serif text-[15px] tabular-nums">{s.editorSize}</span>
              </div>
            </Row>
            <Row title="打字机模式" hint="输入时让当前行始终停在屏幕中央。">
              <Toggle checked={s.typewriter} onChange={(v) => s.patch({ typewriter: v })} label="打字机模式" />
            </Row>
            <Row title="上下文预算" hint="每次生成最多装入多少 token 的设定资料。模型窗口越大，可以设得越高。">
              <div className="flex items-center gap-3">
                <input type="range" min={2000} max={64000} step={1000} value={s.contextBudget} onChange={(e) => s.patch({ contextBudget: Number(e.target.value) })} className="w-40 accent-[var(--seal)]" aria-label="上下文预算" />
                <span className="w-16 text-right text-[13px] tabular-nums">{(s.contextBudget / 1000).toFixed(0)}k</span>
              </div>
            </Row>
            <Row title="减少动态效果" hint="关闭首页背景动画与大部分过渡动画。系统已开启「减弱动态效果」时自动生效。">
              <Toggle checked={s.reducedMotion} onChange={(v) => s.patch({ reducedMotion: v })} label="减少动态效果" />
            </Row>
          </div>
        </section>

        {/* 团队 */}
        <section className="mt-14">
          <h2 className="mb-1 font-serif text-[20px] font-semibold">团队与账号</h2>
          <p className="mb-5 text-[12.5px] text-ink-3">成员、邀请链接、AI 用量与额度。</p>
          <Link to="/team" className="surface flex items-center gap-3 rounded-2xl p-5 transition hover:shadow-[var(--shadow-card)]">
            <span className="flex size-9 items-center justify-center rounded-xl bg-seal/10 text-seal">
              <Users className="size-[18px]" />
            </span>
            <span className="text-[14px] font-medium">打开团队管理</span>
            <ArrowLeft className="ml-auto size-4 rotate-180 text-ink-3" />
          </Link>
        </section>

        {/* 数据 */}
        <section className="mt-14">
          <h2 className="mb-1 font-serif text-[20px] font-semibold">数据</h2>
          <p className="mb-5 text-[12.5px] text-ink-3">作品保存在云端，并在这台设备的浏览器里留有一份本地副本，离线时也能继续写，恢复网络后自动同步。仍建议定期备份。</p>
          <div className="surface flex flex-wrap items-center gap-3 rounded-2xl p-5">
            <StorageInfo />
            <div className="ml-auto flex gap-2">
              {caps.manageProjects && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    seedSampleProject().then((id) => toast('示例作品已放上书架', { tone: 'success', action: { label: '打开', run: () => navigate(`/p/${id}`) } }))
                  }
                >
                  重新放置示例作品
                </Button>
              )}
              <Button variant="ink" size="sm" icon={<Download className="size-4" />} onClick={backupAll} loading={backingUp}>
                备份全部作品
              </Button>
            </div>
          </div>
          <RescuedList items={rescued ?? []} />
        </section>

        <div className="mt-10 flex items-center gap-2 text-[12px] text-ink-3">
          <KeyRound className="size-3.5" />
          快捷键：⌘K 命令面板 · ⌘J 续写 · ⌘. 专注模式 · ⌘S 保存 · Tab 接受续写
        </div>
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        <div className="text-[12px] text-ink-3">{hint}</div>
      </div>
      {children}
    </div>
  );
}

async function rawRescued() {
  return rawDb.rescued.orderBy('createdAt').reverse().toArray();
}

/** 推送被服务端拒绝时暂存的内容（例如只读成员的改动、别人正在编辑的章节）。 */
function RescuedList({ items }: { items: Awaited<ReturnType<typeof rawRescued>> }) {
  if (!items.length) return null;
  const label = (row: Record<string, unknown>) => String(row.title ?? row.name ?? row.id ?? '内容');
  const text = (row: Record<string, unknown>) => (typeof row.content === 'string' ? row.content : JSON.stringify(row, null, 2));
  return (
    <div className="mt-6">
      <h3 className="font-serif text-[16px] font-semibold">未能保存的修改 <span className="text-ink-3 tabular-nums">{items.length}</span></h3>
      <p className="mb-3 text-[12px] text-ink-3">这些修改被服务器拒绝（权限不足、章节被他人锁定或已被改动），内容暂存在这里，可以复制出来再处理。</p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="surface flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-[12.5px]">
            <Badge tone="gold">{it.table}</Badge>
            <span className="min-w-0 flex-1 truncate font-medium">{label(it.row)}</span>
            <span className="text-ink-3">{it.reason}</span>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(text(it.row)).then(() => toast('已复制', { tone: 'success' }))}>
              复制
            </Button>
            <IconButton label="丢弃" size="sm" onClick={() => void rawDb.rescued.delete(it.id)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
