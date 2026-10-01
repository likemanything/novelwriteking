/**
 * 稿纸编辑器（CodeMirror 6）。
 *
 * 能力：
 * - 流式写入：AI 起草时正文一字一字“落”在纸上，末尾有一枚呼吸的朱砂点；
 * - 幽灵续写：⌘J 在光标处浮出淡墨色的续写，Tab 接受、Esc 放弃、继续打字即消散；
 * - 引文闪现：审稿意见里的引文可以一键定位，并在原文上晕开一层朱砂；
 * - 打字机模式：光标所在行始终保持在视线中央。
 */
import { Annotation, Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, drawSelection, highlightActiveLine, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cx } from '@/lib/util';

/** 程序写入（加载文档、流式写入）带此标记，不触发自动保存。 */
const External = Annotation.define<boolean>();

// ── 幽灵续写 ──
interface Ghost {
  pos: number;
  text: string;
  done: boolean;
}
const setGhostEffect = StateEffect.define<Ghost | null>();

class GhostWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly done: boolean,
  ) {
    super();
  }
  eq(o: GhostWidget) {
    return o.text === this.text && o.done === this.done;
  }
  toDOM() {
    const wrap = document.createElement('span');
    const t = document.createElement('span');
    t.className = 'cm-ghost';
    t.textContent = this.text || '…';
    wrap.appendChild(t);
    const hint = document.createElement('span');
    hint.className = 'cm-ghost-hint';
    hint.textContent = this.done ? 'Tab 接受 · Esc 放弃' : '续写中…';
    wrap.appendChild(hint);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhostEffect)) return e.value;
    if (value && tr.docChanged) return null;
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (g) => (g ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text, g.done), side: 1 }).range(g.pos)]) : Decoration.none)),
});

// ── 引文闪现 ──
const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setFlash)) deco = e.value ? Decoration.set([Decoration.mark({ class: 'cm-flash' }).range(e.value.from, e.value.to)]) : Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── 流式写入的朱砂点 ──
const setStreamingEffect = StateEffect.define<boolean>();
class CaretWidget extends WidgetType {
  toDOM() {
    const s = document.createElement('span');
    s.className = 'ink-caret';
    return s;
  }
}
const streamingField = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setStreamingEffect)) return e.value;
    return v;
  },
  provide: (f) => EditorView.decorations.compute([f, 'doc'], (s) => (s.field(f) ? Decoration.set([Decoration.widget({ widget: new CaretWidget(), side: 1 }).range(s.doc.length)]) : Decoration.none)),
});

export interface SelectionInfo {
  from: number;
  to: number;
  text: string;
  rect: { left: number; right: number; top: number; bottom: number };
}

export interface EditorHandle {
  getText: () => string;
  setDoc: (text: string) => void;
  streamTo: (text: string) => void;
  replace: (from: number, to: number, text: string) => void;
  flash: (quote: string) => boolean;
  setGhost: (g: Ghost | null) => void;
  cursor: () => number;
  focus: () => void;
}

interface Props {
  initialDoc: string;
  readOnly: boolean;
  streaming: boolean;
  fontSize: number;
  typewriter: boolean;
  dim: boolean;
  placeholderText: string;
  onChange: (text: string) => void;
  onSelection: (s: SelectionInfo | null) => void;
  onContinue: () => void;
  onGhostDismiss: () => void;
  onSave: () => void;
  className?: string;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const readOnlyComp = useRef(new Compartment());
  const placeholderComp = useRef(new Compartment());

  useEffect(() => {
    let selTimer: ReturnType<typeof setTimeout> | undefined;
    const reportSelection = (view: EditorView) => {
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = view.state.selection.main;
        if (sel.empty || !view.hasFocus) return cb.current.onSelection(null);
        const a = view.coordsAtPos(sel.from);
        const b = view.coordsAtPos(sel.to);
        if (!a || !b) return cb.current.onSelection(null);
        cb.current.onSelection({
          from: sel.from,
          to: sel.to,
          text: view.state.sliceDoc(sel.from, sel.to),
          rect: { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) },
        });
      }, 160);
    };

    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.initialDoc,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          ghostField,
          flashField,
          streamingField,
          readOnlyComp.current.of(EditorState.readOnly.of(props.readOnly)),
          placeholderComp.current.of(placeholder(props.placeholderText)),
          EditorView.contentAttributes.of({ 'aria-label': '正文', spellcheck: 'false', lang: 'zh-CN' }),
          Prec.highest(
            keymap.of([
              {
                key: 'Tab',
                run: (v) => {
                  const g = v.state.field(ghostField);
                  if (!g || !g.done || !g.text) return false;
                  v.dispatch({ changes: { from: g.pos, insert: g.text }, selection: EditorSelection.cursor(g.pos + g.text.length), effects: setGhostEffect.of(null), userEvent: 'input.ghost' });
                  return true;
                },
              },
              {
                key: 'Escape',
                run: (v) => {
                  if (!v.state.field(ghostField)) return false;
                  v.dispatch({ effects: setGhostEffect.of(null) });
                  cb.current.onGhostDismiss();
                  return true;
                },
              },
              { key: 'Mod-j', preventDefault: true, run: () => (cb.current.onContinue(), true) },
              { key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave(), true) },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            const hadGhost = u.startState.field(ghostField);
            const hasGhost = u.state.field(ghostField);
            if (hadGhost && !hasGhost && u.docChanged && !u.transactions.some((t) => t.isUserEvent('input.ghost'))) cb.current.onGhostDismiss();
            if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) cb.current.onChange(u.state.doc.toString());
            if (u.selectionSet || u.focusChanged) reportSelection(u.view);
            if (cb.current.typewriter && u.docChanged && u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete'))) {
              const head = u.state.selection.main.head;
              requestAnimationFrame(() => u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) }));
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    const onScroll = () => {
      if (!view.state.selection.main.empty) reportSelection(view);
    };
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(selTimer);
      view.scrollDOM.removeEventListener('scroll', onScroll);
      view.destroy();
      viewRef.current = null;
    };
    // 只在挂载时创建；之后通过 handle 与 effect 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyComp.current.reconfigure(EditorState.readOnly.of(props.readOnly || props.streaming)) });
  }, [props.readOnly, props.streaming]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: placeholderComp.current.reconfigure(placeholder(props.placeholderText)) });
  }, [props.placeholderText]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({ effects: setStreamingEffect.of(props.streaming) });
  }, [props.streaming]);

  useImperativeHandle(
    ref,
    (): EditorHandle => ({
      getText: () => viewRef.current?.state.doc.toString() ?? '',
      setDoc: (text) => {
        const v = viewRef.current;
        if (!v || v.state.doc.toString() === text) return;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: External.of(true), selection: EditorSelection.cursor(Math.min(v.state.selection.main.head, text.length)) });
      },
      streamTo: (text) => {
        const v = viewRef.current;
        if (!v) return;
        const cur = v.state.doc.toString();
        if (cur === text) return;
        // 常见情况：新文本以旧文本为前缀，只追加差量
        const changes = text.startsWith(cur) ? { from: cur.length, insert: text.slice(cur.length) } : { from: 0, to: cur.length, insert: text };
        v.dispatch({ changes, annotations: External.of(true), effects: EditorView.scrollIntoView(text.length, { y: 'end', yMargin: 160 }) });
      },
      replace: (from, to, text) => {
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.range(from, from + text.length), userEvent: 'input.muse', scrollIntoView: true });
        v.focus();
      },
      flash: (quote) => {
        const v = viewRef.current;
        if (!v || !quote.trim()) return false;
        const doc = v.state.doc.toString();
        let from = doc.indexOf(quote);
        let len = quote.length;
        if (from < 0) {
          // 模型引文常有细微出入：退而求其次匹配前 10 个字
          const head = quote.replace(/^[“"「]/, '').slice(0, 10);
          from = doc.indexOf(head);
          len = head.length;
        }
        if (from < 0) return false;
        v.dispatch({ effects: [setFlash.of({ from, to: from + len }), EditorView.scrollIntoView(from, { y: 'center' })] });
        setTimeout(() => viewRef.current?.dispatch({ effects: setFlash.of(null) }), 2600);
        return true;
      },
      setGhost: (g) => viewRef.current?.dispatch({ effects: setGhostEffect.of(g) }),
      cursor: () => viewRef.current?.state.selection.main.head ?? 0,
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  return <div ref={host} className={cx('manuscript h-full', props.dim && 'focus-dim', props.className)} style={{ ['--ms-size' as string]: `${props.fontSize}px` }} />;
});
