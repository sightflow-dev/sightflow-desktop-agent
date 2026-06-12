import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ProviderAdapter, ProviderEvent, ProviderInput } from '../core/session-types'

export const BUILTIN_DOUBAO_PROVIDER_ID = 'volcengine-ark'
export const BUILTIN_MINIMAX_PROVIDER_ID = 'minimax'

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
}

export interface ProviderInstallResult {
  installed: InstalledProviderInfo
  manifest: ProviderBundleManifest
}

interface ProviderBundleModule {
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
    | ((context: ProviderBundleContext) => { run(input: ProviderInput): AsyncIterable<ProviderEvent> })
}

export interface ProviderBundleContext {
  providerConfig: Record<string, any>
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

  private isProviderEvent(event: any): event is ProviderEvent {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return false

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
      installedAt: new Date().toISOString()
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
  providerConfig: Record<string, any>
): Promise<{ provider: ProviderAdapter; manifest: ProviderBundleManifest }> {
  const installed = await getBuiltinDoubaoInstalledInfo()
  if (!installed) {
    throw new Error('内置 doubao provider 资源缺失')
  }
  return loadInstalledProvider(installed, providerConfig)
}

export function validateProviderConfig(
  manifest: ProviderBundleManifest,
  config: Record<string, any>
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
  providerConfig: Record<string, any>
): Promise<{ provider: ProviderAdapter; manifest: ProviderBundleManifest }> {
  const manifest = await getInstalledProviderManifest(installed)
  if (!manifest) {
    throw new Error('未找到已安装服务的配置清单')
  }

  const validation = validateProviderConfig(manifest, providerConfig)
  if (!validation.valid) {
    throw new Error(validation.error || '聊天服务配置无效')
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

async function loadProviderBundleModule(entryFile: string, manifest: ProviderBundleManifest): Promise<ProviderBundleModule> {
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

function resolveCreateProvider(
  loaded: ProviderBundleModule
):
  | ((context: ProviderBundleContext) => {
      run(input: ProviderInput): AsyncIterable<ProviderEvent>
    })
  | undefined {
  if (typeof loaded.createProvider === 'function') {
    return loaded.createProvider
  }

  if (loaded.default && typeof loaded.default === 'object' && typeof loaded.default.createProvider === 'function') {
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

function validateManifest(input: any): ProviderBundleManifest {
  if (!input || typeof input !== 'object') {
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
  if (input.moduleType !== undefined && input.moduleType !== 'module' && input.moduleType !== 'commonjs') {
    throw new Error('Manifest moduleType 仅支持 "module" 或 "commonjs"')
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length !== 1 || input.capabilities[0] !== 'chat') {
    throw new Error('Manifest capabilities 仅支持 ["chat"]')
  }

  const configSchema = input.configSchema
  if (!configSchema || configSchema.type !== 'object' || typeof configSchema.properties !== 'object') {
    throw new Error('Manifest 缺少有效 configSchema')
  }

  for (const [key, field] of Object.entries(configSchema.properties as Record<string, any>)) {
    if (!field || typeof field !== 'object') {
      throw new Error(`configSchema.properties.${key} 无效`)
    }
    if (!['string', 'password', 'select', 'boolean'].includes(field.type)) {
      throw new Error(`字段 ${key} 的类型 ${field.type} 不受支持`)
    }
    if (typeof field.title !== 'string' || !field.title.trim()) {
      throw new Error(`字段 ${key} 缺少 title`)
    }
    if (field.type === 'select') {
      if (!Array.isArray(field.enum) || field.enum.some((value: unknown) => typeof value !== 'string')) {
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

function getProviderInstallDir(id: string, version: string): string {
  return path.join(app.getPath('userData'), 'providers', id, version)
}

async function readUrlText(targetUrl: string): Promise<string> {
  const url = new URL(targetUrl)

  if (url.protocol === 'file:') {
    return await readFile(fileURLToPath(url), 'utf8')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`不支持的 provider URL 协议: ${url.protocol}`)
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }

  return await response.text()
}
