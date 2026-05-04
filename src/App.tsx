import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type InsightCard = {
  label: string
  value: string
  score?: number
  evidence?: string
  evidence_level?: string
}

type Intervention = {
  second: number
  title: string
  description: string
  tone?: 'warning' | 'primary' | 'success'
}

type ScriptDiffItem = {
  original: string
  issue_tag: string
  optimized: string
  reason: string
}

type AnalysisMetadata = {
  title?: string
  author?: string
  duration?: number | string
  platform?: string
  publish_time?: string
  category?: string
  [key: string]: unknown
}

type FeatureItem = {
  name?: string
  label?: string
  value?: string | number
  score?: number
  description?: string
  [key: string]: unknown
}

type FeatureMap = Record<string, unknown>

type EvidenceItem = {
  label?: string
  source?: string
  value?: string | number
  confidence?: number | string
  detail?: string
  text?: string
  quote?: string
  level?: string
  [key: string]: unknown
}

type AnalysisResponse = {
  analyzed_url?: string
  source?: string
  model?: string
  metadata?: AnalysisMetadata
  features?: FeatureItem[] | FeatureMap
  evidence?: EvidenceItem[]
  script_diff?: ScriptDiffItem[]
  conversion_lift?: number | string | { low?: number; high?: number; label?: string; basis?: string }
  confidence?: number | string
  evidence_level?: string
  radar_scores: number[]
  retention_curve: number[]
  original_script: string
  optimized_script: string
  insight_cards: InsightCard[]
  interventions: Intervention[]
}

type PipelineStep = {
  title: string
  preview: string
}

const METRIC_LABELS = ['视觉张力', 'BGM 契合', '前 3 秒留存', '情绪波动', 'Hook 密度']
const REQUEST_TIMEOUT_MS = 12_000
const MIN_LOADING_MS = 4_200

const EXAMPLE_LINKS = [
  'https://v.qq.com/x/page/campus-sunscreen-case.html?title=军训防晒喷雾实拍对比&desc=三天实测 轻薄不搓泥 左下角领取清单',
  'https://qzone.qq.com/koc/campaign/natural-note?title=宿舍好物收纳实测&desc=对比前后空间变化 评论区领取清单',
  'https://v.qq.com/x/page/commute-skincare-note.html?title=通勤护肤60秒拆解&desc=早八上脸不搓泥 一周实拍反馈',
]

const RECENT_TASKS = [
  '校园防晒爆款复盘',
  '宿舍好物转化脚本',
  '通勤护肤 60 秒拆解',
]

const PIPELINE_STEPS: PipelineStep[] = [
  { title: '链接校验', preview: '识别平台、URL 结构与可解析参数' },
  { title: '元信息抽取', preview: '读取标题、作者、时长、发布时间与内容类目' },
  { title: 'Hook / 情绪 / CTA 特征工程', preview: '量化开场张力、情绪转折与转化动作密度' },
  { title: '留存曲线生成', preview: '生成 0-60 秒观看完成率与关键流失点' },
  { title: '脚本 Diff 重构', preview: '逐句对齐原文阻力点与高转化改写建议' },
]

const VALID_TONES = ['warning', 'primary', 'success'] as const
type ValidTone = (typeof VALID_TONES)[number]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function normalizeTone(value: unknown, index: number): ValidTone {
  if (typeof value === 'string' && (VALID_TONES as readonly string[]).includes(value)) {
    return value as ValidTone
  }

  return VALID_TONES[index % VALID_TONES.length]
}

function normalizeNumberArray(values: unknown, expectedLength: number, fieldName: string, min = 0, max = 100) {
  if (!Array.isArray(values)) {
    throw new Error(`${fieldName} is missing`)
  }

  const normalized = values.slice(0, expectedLength).map((value, index) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      throw new Error(`${fieldName}[${index}] is not a number`)
    }

    const safeValue = parsed
    return Number(clamp(safeValue, min, max).toFixed(1))
  })

  if (normalized.length < expectedLength) {
    throw new Error(`${fieldName} length must be ${expectedLength}`)
  }

  return normalized
}

function normalizeMetadata(value: unknown): AnalysisMetadata {
  return value && typeof value === 'object' ? (value as AnalysisMetadata) : {}
}

function normalizeFeatures(value: unknown): FeatureItem[] {
  if (!Array.isArray(value)) {
    if (value && typeof value === 'object') {
      return Object.entries(value as FeatureMap)
        .filter(([, entryValue]) => typeof entryValue === 'number' || typeof entryValue === 'string' || typeof entryValue === 'boolean')
        .slice(0, 8)
        .map(([key, entryValue]) => ({
          label: key,
          value: typeof entryValue === 'number' ? Number(entryValue).toFixed(entryValue <= 1 ? 2 : 0) : String(entryValue),
        }))
    }

    return []
  }

  return value.filter((item): item is FeatureItem => Boolean(item && typeof item === 'object'))
}

function normalizeEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is EvidenceItem => Boolean(item && typeof item === 'object'))
}

function normalizeScriptDiff(value: unknown): ScriptDiffItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const row = item as Partial<ScriptDiffItem> & {
        original_sentence?: string
        optimized_sentence?: string
        tag?: string
        issue?: string
      }

      return {
        original: String(row.original ?? row.original_sentence ?? ''),
        issue_tag: String(row.issue_tag ?? row.tag ?? row.issue ?? '结构阻力'),
        optimized: String(row.optimized ?? row.optimized_sentence ?? ''),
        reason: String(row.reason ?? '基于特征工程结果重排表达顺序与转化触点。'),
      }
    })
    .filter((item): item is ScriptDiffItem => Boolean(item?.original || item?.optimized))
}

function normalizePayload(payload: unknown, url: string): AnalysisResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('API returned an invalid payload')
  }

  const data = payload as Partial<AnalysisResponse>
  const insightCards = Array.isArray(data.insight_cards)
    ? data.insight_cards
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null
          }

          const card = item as InsightCard
          return {
            label: card.label ?? '分析卡片',
            value: card.value ?? '该维度已完成结构化分析。',
            score: typeof card.score === 'number' ? clamp(Math.round(card.score), 0, 100) : undefined,
            evidence: card.evidence,
            evidence_level: card.evidence_level,
          }
        })
        .filter(Boolean) as InsightCard[]
    : []

  const interventions = Array.isArray(data.interventions)
    ? data.interventions
        .map((item, index) => {
          if (!item || typeof item !== 'object') {
            return null
          }

          const point = item as Intervention
          return {
            second: clamp(Math.round(Number(point.second) || 0), 0, 60),
            title: point.title ?? `节点 ${index + 1}`,
            description: point.description ?? '该节点需要补充更明确的内容动作。',
            tone: normalizeTone(point.tone, index),
          }
        })
        .filter(Boolean) as Intervention[]
    : []

  const originalScript = typeof data.original_script === 'string' ? data.original_script.trim() : ''
  const optimizedScript = typeof data.optimized_script === 'string' ? data.optimized_script.trim() : ''

  if (!originalScript || !optimizedScript) {
    throw new Error('API returned incomplete script fields')
  }

  return {
    analyzed_url: data.analyzed_url || url,
    source: data.source || 'feature-engineering',
    model: data.model || 'Explainable Feature Engineering',
    metadata: normalizeMetadata(data.metadata),
    features: normalizeFeatures(data.features),
    evidence: normalizeEvidence(data.evidence),
    script_diff: normalizeScriptDiff(data.script_diff),
    conversion_lift: data.conversion_lift,
    confidence: data.confidence,
    evidence_level: data.evidence_level,
    radar_scores: normalizeNumberArray(data.radar_scores, 5, 'radar_scores'),
    retention_curve: normalizeNumberArray(data.retention_curve, 60, 'retention_curve'),
    original_script: originalScript,
    optimized_script: optimizedScript,
    insight_cards: insightCards,
    interventions,
  }
}

function splitScript(script: string) {
  return script
    .split(/(?<=[。！？；.!?])\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function getApiEndpoint() {
  const override = import.meta.env.VITE_API_ENDPOINT?.trim()
  if (override) {
    return override
  }

  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return 'http://localhost:8000/api/reverse-engineer'
  }

  return '/api/reverse-engineer'
}

function buildRadarPolygon(scores: number[]) {
  return scores
    .map((score, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / scores.length
      const radius = 12 + (clamp(score, 0, 100) / 100) * 34
      const x = 50 + Math.cos(angle) * radius
      const y = 50 + Math.sin(angle) * radius
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function buildCurvePath(curve: number[]) {
  return curve
    .map((value, index) => {
      const x = (index / (curve.length - 1)) * 100
      const y = 100 - clamp(value, 0, 100)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function buildAreaPath(curve: number[]) {
  const line = buildCurvePath(curve)
  return `${line} L 100 100 L 0 100 Z`
}

function formatPercent(value: number | string | undefined, emptyText = '--') {
  if (value === undefined || value === null || value === '') {
    return emptyText
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return String(value)
  }

  const normalized = parsed <= 1 ? parsed * 100 : parsed
  return `${Math.round(normalized)}%`
}

function renderEvidenceDetail(item?: EvidenceItem) {
  if (!item) {
    return '由元信息、脚本结构与曲线节点共同支持。'
  }

  return String(item.detail ?? item.value ?? item.text ?? item.quote ?? '由元信息、脚本结构与曲线节点共同支持。')
}

function renderEvidenceLevel(item: EvidenceItem | undefined, defaultLevel?: string) {
  if (!item) {
    return defaultLevel ?? '中'
  }

  if (item.level) {
    return item.level
  }

  if (item.confidence !== undefined && item.confidence !== null && item.confidence !== '') {
    return formatPercent(item.confidence)
  }

  return defaultLevel ?? '中'
}

function formatLift(value: AnalysisResponse['conversion_lift']) {
  if (value === undefined || value === null || value === '') {
    return '+--%'
  }

  if (typeof value === 'object') {
    if (value.label) {
      return value.label
    }

    if (typeof value.low === 'number' && typeof value.high === 'number') {
      return `+${Math.round(value.low)}% ~ +${Math.round(value.high)}%`
    }
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return String(value)
  }

  return `${parsed > 0 ? '+' : ''}${Math.round(parsed)}%`
}

function buildDiffRows(analysis: AnalysisResponse): ScriptDiffItem[] {
  if (analysis.script_diff?.length) {
    return analysis.script_diff
  }

  const originalLines = splitScript(analysis.original_script)
  const optimizedLines = splitScript(analysis.optimized_script)
  const size = Math.max(originalLines.length, optimizedLines.length)

  return Array.from({ length: size }, (_, index) => ({
    original: originalLines[index] ?? '原脚本该段缺失',
    issue_tag: index === 0 ? 'Hook 不足' : index === size - 1 ? 'CTA 偏弱' : '表达松散',
    optimized: optimizedLines[index] ?? '建议补充承接句',
    reason:
      index === 0
        ? '开场改为痛点直给，降低用户划走概率。'
        : index === size - 1
          ? '结尾补齐明确转化动作，让用户知道下一步。'
          : '压缩铺垫并前置证据，使卖点更快被理解。',
  }))
}

function App() {
  const [url, setUrl] = useState('')
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [phaseIndex, setPhaseIndex] = useState(0)

  useEffect(() => {
    if (!loading) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setPhaseIndex((current) => Math.min(current + 1, PIPELINE_STEPS.length - 1))
    }, 820)

    return () => window.clearInterval(timer)
  }, [loading])

  const radarPolygon = useMemo(() => (analysis ? buildRadarPolygon(analysis.radar_scores) : ''), [analysis])
  const curvePath = useMemo(() => (analysis ? buildCurvePath(analysis.retention_curve) : ''), [analysis])
  const areaPath = useMemo(() => (analysis ? buildAreaPath(analysis.retention_curve) : ''), [analysis])
  const diffRows = useMemo(() => (analysis ? buildDiffRows(analysis) : []), [analysis])
  const aggregateScore = analysis
    ? Math.round(analysis.radar_scores.reduce((sum, value) => sum + value, 0) / analysis.radar_scores.length)
    : 0

  async function runAnalysis(nextUrl: string) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    const response = await fetch(getApiEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ url: nextUrl }),
    }).finally(() => window.clearTimeout(timeout))

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const payload = await response.json()
    setAnalysis(normalizePayload(payload, nextUrl))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setErrorMessage('请先输入需要解析的内容链接。')
      return
    }

    setLoading(true)
    setPhaseIndex(0)
    setErrorMessage('')
    const startedAt = performance.now()

    try {
      await runAnalysis(trimmedUrl)
    } catch (error) {
      console.error(error)
      setAnalysis(null)
      setErrorMessage('解析请求未完成。请检查链接格式或稍后重试。')
    } finally {
      const remaining = MIN_LOADING_MS - (performance.now() - startedAt)
      if (remaining > 0) {
        await sleep(remaining)
      }
      setLoading(false)
      setPhaseIndex(PIPELINE_STEPS.length - 1)
    }
  }

  return (
    <div className="shell">
      <aside className="side-nav">
        <div className="brand-stack">
          <div className="brand-badge">KOC</div>
          <div className="brand-text">ENGINE</div>
        </div>
        <div className="nav-cluster">
          <button className="nav-chip nav-chip--active" type="button">
            逆向解析
          </button>
          <button className="nav-chip" type="button">
            特征工程
          </button>
          <button className="nav-chip" type="button">
            脚本重构
          </button>
        </div>
        <div className="nav-foot">
          <span>Explainable</span>
          <span>Production</span>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">KOC-Engine / 多模态逆向解析工作台</p>
            <h1>把爆款内容拆成可复用的增长结构</h1>
          </div>
          <div className="topbar-meta">
            <span>算法来源：可解释特征工程 v1 / 元信息增强</span>
            {analysis ? <span>置信度：{formatPercent(analysis.confidence)}</span> : <span>待解析</span>}
            {analysis ? <span>证据等级：{analysis.evidence_level ?? '中'}</span> : null}
          </div>
        </header>

        <main className="board">
          <section className="hero-card">
            <div className="hero-copy">
              <p className="eyebrow">Multimodal Reverse Pipeline</p>
              <h2>输入一条内容链接，生成留存曲线、特征雷达与逐句改写策略</h2>
              <p className="hero-description">
                系统会按链接校验、元信息抽取、特征工程、留存曲线和脚本重构五个阶段运行，
                输出可解释的内容增长诊断。
              </p>
            </div>

            <form className="hero-form" onSubmit={handleSubmit}>
              <div className="field-shell">
                <label className="field-label" htmlFor="video-url">
                  内容链接
                </label>
                <input
                  id="video-url"
                  className="link-input"
                  disabled={loading}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="粘贴腾讯视频 / QQ 空间 / 内容页链接"
                  inputMode="url"
                  type="text"
                  value={url}
                />
              </div>

              <button className="hero-button" disabled={loading} type="submit">
                <span>{loading ? PIPELINE_STEPS[phaseIndex].title : '启动逆向解析'}</span>
                <span className={`hero-button__pulse ${loading ? 'is-loading' : ''}`} aria-hidden="true" />
              </button>
            </form>

            <div className={`pipeline ${loading ? 'is-running' : ''}`} aria-live="polite">
              {PIPELINE_STEPS.map((step, index) => {
                const status = loading
                  ? index < phaseIndex
                    ? 'done'
                    : index === phaseIndex
                      ? 'active'
                      : 'pending'
                  : analysis
                    ? 'done'
                    : 'pending'

                return (
                  <div className={`pipeline-step pipeline-step--${status}`} key={step.title}>
                    <span className="pipeline-step__index">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.preview}</p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="hero-strip">
              <button className="hero-pill hero-pill--button" onClick={() => setUrl(EXAMPLE_LINKS[0])} type="button">
                <span className="hero-pill__label">快速填入测试链接</span>
                <strong>{EXAMPLE_LINKS[0]}</strong>
              </button>
              <div className="hero-pill">
                <span className="hero-pill__label">业务场景队列</span>
                <strong>{RECENT_TASKS.join(' / ')}</strong>
              </div>
            </div>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          </section>

          {!analysis ? (
            <section className="empty-state">
              <div>
                <p className="eyebrow">Ready For Analysis</p>
                <h3>等待解析内容</h3>
                <p>
                  当前不会预先展示完整结果。选择测试链接或粘贴真实内容链接后，系统会生成可解释分析报告。
                </p>
              </div>
                <div className="empty-state__tasks">
                {RECENT_TASKS.map((task) => (
                  <button className="recent-task" key={task} onClick={() => setUrl(EXAMPLE_LINKS[RECENT_TASKS.indexOf(task)] ?? EXAMPLE_LINKS[0])} type="button">
                    <span>场景模板</span>
                    <strong>{task}</strong>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="result-stack">
              <section className="summary-grid">
                <article className="summary-card">
                  <span>算法来源</span>
                  <strong>可解释特征工程 v1 / 元信息增强</strong>
                </article>
                <article className="summary-card">
                  <span>预估转化提升</span>
                  <strong>{formatLift(analysis.conversion_lift)}</strong>
                </article>
                <article className="summary-card">
                  <span>置信度</span>
                  <strong>{formatPercent(analysis.confidence)}</strong>
                </article>
                <article className="summary-card">
                  <span>证据等级</span>
                  <strong>{analysis.evidence_level ?? '中'}</strong>
                </article>
              </section>

              <section className="metadata-panel">
                <div>
                  <p className="eyebrow">Metadata</p>
                  <h3>{String(analysis.metadata?.title ?? '已解析内容')}</h3>
                  <p>{analysis.analyzed_url}</p>
                </div>
                <div className="metadata-list">
                  <span>平台：{String(analysis.metadata?.platform ?? '内容平台')}</span>
                  <span>作者：{String(analysis.metadata?.author ?? '待识别')}</span>
                  <span>时长：{analysis.metadata?.duration ? `${String(analysis.metadata.duration)}s` : '待识别'}</span>
                  <span>类目：{String(analysis.metadata?.category ?? 'KOC 内容')}</span>
                </div>
              </section>

              <section className="insight-row">
                {analysis.insight_cards.map((card, index) => (
                  <article className="insight-card" key={`${card.label}-${card.value}`}>
                    <p className="insight-card__label">{card.label}</p>
                    <p className="insight-card__value">{card.value}</p>
                    <p className="insight-card__evidence">
                      证据：{card.evidence ?? renderEvidenceDetail(analysis.evidence?.[index])}
                    </p>
                    <div className="insight-card__footer">
                      {typeof card.score === 'number' ? <strong>{card.score}</strong> : <span>策略</span>}
                      <em>{card.evidence_level ?? renderEvidenceLevel(analysis.evidence?.[index], analysis.evidence_level)}</em>
                    </div>
                  </article>
                ))}
              </section>

              <section className="panel-grid">
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">Feature Fingerprint</p>
                      <h3>多模态特征雷达</h3>
                    </div>
                    <strong className="panel-score">{aggregateScore}</strong>
                  </div>

                  <div className="radar-layout">
                    <div className="radar-shell">
                      <svg viewBox="0 0 100 100" aria-hidden="true">
                        <polygon className="radar-grid" points="50,8 90,36 74,84 26,84 10,36" />
                        <polygon className="radar-grid radar-grid--mid" points="50,22 78,42 67,74 33,74 22,42" />
                        <polygon className="radar-grid radar-grid--core" points="50,36 64,46 59,63 41,63 36,46" />
                        <line className="radar-axis" x1="50" x2="50" y1="50" y2="8" />
                        <line className="radar-axis" x1="50" x2="90" y1="50" y2="36" />
                        <line className="radar-axis" x1="50" x2="74" y1="50" y2="84" />
                        <line className="radar-axis" x1="50" x2="26" y1="50" y2="84" />
                        <line className="radar-axis" x1="50" x2="10" y1="50" y2="36" />
                        <polygon className="radar-data" points={radarPolygon} />
                        {analysis.radar_scores.map((score, index) => {
                          const angle = -Math.PI / 2 + (index * Math.PI * 2) / analysis.radar_scores.length
                          const radius = 12 + (clamp(score, 0, 100) / 100) * 34
                          const x = 50 + Math.cos(angle) * radius
                          const y = 50 + Math.sin(angle) * radius

                          return <circle className="radar-dot" cx={x} cy={y} key={METRIC_LABELS[index]} r="2.3" />
                        })}
                      </svg>
                    </div>

                    <div className="metric-list">
                      {METRIC_LABELS.map((label, index) => (
                        <div className="metric-row" key={label}>
                          <div>
                            <p>{label}</p>
                            <span>{analysis.radar_scores[index]} / 100</span>
                          </div>
                          <div className="metric-bar">
                            <span style={{ width: `${analysis.radar_scores[index]}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>

                <article className="panel panel--wide">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">Completion & Emotional Curve</p>
                      <h3>0-60 秒留存波形</h3>
                    </div>
                    <strong className="panel-score panel-score--accent">
                      {analysis.retention_curve[analysis.retention_curve.length - 1]}%
                    </strong>
                  </div>

                  <div className="curve-shell">
                    <svg className="curve-svg" preserveAspectRatio="none" viewBox="0 0 100 100">
                      <defs>
                        <linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="rgba(61, 135, 255, 0.42)" />
                          <stop offset="100%" stopColor="rgba(61, 135, 255, 0)" />
                        </linearGradient>
                      </defs>
                      <path className="curve-area" d={areaPath} fill="url(#curve-fill)" />
                      <path className="curve-line" d={curvePath} />
                    </svg>

                    {analysis.interventions.map((item, index) => (
                      <div
                        className={`curve-marker curve-marker--${item.tone ?? 'primary'}`}
                        key={`${item.title}-${item.second}`}
                        style={{
                          left: `${(item.second / 60) * 100}%`,
                          top: `${18 + (index % 2) * 34}px`,
                        }}
                      >
                        <span className="curve-marker__dot" />
                        <div className="curve-marker__label">
                          <strong>{item.title}</strong>
                          <span>{item.second}s</span>
                        </div>
                      </div>
                    ))}

                    <div className="curve-axis">
                      <span>0s</span>
                      <span>15s</span>
                      <span>30s</span>
                      <span>45s</span>
                      <span>60s</span>
                    </div>
                  </div>

                  <div className="intervention-grid">
                    {analysis.interventions.map((item) => (
                      <div className={`intervention-card intervention-card--${item.tone ?? 'primary'}`} key={`${item.second}-${item.title}`}>
                        <p>
                          {item.title}
                          <span>{item.second}s</span>
                        </p>
                        <strong>{item.description}</strong>
                      </div>
                    ))}
                  </div>
                </article>
              </section>

              <section className="panel script-panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Script Reconstruction Diff</p>
                    <h3>逐句对齐：原句、问题、优化句与原因</h3>
                  </div>
                  <strong className="panel-score panel-score--success">{formatLift(analysis.conversion_lift)} 预估转化</strong>
                </div>

                <div className="diff-list">
                  {diffRows.map((row, index) => (
                    <article className="diff-row" key={`${row.issue_tag}-${index}`}>
                      <div className="diff-cell diff-cell--original">
                        <span>原句</span>
                        <p>{row.original}</p>
                      </div>
                      <div className="diff-tag">{row.issue_tag}</div>
                      <div className="diff-cell diff-cell--optimized">
                        <span>优化句</span>
                        <p>{row.optimized}</p>
                      </div>
                      <div className="diff-reason">
                        <span>原因</span>
                        <p>{row.reason}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
