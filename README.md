<a name="readme-top"></a>

<div align="center">

<img src="https://github.com/user-attachments/assets/99a7cfec-eb22-4f65-8a76-a6974e46bcf0" alt="SightFlow" width="840" />

<h1>SightFlow · The Open-Source Working Memory Engine</h1>

<p><strong>Bring AI into the real software world — read the screen, get the job done, and accumulate on-the-job experience.</strong></p>

<p>
  <a href="./README.md"><b>English</b></a>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md">简体中文</a>
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
  <a href="#-getting-started"><b>Get Started</b></a> ·
  <a href="#-how-it-works--see--think--do--learn"><b>How It Works</b></a> ·
  <a href="#-traction--commercial-validation"><b>Traction</b></a> ·
  <a href="#-market-opportunity"><b>Market</b></a> ·
  <a href="https://sightflow.dev"><b>Website</b></a>
</p>

</div>

---

## Overview

> **SightFlow does not replace the LLM. It completes the one layer the LLM cannot reach** — turning screen pixels into structured semantics, and task intent into real operations.

An enterprise's heaviest work does not live inside an LLM API. It lives **on the screen, inside human workflows**:

- **Many surfaces** — a single task spans multiple applications and windows.
- **Long horizons** — read → judge → act → follow up → recover. It is never one button click.
- **Tacit experience** — the real know-how lives in every judgment a senior employee makes, not in any document.

Large language models solved *thinking* and *speaking*. They have **not** yet solved *learning the job* and *doing it well*. SightFlow is the runtime that closes that gap — a desktop agent that **sees** any interface, **thinks** in business context, **acts** like a human operator, and **learns** from every execution.

---

## ✦ How It Works — See · Think · Do · Learn

```mermaid
flowchart LR
    SEE["👁 See<br/>Understand any GUI &amp; state"] --> THINK["🧠 Think<br/>Plan with business context"]
    THINK --> DO["✋ Do<br/>Click · Type · Switch · Send"]
    DO --> LEARN["📚 Learn<br/>Write a structured work-trace"]
    LEARN -. compounds into memory .-> THINK
```

| Stage | What happens |
| :-- | :-- |
| **See** | A vision model understands any software UI and its current state. |
| **Think** | The agent plans using business context and history to decide *what to do*. |
| **Do** | It clicks, types, switches windows, sends, and records — exactly like a human operator. |
| **Learn** | Every execution is written as a structured **work-trace**, building durable organizational memory. |

> This is not an app. It is a **working memory engine** that puts AI on the job.

---

## ✦ The Work Memory Runtime

Every execution becomes **one structured `work-trace`**:

```text
work-trace = {
  timestamp,    # when it happened
  ui_state,     # what the screen looked like
  rationale,    # WHY this decision was made
  action,       # click / type / switch / send
  result        # what happened next
}
```

Continuously written and replayable step by step, the runtime ships **three capabilities nobody else has**:

| Capability | Why it matters |
| :-- | :-- |
| 🔁 **Replay** | When something breaks, review every step — down to the decision behind it. |
| 📊 **Eval** | Swap models or versions and compare *business outcomes* quantitatively. |
| 🧬 **Inherit** | A great employee's judgment is, for the first time, retained by the organization. |

> Others record **the steps**. SightFlow records **why each step was taken**. That is the leap from **RPA** to a true **Agent Runtime**.

Enterprise-ready by design:

- 🔒 **Local-first execution** — data never leaves the enterprise.
- 🧾 **Fully auditable** — every action trace can be inspected end to end.
- 🔄 **Model-agnostic** — adapts to domestic vision LLMs by default, switchable across providers.

---

## ✦ Core Capabilities

From WeChat and WeCom to **any desktop software**, SightFlow lets AI work where there is **no API**.

- **Universal Vision-Based RPA** — No fragile webhooks or private protocols. SightFlow behaves exactly like a human user: manipulating inputs, reading chat bubbles, and navigating native UIs through abstract visual recognition.
- **State-of-the-Art Vision** — A unified vision layer extracts unread notification dots, message lists, and chat-bubble text in real time across complex, dynamic layouts.
- **Agentic Workspaces** — Turn unstructured chat requests into actionable node-workflows and API calls, fully programmable via local AI.

---

## ✦ Traction & Commercial Validation

> Not a lab project. SightFlow already generates revenue with real customers through its flagship application, **ShiLiu (识流)**, which serves high-frequency, complex, labor-intensive customer-operations scenarios.

| Metric | Value |
| :-- | :-- |
| **Revenue growth** | **12× QoQ** — 2026 Q1 revenue = 12× of 2025 Q4 |
| **Enterprise customers validated** | **800+** cumulative |
| **New enterprise customers** | **30+** in the last 3 months |
| **Strongest retention signal** | **4×** renewals by a single customer |
| **Open-source traction** | **460+** Stars · **150+** Forks |
| **Social reach** | **10M+** short-video impressions network-wide |

> Customers don't pay for software features. They pay for one outcome: **"the AI reliably finishes this work."**

---

## ✦ Market Opportunity

> The desktop is the largest **unoccupied** workplace. Our strategy is **narrow first, then wide** — start from messaging-based customer operations, then expand to every no-API / weak-API enterprise software surface.

**Entry market (verifiable bottom-up):** ~14M businesses use IM tools daily for customer communication.

| Scenario | Formula | Annual Market |
| :-- | :-- | :-- |
| **Conservative** | 14M × 20% × 1 seat × ¥2,000/yr | **¥5.6B / year** |
| **Aggressive** | 14M × 40% × 2 seats × ¥2,000/yr | **¥22.4B / year** |
| **Long-term vision** | Execution-layer rebuild of the global BPO market | **¥2.36T** |

**The three-step wedge:**

1. **Open source builds the standard** — an open frontend runtime layer establishes developer distribution and a de-facto standard.
2. **Commercial flagship** — stable revenue funds growth.
3. **Work-trace builds the moat** — every execution accumulates as structured data, compounding into industry-wide working memory.

---

## 🚀 Getting Started

SightFlow Desktop Agent is a cross-platform client built on **Electron · electron-vite · React · TypeScript**, driven by a Vision-Language Model (VLM).

**Prerequisites:** Node.js (LTS) and npm.

### 1. Install dependencies

```bash
npm install
```

### 2. Run in development

```bash
npm run dev
```

> On first launch, pick your **target application** and complete the region selection, then open **Settings** to enter your API key and confirm the active Provider.

### 3. Build a release

```bash
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

---

## ⚙️ Configuration

Desktop configuration has two layers:

- **Base configuration** — a Volcengine Ark API key powering visual grounding and the built-in Doubao agent.
- **Agent / Provider** — the provider responsible for chat analysis and reply generation.

### What the key is used for

1. **Smart replies** — the model analyzes chat-window screenshots and generates natural responses (with an anti-self-loop guard).
2. **VLM visual grounding** — from a screenshot and a prompt, the model locates on-screen UI controls and returns click coordinates, driving a pure-vision RPA flow.

### Steps

1. Open [Volcengine Console → Ark](https://console.volcengine.com/ark), enable the service, and generate your API key.
2. Launch the app and click the settings button at the bottom-right of the main window.
3. Under **Base configuration**, enter the API key. The default Base URL `https://ark.cn-beijing.volces.com/api/v3` rarely needs changing.
4. Under **Agent**, select the active Provider. The built-in default is **Doubao Seed** (`doubao-seed-2-0-lite-260428`).

### Interface preview

| Main | Base Configuration | Agent / Provider |
| :--: | :--: | :--: |
| <img width="240" alt="SightFlow main window" src="./docs/images/main.png" /> | <img width="360" alt="SightFlow base configuration" src="./docs/images/settings-base.png" /> | <img width="360" alt="SightFlow agent configuration" src="./docs/images/settings-provider.png" /> |

### Target applications & selection mode

The main window offers a **Target Application** shortcut that decides how the desktop client measures the chat-window layout:

- **WeChat** and **WeCom** use VLM auto-detection of the window region by default.
- **DingTalk, Feishu, Slack, Telegram**, and other desktop apps default to **manual selection**.
- When manual selection is required, click **Start Selection** and outline three regions in order: the **conversation list**, the **chat content area**, and the **input box**.
- Selections are saved locally per target application and reused on subsequent launches; you can re-select at any time.

> VLM vs. manual selection only affects *how layout is measured*. Runtime screenshots, content analysis, reply generation, and message sending all consume the same layout result.

### Provider Hub

SightFlow abstracts "analyze a screenshot and generate a reply" into an independent **Provider**. A provider declares its config schema via `manifest.json` and, through its bundle entry, receives a chat screenshot and returns `reply_text`, `skip`, and `error` events.

- The candidate list is fetched by default from `https://sightflow.dev/provider-hub.json`.
- The hub only tracks each provider's `manifestUrl`; UI fields come from each provider's manifest.
- Results are cached locally after first load; the local cache is preferred unless you refresh via the button next to the Agent title.
- **Doubao Seed** is always retained locally as the default provider, so there is always an option if the remote list is unavailable.

External provider integration is documented in the [Chat Provider docs](./docs/provider.md). A Doubao / Volcengine Ark sample remains in the repo for reference:

```text
resources/providers/volcengine-ark/manifest.json
resources/providers/volcengine-ark/provider.bundle.js
```

> **Recommended dev setup:** [VS Code](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode).

---

## 👥 Team

> Not a pure research team, not a pure sales team — a team that turns **capability into product** and pushes **product into the market**. Veterans of ByteDance/TikTok, Alibaba/Youku, and Meituan, covering the full product–frontend–backend–operations loop.

| Role | Member | Background |
| :-- | :-- | :-- |
| **Founder & CEO** | Haifeng (海峰) | Former ByteDance/TikTok & Meituan strategy expert; former product lead at Zaihang. Works at the intersection of content platforms, BPO moderation/operations, product strategy, and AI deployment — with both 0→1 and large-scale business depth. |
| **Co-Founder · Client & Runtime** | Guangzheng (光政) | Senior full-stack/frontend engineer at ByteDance; former senior frontend engineer at Guokr/Zaihang. Owns the client, frontend runtime layer, Dashboard, and developer experience. |
| **Co-Founder · Operations** | Liangzhuo (梁卓) | Former project operations lead at Zaihang and community operations lead at Yitu Tech. Owns developer growth, productization, the user-feedback loop, and market communication. |
| **Co-Founder · Backend & Platform** | Zhangbo (张博) | Senior server architect at Alibaba/Youku and iReader; former senior server architect at Guokr/Zaihang. Owns backend services, reliability, capability-as-a-service, and API platform design. |

---

## 🏅 Recognition & Milestones

- **2025 WAIC (World Artificial Intelligence Conference)** — invited to exhibit in the *Future Tech* program.
- **2025 AWS China Summit** — invited on stage as a featured sharing enterprise.
- **800+ enterprise customers** validated through the flagship product, ShiLiu.

---

## 🌐 Local Landing & Social Impact

The new entity will register and operate in the **Beijing Economic-Technological Development Area (BDA · E-Town)**, building its R&D and ecosystem team on the ground.

- **Technical innovation** — a domestic visual-execution engine for real desktop software, filling a gap in domestic Agent infrastructure.
- **Industry empowerment** — low-cost, deployable AI labor for SMEs across service, operations, sales, and cross-border.
- **Ecosystem** — the open-source engine gathers developers, the flagship validates scenarios, and an open platform connects service providers with enterprise customers.

Projected employment impact over three years:

| | |
| :-- | :-- |
| **50+** | direct jobs (R&D / product / delivery / sales / community) |
| **500+** | indirect jobs (developer ecosystem, system integrators, solution providers) |
| **30%+** | target share for priority groups (new graduates, veterans, people with disabilities, people lifted from poverty) |

> Rebuilding customer operations with SightFlow **frees people for higher-value work** — it augments rather than simply replaces.

---

## 🤝 Contributing & Community

We believe **Agent Computer-Use will be foundational infrastructure for the next decade of AI**. If you want to help build it, come join us.

- 💬 **[Join our Discord](https://discord.com/invite/8H6KpbXq3t)** — co-build with the community.
- ⭐ **[Star the repo](https://github.com/sightflow-dev/sightflow-desktop-agent)** — it genuinely helps.
- 🛠 **Contribute** — issues and pull requests are welcome.

---

## 🔐 Security & Data Ownership

SightFlow's work traces are stored **locally by default** — never uploaded to any server, never included in any public training dataset. Open-source code does **not** mean open data: **your work data always belongs to you.**

---

## 📄 License

Released under the [Apache License 2.0](LICENSE).

---

## 📬 Contact

- 🌐 **Website:** [sightflow.dev](https://sightflow.dev)
- ✉️ **Email:** [builder@sightflow.dev](mailto:builder@sightflow.dev)
- 💬 **Discord:** [Join the server](https://discord.com/invite/8H6KpbXq3t)
- ☎️ **Business & investment:** +86 156 5929 8139
- 📍 **Beijing Economic-Technological Development Area (E-Town)**

<div align="center"><sub>© 2026 SightFlow Team. All rights reserved.</sub></div>

<p align="right"><a href="#readme-top">↑ Back to top</a></p>
