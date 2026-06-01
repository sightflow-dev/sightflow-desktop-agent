import electronUtility from 'electron/utility'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProviderEvent, ProviderInput } from '../core/session-types'
import type {
  ProviderBundleContext,
  ProviderBundleManifest,
  ProviderBundleModule
} from './provider-bundle'

const { parentPort } = electronUtility

type ProviderWorkerRequest = {
  type: 'run'
  requestId: string
  payload: {
    entryFile: string
    manifest: ProviderBundleManifest
    providerConfig: Record<string, unknown>
    input: ProviderInput
    appVersion: string
  }
}

type ProviderWorkerResponse =
  | { type: 'event'; requestId: string; event: ProviderEvent }
  | { type: 'log'; requestId: string; message: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; error: string }

parentPort.on('message', (event: Electron.MessageEvent) => {
  void handleMessage(event.data).catch((error: unknown) => {
    const requestId =
      isRecord(event.data) && typeof event.data.requestId === 'string' ? event.data.requestId : ''
    post({ type: 'error', requestId, error: getErrorMessage(error) })
  })
})

async function handleMessage(message: unknown): Promise<void> {
  if (!isProviderWorkerRequest(message)) {
    post({ type: 'error', requestId: '', error: 'Invalid provider worker request' })
    return
  }

  const { requestId, payload } = message
  try {
    const loaded = await loadProviderBundleModule(payload.entryFile, payload.manifest)
    const createProvider = resolveCreateProvider(loaded)
    if (typeof createProvider !== 'function') {
      throw new Error(`服务包 ${payload.manifest.id} 未导出 createProvider`)
    }

    const instance = createProvider({
      providerConfig: payload.providerConfig,
      host: {
        log: (workerMessage: string): void => {
          post({ type: 'log', requestId, message: workerMessage })
        },
        platform: process.platform,
        appVersion: payload.appVersion
      }
    })

    if (!instance || typeof instance.run !== 'function') {
      throw new Error(`服务包 ${payload.manifest.id} 的 createProvider 返回值无效`)
    }

    for await (const event of instance.run(payload.input)) {
      if (!isProviderEvent(event)) {
        throw new Error(`Invalid provider event from ${payload.manifest.id}`)
      }
      post({ type: 'event', requestId, event })
    }

    post({ type: 'done', requestId })
  } catch (error: unknown) {
    post({ type: 'error', requestId, error: getErrorMessage(error) })
  }
}

async function loadProviderBundleModule(
  entryFile: string,
  manifest: ProviderBundleManifest
): Promise<ProviderBundleModule> {
  if (shouldUseEsmLoader(manifest, entryFile)) {
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

  const extension = path.extname(entryFile).toLowerCase()
  return extension === '.mjs' || extension === '.mts'
}

function isProviderWorkerRequest(message: unknown): message is ProviderWorkerRequest {
  if (!isRecord(message) || message.type !== 'run' || typeof message.requestId !== 'string') {
    return false
  }
  if (!isRecord(message.payload)) return false
  return (
    typeof message.payload.entryFile === 'string' &&
    isRecord(message.payload.manifest) &&
    isRecord(message.payload.providerConfig) &&
    isRecord(message.payload.input) &&
    typeof message.payload.appVersion === 'string'
  )
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

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object'
}

function post(message: ProviderWorkerResponse): void {
  parentPort.postMessage(message)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
