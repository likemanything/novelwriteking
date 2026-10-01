import { Command } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '@/lib/util';
import { useStageProfile } from '@/cloud/models';
import { useUI } from '@/store/ui';
import { AccountMenu } from './AccountMenu';
import { Seal } from './Seal';
import { ThemeToggle } from './ThemeToggle';
import { Kbd } from './ui';

export function BrandMark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx('group flex items-center gap-2.5', className)} aria-label="墨织 · 回到书架">
      <span className="transition-transform duration-500 ease-[var(--ease-silk)] group-hover:-rotate-6">
        <Seal size={30} />
      </span>
      <span className="leading-none">
        <span className="block font-serif text-[17px] font-semibold tracking-[.2em]">墨织</span>
        <span className="mt-0.5 block text-[9px] tracking-[.32em] text-ink-3 uppercase">Inkloom</span>
      </span>
    </Link>
  );
}

/** 当前执笔模型的状态：演示引擎时引导去接入真实模型。 */
export function ModelStatus({ className }: { className?: string }) {
  const p = useStageProfile('write');
  const demo = p.provider === 'demo';
  return (
    <Link
      to="/settings"
      className={cx('flex h-8 items-center gap-2 rounded-full border border-line px-3 text-xs text-ink-2 transition hover:border-line-2 hover:text-ink', className)}
      title={demo ? '当前使用离线演示引擎，点击接入真实模型' : `写作模型：${p.name}`}
    >
      <span className={cx('size-1.5 rounded-full', demo ? 'bg-gold animate-[var(--animate-breathe)]' : 'bg-jade')} />
      {demo ? '演示引擎 · 接入模型' : p.name}
    </Link>
  );
}

export function TopBar({ children, className }: { children?: ReactNode; className?: string }) {
  const setPalette = useUI((s) => s.setPalette);
  return (
    <header className={cx('relative z-30 flex h-16 items-center gap-4 px-6', className)}>
      <BrandMark />
      <div className="flex-1">{children}</div>
      <ModelStatus className="hidden sm:flex" />
      <button onClick={() => setPalette(true)} className="hidden h-8 items-center gap-1.5 rounded-lg px-2 text-ink-3 transition hover:bg-ink/[.05] hover:text-ink md:flex" aria-label="打开命令面板">
        <Command className="size-4" />
        <Kbd>⌘K</Kbd>
      </button>
      <ThemeToggle />
      <AccountMenu />
    </header>
  );
}
