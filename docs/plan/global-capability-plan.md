# SightFlow 全局能力规划：从「IM 专用 RPA」到「跨浏览器+桌面的 记录→学习→改进 引擎」

> 目标：把 SightFlow 从一套**微信/IM 专用**的桌面 RPA 循环，演进为能操作**任意浏览器 + 任意桌面应用**、
> 并以「记录→学习→改进」闭环持续变强的通用 Agent 引擎；同时把 work-trace 沉淀成**开放标准**。
>
> 本文是能力层面的总规划，与 `docs/plan/learn-work-memory-plan.md`（「学」能力的落地细节）互补：
> 那篇讲「学」怎么做深，这篇讲「全局能力」怎么铺开、用哪些开源积木、按什么顺序。
>
> 选型结论均已逐一核验 license 与 Electron+TS 集成可行性（截至 2026 年中）。

---

## 一、背景与目标

**护城河是闭环，不是引擎。** SightFlow 的差异化不在「能做一次任务」，而在**记录「工作是如何被做对的」并持续改进**：
看（看软件/看操作）→ 想（为什么这么做）→ 做（执行）→ 学（Agent 归纳 + 人工纠偏）→ 下一次更好。
这一点决定了选型哲学：不押注任何单一自动化引擎，而是把「记录人类 + 驱动电脑 + 从轨迹学习」拼成一条闭环。

**现状差距（基于当前仓库）：**

| 模块 | 文件 | 现状 | 缺口 |
|---|---|---|---|
| 运行时 | `src/core/runtime-host.ts` | 事件队列 + 经验卡片注入 + trace 钩子，**已通用** | 无（保留） |
| 状态机 | `src/core/generic-channel-session.ts` | 硬编码「未读轮询」 | **IM 专用**，需泛化为通用 perceive→act→verify |
| 设备层 | `src/core/device.ts` | `hasUnreadMessage / isChatContactUnread / setChatBaseline` | **IM 专用**，不是通用电脑操作面 |
| 轨迹/记忆 | `src/core/trace/`、`src/core/memory/` | 五元组 trace + 经验卡片，地基好 | 动作词表太小、归纳只面向聊天、运行时**全量注入**卡片 |
| 浏览器 | — | **完全没有** | 无 Playwright/CDP，无网页操作与录制 |

**一句话结论。** 没有任何单一开源项目能同时覆盖「录制人类 + 驱动电脑」且跨平台 + TypeScript 原生。
正确答案 = **一小套 TS 原生、宽松许可证(MIT/Apache-2.0)的积木 + 把几个研究范式直接 port 进现有代码**，
严格遵守「如非必须，勿增实体」。

---

## 二、三个候选仓库的裁决（已逐一核验 license）

| 仓库 | 裁决 | 理由 |
|---|---|---|
| **browser-use/browser-use** (MIT) | **借鉴，不直接用** | 真 MIT、商用安全，但是 **Python**：塞进跨平台 Electron+TS 要打包 Python 运行时 + Chromium + IPC 桥，违背「勿增实体」。且它只「驱动」不「录制」（录制在兄弟仓库 `workflow-use`，**AGPL-3.0，不要抄代码**）。→ 学它的 CDP/DOM 序列化思路，在 TS 里用 Playwright 拿到同等能力。 |
| **openclaw/openclaw** (MIT, TS) | **澄清，不依赖** | 它**不是**规划/上下文压缩框架，而是一个 **多渠道个人 AI 助手 App**（WhatsApp/Telegram/微信…）。其生态确有 "ContextEngine"/compaction 概念可**概念性参考**，但它是整机 App，不是可嵌入库。要的「记忆+智能上下文压缩+智能规划」改由：Vercel AI SDK `prepareStep` 钩子 + OpenHands Condenser（port 压缩算法）+ AWM/Reflexion（记忆范式）提供。 |
| **bytedance/UI-TARS-desktop**（`@ui-tars/sdk`, Apache-2.0） | **采用为桌面执行引擎** | 桌面「驱动」半边最佳 TS 原生选择：纯 TS、模型无关(OpenAI 兼容，豆包/Ark 直插)，其 `Operator(screenshot()/execute())` 抽象几乎 1:1 对应现有 `DesktopDevice`。**关键澄清**：它出名的「数据飞轮/轨迹录制」是字节**内部模型训练管线**，OSS 里并**没有**面向用户的示范录制器——它解决「驱动」，不解决「录制人类」。 |

---

## 三、推荐的开源栈（按能力，含已核验 license）

| 能力 | 主选 | 备选 | License | 集成方式 |
|---|---|---|---|---|
| **核心循环/LLM** | **Vercel AI SDK**（`ai`^6 + `@ai-sdk/openai`^3，**已装**） | — | Apache-2.0 | 保留。`prepareStep` 做每步上下文压缩 + 卡片注入；`stopWhen` 控制步数预算/目标达成。规划与压缩写成自己的函数，**零新依赖**。 |
| **浏览器·驱动** | **Playwright**（`playwright-core`） | Stagehand（见风险①） | Apache-2.0 | `chromium.connectOverCDP` 连 Electron 自带 Chromium；VLM grounding 留在自家代码（复用 0-1000 bbox 约定）。 |
| **浏览器·录制** | **rrweb**（`rrweb.record()` 注入页面） | — | MIT | DOM 变更 + 点击 + 键入录成结构化 JSON——护城河缺失的「录制」半边，与现有每步截图一起进 `TraceRecorder`。 |
| **桌面·驱动** | **`@ui-tars/sdk` + `@ui-tars/action-parser`**（自定义 Operator 包住现有 `@hurdlegroup/robotjs`） | `trycua/cua`（MIT，沙箱回放备用） | Apache-2.0 | 维护良好的 See→Think→Do 循环，保留自家 VLM 与 device 层。**不要引 nut.js**（npm 撤包/付费二进制坑）。 |
| **桌面·录制** | port **OpenAdapt**(MIT) 采集 schema：active-window/appId + 原始键鼠 + a11y(role/value) | 更深 a11y 时再上 Python sidecar：`pywinauto`(BSD-3) / `pyax`(MIT) | MIT | 桌面侧无 TS 原生跨平台录制器——用**已装**的 `active-win`/`node-window-manager` 起步，仅 schema 扩展，零新运行时。 |
| **记忆/学习（护城河）** | **port 研究范式进现有文件**：AWM(多步 SOP) + Generative-Agents(recency+importance+relevance 检索) + ExpeL(失败挖掘) + Reflexion(失败反思) + Voyager(`stats` 当技能库门控) | mem0(Apache-2.0)，仅当 `cards.json` 超数百条 | 全 MIT/Apache-2.0 | **不加向量库/Python 记忆服务**。升级 `learn-from-session.ts` / `experience-store.ts`。 |
| **规划/状态（暂缓）** | 当自研 `prepareStep` 规划被证明不够时，**只**二选一：Eko(MIT, TS) **或** LangGraph.js(MIT) | — | MIT | 现在不引；两个都引 = 明确过度设计。 |

> 唯一新增运行时依赖 = **3 个 TS 包**：`playwright-core`、`rrweb`、`@ui-tars/sdk`（+ 可选、按需推迟的 Python a11y sidecar）。

---

## 四、架构落点：映射到现有代码

- **复用（不动）** `RuntimeHost`：`runProviderWithMemory()` 已把卡片注入 `ProviderInput.memoryCards` 并给 think/act trace 自动打 `lastInjectedCardIds`——这就是「卡片归因闭环」。上下文压缩放在上一层 AI SDK `prepareStep`，不放这里。
- **扩展** `DesktopDevice` 作为 **Operator 边界**：把聊天专属方法（`hasUnreadMessage` 等）下沉成可选的 `ChatDevice` 扩展，core 接口只保留通用 `screenshot/clickAt/type/scroll/measureLayout`。新增 **(a)** `BrowserDevice`(Playwright `connectOverCDP`)；**(b)** 桌面路径用 `@ui-tars/sdk` 自定义 Operator，落到现有 `input-utils`/`screenshot-utils`。**去特化，不重写。**
- **扩展** `TraceRecorder` + `trace-types`（真正缺失的那块）：按 OpenAdapt 模型新增 `window`(appId/title/surface) 与 `element`(a11y role/name/value/selector)，并把动作词表从 4 个扩到通用集。浏览器步挂 rrweb 事件引用；桌面步挂 active-win 窗口上下文。**只是 JSONL schema 扩展。**
- **扩展** `ExperienceStore`（就地、无 DB）：`getRelevantCards(query, topK)`（recency+importance+relevance；relevance 先用词法代理，`ai-client.ts` 暂无 embeddings 端点）；Voyager 式成功率门控；注入点改 top-K。
- **升级** `learn-from-session.ts`（就地）：输出从扁平 tips → 有序多步 SOP（AWM）；`outcome.status==='fail'` 走 Reflexion/ExpeL 产规避卡。
- **暂缓（不替换）**：不要现在用 LangGraph/Eko 替换 `GenericChannelSession`/`RuntimeHost`；不要用 nut.js 替换 robotjs；不加向量库/Python 记忆服务/图数据库。
- **避免（license 雷）**：`workflow-use`(AGPL)、Skyvern(AGPL)、OmniParser 默认 YOLO 权重(AGPL)、screenpipe(商用 source-available)、OpenRecall(AGPL)。两个尽调项：`openadapt-capture` 缺根 LICENSE（vendoring 前书面确认 MIT）；`pynput` 是 LGPLv3（保持可分离、附 notice）。

---

## 五、完整分阶段路线图

> 排期重心 = **横向通用平台 + 开放标准**；垂类（达人建联）接在同一套能力上。
> 顺序严格 M1→M2→M3，规划/向量库放最后且按实测需要。

### M1 — 记忆/录制护城河（最高杠杆，几乎零新依赖）
目标：让「记录→学习→改进」第一次成为**通用、可度量**的闭环，并为开放标准打地基。

1. **trace schema 升级**（`src/core/trace/trace-types.ts`）：动作词表 `click/type/scroll/key/drag/navigate/switch_app/send/measure/wait`；新增 `window`(appId/title/surface) 与 `element`(a11y) 字段。
2. **记忆范式 port**：`learn-from-session.ts` → AWM 多步 SOP + ExpeL 失败挖掘 + Reflexion 失败反思；`experience-store.ts` → top-K 检索(Generative-Agents 排序) + Voyager 门控；注入点改 top-K。
3. **跨应用人类示范录制器**：桌面侧 `active-win`/`node-window-manager`（已装）+ 定频截图（复用 `screenshot-utils`）填 `window` 字段，产 `actor:'human'` 示范轨迹；浏览器侧待 M2 接 rrweb。
4. **开放标准雏形**：把扩展后的 schema 抽成 `work-trace-spec` 草案（兼容 OTel GenAI spans 思路，扩 GUI 字段：屏幕状态/坐标/人机来源/接管事件）。

> 进度：M1 的 (1)(2) 子项已在分支 `claude/stoic-lovelace-avykcm` 实现并通过无头测试（top-K 相关性、卡片自动退役、AWM+Reflexion 两路归纳）；(3)(4) 待接。

### M2 — 浏览器能力（横向第一块通用面）
加 `playwright-core` + `rrweb`：`BrowserDevice` via `connectOverCDP` 驱动 Electron 内 Chromium；VLM grounding 复用 0-1000 bbox；rrweb 录制接入 M1 recorder。打通「在网页上 看→想→做→录」。
> 业务价值：直接解锁达人建联里「在短视频平台主动找寻达人」的公域获客环节。

### M3 — 桌面去特化
引 `@ui-tars/sdk`，自定义 Operator 包住 robotjs；把 `DesktopDevice` 聊天方法下沉为 `ChatDevice` 扩展，core 变通用电脑操作面。微信路径作为「一个 skill」继续可用，但不再是 core 形状。

### M4（按需）— 规划/状态 & 标准产品化
仅当自研 `prepareStep` 规划成为瓶颈时，二选一引入 Eko 或 LangGraph.js；正式发布 `work-trace-spec` v0.1 + 校验器 + OSWorld/ATIF 转换器。

---

## 六、勿增实体（明确不做）
- 不引任何 Python 记忆/agent 服务（OpenHands/Letta/Zep/cognee/Agent-S/CrewAI/AutoGen…）——只 port 其**算法**（OpenHands Condenser 的压缩值得 port，仅当上下文超预算时）。
- 不引向量库/mem0——`cards.json` 真超过数百条且词法 top-K 被证明不够时再说。
- 不同时引 Eko + LangGraph + mem0 + Python recorder（最大的「不简洁」风险）。

---

## 七、风险（已核验）
1. **AI SDK 版本漂移（高概率/低危害）**：在 `ai`^6(LanguageModelV3)，Stagehand 3.6.0 钉死 `ai`^5(V2)。→ 锁版本；浏览器 grounding 留自家代码，别耦合 Stagehand 的 ai 版本（这是把 Stagehand 降为备选的原因）。
2. **connectOverCDP 连 Electron 有毛刺（中）**：`newContext`/持久化 cookie/端口共享有已知坑。早期就验证 CDP 路径。
3. **rrweb 只录不重放（中）**：rrweb 为可视化录制，非动作重放。可重放步骤靠自家 VLM 步骤归纳（重写 MIT-clean 版 workflow-use 思路）。
4. **桌面人类录制无 TS 原生跨平台方案（中高，最难的护城河缺口）**：浏览器侧 rrweb 解决；桌面侧要么 port OpenAdapt schema 用已装的 active-win（Electron/自绘 IM 客户端 a11y 有限），要么上 Python sidecar（带回 Python 打包 + 系统辅助功能授权 UX）。**录制保真度 vs 简洁，需显式取舍。**
5. **非前沿 VLM 的 grounding 质量（中）**：豆包 bbox/point 精度需验证。→ 用 Set-of-Mark 叠加(WebVoyager 思路) 让 VLM 返回标记序号而非裸坐标。
6. **记忆相关性缺 embeddings（低）**：`ai-client.ts` 无 embeddings 端点，相关性先用词法代理；要语义 top-K 需另接 embeddings 调用或 mem0。

---

## 八、验证方式（端到端）
- **M1 记忆**：跑一次会话 → 检查 `trace.jsonl` 新增 `window`/a11y 字段；点「从这次轨迹学习」→ `cards.json` 产出**多步 SOP**（非扁平 tips）；构造失败步 → 确认产出 Reflexion 规避卡。注入改 top-K 后，确认 `reasoning.memoryRefs` 只引相关卡片、`stats.used/success` 随成功自增。
- **M2 浏览器**：`BrowserDevice` 用 `connectOverCDP` 打开网页，截图 → VLM 返回 bbox → `clickAt` 命中；rrweb JSON 落进同一 trace 会话。
- **M3 桌面**：用 `@ui-tars/sdk` Operator 在一个**非 IM** 桌面应用完成一次「截图→执行」；微信路径作为 `ChatDevice` 仍可跑通原未读循环。
- **回归**：现有微信/企微未读→回复主链路不破。

---

## 九、一句话总结
> 先用零新依赖的方式 port 记忆范式、把 trace 泛化成跨应用录制（M1，护城河），
> 再用 Playwright+rrweb 接上浏览器（M2），用 @ui-tars/sdk 给桌面去特化（M3），
> 规划层与向量库按实测需要最后再加——用最小的实体，长出操作任意浏览器/桌面、且越做越好的全局能力。
