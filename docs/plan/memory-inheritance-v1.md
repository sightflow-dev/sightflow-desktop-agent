# Memory Inheritance v1 — 工作记忆继承闭环（本次迭代）

> 在 Work Memory (Learn) v0 基础上，把「记忆继承」从「全量注入 + used/success 计数」
> 升级为**可审核、可度量、按场景检索**的闭环。对应总纲 Phase A：
> 让系统在记忆这条线上**更主动（按场景取对的经验）**、**更可复盘（为什么纠正 / 结果如何）**。
>
> North Star：Work Memory ↑ → 执行质量 ↑ → 人工接管 ↓ → 业务结果 ↑。

## 这次交付了什么

1. **Trace schema v1.0（向后兼容）** — `src/core/trace/trace-types.ts`
   - 新增 `schemaVersion` / `taskId` / `episodeId` / `verification` / `intervention`，
     `TracePhase` 扩展出完整闭环阶段（receive…outcome），`TraceActor` 增加 `system`。
   - 全部为**可选附加字段**；历史 `trace.jsonl`（无 schemaVersion）由 `normalizeTraceStep`
     读取时补 `schemaVersion:'0'` + `actor:'agent'`，不破坏旧数据。

2. **人工纠正 → 候选经验（pending_review）** — `memory:addCorrection`
   - 在某条轨迹步骤上「这步该怎么做」，生成 `source:human_takeover`、`status:pending_review`、
     作用域绑定当前 appType 的候选卡片，**必须审核通过才会被检索注入**（红线：高风险记忆不自动启用）。
   - 同时把这次纠正作为 `actor:'human'` 的 TraceStep 回写进世界线（携带 `intervention.correction`），
     并给「被纠正步骤引用过的卡片」记一次 `humanOverride` 负反馈。

3. **检索取代全量注入** — `src/core/memory/memory-retriever.ts`（纯函数，可单测）
   - 硬过滤（作用域 appType/taskType）→ 质量分（置信度 × 结果质量 × 时间衰减 − 风险/推翻惩罚）
     + 文本相关性（中文按字符 bigram）→ top-k + 字符预算。默认 `maxItems:5 / maxChars:1600`。
   - 运行时 `RuntimeHost.runProviderWithMemory` 用 ProviderInput 构造 query 检索注入。

4. **结果度量取代 success 布尔** — `ExperienceCardStats`
   - `retrieved / applied / verifiedSuccess / verifiedFailure / humanOverride`，分别在
     检索注入、被某步引用、动作验证、人工推翻时埋点。旧 `{used,success}` 自动迁移。

5. **审核 / 度量 UI** — `MemoryWindow.tsx`
   - 候选经验显示「待审核」+ 批准 / 驳回；卡片展示检索 / 应用 / 验证成功 / 人工推翻；
     步骤详情展示验证与人工纠正。

## Schema 变更与迁移

| 数据 | 变更 | 迁移 |
|---|---|---|
| `trace.jsonl` 步骤 | 新增可选字段 + `schemaVersion` | 读取时 `normalizeTraceStep` 补 `'0'`，纯附加不改旧行 |
| `session.json` | 新增可选 `taskId/episodeId/promptVersion/schemaVersion` | 旧会话照常读取 |
| `memory/cards.json` | 文件 `version:1→2`；卡片新增 status/kind/scope/confidence/riskLevel/version + 新 stats | `migrateCard` 在 load 时把 `{used,success}` → `applied/verifiedSuccess/retrieved`，无 status 旧卡片视为 `active`（保持原「启用即注入」行为）。首次写入后文件升级到 v2 |

## 测试

`npm test`（Node 22 内置 test runner + 类型擦除，无新增依赖）：
- `memory-retriever.test.ts`：作用域硬过滤、top-k、字符预算、中文相关性、推翻/时间衰减打分。
- `experience-store.test.ts`：迁移、human_takeover→pending、approve/reject、disabled、埋点、持久化、v1 旧文件兼容。
- `trace-recorder.test.ts`：normalize 旧步骤、新步骤带 schemaVersion 读回、历史 jsonl 兼容、人工介入追加。

## 手工验收（继承闭环 Demo）

1. 跑一轮引擎 → 工作记忆面板出现轨迹（步骤带 schemaVersion）。
2. 对某步「纠正这一步 → 沉淀为经验」→ 经验卡片页出现一条**待审核**卡片，轨迹里多一条「人工纠正」步骤。
3. 点**批准** → 卡片转「已启用」。
4. 再跑一轮相似场景 → 该卡片被检索注入，命中步骤显示「📎 经验」，卡片**检索 / 应用 / 验证成功**计数增长。
5. 若再对引用了该卡片的步骤做纠正 → 卡片**人工推翻**计数 +1（负反馈，后续检索降权）。

## 回滚

- 纯前向兼容：删除本次新增字段不影响旧数据读取。
- 代码回滚到上一个 commit 即可；已写出的 `cards.json`（v2）旧版本读取时 `Array.isArray(cards)`
  仍成立、忽略未知字段，不会崩溃（仅丢失新统计维度）。

## 已知限制 / 下一步

- 检索 query 目前只有 appType（+ 预留文本位）；当前管线在 provider 调用前未抽 OCR 文本，
  相关性退化为纯质量排序。接入 observe 阶段文本后相关性自动生效。
- `taskId/episodeId` 字段已就位但未填充——留给 Phase B 任务层（跨 session / 可恢复任务）。
- 单条轨迹归纳（learnFromSession）产出的卡片也应进 pending_review；本次已由 store 默认按
  来源（非 manual → pending_review）保证。
- `appendHumanInterventionStep` 直接读写 session.json，未与运行时 writeChain 串行——
  人工纠正为低频事后操作，可接受；任务层落地时并入统一写入。
