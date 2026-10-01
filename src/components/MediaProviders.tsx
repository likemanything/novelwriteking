/**
 * 图像 / 视频 / 配音模型：每个用途下可以接入多个服务，选一个启用。
 * 服务用一份 JSON「适配声明」描述怎么调用，所以任何厂商都能接入——选预设或空白模板，按官方文档改，再「试一条」。
 */
import { Check, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { mediaUrl, providerApi, refreshProviders, useProviders } from '@/cloud/providers';
import { cx } from '@/lib/util';
import { KIND_LABEL, PRESETS, type MediaKind, type ProviderInfo, type ProviderSpec } from '@/shared/media';
import { toast, toastError } from '@/store/ui';
import { Badge, Button, ConfirmDialog, Field, IconButton, Input, Modal, Textarea } from './ui';

const KINDS: MediaKind[] = ['image', 'video', 'tts'];

function Result({ r }: { r: { kind: MediaKind; id: string; ms: number } | { error: string } }) {
  if ('error' in r) return <p className="mt-2 rounded-lg bg-seal/[.07] px-3 py-2 text-fs-xs break-words text-seal" role="alert">{r.error}</p>;
  const src = mediaUrl(r.id);
  return (
    <div className="mt-2 rounded-lg bg-jade/10 p-2">
      <div className="mb-1.5 flex items-center gap-1 text-fs-xs text-jade"><Check className="size-3.5" />成功，用时 {(r.ms / 1000).toFixed(1)} 秒</div>
      {r.kind === 'image' && <img src={src} alt="测试结果" className="max-h-56 rounded-lg" />}
      {r.kind === 'video' && <video src={src} controls className="max-h-56 rounded-lg" />}
      {r.kind === 'tts' && <audio src={src} controls className="w-full" />}
    </div>
  );
}

function Editor({ open, onClose, editing, kind }: { open: boolean; onClose: () => void; editing: ProviderInfo | null; kind: MediaKind }) {
  const presets = PRESETS.filter((p) => p.spec.kind === kind);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const initial = editing?.spec ?? presets[0]?.spec;
  const [name, setName] = useState(editing?.name ?? presets[0]?.name ?? '');
  const [spec, setSpec] = useState(JSON.stringify(initial, null, 2));
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo<{ ok: true; spec: ProviderSpec } | { ok: false; error: string }>(() => {
    try {
      return { ok: true, spec: JSON.parse(spec) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '不是有效的 JSON' };
    }
  }, [spec]);
  const needSecret = parsed.ok && (parsed.spec.auth?.type === 'jwt-hs256' || parsed.spec.auth?.type === 'basic');

  const pick = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setName(p.name);
    setSpec(JSON.stringify(p.spec, null, 2));
  };

  const save = async () => {
    if (!parsed.ok) return;
    setBusy(true);
    try {
      if (editing) {
        await providerApi.update(editing.id, { name, spec: parsed.spec, ...(apiKey ? { apiKey } : {}), ...(secret ? { secretKey: secret } : {}) });
      } else {
        await providerApi.create({ name, spec: parsed.spec, apiKey, secretKey: secret });
      }
      await refreshProviders();
      toast(editing ? '已保存' : `已接入「${name}」`, { tone: 'success', detail: '建议点「试一条」确认能调通。' });
      onClose();
    } catch (e) {
      toastError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={720} title={`${editing ? '编辑' : '接入'}${KIND_LABEL[kind].label}模型`} footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="seal" loading={busy} disabled={!parsed.ok || !name.trim()} onClick={save}>保存</Button></>}>
      <div className="grid gap-4">
        {!editing && presets.length > 0 && (
          <Field label="从预设开始" hint={presets.find((p) => p.id === presetId)?.hint}>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button key={p.id} type="button" onClick={() => pick(p.id)} className={cx('rounded-full border px-3 py-1 text-fs-xs transition', presetId === p.id ? 'border-seal/50 bg-seal/[.07] text-seal' : 'border-line text-ink-2 hover:border-line-2')}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名称"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
          <Field label="API Key" hint={editing ? `已加密保存${editing.keyHint ? `（${editing.keyHint}）` : ''}；留空表示不修改` : undefined}>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} autoComplete="off" placeholder="sk-…" className="font-mono text-fs-xs" />
          </Field>
        </div>
        {needSecret && (
          <Field label="签名密钥 / Secret Key" hint={editing?.hasSecret ? '已保存；留空表示不修改' : 'JWT 或 Basic 认证需要'}>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())} autoComplete="off" className="font-mono text-fs-xs" />
          </Field>
        )}
        <Field label="适配声明（JSON）" hint="描述怎么调用这家服务：认证、提交、轮询、结果在响应的哪里。变量见下方说明。">
          <Textarea value={spec} onChange={(e) => setSpec(e.target.value)} minRows={14} className="font-mono text-fs-xs leading-relaxed" spellCheck={false} />
          {!parsed.ok && <p className="mt-1 text-fs-xs text-seal">JSON 有误：{parsed.error}</p>}
        </Field>
        <p className="rounded-lg bg-ink/[.04] px-3 py-2 text-fs-xs leading-relaxed text-ink-3">
          请求模板可用变量：<code>{'{{prompt}} {{negative}} {{model}} {{ratio}} {{size}} {{duration}} {{seed}} {{first_frame}} {{last_frame}} {{text}} {{voice}} {{emotion}} {{task_id}}'}</code>。整串恰好是一个变量时保持原类型，缺失的字段会被省略；响应取值用路径，如 <code>data[0].url</code>。认证支持 bearer / header / query / basic / jwt-hs256。
        </p>
      </div>
    </Modal>
  );
}

function KindSection({ kind, canEdit }: { kind: MediaKind; canEdit: boolean }) {
  const all = useProviders((s) => s.providers);
  const providers = useMemo(() => all.filter((p) => p.kind === kind), [all, kind]);
  const assigned = useProviders((s) => s.assigned[kind]);
  const [editing, setEditing] = useState<ProviderInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProviderInfo | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Parameters<typeof Result>[0]['r']>>({});

  const test = async (p: ProviderInfo) => {
    setTesting(p.id);
    const t0 = Date.now();
    try {
      const { asset } = await providerApi.test(p.id);
      setResults((r) => ({ ...r, [p.id]: { kind: p.kind, id: asset.id, ms: Date.now() - t0 } }));
    } catch (e) {
      setResults((r) => ({ ...r, [p.id]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="surface rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-fs-lg font-semibold">{KIND_LABEL[kind].label}模型</h3>
          <p className="text-fs-xs text-ink-3">{KIND_LABEL[kind].hint}</p>
        </div>
        {canEdit && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>接入</Button>}
      </div>
      {providers.length === 0 ? (
        <p className="mt-4 text-fs-xs text-ink-3">还没有接入。{canEdit ? '点「接入」选预设或空白模板。' : '请联系管理员接入。'}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {providers.map((p) => (
            <li key={p.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => providerApi.assign(kind, assigned === p.id ? null : p.id).then(refreshProviders).catch((e) => toastError(e))}
                  className={cx('flex size-5 shrink-0 items-center justify-center rounded-full border transition', assigned === p.id ? 'border-seal bg-seal text-white' : 'border-line-2 text-transparent hover:border-seal')}
                  aria-label={assigned === p.id ? '正在使用' : '设为使用'}
                  title={assigned === p.id ? '正在使用' : '设为使用'}
                >
                  <Check className="size-3" strokeWidth={3} />
                </button>
                <span className="font-medium">{p.name}</span>
                {assigned === p.id && <Badge tone="seal">使用中</Badge>}
                <span className="min-w-0 flex-1 truncate font-mono text-fs-xs text-ink-3" title={p.spec.baseUrl}>{p.spec.baseUrl}{p.keyHint ? ` · Key ${p.keyHint}` : ''}</span>
                {canEdit && (
                  <>
                    <Button size="xs" variant="outline" icon={<Play className="size-3" />} loading={testing === p.id} onClick={() => test(p)}>试一条</Button>
                    <IconButton label="编辑" size="sm" onClick={() => setEditing(p)}><Pencil className="size-4" /></IconButton>
                    <IconButton label="删除" size="sm" onClick={() => setRemoving(p)}><Trash2 className="size-4" /></IconButton>
                  </>
                )}
              </div>
              {testing === p.id && <p className="mt-2 text-fs-xs text-ink-3">正在真实调用一次，视频可能需要几分钟……</p>}
              {results[p.id] && testing !== p.id && <Result r={results[p.id]} />}
            </li>
          ))}
        </ul>
      )}
      {(adding || editing) && <Editor key={editing?.id ?? 'new'} open editing={editing} kind={kind} onClose={() => (setAdding(false), setEditing(null))} />}
      <ConfirmDialog
        open={!!removing}
        title={`移除「${removing?.name ?? ''}」？`}
        body="已经生成的文件不会被删除。使用它的用途会变成未启用。"
        confirmLabel="移除"
        danger
        onResolve={async (ok) => {
          const p = removing;
          setRemoving(null);
          if (!ok || !p) return;
          try {
            await providerApi.remove(p.id);
            await refreshProviders();
          } catch (e) {
            toastError(e, '移除失败');
          }
        }}
      />
    </div>
  );
}

export function MediaProviders({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="grid gap-4">
      {KINDS.map((k) => (
        <KindSection key={k} kind={k} canEdit={canEdit} />
      ))}
      <p className="text-fs-xs text-ink-3">生成的图片、视频和音频保存在服务器本地磁盘，只有团队成员能访问。</p>
    </div>
  );
}
