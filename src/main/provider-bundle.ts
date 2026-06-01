import { app, utilityProcess } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ProviderAdapter, ProviderEvent, ProviderInput } from '../core/session-types'
import {
  CUSTOM_PROVIDER_EXECUTION_ENV,
  assertProviderEntryIntegrity,
  isCustomProviderExecutionAllowed,
  sha256
} from './security-policy'

export const BUILTIN_DOUBAO_PROVIDER_ID = 'volcengine-ark'

/**
 * 内置 doubao（火山方舟）provider 的资源目录。
 * 打包后 resources/** 会经 asarUnpack，落到 app.asar.unpacked/resources/ 下。
 */
function getBuiltinProviderDir(id: string): string {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath()
  return path.join(root, 'resources', 'providers', id)
}

export type ProviderSchemaField =
  | {
      type: 'string' | 'password'
      title: string
      default?: string
    }
  | {
      type: 'select'
      title: string
      default?: string
      enum: string[]
    }
  | {
      type: 'boolean'
      title: string
      default?: boolean
    }

export interface ProviderConfigSchema {
  type: 'object'
  properties: Record<string, ProviderSchemaField>
  required?: string[]
}

export interface ProviderBundleManifest {
  apiVersion: 1
  id: string
  name: string
  version: string
  entry: string
  moduleType?: 'module' | 'commonjs'
  capabilities: ['chat']
  configSchema: ProviderConfigSchema
}

export interface InstalledProviderInfo {
  id: string
  name: string
  version: string
  entryFile: string
  installedAt: string
  entrySha256?: string
  sourceUrl?: string
}

export interface ProviderInstallResult {
  installed: InstalledProviderInfo
  manifest: ProviderBundleManifest
}

export interface ProviderBundleModule {
  manifest?: { id?: string; apiVersion?: number }
  createProvider?: (context: ProviderBundleContext) => {
    run(input: ProviderInput): AsyncIterable<ProviderEvent>
  }
  default?:
    | {
        createProvider?: (context: ProviderBundleContext) => {
          run(input: ProviderInput): AsyncIterable<ProviderEvent>
        }
      }
    | ((context: ProviderBundleContext) => {
        run(input: ProviderInput): AsyncIterable<ProviderEvent>
      })
}

export interface ProviderBundleContext {
  providerConfig: Record<string, unknown>
  host: {
    log(message: string): void
    platform: string
    appVersion: string
  }
}

export class BundleProviderAdapter implements ProviderAdapter {
  constructor(
    private readonly instance: { run(input: ProviderInput): AsyncIterable<ProviderEvent> },
    private readonly manifest: ProviderBundleManifest
  ) {}

  async *run(input: ProviderInput): AsyncIterable<ProviderEvent> {
    for await (const event of this.instance.run(input)) {
      if (this.isProviderEvent(event)) {
        yield event
      } else {
        yield {
          type: 'error',
          error: `Invalid provider event from ${this.manifest.id}`
        }
        return
      }
    }
  }

  private isProviderEvent(event: unknown): event is ProviderEvent {
    if (!isRecord(event) || typeof event.type !== 'string') return false
    const candidate = event as { type: string; content?: unknown; error?: unknown }

    switch (candidate.type) {
      case 'thinking':
      case 'reply_text':
        return typeof candidate.content === 'string'
      case 'skip':
        return true
      case 'error':
        return typeof candidate.error === 'string'
      default:
        return false
    }
  }
}

type ProviderWorkerMessage =
  | { type: 'event'; requestId: string; event: ProviderEvent }
  | { type: 'log'; requestId: string; message: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; error: string }

const PROVIDER_RUN_TIMEOUT_MS = 120_000

class UtilityProcessProviderAdapter implements ProviderAdapter {
  constructor(
    private readonly installed: InstalledProviderInfo,
    private readonly providerConfig: Record<string, unknown>,
    private readonly manifest: ProviderBundleManifest
  ) {}

  async *run(input: ProviderInput): AsyncIterable<ProviderEvent> {
    const requestId = `${this.manifest.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    let child: Electron.UtilityProcess
    try {
      child = utilityProcess.fork(getProviderWorkerPath(), [], {
        serviceName: `SightFlow Provider ${this.manifest.id}`,
        stdio: 'inherit',
        ...(process.platform === 'darwin' ? { disclaim: true } : {})
      })
    } catch (error: unknown) {
      yield { type: 'error', error: getErrorMessage(error) }
      return
    }
    const queue: ProviderEvent[] = []
    let done = false
    let failure: string | null = null
    let notify: (() => void) | null = null

    const wake = (): void => {
      notify?.()
      notify = null
    }
    const wait = (): Promise<void> =>
      new Promise((resolve) => {
        notify = resolve
      })

    const timeout = setTimeout(() => {
      failure = `Provider ${this.manifest.id} timed out after ${PROVIDER_RUN_TIMEOUT_MS}ms`
      done = true
      child.kill()
      wake()
    }, PROVIDER_RUN_TIMEOUT_MS)

    child.on('message', (message: unknown) => {
      const workerMessage = parseProviderWorkerMessage(message)
      if (!workerMessage || workerMessage.requestId !== requestId) return

      if (workerMessage.type === 'event') {
        queue.push(workerMessage.event)
      } else if (workerMessage.type === 'log') {
        console.log(`[ProviderWorker:${this.manifest.id}] ${workerMessage.message}`)
      } else if (workerMessage.type === 'done') {
        done = true
      } else {
        failure = workerMessage.error
        done = true
      }
      wake()
    })

    child.on('exit', (code: number) => {
      if (!done && !failure) {
        failure = `Provider ${this.manifest.id} exited before completing (code ${code})`
      }
      done = true
      wake()
    })

    child.on('error', (type: 'FatalError', location: string) => {
      failure = `Provider ${this.manifest.id} crashed: ${type} at ${location}`
      done = true
      wake()
    })

    child.postMessage({
      type: 'run',
      requestId,
      payload: {
        entryFile: this.installed.entryFile,
        manifest: this.manifest,
        providerConfig: this.providerConfig,
        input,
        appVersion: app.getVersion()
      }
    })

    try {
      while (!done || queue.length > 0) {
        const event = queue.shift()
        if (event) {
          yield event
          continue
        }
        await wait()
      }

      if (failure) {
        yield { type: 'error', error: failure }
      }
    } finally {
      clearTimeout(timeout)
      child.kill()
    }
  }
}

export async function installProviderFromUrl(manifestUrl: string): Promise<ProviderInstallResult> {
  const normalizedUrl = manifestUrl.trim()
  if (!normalizedUrl) {
    throw new Error('配置清单地址不能为空')
  }

  const manifestContent = await readUrlText(normalizedUrl)
  const manifest = validateManifest(JSON.parse(manifestContent))
  const entryUrl = new URL(manifest.entry, normalizedUrl).toString()
  const entryContent = await readUrlText(entryUrl)
  const entrySha256 = sha256(entryContent)
  const installDir = getProviderInstallDir(manifest.id, manifest.version)
  const manifestFile = path.join(installDir, 'manifest.json')
  const entryFile = path.join(installDir, path.basename(manifest.entry))

  await mkdir(installDir, { recursive: true })
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(entryFile, entryContent, 'utf8')

  return {
    installed: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      entryFile,
      installedAt: new Date().toISOString(),
      entrySha256,
      sourceUrl: normalizedUrl
    },
    manifest
  }
}

export async function getInstalledProviderManifest(
  installed: InstalledProviderInfo | null | undefined
): Promise<ProviderBundleManifest | null> {
  if (!installed?.entryFile) return null

  const manifestFile = path.join(path.dirname(installed.entryFile), 'manifest.json')
  try {
    const content = await readFile(manifestFile, 'utf8')
    return validateManifest(JSON.parse(content))
  } catch {
    return null
  }
}

/** 读取内置 doubao 的原始 manifest（保留 apiKey 字段，供调试 / 校验） */
export async function getBuiltinDoubaoManifestRaw(): Promise<ProviderBundleManifest | null> {
  const dir = getBuiltinProviderDir(BUILTIN_DOUBAO_PROVIDER_ID)
  const manifestFile = path.join(dir, 'manifest.json')
  try {
    const content = await readFile(manifestFile, 'utf8')
    return validateManifest(JSON.parse(content))
  } catch {
    return null
  }
}

/**
 * 拿到对外暴露的内置 doubao manifest：
 * - 移除 `apiKey` 字段（与视觉密钥共享，不需要用户重复填写）
 * - 同步从 required 列表里移除 apiKey
 */
export async function getBuiltinDoubaoManifestForUi(): Promise<ProviderBundleManifest | null> {
  const raw = await getBuiltinDoubaoManifestRaw()
  if (!raw) return null

  const properties: Record<string, ProviderSchemaField> = {}
  for (const [key, field] of Object.entries(raw.configSchema.properties)) {
    if (key === 'apiKey') continue
    properties[key] = field
  }
  const required = (raw.configSchema.required || []).filter((k) => k !== 'apiKey')

  return {
    ...raw,
    configSchema: {
      type: 'object',
      properties,
      required
    }
  }
}

/** 内置 doubao 的虚拟 installed 描述（用于 provider:getInstalled 的回退） */
export async function getBuiltinDoubaoInstalledInfo(): Promise<InstalledProviderInfo | null> {
  const raw = await getBuiltinDoubaoManifestRaw()
  if (!raw) return null
  const dir = getBuiltinProviderDir(BUILTIN_DOUBAO_PROVIDER_ID)
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    entryFile: path.join(dir, raw.entry),
    installedAt: '0'
  }
}

/** 直接加载内置 doubao provider；调用方负责传入合并好的 config（含 apiKey） */
export async function loadBuiltinDoubaoProvider(
  providerConfig: Record<string, unknown>
): Promise<{ provider: ProviderAdapter; manifest: ProviderBundleManifest }> {
  const installed = await getBuiltinDoubaoInstalledInfo()
  if (!installed) {
    throw new Error('内置 doubao provider 资源缺失')
  }
  return loadInstalledProvider(installed, providerConfig)
}

export function validateProviderConfig(
  manifest: ProviderBundleManifest,
  config: Record<string, unknown>
): { valid: boolean; error?: string } {
  const required = manifest.configSchema.required || []
  for (const key of required) {
    const value = config[key]
    if (value === undefined || value === null || value === '') {
      return { valid: false, error: `缺少必填项: ${key}` }
    }
  }

  for (const [key, field] of Object.entries(manifest.configSchema.properties || {})) {
    const value = config[key]
    if (value === undefined || value === null || value === '') continue

    switch (field.type) {
      case 'string':
      case 'password':
        if (typeof value !== 'string') {
          return { valid: false, error: `${key} 必须是字符串` }
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `${key} 必须是布尔值` }
        }
        break
      case 'select':
        if (typeof value !== 'string' || !field.enum.includes(value)) {
          return { valid: false, error: `${key} 必须是有效选项` }
        }
        break
    }
  }

  return { valid: true }
}

export async function loadInstalledProvider(
  installed: InstalledProviderInfo,
  providerConfig: Record<string, unknown>
): Promise<{ provider: ProviderAdapter; manifest: ProviderBundleManifest }> {
  const isBuiltin = isBuiltinProviderInfo(installed)
  if (!isBuiltin) {
    if (!isCustomProviderExecutionAllowed()) {
      throw new Error(
        `自定义 Provider 代码执行默认关闭。确认信任该 Provider 后，设置 ${CUSTOM_PROVIDER_EXECUTION_ENV}=1 再启动。`
      )
    }
    await verifyInstalledProviderIntegrity(installed)
  }

  const manifest = await getInstalledProviderManifest(installed)
  if (!manifest) {
    throw new Error('未找到已安装服务的配置清单')
  }

  const validation = validateProviderConfig(manifest, providerConfig)
  if (!validation.valid) {
    throw new Error(validation.error || '聊天服务配置无效')
  }

  if (!isBuiltin) {
    return {
      provider: new UtilityProcessProviderAdapter(installed, providerConfig, manifest),
      manifest
    }
  }

  const loaded = await loadProviderBundleModule(installed.entryFile, manifest)
  const createProvider = resolveCreateProvider(loaded)
  if (typeof createProvider !== 'function') {
    throw new Error(`服务包 ${manifest.id} 未导出 createProvider`)
  }

  const instance = createProvider({
    providerConfig,
    host: {
      log: (message: string) => console.log(`[ProviderBundle:${manifest.id}] ${message}`),
      platform: process.platform,
      appVersion: app.getVersion()
    }
  })

  if (!instance || typeof instance.run !== 'function') {
    throw new Error(`服务包 ${manifest.id} 的 createProvider 返回值无效`)
  }

  return {
    provider: new BundleProviderAdapter(instance, manifest),
    manifest
  }
}

async function loadProviderBundleModule(
  entryFile: string,
  manifest: ProviderBundleManifest
): Promise<ProviderBundleModule> {
  if (shouldUseEsmLoader(manifest, entryFile)) {
    // ESM has no writable require cache, so append a query string to force a fresh module instance.
    const entryUrl = pathToFileURL(entryFile)
    entryUrl.searchParams.set('ts', String(Date.now()))
    return (await import(/* @vite-ignore */ entryUrl.href)) as ProviderBundleModule
  }

  const runtimeRequire = createRequire(__filename)
  const resolvedEntry = runtimeRequire.resolve(entryFile)
  delete runtimeRequire.cache[resolvedEntry]
  return runtimeRequire(resolvedEntry) as ProviderBundleModule
}

function resolveCreateProvider(loaded: ProviderBundleModule):
  | ((context: ProviderBundleContext) => {
      run(input: ProviderInput): AsyncIterable<ProviderEvent>
    })
  | undefined {
  if (typeof loaded.createProvider === 'function') {
    return loaded.createProvider
  }

  if (
    loaded.default &&
    typeof loaded.default === 'object' &&
    typeof loaded.default.createProvider === 'function'
  ) {
    return loaded.default.createProvider
  }

  if (typeof loaded.default === 'function') {
    return loaded.default
  }

  return undefined
}

function shouldUseEsmLoader(manifest: ProviderBundleManifest, entryFile: string): boolean {
  if (manifest.moduleType === 'module') {
    return true
  }

  if (manifest.moduleType === 'commonjs') {
    return false
  }

  return isLegacyEsmEntry(entryFile)
}

function isLegacyEsmEntry(entryFile: string): boolean {
  const extension = path.extname(entryFile).toLowerCase()
  return extension === '.mjs' || extension === '.mts'
}

function getProviderWorkerPath(): string {
  return path.join(__dirname, 'provider-worker.js')
}

function parseProviderWorkerMessage(message: unknown): ProviderWorkerMessage | null {
  if (
    !isRecord(message) ||
    typeof message.type !== 'string' ||
    typeof message.requestId !== 'string'
  ) {
    return null
  }

  switch (message.type) {
    case 'event':
      return isProviderEvent(message.event)
        ? { type: 'event', requestId: message.requestId, event: message.event }
        : null
    case 'log':
      return typeof message.message === 'string'
        ? { type: 'log', requestId: message.requestId, message: message.message }
        : null
    case 'done':
      return { type: 'done', requestId: message.requestId }
    case 'error':
      return typeof message.error === 'string'
        ? { type: 'error', requestId: message.requestId, error: message.error }
        : null
    default:
      return null
  }
}

function isProviderEvent(event: unknown): event is ProviderEvent {
  if (!isRecord(event) || typeof event.type !== 'string') return false
  switch (event.type) {
    case 'thinking':
    case 'reply_text':
      return typeof event.content === 'string'
    case 'skip':
      return true
    case 'error':
      return typeof event.error === 'string'
    default:
      return false
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateManifest(input: unknown): ProviderBundleManifest {
  if (!isRecord(input)) {
    throw new Error('Manifest 格式无效')
  }
  if (input.apiVersion !== 1) {
    throw new Error('仅支持 apiVersion = 1 的 provider manifest')
  }
  if (typeof input.id !== 'string' || !input.id.trim()) {
    throw new Error('Manifest 缺少有效 id')
  }
  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('Manifest 缺少有效 name')
  }
  if (typeof input.version !== 'string' || !input.version.trim()) {
    throw new Error('Manifest 缺少有效 version')
  }
  if (typeof input.entry !== 'string' || !input.entry.trim()) {
    throw new Error('Manifest 缺少有效 entry')
  }
  if (
    input.moduleType !== undefined &&
    input.moduleType !== 'module' &&
    input.moduleType !== 'commonjs'
  ) {
    throw new Error('Manifest moduleType 仅支持 "module" 或 "commonjs"')
  }
  if (
    !Array.isArray(input.capabilities) ||
    input.capabilities.length !== 1 ||
    input.capabilities[0] !== 'chat'
  ) {
    throw new Error('Manifest capabilities 仅支持 ["chat"]')
  }

  const configSchema = input.configSchema
  if (
    !isRecord(configSchema) ||
    configSchema.type !== 'object' ||
    !isRecord(configSchema.properties)
  ) {
    throw new Error('Manifest 缺少有效 configSchema')
  }

  for (const [key, field] of Object.entries(configSchema.properties)) {
    if (!isRecord(field)) {
      throw new Error(`configSchema.properties.${key} 无效`)
    }
    if (
      typeof field.type !== 'string' ||
      !['string', 'password', 'select', 'boolean'].includes(field.type)
    ) {
      throw new Error(`字段 ${key} 的类型 ${field.type} 不受支持`)
    }
    if (typeof field.title !== 'string' || !field.title.trim()) {
      throw new Error(`字段 ${key} 缺少 title`)
    }
    if (field.type === 'select') {
      if (
        !Array.isArray(field.enum) ||
        field.enum.some((value: unknown) => typeof value !== 'string')
      ) {
        throw new Error(`字段 ${key} 的 enum 无效`)
      }
    }
  }

  const required = Array.isArray(configSchema.required)
    ? configSchema.required.filter((key: unknown): key is string => typeof key === 'string')
    : []

  return {
    apiVersion: 1,
    id: input.id,
    name: input.name,
    version: input.version,
    entry: input.entry,
    moduleType: input.moduleType,
    capabilities: ['chat'],
    configSchema: {
      type: 'object',
      properties: configSchema.properties as Record<string, ProviderSchemaField>,
      required
    }
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object'
}

function getProviderInstallDir(id: string, version: string): string {
  return path.join(app.getPath('userData'), 'providers', id, version)
}

function isBuiltinProviderInfo(installed: InstalledProviderInfo): boolean {
  return installed.id === BUILTIN_DOUBAO_PROVIDER_ID && installed.installedAt === '0'
}

async function verifyInstalledProviderIntegrity(installed: InstalledProviderInfo): Promise<void> {
  const entryContent = await readFile(installed.entryFile, 'utf8')
  assertProviderEntryIntegrity(installed, entryContent)
}

async function readUrlText(targetUrl: string): Promise<string> {
  const url = new URL(targetUrl)

  if (url.protocol === 'file:') {
    return await readFile(fileURLToPath(url), 'utf8')
  }

  if (url.protocol !== 'https:') {
    throw new Error(`不支持的 provider URL 协议: ${url.protocol}`)
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }

  return await response.text()
}
