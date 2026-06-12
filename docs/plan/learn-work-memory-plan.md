# SightFlow「学」（Learn）能力规划 & Code Plan

> 目标：把 PPT 中承诺的「工作记忆引擎」（work-trace 可回放 / 可评测 / 可继承）从叙事变成代码，
> 并支撑下周一/二的创业比赛 Demo。
>
> 现状结论：See / Think / Do 已闭环（VLM 布局识别 → 截图判断 → RPA 执行），
> 但「学」目前只有 4 种字符串日志（`thinking/reply/skip/error`），截图散落在 `/tmp`，
> 无结构化轨迹、无回放、无评测、无经验沉淀。本文档给出三阶段落地方案。

---

## 一、战略定位：为什么「学」是行业影响力第一的入口

调研结论（2026 年中行业现状）：

| 方向 | 现有玩家 | 空白 |
|---|---|---|
| GUI Agent 轨迹格式 | OSWorld / WindowsAgentArena / ATIF（各自为政，文本 Agent 为主） | **没有桌面 GUI 工作轨迹的开放标准**（截图 + 界面状态 + 坐标 + 判断依据 + 人/机来源） |
| Agent 记忆框架 | Mem0 / Letta / Zep / LangMem（都是「对话事实记忆」） | **没人做「过程性记忆」**：哪个按钮、什么前置条件、什么失败模式、成功率统计 |
| 演示→可执行流程 | OpenAdapt（录制→执行）、Skyvern（仅浏览器、功能未上线） | **没人闭环**：录制示范 → 归纳 SOP → VLM 执行 → 根据结果反向修正 SOP |
| 人工接管信号 | 无 | **没有任何框架把「人工纠正/接管」当作一等学习数据** |
| 中文企业软件 | 所有数据集/录制器都面向西方 Web/OS | **微信/钉钉/ERP 轨迹语料和 SOP 库零竞争** —— 这正是 SightFlow 的主场 |

因此「学」的定位不是模型微调，而是三层产品能力：

```
L1 记录 Trace      每次执行 = 结构化工作轨迹（本地、append-only、数据不出企业）
L2 回放/评测       轨迹时间轴回放 + 同场景跨模型/跨版本的量化对比
L3 继承 Memory     轨迹 + 人工接管 → 归纳「经验卡片」(SOP) → 注入运行时 → 效果可度量
```

行业影响力的打法 = **标准 + 语料 + 闭环**：
1. 发布开放的 work-trace 规范（兼容 OTel GenAI spans，扩展屏幕状态/坐标/人机来源字段）；
2. 发布首个中文企业软件工作轨迹语料 + benchmark（"别人评测网页，我们评测真实岗位"）；
3. 做成全球第一个开源的「示范→SOP→执行→修正」全闭环桌面引擎。

---

## 二、代码现状与挂载点（基于当前仓库）

核心事件流（已实现）：

```
RuntimeHost(事件队列) → GenericChannelSession(状态机)
  bootstrap → measureLayout(VLM/框选) → observe_chat(截图→Provider)
  → provider.reply_text/skip → sendMessage(RPA) → check_unread(像素diff+红点) → 循环
```

「学」需要挂的钩子（精确位置）：

| 挂载点 | 文件 | 说明 |
|---|---|---|
| `RuntimeHostControls` 接口 | `src/core/session-types.ts:30` | 新增 `trace(step)` 方法 |
| `createControls()` / `log()` | `src/core/runtime-host.ts:80,128` | 接入 TraceRecorder；start/stop 开关轨迹会话 |
| `observe_chat` / `provider.*` / `check_unread` 各分支 | `src/core/generic-channel-session.ts:45-153` | 每个分支落一条结构化 step |
| 截图持久化（现有，去 /tmp 化） | `src/core/local-provider.ts:52-93` `persistDebugInput()` | 改写入轨迹目录并关联 stepId |
| IPC 注册 | `src/main/index.ts` | `trace:list / trace:get / memory:learn / memory:cards` |
| UI 主界面 | `src/renderer/src/App.tsx` | 新增「工作记忆」面板（时间轴 + 回放 + 经验卡片） |
| 生态 API | `src/main/skill-server.ts` | 新增 `GET /trace/sessions`、`GET /memory/cards`（OpenClaw 等外部 Agent 可消费） |

---

## 三、数据模型（v0，比赛后演进为开放规范 v0.1）

```ts
// src/core/trace/trace-types.ts
interface TraceSession {
  sessionId: string        // ulid
  appType: AppType
  startedAt: number
  endedAt?: number
  engineVersion: string
  model: string            // 当前 provider 模型
  promptVersion?: string
}

interface TraceStep {
  stepId: string           // ulid
  sessionId: string
  seq: number
  ts: number               // 时间戳
  actor: 'agent' | 'human' // 人/机来源（可继承的关键字段）
  phase: 'observe' | 'think' | 'act' | 'verify'
  screen?: {               // 界面状态
    screenshotPath: string
    appType: AppType
    layout?: LayoutSnapshot   // 当时的 LayoutCache 快照（bbox）
  }
  reasoning?: {            // 判断依据 —— “为什么这么做”
    content: string
    model?: string
    memoryRefs?: string[]  // 引用了哪些经验卡片（闭环度量）
  }
  action?: {               // 动作
    kind: 'click' | 'type' | 'paste' | 'send' | 'switch_app' | 'wait'
    target?: BBox
    payload?: string
  }
  outcome?: {              // 结果
    status: 'ok' | 'fail' | 'skip'
    detail?: string
    latencyMs?: number
  }
}

interface ExperienceCard {  // 经验卡片 = 过程性记忆的最小单元
  cardId: string
  scenario: string          // 触发条件（什么情况下）
  guidance: string          // 该怎么做
  rationale: string         // 为什么（老员工的判断依据）
  evidence: string[]        // 来源 trace stepIds（可审计）
  source: 'agent_summary' | 'human_takeover' | 'manual'
  stats: { used: number; success: number }   // 卡片效果可评测
  createdAt: number
}
```

存储：`<userData>/worktrace/<sessionId>/trace.jsonl` + `screenshots/`；
经验卡片 `<userData>/memory/cards.json`。Phase 1 引入 better-sqlite3 做索引。
（PPT 第 4 页五元组「时间戳 / 界面状态 / 判断依据 / 动作 / 结果」与 schema 一一对应。）

---

## 四、三阶段 Code Plan

### Phase 0 — 比赛 Demo 冲刺（3 天，本周末 → 周一）

目标：让「学」第一次**看得见**。全部本地实现，无服务端依赖。

| # | 任务 | 内容 | 工作量 | 优先级 |
|---|---|---|---|---|
| 0.1 | TraceRecorder | `src/core/trace/`：types + recorder（JSONL append + 截图落盘）；挂入 RuntimeHost 与 GenericChannelSession 各分支 | 0.5 天 | P0 |
| 0.2 | 工作记忆面板 | 新窗口/Tab：会话列表 → 时间轴卡片流（截图缩略图 + 判断依据 + 动作 + 结果徽标），拖动滑块逐步回放，点击坐标在截图上高亮 | 1 天 | P0 |
| 0.3 | 经验卡片 v0 | 「从这次轨迹学习」按钮 → 一次 LLM 调用把 session 轨迹归纳为 1-3 张经验卡片 → 展示在面板 →下次启动注入 system prompt（`ai-client.ts` 的 REPLY_SYSTEM_PROMPT 拼接「团队经验」段） | 1 天 | P0 |
| 0.4 | 引用标记 | provider 回复后，在 trace step 的 `reasoning.memoryRefs` 记录用到的卡片，并在 UI 标「📎 经验#1」 | 2 小时 | P1 |
| 0.5 | Eval 对比页 | 离线脚本：取录好的 provider-inputs（截图+上下文），跑 豆包 vs 千问（或同模型不同 prompt/有无经验卡片），LLM-judge 打分，生成一页对比报告（静态 HTML 即可，赛前预生成） | 0.5 天 | P1 |
| 0.6 | 人工接管 v0 | Demo 可用「手动标注纠正」替代全局键鼠监听：在时间轴某步上点「纠正」，输入正确做法 → 生成 `source: human_takeover` 卡片 | 0.5 天 | P2（来不及可砍） |

> 注意：Phase 0 的「回放」是**视觉回放**（截图序列 + 坐标高亮），不是真实环境重执行——零风险且演示效果相同。

建议分工（4 人 3 天）：
- 光政：0.2 工作记忆面板 + 0.4（前端主力）
- 张博：0.1 TraceRecorder + 0.5 Eval 脚本（核心层）
- 海峰：Demo 脚本、话术、串场、评委 QA 预案
- 梁卓：备份视频录制、第二台设备扮演客户、现场物料

### Phase 1 — Learn v1（赛后 2–4 周）

1. **轨迹存储工程化**：better-sqlite3 索引、保留策略、敏感信息脱敏开关（呼应「本地执行，数据不出企业」）。
2. **真·人工接管录制**：引擎暂停 → uiohook-napi 全局键鼠监听 + 截图 → `actor: 'human'` 示范轨迹。这是「优秀员工的判断第一次被组织留下来」的技术实现。
3. **SOP 归纳（AWM 式）**：离线任务按场景聚类轨迹 → LLM 归纳带前置条件/失败模式/统计的 SOP，版本化管理。
4. **运行时检索**：provider.run 前按 appType/联系人/场景检索 top-k 卡片注入 prompt；trace 记录引用 → 卡片成功率自动统计（闭环）。
5. **Eval harness 产品化**：`npm run eval` —— 录制场景 × 模型 × prompt × 卡片开关 的矩阵评测，输出对比报告。「换模型/换版本业务效果可量化对比」由此成真。
6. **回放升级**：模型级回放（用录制输入离线重跑 provider，对比新旧决策）；真实环境重执行放 Phase 2。

### Phase 2 — 行业影响力（1–2 个季度）

1. **开放标准**：独立仓库 `work-trace-spec` 发布 v0.1 规范 + 校验器 + OSWorld/ATIF 转换器；兼容 OTel GenAI semantic conventions，扩展 GUI 字段（屏幕状态、坐标、人机来源、接管事件）。先发者定标准。
2. **中文企业软件 Benchmark**：基于脱敏轨迹发布微信/钉钉/ERP 场景评测集 + 排行榜——全球零竞争的位置。
3. **组织记忆服务**：企业内网自托管 trace/SOP 服务端，团队级经验库、跨席位继承、管理 Dashboard——这是商业版（识流）的护城河和续费理由。
4. **生态**：Provider Hub 之外新增 Skill/SOP Hub；`skill-server.ts` 暴露轨迹/记忆 API，让 OpenClaw 等外部 Agent 消费 SightFlow 的工作记忆。
5. **社区节奏**：每月轨迹数据集发布 + 技术报告/论文（AWM 闭环 + 中文企业场景是可发表的点）。

---

## 五、比赛 Demo 方案（下周一/二）

5 分钟演示弧线（先讲已有的「看想做」，把高潮留给「学」）：

| 时间 | 环节 | 内容 |
|---|---|---|
| 0:00–0:30 | 问题 | 一句话 + 真实微信客服界面：「企业最重的工作在屏幕上，不在 API 里」 |
| 0:30–1:30 | 看·想·做（live） | 启动引擎：自动检测未读 → 打开会话 → 理解 → 回复（现有能力，用框选模式保稳定） |
| 1:30–2:30 | 工作记忆 | 切到「工作记忆」面板：刚才每一步实时生成的轨迹时间轴——「别人记录操作步骤，我们记录为什么这么做」 |
| 2:30–3:00 | 可回放 | 拖动滑块逐步回放，截图上高亮当时的点击位置——「出问题能复盘到每一步」 |
| 3:00–4:30 | **学习时刻（高潮）** | 对某一步做人工纠正 → 点「沉淀经验」→ 生成经验卡片 → 第二台设备发来同类消息 → Agent 用上经验，回复明显变好，轨迹上出现「📎 引用经验#1」——「老员工的判断第一次被组织留下来」 |
| 4:30–5:00 | 可评测 + 收尾 | 一屏预生成的 豆包 vs 千问 评测对比报告 + 商业数据（800+ 客户、Q1 12x、460+ Star）+ 标准愿景 |

风险预案：
- 全程录制备份视频（比赛前一天录好，与 live 流程逐帧一致）；
- 布局识别用**框选模式**（确定性）而非 VLM 模式（有波动）；
- 「客户消息」由队友用第二台设备按脚本发送；提前预热模型连接；
- Eval 报告**赛前预生成**，现场只展示不现跑；
- 若 0.6 人工接管来不及：用「手动标注纠正」按钮替代，叙事完全一致。

---

## 六、一句话总结

> 把 `log(type, string)` 升级为 `trace(step)`，「工作记忆引擎」就从 PPT 走进了代码；
> 把人工接管变成一等数据，「学」就成了别人没有的护城河；
> 把 trace schema 开源成规范，「行业影响力第一」就有了抓手。
