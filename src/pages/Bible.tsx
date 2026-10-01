/**
 * 设定集：人物 · 世界 · 线索 · 文风 · 故事。
 * 每条设定都标注来源（作者 / AI 建议 / 定稿提炼），并可与人物“面对面访谈”。
 */
import { useCaps } from '@/cloud/session';
import { AnimatePresence, motion } from 'motion/react';
import { BookMarked, MessageCircle, Plus, Send, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { analyzeStyle, interview } from '@/ai/tasks';
import type { ChatMessage } from '@/ai/client';
import { Badge, Button, Chip, Empty, Field, IconButton, Input, SectionTitle, Segmented, Sheet, Tabs, Textarea } from '@/components/ui';
import { useCharacters, useCurrentProject, useThreads, useWorld } from '@/hooks/data';
import { useDraft } from '@/hooks/useDraft';
import { db, touchProject } from '@/lib/db';
import { blankCharacter, blankThread, blankWorld } from '@/lib/repo';
import { THREAD_KIND_LABEL, WORLD_CATEGORIES, type Character, type Project, type Provenance, type Thread, type ThreadKind, type WorldEntry } from '@/lib/types';
import { SILK, cx } from '@/lib/util';
import { useJob } from '@/store/jobs';
import { toast, toastError } from '@/store/ui';

type Tab = 'characters' | 'world' | 'threads' | 'style' | 'story';

const PROV: Record<Provenance, { label: string; tone: 'neutral' | 'gold' | 'seal' }> = {
  author: { label: '作者', tone: 'neutral' },
  ai: { label: 'AI 生成', tone: 'gold' },
  canon: { label: '从定稿整理', tone: 'seal' },
};

export function Avatar({ c, size = 40 }: { c: Pick<Character, 'name' | 'color'>; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-serif font-semibold text-white shadow-[inset_0_-2px_6px_rgba(0,0,0,.2)]" style={{ width: size, height: size, background: c.color, fontSize: size * 0.42 }} aria-hidden="true">
      {[...c.name][0] ?? '?'}
    </span>
  );
}

export default function Bible() {
  const project = useCurrentProject();
  const caps = useCaps(project.id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'characters';
  const characters = useCharacters(project.id);
  const world = useWorld(project.id);
  const threads = useThreads(project.id);

  return (
    <div className="h-full overflow-y-auto">
      {!caps.editSettings && (
        <div className="mx-auto max-w-6xl px-8 pt-6" role="status">
          <div className="rounded-xl bg-gold/10 px-4 py-2.5 text-fs-xs text-ink-2">你的角色不能修改设定集，这里只能查看。</div>
        </div>
      )}
      <fieldset disabled={!caps.editSettings} className="contents">
      <div className="mx-auto max-w-6xl px-8 pt-10 pb-24">
        <SectionTitle eyebrow="设定集" title="人物、世界观与故事线" />
        <p className="mt-2 max-w-2xl text-fs-sm leading-relaxed text-ink-2">写作时，AI 会从这里取用相关设定作为参考资料。写得越具体，越不容易前后矛盾。</p>
        <Tabs
          className="mt-8"
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          tabs={[
            { value: 'characters', label: `人物 ${characters.length}` },
            { value: 'world', label: `世界观 ${world.length}` },
            { value: 'threads', label: `故事线 ${threads.length}` },
            { value: 'style', label: '文风' },
            { value: 'story', label: '故事' },
          ]}
        />
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }} className="pt-8">
            {tab === 'characters' && <CharactersTab project={project} characters={characters} />}
            {tab === 'world' && <WorldTab project={project} world={world} />}
            {tab === 'threads' && <ThreadsTab project={project} threads={threads} />}
            {tab === 'style' && <StyleTab project={project} />}
            {tab === 'story' && <StoryTab project={project} />}
          </motion.div>
        </AnimatePresence>
      </div>
      </fieldset>
    </div>
  );
}

// ─────────────────────────── 人物 ───────────────────────────

function CharactersTab({ project, characters }: { project: Project; characters: Character[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<'profile' | 'interview'>('profile');
  const open = characters.find((c) => c.id === openId);

  const add = async () => {
    const c = blankCharacter(project.id, characters.length);
    await db.characters.add(c);
    await touchProject(project.id);
    setMode('profile');
    setOpenId(c.id);
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {characters.map((c, i) => (
          <motion.article
            key={c.id}
            layout
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="surface group relative flex flex-col overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-float)]"
          >
            <span className="absolute inset-x-0 top-0 h-1" style={{ background: c.color }} />
            <button
              className="flex flex-1 flex-col justify-start p-5 text-left"
              onClick={() => {
                setMode('profile');
                setOpenId(c.id);
              }}
            >
              <div className="flex items-center gap-3">
                <Avatar c={c} size={44} />
                <div className="min-w-0">
                  <div className="truncate font-serif text-fs-lg font-semibold">{c.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge>{c.role}</Badge>
                    <Badge tone={PROV[c.provenance].tone}>{PROV[c.provenance].label}</Badge>
                  </div>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 min-h-[2.8em] text-fs-sm leading-relaxed text-ink-2">{c.summary || '还没有人物小传。'}</p>
              {(c.state.location || c.state.condition) && (
                <div className="mt-3 rounded-lg bg-ink/[.035] px-3 py-2 text-fs-xs leading-relaxed text-ink-3">
                  <span className="text-ink-2">{c.state.sourceChapter ? `截至第${c.state.sourceChapter}章` : '当前'}</span> · {[c.state.location, c.state.condition].filter(Boolean).join('，')}
                </div>
              )}
            </button>
            <div className="flex border-t border-line">
              <button
                onClick={() => {
                  setMode('interview');
                  setOpenId(c.id);
                }}
                className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-fs-xs text-ink-2 transition hover:bg-ink/[.03] hover:text-seal"
              >
                <MessageCircle className="size-3.5" /> 访谈
              </button>
            </div>
          </motion.article>
        ))}
        <button onClick={add} className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-2 text-ink-3 transition hover:border-seal/50 hover:text-seal">
          <Plus className="size-5" />
          <span className="text-fs-sm">添加人物</span>
        </button>
      </div>

      <Sheet open={!!open} onClose={() => setOpenId(null)} width={620} title={open?.name} subtitle={open ? `${open.role} · ${PROV[open.provenance].label}` : ''}>
        {open && (
          <div>
            <div className="sticky top-0 z-10 border-b border-line bg-paper/90 px-6 py-2.5 backdrop-blur">
              <Segmented
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'profile', label: '档案' },
                  { value: 'interview', label: '访谈' },
                ]}
              />
            </div>
            {mode === 'profile' ? <CharacterEditor key={open.id} c={open} onDeleted={() => setOpenId(null)} /> : <Interview key={open.id} project={project} c={open} />}
          </div>
        )}
      </Sheet>
    </>
  );
}

const CHAR_FIELDS: { key: keyof Character; label: string; hint?: string; rows?: number }[] = [
  { key: 'summary', label: '人物小传', rows: 3 },
  { key: 'appearance', label: '外貌' },
  { key: 'personality', label: '性格' },
  { key: 'voice', label: '说话方式', hint: '对白生成时会参考' },
  { key: 'desire', label: '想要', hint: '外在目标' },
  { key: 'need', label: '需要', hint: '内在成长' },
  { key: 'wound', label: '创伤 / 恐惧' },
  { key: 'arc', label: '人物弧线' },
];

function CharacterEditor({ c, onDeleted }: { c: Character; onDeleted: () => void }) {
  const [d, set] = useDraft(c, (patch) => db.characters.update(c.id, { ...patch, provenance: 'author' }));
  if (!d) return null;
  return (
    <div className="space-y-5 px-6 py-6">
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <Field label="姓名">
          <Input value={d.name} onChange={(e) => set({ name: e.target.value })} className="font-serif text-base" />
        </Field>
        <Field label="角色定位">
          <Input value={d.role} onChange={(e) => set({ role: e.target.value })} />
        </Field>
      </div>
      <Field group label="标识颜色">
        <div className="flex flex-wrap gap-2">
          {SILK.map((s) => (
            <button key={s.hex} onClick={() => set({ color: s.hex })} aria-label={s.name} title={s.name} className={cx('size-7 rounded-full transition-transform hover:scale-110', d.color === s.hex && 'ring-2 ring-ink ring-offset-2 ring-offset-paper')} style={{ background: s.hex }} />
          ))}
        </div>
      </Field>
      {CHAR_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <Textarea value={String(d[f.key] ?? '')} onChange={(e) => set({ [f.key]: e.target.value } as Partial<Character>)} minRows={f.rows ?? 1} />
        </Field>
      ))}
      <div className="rounded-2xl border border-line bg-ink/[.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium tracking-wide text-ink-2">当前状态</span>
          <span className="text-fs-2xs text-ink-3">{d.state.sourceChapter ? `来自第${d.state.sourceChapter}章定稿` : '作者设定'}</span>
        </div>
        <div className="grid gap-3">
          {(['location', 'condition', 'knowledge'] as const).map((k) => (
            <Field key={k} label={{ location: '位置', condition: '身心状态', knowledge: '已知的秘密' }[k]}>
              <Textarea value={d.state[k]} minRows={1} onChange={(e) => set({ state: { ...d.state, [k]: e.target.value, sourceChapter: undefined } })} />
            </Field>
          ))}
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="size-4" />}
          onClick={async () => {
            await db.characters.delete(c.id);
            onDeleted();
            toast(`已删除人物「${c.name}」`, { action: { label: '撤销', run: () => db.characters.add(c) } });
          }}
        >
          删除人物
        </Button>
      </div>
    </div>
  );
}

function Interview({ project, c }: { project: Project; c: Character }) {
  const storageKey = `inkloom.interview.${c.id}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    } catch {
      return [];
    }
  });
  const [q, setQ] = useState('');
  const job = useJob(`interview:${c.id}`);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, job?.text]);

  const ask = async (question: string) => {
    if (!question.trim() || job) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content: question.trim() }];
    setMessages(history);
    setQ('');
    try {
      const answer = await interview({ project, characterId: c.id, history });
      setMessages([...history, { role: 'assistant', content: answer.trim() }]);
    } catch (error) {
      toastError(error, '访谈中断');
    }
  };

  const keep = async (text: string) => {
    await db.characters.update(c.id, { summary: `${c.summary ? c.summary + '\n' : ''}访谈：${text}` });
    toast('已记入人物小传', { tone: 'success' });
  };

  const suggestions = ['你最想要的是什么？', '你最害怕什么？', '说一件你从没告诉别人的事。', '如果重来一次，你会怎么选？'];

  return (
    <div className="flex min-h-[calc(100vh-140px)] flex-col">
      <div className="flex-1 space-y-4 px-6 py-6">
        {!messages.length && (
          <div className="rounded-2xl border border-dashed border-line-2 p-6 text-center">
            <div className="mx-auto mb-3 w-fit">
              <Avatar c={c} size={56} />
            </div>
            <div className="font-serif text-fs-md">和{c.name}面对面</div>
            <p className="mx-auto mt-1.5 max-w-sm text-fs-xs leading-relaxed text-ink-3">AI 会以{c.name}的身份、口吻与已知信息回答。好的访谈常常能挖出你自己都没想到的动机。</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <Chip key={s} onClick={() => ask(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cx('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
            {m.role === 'assistant' && <Avatar c={c} size={32} />}
            <div className={cx('group max-w-[80%] rounded-2xl px-4 py-2.5 text-fs-base leading-7', m.role === 'user' ? 'rounded-tr-md bg-ink text-paper' : 'surface rounded-tl-md font-serif')}>
              {m.content}
              {m.role === 'assistant' && (
                <button onClick={() => keep(m.content)} className="mt-1 flex items-center gap-1 font-sans text-fs-2xs text-ink-3 opacity-60 transition group-hover:opacity-100 hover:text-seal">
                  <BookMarked className="size-3" /> 记入人物小传
                </button>
              )}
            </div>
          </motion.div>
        ))}
        {job && (
          <div className="flex gap-3">
            <Avatar c={c} size={32} />
            <div className="surface max-w-[80%] rounded-2xl rounded-tl-md px-4 py-2.5 font-serif text-fs-base leading-7">
              <span className="ink-caret">{job.text}</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur"
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`问${c.name}一个问题…`} aria-label="访谈问题" />
        <IconButton label="发送" type="submit" disabled={!q.trim() || !!job} className="bg-seal text-white hover:bg-seal-2 hover:text-white">
          <Send className="size-4" />
        </IconButton>
      </form>
    </div>
  );
}

// ─────────────────────────── 世界 ───────────────────────────

function WorldTab({ project, world }: { project: Project; world: WorldEntry[] }) {
  const add = async (category: WorldEntry['category']) => {
    await db.world.add(blankWorld(project.id, { category, name: '' }));
    await touchProject(project.id);
  };
  const used = WORLD_CATEGORIES.filter((c) => world.some((w) => w.category === c));
  const cats = used.length ? [...used, ...WORLD_CATEGORIES.filter((c) => !used.includes(c))] : [...WORLD_CATEGORIES];
  return (
    <div className="space-y-10">
      {cats.map((cat) => {
        const items = world.filter((w) => w.category === cat);
        return (
          <section key={cat}>
            <div className="mb-3 flex items-center gap-3">
              <h3 className="font-serif text-fs-lg font-semibold">{cat}</h3>
              <span className="text-fs-xs text-ink-3">{items.length}</span>
              <span className="h-px flex-1 bg-line" />
              <Button variant="ghost" size="xs" icon={<Plus className="size-3.5" />} onClick={() => add(cat)}>
                添加
              </Button>
            </div>
            {items.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((w) => (
                  <WorldCard key={w.id} w={w} />
                ))}
              </div>
            ) : (
              <p className="text-fs-xs text-ink-3">暂无{cat}条目。</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function WorldCard({ w }: { w: WorldEntry }) {
  const [d, set] = useDraft(w, (patch) => db.world.update(w.id, { ...patch, provenance: 'author' }));
  const [kw, setKw] = useState(w.keywords.join('、'));
  if (!d) return null;
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="surface group rounded-2xl p-4">
      <div className="flex items-start gap-2">
        <Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="名称" className="h-9 border-transparent bg-transparent px-2 font-serif text-fs-md font-semibold hover:border-line focus:border-line" autoFocus={!w.name} />
        <Badge tone={PROV[d.provenance].tone} className="mt-2 shrink-0">
          {d.sourceChapter ? `第${d.sourceChapter}章` : PROV[d.provenance].label}
        </Badge>
        <IconButton label="删除条目" size="sm" className="mt-1 opacity-0 group-hover:opacity-100" onClick={() => db.world.delete(w.id)}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <Textarea bare value={d.content} onChange={(e) => set({ content: e.target.value })} placeholder="写下这条设定……" minRows={2} className="mt-1 text-fs-sm leading-relaxed text-ink-2" />
      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
        <span className="shrink-0 text-fs-2xs text-ink-3">关键词</span>
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onBlur={() => set({ keywords: kw.split(/[、,，\s]+/).filter(Boolean) })}
          placeholder="细纲或上文出现这些词时，自动作为参考资料"
          className="field-bare h-7 px-2 text-fs-xs"
          aria-label="关键词"
        />
      </div>
    </motion.div>
  );
}

// ─────────────────────────── 线索 ───────────────────────────

const KINDS: ThreadKind[] = ['main', 'sub', 'mystery', 'romance', 'arc'];

function ThreadsTab({ project, threads }: { project: Project; threads: Thread[] }) {
  if (!threads.length)
    return (
      <Empty icon={<Sparkles />} title="还没有故事线" action={<Button variant="ink" onClick={() => db.threads.add(blankThread(project.id, 0, { kind: 'main', name: '主线' }))}>添加主线</Button>}>
        故事线是贯穿多章的情节脉络。在每章细纲里勾选推进的故事线，就能在「故事线」页面看到它们的分布。
      </Empty>
    );
  return (
    <div className="space-y-3">
      {threads.map((t) => (
        <ThreadRow key={t.id} t={t} />
      ))}
      <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => db.threads.add(blankThread(project.id, threads.length))}>
        添加故事线
      </Button>
    </div>
  );
}

function ThreadRow({ t }: { t: Thread }) {
  const [d, set] = useDraft(t, (patch) => db.threads.update(t.id, patch));
  if (!d) return null;
  return (
    <motion.div layout className="surface group flex gap-4 rounded-2xl p-4">
      <div className="flex flex-col items-center gap-1.5 pt-1">
        <span className="h-10 w-1.5 rounded-full" style={{ background: d.color }} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={d.name} onChange={(e) => set({ name: e.target.value })} className="h-9 w-56 border-transparent bg-transparent px-2 font-serif text-fs-md font-semibold hover:border-line focus:border-line" aria-label="故事线名称" />
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <Chip key={k} active={d.kind === k} onClick={() => set({ kind: k })} className="h-6 text-fs-2xs">
                {THREAD_KIND_LABEL[k]}
              </Chip>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {SILK.slice(0, 8).map((s) => (
              <button key={s.hex} onClick={() => set({ color: s.hex })} aria-label={`颜色：${s.name}`} className={cx('size-4 rounded-full transition-transform hover:scale-125', d.color === s.hex && 'ring-2 ring-ink/60 ring-offset-1 ring-offset-paper-2')} style={{ background: s.hex }} />
            ))}
            <IconButton label="删除故事线" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => db.threads.delete(t.id)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </div>
        <Textarea bare value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="这条故事线要回答什么问题？" minRows={1} className="text-fs-sm text-ink-2" />
        <div className="flex items-center gap-3 text-fs-xs">
          <span className="shrink-0 text-ink-3">最新进展</span>
          <input value={d.progress} onChange={(e) => set({ progress: e.target.value })} placeholder="尚未推进" className="field-bare h-7 flex-1 px-2" aria-label="最新进展" />
          <button onClick={() => set({ status: d.status === 'open' ? 'resolved' : 'open' })} className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-fs-2xs transition', d.status === 'resolved' ? 'bg-jade/15 text-jade' : 'bg-ink/[.06] text-ink-3 hover:text-ink')}>
            {d.status === 'resolved' ? '已完结' : '进行中'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────── 文风 ───────────────────────────

function StyleTab({ project }: { project: Project }) {
  const [d, set] = useDraft(project, (patch) => db.projects.update(project.id, { ...patch, updatedAt: Date.now() }));
  const job = useJob(`style:${project.id}`);
  const [newRule, setNewRule] = useState('');
  if (!d) return null;
  const s = d.style;
  const setStyle = (patch: Partial<Project['style']>) => set({ style: { ...s, ...patch } });

  const analyze = async () => {
    if (s.sample.trim().length < 80) return toast('参考片段至少需要 80 字', { tone: 'error' });
    const before = s;
    try {
      const r = await analyzeStyle(project.id, s.sample);
      setStyle({ voice: r.voice || s.voice, pov: r.pov || s.pov, tense: r.tense || s.tense, tone: r.tone || s.tone, rules: r.rules.length ? r.rules : s.rules });
      toast('文风指南已更新', { tone: 'success', action: { label: '撤销', run: () => set({ style: before }) } });
    } catch (error) {
      toastError(error, '文风分析失败');
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        {(
          [
            ['voice', '叙述声音', '例如：冷静克制的第三人称，偶有冷幽默'],
            ['pov', '视角', '例如：以林澈为主的第三人称有限视角'],
            ['tense', '语感', '例如：过去时，短句为主'],
            ['tone', '基调', '例如：阴郁、紧绷，余味悠长'],
          ] as const
        ).map(([k, label, ph]) => (
          <Field key={k} label={label}>
            <Input value={s[k]} onChange={(e) => setStyle({ [k]: e.target.value })} placeholder={ph} />
          </Field>
        ))}
        <Field group label="写作守则" hint="每条都会出现在写作提示词里">
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {s.rules.map((r, i) => (
                <motion.li key={r + i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="group flex items-start gap-2">
                  <span className="mt-3 size-1.5 shrink-0 rounded-full bg-seal" />
                  <Textarea bare minRows={1} value={r} onChange={(e) => setStyle({ rules: s.rules.map((x, j) => (j === i ? e.target.value : x)) })} className="text-fs-sm" />
                  <IconButton label="删除守则" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => setStyle({ rules: s.rules.filter((_, j) => j !== i) })}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newRule.trim()) return;
              setStyle({ rules: [...s.rules, newRule.trim()] });
              setNewRule('');
            }}
          >
            <Input value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="添加一条守则，例如：不用“仿佛”“宛如”" className="h-9" />
            <Button type="submit" size="sm" variant="soft" icon={<Plus className="size-3.5" />}>
              添加
            </Button>
          </form>
        </Field>
      </div>
      <div>
        <Field label="参考文风片段" hint="贴一段你喜欢的文字（你自己的或授权的）">
          <Textarea value={s.sample} onChange={(e) => setStyle({ sample: e.target.value })} minRows={12} placeholder="粘贴 300–3000 字……" className="font-serif text-fs-base leading-8" />
        </Field>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-fs-xs text-ink-3">{s.sample.length.toLocaleString('zh-CN')} 字 · 前 500 字会作为文风范例发给 AI</span>
          <Button variant="ink" size="sm" icon={<Wand2 className="size-4" />} onClick={analyze} loading={!!job}>
            从片段提炼文风
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── 故事 ───────────────────────────

function StoryTab({ project }: { project: Project }) {
  const [d, set] = useDraft(project, (patch) => db.projects.update(project.id, { ...patch, updatedAt: Date.now() }));
  const [tags, setTags] = useState(project.tags.join('、'));
  if (!d) return null;
  return (
    <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-5">
        <Field label="书名">
          <Input value={d.title} onChange={(e) => set({ title: e.target.value })} className="h-12 font-serif text-xl" />
        </Field>
        <Field label="一句话故事" hint="谁，想要什么，被什么阻挡">
          <Textarea value={d.logline} onChange={(e) => set({ logline: e.target.value })} className="font-serif text-fs-md" />
        </Field>
        <Field label="故事梗概">
          <Textarea value={d.premise} onChange={(e) => set({ premise: e.target.value })} minRows={5} className="font-serif text-fs-md leading-8" />
        </Field>
        <Field label="前情提要" hint="定稿后自动整理，也可以手动修改">
          <Textarea value={d.storySoFar} onChange={(e) => set({ storySoFar: e.target.value })} minRows={4} className="text-fs-sm leading-7" placeholder="定稿后，这里会自动整理出前文摘要。" />
        </Field>
      </div>
      <div className="space-y-5">
        <Field label="类型">
          <Input value={d.genre} onChange={(e) => set({ genre: e.target.value })} />
        </Field>
        <Field label="标签" hint="用顿号分隔">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => set({ tags: tags.split(/[、,，\s]+/).filter(Boolean) })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="计划章数">
            <Input type="number" min={1} max={2000} value={d.targetChapters} onChange={(e) => set({ targetChapters: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Field label="每章目标字数">
            <Input type="number" min={300} step={500} value={d.targetWords} onChange={(e) => set({ targetWords: Math.max(300, Number(e.target.value) || 3000) })} />
          </Field>
        </div>
        <div className="surface rounded-2xl p-4 text-fs-xs leading-relaxed text-ink-3">
          <div className="mb-1 font-medium text-ink-2">最初的那句灵感</div>
          <p className="font-serif text-fs-base text-ink-2">「{project.seed || '—'}」</p>
        </div>
      </div>
    </div>
  );
}
