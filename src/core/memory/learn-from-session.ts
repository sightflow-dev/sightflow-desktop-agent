// src/core/memory/learn-from-session.ts
// 「从这次轨迹学习」— 把一段 work-trace 归纳成经验卡片
//
// Phase 0 实现：单次 LLM 调用。把轨迹压成文字摘要（不传截图，控制成本与时延），
// 让模型以业务教练视角归纳 1-3 条可复用经验，输出严格 JSON。
// Phase 1 演进方向见规划文档：按场景聚类多 session、AWM 式 SOP 归纳。

import { AIClient } from '../ai-client'
import { TraceSessionMeta, TraceStep } from '../trace/trace-types'

export interface InducedCard {
  scenario: string
  guidance: string
  rationale: string
  stepIds: string[]
}

const INDUCE_SYSTEM_PROMPT = `你是一位资深客户运营教练。下面是一个 AI 助手在聊天软件中自动工作的执行轨迹（按时间排序）。

## 你的任务
从轨迹中归纳出 1-3 条可复用的「经验卡片」，让助手下次遇到类似情况时表现更好。

## 要求
1. 每条经验包含三个字段：
   - scenario：触发条件，一句话描述"什么情况下"
   - guidance：该怎么做，具体、可执行
   - rationale：为什么这么做，业务判断依据
2. 经验要可泛化：提炼模式，不要复述某条具体消息的内容
3. 优先归纳：回复话术风格、跳过/回复的判断标准、失败步骤的规避方法
4. 没有值得沉淀的经验时输出空数组 []
5. 只输出 JSON 数组，不要任何解释或 markdown 代码块，格式：
[{"scenario":"...","guidance":"...","rationale":"...","refSeqs":[1,2]}]
（refSeqs 是支撑该经验的轨迹步骤序号）`

export async function induceCardsFromSession(
  ai: AIClient,
  session: TraceSessionMeta,
  steps: TraceStep[]
): Promise<InducedCard[]> {
  const digest = buildTraceDigest(session, steps)
  const raw = await ai.callText(`${INDUCE_SYSTEM_PROMPT}\n\n## 执行轨迹\n${digest}`)
  const parsed = extractJsonArray(raw)

  const bySeq = new Map(steps.map((step) => [step.seq, step.stepId]))
  return parsed
    .filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return typeof record.scenario === 'string' && typeof record.guidance === 'string'
    })
    .slice(0, 3)
    .map((item) => ({
      scenario: String(item.scenario).trim(),
      guidance: String(item.guidance).trim(),
      rationale: typeof item.rationale === 'string' ? item.rationale.trim() : '',
      stepIds: (Array.isArray(item.refSeqs) ? item.refSeqs : [])
        .map((seq) => bySeq.get(Number(seq)))
        .filter((id): id is string => Boolean(id))
    }))
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
