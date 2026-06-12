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
3. **学习模式（录屏 → 知识）**：详见第六节。录屏导入版先行（存量培训录屏直接变资产，不改变业务员工作习惯），App 内实时学习模式随后。
4. **SOP 归纳（AWM 式）**：离线任务按场景聚类轨迹 → LLM 归纳带前置条件/失败模式/统计的 SOP，版本化管理。
5. **运行时检索**：provider.run 前按 appType/联系人/场景检索 top-k 卡片注入 prompt；trace 记录引用 → 卡片成功率自动统计（闭环）。
6. **Eval harness 产品化**：`npm run eval` —— 录制场景 × 模型 × prompt × 卡片开关 的矩阵评测，输出对比报告。「换模型/换版本业务效果可量化对比」由此成真。
7. **回放升级**：模型级回放（用录制输入离线重跑 provider，对比新旧决策）；真实环境重执行放 Phase 2。
8. **任务层 v0（达人建联前置依赖）**：详见第七节。Campaign/名单/按联系人状态机 + 主动触达原语 + 跨天跟进调度。

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

## 六、学习模式（Learning Mode）：从录屏到可执行知识

> 产品定义：在 SightFlow 上开一个「学习模式」——老员工正常干活（或导入已有录屏），
> Agent 在旁边看、理解、拆出核心知识并沉淀；之后这些知识可以被检索、被 play、被 Agent 执行。
> 这是 L3「继承」层的**输入端**，与人工接管录制（实时路径）互补。

### Pipeline 五步

```
① 采集      A. App 内学习模式：1-2fps 截屏 + uiohook 键鼠事件 → 直接产出结构化伪轨迹（推荐，不存视频）
            B. 录屏导入：已有 mp4（培训材料、优秀商务实操录屏）→ 走抽帧管线（冷启动利器）
② 切关键帧   ffmpeg 场景检测（scene>0.3）+ 每秒兜底帧；聊天类界面用聊天区像素 diff 找「新消息气泡」帧
            （复用现有 pixelmatch 设施 image-compare.ts）
③ 视觉理解   VLM 逐帧/帧对结构化：当前界面、对话双方、消息内容（谁说了什么）、帧间推断动作
            → 产出伪轨迹（TraceStep，actor: 'human'，source: 'video'）
④ 知识归纳   LLM 按会话切分 episode → 三类知识产物（带证据帧引用，可回溯出处）：
            - 沟通策略卡：场景/意图 → 话术模式 → 为什么这么说
            - 操作 SOP：非平凡的界面操作流程（建联场景里占比很小）
            - 红线清单：专家从来不做的事（如绝不连发三条、绝不开场报价）
⑤ 人工审核   业务负责人在「待审核知识」队列里确认/修改/驳回 → 入库
            （质量门，也是企业信任的来源：每张卡片都能点回证据帧）
```

入库之后与 Agent 自产轨迹是**同一套 work-trace / 经验卡片体系**：运行时检索注入、轨迹引用标记（📎）、
卡片效果统计、Eval 对比，全部复用第三、四节已规划的设施——这正是统一 trace schema 的价值：
录屏学习只是给同一个记忆系统多接了一个输入适配器。

### 技术要点与代码映射

| 环节 | 实现 | 位置 |
|---|---|---|
| App 内学习模式录制 | desktopCapturer 定频截屏 + uiohook-napi 全局键鼠 → 直接写 trace.jsonl | `src/core/learn/demo-recorder.ts`（新） |
| 视频抽帧 | ffmpeg-static：场景检测 + 兜底采样；聊天区 diff 复用 pixelmatch | `src/core/learn/keyframe.ts`（新） |
| 关键帧理解 | 复用 `ai-client.ts` 的 `callVision()`，新增批量管线 + 帧间动作推断 prompt | `src/core/learn/frame-understand.ts`（新） |
| 知识归纳 | episode 切分 → 卡片生成（含 evidence 帧引用） | `src/core/learn/induce.ts`（新） |
| 审核 UI | 工作记忆面板新增「待审核知识」队列 + 证据帧预览 | `src/renderer/`（扩展） |
| 执行（play） | 经验卡片注入 provider prompt；操作 SOP 映射到现有 RPA 原语 | 复用第四节 Phase 1 第 5 条 |

### 关键产品判断（达人建联场景）

值钱的知识是**话术和判断，不是点击操作**。打开会话、输入、发送这些 UI 操作 Agent 早就会；
专家录屏里真正要拆出来的是：开场怎么说、报价异议怎么接、几天不回怎么跟、什么时候发案例。
所以 pipeline 的重心在 ③④ 的**对话语义理解**，而不是动作复刻——
「play」的含义是 Agent 在新对话里**按学到的策略行动**，不是机械重放录屏里的点击序列（那是 RPA，不是学习）。

---

## 七、首个垂直场景：达人建联（Wavith 公域 × SightFlow 私域）

### 业务闭环

```
Wavith 公域找达人 → 名单导入 SightFlow → 私域触达（微信/WhatsApp）
→ 多轮沟通跟进（用学习模式沉淀的建联策略卡） → 结果回写（触达率/回复率/建联成功率）
→ 成功对话反哺知识库（闭环）
```

### 知识形态：建联策略卡（按桶组织）

- **开场话术**：按达人类型 / 平台 / 粉丝量级分桶
- **异议处理**：报价高了怎么接、被已读不回怎么办、达人压价怎么谈
- **节奏判断**：什么时候发合作案例、什么时候给报价、什么时候升级到电话
- **红线**：绝不连发三条、绝不开场砍价、绝不冒充官方……

### 必须补的产品缺口：任务层（比 Learn 更大的缺口）

现有引擎是「**被动**收新消息 → 回复」的循环；达人建联是「**主动**触达 + 多天跟进」。需要新增：

| 能力 | 说明 | 现状 |
|---|---|---|
| Campaign / 建联名单 | 从 Wavith 导入达人名单（CSV/API），批量建任务 | 无 |
| 按联系人状态机 | 待触达 → 已触达 → 已回复 → 洽谈中 → 成单/流失 | 无（引擎无任务概念） |
| 主动发起会话原语 | 搜索联系人 / 添加好友 / 发起新会话（新 RPA 动作，需 VLM 定位搜索框） | 无（现有原语只有点未读/回复） |
| 跨天跟进调度 | N 天未回复 → 按策略卡选择跟进话术；引擎需支持长生命周期任务 | 无（session 是进程级的） |
| 结果信号标注 | 自动（检测到达人回复/通过好友）+ 手动（标记成单）→ 反哺卡片 stats 和回复率报表 | 无 |

排期建议：任务层 v0 与学习模式 v1 在 Phase 1 并行——学习模式先用存量录屏拆出第一批建联策略卡，
任务层就绪后两者合流，跑通第一个「学了再干、干完更会」的垂直业务。

> 合规提醒：主动批量触达对平台风控更敏感（频率限制、新好友添加上限），任务层必须内置
> 节流/拟人化间隔/每日上限，这也是企业客户敢用的前提。

---

## 八、一句话总结

> 把 `log(type, string)` 升级为 `trace(step)`，「工作记忆引擎」就从 PPT 走进了代码；
> 把人工接管和录屏变成一等数据，「学」就成了别人没有的护城河；
> 把 trace schema 开源成规范，「行业影响力第一」就有了抓手；
> 用达人建联做第一个「学了再干」的垂直场景，让学习模式直接长在业务收入上。
