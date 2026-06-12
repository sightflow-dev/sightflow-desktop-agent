// src/renderer/src/MemoryWindow.tsx
// 工作记忆窗口 — 执行轨迹时间轴 / 逐步回放 / 经验卡片
//
// 数据全部来自 main 进程 IPC（trace:* / memory:*），引擎运行时通过 trace:step
// 事件实时推送新步骤，打开本窗口可以看着轨迹一条条长出来。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logoUrl from './assets/logo.png'
import { showToast } from './App'

// ── 与 src/core/trace / memory 对齐的本地类型（renderer 约定：不跨层 import） ──

type TracePhase = 'observe' | 'think' | 'act' | 'verify'

interface TraceSessionMeta {
  sessionId: string
  appType: string
  startedAt: number
  endedAt?: number
  engineVersion: string
  providerId?: string
  model?: string
  stepCount: number
}

interface TraceStep {
  stepId: string
  sessionId: string
  seq: number
  ts: number
  actor: 'agent' | 'human'
  phase: TracePhase
  summary: string
  screen?: { screenshotPath: string }
  reasoning?: { content: string; memoryRefs?: string[] }
  action?: { kind: string; target?: [number, number]; payload?: string }
  outcome?: { status: 'ok' | 'fail' | 'skip'; detail?: string; latencyMs?: number }
}

interface ExperienceCard {
  cardId: string
  scenario: string
  guidance: string
  rationale: string
  source: 'agent_summary' | 'human_takeover' | 'manual'
  evidence: { sessionId?: string; stepIds?: string[] }
  enabled: boolean
  stats: { used: number; success: number }
  createdAt: number
}

const PHASE_LABELS: Record<TracePhase, string> = {
  observe: '观察',
  think: '判断',
  act: '动作',
  verify: '验证'
}

const SOURCE_LABELS: Record<ExperienceCard['source'], string> = {
  agent_summary: '轨迹归纳',
  human_takeover: '人工纠正',
  manual: '手动录入'
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

// 截图 dataURL 缓存：同一截图在缩略图和回放大图间复用
const screenshotCache = new Map<string, string>()

async function loadScreenshot(sessionId: string, screenshotPath: string): Promise<string | null> {
  const key = `${sessionId}/${screenshotPath}`
  const cached = screenshotCache.get(key)
  if (cached) return cached
  const dataUrl = (await window.electron?.invoke(
    'trace:getScreenshot',
    sessionId,
    screenshotPath
  )) as string | null
  if (dataUrl) screenshotCache.set(key, dataUrl)
  return dataUrl
}

function Screenshot({
  sessionId,
  screenshotPath,
  className
}: {
  sessionId: string
  screenshotPath: string
  className: string
}): React.JSX.Element | null {
  const [src, setSrc] = useState<string | null>(
    () => screenshotCache.get(`${sessionId}/${screenshotPath}`) ?? null
  )

  useEffect(() => {
    let cancelled = false
    void loadScreenshot(sessionId, screenshotPath).then((dataUrl) => {
      if (!cancelled) setSrc(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, screenshotPath])

  if (!src) return <div className={`${className} screenshot-loading`} />
  return <img src={src} alt="界面截图" className={className} />
}

export default function MemoryWindow(): React.JSX.Element {
  const [view, setView] = useState<'traces' | 'cards'>('traces')
  const [sessions, setSessions] = useState<TraceSessionMeta[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [cards, setCards] = useState<ExperienceCard[]>([])
  const [learning, setLearning] = useState(false)

  const reloadSessions = useCallback(async () => {
    const list = ((await window.electron?.invoke('trace:listSessions')) ?? []) as TraceSessionMeta[]
    setSessions(list)
    setSelectedSessionId((current) => current ?? list[0]?.sessionId ?? null)
  }, [])

  const reloadCards = useCallback(async () => {
    const list = ((await window.electron?.invoke('memory:listCards')) ?? []) as ExperienceCard[]
    setCards(list)
  }, [])

  useEffect(() => {
    void reloadSessions()
    void reloadCards()
  }, [reloadSessions, reloadCards])

  // 选中会话变化时加载轨迹
  useEffect(() => {
    if (!selectedSessionId) {
      setSteps([])
      return
    }
    let cancelled = false
    void (async () => {
      const data = (await window.electron?.invoke('trace:getSession', selectedSessionId)) as {
        session: TraceSessionMeta
        steps: TraceStep[]
      } | null
      if (!cancelled) setSteps(data?.steps ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [selectedSessionId])

  // 引擎运行时实时接收新步骤
  useEffect(() => {
    const cleanup = window.electron?.on(
      'trace:step',
      (data: { sessionId: string; step: TraceStep }) => {
        setSessions((prev) => {
          if (prev.some((s) => s.sessionId === data.sessionId)) {
            return prev.map((s) =>
              s.sessionId === data.sessionId ? { ...s, stepCount: data.step.seq } : s
            )
          }
          // 新会话开始：刷新列表并自动跟进
          void reloadSessions()
          return prev
        })
        setSelectedSessionId((current) => current ?? data.sessionId)
        setSteps((prev) => {
          if (data.step.sessionId !== selectedSessionId) return prev
          if (prev.some((s) => s.stepId === data.step.stepId)) return prev
          return [...prev, data.step]
        })
      }
    )
    return cleanup
  }, [reloadSessions, selectedSessionId])

  const selectedSession = useMemo(
    () => sessions.find((s) => s.sessionId === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  )

  const handleLearn = useCallback(async () => {
    if (!selectedSessionId || learning) return
    setLearning(true)
    try {
      const result = (await window.electron?.invoke(
        'memory:learnFromSession',
        selectedSessionId
      )) as { success: boolean; error?: string; cards?: ExperienceCard[] }
      if (result?.success) {
        const count = result.cards?.length ?? 0
        showToast(count > 0 ? `已沉淀 ${count} 条经验` : '本次轨迹暂无可沉淀的经验', 'success')
        if (count > 0) {
          await reloadCards()
          setView('cards')
        }
      } else {
        showToast(result?.error || '经验沉淀失败', 'error')
      }
    } finally {
      setLearning(false)
    }
  }, [learning, reloadCards, selectedSessionId])

  return (
    <div className="memory-shell">
      <aside className="memory-sidebar">
        <div className="settings-sidebar-brand">
          <img src={logoUrl} alt="SightFlow" className="app-logo" />
          <span>工作记忆</span>
        </div>

        <button
          className={`settings-nav-item ${view === 'traces' ? 'active' : ''}`}
          onClick={() => setView('traces')}
        >
          执行轨迹
        </button>
        <button
          className={`settings-nav-item ${view === 'cards' ? 'active' : ''}`}
          onClick={() => setView('cards')}
        >
          经验卡片{cards.length > 0 ? `（${cards.length}）` : ''}
        </button>

        {view === 'traces' ? (
          <div className="memory-session-list">
            {sessions.length === 0 ? (
              <div className="memory-empty">
                还没有轨迹。启动引擎跑一轮，每一步都会被记录在这里。
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.sessionId}
                  className={`memory-session-item ${
                    session.sessionId === selectedSessionId ? 'selected' : ''
                  }`}
                  onClick={() => setSelectedSessionId(session.sessionId)}
                >
                  <div className="memory-session-time">{formatDateTime(session.startedAt)}</div>
                  <div className="memory-session-meta">
                    <span>{session.appType}</span>
                    <span>{session.stepCount} 步</span>
                    {!session.endedAt ? <span className="memory-live-dot">● 进行中</span> : null}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </aside>

      <main className="memory-main">
        {view === 'traces' ? (
          <TraceView
            session={selectedSession}
            steps={steps}
            learning={learning}
            onLearn={handleLearn}
            onCardAdded={reloadCards}
          />
        ) : (
          <CardsView cards={cards} onChanged={reloadCards} />
        )}
      </main>
    </div>
  )
}

// ── 轨迹时间轴 + 回放 ──

function TraceView({
  session,
  steps,
  learning,
  onLearn,
  onCardAdded
}: {
  session: TraceSessionMeta | null
  steps: TraceStep[]
  learning: boolean
  onLearn: () => void
  onCardAdded: () => Promise<void> | void
}): React.JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)

  const selectedIndex = useMemo(() => {
    const index = steps.findIndex((s) => s.stepId === selectedStepId)
    return index === -1 ? steps.length - 1 : index
  }, [steps, selectedStepId])
  const selectedStep = steps[selectedIndex] ?? null

  // 回放：按时间轴顺序自动步进，播到末尾自动停
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      if (selectedIndex >= steps.length - 1) {
        setPlaying(false)
      } else {
        setSelectedStepId(steps[selectedIndex + 1]?.stepId ?? null)
      }
    }, 900)
    return () => window.clearTimeout(timer)
  }, [playing, selectedIndex, steps])

  // 未手动选择时跟随最新步骤滚动（live 模式）
  useEffect(() => {
    if (selectedStepId === null && timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    }
  }, [steps, selectedStepId])

  if (!session) {
    return (
      <div className="memory-empty memory-empty-main">左侧选择一次执行，查看完整工作轨迹。</div>
    )
  }

  return (
    <div className="memory-trace-view">
      <div className="memory-trace-header">
        <div>
          <h1>{formatDateTime(session.startedAt)}</h1>
          <p>
            {session.appType} · {session.model || session.providerId || '未知模型'} · {steps.length}{' '}
            步{session.endedAt ? '' : ' · 进行中'}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={onLearn}
          disabled={learning || steps.length === 0}
        >
          {learning ? '归纳中...' : '从这次轨迹学习'}
        </button>
      </div>

      <div className="memory-trace-body">
        <div className="memory-timeline" ref={timelineRef}>
          {steps.map((step, index) => (
            <button
              key={step.stepId}
              className={`trace-step-card ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => {
                setPlaying(false)
                setSelectedStepId(step.stepId)
              }}
            >
              <div className="trace-step-top">
                <span className={`phase-badge phase-${step.phase}`}>
                  {PHASE_LABELS[step.phase]}
                </span>
                <span className="trace-step-time">
                  #{step.seq} · {formatTime(step.ts)}
                </span>
                {step.actor === 'human' ? <span className="actor-badge">人工</span> : null}
                {step.reasoning?.memoryRefs?.length ? (
                  <span className="memory-ref-badge" title="本步引用了团队经验">
                    📎 经验×{step.reasoning.memoryRefs.length}
                  </span>
                ) : null}
                {step.outcome ? (
                  <span className={`outcome-badge outcome-${step.outcome.status}`}>
                    {step.outcome.status === 'ok'
                      ? '成功'
                      : step.outcome.status === 'fail'
                        ? '失败'
                        : '跳过'}
                  </span>
                ) : null}
              </div>
              <div className="trace-step-summary">{step.summary}</div>
              {step.action?.payload ? (
                <div className="trace-step-payload">{step.action.payload}</div>
              ) : null}
              {step.screen ? (
                <Screenshot
                  sessionId={step.sessionId}
                  screenshotPath={step.screen.screenshotPath}
                  className="trace-step-thumb"
                />
              ) : null}
            </button>
          ))}
          {steps.length === 0 ? <div className="memory-empty">本次执行还没有步骤。</div> : null}
        </div>

        <div className="memory-detail">
          {selectedStep ? (
            <StepDetail
              step={selectedStep}
              stepIndex={selectedIndex}
              stepTotal={steps.length}
              playing={playing}
              onSeek={(index) => {
                setPlaying(false)
                setSelectedStepId(steps[index]?.stepId ?? null)
              }}
              onTogglePlay={() => {
                if (!playing && selectedIndex >= steps.length - 1) {
                  setSelectedStepId(steps[0]?.stepId ?? null)
                }
                setPlaying((p) => !p)
              }}
              onCardAdded={onCardAdded}
            />
          ) : (
            <div className="memory-empty">点击左侧步骤查看细节与回放。</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StepDetail({
  step,
  stepIndex,
  stepTotal,
  playing,
  onSeek,
  onTogglePlay,
  onCardAdded
}: {
  step: TraceStep
  stepIndex: number
  stepTotal: number
  playing: boolean
  onSeek: (index: number) => void
  onTogglePlay: () => void
  onCardAdded: () => Promise<void> | void
}): React.JSX.Element {
  const [correcting, setCorrecting] = useState(false)

  return (
    <div className="step-detail">
      <div className="replay-bar">
        <button className="btn btn-secondary replay-play-btn" onClick={onTogglePlay}>
          {playing ? '⏸ 暂停' : '▶ 回放'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(stepTotal - 1, 0)}
          value={stepIndex}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="replay-slider"
        />
        <span className="replay-progress">
          {stepIndex + 1} / {stepTotal}
        </span>
      </div>

      {step.screen ? (
        <Screenshot
          sessionId={step.sessionId}
          screenshotPath={step.screen.screenshotPath}
          className="step-detail-screenshot"
        />
      ) : (
        <div className="step-detail-noscreen">
          <span className={`phase-badge phase-${step.phase}`}>{PHASE_LABELS[step.phase]}</span>
          本步无界面截图
        </div>
      )}

      <div className="step-detail-fields">
        <div className="step-detail-row">
          <span className="step-detail-label">摘要</span>
          <span>{step.summary}</span>
        </div>
        {step.reasoning?.content && step.reasoning.content !== step.summary ? (
          <div className="step-detail-row">
            <span className="step-detail-label">判断依据</span>
            <span>{step.reasoning.content}</span>
          </div>
        ) : null}
        {step.action ? (
          <div className="step-detail-row">
            <span className="step-detail-label">动作</span>
            <span>
              {step.action.kind}
              {step.action.target ? `（${step.action.target[0]}, ${step.action.target[1]}）` : ''}
              {step.action.payload ? `：${step.action.payload}` : ''}
            </span>
          </div>
        ) : null}
        {step.outcome ? (
          <div className="step-detail-row">
            <span className="step-detail-label">结果</span>
            <span>
              {step.outcome.status}
              {step.outcome.latencyMs != null ? ` · ${step.outcome.latencyMs}ms` : ''}
              {step.outcome.detail ? ` · ${step.outcome.detail}` : ''}
            </span>
          </div>
        ) : null}
        {step.reasoning?.memoryRefs?.length ? (
          <div className="step-detail-row">
            <span className="step-detail-label">引用经验</span>
            <span>📎 {step.reasoning.memoryRefs.length} 条团队经验参与了本步判断</span>
          </div>
        ) : null}
      </div>

      {correcting ? (
        <CorrectionForm
          step={step}
          onDone={async (saved) => {
            setCorrecting(false)
            if (saved) await onCardAdded()
          }}
        />
      ) : (
        <button className="btn btn-secondary" onClick={() => setCorrecting(true)}>
          纠正这一步 → 沉淀为经验
        </button>
      )}
    </div>
  )
}

// 人工纠正表单：把"这一步应该怎么做"沉淀为 human_takeover 经验卡片
function CorrectionForm({
  step,
  onDone
}: {
  step: TraceStep
  onDone: (saved: boolean) => void
}): React.JSX.Element {
  const [scenario, setScenario] = useState('')
  const [guidance, setGuidance] = useState('')
  const [rationale, setRationale] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    if (!scenario.trim() || !guidance.trim()) {
      showToast('请填写场景和正确做法', 'error')
      return
    }
    setSaving(true)
    try {
      const result = (await window.electron?.invoke('memory:addCard', {
        scenario,
        guidance,
        rationale,
        source: 'human_takeover',
        evidence: { sessionId: step.sessionId, stepIds: [step.stepId] }
      })) as { success: boolean; error?: string }
      if (result?.success) {
        showToast('已沉淀为团队经验，下一轮立即生效', 'success')
        onDone(true)
      } else {
        showToast(result?.error || '保存失败', 'error')
      }
    } finally {
      setSaving(false)
    }
  }, [guidance, onDone, rationale, scenario, step.sessionId, step.stepId])

  return (
    <div className="correction-form">
      <div className="card-title">人工纠正</div>
      <div className="form-group">
        <label className="form-label">什么情况下（场景）</label>
        <input
          className="form-input"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          placeholder="例如：客户询问报价时"
        />
      </div>
      <div className="form-group">
        <label className="form-label">应该怎么做</label>
        <textarea
          className="form-input"
          rows={3}
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="例如：先确认具体需求和数量，再给出报价区间，不要直接报最低价"
        />
      </div>
      <div className="form-group">
        <label className="form-label">为什么（可选）</label>
        <input
          className="form-input"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="例如：直接报价容易被比价，先了解需求才能匹配方案"
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => onDone(false)} disabled={saving}>
          取消
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 1 }}
        >
          {saving ? '保存中...' : '保存经验'}
        </button>
      </div>
    </div>
  )
}

// ── 经验卡片列表 ──

function CardsView({
  cards,
  onChanged
}: {
  cards: ExperienceCard[]
  onChanged: () => Promise<void> | void
}): React.JSX.Element {
  const handleToggle = useCallback(
    async (card: ExperienceCard) => {
      await window.electron?.invoke('memory:setCardEnabled', card.cardId, !card.enabled)
      await onChanged()
    },
    [onChanged]
  )

  const handleDelete = useCallback(
    async (card: ExperienceCard) => {
      await window.electron?.invoke('memory:deleteCard', card.cardId)
      showToast('经验卡片已删除', 'success')
      await onChanged()
    },
    [onChanged]
  )

  return (
    <div className="memory-cards-view">
      <div className="memory-trace-header">
        <div>
          <h1>经验卡片</h1>
          <p>启用中的卡片会在每轮判断前注入给智能体，被引用与成功次数自动统计。</p>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="memory-empty memory-empty-main">
          还没有经验。在「执行轨迹」里点「从这次轨迹学习」，或对某一步做人工纠正。
        </div>
      ) : (
        <div className="memory-cards-list">
          {cards.map((card) => (
            <div key={card.cardId} className={`memory-card ${card.enabled ? '' : 'disabled'}`}>
              <div className="memory-card-top">
                <span className={`source-badge source-${card.source}`}>
                  {SOURCE_LABELS[card.source]}
                </span>
                <span className="memory-card-stats">
                  被引用 {card.stats.used} 次 · 成功 {card.stats.success} 次
                </span>
                <div className="memory-card-actions">
                  <button className="btn-text" onClick={() => handleToggle(card)}>
                    {card.enabled ? '停用' : '启用'}
                  </button>
                  <button className="btn-text danger" onClick={() => handleDelete(card)}>
                    删除
                  </button>
                </div>
              </div>
              <div className="memory-card-scenario">【{card.scenario}】</div>
              <div className="memory-card-guidance">{card.guidance}</div>
              {card.rationale ? (
                <div className="memory-card-rationale">为什么：{card.rationale}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
