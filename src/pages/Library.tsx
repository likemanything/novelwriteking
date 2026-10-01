/**
 * 书架（首页）。
 * 第一屏只做一件事：让人写下一句灵感。丝线在背后流动，打字时织机被“踩动”。
 */
import { AnimatePresence, motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Dices, Download, Eye, FileText, Layers, MoreHorizontal, Plus, Stamp, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { TopBar } from '@/components/Brand';
import { Cover } from '@/components/Cover';
import { ThreadField } from '@/components/ThreadField';
import { Button, ConfirmDialog, Kbd, Menu } from '@/components/ui';
import { useProjects } from '@/hooks/data';
import { db, deleteProject } from '@/lib/db';
import { exportBackup, exportManuscript, importBackup } from '@/lib/export';
import { importManuscript } from '@/lib/importText';
import { seedSampleProject } from '@/lib/sample';
import type { Project } from '@/lib/types';
import { formatNumber, relativeTime } from '@/lib/util';
import { useCaps, useOrg, useSession } from '@/cloud/session';
import { toast, toastError } from '@/store/ui';

export const INSPIRATIONS = [
  '一个邮差发现，自己每天投递的信里，有一封来自十年前已经去世的人。',
  '末日后的图书馆里，最后一个管理员在给机器人讲故事。',
  '她每次说谎，城里就会下一场雪。',
  '修仙界的外卖小哥，意外送错了一单天劫。',
  '一个只能记住七天的侦探，正在调查自己的谋杀案。',
  '火星殖民地的第一场婚礼，新郎是个克隆人。',
  '老城区的深夜食堂，只在有人失恋的晚上开门。',
  '被贬的龙王在人间开了一家修伞铺。',
  '人类第一次收到外星信号，内容是一首童谣。',
  '她继承了祖母的当铺，这里能典当的是记忆。',
];

function useTypewriter(lines: string[], active: boolean) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!active) return;
    let line = Math.floor(Math.random() * lines.length);
    let i = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const target = lines[line];
      if (!deleting) {
        i++;
        setText(target.slice(0, i));
        if (i >= target.length) {
          deleting = true;
          timer = setTimeout(step, 2200);
          return;
        }
        timer = setTimeout(step, 55 + Math.random() * 60);
      } else {
        i -= 2;
        setText(target.slice(0, Math.max(0, i)));
        if (i <= 0) {
          deleting = false;
          line = (line + 1) % lines.length;
          timer = setTimeout(step, 400);
          return;
        }
        timer = setTimeout(step, 22);
      }
    };
    timer = setTimeout(step, 900);
    return () => clearTimeout(timer);
  }, [active, lines]);
  return text;
}

function RevealLine({ text, delay, accent }: { text: string; delay: number; accent?: [number, number] }) {
  return (
    <span className="block" aria-hidden="true">
      {[...text].map((ch, i) => {
        const isAccent = accent && i >= accent[0] && i < accent[1];
        return (
          <motion.span
            key={i}
            className={isAccent ? 'relative inline-block text-seal' : 'inline-block'}
            initial={{ opacity: 0, y: '0.35em', filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: delay + i * 0.055, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {ch}
            {isAccent && i === accent![1] - 1 && (
              <motion.svg viewBox="0 0 200 20" className="absolute -bottom-[0.12em] right-0 h-[0.22em] w-[200%] overflow-visible" preserveAspectRatio="none">
                <motion.path
                  d="M2 12 C 50 4, 120 18, 198 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: delay + text.length * 0.055 + 0.3, duration: 0.9, ease: 'easeInOut' }}
                />
              </motion.svg>
            )}
          </motion.span>
        );
      })}
    </span>
  );
}

function SeedBox({ onEnergy, onSubmit }: { onEnergy: () => void; onSubmit: (seed: string) => void }) {
  const [seed, setSeed] = useState('');
  const [focused, setFocused] = useState(false);
  const placeholder = useTypewriter(INSPIRATIONS, !seed && !focused);
  const ref = useRef<HTMLTextAreaElement>(null);
  const diceTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(diceTimer.current), []);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    clearInterval(diceTimer.current);
    if (seed.trim()) onSubmit(seed.trim());
  };

  const dice = () => {
    clearInterval(diceTimer.current);
    const pool = INSPIRATIONS.filter((s) => s !== seed);
    const next = pool[Math.floor(Math.random() * pool.length)];
    // 逐字“落”进输入框
    let i = 0;
    diceTimer.current = setInterval(() => {
      i += 2;
      setSeed(next.slice(0, i));
      onEnergy();
      if (i >= next.length) {
        clearInterval(diceTimer.current);
        ref.current?.focus();
      }
    }, 24);
  };

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.1, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      className="group relative mx-auto mt-12 max-w-2xl text-left"
    >
      <div className="absolute -inset-px rounded-[26px] bg-gradient-to-br from-seal/40 via-gold/20 to-indigo/30 opacity-0 blur-md transition-opacity duration-700 group-focus-within:opacity-100" />
      <div className="relative rounded-[24px] border border-line bg-paper-2/90 p-2 shadow-[var(--shadow-float)] backdrop-blur-md">
        <div className="relative">
          <textarea
            ref={ref}
            value={seed}
            rows={2}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              clearInterval(diceTimer.current);
              setSeed(e.target.value);
              onEnergy();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            aria-label="写下你的一句灵感"
            className="block min-h-[104px] w-full resize-none bg-transparent px-5 pt-5 pb-2 font-serif text-[21px] leading-relaxed text-ink outline-none"
          />
          {!seed && (
            <div className="pointer-events-none absolute top-5 left-5 right-5 font-serif text-[21px] leading-relaxed text-ink-3">
              {focused ? '写下你的一句灵感……' : placeholder}
              {!focused && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-seal/70 animate-[caret_1.05s_steps(1)_infinite]" />}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <Button type="button" variant="ghost" size="sm" icon={<Dices className="size-4" />} onClick={dice}>
            随机灵感
          </Button>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button type="submit" variant="seal" disabled={!seed.trim()} className="group/btn">
              开始创作
              <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />
            </Button>
          </div>
        </div>
      </div>
    </motion.form>
  );
}

const PILLARS = [
  { icon: Layers, title: '先搭框架', text: '一句灵感生成人物、世界观、故事线和章节细纲' },
  { icon: Eye, title: '资料透明', text: '每次生成用了哪些设定和前文，一目了然' },
  { icon: Stamp, title: '作者把关', text: 'AI 只给建议，写进设定集的每一条都由你确认' },
];

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
  const [energy, setEnergy] = useState(0);
  const [converge, setConverge] = useState(0);
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

  // 打字能量随时间衰减
  useEffect(() => {
    if (energy <= 0.01) return;
    const t = setTimeout(() => setEnergy((e) => (e < 0.02 ? 0 : e * 0.88)), 90);
    return () => clearTimeout(t);
  }, [energy]);

  const start = (seed: string) => {
    setConverge(1);
    setEnergy(1);
    setTimeout(() => navigate(`/genesis?seed=${encodeURIComponent(seed)}`), 520);
  };

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
      <section className="relative isolate min-h-[88vh] overflow-hidden">
        <ThreadField className="absolute inset-0 -z-10 h-full w-full" energy={energy} converge={converge} />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-paper" />
        <TopBar />
        <div className="mx-auto max-w-4xl px-6 pt-[9vh] pb-20 text-center">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="mb-7 inline-flex items-center gap-2 rounded-full border border-line bg-paper-2/60 px-3.5 py-1 text-[12px] tracking-[.18em] text-ink-2 backdrop-blur">
            <span className="size-1.5 rounded-full bg-seal" />
            AI 长篇小说创作工具
          </motion.div>
          <h1 className="font-serif text-[clamp(40px,7.2vw,86px)] leading-[1.18] font-semibold tracking-[.06em] text-ink" aria-label="把一句灵感，写成一部长篇。">
            <RevealLine text="把一句灵感，" delay={0.15} />
            <RevealLine text="写成一部长篇。" delay={0.55} accent={[4, 6]} />
          </h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 1 }} className="mx-auto mt-7 max-w-xl text-[15px] leading-8 text-ink-2">
            先定人物、世界观和大纲，再一章一章写、审、改。
            <br className="hidden sm:block" />
            AI 负责起草，每一处改动都由你决定。
          </motion.p>
          <SeedBox onEnergy={() => setEnergy(1)} onSubmit={start} />
          <motion.ul initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.12, delayChildren: 1.6 } } }} className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-3">
            {PILLARS.map((p) => (
              <motion.li key={p.title} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="flex items-start gap-3 text-left">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-paper-2/70 text-seal backdrop-blur">
                  <p.icon className="size-4" strokeWidth={1.8} />
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-ink">{p.title}</span>
                  <span className="block text-[12px] leading-relaxed text-ink-3">{p.text}</span>
                </span>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </section>

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
