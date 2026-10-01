import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSettings } from '@/store/settings';
import { cx } from '@/lib/util';

export function useIsDark() {
  const theme = useSettings((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => setSystemDark(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return theme === 'night' || (theme === 'system' && systemDark);
}

/** 把主题同步到 <html class="dark"> 与浏览器地址栏颜色。 */
export function useThemeEffect() {
  const dark = useIsDark();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101216' : '#f3eee3');
  }, [dark]);
}

export function ThemeToggle({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const dark = useIsDark();
  const setTheme = useSettings((s) => s.setTheme);
  return (
    <button
      onClick={() => setTheme(dark ? 'paper' : 'night')}
      aria-label={dark ? '切换到日间主题' : '切换到夜间主题'}
      title={dark ? '日间' : '夜间'}
      className={cx('flex h-9 items-center gap-2 rounded-lg px-2 text-ink-2 transition hover:bg-ink/[.06] hover:text-ink', className)}
    >
      <span className="relative size-5 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={dark ? 'moon' : 'sun'}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ y: 18, rotate: -60, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            exit={{ y: -18, rotate: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          >
            {dark ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
          </motion.span>
        </AnimatePresence>
      </span>
      {withLabel && <span className="text-[13px]">{dark ? '夜间' : '日间'}</span>}
    </button>
  );
}
