/**
 * 接入模型：两张卡片。
 * - DeepSeek：只要一把 Key；
 * - 通用接入：填地址与 Key，墨织自动识别协议、读取模型列表、试写一句。
 *
 * 识别过程用一根丝线串起四个结点，逐个点亮；成功时盖一枚「通」字印。
 */
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, Check, ExternalLink, Eye, EyeOff, Radar, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DETECT_STEPS, DetectError, type DetectStep, type StepState } from '@/ai/detect';
import { apiFetch, readNdjson } from '@/cloud/api';
import { refreshModels, useModels } from '@/cloud/models';
import type { CredentialInfo, DetectEvent } from '@/shared/api';
import { cx, isAbort } from '@/lib/util';
import { DEEPSEEK_URL, URL_EXAMPLES } from '@/store/settings';
import { toast } from '@/store/ui';
import { Seal } from './Seal';
import { Badge, Button, Input } from './ui';

type Steps = Record<DetectStep, { state: StepState; info?: string }>;
const INITIAL: Steps = { normalize: { state: 'idle' }, protocol: { state: 'idle' }, models: { state: 'idle' }, reply: { state: 'idle' } };

export interface Connected {
  credential: CredentialInfo;
  reply?: string;
  warning?: string;
}

export interface ConnectInput {
  url?: string;
  key?: string;
  model?: string;
  name?: string;
  /** 重新识别已有的模型（沿用已保存的地址与密钥） */
  credentialId?: string;
}

/** 识别并保存由服务端完成：地址探测、协议识别、密钥加密保存都不经过浏览器。 */
export function useConnector() {
  const [steps, setSteps] = useState<Steps>(INITIAL);
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [error, setError] = useState<DetectError | Error | null>(null);
  const [result, setResult] = useState<Connected | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (input: ConnectInput): Promise<Connected | null> => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setSteps(INITIAL);
    setPhase('running');
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch('POST', '/api/ai/credentials/detect', input, { signal: c.signal });
      let done: Connected | null = null;
      let failure: DetectError | null = null;
      await readNdjson<DetectEvent>(res, (ev) => {
        if (ev.t === 'step') setSteps((prev) => ({ ...prev, [ev.step]: { state: ev.state, info: ev.info ?? prev[ev.step].info } }));
        else if (ev.t === 'result') done = { credential: ev.credential, reply: ev.reply, warning: ev.warning };
        else if (ev.t === 'error') failure = new DetectError(ev.message, ev.step, ev.code as DetectError['code']);
      });
      if (c.signal.aborted) return null;
      if (failure) throw failure;
      if (!done) throw new Error('与服务器的连接中断了，请重试');
      setResult(done);
      setPhase('success');
      void refreshModels();
      return done;
    } catch (e) {
      if (isAbort(e) || c.signal.aborted) {
        setPhase('idle');
        setSteps(INITIAL);
        return null;
      }
      const err = e instanceof Error ? e : new Error(String(e));
      const at: DetectStep = e instanceof DetectError ? e.step : 'protocol';
      setSteps((prev) => ({ ...prev, [at]: { state: 'error', info: prev[at].info } }));
      setError(err);
      setPhase('error');
      return null;
    }
  };

  const cancel = () => ctrl.current?.abort();
  const reset = () => {
    cancel();
    setSteps(INITIAL);
    setPhase('idle');
    setError(null);
    setResult(null);
  };
  return { steps, phase, error, result, run, cancel, reset };
}

/** 四个结点 + 一根丝线的进度。 */
export function DetectTrack({ steps }: { steps: Steps }) {
  const doneCount = DETECT_STEPS.filter((s) => steps[s.id].state === 'done' || steps[s.id].state === 'warn').length;
  return (
    <div className="relative" aria-live="polite">
      <div className="absolute top-[11px] right-[11%] left-[11%] h-[2px] rounded-full bg-line-2" />
      <motion.div className="absolute top-[11px] left-[11%] h-[2px] rounded-full bg-seal" initial={false} animate={{ width: `${(Math.max(0, doneCount - 1) / (DETECT_STEPS.length - 1)) * 78}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
      <ol className="relative grid grid-cols-4">
        {DETECT_STEPS.map((s) => {
          const st = steps[s.id];
          return (
            <li key={s.id} className="flex min-w-0 flex-col items-center gap-1.5 px-1 text-center">
              <span
                className={cx(
                  'relative flex size-6 items-center justify-center rounded-full border-2 bg-paper-2 transition-colors duration-300',
                  st.state === 'done' && 'border-seal bg-seal text-white',
                  st.state === 'warn' && 'border-gold bg-gold text-white',
                  st.state === 'error' && 'border-seal text-seal',
                  st.state === 'active' && 'border-seal',
                  st.state === 'idle' && 'border-line-2',
                )}
              >
                {st.state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
                {st.state === 'warn' && <AlertTriangle className="size-3" strokeWidth={2.5} />}
                {st.state === 'error' && <X className="size-3.5" strokeWidth={3} />}
                {st.state === 'active' && (
                  <>
                    <span className="size-2 animate-[breathe_1s_ease-in-out_infinite] rounded-full bg-seal" />
                    <span className="absolute inset-[-5px] animate-[breathe_1.6s_ease-in-out_infinite] rounded-full border border-seal/30" />
                  </>
                )}
              </span>
              <span className={cx('text-fs-xs font-medium', st.state === 'idle' ? 'text-ink-3' : 'text-ink')}>{s.label}</span>
              <AnimatePresence mode="wait">
                {st.info && (
                  <motion.span key={st.info} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="line-clamp-2 w-full font-mono text-fs-2xs leading-snug break-all text-ink-3" title={st.info}>
                    {st.info}
                  </motion.span>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function KeyInput({ value, onChange, placeholder, invalid, id }: { value: string; onChange: (v: string) => void; placeholder: string; invalid?: boolean; id: string }) {
  const [show, setShow] = useState(false);
  return (
    <motion.div className="relative" animate={invalid ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: 0.4 }}>
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder} className={cx('pr-10 font-mono text-fs-xs', invalid && 'border-seal/60')} autoComplete="off" spellCheck={false} aria-invalid={invalid || undefined} />
      <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-ink-3 hover:text-ink" aria-label={show ? '隐藏密钥' : '显示密钥'}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </motion.div>
  );
}

function Outcome({ c, onSaved, onRetryWithModel }: { c: ReturnType<typeof useConnector>; onSaved?: () => void; onRetryWithModel: (model: string) => void }) {
  const [model, setModel] = useState('');
  if (c.phase === 'success' && c.result) {
    const r = c.result;
    const cred = r.credential;
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative mt-4 rounded-xl border border-jade/30 bg-jade/[.06] px-4 py-3">
        <motion.span className="absolute -top-3 right-3" initial={{ scale: 2.4, rotate: -25, opacity: 0 }} animate={{ scale: 1, rotate: -10, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 16 }}>
          <Seal chars="通" size={44} fine seed={7} />
        </motion.span>
        <div className="flex flex-wrap items-center gap-2 pr-12 text-fs-sm">
          <span className="font-medium text-ink">已连接 {cred.name}</span>
          <Badge tone="jade">{cred.protocolLabel}</Badge>
          <span className="font-mono text-fs-xs text-ink-3">{cred.model}</span>
        </div>
        {r.reply && <div className="mt-1 text-fs-xs text-ink-2">模型回复：「{r.reply}」</div>}
        {r.warning && <div className="mt-1 text-fs-xs text-gold">{r.warning}</div>}
        {onSaved && (
          <button onClick={onSaved} className="mt-2 text-fs-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            接入另一个
          </button>
        )}
      </motion.div>
    );
  }
  if (c.phase === 'error' && c.error) {
    const needModel = c.error instanceof DetectError && (c.error.code === 'need-model' || c.error.code === 'no-protocol');
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-xl border border-seal/25 bg-seal/[.05] px-4 py-3" role="alert">
        <div className="flex items-start gap-2 text-fs-xs leading-relaxed text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-seal" />
          <span className="break-words">{c.error.message}</span>
        </div>
        {needModel && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (model.trim()) onRetryWithModel(model.trim());
            }}
          >
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名，例如 gpt-4o 或 claude-sonnet-4-5" className="h-9 font-mono text-fs-xs" aria-label="模型名" />
            <Button type="submit" size="sm" variant="ink" disabled={!model.trim()}>
              用它试连
            </Button>
          </form>
        )}
      </motion.div>
    );
  }
  return null;
}

function CardShell({ icon, title, desc, children, accent }: { icon: ReactNode; title: string; desc: ReactNode; children: ReactNode; accent: string }) {
  return (
    <motion.div layout className="surface relative flex flex-col overflow-hidden rounded-3xl p-6">
      <span className="pointer-events-none absolute -top-16 -right-16 size-44 rounded-full opacity-[.12] blur-2xl" style={{ background: accent }} />
      <div className="relative flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-[inset_0_-2px_6px_rgba(0,0,0,.2)]" style={{ background: accent }}>
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="font-serif text-fs-xl font-semibold">{title}</h3>
          <p className="mt-0.5 text-fs-xs leading-relaxed text-ink-3">{desc}</p>
        </div>
      </div>
      <div className="relative mt-5 flex flex-1 flex-col">{children}</div>
    </motion.div>
  );
}

const DeepSeekMark = () => (
  <svg viewBox="0 0 32 32" className="size-6" aria-hidden="true">
    <path d="M27.5 9.2c-.3-.1-.5.1-.7.3l-.3.3c-.9 1-2 1.6-3.4 1.5-2.1-.1-3.8.6-5.4 2.2-.3-2-1.5-3.2-3.1-3.9-.9-.4-1.7-.9-2.3-1.7-.4-.6-.5-1.2-.7-1.8-.1-.4-.3-.8-.7-.8-.5-.1-.7.3-.8.6-.7 1.3-1 2.7-.9 4.2.1 3.3 1.5 5.9 4.2 7.7.3.2.4.4.3.8l-.6 1.7c-.1.4-.3.4-.7.3-1.5-.6-2.8-1.6-4-2.7-1.4-1.3-2.6-2.8-4.1-4-.4-.3-.7-.5-1.1-.7-1.6-.8-.9.1-.9.1-.2 1.4.4 2.6 1.2 3.7 2.3 3.2 5.2 5.5 8.7 7 3.6 1.5 7.4 1.6 10.4-1.3.5-.5.8-1 1.3-1.5.3-.4 1.5-2.1 2.4-4.3.8-2 1.3-4.2 1.3-6.2 0-.6-.3-.8-.8-.9z" fill="currentColor" />
  </svg>
);

export function ConnectModel() {
  // DeepSeek
  const [dsKey, setDsKey] = useState('');
  const ds = useConnector();
  // 通用
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const gen = useConnector();

  const connect = async (c: ReturnType<typeof useConnector>, input: ConnectInput) => {
    const r = await c.run(input);
    if (!r) return;
    const first = Object.values(useModels.getState().stages).every((id) => id === r.credential.id);
    toast(`已接入 ${r.credential.name}`, { tone: 'seal', detail: first ? '它会负责构思、写作、审稿、改写全部环节，可以在下方的「环节分工」里调整。' : '在下方「环节分工」里指定它负责哪些环节。' });
  };

  const submitDs = (e: FormEvent) => {
    e.preventDefault();
    if (dsKey) connect(ds, { url: DEEPSEEK_URL, key: dsKey, name: 'DeepSeek' });
  };
  const submitGen = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) connect(gen, { url, key });
  };
  const authBad = (c: ReturnType<typeof useConnector>) => c.error instanceof DetectError && c.error.code === 'auth';
  const urlBad = gen.error instanceof DetectError && (gen.error.code === 'invalid-url' || gen.error.code === 'unreachable');

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.25fr]">
      <CardShell accent="#4d6bfe" icon={<DeepSeekMark />} title="DeepSeek" desc="中文长篇写作的高性价比之选。粘贴 API Key 即可，模型列表自动读取。">
        <form onSubmit={submitDs} className="flex flex-1 flex-col gap-3">
          <label htmlFor="ds-key" className="text-xs font-medium tracking-wide text-ink-2">
            API Key
          </label>
          <KeyInput id="ds-key" value={dsKey} onChange={setDsKey} placeholder="sk-…" invalid={authBad(ds)} />
          {ds.phase === 'idle' && (
            <ul className="mt-2 space-y-2 text-fs-xs leading-relaxed text-ink-2">
              {['地址与协议已预设，不用再填', '自动读取你的账户可用的全部模型，可随时切换', '深度思考模型的思考过程不会混进正文'].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="mt-1 size-3.5 shrink-0 text-[#4d6bfe]" strokeWidth={2.5} />
                  {t}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto flex items-center justify-between gap-3 pt-4">
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-fs-xs text-ink-3 transition hover:text-ink">
              获取 Key <ExternalLink className="size-3" />
            </a>
            {ds.phase === 'running' ? (
              <Button type="button" variant="outline" size="sm" onClick={ds.cancel}>
                取消
              </Button>
            ) : (
              <Button type="submit" variant="ink" size="sm" disabled={!dsKey} icon={<ArrowRight className="size-4" />}>
                连接
              </Button>
            )}
          </div>
        </form>
        {ds.phase !== 'idle' && (
          <div className="mt-5 border-t border-line pt-5">
            <DetectTrack steps={ds.steps} />
            <Outcome c={ds} onSaved={() => (ds.reset(), setDsKey(''))} onRetryWithModel={(m) => connect(ds, { url: DEEPSEEK_URL, key: dsKey, model: m, name: 'DeepSeek' })} />
          </div>
        )}
      </CardShell>

      <CardShell accent="var(--seal)" icon={<Radar className="size-5" />} title="通用接入" desc="OpenAI 兼容、Claude、Gemini、Ollama 本地……填地址和 Key，墨织自动识别协议并连上。">
        <form onSubmit={submitGen} className="flex flex-1 flex-col gap-3">
          <label htmlFor="gen-url" className="text-xs font-medium tracking-wide text-ink-2">
            接口地址
          </label>
          <motion.div animate={urlBad ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: 0.4 }}>
            <Input id="gen-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/v1" className={cx('font-mono text-fs-xs', urlBad && 'border-seal/60')} spellCheck={false} aria-invalid={urlBad || undefined} />
          </motion.div>
          <div className="flex flex-wrap gap-1.5" aria-label="常见地址">
            {URL_EXAMPLES.map((x) => (
              <button key={x.label} type="button" onClick={() => setUrl(x.url)} className={cx('rounded-full border px-2.5 py-0.5 text-fs-xs transition', url === x.url ? 'border-seal/50 bg-seal/[.06] text-seal' : 'border-line text-ink-3 hover:border-line-2 hover:text-ink-2')}>
                {x.label}
              </button>
            ))}
          </div>
          <label htmlFor="gen-key" className="mt-1 text-xs font-medium tracking-wide text-ink-2">
            API Key <span className="font-normal text-ink-3">（本地模型可留空）</span>
          </label>
          <KeyInput id="gen-key" value={key} onChange={setKey} placeholder="sk-… / sk-ant-… / AIza…" invalid={authBad(gen)} />
          <div className="mt-auto flex items-center justify-end gap-3 pt-2">
            {gen.phase === 'running' ? (
              <Button type="button" variant="outline" size="sm" onClick={gen.cancel}>
                取消
              </Button>
            ) : (
              <Button type="submit" variant="seal" size="sm" disabled={!url.trim()} icon={<Radar className="size-4" />}>
                识别并连接
              </Button>
            )}
          </div>
        </form>
        {gen.phase !== 'idle' && (
          <div className="mt-5 border-t border-line pt-5">
            <DetectTrack steps={gen.steps} />
            <Outcome c={gen} onSaved={() => (gen.reset(), setUrl(''), setKey(''))} onRetryWithModel={(m) => connect(gen, { url, key, model: m })} />
          </div>
        )}
      </CardShell>
    </div>
  );
}
