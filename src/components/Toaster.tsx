import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, Info, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { dismissToast, useUI, type ToastTone } from '@/store/ui';
import { Seal } from './Seal';

const ICON: Record<ToastTone, ReactNode> = {
  info: <Info className="size-4 text-indigo" />,
  success: <Check className="size-4 text-jade" />,
  error: <AlertCircle className="size-4 text-seal" />,
  seal: <Seal chars="墨织" size={20} />,
};

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.94, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 10, scale: 0.96, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="pointer-events-auto flex max-w-[min(520px,100%)] items-start gap-3 rounded-2xl border border-line bg-paper-2/95 py-3 pr-2 pl-4 text-sm shadow-[var(--shadow-float)] backdrop-blur"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <span className="mt-0.5 shrink-0">{ICON[t.tone]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-ink">{t.message}</div>
              {t.detail && <div className="mt-0.5 text-xs leading-relaxed break-words text-ink-3">{t.detail}</div>}
            </div>
            {t.action && (
              <button
                className="shrink-0 rounded-lg px-2.5 py-1 text-fs-sm font-medium text-seal transition hover:bg-seal/10"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="shrink-0 rounded-md p-1 text-ink-3 hover:text-ink" aria-label="关闭通知" onClick={() => dismissToast(t.id)}>
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
