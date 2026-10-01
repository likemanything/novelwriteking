/**
 * 命令面板（⌘K / Ctrl+K）：跳到任意章节、任意页面，切换主题，开新书。
 */
import { AnimatePresence, motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen,
  CornerDownLeft,
  Feather,
  Inbox,
  LayoutDashboard,
  Library,
  ListTree,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  Waypoints,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { db } from '@/lib/db';
import { STATUS_META } from '@/lib/types';
import { chineseNumber, cx } from '@/lib/util';
import { useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { Kbd } from './ui';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

function matches(q: string, text: string) {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of q.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const navigate = useNavigate();
  const location = useLocation();
  const projectId = location.pathname.match(/^\/p\/([^/]+)/)?.[1];
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUI.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const project = useLiveQuery(() => (projectId && open ? db.projects.get(projectId) : undefined), [projectId, open]);
  const chapters = useLiveQuery(() => (projectId && open ? db.chapters.where('projectId').equals(projectId).sortBy('index') : []), [projectId, open]) ?? [];

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path);
    const list: Command[] = [];
    if (projectId && project) {
      const base = `/p/${projectId}`;
      const g = `《${project.title}》`;
      list.push(
        { id: 'ov', group: g, label: '概览', icon: <LayoutDashboard />, run: go(base), keywords: 'overview gailan' },
        { id: 'bible', group: g, label: '设定集', hint: '人物 · 世界观 · 故事线 · 文风', icon: <Users />, run: go(`${base}/bible`), keywords: 'bible sheding renwu' },
        { id: 'outline', group: g, label: '大纲', icon: <ListTree />, run: go(`${base}/outline`), keywords: 'outline dagang' },
        { id: 'write', group: g, label: '写作台', icon: <Feather />, run: go(`${base}/write`), keywords: 'write xiezuo studio' },
        { id: 'loom', group: g, label: '故事线', icon: <Waypoints />, run: go(`${base}/storylines`), keywords: 'storylines gushixian xiansuo' },
        { id: 'inbox', group: g, label: '设定更新', icon: <Inbox />, run: go(`${base}/updates`), keywords: 'updates sheding gengxin queren' },
      );
      for (const c of chapters) {
        list.push({
          id: `ch:${c.id}`,
          group: '章节',
          label: `第${chineseNumber(c.index)}章 ${c.title}`,
          hint: STATUS_META[c.status].label,
          icon: <BookOpen />,
          keywords: `${c.index} ${c.blueprint.goal}`,
          run: go(`${base}/write/${c.id}`),
        });
      }
    }
    list.push(
      { id: 'lib', group: '墨织', label: '书架', icon: <Library />, run: go('/'), keywords: 'library shujia home' },
      { id: 'new', group: '墨织', label: '开一本新书', icon: <Plus />, run: go('/genesis'), keywords: 'new genesis kaishu' },
      { id: 'settings', group: '墨织', label: '模型与设置', icon: <Settings />, run: go('/settings'), keywords: 'settings model shezhi' },
      {
        id: 'theme',
        group: '墨织',
        label: theme === 'night' ? '切换到日间主题' : '切换到夜间主题',
        icon: theme === 'night' ? <Sun /> : <Moon />,
        run: () => setTheme(theme === 'night' ? 'paper' : 'night'),
        keywords: 'theme dark light zhuti',
      },
    );
    return list;
  }, [projectId, project, chapters, navigate, theme, setTheme]);

  const filtered = commands.filter((c) => matches(q, `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`)).slice(0, 60);
  const groups = [...new Set(filtered.map((c) => c.group))];

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  let idx = -1;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[14vh]">
          <motion.div className="absolute inset-0 bg-[#140f08]/30 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.div
            role="dialog"
            aria-label="命令面板"
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-[600px] overflow-hidden rounded-2xl border border-line bg-paper-2 shadow-[var(--shadow-float)]"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-ink-3" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="跳转到章节、页面，或执行命令…"
                className="h-14 flex-1 bg-transparent text-fs-md text-ink outline-none placeholder:text-ink-3"
                aria-label="搜索命令"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {!filtered.length && <div className="px-3 py-10 text-center text-sm text-ink-3">没有匹配的命令</div>}
              {groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-fs-2xs font-medium tracking-wider text-ink-3">{g}</div>
                  {filtered
                    .filter((c) => c.group === g)
                    .map((c) => {
                      idx++;
                      const i = idx;
                      return (
                        <button
                          key={c.id}
                          data-idx={i}
                          onMouseMove={() => setActive(i)}
                          onClick={() => run(c)}
                          className={cx('relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors', i === active ? 'text-ink' : 'text-ink-2')}
                        >
                          {i === active && <motion.span layoutId="palette-active" className="absolute inset-0 rounded-xl bg-ink/[.06]" transition={{ type: 'spring', stiffness: 600, damping: 44 }} />}
                          <span className="relative text-ink-3 [&>svg]:size-4">{c.icon}</span>
                          <span className="relative flex-1 truncate">{c.label}</span>
                          {c.hint && <span className="relative text-xs text-ink-3">{c.hint}</span>}
                          {i === active && <CornerDownLeft className="relative size-3.5 text-ink-3" />}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
