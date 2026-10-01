# 墨织 Inkloom · AI 协作指南

> 给所有参与开发的 AI（Claude Code、Cursor、Copilot 等）和人类。**动手之前先读完本文件**；细节在 `docs/` 里。
> 规则有冲突时：安全规则 > 本文件 > `docs/` > 你的习惯。

## 1. 这是什么

团队协作的 AI 长篇小说创作平台，并能把小说改编成短剧（无限画布流水线）。

- **前端**：React 19 + React Router 7 + Tailwind 4 + Motion + CodeMirror 6 + React Flow；浏览器里有一份 IndexedDB（Dexie）离线副本，增量同步到服务端。
- **后端**：Node 22 + Hono + Postgres（行级安全）；模型密钥只在服务端，所有模型请求经「AI 网关」。
- **语言**：界面文案、提示词、注释、提交信息用**中文**；标识符用英文。
- 产品与设计背景：`README.md`、`docs/drama-canvas-design.md`、`docs/design-system.md`。

## 2. 常用命令

```bash
npm run setup          # 首次：生成 .env、启动开发库、迁移
npm run dev            # 接口 4318 + 前端 5173（http://127.0.0.1:5173）
npm run check          # 提交前必跑：类型检查 + 设计守门 + 密钥扫描 + 全部测试
npm run typecheck      # tsc -p .
npm run check:design   # 禁止零散字号（见 §6）
npm run check:secrets  # 扫描被跟踪文件里的疑似密钥（见 §4）
npm test               # test:ai（纯逻辑）+ test:api（真实 Postgres）
npm run build          # tsc + vite build
npm run admin -- code 5 1 备注   # 生成内测邀请码（其它见 server/cli.ts）
```

`test:api` 用独立库 `inkloom_test`，每次**删库重建并重跑全部迁移**；需要先 `npm run db:start`。

## 3. 目录地图

```
server/        Hono 接口：auth 登录 · orgs 团队与邀请 · sync 同步与章节锁 · ai 模型网关 · drama 短剧引擎
               media 媒体服务与文件 · admin 邀请码 · realtime SSE · db/migrations 迁移 · lib 基础库
server/media/  engine.ts 声明式通用媒体适配器（图像 / 视频 / 配音）
src/shared/    前后端共用：permissions 权限规则 · api 接口类型 · drama · media（不得依赖 DOM 或服务端）
src/cloud/     浏览器端：api 请求 · session 登录与团队 · sync 同步引擎 · locks 章节锁 · models / providers 配置
src/ai/        写作智能：prompts 提示词 · tasks 高层任务 · lens 资料装配 · verify 审稿核验 · lint 文字体检
               inspiration 随机灵感 · providers/client 流式调用 · detect 协议识别 · demo 离线引擎
src/lib/       db 本地库 · repo 写入 · types 领域模型 · export / importText · sample 示例作品 · util
src/pages/     路由页面（Landing Login Invite Library Genesis Overview Bible Outline Studio Loom Inbox Drama Settings Team）
src/components/ UI 基元（ui.tsx）与通用组件；src/studio 写作台；src/drama 画布节点与检查器
src/styles.css 设计令牌与全局样式（唯一来源）
tests/         ai.test.ts（纯逻辑）· api.test.ts（接口集成）
docs/          设计与架构文档
```

## 4. 必须遵守的硬规则

### 安全与密钥
1. **绝不把任何 API Key、令牌写进代码、文档、测试、提交信息或日志。** 用户在对话里给你的 Key 也是——让用户自己在「设置 → 接入模型」里填。
2. `.env`、`.dev/`、`data/` 已在 `.gitignore`；不要改这一点，不要 `git add -f`。
3. 模型 / 媒体服务的外呼一律用 `safeFetch`（`server/lib/safefetch.ts`），它拦截内网与云元数据地址。
4. 密钥用 `sealSecret/openSecret`（`server/lib/crypto.ts`）加密保存，**永远不返回浏览器**；接口只给 `keyHint`。
5. 浏览器**不直接**调用模型服务商，一律走 `/api/ai/*` 或 `streamChat`。

### 多租户与权限
6. 租户表（带 `org_id`）开启并强制行级安全；读写必须在 `withTenant(orgId, …)` 里进行。新建租户表时，迁移里要把表名加入 RLS 循环（参考 `002_drama.sql`），并有 `org_id … on delete cascade`。
7. 权限规则**只有一份**：`src/shared/permissions.ts`。前端用它隐藏 / 禁用，服务端用它裁决。不要在页面或路由里手写角色判断。
8. 新增接口的检查清单：`requireOrg` → 用 `roleInProject` / `atLeast` / `requireOrgRole` 校验 → `limit()` 限频（有成本或易被滥用时）→ 变更要 `audit()` → 需要实时刷新时 `notifyOrg` → 错误一律抛 `HttpError`（`badRequest/forbidden/notFound/conflict`）。**每个接口都要在 `tests/api.test.ts` 里有测试**，至少覆盖：越权、跨租户、正常路径。

### 数据库
9. 迁移**只增不改**：`server/db/migrations/00N_*.sql` 顺序编号；已经执行过的文件不要再编辑，要改就新增一个。
10. 同步的写作数据表名固定在 `SYNC_TABLES`；新增同步表要同时改前后端，并在 `tests/api.test.ts` 的同步用例里覆盖。

### 实时事件
11. 新增事件类型要改三处：`server/realtime.ts` 的 `OrgEvent`、`src/cloud/sync.ts` 的 `ServerEvent`、同文件里转发事件的那个数组。

## 5. 写 AI 功能的规则（最容易出错的地方）

1. **提示词全部集中在 `src/ai/prompts.ts`（写作）和 `server/drama-prompts.ts`（短剧）。** 不要把提示词散写在组件里。
2. **带「思考」的模型会把输出额度花在思考上。** 结构化输出给足额度（现行：开书 12000、大纲 16000、审稿 10000），必须走 `tasks.ts` 的 `call()`：它会在截断时加倍重试（JSON）或自动续写（正文），并在额度被思考耗尽时重试。不要绕过它直接 `streamChat` 而不处理截断。
3. **解析 JSON 一律用 `extractJson`**（`src/lib/util.ts`）；允许部分结果时加 `{ salvage: true }`。不要自己写正则或 `JSON.parse(raw)`。
4. **不要相信模型的「证据」**：模型给出的引文、「已完成」判断、冲突说明，都要用 `src/ai/verify.ts` 在原文里核对后才能展示。新增类似的模型判断，同样要有程序核验和测试。
5. **连续性台账**（`Chapter.digest`）：每章「摘要 + 原子事实」，写下一章与审稿时都对照它。与前文矛盾的内容**不入账**，由作者确认后才能入账（`acknowledgeConflict`）。不要让模型的输出不经核对就写进台账 / 设定集。
6. **改提示词要用真实模型 A/B 验证**，不要凭感觉。现成的度量：`lintProse`（比喻密度、套话）、字数、是否按细纲结尾。详见 `docs/ai-writing-guide.md`。
7. 离线演示引擎（`src/ai/demo.ts`）只在浏览器里；服务端任务（短剧画布）没有演示引擎，没接模型时要给出明确提示。
8. 每个模型调用都要记用量：写作走网关自动记；服务端任务用 `runTextModel`（`usageStage` 区分用途）；媒体用 `generateMedia`。

## 6. 前端与设计规则

设计体系「墨玉鎏金」的完整规范在 **`docs/design-system.md`**，以下是必须遵守的要点：

1. **只用令牌，不写死值。** 颜色用语义类（`bg-paper`、`text-ink-2`、`text-seal`、`border-line`…）或 CSS 变量；不要在组件里写十六进制色（封面、图表等数据驱动的颜色除外）。
2. **字号只能用 `text-fs-2xs|xs|sm|base|md|lg|xl|2xl`。** 不要写 `text-[13px]`。`npm run check:design` 会拦截。
3. **次级文字对比度 ≥ 4.5:1**：辅助文字用 `text-ink-3`（已校准），不要再自己调淡。
4. **层次靠光不靠线**：卡片用 `.surface`，浮层 / 顶栏 / 侧栏用 `.glass`，弹层用 `gborder` + `--elev-3`；阴影用 `--elev-*`，不要自造。
5. **新基元放进 `src/components/ui.tsx`**，不要在页面里复制一份按钮 / 输入框的样式。主行动用 `Button variant="seal"`，一个视图里最多一个。
6. 所有动效尊重 `prefers-reduced-motion` 与设置里的「减少动态效果」；时长 / 缓动用 `--dur-*`、`--ease-silk`。
7. 日间 / 夜间两套都要看过；窄屏（≈ 360–530px）不得出现横向滚动；图标按钮必须有 `aria-label`。
8. UI 改动完成的标准：**日间、夜间、窄屏各截一张图自己看过**，而不是只通过类型检查。

### React / 状态的已知陷阱
- **zustand 选择器必须返回稳定引用**：不要在选择器里 `.filter/.map` 出新数组（会无限重渲染，报 `Maximum update depth exceeded`）。先选原始数据，再用 `useMemo` 派生。
- **会话启动只能用 `ensureSession()`**（`src/cloud/session.ts`），标志与会话状态在同一模块里，热更新时一起重置。
- **React Flow**：更新节点时沿用已有节点对象（保留测量尺寸与用户拖动的位置），只换 `data`；首次取景用 `fitView` 属性，不要在 effect 里手动 `fitView`（会被初始视口覆盖）。
- 本地库 `db` 在登录并打开工作区之前会抛错；只在 `Gate` 内的页面使用。

## 7. 环境与工具链的坑

- **改前端文件会触发热更新，整页重载**：浏览器页面里正在跑的 AI 任务（`runJob`）、测试脚本里的 `window.*` 变量会丢。需要长时间跑任务时，**先跑完再改代码**，或把测试夹具存进 `sessionStorage`。
- 带「思考」的真实模型一次调用可能 30–150 秒；在浏览器工具里分段轮询，不要一次等太久。
- macOS：`sed -i` 需要 `sed -i ''`；zsh 里 `--include=*.tsx` 必须加引号（`'*.tsx'`），否则报 `no matches found`；没有 `timeout` 命令。
- 开发库在 `.dev/pg`（端口 54329），`npm run db:reset` 会清空数据。
- 允许模型地址指向本机（测试用的 mock）需要 `ALLOW_PRIVATE_MODEL_HOSTS=true`，**只用于本地测试，不要写进 `.env.example` 的默认值**。

## 8. 提交与协作

- 提交信息用中文，一句话说清「做了什么 / 为什么」，一个提交只做一件逻辑上的事；末尾保留 `Co-Authored-By` 署名行。
- 提交前：`npm run check` 必须通过。**不要**用 `--no-verify`、不要跳过失败的测试；测试挂了就修根因（测试数据不合理才改测试，并说明理由）。
- 不要提交：`.env`、`data/`、`.dev/`、`dist/`、`node_modules/`。
- **不要为了「看起来完成」而隐藏问题。** 没验证的东西、做不到的部分、跑偏的假设，在汇报里如实写出。
- 重大改动（数据模型、权限、同步协议、提示词合同）先在 `docs/` 里更新设计，再写代码。

## 9. 动手前自检

1. 这个改动落在哪一层？（shared / server / cloud / ai / 页面）有没有已有的模块可以复用？
2. 涉及租户数据吗？→ RLS、`withTenant`、权限、跨租户测试。
3. 涉及模型吗？→ 额度与截断、JSON 解析、核验、用量、不含密钥。
4. 涉及界面吗？→ 令牌、字阶、日夜两套、窄屏、减少动效。
5. 写了测试吗？`npm run check` 通过了吗？文档需要同步更新吗？

## 10. 延伸阅读

| 文档 | 内容 |
| --- | --- |
| `docs/architecture.md` | 分层、数据流（同步 / AI 网关 / 短剧引擎 / 媒体适配）、数据表与事件 |
| `docs/ai-writing-guide.md` | 写作提示词的设计原则、质量度量、如何安全地修改提示词 |
| `docs/design-system.md` | 「墨玉鎏金」设计体系：令牌、字阶、海拔、组件、无障碍 |
| `docs/drama-canvas-design.md` | 小说 → 短剧画布的产品设计与路线图 |
