import { useState, useCallback, useRef, useEffect } from 'react'
import { t, setLocale, getLocale, Locale } from './i18n'
import './index.css'

// ─── Types ───
interface LogEntry {
  time: string
  type: 'thinking' | 'reply' | 'skip' | 'error'
  content: string
}

type EngineStatus = 'idle' | 'running' | 'error'
type Tab = 'control' | 'settings'

// ─── App ───
function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('control')
  const [locale, _setLocale] = useState<Locale>(getLocale())
  const [, forceUpdate] = useState(0)

  const handleLocaleChange = useCallback((newLocale: Locale) => {
    setLocale(newLocale)
    _setLocale(newLocale)
    forceUpdate(n => n + 1)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <span className="version">{t('app.version')}</span>
      </header>

      <div className="tabs">
        <button
          className={`tab ${tab === 'control' ? 'active' : ''}`}
          onClick={() => setTab('control')}
        >
          {t('tab.control')}
        </button>
        <button
          className={`tab ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          {t('tab.settings')}
        </button>
      </div>

      <div className="app-content">
        <div style={{ display: tab === 'control' ? 'block' : 'none' }}>
          <ControlPanel />
        </div>
        <div style={{ display: tab === 'settings' ? 'block' : 'none' }}>
          <SettingsPanel locale={locale} onLocaleChange={handleLocaleChange} />
        </div>
      </div>

      <Toast />
    </div>
  )
}

// ─── Control Panel ───
function ControlPanel(): JSX.Element {
  const [status, setStatus] = useState<EngineStatus>('idle')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((type: LogEntry['type'], content: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs(prev => [...prev.slice(-99), { time, type, content }])
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  // 监听引擎事件
  useEffect(() => {
    const cleanup = window.electron?.on('engine:log', (data: { type: string; content: string }) => {
      addLog(data.type as LogEntry['type'], data.content)
    })
    return cleanup
  }, [addLog])

  const handleStart = useCallback(async () => {
    const settings = await window.electron?.invoke('settings:getAll')
    const apiKey = settings?.apiKey || ''
    if (!apiKey) {
      showToast(t('control.start.nokey'), 'error')
      return
    }

    const config = {
      apiKey,
      model: settings?.model || undefined,
      baseURL: settings?.baseURL || undefined,
      systemPrompt: settings?.systemPrompt || undefined
    }

    const result = await window.electron?.invoke('engine:start', config)
    if (result?.success) {
      setStatus('running')
      addLog('reply', 'Engine started')
      showToast(t('toast.engineStarted'), 'success')
    } else {
      setStatus('error')
      addLog('error', result?.error || 'Unknown error')
      showToast(result?.error || t('toast.startFailed'), 'error')
    }
  }, [addLog])

  const handleStop = useCallback(async () => {
    await window.electron?.invoke('engine:stop')
    setStatus('idle')
    addLog('skip', 'Engine stopped')
    showToast(t('toast.engineStopped'), 'success')
  }, [addLog])

  const statusLabel = status === 'running' ? t('status.running')
    : status === 'error' ? t('status.error')
    : t('status.idle')

  return (
    <div className="fade-in">
      {/* Status */}
      <div className="card-title">{t('control.status')}</div>
      <div className={`status-indicator ${status}`}>
        <div className={`status-dot ${status}`} />
        <span className="status-text">{statusLabel}</span>
      </div>

      {/* Start/Stop Button */}
      {status === 'running' ? (
        <button className="btn btn-danger btn-large" onClick={handleStop}>
          ⏹ {t('control.stop')}
        </button>
      ) : (
        <button className="btn btn-primary btn-large" onClick={handleStart}>
          ▶ {t('control.start')}
        </button>
      )}

      {/* Log */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">{t('control.log')}</div>
        <div className="message-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="message-log-empty">{t('control.log.empty')}</div>
          ) : (
            logs.map((entry, i) => (
              <div className="log-entry" key={i}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>
                  {t(`control.log.${entry.type}` as any)}
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

// ─── Settings Panel ───
function SettingsPanel({
  locale,
  onLocaleChange
}: {
  locale: Locale
  onLocaleChange: (l: Locale) => void
}): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [appType, setAppType] = useState<'weixin' | 'wework' | 'whatsapp'>('weixin')
  const [testing, setTesting] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // 从 main 进程的 electron-store 加载设置
  useEffect(() => {
    window.electron?.invoke('settings:getAll').then((settings: any) => {
      if (settings) {
        setApiKey(settings.apiKey || '')
        setModel(settings.model || '')
        setBaseURL(settings.baseURL || '')
        setSystemPrompt(settings.systemPrompt || '')
        setAppType(settings.appType || 'weixin')
      }
      setLoaded(true)
    })
  }, [])

  const handleSave = useCallback(async () => {
    await window.electron?.invoke('settings:set', {
      apiKey,
      model,
      baseURL,
      systemPrompt,
      appType
    })

    // 如果引擎已运行，热更新配置
    window.electron?.invoke('engine:updateConfig', {
      apiKey: apiKey || undefined,
      model: model || undefined,
      baseURL: baseURL || undefined,
      systemPrompt: systemPrompt || undefined,
      appType
    })

    showToast(t('settings.saved'), 'success')
  }, [apiKey, model, baseURL, systemPrompt, appType])

  const handleTestConnection = useCallback(async () => {
    if (!apiKey) return
    setTesting(true)
    try {
      const result = await window.electron?.invoke('engine:testConnection', {
        apiKey,
        model: model || undefined,
        baseURL: baseURL || undefined
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
  }, [apiKey, model, baseURL])

  return (
    <div className="fade-in">
      {/* AI Config */}
      <div className="card">
        <div className="card-title">{t('settings.ai')}</div>

        <div className="form-group">
          <label className="form-label">App Type (目标应用)</label>
          <select 
            className="form-input" 
            value={appType} 
            onChange={e => setAppType(e.target.value as any)}
          >
            <option value="weixin">微信 (WeChat)</option>
            <option value="wework">企业微信 (WeWork)</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.apiKey')}</label>
          <input
            className="form-input"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={t('settings.apiKey.placeholder')}
            autoComplete="off"
          />
          <div className="form-hint">{t('settings.apiKey.hint')}</div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.model')}</label>
          <input
            className="form-input"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={t('settings.model.placeholder')}
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.baseURL')}</label>
          <input
            className="form-input"
            value={baseURL}
            onChange={e => setBaseURL(e.target.value)}
            placeholder={t('settings.baseURL.placeholder')}
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.systemPrompt')}</label>
          <textarea
            className="form-input"
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder={t('settings.systemPrompt.placeholder')}
            rows={4}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={!apiKey || testing}
          >
            {testing ? t('settings.testConnection.testing') : t('settings.testConnection')}
          </button>
          <button className="btn btn-primary" onClick={handleSave} style={{ flex: 1 }}>
            {t('settings.save')}
          </button>
        </div>
      </div>

      {/* General */}
      <div className="card">
        <div className="card-title">{t('settings.general')}</div>
        <div className="form-group">
          <label className="form-label">{t('settings.language')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${locale === 'zh' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onLocaleChange('zh')}
              style={{ flex: 1 }}
            >
              中文
            </button>
            <button
              className={`btn ${locale === 'en' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onLocaleChange('en')}
              style={{ flex: 1 }}
            >
              English
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Toast ───
let _showToast: ((msg: string, type: 'success' | 'error') => void) | null = null

function showToast(msg: string, type: 'success' | 'error') {
  _showToast?.(msg, type)
}

function Toast(): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<number>()

  _showToast = useCallback((msg: string, t: 'success' | 'error') => {
    setMessage(msg)
    setType(t)
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(false), 2500)
  }, [])

  return (
    <div className={`toast ${type} ${visible ? 'show' : ''}`}>
      {message}
    </div>
  )
}

export default App
