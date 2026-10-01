# AGENTS.md

本项目的 AI 协作规则**只维护一份**：请阅读 [CLAUDE.md](./CLAUDE.md)，无论你使用的是哪一个 AI 编程工具。

最重要的五条（完整规则与理由见 CLAUDE.md）：

1. 不要把任何 API Key 写进代码、文档、测试、提交或日志。
2. 租户数据只能在 `withTenant()` 里读写；权限规则只有 `src/shared/permissions.ts` 一份；新增接口必须有越权与跨租户测试。
3. 模型相关：提示词集中在 `src/ai/prompts.ts`；结构化输出用 `extractJson`；模型给出的引文与判断要用 `src/ai/verify.ts` 核验；预算与截断处理走 `tasks.ts` 的 `call()`。
4. 界面：只用设计令牌，字号只用 `text-fs-*`，不写死颜色；日间 / 夜间 / 窄屏都要看过。详见 `docs/design-system.md`。
5. 提交前运行 `npm run check`，通过后再提交；如实汇报没验证到的部分。
