/**
 * 章节蓝图编辑器：大纲页与写作台共用。
 * 节拍是“必须真实发生”的事件，审稿时会逐条核对。
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useDraft } from '@/hooks/useDraft';
import { db } from '@/lib/db';
import type { Blueprint, Chapter, Character, Thread } from '@/lib/types';
import { cx } from '@/lib/util';
import { Chip, Field, IconButton, Input, Textarea } from './ui';

export function BlueprintEditor({ chapter, characters, threads, compact }: { chapter: Chapter; characters: Character[]; threads: Thread[]; compact?: boolean }) {
  const [d, set] = useDraft(chapter, (patch) => db.chapters.update(chapter.id, { ...patch, updatedAt: Date.now() }));
  const [beat, setBeat] = useState('');
  if (!d) return null;
  const b = d.blueprint;
  const setB = (patch: Partial<Blueprint>) => set({ blueprint: { ...b, ...patch } });
  const toggle = (key: 'characterIds' | 'threadIds', id: string) => setB({ [key]: b[key].includes(id) ? b[key].filter((x) => x !== id) : [...b[key], id] });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= b.beats.length) return;
    const beats = [...b.beats];
    [beats[i], beats[j]] = [beats[j], beats[i]];
    setB({ beats });
  };

  return (
    <div className={cx('grid gap-5', !compact && 'lg:grid-cols-[1.25fr_1fr]')}>
      <div className="space-y-4">
        <div className={cx('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-[1.4fr_1fr]')}>
          <Field label="章节名">
            <Input value={d.title} onChange={(e) => set({ title: e.target.value })} className="font-serif text-fs-md" />
          </Field>
          <Field label="所属卷 / 幕">
            <Input value={d.act} onChange={(e) => set({ act: e.target.value })} placeholder="第一卷 · 起" />
          </Field>
        </div>
        <Field label="本章目标" hint="这一章结束时，什么必须改变？">
          <Textarea value={b.goal} onChange={(e) => setB({ goal: e.target.value })} minRows={2} />
        </Field>
        <Field group label="情节点" hint="按顺序发生，审稿时逐条核对">
          <ol className="space-y-1.5">
            <AnimatePresence initial={false}>
              {b.beats.map((x, i) => (
                <motion.li key={i} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="group flex items-start gap-2 rounded-xl border border-line bg-paper-2/60 py-1 pr-1 pl-2">
                  <span className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-seal/10 font-serif text-fs-2xs text-seal">{i + 1}</span>
                  <Textarea bare minRows={1} value={x} onChange={(e) => setB({ beats: b.beats.map((y, j) => (j === i ? e.target.value : y)) })} className="text-fs-sm leading-relaxed" aria-label={`情节点 ${i + 1}`} />
                  <div className="flex shrink-0 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton label="上移" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp className="size-3.5" />
                    </IconButton>
                    <IconButton label="下移" size="sm" onClick={() => move(i, 1)} disabled={i === b.beats.length - 1}>
                      <ArrowDown className="size-3.5" />
                    </IconButton>
                    <IconButton label="删除情节点" size="sm" onClick={() => setB({ beats: b.beats.filter((_, j) => j !== i) })}>
                      <X className="size-3.5" />
                    </IconButton>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!beat.trim()) return;
              setB({ beats: [...b.beats, beat.trim()] });
              setBeat('');
            }}
          >
            <Input value={beat} onChange={(e) => setBeat(e.target.value)} placeholder="添加一个具体的事件……" className="h-9 text-fs-sm" aria-label="新情节点" />
            <IconButton label="添加情节点" type="submit" className="border border-line">
              <Plus className="size-4" />
            </IconButton>
          </form>
        </Field>
        <Field label="章末悬念">
          <Textarea value={b.hook} onChange={(e) => setB({ hook: e.target.value })} minRows={1} placeholder="让读者翻到下一章的那个画面" />
        </Field>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="视角人物">
            <Input value={b.pov} onChange={(e) => setB({ pov: e.target.value })} list={`pov-${chapter.id}`} />
            <datalist id={`pov-${chapter.id}`}>
              {characters.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
          <Field label="场景">
            <Input value={b.location} onChange={(e) => setB({ location: e.target.value })} />
          </Field>
        </div>
        <Field group label="出场人物" hint="写作时会作为参考资料">
          <div className="flex flex-wrap gap-1.5">
            {characters.map((c) => (
              <Chip key={c.id} color={c.color} active={b.characterIds.includes(c.id)} onClick={() => toggle('characterIds', c.id)}>
                {c.name}
              </Chip>
            ))}
            {!characters.length && <span className="text-fs-xs text-ink-3">设定集里还没有人物</span>}
          </div>
        </Field>
        <Field group label="推进的故事线" hint="故事线页面据此绘制">
          <div className="flex flex-wrap gap-1.5">
            {threads.map((t) => (
              <Chip key={t.id} color={t.color} active={b.threadIds.includes(t.id)} onClick={() => toggle('threadIds', t.id)}>
                {t.name}
              </Chip>
            ))}
            {!threads.length && <span className="text-fs-xs text-ink-3">设定集里还没有故事线</span>}
          </div>
        </Field>
        <Field label="作者备注" hint="只给 AI 看的悄悄话">
          <Textarea value={b.notes} onChange={(e) => setB({ notes: e.target.value })} minRows={2} placeholder="例如：这一章节奏放慢，多写雾；不要让沈雾解释太多。" />
        </Field>
      </div>
    </div>
  );
}
