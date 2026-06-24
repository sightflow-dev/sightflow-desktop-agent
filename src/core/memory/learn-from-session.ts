// src/core/memory/learn-from-session.ts
// 「从这次轨迹学习」— 把一段 work-trace 归纳成经验卡片
//
// 两路归纳（都只用文字摘要，不传截图，控制成本与时延）：
//   1. AWM 式（Agent Workflow Memory）：把成功路径归纳成可复用的「多步 SOP / 策略卡」。
//   2. Reflexion / ExpeL 式：只在出现失败步骤时触发，把失败归纳成「规避卡」（下次别再踩）。
// 两路结果合并、去重、限量返回，卡片 schema 不变（scenario/guidance/rationale + 证据 stepIds）。

import { AIClient } from '../ai-client'
import { TraceSessionMeta, TraceStep } from '../trace/trace-types'

export interface InducedCard {
  scenario: string
  guidance: string
  rationale: string
  stepIds: string[]
}

const MAX_CARDS = 5

const INDUCE_SYSTEM_PROMPT = `你是一位资深业务教练。下面是一个 Agent 在电脑上自动工作的执行轨迹（按时间排序，可能跨聊天软件 / 浏览器 / 桌面应用）。

## 你的任务
从轨迹中归纳出 1-4 条可复用的「经验卡片」，让 Agent 下次遇到类似情况时表现更好。

## 要求
1. 每条经验包含三个字段：
   - scenario：触发条件，一句话描述"什么情况下适用"
   - guidance：该怎么做。**如果是多步操作流程（SOP），用有序步骤写清楚**，例如「1) … 2) … 3) …」；如果是单点话术/判断标准，直接写清楚
   - rationale：为什么这么做，业务判断依据（老员工的隐性经验）
2. 经验要可泛化：提炼模式与前置条件，不要复述某条具体消息或某个具体联系人
3. 优先归纳：可复用的多步操作流程(SOP)、回复话术风格、跳过/推进的判断标准
4. 没有值得沉淀的经验时输出空数组 []
5. 只输出 JSON 数组，不要任何解释或 markdown 代码块，格式：
[{"scenario":"...","guidance":"...","rationale":"...","refSeqs":[1,2]}]
（refSeqs 是支撑该经验的轨迹步骤序号）`

const REFLECT_SYSTEM_PROMPT = `你是一位善于复盘的业务教练。下面是一个 Agent 执行轨迹中**失败的步骤**及其上下文。

## 你的任务
针对这些失败做 Reflexion 复盘，归纳出 1-3 条「规避卡片」，让 Agent 下次避免重蹈覆辙。

## 要求
1. 每条卡片字段同样为 scenario / guidance / rationale：
   - scenario：什么前置条件下容易出现这个失败
   - guidance：下次应该怎么做才能避免（可执行的纠正动作）
   - rationale：为什么会失败 / 为什么这样改能避免
2. 聚焦根因，不要泛泛而谈；同类失败合并成一条
3. 没有可复盘的失败时输出空数组 []
4. 只输出 JSON 数组，格式同上：
[{"scenario":"...","guidance":"...","rationale":"...","refSeqs":[3]}]`

export async function induceCardsFromSession(
  ai: AIClient,
  session: TraceSessionMeta,
  steps: TraceStep[]
): Promise<InducedCard[]> {
  const bySeq = new Map(steps.map((step) => [step.seq, step.stepId]))

  // 1) AWM：成功路径 → 可复用 SOP / 策略卡
  const digest = buildTraceDigest(session, steps)
  const sopRaw = await ai.callText(`${INDUCE_SYSTEM_PROMPT}\n\n## 执行轨迹\n${digest}`)
  const cards = parseInducedCards(sopRaw, bySeq)

  // 2) Reflexion / ExpeL：仅当存在失败步骤时，额外做一次失败复盘
  const failedSteps = steps.filter((step) => step.outcome?.status === 'fail')
  if (failedSteps.length > 0) {
    const failDigest = buildFailureDigest(session, steps, failedSteps)
    const reflectRaw = await ai.callText(`${REFLECT_SYSTEM_PROMPT}\n\n## 失败步骤\n${failDigest}`)
    cards.push(...parseInducedCards(reflectRaw, bySeq))
  }

  return dedupeCards(cards).slice(0, MAX_CARDS)
}

/** 解析模型输出的 JSON 数组为 InducedCard[]，过滤无效项、映射 refSeqs → stepIds。 */
function parseInducedCards(raw: string, bySeq: Map<number, string>): InducedCard[] {
  return extractJsonArray(raw)
    .filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return typeof record.scenario === 'string' && typeof record.guidance === 'string'
    })
    .map((item) => ({
      scenario: String(item.scenario).trim(),
      guidance: String(item.guidance).trim(),
      rationale: typeof item.rationale === 'string' ? item.rationale.trim() : '',
      stepIds: (Array.isArray(item.refSeqs) ? item.refSeqs : [])
        .map((seq) => bySeq.get(Number(seq)))
        .filter((id): id is string => Boolean(id))
    }))
    .filter((card) => card.scenario && card.guidance)
}

/** 按 scenario 去重（同场景保留先出现的，AWM 卡优先于规避卡）。 */
function dedupeCards(cards: InducedCard[]): InducedCard[] {
  const seen = new Set<string>()
  const result: InducedCard[] = []
  for (const card of cards) {
    const key = card.scenario.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(card)
  }
  return result
}

/** 把轨迹压成 LLM 可读的文字摘要，按总长截断保护上下文 */
function buildTraceDigest(session: TraceSessionMeta, steps: TraceStep[]): string {
  const MAX_CHARS = 12_000
  const header = `应用：${session.appType}；开始时间：${new Date(session.startedAt).toLocaleString('zh-CN')}；共 ${steps.length} 步。`

  const lines: string[] = [header]
  let total = header.length
  for (const step of steps) {
    const parts = [`#${step.seq} [${step.actor}/${step.phase}] ${step.summary}`]
    if (step.reasoning?.content && step.reasoning.content !== step.summary) {
      parts.push(`判断：${step.reasoning.content}`)
    }
    if (step.action?.payload) {
      parts.push(`内容：${truncate(step.action.payload, 200)}`)
    }
    if (step.outcome) {
      parts.push(
        `结果：${step.outcome.status}${step.outcome.detail ? `（${truncate(step.outcome.detail, 100)}）` : ''}`
      )
    }
    const line = parts.join(' | ')
    if (total + line.length > MAX_CHARS) {
      lines.push(`…（其余 ${steps.length - step.seq + 1} 步因长度截断）`)
      break
    }
    lines.push(line)
    total += line.length
  }
  return lines.join('\n')
}

/** 失败复盘摘要：每个失败步骤 + 其前一步上下文，让模型看清「失败前发生了什么」。 */
function buildFailureDigest(
  session: TraceSessionMeta,
  steps: TraceStep[],
  failedSteps: TraceStep[]
): string {
  const bySeq = new Map(steps.map((step) => [step.seq, step]))
  const lines: string[] = [`应用：${session.appType}；共 ${failedSteps.length} 个失败步骤。`]
  for (const fail of failedSteps) {
    const prev = bySeq.get(fail.seq - 1)
    if (prev) lines.push(`#${prev.seq} [${prev.actor}/${prev.phase}] ${prev.summary}（前置上下文）`)
    const detail = fail.outcome?.detail ? `（原因：${truncate(fail.outcome.detail, 150)}）` : ''
    const reason = fail.reasoning?.content
      ? ` | 当时判断：${truncate(fail.reasoning.content, 150)}`
      : ''
    lines.push(
      `#${fail.seq} [${fail.actor}/${fail.phase}] ${fail.summary} -> 失败${detail}${reason}`
    )
  }
  return lines.join('\n')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 容错解析：剥掉 markdown 代码块、取第一个 [ 到最后一个 ] */
function extractJsonArray(raw: string): unknown[] {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
