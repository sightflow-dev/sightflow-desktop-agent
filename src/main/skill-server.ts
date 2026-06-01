/**
 * Skill HTTP Server — 为 OpenClaw 提供本地 HTTP 控制接口
 *
 * 仅监听 127.0.0.1，提供以下端点：
 * - POST /skill/start  — 启动智能体
 * - POST /skill/pause  — 暂停智能体
 * - GET  /skill/status — 查询当前运行状态
 *
 * 所有调用都会路由到 SkillEngineController 提供的回调里执行。
 * 回调本身复用主进程已有的引擎启动 / 停止 / 状态查询逻辑，避免逻辑重复。
 */
import * as http from 'http'
import { TOKEN_HEADER, extractSkillToken, isAllowedSkillHost } from './security-policy'

const PRIMARY_PORT = 12680
const FALLBACK_PORT = 12681
const skillServerToken = process.env.SIGHTFLOW_SKILL_TOKEN?.trim() || ''

export type SkillStartReason =
  | 'no_vision_key'
  | 'no_provider'
  | 'missing_required_field'
  | 'engine_failed'
  | 'already_running'
  | 'wizard_cancelled'

export type SkillPauseReason = 'not_running' | 'pause_failed'

export interface SkillStartResult {
  ok: boolean
  reason?: SkillStartReason
  message?: string
}

export interface SkillPauseResult {
  ok: boolean
  reason?: SkillPauseReason
  message?: string
}

export interface SkillEngineController {
  /** 启动引擎；返回业务级结果，不抛异常 */
  start(): Promise<SkillStartResult>
  /** 暂停引擎；返回业务级结果，不抛异常 */
  pause(): Promise<SkillPauseResult>
  /** 查询当前是否在运行 */
  isRunning(): boolean
}

let server: http.Server | null = null
let controller: SkillEngineController | null = null

/** 并发锁：同一时间只能有一个 start/pause 操作 */
let skillOperationLock = false

function jsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json'
  })
  res.end(JSON.stringify(body))
}

function requireWriteAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!skillServerToken) {
    jsonResponse(res, 503, {
      ok: false,
      error: 'skill_token_not_configured',
      message: 'Set SIGHTFLOW_SKILL_TOKEN before using local start/pause HTTP control.'
    })
    return false
  }

  if (extractSkillToken(req.headers) !== skillServerToken) {
    jsonResponse(res, 401, { ok: false, error: 'unauthorized' })
    return false
  }

  return true
}

/** 读取 POST body（最大 1KB，防止滥用；当前所有端点都不需要 body） */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024) {
        req.destroy()
        reject(new Error('body_too_large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

const START_STATUS_MAP: Record<SkillStartReason, number> = {
  already_running: 409,
  no_vision_key: 400,
  no_provider: 400,
  missing_required_field: 400,
  engine_failed: 500,
  wizard_cancelled: 409
}

const PAUSE_STATUS_MAP: Record<SkillPauseReason, number> = {
  not_running: 409,
  pause_failed: 500
}

async function handleStart(res: http.ServerResponse): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' })
    return
  }

  if (skillOperationLock) {
    jsonResponse(res, 409, { ok: false, error: 'operation_in_progress' })
    return
  }

  if (controller.isRunning()) {
    jsonResponse(res, 409, { ok: false, error: 'already_running' })
    return
  }

  skillOperationLock = true
  try {
    const result = await controller.start()
    if (result.ok) {
      jsonResponse(res, 200, { ok: true })
    } else {
      const reason = result.reason || 'engine_failed'
      const status = START_STATUS_MAP[reason] ?? 500
      jsonResponse(res, status, {
        ok: false,
        error: reason,
        message: result.message
      })
    }
  } catch (error) {
    console.error('[Skill Server] start error:', error)
    jsonResponse(res, 500, { ok: false, error: 'engine_failed' })
  } finally {
    skillOperationLock = false
  }
}

async function handlePause(res: http.ServerResponse): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' })
    return
  }

  if (skillOperationLock) {
    jsonResponse(res, 409, { ok: false, error: 'operation_in_progress' })
    return
  }

  if (!controller.isRunning()) {
    jsonResponse(res, 409, { ok: false, error: 'not_running' })
    return
  }

  skillOperationLock = true
  try {
    const result = await controller.pause()
    if (result.ok) {
      jsonResponse(res, 200, { ok: true })
    } else {
      const reason = result.reason || 'pause_failed'
      const status = PAUSE_STATUS_MAP[reason] ?? 500
      jsonResponse(res, status, {
        ok: false,
        error: reason,
        message: result.message
      })
    }
  } catch (error) {
    console.error('[Skill Server] pause error:', error)
    jsonResponse(res, 500, { ok: false, error: 'pause_failed' })
  } finally {
    skillOperationLock = false
  }
}

function handleStatus(res: http.ServerResponse): void {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' })
    return
  }
  jsonResponse(res, 200, {
    ok: true,
    status: controller.isRunning() ? 'running' : 'stopped'
  })
}

async function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method, url } = req

  if (!isAllowedSkillHost(req.headers.host)) {
    jsonResponse(res, 403, { ok: false, error: 'invalid_host' })
    return
  }

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': `Content-Type, Authorization, ${TOKEN_HEADER}`
    })
    res.end()
    return
  }

  try {
    if (url === '/skill/start' && method === 'POST') {
      if (!requireWriteAuth(req, res)) return
      await readBody(req)
      await handleStart(res)
    } else if (url === '/skill/pause' && method === 'POST') {
      if (!requireWriteAuth(req, res)) return
      await readBody(req)
      await handlePause(res)
    } else if (url === '/skill/status' && method === 'GET') {
      handleStatus(res)
    } else {
      jsonResponse(res, 404, { ok: false, error: 'not_found' })
    }
  } catch (error) {
    console.error('[Skill Server] 请求处理异常:', error)
    jsonResponse(res, 500, { ok: false, error: 'internal_error' })
  }
}

export function startSkillServer(engineController: SkillEngineController): void {
  if (server) {
    console.warn('[Skill Server] already started, skip')
    return
  }
  controller = engineController

  server = http.createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      console.error('[Skill Server] Unhandled error:', error)
      try {
        jsonResponse(res, 500, { ok: false, error: 'internal_error' })
      } catch {
        // response 可能已经发送
      }
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && server) {
      console.warn(
        `[Skill Server] 端口 ${PRIMARY_PORT} 被占用，尝试 fallback 端口 ${FALLBACK_PORT}`
      )
      server.listen(FALLBACK_PORT, '127.0.0.1', () => {
        console.log(`[Skill Server] 已启动，监听 http://127.0.0.1:${FALLBACK_PORT}`)
      })
    } else {
      console.error('[Skill Server] 启动失败:', err)
    }
  })

  server.listen(PRIMARY_PORT, '127.0.0.1', () => {
    console.log(`[Skill Server] 已启动，监听 http://127.0.0.1:${PRIMARY_PORT}`)
  })
}

export function stopSkillServer(): void {
  if (server) {
    server.close(() => {
      console.log('[Skill Server] 已关闭')
    })
    server = null
  }
  controller = null
  skillOperationLock = false
}
