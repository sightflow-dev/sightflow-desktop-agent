// src/core/action/action-types.ts
// 平台无关的「语义动作空间」—— Phase 1 地基（computer-use roadmap）
//
// 为什么需要它：现在轨迹里的动作只记了屏幕坐标 [x,y]，像素坐标换分辨率 / 换 OS /
// 换模型就废，**不可继承**。把动作升级成「语义目标 + 接地中间产物 + 实际坐标」三层后，
// 记忆里存的是「点搜索框」而不是「点 (412,88)」，复用时对每一步实时重新接地（re-ground），
// 而不是机械回放坐标（那是 RPA 不是学习）。
//
// 这是后续「浏览器操作面 / UI-TARS 接地 / 记忆驱动操作」共同依赖的契约：所有操作面
// （desktop / browser / api）都产出同一套 Action / Observation，记忆系统据此跨面复用。

/** 操作面：动作落在哪个执行环境上 */
export type Surface = 'desktop' | 'browser' | 'api'

/**
 * 语义动作词汇表（统一各操作面）。
 * 旧轨迹的 'click' | 'send' | 'measure' | 'wait' 是本集合的子集，向后兼容。
 */
export type ActionKind =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'key'
  | 'paste'
  | 'scroll'
  | 'drag'
  | 'open_url'
  | 'switch_app'
  | 'send' // IM 复合动作：聚焦输入框 → 粘贴 → 回车
  | 'measure' // 一次性布局测量
  | 'observe' // 纯观察（截图 / 读状态）
  | 'wait'

/**
 * 动作目标三层表示，可继承性从高到低：
 * - semanticTarget：「微信搜索框」——跨环境最稳，记忆继承的关键
 * - bbox：归一化 0-1000 接地框——接地中间产物，跨分辨率可复算
 * - coords：实际屏幕坐标——最易随环境变化，仅供回放定位
 */
export interface ActionTarget {
  semanticTarget?: string
  bbox?: [number, number, number, number]
  coords?: [number, number]
}

/** 接地来源：这个目标坐标是怎么定位出来的（评测 / 缓存命中率统计用） */
export type GroundingSource =
  | 'vlm'
  | 'box-select'
  | 'dom'
  | 'accessibility'
  | 'cache'
  | 'derived'
  | 'fixed'

export interface Action {
  kind: ActionKind
  surface: Surface
  target?: ActionTarget
  /** 文本负载（type / paste / send / open_url 的内容） */
  payload?: string
  groundingSource?: GroundingSource
  /** 是否可逆（用于 recover / 幂等判断），高风险动作执行前应校验 */
  reversible?: boolean
  riskLevel?: 'low' | 'medium' | 'high'
}

/** 该动作种类是否会对外部世界产生真实副作用（发送 / 下单类需幂等保护） */
export function hasSideEffect(kind: ActionKind): boolean {
  return kind === 'send' || kind === 'type' || kind === 'paste' || kind === 'open_url'
}

/**
 * 取目标最稳的一层标识，用于轨迹摘要 / 记忆匹配：
 * 优先语义目标，其次 bbox，最后坐标。
 */
export function describeTarget(target?: ActionTarget): string | undefined {
  if (!target) return undefined
  if (target.semanticTarget) return target.semanticTarget
  if (target.bbox) return `bbox(${target.bbox.join(',')})`
  if (target.coords) return `(${target.coords[0]},${target.coords[1]})`
  return undefined
}
