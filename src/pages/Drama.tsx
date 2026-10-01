/**
 * 短剧画布：把这部小说一键铺成「拆解 → 大纲 → 每集（剧本 → 分镜）」的流水线。
 * 节点由服务端在后台运行；改动上游，下游自动标记为「已过期」，只重算变化的部分。
 */
import '@xyflow/react/dist/style.css';
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow, type Edge, type Node } from '@xyflow/react';
import { AlertTriangle, ArrowRight, ChevronDown, Clapperboard, Download, LayoutGrid, MoreHorizontal, Play, Square, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useStageProfile } from '@/cloud/models';
import { useCaps } from '@/cloud/session';
import { dramaApi, useDramaProject } from '@/cloud/drama';
import { useIsDark } from '@/components/ThemeToggle';
import { Button, ConfirmDialog, Field, Input, Menu, Segmented, Textarea } from '@/components/ui';
import { useCurrentProject } from '@/hooks/data';
import { db } from '@/lib/db';
import { cx, downloadFile } from '@/lib/util';
import { DEFAULT_PRESET, GENRES, type DramaPreset, type DramaProjectDTO } from '@/shared/drama';
import { toast, toastError } from '@/store/ui';
import { Inspector } from '@/drama/Inspector';
import { DramaCtx, nodeTypes, type DramaCtxValue, type FlowNodeData } from '@/drama/nodes';

const STEPS = ['故事拆解', '分集大纲', '单集剧本', '分镜脚本'];

function CreateCanvas({ chapterCount, onCreate }: { chapterCount: number; onCreate: (p: Partial<DramaPreset>) => Promise<void> }) {
  const [p, setP] = useState<DramaPreset>({ ...DEFAULT_PRESET, chapterTo: chapterCount, episodes: Math.min(40, Math.max(8, chapterCount * 2)) });
  const [busy, setBusy] = useState(false);
  const num = (k: 'chapterFrom' | 'chapterTo' | 'episodes' | 'episodeSeconds', min: number, max: number) => (
    <Input type="number" min={min} max={max} value={p[k]} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />
  );
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pt-12 pb-24">
        <div className="mb-1 text-[11px] tracking-[.3em] text-seal">短剧</div>
        <h1 className="font-serif text-[28px] font-semibold">把这部小说，改成一部短剧</h1>
        <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-2">选好范围和剧型，墨织会铺开一条完整的改编流水线。每一步都可以看、可以改、可以重跑；剧本里的每场戏都能追溯到小说原文。</p>

        <ol className="mt-8 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="rounded-full bg-seal/10 px-3 py-1 text-seal">{s}</span>
              {i < STEPS.length - 1 && <ArrowRight className="size-3.5 text-ink-3" />}
            </li>
          ))}
          <li className="text-ink-3">· 图像与视频生成即将开放</li>
        </ol>

        <div className="surface mt-8 grid gap-5 rounded-3xl p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="从第几章">{num('chapterFrom', 1, chapterCount)}</Field>
            <Field label="到第几章" hint={`共 ${chapterCount} 章`}>{num('chapterTo', 1, chapterCount)}</Field>
            <Field label="集数">{num('episodes', 1, 80)}</Field>
            <Field label="每集秒数">{num('episodeSeconds', 30, 180)}</Field>
          </div>
          <Field label="画幅" group>
            <Segmented size="sm" value={p.ratio} onChange={(v) => setP({ ...p, ratio: v })} options={[{ value: '9:16', label: '竖屏 9:16' }, { value: '16:9', label: '横屏 16:9' }]} />
          </Field>
          <Field label="剧型" hint={GENRES.find((g) => g.value === p.genre)?.hint}>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map((g) => (
                <button key={g.value} type="button" onClick={() => setP({ ...p, genre: g.value })} className={cx('rounded-full border px-3.5 py-1.5 text-[12.5px] transition', p.genre === g.value ? 'border-seal/50 bg-seal/[.07] text-seal' : 'border-line text-ink-2 hover:border-line-2')}>
                  {g.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="画风与补充要求" hint="例如：国风水墨动画、都市职场写实、冷色调。会写进每个分镜的画面描述">
            <Textarea value={p.style} onChange={(e) => setP({ ...p, style: e.target.value })} minRows={2} />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="seal"
              size="lg"
              loading={busy}
              icon={<Clapperboard className="size-4" />}
              onClick={async () => {
                setBusy(true);
                try {
                  await onCreate(p);
                } finally {
                  setBusy(false);
                }
              }}
            >
              生成画布
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function layoutOf(project: DramaProjectDTO) {
  const COL = { source: 0, breakdown: 400, outline: 800, script: 1240, storyboard: 1680 } as const;
  return project.nodes.map((n) => ({ id: n.id, x: COL[n.type], y: n.type === 'script' || n.type === 'storyboard' ? (Number(n.params.episode) - 1) * 320 : 0 }));
}

function Canvas({ project, setProject }: { project: DramaProjectDTO; setProject: (p: DramaProjectDTO) => void }) {
  const novel = useCurrentProject();
  const caps = useCaps(novel.id);
  const dark = useIsDark();
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(novel.id).toArray(), [novel.id]) ?? [];
  const chapterIds = useMemo(() => Object.fromEntries(chapters.map((c) => [c.index, c.id])), [chapters]);
  const plan = useStageProfile('plan');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 一开始就带着节点挂载，这样 ReactFlow 自己会等测量完成再取景
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>(
    project.nodes.map((n) => ({ id: n.id, type: 'drama', position: { x: n.x, y: n.y }, data: { node: n } satisfies FlowNodeData })),
  );
  const initialRow = useRef(
    project.nodes.filter((n) => n.type === 'source' || n.type === 'breakdown' || n.type === 'outline' || Number(n.params.episode) === 1).map((n) => ({ id: n.id })),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { fitBounds } = useReactFlow();
  const fittedFor = useRef(project.nodes.length);
  const measured = useNodesInitialized();
  // 画布的缩放/平移控制器就绪之后才能取景（早了会被它的初始视口覆盖）
  const [ready, setReady] = useState(false);

  // 服务端数据变化时刷新节点，但保留用户拖动过的位置
  useEffect(() => {
    setFlowNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return project.nodes.map((n) => {
        const cur = old.get(n.id);
        // 沿用已有节点对象（保留测量到的尺寸与用户拖动的位置），只更新内容与选中状态
        return cur
          ? { ...cur, data: { node: n } satisfies FlowNodeData, selected: n.id === selectedId }
          : { id: n.id, type: 'drama', position: { x: n.x, y: n.y }, data: { node: n } satisfies FlowNodeData, selected: n.id === selectedId };
      });
    });
  }, [project.nodes, selectedId, setFlowNodes]);

  // 取景：框住「小说 → 拆解 → 大纲 → 第 1 集剧本 → 分镜」这一整行，其余的集在下方，可以拖动或用小地图浏览
  const fitFirstRow = useCallback(() => {
    const row = project.nodes.filter((n) => n.type === 'source' || n.type === 'breakdown' || n.type === 'outline' || Number(n.params.episode) === 1);
    if (!row.length) return;
    const x1 = Math.min(...row.map((n) => n.x));
    const y1 = Math.min(...row.map((n) => n.y));
    const x2 = Math.max(...row.map((n) => n.x)) + 300;
    const y2 = Math.max(...row.map((n) => n.y)) + 190;
    void fitBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, { padding: 0.12 });
  }, [project.nodes, fitBounds]);
  // 首次载入、以及大纲展开成各集（节点数量变化）时取景
  useEffect(() => {
    if (!ready || !measured || flowNodes.length === 0 || flowNodes.length === fittedFor.current) return;
    const t = setTimeout(() => {
      fittedFor.current = flowNodes.length;
      fitFirstRow();
    }, 120);
    return () => clearTimeout(t);
  }, [ready, measured, flowNodes.length, fitFirstRow]);

  const edges: Edge[] = useMemo(() => {
    const status = new Map(project.nodes.map((n) => [n.id, n.status]));
    return project.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, type: 'smoothstep', animated: status.get(e.to) === 'running', style: { stroke: 'var(--line-2)', strokeWidth: 1.6 } }));
  }, [project.edges, project.nodes]);

  const patch = useCallback((dto: DramaProjectDTO) => setProject(dto), [setProject]);

  const run = useCallback(
    async (id: string) => {
      setProject({ ...project, nodes: project.nodes.map((n) => (n.id === id ? { ...n, status: 'running', error: null } : n)) });
      try {
        await dramaApi.runNode(id);
      } catch (e) {
        toastError(e, '无法运行');
        const r = await dramaApi.get(novel.id);
        if (r.project) patch(r.project);
      }
    },
    [project, setProject, novel.id, patch],
  );

  const ctx: DramaCtxValue = useMemo(
    () => ({ canWrite: caps.write, preset: project.preset, onRun: run, onCancel: (id) => void dramaApi.cancelNode(id).catch((e) => toastError(e)) }),
    [caps.write, project.preset, run],
  );

  const runnable = project.nodes.filter((n) => n.type !== 'source');
  const fresh = runnable.filter((n) => n.status === 'done' && !n.stale).length;
  const running = runnable.some((n) => n.status === 'running');
  const failed = runnable.filter((n) => n.status === 'failed').length;
  const stale = runnable.filter((n) => n.stale).length;
  const selected = project.nodes.find((n) => n.id === selectedId) ?? null;

  const persistLayout = (nodes: { id: string; position: { x: number; y: number } }[]) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void dramaApi.layout(project.id, nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))).catch(() => {}), 400);
  };

  const exportAs = async (format: 'md' | 'csv') => {
    try {
      const f = await dramaApi.export(project.id, format);
      downloadFile(f.filename, f.content, f.mime);
    } catch (e) {
      toastError(e, '导出失败');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <Clapperboard className="size-[18px] text-seal" strokeWidth={1.8} />
        <h1 className="font-serif text-[17px] font-semibold">短剧画布</h1>
        <span className="text-[12px] text-ink-3">
          {project.preset.episodes} 集 · {project.preset.episodeSeconds} 秒 · {project.preset.ratio} · 已完成 {fresh}/{runnable.length}
          {stale > 0 && <span className="text-gold"> · {stale} 个已过期</span>}
          {failed > 0 && <span className="text-seal"> · {failed} 个失败</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {caps.write &&
            (running ? (
              <Button variant="outline" size="sm" icon={<Square className="size-3 fill-current" />} onClick={() => void dramaApi.cancel(project.id).catch((e) => toastError(e))}>
                停止
              </Button>
            ) : (
              <Button
                variant="seal"
                size="sm"
                disabled={runnable.length > 0 && fresh === runnable.length}
                title={runnable.length > 0 && fresh === runnable.length ? '所有节点都是最新的' : undefined}
                icon={<Play className="size-3.5 fill-current" />}
                onClick={async () => {
                  try {
                    await dramaApi.runAll(project.id);
                    toast('已开始运行', { detail: '没跑过或已过期的节点会按依赖顺序依次生成，可以随时离开。' });
                  } catch (e) {
                    toastError(e, '无法运行');
                  }
                }}
              >
                {fresh === 0 ? '一键运行' : '继续运行'}
              </Button>
            ))}
          <Menu
            trigger={(p) => (
              <Button {...p} variant="outline" size="sm" icon={<Download className="size-3.5" />}>
                导出 <ChevronDown className="size-3" />
              </Button>
            )}
            items={[
              { label: '剧本与分镜（Markdown）', icon: <Download />, onClick: () => void exportAs('md') },
              { label: '分镜表（CSV，可用 Excel 打开）', icon: <Download />, onClick: () => void exportAs('csv') },
            ]}
          />
          <Menu
            trigger={(p) => (
              <Button {...p} variant="ghost" size="sm" aria-label="更多">
                <MoreHorizontal className="size-4" />
              </Button>
            )}
            items={[
              {
                label: '重新排版',
                icon: <LayoutGrid />,
                onClick: () => {
                  const l = layoutOf(project);
                  setFlowNodes((prev) => prev.map((n) => ({ ...n, position: l.find((x) => x.id === n.id) ?? n.position })) as Node[]);
                  if (caps.write) void dramaApi.layout(project.id, l).catch(() => {});
                },
              },
              ...(caps.manageProjects ? [{ label: '删除这张画布', icon: <Trash2 />, danger: true, divider: true, onClick: () => setConfirmDelete(true) }] : []),
            ]}
          />
        </div>
      </header>

      {plan.provider === 'demo' && (
        <div className="flex items-center gap-2 border-b border-gold/30 bg-gold/10 px-5 py-2 text-[12.5px] text-ink-2" role="status">
          <AlertTriangle className="size-4 shrink-0 text-gold" />
          还没有为「构思」环节接入模型，节点无法运行。
          <Link to="/settings" className="text-seal underline-offset-2 hover:underline">
            去接入 DeepSeek 等模型
          </Link>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <DramaCtx.Provider value={ctx}>
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onInit={() => setReady(true)}
            fitView
            fitViewOptions={{ nodes: initialRow.current, padding: 0.12, maxZoom: 0.9 }}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodeDragStop={(_, __, nodes) => caps.write && persistLayout(nodes)}
            nodesConnectable={false}
            nodesDraggable={caps.write}
            colorMode={dark ? 'dark' : 'light'}
            minZoom={0.1}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--line-2)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              style={{ right: selected ? 470 : 12, backgroundColor: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 12 }}
              maskColor="rgb(120 110 95 / .12)"
              nodeColor={(n) => {
                const st = (n.data as FlowNodeData).node;
                return st.status === 'failed' ? '#c0392b' : st.stale ? '#c9a227' : st.status === 'done' ? '#5f8f6b' : '#b8b0a0';
              }}
            />
          </ReactFlow>
        </DramaCtx.Provider>
        {selected && (
          <Inspector
            node={selected}
            novelId={novel.id}
            preset={project.preset}
            chapterCount={project.chapterCount}
            chapterIds={chapterIds}
            canWrite={caps.write}
            onClose={() => setSelectedId(null)}
            onSaveOutput={async (output) => {
              try {
                patch((await dramaApi.patchNode(selected.id, { output })).project);
                toast('已保存', { tone: 'success', detail: '依赖它的下游节点已标记为过期。' });
              } catch (e) {
                toastError(e, '保存失败');
              }
            }}
            onApprove={async (approved) => {
              try {
                patch((await dramaApi.patchNode(selected.id, { approved })).project);
              } catch (e) {
                toastError(e);
              }
            }}
            onSavePreset={async (preset) => {
              try {
                patch((await dramaApi.setPreset(project.id, preset)).project);
                toast('设定已保存', { tone: 'success' });
              } catch (e) {
                toastError(e, '保存失败');
              }
            }}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除这张短剧画布？"
        body="所有已生成的拆解、大纲、剧本与分镜都会被删除，小说本身不受影响。"
        confirmLabel="删除"
        danger
        onResolve={async (ok) => {
          setConfirmDelete(false);
          if (!ok) return;
          try {
            await dramaApi.remove(project.id);
            location.reload();
          } catch (e) {
            toastError(e, '删除失败');
          }
        }}
      />
    </div>
  );
}

export default function Drama() {
  const novel = useCurrentProject();
  const caps = useCaps(novel.id);
  const { project, setProject } = useDramaProject(novel.id);
  const chapterCount = useLiveQuery(() => db.chapters.where('projectId').equals(novel.id).count(), [novel.id]) ?? 0;

  if (project === undefined) return <div className="flex h-full items-center justify-center text-[13px] text-ink-3">正在加载……</div>;
  if (project === null) {
    if (!caps.write) return <div className="flex h-full items-center justify-center text-[13px] text-ink-3">还没有人为这部小说创建短剧画布。</div>;
    if (chapterCount === 0) return <div className="flex h-full items-center justify-center text-[13px] text-ink-3">这部小说还没有章节，先写几章再来改编。</div>;
    return <CreateCanvas chapterCount={chapterCount} onCreate={async (preset) => setProject((await dramaApi.create(novel.id, preset)).project)} />;
  }
  return (
    <ReactFlowProvider>
      <Canvas project={project} setProject={(p) => setProject(p)} />
    </ReactFlowProvider>
  );
}

