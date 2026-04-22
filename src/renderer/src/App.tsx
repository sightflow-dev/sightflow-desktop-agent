import { useState, useCallback, useRef, useEffect } from 'react'
import { t } from './i18n'
import logoUrl from './assets/logo.png'
import './index.css'

interface LogEntry {
  time: string
  type: 'thinking' | 'reply' | 'skip' | 'error'
  content: string
}

type EngineStatus = 'idle' | 'running' | 'error'
type View = 'control' | 'settings'
type AppType = 'wechat' | 'wework'

interface ProviderSchemaField {
  type: 'string' | 'password' | 'select' | 'boolean'
  title: string
  default?: string | boolean
  enum?: string[]
}

interface ProviderManifest {
  apiVersion: 1
  id: string
  name: string
  version: string
  entry: string
  capabilities: ['chat']
  configSchema: {
    type: 'object'
    properties: Record<string, ProviderSchemaField>
    required?: string[]
  }
}

interface InstalledProviderInfo {
  id: string
  name: string
  version: string
  entryFile: string
  installedAt: string
}

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

const PROVIDER_NAME_LABELS: Record<string, string> = {
  'volcengine-ark': '火山方舟聊天服务'
}

const PROVIDER_FIELD_LABELS: Record<string, string> = {
  apiKey: '接口密钥',
  model: '模型名称',
  systemPrompt: '系统提示词'
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.14v14l11-7-11-7z" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
)

function App() {
  const [view, setView] = useState<View>('control')
  const [status, setStatus] = useState<EngineStatus>('idle')

  return (
    <div className="app">
      <header className="app-header">
        {view === 'settings' ? (
          <button
            className="bottom-btn bottom-btn-settings"
            onClick={() => setView('control')}
            style={{ width: 32, height: 32, marginRight: 4 }}
          >
            <BackIcon />
          </button>
        ) : null}
        <img src={logoUrl} alt="SightFlow" className="app-logo" />
      </header>

      <div className="app-content">
        {view === 'control' ? (
          <ControlPanel status={status} setStatus={setStatus} />
        ) : (
          <SettingsPanel />
        )}
      </div>

      {view === 'control' && (
        <BottomBar
          status={status}
          setStatus={setStatus}
          onSettings={() => setView('settings')}
        />
      )}

      <Toast />
    </div>
  )
}

function getProviderDisplayName(provider: InstalledProviderInfo | null | undefined, manifest: ProviderManifest | null) {
  return (
    (provider?.id && PROVIDER_NAME_LABELS[provider.id]) ||
    (manifest?.id && PROVIDER_NAME_LABELS[manifest.id]) ||
    provider?.name ||
    manifest?.name ||
    ''
  )
}

function getProviderFieldLabel(fieldKey: string, field: ProviderSchemaField) {
  return PROVIDER_FIELD_LABELS[fieldKey] || field.title
}

function ControlPanel({
  status,
  setStatus
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
}) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((type: LogEntry['type'], content: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev.slice(-99), { time, type, content }])
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    const cleanup = window.electron?.on('engine:log', (data: { type: string; content: string }) => {
      addLog(data.type as LogEntry['type'], data.content)

      if (data.type === 'error' && data.content.includes('引擎无法启动')) {
        setStatus('error')
      }
    })
    return cleanup
  }, [addLog, setStatus])

  const statusLabel =
    status === 'running'
      ? t('status.running')
      : status === 'error'
        ? t('status.error')
        : t('status.idle')

  return (
    <div className="fade-in">
      <div className={`status-indicator ${status}`}>
        <div className={`status-dot ${status}`} />
        <span className="status-text">{statusLabel}</span>
      </div>

      <div className="card">
        <div className="card-title">{t('control.log')}</div>
        <div className="message-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="message-log-empty">{t('control.log.empty')}</div>
          ) : (
            logs.map((entry, i) => (
              <div className="log-entry" key={i}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>
                  {t(`control.log.${entry.type}` as never)}
                </span>
                <span>{entry.content}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function BottomBar({
  status,
  setStatus,
  onSettings
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
  onSettings: () => void
}) {
  const handleStart = useCallback(async () => {
    const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
    if (!settings?.vision?.apiKey) {
      showToast(t('control.start.novisionkey'), 'error')
      return
    }
    if (!settings.chatProvider?.installed) {
      showToast(t('control.start.noprovider'), 'error')
      return
    }
    const providerInfo = (await window.electron?.invoke('provider:getInstalled')) as {
      manifest: ProviderManifest | null
    }
    const required = providerInfo?.manifest?.configSchema?.required || []
    const missing = required.find((key) => {
      const value = settings.chatProvider.config?.[key]
      return value === undefined || value === null || value === ''
    })
    if (missing) {
      showToast(`${t('control.start.missingProviderField')}: ${missing}`, 'error')
      return
    }

    const result = await window.electron?.invoke('engine:start', settings)
    if (result?.success) {
      setStatus('running')
      showToast(t('toast.engineStarted'), 'success')
    } else {
      setStatus('error')
      showToast(result?.error || t('toast.startFailed'), 'error')
    }
  }, [setStatus])

  const handleStop = useCallback(async () => {
    await window.electron?.invoke('engine:stop')
    setStatus('idle')
    showToast(t('toast.engineStopped'), 'success')
  }, [setStatus])

  const running = status === 'running'

  return (
    <div className="bottom-bar">
      {running ? (
        <button className="bottom-btn bottom-btn-stop" onClick={handleStop}>
          <StopIcon />
          {t('control.stop')}
        </button>
      ) : (
        <button className="bottom-btn bottom-btn-play" onClick={handleStart}>
          <PlayIcon />
          {t('control.start')}
        </button>
      )}
      <button className="bottom-btn bottom-btn-settings" onClick={onSettings}>
        <GearIcon />
      </button>
    </div>
  )
}

function SettingsPanel() {
  const [appType, setAppType] = useState<AppType>('wechat')
  const [visionApiKey, setVisionApiKey] = useState('')
  const [providerManifestUrl, setProviderManifestUrl] = useState('')
  const [installedProvider, setInstalledProvider] = useState<InstalledProviderInfo | null>(null)
  const [installedManifest, setInstalledManifest] = useState<ProviderManifest | null>(null)
  const [providerConfig, setProviderConfig] = useState<Record<string, any>>({})
  const [testing, setTesting] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const load = async () => {
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
      if (settings) {
        setAppType(settings.appType || 'wechat')
        setVisionApiKey(settings.vision?.apiKey || '')
        setProviderManifestUrl(settings.chatProvider?.manifestUrl || '')
        setInstalledProvider(settings.chatProvider?.installed || null)
        setProviderConfig(settings.chatProvider?.config || {})
      }

      const providerInfo = (await window.electron?.invoke('provider:getInstalled')) as {
        installed: InstalledProviderInfo | null
        manifest: ProviderManifest | null
      }
      if (providerInfo?.installed) {
        setInstalledProvider(providerInfo.installed)
      }
      if (providerInfo?.manifest) {
        const manifest = providerInfo.manifest
        setInstalledManifest(manifest)
        setProviderConfig((prev) => applyManifestDefaults(manifest, prev))
      }
    }

    void load()
  }, [])

  const handleSaveVision = useCallback(async () => {
    const payload: Partial<AppSettings> = {
      appType,
      vision: { apiKey: visionApiKey }
    }

    await window.electron?.invoke('settings:set', payload)
    await window.electron?.invoke('engine:updateConfig', {
      ...(await window.electron?.invoke('settings:getAll')),
      ...payload,
      vision: { apiKey: visionApiKey }
    })
    showToast(t('settings.saved'), 'success')
  }, [appType, visionApiKey])

  const handleInstallProvider = useCallback(async () => {
    if (!providerManifestUrl.trim()) {
      showToast(t('settings.providerManifest.required'), 'error')
      return
    }

    setInstalling(true)
    try {
      const result = await window.electron?.invoke('provider:installFromUrl', providerManifestUrl.trim())
      if (!result?.success) {
        showToast(result?.error || t('settings.providerInstall.failed'), 'error')
        return
      }

      setInstalledProvider(result.installed)
      setInstalledManifest(result.manifest)
      setProviderConfig((prev) => applyManifestDefaults(result.manifest as ProviderManifest, prev))
      showToast(t('settings.providerInstall.success'), 'success')
    } finally {
      setInstalling(false)
    }
  }, [providerManifestUrl])

  const handleSaveProvider = useCallback(async () => {
    if (!installedManifest || !installedProvider) {
      showToast(t('settings.providerInstall.required'), 'error')
      return
    }

    const required = installedManifest.configSchema.required || []
    const missing = required.find((key) => {
      const value = providerConfig[key]
      return value === undefined || value === null || value === ''
    })
    if (missing) {
      showToast(`${t('settings.providerField.required')}: ${missing}`, 'error')
      return
    }

    await window.electron?.invoke('settings:set', {
      chatProvider: {
        manifestUrl: providerManifestUrl,
        installed: installedProvider,
        config: providerConfig
      }
    })

    showToast(t('settings.provider.saved'), 'success')
  }, [installedManifest, installedProvider, providerConfig, providerManifestUrl])

  const handleTestConnection = useCallback(async () => {
    if (!visionApiKey) return
    setTesting(true)
    try {
      const result = await window.electron?.invoke('engine:testConnection', {
        apiKey: visionApiKey
      })
      if (result?.success) {
        showToast(t('settings.testConnection.success'), 'success')
      } else {
        showToast(`${t('settings.testConnection.fail')}: ${result?.error || ''}`, 'error')
      }
    } catch (e: any) {
      showToast(`${t('settings.testConnection.fail')}: ${e.message}`, 'error')
    } finally {
      setTesting(false)
    }
  }, [visionApiKey])

  return (
    <div className="slide-up">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{t('settings.vision')}</div>

        <div className="form-group">
          <label className="form-label">{t('settings.appType')}</label>
          <select
            className="form-input"
            value={appType}
            onChange={(e) => setAppType(e.target.value as AppType)}
          >
            <option value="wechat">微信</option>
            <option value="wework">企业微信</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionApiKey')}</label>
          <input
            className="form-input"
            type="password"
            value={visionApiKey}
            onChange={(e) => setVisionApiKey(e.target.value)}
            placeholder={t('settings.visionApiKey.placeholder')}
            autoComplete="off"
          />
          <div className="form-hint">{t('settings.visionApiKey.hint')}</div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionModel')}</label>
          <input className="form-input" value="doubao-seed-2-0-lite-260215" disabled />
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionBaseUrl')}</label>
          <input className="form-input" value="https://ark.cn-beijing.volces.com/api/v3" disabled />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={!visionApiKey || testing}
          >
            {testing ? t('settings.testConnection.testing') : t('settings.testConnection')}
          </button>
          <button className="btn btn-primary" onClick={handleSaveVision} style={{ flex: 1 }}>
            {t('settings.saveVision')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('settings.chatProvider')}</div>

        <div className="form-group">
          <label className="form-label">{t('settings.providerManifest')}</label>
          <input
            className="form-input"
            value={providerManifestUrl}
            onChange={(e) => setProviderManifestUrl(e.target.value)}
            placeholder={t('settings.providerManifest.placeholder')}
            autoComplete="off"
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={handleInstallProvider}
            disabled={!providerManifestUrl || installing}
          >
            {installing ? t('settings.providerInstall.installing') : t('settings.providerInstall')}
          </button>
        </div>

        {installedProvider ? (
          <div className="form-group">
            <label className="form-label">{t('settings.providerInstalled')}</label>
            <div className="form-hint">
              {getProviderDisplayName(installedProvider, installedManifest)} · {installedProvider.version}
            </div>
            <div className="form-hint">{new Date(installedProvider.installedAt).toLocaleString()}</div>
          </div>
        ) : null}

        {installedManifest ? (
          <>
            {Object.entries(installedManifest.configSchema.properties).map(([key, field]) => (
              <DynamicProviderField
                key={key}
                fieldKey={key}
                field={field}
                value={providerConfig[key]}
                onChange={(value) => setProviderConfig((prev) => ({ ...prev, [key]: value }))}
              />
            ))}

            <button className="btn btn-primary" onClick={handleSaveProvider} style={{ width: '100%' }}>
              {t('settings.provider.save')}
            </button>
          </>
        ) : (
          <div className="form-hint">{t('settings.providerInstall.required')}</div>
        )}
      </div>
    </div>
  )
}

function DynamicProviderField({
  fieldKey,
  field,
  value,
  onChange
}: {
  fieldKey: string
  field: ProviderSchemaField
  value: any
  onChange: (value: any) => void
}) {
  const label = getProviderFieldLabel(fieldKey, field)
  const normalizedValue =
    value !== undefined
      ? value
      : field.default !== undefined
        ? field.default
        : field.type === 'boolean'
          ? false
          : ''

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {field.type === 'select' ? (
        <select
          className="form-input"
          value={String(normalizedValue)}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.enum || []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1' }}>
          <input
            type="checkbox"
            checked={Boolean(normalizedValue)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
      ) : fieldKey === 'systemPrompt' ? (
        <textarea
          className="form-input"
          rows={4}
          value={String(normalizedValue)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="form-input"
          type={field.type === 'password' ? 'password' : 'text'}
          value={String(normalizedValue)}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
    </div>
  )
}

function applyManifestDefaults(
  manifest: ProviderManifest,
  current: Record<string, any>
): Record<string, any> {
  const next = { ...current }
  for (const [key, field] of Object.entries(manifest.configSchema.properties || {})) {
    if (next[key] === undefined && field.default !== undefined) {
      next[key] = field.default
    }
  }
  return next
}

let _showToast: ((msg: string, type: 'success' | 'error') => void) | null = null

function showToast(msg: string, type: 'success' | 'error') {
  _showToast?.(msg, type)
}

function Toast() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<number | undefined>(undefined)

  _showToast = useCallback((msg: string, t: 'success' | 'error') => {
    setMessage(msg)
    setType(t)
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(false), 2500)
  }, [])

  return <div className={`toast ${type} ${visible ? 'show' : ''}`}>{message}</div>
}

export default App
