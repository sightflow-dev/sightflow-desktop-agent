# SightFlow 开源 × 闭源结合战略规划（Henry Plan）

> 作者视角：Henry / SightFlow 核心团队
> 文档性质：**战略规划，不含代码改动**。目标是把「开源 SightFlow + 闭源识流（shiflow / thiflow）」这套资产，
> 按头部开源公司的成熟打法，重构成一条**边界清晰、护城河扎实、变现顺畅、合规安全**的开源商业化路线。
> 配套已有的产品能力规划见 [`learn-work-memory-plan.md`](./learn-work-memory-plan.md)（聚焦「学」能力落地）。本文聚焦**商业与治理战略**，两者互补。

---

## 0. 摘要（TL;DR）

一句话结论：**用永久宽松开源（Apache-2.0）的「桌面运行时 + 工作轨迹标准」去赢占标准与开发者心智，用闭源的「多租户云、团队记忆、计费网关、硬件反检测、OEM」去变现和筑墙——中间用 Provider Hub 这一插件机制把开源客户端无缝导流到付费云。**

- **现状**：开源版（`sightflow-desktop-agent`，Apache-2.0）边界划得干净、可独立运行、BYOK（火山方舟）；闭源版（`thiflow-agent-v2` + `shiflow-see` + 平台前端 + provider）承载全部商业能力，但**三名混用（sightflow/shiflow/thiflow）**、**存在系统性密钥泄露与合规缺口**。
- **头部公司共识**：开源赢「采纳与标准」，闭源赢「协作、规模、数据、合规」。买家掏钱买的是「团队/企业/合规」价值，个人开发者要的能力必须免费开源（GitLab 的「buyer-based open core」）。
- **对 SightFlow 的三条主线**：
  1. **标准先行**——把 `work-trace` 做成开放规范 + 中文企业软件 benchmark，抢「桌面 GUI 工作记忆」这个零竞争的定义权。
  2. **开源做漏斗**——开源客户端保持自包含 + BYOK，用官方 `shiflow` provider 一键切到托管云，形成「免费用 → 上云省心 → 团队协作付费」的自然升级路径。
  3. **闭源做护城河**——数据/团队记忆/云网关/硬件反检测/OEM 全部闭源，且**反检测与微信 RPA 相关能力永不进开源仓库**（法律与 ToS 红线）。
- **前置阻塞项（P0，必须先于任何开源扩张完成）**：
  - 闭源仓库已把生产密钥提交进 Git（`shiflow-see/common/enum.go`、`pkgs/oss.go`、`config/*.yaml`；`thiflow-agent-v2/scripts/oss-config.js` 的阿里云 OSS AK/SK + `.curl_log.md` 的 admin JWT）。**其中 OSS 桶正是热更新分发源，构成「AK 泄露 → 篡改热更新 → 全量客户端 RCE」的完整链条**。开源公司的代码是公开可读的前提下，这类问题等于把钥匙挂在门上。
  - 官方 `sightflow-provider` **无任何 LICENSE**，却被安装进 Apache-2.0 开源宿主——分发合规空白。
  - 开源宿主自身的 RCE 面（远程 provider 无签名即 `import()` 执行）、`skill-server` 无鉴权，是开源信任的减分项。

---

## 1. 现状盘点：五仓库资产地图

| 仓库 | 角色 | 开/闭源 | 技术栈 | 商业地位 | 关键风险 |
|---|---|---|---|---|---|
| `sightflow-desktop-agent` | 开源桌面 Agent（Provider 宿主） | **开源** Apache-2.0 | Electron 39 + React 19 + TS，VLM，BYOK | **获客漏斗 / 标准载体** | 远程 provider RCE、skill-server 无鉴权、IPC 无白名单、Key 明文 |
| `thiflow-agent-v2` | 商业桌面 Agent（同源分叉） | 闭源（无 License） | 同上 + 热更新 + 反检测 + NanoKVM | **付费客户端** | ⚠️ OSS AK/SK 入库 + admin JWT 入库 → 全量 RCE；98+ TS 错误带病发布 |
| `shiflow-see` | 平台服务端（`api.shiflow.com`） | 闭源（无 License） | Go 单体，多 LLM 抽象，Dialog v2 | **云 / 计费 / 数据护城河** | ⚠️ JWT_SECRET/几十个 API Key/DB 密码入库；admin 鉴权=`accountId!=8`；无鉴权中间件；无盐 MD5 |
| `sightflow_plaftorm` | 开发者 API 控制台 | 闭源前端 | Vite + React 18 + antd | **开放平台变现入口** | 单文件 2120 行；JWT 存 localStorage；mock key 进 bundle；命名拼写错 |
| `sightflow-provider` | 官方托管 provider 插件 | 闭源（**无 License**） | Node ESM bundle | **开源→闭源的桥** | 无 License 却装进 Apache 宿主；落盘用户聊天截图；测试与产物已 drift |

**血缘与耦合**：五仓同源（命名遗迹 `Shiflow*` / `thiflow-sight-provider` / `thiflow-model-api`），中枢是 `api.shiflow.com`（=`shiflow-see`）。开源版通过 Provider Hub（默认 `https://sightflow.dev/provider-hub.json`）拉候选，官方 `shiflow` provider 用 `wss://api.shiflow.com/ws/shiflow/open/stream/chats` 把「截图→回复」接到闭源云。**这条链就是天然的开源→商业变现通道**，是本战略最重要的既有资产。

**当前边界评价**：
- ✅ 开源版**没有把关键功能锁在私有后端后面**，可完全离线（BYOK）跑通——这是正确的「开源要真能用」姿态。
- ⚠️ 但**三处命名不统一 + `plaftorm` 拼写错**，对一个要做开发者品牌的开源公司是硬伤。
- ⚠️ 开源与闭源之间**没有正式的边界契约**（provider WS 字段无 schema 版本管理，已出现 `image_base64` vs `base64_data` 的 drift）。

---

## 2. 头部公司开源商业化打法拆解

选取与 SightFlow 处境最相关的 10 家，提炼可迁移原则。

| 公司 / 项目 | 开源部分 | 闭源 / 收费部分 | 许可证打法 | 对 SightFlow 的启示 |
|---|---|---|---|---|
| **GitLab** | 社区版 CE（完整 DevOps 内核） | 企业版 EE（合规/审计/多团队/SSO） | 单一代码库，`ee/` 目录 + MIT/商业双许可 | **Buyer-based open core**：判断一个功能开还是闭，问「掏钱的是个人还是经理/CISO」。个人要的必开源。 |
| **HashiCorp** | Terraform/Vault 等内核（曾 MPL） | Cloud（TFC/HCP）、企业版 | 2023 改 **BSL 1.1**（禁竞品托管，4 年后转开源）→ 引发 OpenTofu fork | 关系型「防云厂商白嫖」有效但**会激怒社区、招致 fork**。改 License 是核选项，谨慎且要趁早（而非爆红后）。 |
| **Elastic** | Elasticsearch/Kibana | Elastic Cloud、白金功能 | Apache→**SSPL/Elastic License**（防 AWS）→后又加回 **AGPL** | 云厂商威胁真实存在；但对**非基础设施型、需要客户端安装**的产品（如 SightFlow），云厂商直接转售威胁较低，可更宽松。 |
| **Databricks / Spark** | Apache Spark（**捐给 Apache 基金会**） | Databricks 平台（Notebook/Delta/治理） | 内核中立化 → 平台闭源变现 | **把标准/内核中立化以最大化采纳，把平台闭源变现**。若要做 `work-trace` 标准，中立托管（基金会/独立仓）能极大提升被采纳率。 |
| **dbt Labs** | dbt-core（Apache-2.0）+ **定义了行业标准** | dbt Cloud（编排/协作/血缘） | Apache 内核 + 云闭源；近期部分转 商业源可得 | **标准即护城河**：dbt 靠「定义了 analytics engineering 工作方式」赢，不是靠功能。SightFlow 的机会正是「定义桌面 Agent 工作轨迹」。 |
| **Supabase** | 全栈开源（Firebase 替代） | 托管 + 企业支持 | Apache-2.0 / MIT，**几乎全开源** | 「开源的 X 替代品」定位清晰、社区极旺；变现全靠**托管省心**而非闭源功能。适合早期最大化势能。 |
| **n8n** | 完整工作流引擎 | Cloud + 企业（RBAC/SSO/环境） | **Sustainable Use License（source-available，fair-code）** | 与 SightFlow **最像**（自动化 + 节点/工作流）。source-available 允许自用、禁转售，兼顾透明与防白嫖，是「非纯 OSS 但很成功」的样板。 |
| **Sentry** | 全部产品代码 | 云托管 | **FSL / BSL**（时间延迟开源：2 年后转 Apache） | **Delayed Open Source（FSL）**是 2024+ 最时髦的折中：源码全公开、禁竞品、到期自动 OSS。防白嫖同时保留开源信誉。 |
| **PostHog** | 主体 MIT | `ee/` 目录企业功能单独许可 | MIT + 目录级商业许可 | **目录级混合许可**在单仓内切开源/闭源，工程上干净，值得借鉴到 monorepo。 |
| **Grafana** | Grafana（AGPL） | Grafana Cloud + 企业插件 | Apache→**AGPL**（防托管白嫖） | AGPL 对「会被别人架成 SaaS」的产品是温和有效的防线；对桌面客户端意义不大，但对 `shiflow-see` 后端若未来开源可考虑。 |

**跨公司提炼的六条可迁移原则：**

1. **开源赢采纳，闭源赢协作。** 分界线不是「功能强弱」，而是「价值归属于个人还是组织」。个人开发者 5 分钟能跑通的核心体验必须开源且真好用。
2. **标准 > 功能。** dbt / Spark / Terraform 的护城河是「定义了做事方式」。SightFlow 唯一能抢的全球零竞争标准是 **桌面 GUI 工作轨迹（work-trace）**——这是最高杠杆的战略资产。
3. **License 是战略武器，且要趁早定。** 纯宽松（Apache/MIT）最大化势能；source-available（n8n）/ 延迟开源（FSL/BSL，Sentry）防白嫖但保信誉；copyleft（AGPL/SSPL）针对「被架成 SaaS」。**改 License 越晚越痛（HashiCorp 教训）**，方向要现在就想清楚。
4. **中立化内核可换采纳率。** 把标准与最小内核放到独立/中立治理下，换取生态愿意基于它构建。
5. **单一代码库 + 目录级许可（`ee/`）** 是工程上管理开/闭源最省事的形态（GitLab/PostHog）。
6. **变现靠「省心 + 协作 + 合规」**，不是靠「把基本功能藏起来逼氪」——后者只会催生 fork。

---

## 3. 战略定位：SightFlow 该走哪条路

**北极星：成为「桌面 Agent 工作记忆」的事实标准与最好用的开源运行时；识流（shiflow）是其唯一官方托管云与企业记忆中枢。**

差异化坐标（对标业内）：
- 不是「又一个 computer-use 模型」——SightFlow 补的是模型够不到的一层（把屏幕像素→语义、意图→操作、执行→可继承经验）。
- 不是「又一个 RPA」——RPA 记步骤，SightFlow 记「为什么这么做」（work-trace 五元组），这是从 RPA 到 Agent Runtime 的跃迁。
- **主场是中文企业软件（微信/钉钉/飞书/ERP）**——所有西方数据集/录制器都不覆盖，这是零竞争的语料与 benchmark 位置。

**为什么这条路对 SightFlow 成立（而非无脑全开源或全闭源）：**
- 全闭源：拿不到采纳、拿不到标准定义权、拿不到社区语料，会被大厂 computer-use 用生态碾压。
- 全开源：护城河只剩「托管省心」，而 SightFlow 的真护城河是**数据（工作轨迹语料）+ 企业记忆 + 硬件反检测**——这些必须闭源且中心化才成立。
- 因此 **open-core 是唯一正确解**：开源足够多以赢标准与获客，闭源足够关键以变现与筑墙。

---

## 4. 开源 / 闭源边界设计（The Open-Core Line）

**判定规则（写进团队心智，每个新功能都过一遍）：**
> 「这个能力，掏钱的是**个人**还是**组织/企业**？带来的价值是**单机体验**还是**协作/规模/合规/数据**？涉及**法律与 ToS 红线**吗？」
> 个人 + 单机体验 → **开源**；组织 + 协作/规模/合规/数据 → **闭源**；法律红线 → **闭源且严格收敛**。

### 4.1 开源侧（永久 Apache-2.0，做大做好）

| 能力 | 现状 | 战略动作 |
|---|---|---|
| 桌面运行时（See/Think/Do 闭环） | 已开源、可独立跑 | 保持自包含 + BYOK，持续打磨「5 分钟跑通」体验 |
| **work-trace 记录 + 本地回放**（Learn v0） | 刚落地 | 开源，且升级为**开放规范**（见 §6.1）——这是标准杠杆 |
| Provider 插件 SDK + Provider Hub 客户端 | 已开源 | 开源，作为「开源→云」的导流桥；补签名机制（§9） |
| 本地经验卡片（单机 SOP） | Learn v0 | 开源（个人价值）；团队级共享记忆 → 闭源 |
| BYOK 直连（火山方舟等） | 已开源 | 开源，永远保留「不依赖识流云也能用」 |
| work-trace 规范 + 校验器 + 转换器（OSWorld/ATIF/OTel） | 未做 | **独立中立仓库**开源（见 §6.1） |

### 4.2 闭源侧（识流商业，护城河）

| 能力 | 所在仓库 | 为什么闭源 |
|---|---|---|
| 多租户云后端 / 计费网关（`api.shiflow.com`） | `shiflow-see` | 规模 + 计费 + 数据中心化，是变现主体 |
| 托管模型网关（JWT 鉴权代理 doubao，用量计费） | `shiflow-see` + `sightflow-provider` | 「上云省心」的核心卖点；与 BYOK 形成免费↔付费分层 |
| **团队 / 企业记忆中枢**（跨席位继承、组织 SOP 库、管理 Dashboard） | `shiflow-see` | 组织价值、协作价值 → 典型 buyer-based 付费点 |
| 热更新体系（Biz/Renderer 免整包升级） | `thiflow-agent-v2` | 运营能力，非个人价值 |
| **硬件反检测（NanoKVM）+ Helper 进程隔离 + 仿人操作** | `thiflow-agent-v2` + `@thiflow/robot` | ⚠️ **法律/ToS 红线，永不开源**（详见 §9.3） |
| OEM / 白牌打包 | `thiflow-agent-v2` | 商业分发能力 |
| 开放平台控制台（注册/充值/Key/QPS） | `sightflow_plaftorm` + `shiflow-see` | 变现入口 |
| Coze/Dify/飞书/企微 深度集成、主动运营、KOC 分销 | `shiflow-see` | B 端/企业协作能力 |
| 中文企业软件工作轨迹**语料库**（脱敏后） | 云侧 | **最深的护城河**：数据资产，别人无法复制 |

### 4.3 边界契约（必须补的工程约定）

开源与闭源之间目前**没有正式契约**，已出现 drift。要建立：
- **Provider 事件 / WS 协议的版本化 schema**（`apiVersion` 已有雏形，但 payload 字段无版本管理）。把 `base64_data / app_type / actions(keyboard/stop-reply/qps-limit)` 固化为带版本号的公开契约，开源侧与闭源侧共同遵守，任一方改字段必须走版本升级。
- **work-trace schema 作为开放边界**：开源侧产出、闭源云侧消费，schema 归开放规范管辖，保证「开源客户端 + 任意云（含自建）」可互操作。

---

## 5. 许可证与知识产权策略

### 5.1 分层许可矩阵（建议）

| 资产 | 建议许可证 | 理由 |
|---|---|---|
| `sightflow-desktop-agent`（开源客户端） | **保持 Apache-2.0** | 最大化采纳与信任，含专利授权条款，对企业友好 |
| `work-trace-spec`（新，标准仓） | **Apache-2.0 / CC-BY**（规范文本用 CC-BY，参考实现用 Apache） | 标准要最大化被采纳，越宽松越好；可考虑中立托管 |
| 官方 `sightflow-provider`（示例/开源部分） | **补上 Apache-2.0**（P0，见 §9） | 消除「无 License 装进 Apache 宿主」的合规空白 |
| `shiflow-see` 后端 | **保持闭源**（默认保留所有权利），未来若开放取**源码可得**（BSL/FSL） | 后端是变现主体，无需开源；若为透明度选择性开放，用延迟开源防白嫖 |
| `thiflow-agent-v2` 商业客户端 | **保持闭源** | 商业外壳，尤其反检测部分不可公开 |
| 企业功能（若未来进单仓） | **目录级商业许可（`ee/`）** | 借鉴 GitLab/PostHog，单代码库内切分 |

**关于「要不要改 License 防白嫖」的判断：**
- SightFlow 是**需要本地安装 + 用户自带算力**的桌面产品，**不像数据库/中间件那样容易被云厂商一键转售**，被白嫖的结构性风险显著低于 Elastic/HashiCorp。
- 因此**现阶段建议维持 Apache-2.0 最大化势能**，把「延迟开源 / source-available」作为**后端若开放时**的工具，而非现在给客户端加锁。
- **教训铭记**：HashiCorp 在爆红后改 License 招致 OpenTofu fork。**若判断未来必须收紧，越早越好**；一旦社区壮大再收紧代价极高。→ 现在就把「未来是否可能改 License」在 CONTRIBUTOR 协议里预留空间（见 5.2）。

### 5.2 贡献者协议与商标

- **CLA 或 DCO 二选一**：
  - 若想保留「未来重新授权 / 出商业版」的灵活性 → 用 **CLA**（贡献者授予公司再许可权，GitLab/n8n 路线）。
  - 若优先社区好感、承诺永不 relicense → 用 **DCO**（更轻、更受社区欢迎，PostHog/Chef 路线）。
  - **建议：CLA**——SightFlow 明确要做 open-core 商业，需要保留 License 灵活性；用清晰的 CLA + 透明的开源承诺来平衡。
- **商标策略**：注册 `SightFlow` 商标；发布**商标使用政策**（允许 fork 代码，但不得用 SightFlow 品牌分发 / 冒充官方）。这是「代码可 fork、品牌不可 fork」的标准防线（见 §12 反 fork）。
- **品牌统一（P1）**：终结 `sightflow / shiflow / thiflow` 三名混用与 `plaftorm` 拼写错。对外统一 **SightFlow**（开源 + 全球品牌），**识流 / shiflow** 作为中国区商业主体与后端域名可保留，但需在文档中明确「SightFlow = 识流开源版」的对应关系，避免开发者困惑。

---

## 6. 护城河设计

开源之后，「代码」不再是壁垒。真正的护城河是这四层，全部闭源/中心化：

### 6.1 标准护城河：work-trace 开放规范（最高杠杆）
- 独立仓库 `work-trace-spec` 发布 **v0.1 规范 + JSON Schema 校验器 + OSWorld/ATIF/OTel 转换器**；兼容 OTel GenAI semantic conventions，扩展 GUI 字段（屏幕状态、坐标、人机来源 `actor: agent|human`、接管事件）。
- **先发者定标准**：目前无人定义「桌面 GUI 工作轨迹」格式。谁先发布被采纳的规范，谁就掌握生态语言。
- 配套**中文企业软件 benchmark**（微信/钉钉/ERP 场景评测集 + 排行榜）——「别人评测网页，我们评测真实岗位」，全球零竞争。
- 数据模型已在 `learn-work-memory-plan.md` §3 设计（`TraceSession/TraceStep/ExperienceCard`），可直接演进为规范 v0.1。

### 6.2 数据护城河：中文企业工作轨迹语料库
- 用户执行 → 脱敏 work-trace → 组织级/行业级语料。**这是别人无法复制的资产**（隐私合规前提下，见 §9）。
- 注意与开源承诺的张力：README 明确「数据本地优先、永不上传」。→ **语料上云必须是显式 opt-in、脱敏、企业可控**，且只在**闭源云/团队版**发生，开源单机版坚持本地。这条红线不能破，否则毁掉开源信任。

### 6.3 云护城河：托管省心 + 团队记忆
- 托管模型网关（免配 Key、用量计费）、团队经验库、跨席位继承、管理 Dashboard——组织越大越离不开。

### 6.4 硬件 / 反检测护城河
- NanoKVM 硬件输入 + Helper 进程隔离 + 仿人曲线——工程门槛高、**且法律敏感必须闭源**（§9.3），天然只能是商业版能力。

---

## 7. 商业化与分层

### 7.1 产品分层（借鉴 GitLab buyer-based）

| 层级 | 目标用户 | 形态 | 关键能力 | 变现 |
|---|---|---|---|---|
| **Community（开源免费）** | 个人开发者 / 极客 | 开源客户端 + BYOK | See/Think/Do、本地 work-trace、本地回放、单机经验卡片、Provider SDK | 免费（获客 + 标准） |
| **Pro（个人付费）** | 重度个人用户 | 开源客户端 + 官方 provider | 托管模型网关（免配 Key）、云端轨迹备份、更强模型 | 订阅 / 用量 |
| **Team（团队）** | 中小团队 | 商业客户端 + 云 | **团队记忆共享、跨席位 SOP 继承、协作 Dashboard、成员管理** | 按席位 |
| **Enterprise（企业）** | 大型企业 | 商业客户端 + 私有部署 | 私有化部署、SSO/RBAC/审计、硬件反检测、数据不出企业、SLA | 合同 |
| **OEM / 白牌** | 渠道 / 集成商 | 定制包 | 白牌、独立品牌、渠道分成 | License 分成 |

**分界纪律**：Community 层要「真能干活」，不搞阉割逼氪；付费点全部落在**省心（托管）/ 协作（团队记忆）/ 合规（私有化+审计）/ 规模**上。

### 7.2 变现漏斗（复用既有资产）
```
开源客户端（免费, BYOK）
   │  用户嫌配 Key 麻烦 / 想要更稳
   ▼  一键切换官方 shiflow provider（Provider Hub 既有机制）
Pro（托管网关, 用量计费）
   │  团队要共享经验 / 统一管理
   ▼
Team（团队记忆 + Dashboard）
   │  企业要私有化 / 合规 / 反检测 / SLA
   ▼
Enterprise / OEM
```
这条漏斗**几乎全部基于已有代码资产**（Provider Hub + 托管 WS 网关 + 计费体系已存在），战略上只需「把它显性化、产品化、去掉阻塞项」。

---

## 8. 治理、社区与生态

### 8.1 生态：从 Provider Hub 到 SOP / Skill Hub
- 现有 `provider-hub.json`（`sightflow.dev` 托管）→ 扩展为**双 Hub**：Provider Hub（模型/服务接入）+ **SOP / Skill Hub**（经验卡片、行业 SOP 模板市场）。
- `skill-server.ts` 已暴露本地控制面（供 OpenClaw 等外部编排器）→ 演进为**开放的轨迹/记忆 API**，让第三方 Agent 消费 SightFlow 工作记忆，做成生态位。

### 8.2 社区节奏（对标 dbt/PostHog 的「透明 + 内容」打法）
- 每月发布**脱敏轨迹数据集 + 技术报告**（AWM 闭环 + 中文企业场景是可发表的学术点）。
- 公开路线图、公开 issue 分级、Discord 共建（已有 Discord）。
- 「Good first issue」贡献漏斗；核心维护者 + 外部贡献者的 RFC 流程。

### 8.3 治理结构
- 短期：**公司主导（company-led OSS，vendor-led）**，像 n8n/Supabase，效率优先。
- 中期（若 `work-trace-spec` 要成事实标准）：**把规范仓中立化**（独立治理 / 引入外部编辑委员会 / 甚至捐给基金会），换取竞品与大厂愿意采纳——Spark 捐给 Apache 的逻辑。**内核中立、平台闭源**是关键平衡。

---

## 9. 合规与安全整改（开源扩张的前置阻塞项，P0）

> **这是本规划里唯一「不做就不能往下走」的部分。** 一个开源公司的仓库是公开可读的；一旦扩大开源足迹、吸引审视，任何入库密钥、合规瑕疵都会被放大成信任灾难。以下为**治理动作**（本文不改代码，仅规划）。

### 9.1 密钥泄露事故处置（最高优先级）
- **`shiflow-see`**：`common/enum.go` 的 `JWT_SECRET_KEY` + 几十个第三方 LLM/服务密钥、`pkgs/oss.go` 的阿里云 AK/SK、`config/*.yaml` 的 MySQL/Redis/企微/飞书凭据——**全部视为已泄露**：立即**吊销 + 轮换**，迁移到 KMS / Vault / 环境变量，并**清洗 Git 历史**（BFG / filter-repo）。
- **`thiflow-agent-v2`**：`scripts/oss-config.js` 的阿里云 OSS AK/SK 与 `.curl_log.md` 的 admin JWT——**同样立即吊销轮换 + 清史**。
  - ⚠️ **最危险的链条**：该 OSS 桶（`shiflowagent-auto-update`）正是热更新分发源，且热更新**只做 SHA256 完整性校验、无非对称签名**。AK 泄露 = 攻击者可写恶意 `latest.json` + 恶意 `biz/index.js`（自算 hash）→ 客户端 `require()` 加载 → **全量用户主进程 RCE**。→ **热更新必须引入发布方私钥签名 + 客户端内置公钥验签**，并校验解压路径。
- 全组织落地 **secret scanning**（gitleaks / GitHub secret scanning）+ pre-commit 钩子，杜绝再次入库。

### 9.2 鉴权与后端加固（`shiflow-see`）
- `admin` 鉴权从硬编码 `accountId != 8` 换成 **RBAC**；补**组级鉴权中间件**（当前 `pkgs/gin` 无 auth 中间件，靠每个 handler 自觉，漏一个即未授权可达）。
- 口令从**无盐 MD5** 换 **bcrypt/argon2**；用户自定义 LLM Key **加密存储**；`BackendWrapperHandler` 的 MD5 签名加时间戳/nonce 防重放。
- 静态调试页（`admin.html` / `see_dialogv2_debug.html`）移出公网 `/static`。

### 9.3 法律与 ToS 红线（战略级，影响开源边界）
- **反检测 / 反指纹 / 硬件绕过检测（NanoKVM）/ 自动操作微信** 处于**平台 ToS 与法律灰区**。这类能力：
  1. **永不进开源仓库**（开源版当前已正确排除，保持）；
  2. 在闭源商业版中也应**收敛表述、审慎合规**（面向「企业授权环境下的自动化」定位，而非「绕过平台检测」）；
  3. 对外叙事与 README 避免强调「绕过检测」，改为「像人一样操作、企业内授权使用」。
- 开源版 README 主打「本地优先、数据归你」是**极好的信任资产**，务必与「云侧语料收集」严格隔离，避免叙事自相矛盾。

### 9.4 开源宿主自身加固（信任分）
- 远程 provider **无签名即 `import()`/`require()`** = 主进程 RCE 面 → 加 **provider 签名 / 来源校验 / 权限沙箱**。
- `skill-server` 无鉴权 + CORS `*` → 加**随机启动 token + Origin/Host 校验**。
- IPC preload 泛化 `invoke/on/send` → 改**显式通道白名单**；`sandbox:false` 收敛。
- API Key 明文落 `electron-store` → 启用 `encryptionKey` / 系统钥匙串。

### 9.5 provider 合规空白（P0）
- 官方 `sightflow-provider` **补 LICENSE**（Apache-2.0，与宿主一致），并明确其「落盘用户聊天截图到 tmp」的调试行为需**默认关闭 + 显式开关 + 清理策略**，与隐私叙事对齐。

---

## 10. 仓库与发布工程

### 10.1 目标仓库形态

**建议：polyrepo 为主 + 一个可选的产品 monorepo**，分三类清晰治理：

| 类别 | 仓库 | 许可 | 说明 |
|---|---|---|---|
| **开源** | `sightflow-desktop-agent`、`work-trace-spec`（新）、`sightflow-provider`（补 License） | Apache-2.0 | 对外品牌 `sightflow-dev/*`，社区面 |
| **闭源商业** | `thiflow-agent-v2`、`shiflow-see`、`sightflow_plaftorm` | 闭源 | 商业主体 `shiflow2023/*` |
| **私有依赖** | `@thiflow/robot` 等 | 闭源 | 硬件/反检测，SSH 私有拉取 |

- 若未来企业功能与开源客户端同源演进压力大，可考虑 GitLab/PostHog 式**单代码库 + `ee/` 目录商业许可**，避免 `thiflow-agent-v2` 与 `sightflow-desktop-agent` 持续分叉（当前二者「结构同源、实现分叉、几乎无逐字节相同源文件」，长期维护成本高）。**优先收敛这条分叉线**。

### 10.2 发布工程
- 开源客户端：规范化 release（changelog、语义化版本、签名产物、SBOM）。
- 闭源热更新：引入**非对称签名**（见 §9.1），修复「98+ TS 错误带病发布」的质量门（CI 阻断）。
- 边界契约：把 Provider/WS/work-trace schema 纳入 CI 兼容性测试（防 drift）。

---

## 11. 分阶段路线图

### 阶段 A（0–1 个月）：止血 + 定线
- **P0 安全**：吊销/轮换全部入库密钥、清 Git 历史、上 secret scanning（§9.1）。
- **P0 合规**：`sightflow-provider` 补 License（§9.5）。
- **定线**：本规划评审拍板（§13 决策清单）；确定 License 分层与 CLA/DCO（§5）；确定品牌统一方案（§5.2）。

### 阶段 B（1–3 个月）：标准 + 漏斗显性化
- 发布 `work-trace-spec v0.1`（规范 + 校验器 + 1 个转换器）（§6.1）。
- 把「开源→Pro」漏斗产品化：官方 provider 一键上云体验打磨 + 计费闭环（§7.2）。
- 开源宿主信任加固（provider 签名、skill-server 鉴权、Key 加密）（§9.4）。
- 后端 P1 加固（RBAC、鉴权中间件、口令哈希）（§9.2）。

### 阶段 C（3–6 个月）：护城河 + 社区
- 团队记忆 / 企业记忆中枢 MVP（Team 层变现）（§6.3）。
- 中文企业软件 benchmark + 首个脱敏轨迹数据集发布（§6.1）+ 月度技术报告节奏（§8.2）。
- 收敛 `thiflow-agent-v2` × `sightflow-desktop-agent` 分叉（评估单仓 `ee/`）（§10.1）。
- 热更新非对称签名上线（§9.1）。

### 阶段 D（6–12 个月）：生态 + 中立化
- SOP/Skill Hub 上线，开放轨迹/记忆 API（§8.1）。
- 评估 `work-trace-spec` 中立治理 / 基金会路径（§8.3）。
- Enterprise 私有化 + OEM 渠道成型（§7.1）。

---

## 12. 风险与对策

| 风险 | 说明 | 对策 |
|---|---|---|
| **被大厂 computer-use 复制** | OpenAI Operator / Anthropic computer-use / 国内大厂 | 用**标准 + 中文企业语料 + 硬件反检测**做差异化；速度抢占标准定义权 |
| **社区 fork（尤其若改 License）** | HashiCorp→OpenTofu 教训 | 现在维持 Apache 势能；**代码可 fork、品牌不可 fork**（商标政策）；用云/数据/硬件护城河而非 License 锁 |
| **法律 / ToS（微信 RPA、反检测）** | 平台封禁、合规风险 | 反检测永不开源；商业版定位「企业授权自动化」；法务审阅叙事（§9.3） |
| **开源承诺 vs 数据变现张力** | 「本地优先」与「语料上云」矛盾 | 语料严格 opt-in + 脱敏 + 仅云/团队版；开源单机版坚守本地（§6.2） |
| **密钥泄露已发生** | 后端 + 客户端多处入库、含热更新 AK | §9.1 立即处置，视为已泄露 |
| **命名/品牌混乱削弱开发者信任** | sightflow/shiflow/thiflow + 拼写错 | §5.2 品牌统一 |
| **开源与闭源 drift** | provider/WS 字段已 drift | §4.3 版本化边界契约 + CI 兼容测试 |

---

## 13. 需要 Henry 拍板的关键决策

1. **License 分层**：开源客户端维持 Apache-2.0（建议是）；后端未来若开放，走 FSL/BSL 延迟开源还是永久闭源？
2. **CLA vs DCO**：为保留 open-core 灵活性建议 CLA——是否接受其社区成本？
3. **品牌统一**：对外统一 `SightFlow`、中国区商业保留「识流/shiflow」——是否照此收敛，并修 `plaftorm` 拼写与三名混用？
4. **分叉收敛**：`thiflow-agent-v2` 与开源客户端是否合并为单代码库 + `ee/`，还是维持双仓分叉？
5. **标准中立化**：`work-trace-spec` 是否走独立/中立治理（甚至基金会），以换取竞品采纳？
6. **数据边界红线**：语料上云的 opt-in/脱敏策略边界（决定「本地优先」叙事的可信度）。
7. **P0 排期**：密钥吊销 + 清史 + provider 补 License 是否立即启动（建议本周）。

---

> 本文为战略规划，未改动任何代码。落地时的产品能力细节（尤其「学」）见 [`learn-work-memory-plan.md`](./learn-work-memory-plan.md)。
