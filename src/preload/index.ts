import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const ALLOWED_INVOKE_CHANNELS = new Set([
  'settings:getAll',
  'settings:get',
  'settings:set',
  'settings:open',
  'provider:installFromUrl',
  'provider:getInstalled',
  'providerHub:getCatalog',
  'providerHub:update',
  'engine:start',
  'engine:stop',
  'engine:status',
  'engine:updateConfig',
  'engine:testConnection',
  'capture:openSetupWizard',
  'capture:getRegions',
  'capture:resetRegions',
  'capture-screen',
  'test:vlm-parallel'
])

const ALLOWED_ON_CHANNELS = new Set([
  'engine:state',
  'engine:log',
  'capture:regions-updated',
  'overlay-wizard:init'
])

const ALLOWED_SEND_CHANNELS = new Set(['overlay-wizard:complete', 'overlay-wizard:cancel', 'ping'])

function assertAllowed(channel: string, allowed: Set<string>): void {
  if (!allowed.has(channel)) {
    throw new Error(`IPC channel is not allowed: ${channel}`)
  }
}

type IpcInvokeResult = Record<string, unknown> & {
  success?: boolean
  error?: string
  installed?: Record<string, unknown> | null
}

const electronHandler = {
  invoke: <T = IpcInvokeResult>(channel: string, ...args: unknown[]): Promise<T> => {
    assertAllowed(channel, ALLOWED_INVOKE_CHANNELS)
    return ipcRenderer.invoke(channel, ...args) as Promise<T>
  },
  on: <T extends unknown[]>(channel: string, callback: (...args: T) => void): (() => void) => {
    assertAllowed(channel, ALLOWED_ON_CHANNELS)
    const handler = (_: IpcRendererEvent, ...args: unknown[]): void => callback(...(args as T))
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  send: (channel: string, ...args: unknown[]): void => {
    assertAllowed(channel, ALLOWED_SEND_CHANNELS)
    ipcRenderer.send(channel, ...args)
  }
}

type PreloadWindow = Window &
  typeof globalThis & {
    electron: typeof electronHandler
    osInfo: { platform: NodeJS.Platform }
  }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronHandler)
    contextBridge.exposeInMainWorld('osInfo', { platform: process.platform })
  } catch (error) {
    console.error(error)
  }
} else {
  const preloadWindow = window as PreloadWindow
  preloadWindow.electron = electronHandler
  preloadWindow.osInfo = { platform: process.platform }
}

export type ElectronHandler = typeof electronHandler
