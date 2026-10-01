/**
 * 书架（首页）。
 * 第一屏只做一件事：让人写下一句灵感。丝线在背后流动，打字时织机被“踩动”。
 */
import { AnimatePresence, motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText, MoreHorizontal, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { TopBar } from '@/components/Brand';
import { Cover } from '@/components/Cover';
import { Hero } from './Hero';
import { Button, ConfirmDialog, Menu } from '@/components/ui';
import { useProjects } from '@/hooks/data';
import { db, deleteProject } from '@/lib/db';
import { exportBackup, exportManuscript, importBackup } from '@/lib/export';
import { importManuscript } from '@/lib/importText';
import { seedSampleProject } from '@/lib/sample';
import type { Project } from '@/lib/types';
import { formatNumber, relativeTime } from '@/lib/util';
import { useCaps, useOrg, useSession } from '@/cloud/session';
import { toast, toastError } from '@/store/ui';


function BookCard({ project, index, canDelete, onDelete }: { project: Project; index: number; canDelete: boolean; onDelete: () => void }) {
  const navigate = useNavigate();
  const stats = useLiveQuery(async () => {
    const chapters = await db.chapters.where('projectId').equals(project.id).toArray();
    return {
      chapters: chapters.length,
      finals: chapters.filter((c) => c.status === 'final').length,
      words: chapters.reduce((s, c) => s + c.words, 0),
    };
  }, [project.id]);
  const progress = stats ? stats.finals / Math.max(1, project.targetChapters) : 0;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
      transition={{ delay: 0.08 * index, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      <button onClick={() => navigate(`/p/${project.id}`)} className="block w-full text-left" aria-label={`打开《${project.title}》`}>
        <div className="relative transition-transform duration-500 ease-[var(--ease-silk)] group-hover:-translate-y-2">
          <Cover spec={project.cover} title={project.title} width="100%" />
        </div>
        <div className="mx-auto mt-1 h-2 w-[88%] rounded-[50%] bg-ink/15 blur-[5px] transition-all duration-500 group-hover:w-[76%] group-hover:opacity-60" />
        <div className="mt-3">
          <h3 className="truncate font-serif text-[16px] font-semibold text-ink">{project.title}</h3>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3">
            <span>{stats?.chapters ?? 0} 章</span>
            <span>·</span>
            <span>{formatNumber(stats?.words ?? 0)} 字</span>
            <span>·</span>
            <span>{relativeTime(project.updatedAt)}</span>
          </div>
          <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-ink/[.07]">
            <motion.div className="h-full rounded-full bg-seal" initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={{ delay: 0.4 + index * 0.08, duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
          </div>
        </div>
      </button>
      <Menu
        className="absolute top-2 left-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        align="left"
        trigger={(p) => (
          <button {...p} aria-label="作品操作" className="flex size-8 items-center justify-center rounded-lg bg-paper-2/90 text-ink-2 shadow backdrop-blur transition hover:text-ink">
            <MoreHorizontal className="size-4" />
          </button>
        )}
        items={[
          { label: '导出 Markdown', icon: <FileText />, onClick: () => exportManuscript(project, 'md', false).then((n) => toast(`已导出 ${n} 章`, { tone: 'success' })) },
          { label: '导出纯文本', icon: <FileText />, onClick: () => exportManuscript(project, 'txt', false).then((n) => toast(`已导出 ${n} 章`, { tone: 'success' })) },
          { label: '完整备份（.json）', icon: <Download />, onClick: () => exportBackup(project).then(() => toast('备份已下载', { tone: 'success' })) },
          ...(canDelete ? [{ label: '删除作品', icon: <Trash2 />, danger: true, divider: true, onClick: onDelete }] : []),
        ]}
      />
    </motion.article>
  );
}

export function Library() {
  const navigate = useNavigate();
  const projects = useProjects();
  const org = useOrg();
  const caps = useCaps();
  const firstTime = useSession((s) => s.firstTime);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const manuscriptRef = useRef<HTMLInputElement>(null);

  // 首次进入个人空间且书架是空的：放上示例作品（每个空间只放一次）
  useEffect(() => {
    if (!projects || !org || !firstTime || org.kind !== 'personal' || !caps.manageProjects) return;
    const key = `inkloom.seeded.${org.id}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    if (projects.length === 0) void seedSampleProject();
  }, [projects, org, firstTime, caps.manageProjects]);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const id = await importBackup(file);
      toast('备份已导入', { tone: 'success', action: { label: '打开', run: () => navigate(`/p/${id}`) } });
    } catch (error) {
      toastError(error, '导入失败');
    }
  };

  const onImportManuscript = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await importManuscript(file);
      toast(`已导入 ${r.chapters} 章 · ${formatNumber(r.words)} 字`, {
        tone: 'seal',
        detail: '开头的正文已设为参考文风。可以在设定集补充人物，或直接在写作台继续写。',
        action: { label: '打开', run: () => navigate(`/p/${r.projectId}`) },
      });
    } catch (error) {
      toastError(error, '稿件导入失败');
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <Hero topBar={<TopBar />} onStart={(seed) => navigate(`/genesis?seed=${encodeURIComponent(seed)}`)} />

      <section className="mx-auto max-w-6xl px-6 pb-24" aria-labelledby="shelf-title">
        <div className="mb-10 flex items-end justify-between border-b border-line pb-4">
          <div>
            <div className="mb-1 text-[11px] tracking-[.3em] text-seal">书架</div>
            <h2 id="shelf-title" className="font-serif text-[26px] font-semibold">
              你的作品 <span className="text-ink-3 tabular-nums">{projects?.length ?? ''}</span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {caps.manageProjects && <Menu
              trigger={(p) => (
                <Button {...p} variant="ghost" size="sm" icon={<Upload className="size-4" />}>
                  导入
                </Button>
              )}
              items={[
                { label: '导入已有稿件（.txt / .md）', icon: <FileText />, onClick: () => manuscriptRef.current?.click() },
                { label: '导入墨织备份（.json）', icon: <Download />, onClick: () => fileRef.current?.click() },
              ]}
            />}
            <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="选择备份文件" onChange={(e) => onImport(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
            <input ref={manuscriptRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden aria-label="选择稿件文件" onChange={(e) => onImportManuscript(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-14 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {caps.manageProjects && <motion.button
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => navigate('/genesis')}
            className="group flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-[4px_8px_8px_4px] border-2 border-dashed border-line-2 text-ink-3 transition-all duration-300 hover:-translate-y-2 hover:border-seal/50 hover:bg-seal/[.03] hover:text-seal"
          >
            <span className="flex size-12 items-center justify-center rounded-full border border-current transition-transform duration-500 group-hover:rotate-90">
              <Plus className="size-5" />
            </span>
            <span className="font-serif text-[15px]">开一本新书</span>
          </motion.button>}
          <AnimatePresence>
            {projects?.map((p, i) => (
              <BookCard key={p.id} project={p} index={i + 1} canDelete={caps.manageProjects} onDelete={() => setPendingDelete(p)} />
            ))}
          </AnimatePresence>
        </div>
      </section>

      <footer className="border-t border-line py-10 text-center text-[12px] leading-6 text-ink-3">
        <div>作品保存在团队的云端空间，并在这台设备上留有离线副本，断网也能继续写。</div>
        <div>模型请求经墨织服务器转发给团队配置的服务商。仍建议定期「完整备份」。</div>
      </footer>

      <ConfirmDialog
        open={!!pendingDelete}
        title={`删除《${pendingDelete?.title ?? ''}》？`}
        body="作品的全部章节、版本、设定与审稿记录都会被永久删除，无法恢复。建议先导出一份完整备份。"
        confirmLabel="永久删除"
        danger
        onResolve={async (ok) => {
          const p = pendingDelete;
          setPendingDelete(null);
          if (ok && p) {
            await deleteProject(p.id);
            toast(`《${p.title}》已删除`);
          }
        }}
      />
    </div>
  );
}
