import { createHash } from 'node:crypto'

export const TOKEN_HEADER = 'x-sightflow-token'
export const BEARER_PREFIX = 'Bearer '
export const CUSTOM_PROVIDER_EXECUTION_ENV = 'SIGHTFLOW_ALLOW_CUSTOM_PROVIDER_CODE'

export interface ProviderIntegrityInfo {
  entrySha256?: string
}

export function isAllowedSkillHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false

  const host = hostHeader.trim().toLowerCase()
  if (host.startsWith('127.0.0.1:') || host === '127.0.0.1') return true
  if (host.startsWith('localhost:') || host === 'localhost') return true
  if (host.startsWith('[::1]:') || host === '[::1]' || host === '::1') return true
  return false
}

export function extractSkillToken(headers: Record<string, string | string[] | undefined>): string {
  const headerToken = headers[TOKEN_HEADER]
  if (typeof headerToken === 'string') return headerToken.trim()

  const authorization = headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith(BEARER_PREFIX)) {
    return authorization.slice(BEARER_PREFIX.length).trim()
  }

  return ''
}

export function isCustomProviderExecutionAllowed(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[CUSTOM_PROVIDER_EXECUTION_ENV] === '1'
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function assertProviderEntryIntegrity(
  installed: ProviderIntegrityInfo,
  entryContent: string
): void {
  if (!installed.entrySha256) {
    throw new Error('Provider 缺少入口文件摘要，请重新安装后再启用')
  }

  const actual = sha256(entryContent)
  if (actual !== installed.entrySha256) {
    throw new Error('Provider 入口文件摘要不匹配，已阻止执行')
  }
}
