/**
 * 墨织 UI 基元。风格关键词：宣纸、细线、朱砂点睛、丝滑的缓动。
 */
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/lib/util';

export const SILK_EASE = [0.22, 1, 0.36, 1] as const;

// ─────────────────────────── Button ───────────────────────────

type Variant = 'ink' | 'seal' | 'ghost' | 'outline' | 'soft' | 'danger';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // 主行动：朱砂渐变 + 顶部高光 + 外发光；悬停时更亮、略微上浮
  seal: 'bg-[image:var(--grad-seal)] text-[#fff6f0] shadow-[inset_0_1px_0_rgb(255_255_255/.28),0_1px_2px_rgb(0_0_0/.2),0_10px_24px_-10px_var(--seal)] hover:brightness-110 hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgb(255_255_255/.32),0_1px_2px_rgb(0_0_0/.2),0_14px_30px_-10px_var(--seal)]',
  // 次要强调：墨色实心，带细高光
  ink: 'bg-ink text-paper shadow-[inset_0_1px_0_rgb(255_255_255/.14),0_8px_20px_-10px_rgb(var(--shadow)/.55)] hover:bg-ink/90 hover:-translate-y-px',
  ghost: 'text-ink-2 hover:text-ink hover:bg-ink/[.06]',
  outline: 'border border-line-2 bg-[color:var(--surface-1)]/50 text-ink backdrop-blur-sm hover:border-ink/35 hover:bg-[color:var(--surface-1)] hover:-translate-y-px hover:shadow-[var(--elev-1)]',
  soft: 'bg-ink/[.06] text-ink hover:bg-ink/[.1]',
  danger: 'text-seal hover:bg-seal/10',
};

const SIZES: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-fs-xs gap-1 rounded-lg',
  sm: 'h-8 px-3 text-fs-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-fs-base gap-2 rounded-xl',
  lg: 'h-12 px-6 text-fs-md gap-2.5 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-all duration-[var(--dur-2)] ease-[var(--ease-silk)] active:translate-y-0 active:scale-[.97] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <InkSpinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md'; active?: boolean }>(
  function IconButton({ label, size = 'md', active, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cx(
          'inline-flex shrink-0 items-center justify-center rounded-lg transition-all duration-200 active:scale-90 disabled:opacity-40',
          size === 'sm' ? 'size-7' : 'size-9',
          active ? 'bg-ink/[.08] text-ink' : 'text-ink-2 hover:bg-ink/[.06] hover:text-ink',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

// ─────────────────────────── Loader ───────────────────────────

/** 墨滴旋转：三滴墨依次晕开。 */
export function InkSpinner({ className }: { className?: string }) {
  return (
    <span className={cx('relative inline-block', className)} role="status" aria-label="加载中">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute inset-0 m-auto size-[34%] rounded-full bg-current"
          style={{ transform: `rotate(${i * 120}deg) translateY(-70%)`, animation: `breathe 1.1s ${i * 0.18}s ease-in-out infinite` }}
        />
      ))}
    </span>
  );
}

// ─────────────────────────── Inputs ───────────────────────────

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('field h-10', className)} {...rest} />;
});

/** 自动增高的多行输入。 */
export function Textarea({ className, value, minRows = 2, bare, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; bare?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={minRows} value={value} className={cx(bare ? 'field-bare px-2 py-1' : 'field', 'resize-none', className)} {...rest} />;
}

/**
 * 表单字段。单个输入控件用 <label> 包裹；按钮组、标签组、列表等复合内容请传 group，
 * 改用 role="group"——否则浏览器会把整段标签文字算作组内第一个按钮的名称。
 */
export function Field({ label, hint, children, className, group }: { label: string; hint?: string; children: ReactNode; className?: string; group?: boolean }) {
  const id = useId();
  const head = (
    <span className="mb-1.5 flex items-baseline justify-between gap-2">
      <span id={id} className="text-xs font-medium tracking-wide text-ink-2">
        {label}
      </span>
      {hint && <span className="text-fs-2xs text-ink-3">{hint}</span>}
    </span>
  );
  if (group) {
    return (
      <div role="group" aria-labelledby={id} className={cx('block', className)}>
        {head}
        {children}
      </div>
    );
  }
  return (
    <label className={cx('block', className)}>
      {head}
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors duration-300', checked ? 'bg-seal' : 'bg-ink/15')}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        className={cx('absolute top-1 size-4 rounded-full bg-paper-2 shadow', checked ? 'right-1' : 'left-1')}
      />
    </button>
  );
}

/** 分段选择器：滑块在选项之间流动。 */
export function Segmented<T extends string | number>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  const id = useId();
  return (
    <div className={cx('inline-flex rounded-xl border border-line bg-ink/[.04] p-1 shadow-[inset_0_1px_2px_rgb(var(--shadow)/.06)]', size === 'sm' && 'rounded-lg p-0.5')} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx('relative rounded-lg px-3 font-medium transition-colors', size === 'sm' ? 'h-7 text-xs' : 'h-8 text-fs-sm', o.value === value ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
        >
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg border border-line bg-[color:var(--surface-2)] shadow-[var(--elev-1)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 下划线标签页。 */
export function Tabs<T extends string>({ value, tabs, onChange, className }: { value: T; tabs: { value: T; label: ReactNode; badge?: number }[]; onChange: (v: T) => void; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex gap-1 border-b border-line', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx('relative flex h-10 items-center gap-1.5 px-3 text-fs-sm font-medium transition-colors', t.value === value ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
        >
          {t.label}
          {!!t.badge && <span className="rounded-full bg-seal px-1.5 text-fs-2xs leading-4 text-white">{t.badge}</span>}
          {t.value === value && <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-seal shadow-[0_0_10px_var(--seal)]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, color, children, onClick, className }: { active?: boolean; color?: string; children: ReactNode; onClick?: () => void; className?: string }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-all duration-200',
        active ? 'border-transparent bg-ink text-paper' : 'border-line-2 text-ink-2 hover:border-ink/30 hover:text-ink',
        onClick && 'active:scale-95',
        className,
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </Tag>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'seal' | 'jade' | 'gold' | 'indigo'; className?: string }) {
  const tones = {
    neutral: 'bg-ink/[.06] text-ink-2 ring-1 ring-inset ring-line',
    seal: 'bg-seal/10 text-seal ring-1 ring-inset ring-seal/25',
    jade: 'bg-jade/10 text-jade ring-1 ring-inset ring-jade/25',
    gold: 'bg-gold/12 text-gold ring-1 ring-inset ring-gold/30',
    indigo: 'bg-indigo/10 text-indigo ring-1 ring-inset ring-indigo/25',
  };
  return <span className={cx('inline-flex h-5 items-center gap-1 rounded-full px-2 text-fs-2xs font-medium', tones[tone], className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-2 bg-[color:var(--surface-2)] px-1 font-mono text-fs-2xs text-ink-2 shadow-[0_1px_0_var(--line-2)]">{children}</kbd>;
}

export function SectionTitle({ eyebrow, title, children, className }: { eyebrow?: string; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <div className="mb-1.5 text-fs-2xs font-medium tracking-[.28em] text-seal">{eyebrow}</div>}
        <h1 className="font-serif text-fs-2xl leading-tight font-semibold tracking-wide text-ink">{title}</h1>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-dashed border-line-2 bg-[color:var(--surface-1)]/60 text-ink-3 shadow-[var(--elev-1)]">{icon}</div>}
      <div className="font-serif text-lg text-ink">{title}</div>
      {children && <div className="mt-2 max-w-sm text-sm leading-relaxed text-ink-3">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

// ─────────────────────────── Overlays ───────────────────────────

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, width = 560, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pt-[10vh] pb-10">
          <motion.div className="fixed inset-0 bg-[color:var(--scrim)] backdrop-blur-[6px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="surface gborder relative w-full overflow-hidden rounded-3xl shadow-[var(--elev-3)] after:opacity-100"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.35, ease: SILK_EASE }}
          >
            {title && (
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <div className="font-serif text-fs-lg font-semibold">{title}</div>
                <IconButton label="关闭" size="sm" onClick={onClose}>
                  <X className="size-4" />
                </IconButton>
              </div>
            )}
            <div className="px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-ink/[.02] px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Sheet({ open, onClose, title, children, width = 520, subtitle }: { open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number }) {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-[color:var(--scrim)] backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className="glass absolute inset-y-2 right-2 flex flex-col overflow-hidden rounded-3xl shadow-[var(--elev-3)]"
            style={{ width: `min(${width}px, calc(100vw - 16px))` }}
            initial={{ x: '105%' }}
            animate={{ x: 0 }}
            exit={{ x: '105%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
              <div className="min-w-0">
                {title && <div className="font-serif text-xl font-semibold">{title}</div>}
                {subtitle && <div className="mt-0.5 text-xs text-ink-3">{subtitle}</div>}
              </div>
              <IconButton label="关闭" size="sm" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** 轻量确认框，返回 Promise<boolean>。 */
export function ConfirmDialog({ open, title, body, confirmLabel = '确认', danger, onResolve }: { open: boolean; title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; onResolve: (ok: boolean) => void }) {
  return (
    <Modal
      open={open}
      onClose={() => onResolve(false)}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onResolve(false)}>
            取消
          </Button>
          <Button variant={danger ? 'seal' : 'ink'} size="sm" onClick={() => onResolve(true)} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-2">{body}</div>
    </Modal>
  );
}

// ─────────────────────────── Progress ───────────────────────────

export function ProgressRing({ value, size = 36, stroke = 3, color = 'var(--seal)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.9, ease: SILK_EASE }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

/** 数字滚动。 */
export function Counter({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  // 文本完全由副作用驱动（不交给 React 渲染），避免与逐帧更新冲突
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (from === value) {
      el.textContent = value.toLocaleString('zh-CN');
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (value - from) * e).toLocaleString('zh-CN');
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span ref={ref} className={cx('tabular-nums', className)} />;
}

// ─────────────────────────── Menu ───────────────────────────

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
}

/** 轻量下拉菜单：点击外部或 Esc 关闭。 */
export function Menu({ trigger, items, align = 'right', className }: { trigger: (p: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  return (
    <div ref={ref} className={cx('relative', className)}>
      {trigger({ onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className={cx('surface absolute top-full z-40 mt-1 min-w-44 origin-top rounded-xl p-1 shadow-[var(--shadow-float)]', align === 'right' ? 'right-0' : 'left-0')}
          >
            {items.map((it, i) => (
              <div key={i}>
                {it.divider && <div className="my-1 h-px bg-line" />}
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                  className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-fs-sm transition-colors [&>svg]:size-4', it.danger ? 'text-seal hover:bg-seal/10' : 'text-ink-2 hover:bg-ink/[.05] hover:text-ink')}
                >
                  {it.icon}
                  {it.label}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
