/**
 * 作品工作区外壳：左侧导航 + 页面过渡。写作台的专注模式会让侧栏像帘子一样收起。
 */
import { motion } from 'motion/react';
import { ArrowLeft, Clapperboard, Command, Feather, Inbox, LayoutDashboard, ListTree, Settings, Users, Waypoints } from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { ProjectContext, useChapters, usePendingProposals, useProject } from '@/hooks/data';
import { cx } from '@/lib/util';
import { useUI } from '@/store/ui';
import { SyncBadge } from './AccountMenu';
import { Cover } from './Cover';
import { Seal } from './Seal';
import { ThemeToggle } from './ThemeToggle';
import { InkSpinner, Kbd } from './ui';

const NAV = [
  { to: '', label: '概览', icon: LayoutDashboard, end: true },
  { to: 'bible', label: '设定集', icon: Users },
  { to: 'outline', label: '大纲', icon: ListTree },
  { to: 'write', label: '写作台', icon: Feather },
  { to: 'storylines', label: '故事线', icon: Waypoints },
  { to: 'drama', label: '短剧', icon: Clapperboard },
  { to: 'updates', label: '设定更新', icon: Inbox },
];

export function ProjectShell() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const chapters = useChapters(projectId);
  const pending = usePendingProposals(projectId);
  const focus = useUI((s) => s.focusMode);
  const setPalette = useUI((s) => s.setPalette);
  const location = useLocation();
  const section = location.pathname.split('/')[3] ?? '';

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3">
        <InkSpinner className="size-6" />
      </div>
    );
  }
  if (project === null) return <Navigate to="/" replace />;

  const finals = chapters.filter((c) => c.status === 'final').length;
  const total = Math.max(project.targetChapters, chapters.length);

  return (
    <ProjectContext.Provider value={project}>
      <div className="flex h-full">
        <motion.aside
          initial={false}
          animate={{ width: focus && section === 'write' ? 0 : 'auto', opacity: focus && section === 'write' ? 0 : 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-20 shrink-0 overflow-hidden border-r border-line bg-paper"
        >
          <div className="flex h-full w-[72px] flex-col lg:w-[232px]">
            <NavLink to="/" className="group flex h-14 items-center gap-2 px-5 text-ink-3 transition hover:text-ink">
              <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
              <span className="hidden text-[13px] lg:inline">书架</span>
              <Seal size={22} className="ml-auto hidden lg:block" />
            </NavLink>

            <div className="flex items-center gap-3 px-4 pt-2 pb-5 lg:px-5">
              <Cover spec={project.cover} title={project.title} width={40} tilt={false} className="shrink-0" />
              <div className="hidden min-w-0 lg:block">
                <div className="truncate font-serif text-[15px] leading-snug font-semibold">{project.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-ink-3">{project.genre || '未分类'}</div>
              </div>
            </div>

            <nav className="flex flex-col gap-0.5 px-3" aria-label="作品导航">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to ? `/p/${projectId}/${n.to}` : `/p/${projectId}`}
                  end={n.end}
                  title={n.label}
                  className={({ isActive }) => cx('relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors', isActive ? 'text-ink' : 'text-ink-2 hover:text-ink')}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-paper-2 shadow-[var(--shadow-card)] ring-1 ring-line" transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
                          <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-seal" />
                        </motion.span>
                      )}
                      <n.icon className="relative size-[18px] shrink-0" strokeWidth={1.7} />
                      <span className="relative hidden lg:inline">{n.label}</span>
                      {n.to === 'updates' && pending.length > 0 && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute top-1.5 left-7 flex h-4 min-w-4 items-center justify-center rounded-full bg-seal px-1 text-[10px] font-medium text-white lg:static lg:ml-auto"
                        >
                          {pending.length}
                        </motion.span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="mx-5 mt-6 hidden lg:block">
              <div className="mb-1.5 flex justify-between text-[11px] text-ink-3">
                <span>定稿进度</span>
                <span className="tabular-nums">
                  {finals} / {total}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-ink/[.07]">
                <motion.div className="h-full rounded-full bg-seal" initial={{ width: 0 }} animate={{ width: `${(finals / Math.max(1, total)) * 100}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            </div>

            <div className="mt-auto flex flex-col gap-1 border-t border-line p-3">
              <SyncBadge className="px-2 pb-1" />
              <button onClick={() => setPalette(true)} className="flex h-9 items-center gap-2 rounded-lg px-2 text-ink-2 transition hover:bg-ink/[.06] hover:text-ink" aria-label="打开命令面板">
                <Command className="size-[18px]" strokeWidth={1.7} />
                <span className="hidden text-[13px] lg:inline">命令</span>
                <span className="ml-auto hidden gap-0.5 lg:flex">
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
              <div className="flex flex-col lg:flex-row lg:items-center">
                <ThemeToggle withLabel className="lg:flex-1 [&>span:last-child]:hidden lg:[&>span:last-child]:inline" />
                <NavLink to="/settings" className="flex h-9 items-center gap-2 rounded-lg px-2 text-ink-2 transition hover:bg-ink/[.06] hover:text-ink" aria-label="模型与设置" title="模型与设置">
                  <Settings className="size-[18px]" strokeWidth={1.7} />
                </NavLink>
              </div>
            </div>
          </div>
        </motion.aside>

        <main className="relative min-w-0 flex-1 overflow-hidden">
          <motion.div
            key={section}
            className="h-full"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </ProjectContext.Provider>
  );
}
