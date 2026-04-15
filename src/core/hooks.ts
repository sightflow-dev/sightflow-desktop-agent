// src/core/hooks.ts
// AgentHooks — 插件系统的契约
// 所有插件（包括未来的商业插件）都实现这个接口。

export interface AgentHooks {
  // === 生命周期 ===
  onEngineStart?(): Promise<void>
  onEngineStop?(): Promise<void>

  // === 被动：检测到新消息后，决定怎么回复 ===
  getReply(context: MessageContext): AsyncIterable<ReplyAction>

  // === 主动：外部触发执行一组操作 ===
  executeActions?(params: {
    actions: ActionItem[]
    targets?: string[]
  }): AsyncIterable<ActionResult>

  // === 调度：外部系统注册触发器（定时任务等） ===
  onExternalTrigger?(callback: (params: {
    actions: ActionItem[]
    targets?: string[]
  }) => void): void

  // === 回调 ===
  onActionComplete?(action: ActionItem, result: { success: boolean }): void
  onError?(error: Error, phase: string): void
}

// 通用消息上下文
export interface MessageContext {
  screenshot: string        // base64 截图
  currentContact?: string   // 当前对话人
  ocrText?: string          // OCR 识别文字
}

// 通用回复动作（不暴露任何后端私有协议）
export type ReplyAction =
  | { type: 'text'; content: string }
  | { type: 'image'; url: string }
  | { type: 'thinking'; content: string }
  | { type: 'skip' }

// 通用执行动作
export type ActionItem =
  | { type: 'text'; content: string }
  | { type: 'image'; url: string }
  | { type: 'search_contact'; name: string }
  | { type: 'wait'; ms: number }

// 执行结果
export interface ActionResult {
  action: ActionItem
  success: boolean
  error?: string
}
