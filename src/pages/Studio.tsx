/**
 * 写作台：一张稿纸，一根工序轨，一个检查器。
 *
 * 左：章节目录；中：稿纸（CodeMirror）+ 工序轨 + 状态栏；右：蓝图 / 透镜 / 审稿 / 版本。
 * 专注模式（⌘.）会收起一切，只留下纸和字。
 */
import { AnimatePresence, motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Camera,
  FastForward,
  Feather,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Stamp,
  Unlock,
  Wand2,
} from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { acknowledgeConflict, continueWriting, critiqueChapter, draftChapter, finalizeWithKeeper, reviseChapter } from '@/ai/tasks';
import { BlueprintEditor } from '@/components/BlueprintEditor';
import { Seal, SealStamp } from '@/components/Seal';
import { Button, Empty, IconButton, InkSpinner, Kbd, Menu, ProgressRing, Tabs } from '@/components/ui';
import { useChapters, useCharacters, useCurrentProject, useThreads } from '@/hooks/data';
import { db } from '@/lib/db';
import { useCaps } from '@/cloud/session';
import { useChapterLock } from '@/cloud/locks';
import { lintInstruction, lintProse } from '@/ai/lint';
import { createBlankChapter, createVersion, saveWorkingContent, unfinalizeChapter } from '@/lib/repo';
import { STATUS_META, type Chapter, type ChapterStatus, type Character, type Project, type Thread, type Version } from '@/lib/types';
import { chineseNumber, countWords, cx, isAbort } from '@/lib/util';
import { abortJob, useJob } from '@/store/jobs';
import { profileFor, useSettings } from '@/store/settings';
import { toast, toastError, useUI } from '@/store/ui';
import { CritiquePanel } from '@/studio/CritiquePanel';
import { Editor, type EditorHandle, type SelectionInfo } from '@/studio/Editor';
import { LensPanel } from '@/studio/LensPanel';
import { MuseBubble } from '@/studio/MuseBubble';
import { PipelineRail } from '@/studio/PipelineRail';
import { VersionsPanel } from '@/studio/VersionsPanel';
import { STATUS_COLOR } from './Overview';

type InspectorTab = 'blueprint' | 'lens' | 'critique' | 'versions';

export default function Studio() {
  const project = useCurrentProject();
  const { chapterId } = useParams();
  const navigate = useNavigate();
  const chapters = useChapters(project.id);
  const characters = useCharacters(project.id);
  const threads = useThreads(project.id);
  const count = useLiveQuery(() => db.chapters.where('projectId').equals(project.id).count(), [project.id]);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth > 1280);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 1100);
  const focus = useUI((s) => s.focusMode);
  const setFocus = useUI((s) => s.setFocus);

  const chapter = chapters.find((c) => c.id === chapterId);

  useEffect(() => {
    if (!chapters.length || chapter) return;
    const pick = chapters.find((c) => c.status !== 'final') ?? chapters[chapters.length - 1];
    navigate(`/p/${project.id}/write/${pick.id}`, { replace: true });
  }, [chapters, chapter, navigate, project.id]);

  // 离开写作台时退出专注模式
  useEffect(() => () => setFocus(false), [setFocus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setFocus(!useUI.getState().focusMode);
      }
      if (e.key === 'Escape' && useUI.getState().focusMode && !document.querySelector('[role="dialog"]')) setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFocus]);

  if (count === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3">
        <InkSpinner className="size-6" />
      </div>
    );
  }
  if (count === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty
          icon={<Feather />}
          title="还没有可写的章节"
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => createBlankChapter(project.id).then((c) => navigate(`/p/${project.id}/write/${c.id}`))}>
                新建空白章
              </Button>
              <Button variant="seal" onClick={() => navigate(`/p/${project.id}/outline`)}>
                去写大纲
              </Button>
            </div>
          }
        >
          先在大纲里写几章细纲，写作台会据此为你起草。
        </Empty>
      </div>
    );
  }
  if (!chapter) return null;

  const showRail = railOpen && !focus;

  return (
    <div className="flex h-full">
      <AnimatePresence initial={false}>
        {showRail && (
          <motion.nav
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 236, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden border-r border-line bg-paper"
            aria-label="章节目录"
          >
            <ChapterRail project={project} chapters={chapters} current={chapter.id} />
          </motion.nav>
        )}
      </AnimatePresence>
      <Desk
        key={chapter.id}
        project={project}
        chapter={chapter}
        chapters={chapters}
        characters={characters}
        threads={threads}
        railOpen={showRail}
        onToggleRail={() => setRailOpen(!railOpen)}
        inspectorOpen={inspectorOpen && !focus}
        onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
      />
    </div>
  );
}

function ChapterRail({ project, chapters, current }: { project: Project; chapters: Chapter[]; current: string }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' });
  }, [current]);
  return (
    <div className="flex h-full w-[236px] flex-col">
      <div className="flex h-16 items-center justify-between px-4">
        <span className="text-[11px] tracking-[.25em] text-ink-3">目录</span>
        <IconButton label="新建章节" size="sm" onClick={() => createBlankChapter(project.id).then((c) => navigate(`/p/${project.id}/write/${c.id}`))}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {chapters.map((c, i) => {
          const showAct = c.act && c.act !== chapters[i - 1]?.act;
          const on = c.id === current;
          return (
            <div key={c.id}>
              {showAct && <div className="px-3 pt-4 pb-1.5 font-serif text-[11px] tracking-[.15em] text-seal">{c.act}</div>}
              <button
                onClick={() => navigate(`/p/${project.id}/write/${c.id}`)}
                aria-current={on ? 'page' : undefined}
                className={cx('relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors', on ? 'text-ink' : 'text-ink-2 hover:bg-ink/[.04] hover:text-ink')}
              >
                {on && <motion.span layoutId="rail-active" className="absolute inset-0 rounded-lg bg-paper-2 shadow-[var(--shadow-card)] ring-1 ring-line" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span className="relative w-7 shrink-0 font-serif text-[12px] text-ink-3">{chineseNumber(c.index)}</span>
                <span className="relative min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
                <span className="relative size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[c.status] }} aria-hidden="true" />
                <span className="sr-only">（{STATUS_META[c.status].label}）</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DeskProps {
  project: Project;
  chapter: Chapter;
  chapters: Chapter[];
  characters: Character[];
  threads: Thread[];
  railOpen: boolean;
  onToggleRail: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

function loadExcluded(chapterId: string) {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(`inkloom.lens.${chapterId}`) ?? '[]'));
  } catch {
    return new Set<string>();
  }
}

function Desk({ project, chapter, characters, threads, railOpen, onToggleRail, inspectorOpen, onToggleInspector }: DeskProps) {
  const navigate = useNavigate();
  const editor = useRef<EditorHandle>(null);
  const version = useLiveQuery(async () => (chapter.workingVersionId ? ((await db.versions.get(chapter.workingVersionId)) ?? null) : null), [chapter.workingVersionId]);
  const versions = useLiveQuery(() => db.versions.where('chapterId').equals(chapter.id).reverse().sortBy('createdAt'), [chapter.id]) ?? [];
  const critiques = useLiveQuery(() => db.critiques.where('chapterId').equals(chapter.id).reverse().sortBy('createdAt'), [chapter.id]) ?? [];
  const writeJob = useJob(`write:${chapter.id}`);
  const critiqueJob = useJob(`critique:${chapter.id}`);
  const ghostJob = useJob(`ghost:${chapter.id}`);
  const streaming = !!writeJob;
  const finalized = chapter.status === 'final';
  const caps = useCaps(project.id);
  // 进入章节时自动加锁：别人正在编辑同一章时，这里只读，对方离开后自动接手
  const lock = useChapterLock(chapter.id, project.id, caps.write && !finalized);
  const lockedByOther = lock.state === 'other';
  const readOnly = finalized || !caps.write || lockedByOther;
  const editorSize = useSettings((s) => s.editorSize);
  const typewriter = useSettings((s) => s.typewriter);
  const patchSettings = useSettings((s) => s.patch);
  const focus = useUI((s) => s.focusMode);
  const setFocus = useUI((s) => s.setFocus);

  const [text, setText] = useState('');
  const [lintOpen, setLintOpen] = useState(false);
  // 文字体检：只在不在生成、正文足够长时计算，避免打字时卡顿
  const lintText = useDeferredValue(text);
  const lint = useMemo(() => (streaming ? null : lintProse(lintText)), [lintText, streaming]);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [tab, setTab] = useState<InspectorTab>(chapter.status === 'review' ? 'critique' : chapter.status === 'planned' ? 'blueprint' : 'lens');
  const [excluded, setExcluded] = useState(() => loadExcluded(chapter.id));
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [stamp, setStamp] = useState(false);
  const [title, setTitle] = useState(chapter.title);

  const selfVersions = useRef(new Set<string>());
  const loadedKey = useRef<string | null>(null);
  const pendingText = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const ghost = useRef<{ pos: number; active: boolean } | null>(null);

  // ── 载入正文：只在「章节 + 工作版本」变化时替换，自己保存产生的新版本不回灌 ──
  useEffect(() => {
    if (streaming || version === undefined) return;
    // 实时查询在 id 变化后会短暂返回旧结果：等到版本与当前 id 对上再载入
    if ((version?.id ?? undefined) !== chapter.workingVersionId) return;
    const key = chapter.workingVersionId ?? 'none';
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    if (chapter.workingVersionId && selfVersions.current.has(chapter.workingVersionId)) return;
    const content = version?.content ?? '';
    editor.current?.setDoc(content);
    setText(content);
  }, [version, chapter.workingVersionId, streaming]);

  // ── 流式写入 ──
  useEffect(() => {
    if (!writeJob) return;
    loadedKey.current = null; // 结束后强制重新载入最终版本
    editor.current?.streamTo(writeJob.text);
    setText(writeJob.text);
  }, [writeJob?.text, writeJob]);

  // ── 自动保存（串行、防抖） ──
  const doSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    const t = pendingText.current;
    if (t === null) return saving.current;
    pendingText.current = null;
    setSaveState('saving');
    saving.current = saving.current
      .then(async () => {
        const fresh = await db.chapters.get(chapter.id);
        if (!fresh) return;
        const id = await saveWorkingContent(fresh, t);
        if (id) selfVersions.current.add(id);
      })
      .then(() => setSaveState(pendingText.current === null ? 'saved' : 'dirty'))
      .catch((e) => {
        toastError(e, '保存失败');
        setSaveState('dirty');
      });
    return saving.current;
  }, [chapter.id]);

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && doSave();
    window.addEventListener('beforeunload', doSave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', doSave);
      document.removeEventListener('visibilitychange', onHide);
      doSave();
    };
  }, [doSave]);

  const onChange = (t: string) => {
    setText(t);
    pendingText.current = t;
    setSaveState('dirty');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 700);
  };

  useEffect(() => {
    sessionStorage.setItem(`inkloom.lens.${chapter.id}`, JSON.stringify([...excluded]));
  }, [excluded, chapter.id]);

  // ── 动作 ──
  const draft = async () => {
    await doSave();
    const hadText = !!text.trim();
    setTab('lens');
    try {
      const v = await draftChapter(project.id, chapter.id, excluded);
      if (v) toast('草稿已生成', { tone: 'success', detail: hadText ? '上一稿保存在「版本」里。' : `${v.words.toLocaleString('zh-CN')} 字。下一步：请编辑审稿。` });
    } catch (error) {
      if (!isAbort(error)) toastError(error, '起草中断');
    }
  };

  const critique = async () => {
    await doSave();
    setTab('critique');
    try {
      const c = await critiqueChapter(project.id, chapter.id);
      toast('审稿报告已出', { tone: 'success', detail: `${c.issues.length} 条意见 · ${c.beats.filter((b) => b.status === 'done').length}/${c.beats.length} 个情节点已写到` });
    } catch (error) {
      if (!isAbort(error)) toastError(error, '审稿失败');
    }
  };

  const revise = async (issueIds: string[], instruction: string, includeBeats: boolean) => {
    await doSave();
    const latest = critiques[0];
    try {
      const v = await reviseChapter({ projectId: project.id, chapterId: chapter.id, critique: latest && (includeBeats ? latest : { ...latest, beats: [] }), issueIds, instruction, excluded });
      if (v) toast('修订稿已完成', { tone: 'success', detail: '在「版本」里可以对比修改前后的差异。', action: { label: '看对比', run: () => setTab('versions') } });
    } catch (error) {
      if (!isAbort(error)) toastError(error, '修订中断');
    }
  };

  const finalize = async () => {
    await doSave();
    if (!editor.current?.getText().trim()) return toast('还没有正文，无法定稿', { tone: 'error' });
    setStamp(true);
    try {
      const n = await finalizeWithKeeper(project.id, chapter.id);
      toast(`第${chineseNumber(chapter.index)}章已定稿`, {
        tone: 'seal',
        detail: n ? `从正文中整理出 ${n} 条设定变化，确认后才会写入设定集。` : '这一章没有需要更新的设定。',
        action: n ? { label: '去确认', run: () => navigate(`/p/${project.id}/updates`) } : undefined,
      });
    } catch (error) {
      if (!isAbort(error)) toastError(error, '定稿已完成，但设定整理失败');
    }
  };

  const unlock = async () => {
    await unfinalizeChapter(chapter);
    toast('已解除定稿', { detail: '修改会保存为新版本，原定稿保留在版本记录里。' });
  };

  const snapshot = async () => {
    await doSave();
    const fresh = await db.chapters.get(chapter.id);
    if (!fresh) return;
    const v = await createVersion(fresh, 'manual', editor.current?.getText() ?? text, '手动快照');
    selfVersions.current.add(v.id);
    toast('已保存快照', { tone: 'success' });
  };

  const restore = async (v: Version) => {
    await doSave();
    await db.chapters.update(chapter.id, { workingVersionId: v.id, words: v.words, updatedAt: Date.now() });
    toast(`已恢复「${v.label}」`, { tone: 'success' });
  };

  const startContinue = async () => {
    if (streaming || readOnly || ghostJob || !editor.current) return;
    const pos = editor.current.cursor();
    const doc = editor.current.getText();
    ghost.current = { pos, active: true };
    editor.current.setGhost({ pos, text: '', done: false });
    try {
      const t = await continueWriting({ projectId: project.id, chapterId: chapter.id, before: doc.slice(0, pos), after: doc.slice(pos) });
      if (ghost.current?.active) editor.current?.setGhost({ pos, text: t, done: true });
    } catch (error) {
      editor.current?.setGhost(null);
      if (!isAbort(error)) toastError(error, '续写失败');
    }
  };

  useEffect(() => {
    if (ghostJob && ghost.current?.active) editor.current?.setGhost({ pos: ghost.current.pos, text: ghostJob.text, done: false });
  }, [ghostJob?.text, ghostJob]);

  const onGhostDismiss = () => {
    if (ghost.current) ghost.current.active = false;
    abortJob(`ghost:${chapter.id}`);
  };

  const onStep = (s: ChapterStatus) => {
    if (!inspectorOpen) onToggleInspector();
    setTab(s === 'planned' ? 'blueprint' : s === 'review' ? 'critique' : s === 'final' ? 'versions' : 'versions');
  };

  const words = countWords(text);
  const hasText = !!text.trim();
  const latestCritique = critiques[0];
  const writeProfile = profileFor('write');

  // ── 主操作（随工序变化） ──
  let primary: ReactNode;
  if (streaming) {
    primary = (
      <Button variant="outline" size="sm" icon={<Square className="size-3 fill-current" />} onClick={() => abortJob(`write:${chapter.id}`)}>
        停止
      </Button>
    );
  } else if (finalized) {
    primary = caps.finalize ? (
      <Button variant="outline" size="sm" icon={<Unlock className="size-3.5" />} onClick={unlock}>
        解除定稿
      </Button>
    ) : null;
  } else if (!caps.write || lockedByOther) {
    primary = null;
  } else if (!hasText) {
    primary = (
      <Button variant="seal" size="sm" icon={<Feather className="size-4" />} onClick={draft}>
        生成草稿
      </Button>
    );
  } else {
    primary = (
      <>
        {chapter.status === 'review' && latestCritique ? (
          <Button variant="outline" size="sm" icon={<Wand2 className="size-3.5" />} onClick={() => onStep('review')}>
            按意见修订
          </Button>
        ) : (
          <Button variant="outline" size="sm" icon={<Sparkles className="size-3.5" />} onClick={critique} loading={!!critiqueJob}>
            审稿
          </Button>
        )}
        {caps.finalize && (
          <Button variant="seal" size="sm" icon={<Stamp className="size-3.5" />} onClick={finalize}>
            定稿
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <motion.header initial={false} animate={{ opacity: focus ? 0.0 : 1, height: focus ? 0 : 64 }} className="@container flex shrink-0 items-center gap-3 overflow-hidden border-b border-line px-4">
          <IconButton label={railOpen ? '收起目录' : '展开目录'} onClick={onToggleRail} active={railOpen}>
            <PanelLeft className="size-[18px]" />
          </IconButton>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden @5xl:flex-none">
            <span className="shrink-0 font-serif text-[13px] text-seal">第{chineseNumber(chapter.index)}章</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== chapter.title && db.chapters.update(chapter.id, { title: title.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="field-bare h-9 max-w-[14em] min-w-[3em] shrink px-2 font-serif text-[18px] font-semibold"
              style={{ width: `${Math.max(3, [...title].length + 1.5)}em` }}
              aria-label="章节名"
            />
            {finalized && (
              <motion.span className="shrink-0" initial={{ scale: 1.8, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: -8, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }} title="已定稿">
                <Seal chars="定稿" size={28} />
              </motion.span>
            )}
            <button onClick={() => onStep(chapter.status)} className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-ink-2 @2xl:flex @5xl:hidden" title="查看进度">
              <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[chapter.status] }} />
              {STATUS_META[chapter.status].step + 1}/5 · {STATUS_META[chapter.status].label}
            </button>
          </div>
          <div className="mx-auto hidden px-4 @5xl:block">
            <PipelineRail status={chapter.status} onStep={onStep} busy={streaming || !!critiqueJob} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {primary}
            <Menu
              trigger={(p) => (
                <IconButton {...p} label="更多操作">
                  <MoreHorizontal className="size-[18px]" />
                </IconButton>
              )}
              items={[
                ...(hasText && !readOnly && !streaming ? [{ label: '重新起草（旧稿保留）', icon: <RefreshCw />, onClick: draft }] : []),
                ...(hasText && !streaming ? [{ label: '请编辑审稿', icon: <Sparkles />, onClick: critique }] : []),
                ...(!readOnly && !streaming ? [{ label: '续写一段  ⌘J', icon: <Feather />, onClick: startContinue }] : []),
                { label: '保存版本快照', icon: <Camera />, onClick: snapshot },
                { label: '从本章开始批量写作…', icon: <FastForward />, onClick: () => navigate(`/p/${project.id}/outline?batch=${chapter.index}`) },
                { label: '专注模式  ⌘.', icon: <Maximize2 />, onClick: () => setFocus(true), divider: true },
              ]}
            />
            <IconButton label={inspectorOpen ? '收起侧栏' : '展开侧栏'} onClick={onToggleInspector} active={inspectorOpen}>
              <PanelRight className="size-[18px]" />
            </IconButton>
          </div>
        </motion.header>

        {/* 稿纸 */}
        <div className="relative min-h-0 flex-1">
          <Editor
            ref={editor}
            initialDoc=""
            readOnly={readOnly}
            streaming={streaming}
            fontSize={editorSize}
            typewriter={typewriter}
            dim={focus}
            placeholderText={readOnly ? '' : '从这里开始写……（⌘J 让 AI 续写一段）'}
            onChange={onChange}
            onSelection={setSelection}
            onContinue={startContinue}
            onGhostDismiss={onGhostDismiss}
            onSave={() => doSave().then(() => toast('已保存', { tone: 'success', duration: 1400 }))}
          />

          <AnimatePresence>
            {!hasText && !streaming && !readOnly && version !== undefined && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.2 } }} transition={{ delay: 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="pointer-events-none absolute inset-x-0 top-[26%] flex justify-center px-6">
                <div className="pointer-events-auto w-full max-w-lg rounded-3xl border border-line bg-paper-2/90 p-6 shadow-[var(--shadow-float)] backdrop-blur">
                  <div className="text-[11px] tracking-[.25em] text-seal">第{chineseNumber(chapter.index)}章 · 未动笔</div>
                  <div className="mt-2 font-serif text-[20px] font-semibold">{chapter.blueprint.goal || '这一章还没有写本章目标'}</div>
                  {!!chapter.blueprint.beats.length && (
                    <ol className="mt-3 space-y-1 text-[13px] text-ink-2">
                      {chapter.blueprint.beats.map((b, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="font-serif text-seal">{i + 1}</span>
                          {b}
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button variant="seal" icon={<Feather className="size-4" />} onClick={draft}>
                      让 AI 起草
                    </Button>
                    <Button variant="ghost" onClick={() => editor.current?.focus()}>
                      我自己写
                    </Button>
                    <span className="ml-auto text-[11px] text-ink-3">由 {writeProfile.name} 写作</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {streaming && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-paper-2/95 py-1.5 pr-1.5 pl-4 text-[12.5px] shadow-[var(--shadow-float)] backdrop-blur">
                <span className="size-1.5 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-seal" />
                <span className="shimmer-text">{writeJob?.label}</span>
                <span className="text-ink-3 tabular-nums">{words.toLocaleString('zh-CN')} 字</span>
                <Button variant="soft" size="xs" onClick={() => abortJob(`write:${chapter.id}`)}>
                  停止
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {readOnly && !focus && (
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-paper-2/95 py-1.5 pr-1.5 pl-4 text-[12.5px] text-ink-2 shadow-[var(--shadow-card)] backdrop-blur" role="status">
              {finalized ? (
                <>
                  {caps.finalize ? '已定稿，修改前需要先解除定稿' : '已定稿，需要编辑解除定稿后才能修改'}
                  {caps.finalize && (
                    <Button variant="soft" size="xs" icon={<Unlock className="size-3" />} onClick={unlock}>
                      解除定稿
                    </Button>
                  )}
                </>
              ) : !caps.write ? (
                <span className="pr-3">你是只读成员，不能修改正文</span>
              ) : (
                <span className="pr-3">{lock.state === 'other' && lock.holder ? `${lock.holder.userName} 正在编辑这一章，你暂时只能阅读；对方离开后会自动接手` : '这一章正在被别人编辑，你暂时只能阅读'}</span>
              )}
            </div>
          )}

          {focus && (
            <button onClick={() => setFocus(false)} className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-ink-3 opacity-40 transition hover:bg-ink/[.05] hover:opacity-100">
              <Minimize2 className="size-3.5" /> 退出专注 <Kbd>Esc</Kbd>
            </button>
          )}

          <MuseBubble selection={selection} projectId={project.id} chapterId={chapter.id} disabled={readOnly || streaming} getDoc={() => editor.current?.getText() ?? ''} onApply={(from, to, t) => editor.current?.replace(from, to, t)} />
        </div>

        {/* 状态栏 */}
        <motion.footer initial={false} animate={{ opacity: focus ? 0.35 : 1 }} className="flex h-10 shrink-0 items-center gap-4 border-t border-line px-4 text-[12px] text-ink-3">
          <span className="flex items-center gap-2">
            <ProgressRing value={words / Math.max(1, project.targetWords)} size={18} stroke={2.5} />
            <span className="tabular-nums">
              <span className="text-ink">{words.toLocaleString('zh-CN')}</span> / {project.targetWords.toLocaleString('zh-CN')} 字
            </span>
          </span>
          {!streaming && !readOnly && words > 0 && words < project.targetWords * 0.75 && (
            <button
              onClick={() => void revise([], `把本章扩写到约 ${project.targetWords} 字：保持情节、人物和结尾不变，把关键场景写透（动作、感官细节、对白的潜台词、人物的停顿与第一反应），不要追加新的情节或场景，不要用空泛的描写凑字数。`, false)}
              className="rounded-md px-2 py-1 text-gold transition hover:bg-gold/10"
              title="篇幅明显低于目标，可以让 AI 把关键场景写透"
            >
              篇幅偏短 · 一键扩写
            </button>
          )}
          <span className="flex items-center gap-1.5" aria-live="polite">
            <span className={cx('size-1.5 rounded-full', saveState === 'saved' ? 'bg-jade' : saveState === 'saving' ? 'animate-pulse bg-gold' : 'bg-ink-3')} />
            {streaming ? '生成中' : saveState === 'saved' ? '已保存到本地' : saveState === 'saving' ? '保存中…' : '未保存'}
          </span>
          <span className="hidden md:inline">写作模型 · {writeProfile.name}</span>
          {lint && lint.chars >= 600 && (
            <span className="relative">
              <button
                onClick={() => setLintOpen(!lintOpen)}
                className={cx('flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-ink/[.05]', lint.level === 'high' && 'text-gold')}
                aria-expanded={lintOpen}
                title="文字体检：比喻密度与套话"
              >
                <span className={cx('size-1.5 rounded-full', lint.level === 'high' ? 'bg-gold' : 'bg-jade')} />
                {lint.level === 'high' ? 'AI 腔偏高' : '文字体检'}
              </button>
              {lintOpen && (
                <div className="surface absolute bottom-full left-0 z-30 mb-2 w-80 rounded-xl p-3 text-[12px] leading-relaxed text-ink-2 shadow-[var(--shadow-float)]" role="dialog" aria-label="文字体检">
                  <div className="mb-1 font-medium text-ink">{lint.summary}</div>
                  <ul className="space-y-0.5 text-ink-3">
                    <li>比喻：每千字 {lint.similePerK.toFixed(1)} 处（共 {lint.simileCount}）</li>
                    <li>以比喻收尾的段落：{lint.paraEndSimile.count} / {lint.paraEndSimile.total}</li>
                    {lint.stock.slice(0, 5).map((x) => (
                      <li key={x.name}>
                        套话「{x.name}」× {x.count}
                      </li>
                    ))}
                  </ul>
                  {lint.level === 'high' && !readOnly && (
                    <Button
                      size="xs"
                      variant="soft"
                      className="mt-2"
                      icon={<Wand2 className="size-3" />}
                      onClick={() => {
                        setLintOpen(false);
                        void revise([], lintInstruction(lint), false);
                      }}
                    >
                      让 AI 修掉这些问题
                    </Button>
                  )}
                </div>
              )}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button onClick={() => patchSettings({ typewriter: !typewriter })} className={cx('rounded-md px-2 py-1 transition hover:bg-ink/[.05]', typewriter && 'text-seal')} aria-pressed={typewriter}>
              打字机
            </button>
            <IconButton label="缩小字号" size="sm" onClick={() => patchSettings({ editorSize: Math.max(14, editorSize - 1) })}>
              <Minus className="size-3.5" />
            </IconButton>
            <span className="w-5 text-center tabular-nums">{editorSize}</span>
            <IconButton label="放大字号" size="sm" onClick={() => patchSettings({ editorSize: Math.min(26, editorSize + 1) })}>
              <Plus className="size-3.5" />
            </IconButton>
            <IconButton label={focus ? '退出专注' : '专注模式'} size="sm" onClick={() => setFocus(!focus)}>
              {focus ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </IconButton>
          </span>
        </motion.footer>
      </div>

      {/* 检查器 */}
      <AnimatePresence initial={false}>
        {inspectorOpen && (
          <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 384, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="shrink-0 overflow-hidden border-l border-line bg-paper-2/60" aria-label="侧栏">
            <div className="flex h-full w-[384px] flex-col">
              <Tabs
                className="shrink-0 px-3 pt-3"
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'blueprint', label: '细纲' },
                  { value: 'lens', label: '资料' },
                  { value: 'critique', label: '审稿', badge: latestCritique && latestCritique.versionId === chapter.workingVersionId && chapter.status === 'review' ? latestCritique.issues.length : undefined },
                  { value: 'versions', label: `版本 ${versions.length || ''}` },
                ]}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AnimatePresence mode="wait">
                  <motion.div key={tab} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.22 }}>
                    {tab === 'blueprint' && (
                      <div className="p-5">
                        <BlueprintEditor chapter={chapter} characters={characters} threads={threads} compact />
                      </div>
                    )}
                    {tab === 'lens' && (
                      <LensPanel
                        project={project}
                        chapter={chapter}
                        excluded={excluded}
                        onToggle={(id) => {
                          const next = new Set(excluded);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          setExcluded(next);
                        }}
                      />
                    )}
                    {tab === 'critique' && (
                      <CritiquePanel
                        critique={latestCritique}
                        stale={!!latestCritique && latestCritique.versionId !== chapter.workingVersionId}
                        critiquing={!!critiqueJob}
                        writing={streaming}
                        canCritique={hasText && !streaming && !critiqueJob}
                        onCritique={critique}
                        onFlash={(q) => {
                          if (!editor.current?.flash(q)) toast('没能在正文里找到这段引文', { detail: '可能已被修改。' });
                        }}
                        onRevise={revise}
                        onAcknowledge={async (is) => {
                          if (await acknowledgeConflict(chapter.id, is.problem)) toast('已写入连续性台账', { tone: 'success', detail: '后面的章节会把它当作既定事实。' });
                        }}
                      />
                    )}
                    {tab === 'versions' && <VersionsPanel chapter={chapter} versions={versions} currentText={text} onRestore={restore} onSnapshot={snapshot} locked={readOnly || streaming} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <SealStamp show={stamp} onDone={() => setStamp(false)} />
    </div>
  );
}
