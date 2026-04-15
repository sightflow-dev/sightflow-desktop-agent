// src/renderer/src/i18n.ts
// 简单的中英文国际化

export type Locale = 'zh' | 'en'

const translations = {
  zh: {
    // Header
    'app.title': 'SightFlow Desktop',
    'app.version': 'v0.1.0',

    // Tabs
    'tab.control': '控制',
    'tab.settings': '设置',

    // Control
    'control.status': '引擎状态',
    'status.idle': '待命',
    'status.running': '运行中',
    'status.error': '异常',
    'control.start': '启动引擎',
    'control.stop': '停止引擎',
    'control.start.nokey': '请先在设置页填写 API Key',
    'control.log': '运行日志',
    'control.log.empty': '引擎尚未启动',
    'control.log.thinking': '思考',
    'control.log.reply': '回复',
    'control.log.skip': '跳过',
    'control.log.error': '错误',

    // Settings
    'settings.ai': 'AI 模型配置',
    'settings.apiKey': 'API Key',
    'settings.apiKey.placeholder': '输入你的豆包 API Key',
    'settings.apiKey.hint': '在火山引擎控制台获取',
    'settings.model': '模型',
    'settings.model.placeholder': 'doubao-seed-1-6-251015',
    'settings.baseURL': 'Base URL',
    'settings.baseURL.placeholder': 'https://ark.cn-beijing.volces.com/api/v3',
    'settings.systemPrompt': 'System Prompt',
    'settings.systemPrompt.placeholder': '你是一个微信自动回复助手。根据截图中的聊天内容，生成合适的回复...',
    'settings.testConnection': '测试连接',
    'settings.testConnection.testing': '测试中...',
    'settings.testConnection.success': '连接成功',
    'settings.testConnection.fail': '连接失败',
    'settings.save': '保存配置',
    'settings.saved': '配置已保存',

    'settings.general': '通用设置',
    'settings.language': '语言',

    // Toast
    'toast.engineStarted': '引擎已启动',
    'toast.engineStopped': '引擎已停止',
    'toast.startFailed': '启动失败',
  },
  en: {
    'app.title': 'SightFlow Desktop',
    'app.version': 'v0.1.0',

    'tab.control': 'Control',
    'tab.settings': 'Settings',

    'control.status': 'Engine Status',
    'status.idle': 'Idle',
    'status.running': 'Running',
    'status.error': 'Error',
    'control.start': 'Start Engine',
    'control.stop': 'Stop Engine',
    'control.start.nokey': 'Please set API Key in Settings first',
    'control.log': 'Activity Log',
    'control.log.empty': 'Engine not started yet',
    'control.log.thinking': 'Thinking',
    'control.log.reply': 'Reply',
    'control.log.skip': 'Skip',
    'control.log.error': 'Error',

    'settings.ai': 'AI Model Configuration',
    'settings.apiKey': 'API Key',
    'settings.apiKey.placeholder': 'Enter your Doubao API Key',
    'settings.apiKey.hint': 'Get it from Volcengine Console',
    'settings.model': 'Model',
    'settings.model.placeholder': 'doubao-seed-1-6-251015',
    'settings.baseURL': 'Base URL',
    'settings.baseURL.placeholder': 'https://ark.cn-beijing.volces.com/api/v3',
    'settings.systemPrompt': 'System Prompt',
    'settings.systemPrompt.placeholder': 'You are a WeChat auto-reply assistant...',
    'settings.testConnection': 'Test Connection',
    'settings.testConnection.testing': 'Testing...',
    'settings.testConnection.success': 'Connection OK',
    'settings.testConnection.fail': 'Connection Failed',
    'settings.save': 'Save',
    'settings.saved': 'Settings saved',

    'settings.general': 'General',
    'settings.language': 'Language',

    'toast.engineStarted': 'Engine started',
    'toast.engineStopped': 'Engine stopped',
    'toast.startFailed': 'Failed to start',
  }
} as const

type TranslationKey = keyof typeof translations['zh']

let currentLocale: Locale = 'zh'

export function setLocale(locale: Locale) {
  currentLocale = locale
}

export function getLocale(): Locale {
  return currentLocale
}

export function t(key: TranslationKey): string {
  return translations[currentLocale]?.[key] || translations.zh[key] || key
}
