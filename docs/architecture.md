# 墨织架构

## 1. 分层

```
浏览器                                         服务端（Hono）                       Postgres
┌────────────────────────────┐             ┌─────────────────────────┐          ┌──────────────┐
│ pages / components / studio│             │ app.ts 路由装配与来源校验  │          │ 平台表        │
│        ↑ 实时查询            │             │ auth  登录会话            │          │ 租户表（RLS） │
│ Dexie 本地库（离线副本）      │ ──同步────▶ │ orgs  团队、邀请、成员     │ ───────▶ │ records       │
│        ↑                    │ ◀──SSE───── │ sync  推送 / 拉取 / 章节锁 │          │ credentials   │
│ cloud/ 会话 · 同步 · 章节锁   │             │ ai    模型网关、用量、额度  │          │ drama_*       │
│ ai/    写作任务 · 核验 · 体检 │ ──/api/ai─▶ │ drama 短剧画布与执行引擎   │          │ media_*       │
│ store/ 偏好 · 任务 · 通知     │             │ media 媒体服务与文件      │          └──────────────┘
└────────────────────────────┘             └─────────────────────────┘
        src/shared/（权限、接口类型）前后端共用
```

## 2. 两类数据表

- **平台表**（用户、会话、验证码、组织、成员、邀请）：不带 RLS，由服务端代码按成员关系校验。
- **租户表**（`records`、`credentials`、`stage_assignments`、`usage_events`、`chapter_locks`、`audit_logs`、`project_grants`、`drama_*`、`media_*`）：带 `org_id`，**开启并强制行级安全**。事务开始时 `withTenant(orgId, …)` 设置 `app.org_id`，策略据此过滤——即使某条 SQL 漏写了 `org_id` 条件，也读不到别的组织的数据。
- 应用账号**不能是超级用户**，否则 RLS 失效；启动时 `assertSafeRole()` 会检查。

## 3. 同步（写作数据）

- 浏览器每个「用户 × 团队」一个 Dexie 库（`inkloom-{userId}-{orgId}`），页面直接读写；写入被变更追踪中间件记下，`cloud/sync.ts` 增量推送到 `POST /api/sync/push`。
- 服务端对每一行用 `checkWrite(role, table, prev, next)`（`src/shared/permissions.ts`）裁决；被拒绝的行把服务端当前值返回，客户端把本地内容存进 `rescued` 表，可在设置页找回。
- 服务端变更通过 Postgres `LISTEN/NOTIFY` 广播，`GET /api/sync/events`（SSE）推给浏览器，浏览器再 `pull`（`since=cursor`）。多实例无需额外消息队列。
- 同步表：`projects characters world threads chapters versions critiques proposals daily`（`SYNC_TABLES`）。
- **章节锁**：同一章同时只有一个人编辑；进入写作台加锁、25 秒续期、75 秒过期；AI 任务也持有锁。

## 4. AI 网关

- 浏览器：`src/ai/client.ts` 的 `streamChat` → `POST /api/ai/chat`（NDJSON 流：`d` 文本 / `end` 用量与 `truncated` / `err`）。
- 服务端：`server/ai.ts` 解析「环节 → 模型」分配（`plan / write / review / muse`），检查月度额度，用 `safeFetch` 调用服务商，记录 `usage_events`。
- 服务端任务（短剧画布）用 `runTextModel`，同样经过额度与用量。
- 协议识别（`detect.ts`）在服务端运行：OpenAI 兼容 / Anthropic / Ollama；密钥加密保存。
- `providers.ts`：流式解析、`finish_reason` 截断检测、对 `max_tokens` 上限的自动降档。

## 5. 写作智能（`src/ai/`）

| 模块 | 职责 |
| --- | --- |
| `tasks.ts` | 开书 / 大纲 / 起草 / 修订 / 审稿 / 定稿整理 / 批量写作；`call()` 处理截断与额度 |
| `lens.ts` | 上下文装配：按优先级与预算装入细纲、文风、上章结尾、人物、前情、**台账事实**、世界观…… |
| `prompts.ts` | 所有写作类提示词 |
| `verify.ts` | 审稿核验：引文定位、情节点降级、人名写串 |
| `lint.ts` | 文字体检：比喻密度、套话 |
| `inspiration.ts` | 随机灵感：算子 + 种子 + 三档浓度 + 缓存 |

连续性闭环：定稿 → 提取设定变化（`proposals`，作者确认才写入设定集）；起草 / 审稿前为前几章生成**台账**（`Chapter.digest`）并对照前文找矛盾。

## 6. 短剧画布（`server/drama.ts`）

- 一部小说一张画布：`drama_projects` / `drama_nodes` / `drama_edges`。节点类型：`source breakdown outline script storyboard portrait location`。
- 每个节点保存 `input_hash`（运行时依赖内容的指纹）；当前指纹与保存值不同即「已过期」。
- 运行在服务端后台：节点状态写库，`notifyOrg({type:'drama'})` 通知浏览器刷新；有取消、超时、重启恢复（`recoverDrama`）。
- 大纲完成后自动展开每集的「剧本 → 分镜」节点；拆解完成后自动生成人物 / 场景图像节点。图像要花钱，**不包含在「一键运行」里**。
- 文本节点走 `runTextModel`（环节 `plan`，用量记为 `drama`）。

## 7. 媒体适配（`server/media/engine.ts` + `server/media.ts`）

- 不为每家厂商写代码，用一份 `ProviderSpec`（JSON，见 `src/shared/media.ts`）描述：认证、提交、轮询、结果路径、能力。
- 引擎：模板渲染（整串变量保持原类型，缺失字段省略）→ 认证（bearer / header / query / basic / jwt-hs256）→ 能力协商（时长、画幅、提示词长度、首尾帧降级）→ 同步或「提交 → 轮询 → 下载」→ 按文件头识别类型 → 落盘 `STORAGE_DIR`。
- 文件通过带鉴权、支持 Range 的 `/api/media/:id` 提供；`<img>` 用 `?org=` 传团队标识。
- 尚未实现：AK/SK 请求签名（sigv4 类）；需要时在 `applyAuth` 增加一种。

## 8. 实时事件

`sync`（新数据）、`lock`（章节锁）、`members`、`models`（模型与媒体服务配置）、`drama`（画布进展）。事件不携带内容，浏览器收到后自己拉取。

## 9. 权限模型

组织角色：所有者 / 管理员 / 编辑 / 作者 / 只读 / 外部协作者（只能访问被授权的作品）。能力矩阵与写入裁决都在 `src/shared/permissions.ts`。作者能写正文但不能改设定集、不能定稿；编辑可定稿、采纳设定变化；管理员管理成员与模型。

## 10. 目录与命名约定

- 服务端 import 带 `.ts` 后缀；前端用 `@/` 别名；`src/shared` 不得依赖 DOM 或服务端模块。
- 页面一个文件一个路由，`export default`（懒加载）；通用组件命名导出。
- 租户表名 `snake_case` 复数；接口路径 `/api/{模块}/…`；错误统一 `{ error: { code, message } }`，`message` 可直接展示给用户。
