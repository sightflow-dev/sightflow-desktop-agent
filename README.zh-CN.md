<a name="readme-top"></a>

<div align="center">

<img src="https://github.com/user-attachments/assets/99a7cfec-eb22-4f65-8a76-a6974e46bcf0" alt="SightFlow" width="840" />

<h1>SightFlow · 开源工作记忆引擎</h1>

<p><strong>让 AI 进入真实软件世界 —— 看懂界面，完成任务，沉淀岗位经验。</strong></p>

<p>
  <a href="./README.md">English</a>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md"><b>简体中文</b></a>
</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0" /></a>
  <a href="https://github.com/sightflow-dev/sightflow-desktop-agent/stargazers"><img src="https://img.shields.io/github/stars/sightflow-dev/sightflow-desktop-agent?logo=github&label=Stars" alt="GitHub Stars" /></a>
  <a href="https://github.com/sightflow-dev/sightflow-desktop-agent/network/members"><img src="https://img.shields.io/github/forks/sightflow-dev/sightflow-desktop-agent?logo=github&label=Forks" alt="GitHub Forks" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-success" alt="Platform: Windows | macOS" />
  <a href="https://discord.com/invite/8H6KpbXq3t"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Join Discord" /></a>
  <a href="https://sightflow.dev"><img src="https://img.shields.io/badge/Website-sightflow.dev-0A66C2" alt="Website" /></a>
</p>

<p>
  <a href="#-快速开始"><b>快速开始</b></a> ·
  <a href="#-工作原理--看--想--做--学"><b>工作原理</b></a> ·
  <a href="#-商业验证"><b>商业验证</b></a> ·
  <a href="#-市场与时机"><b>市场</b></a> ·
  <a href="https://sightflow.dev"><b>官网</b></a>
</p>

</div>

---

## 项目概述

> **SightFlow 不替代 LLM，而是补齐 LLM 无法进入软件世界的关键一层** —— 把屏幕像素解析成结构化语义，再把任务意图转成真实操作。

企业最重的工作，不在大模型 API 接口里，而**在屏幕上、在人类工作流中**：

- **界面多** —— 一个任务横跨多个软件、多个窗口。
- **流程长** —— 看消息 → 判断 → 执行 → 跟进 → 兜底，不是点一次按钮。
- **经验隐性** —— 真正的业务经验在老员工每一次判断里，不在文档里。

大模型解决了「想」和「说」，还没解决「学会」和「做好」。SightFlow 正是补齐这一层的运行时 —— 一个能**看懂**任意界面、结合业务**判断**、像真人一样**执行**、并从每一次操作中**沉淀**经验的桌面 Agent。

---

## ✦ 工作原理 · 看 · 想 · 做 · 学

```mermaid
flowchart LR
    SEE["👁 看 See<br/>看懂任意界面与状态"] --> THINK["🧠 想 Think<br/>结合业务上下文判断规划"]
    THINK --> DO["✋ 做 Do<br/>点击 · 输入 · 切换 · 发送"]
    DO --> LEARN["📚 学 Learn<br/>写入结构化工作轨迹"]
    LEARN -. 沉淀为工作记忆 .-> THINK
```

| 阶段 | 做什么 |
| :-- | :-- |
| **See · 看懂 GUI** | 视觉模型理解任意软件界面与状态。 |
| **Think · 判断规划** | 结合业务上下文与历史，决定该做什么。 |
| **Do · 完成操作** | 点击、输入、切换窗口、发送、记录 —— 像真人操作员一样。 |
| **Learn · 沉淀轨迹** | 每次执行写入结构化**工作轨迹（work-trace）**，沉淀为可继承的组织记忆。 |

> 这不是一个应用，而是一套让 AI 上岗的**「工作记忆引擎」**。

---

## ✦ 技术框架 · 工作记忆引擎（Work Memory Runtime）

每一次执行 = 一条结构化轨迹 **`work-trace`**：

```text
work-trace = {
  timestamp,    # 时间戳
  ui_state,     # 界面状态
  rationale,    # 判断依据（为什么这么做）
  action,       # 点击 / 输入 / 切换 / 发送
  result        # 结果
}
```

持续写入、可逐条回放。由此带来**三个别人没有的能力**：

| 能力 | 为什么重要 |
| :-- | :-- |
| 🔁 **可回放 Replay** | 出问题时，能复盘到每一步 —— 乃至背后的判断依据。 |
| 📊 **可评测 Eval** | 换模型 / 换版本，业务效果可量化对比。 |
| 🧬 **可继承 Inherit** | 优秀员工的判断，第一次被组织留下来。 |

> 别人记录的是**操作步骤**，我们记录的是**「为什么这么做」**。这正是从 **RPA** 到 **Agent Runtime** 的关键差别。

面向企业，生而可用：

- 🔒 **本地执行** —— 数据不出企业。
- 🧾 **全程可审计** —— 每一条执行轨迹都可逐条审查。
- 🔄 **多模型可切换** —— 默认适配国产视觉大模型，可在多家 Provider 间切换。

---

## ✦ 核心能力

从微信、企业微信到**任意桌面软件**，SightFlow 让 AI 在**没有 API** 的地方也能工作。

- **通用视觉驱动自动化** —— 抛弃脆弱的 Webhook 与私有协议，像真实人类用户一样阅读气泡、操作输入框、浏览原生 UI 界面。
- **前沿的视觉模型引擎** —— 由统一视觉层驱动，在复杂动态的布局中实时提取红点角标、消息列表、聊天气泡中的文本与语义信息。
- **智能体工作流工作区** —— 将非结构化的聊天请求瞬间转化为可执行的节点工作流与 API 调用，通过本地 AI 实现全维度可编程化。

---

## ✦ 商业验证

> 不是实验室项目。旗舰应用 **识流** 已在真实客户中造血，服务高频、复杂、强人工依赖的客户运营场景。

| 指标 | 数据 |
| :-- | :-- |
| **经营收入增长** | **×12 环比** —— 2026 Q1 经营收入 = 2025 Q4 的 12 倍 |
| **累计企业客户验证** | **800+** 家 |
| **近 3 个月新增企业客户** | **30+** 家 |
| **最强复购信号** | 单个客户最高 **4 次**续约 |
| **开源传播** | **460+** Star · **150+** Fork |
| **全网传播** | 短视频全网曝光 **1000 万+** |

> 客户付费买的不是软件功能，而是「**AI 把这段工作稳定做完**」这个结果。

---

## ✦ 市场与时机

> 桌面是最大的未占位工作现场。策略是**先窄后宽** —— 从消息型客户运营切入，扩展到一切无 API / 弱 API 的企业软件。

**切口市场（公式可验算）：** 约 1,400 万家企业日常用 IM 工具做客户沟通。

| 情景 | 公式 | 年度市场 |
| :-- | :-- | :-- |
| **保守** | 1400万 × 20% × 1 席 × 2000 元/年 | **56 亿 / 年** |
| **积极** | 1400万 × 40% × 2 席 × 2000 元/年 | **224 亿 / 年** |
| **远景** | 全球 BPO 万亿级市场的执行层重构 | **2.36 万亿** |

**三步走打法：**

1. **开源建标准** —— 开源前端运行层，建立开发者分发与标准。
2. **商业旗舰** —— 稳定营收，做增长。
3. **工作轨迹长壁垒** —— 每次执行沉淀为结构化数据，形成行业工作记忆。

---

## 🚀 快速开始

SightFlow 桌面端是基于 **Electron · electron-vite · React · TypeScript** 构建的跨平台客户端，由视觉语言模型（VLM）驱动。

**环境要求：** Node.js（LTS）与 npm。

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发运行

```bash
npm run dev
```

> 启动后，请先选择**目标应用**并完成必要的框选，再进入**设置**窗口填写 API Key、确认当前启用的 Provider。

### 3. 打包构建

```bash
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

---

## ⚙️ 配置说明

桌面端的配置分为两层：

- **基础配置** —— 填写火山方舟 API Key，用于视觉定位、内置豆包智能体等基础能力。
- **智能体 / Provider** —— 选择负责聊天分析和内容生成的 Provider，并维护各自配置。

### SK Key 的用途

1. **智能对话回复** —— 由于项目涉及类似微信等的自动抓取，模型会分析聊天界面的截图并生成自然的回复内容（带防止自我循环对话机制）。
2. **VLM 视觉定位引导** —— 基于屏幕截图和特定 Prompt，让模型自动检测屏幕上的 UI 控件，并返回需要点击的坐标，从而驱动纯视觉的 RPA 流程。

### 如何配置

1. 前往 [火山引擎控制台 · 方舟原生接口](https://console.volcengine.com/ark) 开通相关服务，并生成 / 获取你的 API Key。
2. 启动项目后点击主界面右下角的设置按钮，打开独立设置窗口。
3. 在 **基础配置** 中填写 API Key。默认 Base URL 为 `https://ark.cn-beijing.volces.com/api/v3`，通常无需修改。
4. 在 **智能体** 中选择当前使用的 Provider。内置默认智能体为 **豆包 Seed**，模型固定为 `doubao-seed-2-0-lite-260428`。

### 界面预览

| 主界面 | 基础配置 | 智能体配置 |
| :--: | :--: | :--: |
| <img width="240" alt="SightFlow 主界面" src="./docs/images/main.png" /> | <img width="360" alt="SightFlow 基础配置" src="./docs/images/settings-base.png" /> | <img width="360" alt="SightFlow 智能体配置" src="./docs/images/settings-provider.png" /> |

### 目标应用与框选模式

主界面提供 **目标应用** 快捷配置，用来决定桌面端如何测量聊天窗口布局：

- **微信、企业微信** 默认使用 VLM 自动识别窗口区域。
- **钉钉、飞书、Slack、Telegram** 及其他桌面应用默认使用 **手动框选**。
- 当目标应用需要框选时，点击 **开始框选**，依次圈出 **会话列表、聊天内容区、输入框** 3 个区域。
- 框选结果会按目标应用保存到本地；后续启动会复用已保存区域，也可以随时重新框选。

> VLM 和框选模式只影响「如何测量布局」。运行时截图、内容分析、生成回复和发送消息会消费同一套布局结果。

### 智能体 / Provider Hub

SightFlow 桌面端把「截图分析并生成回复」的聊天能力抽象为独立 **Provider**。Provider 通过 `manifest.json` 声明配置结构，通过 bundle 入口接收聊天截图并返回 `reply_text`、`skip`、`error` 等事件。

- 默认从 `https://sightflow.dev/provider-hub.json` 拉取候选 Provider 列表。
- Hub 只维护 Provider 的 `manifestUrl`，UI 展示字段来自各 Provider 的 manifest。
- 首次加载后会缓存到本地；除非手动点击智能体标题旁的刷新按钮，否则优先使用本地缓存。
- 本地始终保留内置 **豆包 Seed** 作为默认 Provider，避免远端列表不可用时没有可选项。

外部 Provider 接入说明见：[聊天 Provider 接入文档](./docs/provider.md)。仓库内仍保留一个 Doubao / 火山方舟 Provider 示例，供接入文档和本地开发参考：

```text
resources/providers/volcengine-ark/manifest.json
resources/providers/volcengine-ark/provider.bundle.js
```

> **开发环境推荐配置：** [VS Code](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)。

---

## 👥 团队优势

> 不是纯研究团队，也不是纯销售团队，而是能把**能力做成产品**、把**产品推向市场**的团队。成员来自字节 TikTok、阿里优酷、美团等公司，覆盖产品、前端、后端、运营完整闭环。

| 角色 | 成员 | 背景 |
| :-- | :-- | :-- |
| **创始人 Founder** | 海峰 | 前字节 TikTok / 美团策略专家，前「在行」产品负责人。长期处于内容平台、BPO 审核运营、产品策略与 AI 落地交叉地带，兼具 0→1 与大规模业务理解能力。 |
| **技术联合创始人 · 客户端 / 运行层** | 光政 | 字节资深全栈 / 前端工程师，前果壳在行高级前端工程师。负责客户端、前端运行层、Dashboard 与开发者使用体验。 |
| **运营联合创始人 · 增长 / 社区** | 梁卓 | 前在行项目运营负责人，一土科技社群运营负责人。负责开发者增长、产品化承接、用户反馈闭环与市场传播体系。 |
| **技术联合创始人 · 后端 / 平台** | 张博 | 阿里优酷、掌阅资深服务端架构师，前果壳在行资深服务端架构师。负责后端服务、稳定性、能力服务化与 API 平台设计。 |

---

## 🏅 荣誉与里程碑

- **2025 WAIC 世界人工智能大会** —— 受邀参展 *Future Tech* 项目。
- **2025 亚马逊云科技中国峰会（AWS China Summit）** —— 应邀作为分享企业登台。
- **800+ 企业客户** —— 商业旗舰产品识流已服务 800+ 家企业客户。

---

## 🌐 落地价值与就业带动

新公司计划在 **北京经济技术开发区（亦庄 · 经开区）** 注册落地，研发与生态团队在地建设。

- **技术创新** —— 面向真实桌面软件的国产 AI Agent 视觉执行引擎，补齐国产 Agent 基础设施空白。
- **产业赋能** —— 为中小企业提供低成本、可落地的 AI 劳动力，提升客服 / 运营 / 销售 / 跨境效率。
- **生态带动** —— 开源引擎聚开发者，旗舰应用验场景，开放平台连接行业服务商与企业客户。

未来 3 年预期带动就业：

| | |
| :-- | :-- |
| **50+** | 直接就业岗位（研发 / 产品 / 交付 / 销售 / 社区） |
| **500+** | 间接带动岗位（开发者生态、系统集成商、行业方案商） |
| **30%+** | 重点群体就业占比目标（高校毕业生、退役军人、残疾人、脱贫人口） |

> 用 SightFlow 重构客户运营，是把人力释放到更高价值岗位，而非单纯替代。

---

## 🤝 共建与社区

我们相信 **Agent Computer Use 会是未来 10 年重要 AI 革命的基建**。如果你也希望参与到这个项目的迭代，欢迎加入我们。

- 💬 **[加入 Discord](https://discord.com/invite/8H6KpbXq3t)** —— 与社区一起共建。
- ⭐ **[给项目点个 Star](https://github.com/sightflow-dev/sightflow-desktop-agent)** —— 这对我们真的很有帮助。
- 🛠 **参与贡献** —— 欢迎提交 Issue 与 Pull Request。

---

## 🔐 安全与数据归属

SightFlow 的执行轨迹（work-trace）**默认保存在本地** —— 不会上传到任何服务器，也不会进入任何公共训练数据集。代码开源不代表用户数据开源：**你的工作数据始终属于你。**

---

## 📄 开源协议

本项目采用 [Apache License 2.0](LICENSE) 开源协议。

---

## 📬 联系我们

- 🌐 **官网：** [sightflow.dev](https://sightflow.dev)
- ✉️ **邮箱：** [builder@sightflow.dev](mailto:builder@sightflow.dev)
- 💬 **Discord：** [加入社区](https://discord.com/invite/8H6KpbXq3t)
- ☎️ **商务与投资：** +86 156 5929 8139
- 📍 **北京经济技术开发区（亦庄）**

<div align="center"><sub>© 2026 SightFlow 视觉流动团队. 保留所有权利。</sub></div>

<p align="right"><a href="#readme-top">↑ 返回顶部</a></p>
