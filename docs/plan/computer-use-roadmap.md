# Computer-Use Roadmap — 跨平台 / 浏览器 / 记忆驱动操作

> 目标：提高 agent「操作电脑」的能力，且让这能力**由工作记忆驱动**(基于工作历史 memory 去操作)。
> 战略判断:computer-use 的「手和眼」正在被开源商品化(UI-TARS / AutoGLM / browser-use)。
> **我们不自造手,而是把开源的手插进来;真正自建的是「语义动作空间 + Perception-MCP 协议」,
> 让记忆能跨 OS / 跨分辨率 / 跨模型地记住「怎么操作」并复用。**

## 现状(研究结论)

| 能力 | thiflow-agent-v2(商业) | sightflow(开源,本仓库) |
|---|---|---|
| 动作原语 | 成熟 `RobotCompatBridge`(move/click/type/scroll/drag + 仿人 + 外接 HID) | 弱:`DesktopDevice` 是 IM 形状(hasUnread/sendMessage) |
| 跨平台 | mac/win 已支持,`IS_WIN/IS_MAC` 散落 ~30 文件 | 两端可跑,平台分支散在 input/window/vision-utils |
| 浏览器操作 | ❌ 无 | ❌ 无 |
| 结构化工作记忆 | 观测性日志(远程,不可继承) | ✅ work-trace + 经验卡片 + 检索 + 继承闭环 |

矛盾:thiflow 有手没记忆,sightflow 有记忆但手是 IM 形状、无浏览器。

## 可利用的开源(及许可证)

- **UI-TARS / UI-TARS-2**(字节,代码 Apache-2.0,开放权重)— 单模型感知+接地+动作,输出 pyautogui 式动作。作为**可切换 Grounder/Planner 后端**。⚠️ 权重商用条款需逐条核对(底座 Qwen-VL)。
- **browser-use**(MIT)— 浏览器 agent 范式(DOM+AX 编号元素→按语义点击,截图兜底)。Python,**不内嵌**,用 Playwright 在 TS 复刻其范式。
- **Playwright / CDP**(Apache-2.0)— 真·浏览器驱动,DOM 接地比像素可靠,产出语义化 trace。
- **Agent-S2**(Simular)— 跨平台 + Mixture-of-Grounding + 分层规划,参考其接地混合思路。
- **AutoGLM / SEAgent** — 「从经验自进化」思路;我们用**人审门控版**(已建 pending_review→approve)。

> 红线:browser-use=MIT、Playwright=Apache ✅;UI-TARS 权重 / Agent-S 许可落地前必须核对,绝不引 AGPL。

## 目标架构

```
Work Memory(护城河) ──检索SOP/决策卡→注入规划; 轨迹→技能归纳; grounding缓存──┐
        │ 语义动作 + 结果回写                                                  │
Perception-MCP(协议锚点): Grounder 接口(doubao / UI-TARS / Agent-S 可切换)     │
        │                                                                      │
Action Space(平台无关): click/double/type/key/scroll/drag/open_url/wait/observe │
        │  target = { semanticTarget, bbox, coords }   ←── 可继承的关键        │
   ┌────┴────┐        ┌──────────┐                                            │
 DesktopSurface    BrowserSurface(未来: Mobile / API)                          │
 robotjs+helper    Playwright/CDP                                             │
 mac / windows     DOM+AX 接地                                                 ┘
```

**最关键的设计**:动作必须**语义化**。像素坐标 `[x,y]` 不可继承(换分辨率/OS/模型就废);
升级成 `target = { semanticTarget:"微信搜索框", bbox?, coords? }` 后,记忆存「点搜索框」,
复用时对该语义目标**实时重新接地**(re-ground),而不是机械回放坐标(那是 RPA 不是学习)。

## 分阶段

- **Phase 1(本次,已落地)** — 语义动作空间 + 跨平台收口(地基)。见下。
- **Phase 2** — BrowserSurface(Playwright + browser-use 范式);新增 WhatsApp Web / TikTok Shop 网页 Channel。
- **Phase 3** — Grounder 可切换 + UI-TARS 接入;用 Eval/Model-Replay 在录好的轨迹上离线 A/B(doubao vs UI-TARS)。
- **Phase 4** — 记忆驱动操作:检索增强规划 + 轨迹→SOP 技能归纳(人审门控)+ grounding 缓存,用已建五维度量证明「记忆让操作更准」。

---

## Phase 1 已落地(本次提交)

把 IM 形状的动作升级为**平台无关的语义动作空间**,并把散落的平台分支收口、加 parity 测试。

### 交付
1. **语义动作空间** `src/core/action/action-types.ts`:`Surface`(desktop/browser/api)、`ActionKind`
   (click/double_click/type/key/scroll/drag/open_url/send/observe…)、`ActionTarget{semanticTarget,bbox,coords}`、
   `hasSideEffect()`/`describeTarget()`。这是后续浏览器面 / UI-TARS / 记忆复用的共同契约。
2. **跨平台收口** `src/core/platform/platform.ts`:`toOsPlatform/currentPlatform/primaryModifier/pasteHotkey/
   windowLogicalToScreen`——把 `IS_WIN/IS_MAC` 的坐标换算与修饰键决策集中为**纯函数**(显式收 platform 参数,
   可对 mac/win 一起单测)。`vision-utils`(bbox/point→屏幕坐标)与 `input-utils`(粘贴修饰键)改为委托,
   **运行时行为不变**(有逐位回归测试保护)。
3. **轨迹语义化(可继承)** `TraceAction` 新增 `surface / semanticTarget / bbox / groundingSource`(附加,向后兼容);
   `GenericChannelSession` 给现有动作打上语义标签(「未读会话入口」「消息输入框」「未读联系人」「聊天窗口布局」)。
   `MemoryWindow` 动作行优先显示语义目标。

### 测试 / 校验
- `npm test` 28 例全绿(新增 platform parity、action-types、坐标换算逐位回归)。
- `npm run typecheck` 通过;新文件 eslint 0 问题;改动文件 lint 问题数不升反降(移除冗余分支)。

### 兼容性 / 回滚
- 纯附加 schema;旧 trace.jsonl 的 `action.target=[x,y]` 照常读取。
- `TraceActionKind` 标记 @deprecated 但保留;`ActionKind` 是其超集。
- 回滚到上一 commit 即可,无数据迁移。

### 已知限制 / 下一步
- 本阶段只统一了 desktop 面的语义标签与坐标换算;**BrowserSurface 尚未实现**(Phase 2)。
- 动作执行仍走现有 robotjs 路径;尚未抽出统一 `Surface` 执行接口(Phase 2 随浏览器面一起定）。
- semanticTarget 目前由 channel 静态打标;Phase 4 接 grounding 缓存后,可按语义目标命中缓存跳过 VLM 调用并统计命中率。
