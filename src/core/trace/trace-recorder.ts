// src/core/trace/trace-recorder.ts
// TraceRecorder — 把引擎执行过程落成结构化工作轨迹
//
// 存储布局（baseDir 由 main 进程传入，通常是 <userData>/worktrace）：
//   <baseDir>/sessions/<sessionId>/session.json    会话元数据
//   <baseDir>/sessions/<sessionId>/trace.jsonl     每行一条 TraceStep
//   <baseDir>/sessions/<sessionId>/screenshots/<stepId>.png
//
// record() 同步构造 TraceStep 并返回（供 UI 实时推送），磁盘写入串行异步执行，
// 不阻塞引擎事件循环；写入失败只打日志，绝不影响主流程。

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppType } from '../rpa/types'
import { TraceSessionMeta, TraceStep, TraceStepInput } from './trace-types'

const SESSIONS_DIR = 'sessions'

export interface TraceSessionStartInput {
  appType: AppType
  engineVersion: string
  providerId?: string
  model?: string
}

export class TraceRecorder {
  private session: TraceSessionMeta | null = null
  private seq = 0
  /** 串行化磁盘写入，保证 jsonl 行序与 seq 一致 */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly baseDir: string) {}

  startSession(input: TraceSessionStartInput): TraceSessionMeta {
    if (this.session) {
      this.endSession()
    }

    const startedAt = Date.now()
    const session: TraceSessionMeta = {
      sessionId: createSessionId(startedAt),
      appType: input.appType,
      startedAt,
      engineVersion: input.engineVersion,
      providerId: input.providerId,
      model: input.model,
      stepCount: 0
    }

    this.session = session
    this.seq = 0
    this.enqueueWrite(async () => {
      await mkdir(this.screenshotsDir(session.sessionId), { recursive: true })
      await this.flushSessionMeta(session)
    })
    return session
  }

  isActive(): boolean {
    return this.session !== null
  }

  getActiveSessionId(): string | null {
    return this.session?.sessionId ?? null
  }

  /** 记录一步轨迹；返回构造好的 TraceStep（截图替换为相对路径），无活跃会话时返回 null */
  record(input: TraceStepInput): TraceStep | null {
    const session = this.session
    if (!session) return null

    this.seq += 1
    const step: TraceStep = {
      stepId: randomUUID(),
      sessionId: session.sessionId,
      seq: this.seq,
      ts: Date.now(),
      actor: input.actor ?? 'agent',
      phase: input.phase,
      summary: input.summary,
      reasoning: input.reasoning,
      action: input.action,
      outcome: input.outcome
    }

    const screenshot = input.screenshotBase64 ? parseScreenshotBase64(input.screenshotBase64) : null
    if (screenshot) {
      step.screen = { screenshotPath: path.join('screenshots', `${step.stepId}.png`) }
    }

    session.stepCount = this.seq
    this.enqueueWrite(async () => {
      if (screenshot && step.screen) {
        await writeFile(
          path.join(this.sessionDir(session.sessionId), step.screen.screenshotPath),
          screenshot
        )
      }
      await appendFile(
        path.join(this.sessionDir(session.sessionId), 'trace.jsonl'),
        `${JSON.stringify(step)}\n`,
        'utf8'
      )
    })
    return step
  }

  endSession(): void {
    const session = this.session
    if (!session) return

    this.session = null
    session.endedAt = Date.now()
    this.enqueueWrite(() => this.flushSessionMeta(session))
  }

  private enqueueWrite(task: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(task).catch((error) => {
      console.error('[TraceRecorder] 轨迹写入失败:', error)
    })
  }

  private async flushSessionMeta(session: TraceSessionMeta): Promise<void> {
    await mkdir(this.sessionDir(session.sessionId), { recursive: true })
    await writeFile(
      path.join(this.sessionDir(session.sessionId), 'session.json'),
      `${JSON.stringify(session, null, 2)}\n`,
      'utf8'
    )
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.baseDir, SESSIONS_DIR, sessionId)
  }

  private screenshotsDir(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'screenshots')
  }
}

// ── 轨迹读取（供 IPC / 回放 / 学习消费） ──

export async function listTraceSessions(baseDir: string): Promise<TraceSessionMeta[]> {
  const dir = path.join(baseDir, SESSIONS_DIR)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const sessions: TraceSessionMeta[] = []
  for (const entry of entries) {
    try {
      const raw = await readFile(path.join(dir, entry, 'session.json'), 'utf8')
      sessions.push(JSON.parse(raw) as TraceSessionMeta)
    } catch {
      // 跳过损坏 / 不完整的会话目录
    }
  }
  return sessions.sort((a, b) => b.startedAt - a.startedAt)
}

export async function readTraceSession(
  baseDir: string,
  sessionId: string
): Promise<{ session: TraceSessionMeta; steps: TraceStep[] } | null> {
  const dir = path.join(baseDir, SESSIONS_DIR, sessionId)
  let session: TraceSessionMeta
  try {
    session = JSON.parse(await readFile(path.join(dir, 'session.json'), 'utf8'))
  } catch {
    return null
  }

  let steps: TraceStep[] = []
  try {
    const raw = await readFile(path.join(dir, 'trace.jsonl'), 'utf8')
    steps = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as TraceStep)
  } catch {
    // 会话刚启动还没有步骤，返回空列表
  }
  return { session, steps }
}

/** 读取某一步的截图，返回 dataURL（供 renderer <img> 直接使用） */
export async function readTraceScreenshot(
  baseDir: string,
  sessionId: string,
  screenshotPath: string
): Promise<string | null> {
  // screenshotPath 来自 trace 数据，约束在 session 目录内，防目录穿越
  const normalized = path.normalize(screenshotPath)
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null

  try {
    const buffer = await readFile(path.join(baseDir, SESSIONS_DIR, sessionId, normalized))
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

function createSessionId(startedAt: number): string {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${stamp}-${randomUUID().slice(0, 8)}`
}

function parseScreenshotBase64(screenshot: string): Buffer | null {
  const dataUrlMatch = screenshot.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/)
  const base64 = dataUrlMatch ? dataUrlMatch[1] : screenshot
  if (!base64.trim()) return null
  try {
    return Buffer.from(base64, 'base64')
  } catch {
    return null
  }
}
