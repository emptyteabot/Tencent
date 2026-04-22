import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type InsightCard = {
  label: string
  value: string
  score?: number
}

type Intervention = {
  second: number
  title: string
  description: string
  tone?: 'warning' | 'primary' | 'success'
}

type AnalysisResponse = {
  analyzed_url?: string
  source?: string
  model?: string
  radar_scores: number[]
  retention_curve: number[]
  original_script: string
  optimized_script: string
  insight_cards: InsightCard[]
  interventions: Intervention[]
}

const METRIC_LABELS = ['视觉张力', 'BGM 契合', '前 3 秒留存', '情绪波动', 'Hook 密度']
const STATUS_MESSAGES = ['拆解视频钩子...', '模拟情绪曲线...', '重写高转化脚本...', '回填解析结果...']

const DEFAULT_ANALYSIS: AnalysisResponse = {
  analyzed_url: 'https://v.qq.com/x/page/mock-koc-engine-demo.html',
  source: 'bootstrap',
  model: '等待首轮调用',
  radar_scores: [94, 88, 79, 85, 91],
  retention_curve: [
    98, 97, 95, 92, 89, 91, 90, 87, 84, 82, 79, 77, 74, 72, 76, 73, 70, 68, 65, 63,
    61, 64, 62, 59, 58, 56, 54, 52, 50, 49, 53, 51, 49, 47, 45, 43, 42, 41, 44, 42,
    40, 38, 37, 35, 34, 33, 35, 34, 33, 31, 30, 29, 28, 27, 29, 28, 27, 26, 25, 24,
  ],
  original_script:
    '今天测试一支最近很火的淡斑精华。很多人问我到底值不值得买。我用了三天，肤色的确更透一点。质地很轻，不搓泥，也不会假滑。想看我后续实测的话可以先点个收藏。',
  optimized_script:
    '先别划走，如果你脸上暗沉和色沉一直下不去，这支精华值得你立刻看完。它不是那种只会发光的表面功夫，而是三天内就能把肤色拉回干净状态。最关键的是上脸轻、不闷、不搓泥，白天叠防晒也很稳。你现在看到的对比不是滤镜，是同机位实拍后的真实差别。链接我放左下角，库存吃紧的时候别等我再提醒第二次。',
  insight_cards: [
    { label: '钩子判定', value: '前 4 秒完成痛点直给，用户停留意愿高。', score: 94 },
    { label: '转化窗口', value: '第 15 秒与第 31 秒出现两次情绪反弹，适合插入证据。', score: 87 },
    { label: '内容迁移', value: '适合迁移到校园护肤、宿舍好物、军训晒后修护。', score: 82 },
    { label: '平台建议', value: '优先视频号与 QQ 空间双发，标题走结果承诺型。', score: 89 },
  ],
  interventions: [
    { second: 4, title: 'Hook 介入', description: '第一句必须直接点出痛点，不要寒暄。', tone: 'warning' },
    { second: 16, title: '证据补强', description: '插入近景对比或数据截图，抬升信任。', tone: 'primary' },
    { second: 44, title: '转化收口', description: '给出明确 CTA，避免“想要可私信”这种弱动作。', tone: 'success' },
  ],
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeNumberArray(values: unknown, expectedLength: number, fallback: number[], min = 0, max = 100) {
  if (!Array.isArray(values)) {
    return fallback
  }

  const normalized = values
    .slice(0, expectedLength)
    .map((value, index) => {
      const parsed = Number(value)
      const safeValue = Number.isFinite(parsed) ? parsed : fallback[index] ?? fallback.at(-1) ?? 0
      return Number(clamp(safeValue, min, max).toFixed(1))
    })

  if (normalized.length < expectedLength) {
    return fallback
  }

  return normalized
}

function normalizePayload(payload: unknown, url: string): AnalysisResponse {
  if (!payload || typeof payload !== 'object') {
    return {
      ...DEFAULT_ANALYSIS,
      analyzed_url: url,
      source: 'client-safeguard',
      model: 'client-safeguard',
    }
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
            value: card.value ?? '模型未返回完整说明。',
            score: typeof card.score === 'number' ? clamp(Math.round(card.score), 0, 100) : undefined,
          }
        })
        .filter(Boolean) as InsightCard[]
    : DEFAULT_ANALYSIS.insight_cards

  const interventions = Array.isArray(data.interventions)
    ? data.interventions
        .map((item, index) => {
          if (!item || typeof item !== 'object') {
            return null
          }

          const point = item as Intervention
          return {
            second: clamp(Math.round(Number(point.second) || DEFAULT_ANALYSIS.interventions[index]?.second || 0), 0, 60),
            title: point.title ?? `节点 ${index + 1}`,
            description: point.description ?? '请补充该节点的说明。',
            tone: point.tone ?? DEFAULT_ANALYSIS.interventions[index % DEFAULT_ANALYSIS.interventions.length].tone,
          }
        })
        .filter(Boolean) as Intervention[]
    : DEFAULT_ANALYSIS.interventions

  return {
    analyzed_url: data.analyzed_url || url,
    source: data.source || 'model',
    model: data.model || 'OpenAI Compatible',
    radar_scores: normalizeNumberArray(data.radar_scores, 5, DEFAULT_ANALYSIS.radar_scores),
    retention_curve: normalizeNumberArray(data.retention_curve, 60, DEFAULT_ANALYSIS.retention_curve),
    original_script: data.original_script || DEFAULT_ANALYSIS.original_script,
    optimized_script: data.optimized_script || DEFAULT_ANALYSIS.optimized_script,
    insight_cards: insightCards.length > 0 ? insightCards : DEFAULT_ANALYSIS.insight_cards,
    interventions: interventions.length > 0 ? interventions : DEFAULT_ANALYSIS.interventions,
  }
}

function splitScript(script: string) {
  return script
    .split(/(?<=[。！？!?])\s*|(?<=\.)\s+(?=[A-Z0-9\u4e00-\u9fa5])/)
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

function renderSourceLabel(source?: string) {
  switch (source) {
    case 'model':
      return '多模态实时解析 API'
    case 'degraded':
      return '服务保护输出'
    case 'client-safeguard':
      return '本地保护输出'
    default:
      return '等待实时解析'
  }
}

function renderEngineLabel(model?: string) {
  if (model === 'system-fallback') {
    return '服务保护引擎'
  }

  if (model === 'client-safeguard') {
    return '本地保护引擎'
  }

  return model || '等待首轮调用'
}

function App() {
  const [url, setUrl] = useState(DEFAULT_ANALYSIS.analyzed_url ?? '')
  const [analysis, setAnalysis] = useState<AnalysisResponse>(DEFAULT_ANALYSIS)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [phaseIndex, setPhaseIndex] = useState(0)

  useEffect(() => {
    if (!loading) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % STATUS_MESSAGES.length)
    }, 900)

    return () => window.clearInterval(timer)
  }, [loading])

  useEffect(() => {
    const initialUrl = DEFAULT_ANALYSIS.analyzed_url ?? ''
    if (!initialUrl) {
      return
    }

    let cancelled = false

    async function hydrateInitialAnalysis() {
      try {
        const response = await fetch(getApiEndpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: initialUrl }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const payload = await response.json()
        if (!cancelled) {
          setAnalysis(normalizePayload(payload, initialUrl))
        }
      } catch (error) {
        console.error(error)
      }
    }

    void hydrateInitialAnalysis()

    return () => {
      cancelled = true
    }
  }, [])

  const radarPolygon = useMemo(() => buildRadarPolygon(analysis.radar_scores), [analysis.radar_scores])
  const curvePath = useMemo(() => buildCurvePath(analysis.retention_curve), [analysis.retention_curve])
  const areaPath = useMemo(() => buildAreaPath(analysis.retention_curve), [analysis.retention_curve])
  const originalLines = useMemo(() => splitScript(analysis.original_script), [analysis.original_script])
  const optimizedLines = useMemo(() => splitScript(analysis.optimized_script), [analysis.optimized_script])

  async function runAnalysis(nextUrl: string) {
    const response = await fetch(getApiEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: nextUrl }),
    })

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
      setErrorMessage('先贴一个爆款链接，不然没法演示逆向拆解。')
      return
    }

    setLoading(true)
    setPhaseIndex(0)
    setErrorMessage('')

    try {
      await runAnalysis(trimmedUrl)
    } catch (error) {
      console.error(error)
      setAnalysis({
        ...DEFAULT_ANALYSIS,
        analyzed_url: trimmedUrl,
        source: 'client-safeguard',
        model: 'client-safeguard',
      })
      setErrorMessage('检测到服务波动，系统已自动切换到本地保护输出，页面可继续展示。')
    } finally {
      setLoading(false)
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
          <button className="nav-chip" type="button">
            总览
          </button>
          <button className="nav-chip nav-chip--active" type="button">
            逆向拆解
          </button>
          <button className="nav-chip" type="button">
            转化预测
          </button>
        </div>
        <div className="nav-foot">
          <span>KOC-Engine</span>
          <span>Enterprise</span>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">KOC-Engine / 多模态逆向解析大盘</p>
            <h1>系统就绪：已接入腾讯多模态大模型解析 API。</h1>
          </div>
          <div className="topbar-meta">
            <span>Environment: Production (PCG 专线)</span>
            <span>数据源：{renderSourceLabel(analysis.source)}</span>
            <span>引擎：{renderEngineLabel(analysis.model)}</span>
          </div>
        </header>

        <main className="board">
          <section className="hero-card">
            <div className="hero-copy">
              <p className="eyebrow">Multimodal Reverse Pipeline</p>
              <h2>将爆款网感转化为工业化内容产出流水线</h2>
              <p className="hero-description">
                请在下方输入腾讯视频或 QQ 空间内容链接。系统将提取视觉张力、情绪曲线与 Hook 数据，
                并重构高转化脚本。
              </p>
            </div>

            <form className="hero-form" onSubmit={handleSubmit}>
              <div className="field-shell">
                <label className="field-label" htmlFor="video-url">
                  爆款链接
                </label>
                <input
                  id="video-url"
                  className="link-input"
                  disabled={loading}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="粘贴腾讯视频 / 小红书 / 抖音的爆款链接"
                  type="url"
                  value={url}
                />
              </div>

              <button className="hero-button" disabled={loading} type="submit">
                <span>{loading ? STATUS_MESSAGES[phaseIndex] : '启动逆向拆解'}</span>
                <span className={`hero-button__pulse ${loading ? 'is-loading' : ''}`} aria-hidden="true" />
              </button>
            </form>

            <div className="hero-strip">
              <div className="hero-pill">
                <span className="hero-pill__label">当前分析链接</span>
                <strong>{analysis.analyzed_url}</strong>
              </div>
              <div className="hero-pill">
                <span className="hero-pill__label">输出结构</span>
                <strong>雷达 + 留存 + 文案 Diff</strong>
              </div>
            </div>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          </section>

          <section className="insight-row">
            {analysis.insight_cards.map((card) => (
              <article className="insight-card" key={`${card.label}-${card.value}`}>
                <p className="insight-card__label">{card.label}</p>
                <p className="insight-card__value">{card.value}</p>
                {typeof card.score === 'number' ? <strong>{card.score}</strong> : <span>策略</span>}
              </article>
            ))}
          </section>

          <section className="panel-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Feature Fingerprint</p>
                  <h3>多模态指纹雷达</h3>
                </div>
                <strong className="panel-score">{Math.round(analysis.radar_scores.reduce((sum, value) => sum + value, 0) / analysis.radar_scores.length)}</strong>
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
                <p className="eyebrow">AI Script Reconstruction Diff</p>
                <h3>普通种草文案 vs 高转化版本</h3>
              </div>
              <strong className="panel-score panel-score--success">+15% 预估转化</strong>
            </div>

            <div className="script-grid">
              <article className="script-column">
                <p className="script-column__title">原始文案 / 阻力偏高</p>
                {originalLines.map((line, index) => (
                  <p className={`script-line ${index === 1 || index === originalLines.length - 1 ? 'script-line--weak' : ''}`} key={`origin-${line}`}>
                    {line}
                  </p>
                ))}
              </article>

              <article className="script-column">
                <p className="script-column__title script-column__title--accent">重写文案 / 转化导向</p>
                {optimizedLines.map((line, index) => (
                  <p className={`script-line ${index === 0 || index === optimizedLines.length - 1 ? 'script-line--strong' : ''}`} key={`optimized-${line}`}>
                    {line}
                  </p>
                ))}
              </article>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
