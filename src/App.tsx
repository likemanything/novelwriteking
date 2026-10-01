import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { loadSession, useSession } from '@/cloud/session';
import { CommandPalette } from '@/components/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { JobDock } from '@/components/JobDock';
import { ProjectShell } from '@/components/ProjectShell';
import { useThemeEffect } from '@/components/ThemeToggle';
import { Toaster } from '@/components/Toaster';
import { Button, InkSpinner } from '@/components/ui';
import { Library } from '@/pages/Library';
import { useSettings } from '@/store/settings';
import { toast } from '@/store/ui';

const Genesis = lazy(() => import('@/pages/Genesis'));
const Overview = lazy(() => import('@/pages/Overview'));
const Bible = lazy(() => import('@/pages/Bible'));
const Outline = lazy(() => import('@/pages/Outline'));
const Studio = lazy(() => import('@/pages/Studio'));
const Loom = lazy(() => import('@/pages/Loom'));
const Inbox = lazy(() => import('@/pages/Inbox'));
const Settings = lazy(() => import('@/pages/Settings'));
const Team = lazy(() => import('@/pages/Team'));
const Login = lazy(() => import('@/pages/Login'));
const Invite = lazy(() => import('@/pages/Invite'));

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center text-ink-3">
      <InkSpinner className="size-6" />
    </div>
  );
}

function RoutedBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

// 本地写保护（只读成员、作者改设定集）抛出的错误：转成一句提示，而不是静默失败
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'ReadOnlyError') {
    e.preventDefault();
    toast(String(e.reason.message || '没有修改权限'), { tone: 'error' });
  }
});

let booted = false;

/** 登录闸门：启动会话（读取账号、打开本地数据库、首次同步），未登录则去登录页。 */
function Gate({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);
  const location = useLocation();
  useEffect(() => {
    if (booted) return;
    booted = true;
    void loadSession();
  }, []);

  if (status === 'anon') {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="max-w-sm text-[14px] text-ink-2" role="alert">
          {error ?? '无法连接服务器'}
        </p>
        <Button variant="ink" onClick={() => window.location.reload()}>
          重试
        </Button>
      </div>
    );
  }
  if (status !== 'ready') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-3">
        <InkSpinner className="size-6" />
        <span className="text-[12.5px]">{status === 'opening' ? '正在同步你的作品…' : '正在登录…'}</span>
      </div>
    );
  }
  return <>{children}</>;
}

function ReadyOnly({ children }: { children: ReactNode }) {
  const ready = useSession((s) => s.status === 'ready');
  return ready ? <>{children}</> : null;
}

export function App() {
  useThemeEffect();
  const reduced = useSettings((s) => s.reducedMotion);
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <BrowserRouter>
        <RoutedBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/invite/:token" element={<Invite />} />
            <Route
              path="*"
              element={
                <Gate>
                  <Routes>
                    <Route path="/" element={<Library />} />
                    <Route path="/genesis" element={<Genesis />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/team" element={<Team />} />
                    <Route path="/p/:projectId" element={<ProjectShell />}>
                      <Route index element={<Overview />} />
                      <Route path="bible" element={<Bible />} />
                      <Route path="outline" element={<Outline />} />
                      <Route path="write" element={<Studio />} />
                      <Route path="write/:chapterId" element={<Studio />} />
                      <Route path="storylines" element={<Loom />} />
                      <Route path="loom" element={<Navigate to="../storylines" replace />} />
                      <Route path="updates" element={<Inbox />} />
                      <Route path="inbox" element={<Navigate to="../updates" replace />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Gate>
              }
            />
          </Routes>
        </Suspense>
        </RoutedBoundary>
        <ReadyOnly>
          <CommandPalette />
          <JobDock />
        </ReadyOnly>
        <Toaster />
      </BrowserRouter>
    </MotionConfig>
  );
}
