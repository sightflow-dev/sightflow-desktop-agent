import { app, shell, BrowserWindow, ipcMain, desktopCapturer } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { checkAndRequestPermissions } from './permission'
import Store from 'electron-store'
import { AIClient } from '../core/ai-client'
import { RPADevice } from '../core/rpa-device'
import { RuntimeHost } from '../core/runtime-host'
import {
  createInitialWeChatChannelState,
  WeChatChannelSession
} from '../core/wechat-channel-session'
import { AppType } from '../core/rpa/types'
import {
  getInstalledProviderManifest,
  installProviderFromUrl,
  InstalledProviderInfo,
  loadInstalledProvider
} from './provider-bundle'
const StoreClass = typeof Store === 'function' ? Store : ((Store as any).default as typeof Store)

const FIXED_ARK_MODEL = 'doubao-seed-2-0-lite-260215'
const FIXED_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  vision: {
    apiKey: string
  }
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, any>
  }
}

const settingsStore = new StoreClass({
  name: 'settings',
  defaults: {
    locale: 'zh',
    appType: 'wechat',
    vision: { apiKey: '' },
    chatProvider: {
      manifestUrl: '',
      installed: null,
      config: {}
    }
  }
})

let runtime: RuntimeHost<ReturnType<typeof createInitialWeChatChannelState>> | null = null
let runtimeDevice: RPADevice | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 360,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#0a0b10',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // 检查和请求 macOS 需要的权限
  await checkAndRequestPermissions()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // ── Settings 持久化 ──
  ipcMain.handle('settings:getAll', async () => {
    return normalizeSettings(settingsStore.store)
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    const settings = normalizeSettings(settingsStore.store)
    return (settings as Record<string, any>)[key]
  })

  ipcMain.handle('settings:set', async (_event, data: Record<string, any>) => {
    const next = {
      ...normalizeSettings(settingsStore.store),
      ...data,
      vision: {
        ...normalizeSettings(settingsStore.store).vision,
        ...(data.vision || {})
      },
      chatProvider: {
        ...normalizeSettings(settingsStore.store).chatProvider,
        ...(data.chatProvider || {}),
        config: {
          ...normalizeSettings(settingsStore.store).chatProvider.config,
          ...(data.chatProvider?.config || {})
        }
      }
    } satisfies AppSettings

    settingsStore.set(next as any)
    return { success: true }
  })

  ipcMain.handle('provider:installFromUrl', async (_event, manifestUrl: string) => {
    try {
      const result = await installProviderFromUrl(manifestUrl)
      const current = normalizeSettings(settingsStore.store)
      settingsStore.set({
        ...current,
        chatProvider: {
          ...current.chatProvider,
          manifestUrl,
          installed: result.installed,
          config: withSchemaDefaults(result.manifest.configSchema, current.chatProvider.config)
        }
      } as any)

      return {
        success: true,
        installed: result.installed,
        manifest: result.manifest
      }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('provider:getInstalled', async () => {
    const settings = normalizeSettings(settingsStore.store)
    const manifest = await getInstalledProviderManifest(settings.chatProvider.installed)
    return {
      installed: settings.chatProvider.installed,
      manifest
    }
  })

  // ── Runtime / Session IPC（沿用 legacy engine:* 通道名） ──
  ipcMain.handle('engine:start', async (_event, config) => {
    if (runtime?.isRunning()) return { success: false, error: '引擎已在运行中' }
    try {
      const settings = normalizeSettings(config || settingsStore.store)
      const appType: AppType = settings.appType || 'wechat'
      if (!settings.vision.apiKey) {
        return { success: false, error: '请先填写视觉接口密钥' }
      }
      if (!settings.chatProvider.installed) {
        return { success: false, error: '请先安装聊天服务' }
      }

      const { provider } = await loadInstalledProvider(
        settings.chatProvider.installed,
        settings.chatProvider.config
      )

      runtimeDevice = new RPADevice()
      runtimeDevice.setAppType(appType)
      runtimeDevice.setApiKey(settings.vision.apiKey)

      const channel = new WeChatChannelSession(runtimeDevice)
      const mainWindow = BrowserWindow.getAllWindows()[0]
      runtime = new RuntimeHost({
        appType,
        channel,
        provider,
        initialState: createInitialWeChatChannelState(),
        onLog: (type, content) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('engine:log', { type, content })
          }
        }
      })

      runtime.startSession().catch((err: any) => {
        console.error('[Main] Runtime session error:', err)
      })

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('engine:stop', async () => {
    if (!runtime?.isRunning()) return { success: false, error: '引擎未运行' }
    await runtime.stopSession('ipc_stop')
    return { success: true }
  })

  ipcMain.handle('engine:status', async () => {
    return { running: runtime?.isRunning() ?? false }
  })

  ipcMain.handle('engine:updateConfig', async (_event, config) => {
    const settings = normalizeSettings(config || settingsStore.store)
    if (runtimeDevice) {
      runtimeDevice.setApiKey(settings.vision.apiKey)
      runtimeDevice.setAppType(settings.appType)
    }
    if (runtime) {
      runtime.updateAppType(settings.appType)
    }
    return { success: true }
  })

  ipcMain.handle('engine:testConnection', async (_event, config) => {
    const apiKey = config?.apiKey || normalizeSettings(settingsStore.store).vision.apiKey
    const client = new AIClient({
      apiKey,
      model: FIXED_ARK_MODEL,
      baseURL: FIXED_ARK_BASE_URL
    })
    return client.testConnection()
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('capture-screen', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      if (sources && sources.length > 0) {
        return sources[0].thumbnail.toDataURL()
      }
      return null
    } catch (error) {
      console.error('Screen capture failed:', error)
      return null
    }
  })

  // ── 测试入口：VLM 并行 vs 串行 ──
  ipcMain.handle('test:vlm-parallel', async () => {
    const apiKey = normalizeSettings(settingsStore.store).vision.apiKey
    if (!apiKey) return { error: '请先在设置中填写视觉接口密钥' }
    const { runVlmParallelTest } = await import('../core/rpa/tests/test-vlm-parallel')
    return await runVlmParallelTest(apiKey, 'wechat')
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

function normalizeSettings(raw: any): AppSettings {
  const oldApiKey = typeof raw?.apiKey === 'string' ? raw.apiKey : ''
  const oldModel = typeof raw?.model === 'string' && raw.model ? raw.model : FIXED_ARK_MODEL
  const oldSystemPrompt = typeof raw?.systemPrompt === 'string' ? raw.systemPrompt : ''
  const rawProviderConfig =
    raw?.chatProvider?.config && typeof raw.chatProvider.config === 'object' ? { ...raw.chatProvider.config } : {}

  // Keep arbitrary provider config keys, and only backfill legacy volcengine fields for old persisted settings.
  if (rawProviderConfig.apiKey === undefined && oldApiKey) {
    rawProviderConfig.apiKey = oldApiKey
  }
  if (rawProviderConfig.model === undefined && oldModel) {
    rawProviderConfig.model = oldModel
  }
  if (rawProviderConfig.systemPrompt === undefined && oldSystemPrompt) {
    rawProviderConfig.systemPrompt = oldSystemPrompt
  }

  return {
    locale: raw?.locale === 'en' ? 'en' : 'zh',
    // Keep reading historical `weixin` values from persisted settings.
    appType: raw?.appType === 'wework' ? 'wework' : 'wechat',
    vision: {
      apiKey: raw?.vision?.apiKey || oldApiKey || ''
    },
    chatProvider: {
      manifestUrl: raw?.chatProvider?.manifestUrl || raw?.providerManifestUrl || '',
      installed: raw?.chatProvider?.installed || null,
      config: rawProviderConfig
    }
  }
}

function withSchemaDefaults(
  schema: { properties: Record<string, { default?: unknown }> },
  current: Record<string, any>
): Record<string, any> {
  const next = { ...current }
  for (const [key, field] of Object.entries(schema.properties || {})) {
    if (next[key] === undefined && field.default !== undefined) {
      next[key] = field.default
    }
  }
  return next
}
