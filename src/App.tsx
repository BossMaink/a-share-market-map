import { useEffect, useMemo, useRef, useState } from 'react'

type Period = '1W' | '1M' | '3M' | '6M' | '12M'
type Metric = 'pct' | 'cny'
type CapFilter = 0 | 1e10 | 5e10 | 1e11 | 5e11
type LegendView = 'grouped' | 'detailed'
type BroadIndustry =
  | '科技'
  | '通信'
  | '可选消费'
  | '必需消费'
  | '医疗健康'
  | '金融'
  | '工业'
  | '能源'
  | '基础材料'
  | '房地产'
  | '公用事业'
  | '其他'

type StockPoint = {
  id: string
  ticker: string
  name: string
  industry: string
  aiScore: number
  aiRawScore?: number
  aiExplain?: string[]
  conceptTags?: string
  marketCap: number
  weeklyMovePct: number
  growth: Record<Period, number | null>
  returns: Record<Period, number | null>
}

type Payload = {
  meta: {
    market: string
    updatedAt: string
    note: string
  }
  stocks: StockPoint[]
}

type HistoryPoint = {
  date: string
  close: number
  amount: number
}

type HistoryStock = {
  id: string
  ticker: string
  name: string
  industry: string
  marketCap: number
  history: HistoryPoint[]
}

type HistoryPayload = {
  meta: {
    market: string
    updatedAt: string
    window: number
  }
  stocks: HistoryStock[]
}

const PERIODS: Period[] = ['1W', '1M', '3M', '6M', '12M']
const PERIOD_TO_DAYS: Record<Period, number> = {
  '1W': 5,
  '1M': 20,
  '3M': 60,
  '6M': 120,
  '12M': 250,
}
const CAP_FILTERS: Array<{ label: string; value: CapFilter }> = [
  { label: '全部市值', value: 0 },
  { label: '100亿以上', value: 1e10 },
  { label: '500亿以上', value: 5e10 },
  { label: '1000亿以上', value: 1e11 },
  { label: '5000亿以上', value: 5e11 },
]
const BROAD_INDUSTRY_ORDER: BroadIndustry[] = ['科技', '通信', '可选消费', '必需消费', '医疗健康', '金融', '工业', '能源', '基础材料', '房地产', '公用事业', '其他']
const THS_INDUSTRY_TO_BROAD: Record<string, BroadIndustry> = {
  安防设备: '工业',
  白酒: '必需消费',
  白色家电: '可选消费',
  办公软件: '科技',
  半导体: '科技',
  包装印刷: '基础材料',
  保险: '金融',
  玻璃玻纤: '基础材料',
  乘用车: '可选消费',
  船舶制造: '工业',
  电池: '能源',
  电力: '公用事业',
  电网设备: '公用事业',
  房地产开发: '房地产',
  风电设备: '能源',
  服装家纺: '可选消费',
  工程建设: '工业',
  工业金属: '基础材料',
  光伏设备: '能源',
  光学光电子: '科技',
  广告营销: '科技',
  轨交设备Ⅱ: '工业',
  贵金属: '基础材料',
  航天航空: '工业',
  航运港口: '工业',
  互联网金融: '金融',
  化学制品: '基础材料',
  化学制药: '医疗健康',
  环保设备: '公用事业',
  计算机设备: '科技',
  家居用品: '可选消费',
  军工电子Ⅱ: '科技',
  美容护理: '可选消费',
  面板: '科技',
  能源金属: '能源',
  其他: '其他',
  汽车零部件: '可选消费',
  汽车整车: '可选消费',
  乳业: '必需消费',
  软件开发: '科技',
  商用车: '可选消费',
  食品加工: '必需消费',
  铁路公路: '工业',
  通信设备: '通信',
  通用设备: '工业',
  文化传媒: '科技',
  消费电子: '科技',
  小金属: '基础材料',
  养殖业: '必需消费',
  医疗服务: '医疗健康',
  医疗器械: '医疗健康',
  银行: '金融',
  影视院线: '科技',
  游戏: '科技',
  元件: '科技',
  造纸: '基础材料',
  造纸印刷: '基础材料',
  证券: '金融',
  '证券Ⅱ': '金融',
  '中药Ⅱ': '医疗健康',
  种植业: '必需消费',
  专用设备: '工业',
  自动化设备: '工业',
}

const MAX_LOOKBACK_DAYS = 600
const PLAYBACK_COVERAGE_TARGETS = [0.99, 0.97, 0.95, 0.9]
const MIN_12M_COVERAGE = 0.5  // trim dates where <50% stocks have enough history for 12M
const BROAD_AI_RELEVANCE: Record<BroadIndustry, number> = {
  科技: 0.96,
  通信: 0.86,
  可选消费: 0.58,
  必需消费: 0.42,
  医疗健康: 0.55,
  金融: 0.3,
  工业: 0.45,
  能源: 0.34,
  基础材料: 0.22,
  房地产: 0.14,
  公用事业: 0.1,
  其他: 0.2,
}

function isBroadIndustryLabel(value: string): value is BroadIndustry {
  return (BROAD_INDUSTRY_ORDER as string[]).includes(value)
}

function industryAiRelevance(industry: string): number {
  const broad = isBroadIndustryLabel(industry) ? industry : resolveBroadIndustry(industry)
  let relevance = BROAD_AI_RELEVANCE[broad]
  const aiHotPattern = /人工智能|算力|大模型|云计算|数据|软件|半导体|芯片|电子|计算机|互联网|通信|光学|元件|IT服务/
  const aiColdPattern = /煤炭|石油|电力|公用|水务|燃气|钢铁|有色|地产|银行|保险|农业|养殖/

  if (aiHotPattern.test(industry)) relevance = Math.min(1, relevance + 0.1)
  if (aiColdPattern.test(industry)) relevance = Math.max(0, relevance - 0.08)
  return relevance
}

function colorForIndustry(industry: string): string {
  const relevance = industryAiRelevance(industry)

  // 0 -> blue(212), 1 -> red(6)
  const hue = 212 - relevance * 206
  const saturation = 74
  const lightness = 60 - relevance * 8
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness.toFixed(1)}%)`
}

function symlog(value: number, constant: number): number {
  return Math.sign(value) * Math.log1p(Math.abs(value) / constant)
}

function inverseSymlog(value: number, constant: number): number {
  return Math.sign(value) * (Math.expm1(Math.abs(value)) * constant)
}

function formatCap(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}万亿`
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`
  return `${sign}${Math.round(abs).toLocaleString('zh-CN')}`
}

function formatPct(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function resolveBroadIndustry(industry: string): BroadIndustry {
  const mapped = THS_INDUSTRY_TO_BROAD[industry]
  if (mapped) return mapped
  return '其他'
}

function formatTechSubgroupLabel(industry: string): string {
  if (/半导体/.test(industry)) return '半导体'
  if (/软件|办公软件/.test(industry)) return '软件'
  if (/计算机设备/.test(industry)) return '计算机'
  if (/通信/.test(industry)) return '通信'
  if (/元件|光学光电子|面板|消费电子|军工电子/.test(industry)) return '电子'
  if (/游戏|文化传媒|影视院线|广告营销/.test(industry)) return '内容'
  return '其他科技'
}

function calcReturn(history: HistoryPoint[], index: number, days: number): number | null {
  if (index < days || index >= history.length) return null
  const latest = history[index]?.close ?? 0
  const prev = history[index - days]?.close ?? 0
  if (!latest || !prev) return null
  return latest / prev - 1
}

function findHistoryIndexByDate(history: HistoryPoint[], date: string): number {
  if (!history.length) return -1
  let lo = 0
  let hi = history.length - 1
  let best = -1

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const midDate = history[mid]?.date ?? ''
    if (midDate <= date) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// AI concept whitelist — mirrors backend AI_CONCEPT_WEIGHTS exactly
// T0: pure AI core  T1: compute infra  T2: chips & silicon
// T3: AI hardware   T4: software & data  T5: application scenarios  T6: broad tech
// ---------------------------------------------------------------------------
const AI_CONCEPT_WEIGHTS: Record<string, number> = {
  // --- T0: 强AI核心 (18–20) ---
  '人工智能': 20.0, 'AIGC概念': 18.0, 'DeepSeek概念': 18.0, '中国AI 50': 20.0,
  '多模态AI': 17.0, '智谱AI': 17.0, 'ChatGPT概念': 16.0, 'AI应用': 16.0,
  'AI智能体': 16.0, 'AI语料': 15.0,
  // --- T1: 算力基础设施 (14–16) ---
  '数据中心(AIDC)': 16.0, '东数西算(算力)': 15.0, '算力租赁': 15.0,
  '共封装光学(CPO)': 14.0, '液冷服务器': 13.0, '铜缆高速连接': 12.0,
  '云计算': 12.0, '国资云': 11.0,
  // --- T2: 芯片与半导体 (11–14) ---
  '芯片概念': 14.0, '存储芯片': 13.0, '英伟达概念': 13.0, '华为昇腾': 14.0,
  '华为海思概念股': 12.0, '第三代半导体': 12.0, '国家大基金持股': 11.0,
  '先进封装': 11.0, '光刻机': 11.0, '中芯国际概念': 10.0,
  'MCU芯片': 10.0, '汽车芯片': 10.0, 'PCB概念': 10.0, '光刻胶': 10.0,
  // --- T3: AI硬件与机器人 (8–14) ---
  '人形机器人': 14.0, '机器人概念': 12.0, '机器视觉': 10.0,
  'AI眼镜': 12.0, 'AI PC': 11.0, 'AI手机': 11.0, '传感器': 8.0,
  '智能穿戴': 8.0, '减速器': 7.0, '智能音箱': 6.0, '工业母机': 7.0,
  // --- T4: 软件与数据 (8–13) ---
  '华为盘古': 13.0, 'MLOps概念': 11.0, '数据要素': 11.0, '数据安全': 10.0,
  '信创': 10.0, '数字经济': 10.0, '华为鲲鹏': 10.0, '国产操作系统': 9.0,
  '鸿蒙概念': 9.0, '网络安全': 9.0, '数据确权': 9.0, '华为欧拉': 8.0,
  '数字孪生': 8.0, '时空大数据': 8.0, 'ERP概念': 7.0, '云办公': 6.0,
  '数字水印': 6.0,
  // --- T5: AI应用场景 (5–12) ---
  'AI视频': 12.0, '量子科技': 10.0, '脑机接口': 9.0, '无人驾驶': 9.0,
  '语音技术': 8.0, '智能座舱': 8.0, '虚拟数字人': 8.0, '车联网(车路协同)': 7.0,
  '人脸识别': 7.0, '元宇宙': 7.0, '虚拟现实': 7.0, 'MR(混合现实)': 7.0,
  '空间计算': 7.0, '工业互联网': 7.0, '军工信息化': 7.0, '智能医疗': 6.0,
  '低空经济': 6.0, '新型工业化': 6.0, '星闪概念': 6.0, '毫米波雷达': 6.0,
  '卫星导航': 6.0, '6G概念': 6.0, '商业航天': 5.0, '飞行汽车(eVTOL)': 5.0,
  '智慧城市': 5.0, '智能家居': 5.0, '智能物流': 5.0, '智能电网': 5.0,
  '智慧政务': 5.0, '安防': 5.0, '5G': 5.0,
  // --- T6: 泛科技周边 (3–5) ---
  '物联网': 5.0, 'F5G概念': 5.0, '光纤概念': 5.0, '消费电子概念': 4.0,
  '汽车电子': 4.0, 'WiFi 6': 4.0, 'MicroLED概念': 4.0, '数字货币': 4.0,
  '区块链': 4.0, 'Web3.0': 4.0, 'NFT概念': 3.0, 'MiniLED': 3.0,
  'OLED': 3.0, '柔性屏(折叠屏)': 3.0, '无线耳机': 3.0, '电子纸': 3.0,
}

function _conceptTier(weight: number): number {
  if (weight >= 18) return 0
  if (weight >= 14) return 1
  if (weight >= 11) return 2
  if (weight >= 8) return 3
  if (weight >= 7) return 4
  if (weight >= 5) return 5
  return 6
}

const AI_CONCEPT_TIER_MAX: Record<number, number> = {
  0: 42, 1: 30, 2: 28, 3: 24, 4: 24, 5: 22, 6: 12,
}

function inferAiScoreBreakdown(industry: string, name: string, conceptTags?: string): { rawScore: number; reasons: string[] } {
  const industryText = (industry || '').trim()
  const nameText = (name || '').trim()
  const reasons: string[] = []
  let score = 18

  // --- Phase 1: structured concept matching ---
  const raw = (conceptTags || '').replace(/｜/g, '|')
  const conceptParts = raw ? raw.split('|').map((s) => s.trim()).filter(Boolean) : []
  const matchedConcepts: Array<{ name: string; weight: number; tier: number }> = []

  for (const part of conceptParts) {
    const weight = AI_CONCEPT_WEIGHTS[part]
    if (weight !== undefined) {
      matchedConcepts.push({ name: part, weight, tier: _conceptTier(weight) })
    }
  }

  if (matchedConcepts.length > 0) {
    const tierTotals: Record<number, number> = {}
    for (const mc of matchedConcepts) {
      const cap = AI_CONCEPT_TIER_MAX[mc.tier] ?? 20
      const current = tierTotals[mc.tier] ?? 0
      const effective = current < cap ? Math.min(mc.weight, cap - current) : 0
      if (effective > 0) {
        tierTotals[mc.tier] = (tierTotals[mc.tier] ?? 0) + effective
        score += effective
        reasons.push(`概念·${mc.name} +${effective.toFixed(1)}`)
      }
    }
    const conceptTotal = Object.values(tierTotals).reduce((a, b) => a + b, 0)
    reasons.splice(1, 0, `概念匹配 ${matchedConcepts.length}个 累计+${conceptTotal.toFixed(1)}`)
  } else {
    reasons.splice(1, 0, '概念匹配 无AI概念命中 +0.0')
  }

  // --- Phase 2: text keyword fine-tuning (reduced weights) ---
  const fullText = `${industryText} ${nameText}`.toLowerCase()

  const textPositives: Array<{ pattern: RegExp; weight: number }> = [
    { pattern: /人工智能/, weight: 3 }, { pattern: /大模型/, weight: 3 },
    { pattern: /算力/, weight: 3 }, { pattern: /芯片/, weight: 3 },
    { pattern: /半导体/, weight: 3 }, { pattern: /gpu/i, weight: 3 },
    { pattern: /机器人/, weight: 2 }, { pattern: /机器视觉/, weight: 2 },
    { pattern: /算法/, weight: 2 }, { pattern: /机器学习/, weight: 2 },
    { pattern: /ai/i, weight: 2 }, { pattern: /aigc/i, weight: 2 },
    { pattern: /数据中心/, weight: 2 }, { pattern: /云计算/, weight: 2 },
    { pattern: /自动驾驶/, weight: 2 }, { pattern: /边缘计算/, weight: 2 },
    { pattern: /光模块/, weight: 2 }, { pattern: /cpo/i, weight: 2 },
    { pattern: /智能制造/, weight: 1.5 }, { pattern: /信息化/, weight: 1 },
  ]

  const textNegatives: Array<{ pattern: RegExp; weight: number }> = [
    { pattern: /房地产/, weight: 10 }, { pattern: /地产/, weight: 8 },
    { pattern: /银行/, weight: 8 }, { pattern: /保险/, weight: 8 },
    { pattern: /煤炭/, weight: 8 }, { pattern: /石油/, weight: 7 },
    { pattern: /燃气/, weight: 7 }, { pattern: /养殖/, weight: 7 },
    { pattern: /白酒/, weight: 7 }, { pattern: /农业/, weight: 6 },
    { pattern: /食品/, weight: 4 }, { pattern: /电力/, weight: 4 },
    { pattern: /公用事业/, weight: 5 }, { pattern: /钢铁/, weight: 4 },
  ]

  let textBonus = 0
  const textHits: string[] = []

  for (const { pattern, weight } of textPositives) {
    if (pattern.test(fullText)) {
      textBonus += weight
      textHits.push(`${pattern.source}+${weight.toFixed(1)}`)
    }
  }
  for (const { pattern, weight } of textNegatives) {
    if (pattern.test(fullText)) {
      textBonus -= weight
      textHits.push(`${pattern.source}-${weight.toFixed(1)}`)
    }
  }

  if (textHits.length > 0) {
    score += textBonus
    reasons.push(`关键词微调 ${textHits.slice(0, 6).join(', ')} = ${textBonus > 0 ? '+' : ''}${textBonus.toFixed(1)}`)
  }

  // --- Phase 3: synergy bonuses ---
  const conceptSet = new Set(matchedConcepts.map((mc) => mc.name))
  if (
    (/算力/.test(fullText) || conceptSet.has('数据中心(AIDC)') || conceptSet.has('液冷服务器')) &&
    (/芯片/.test(fullText) || conceptSet.has('芯片概念') || /半导体/.test(fullText))
  ) {
    score += 4
    reasons.push('协同·算力+芯片 +4.0')
  }

  if (
    (/机器人/.test(fullText) || conceptSet.has('人形机器人') || conceptSet.has('机器人概念')) &&
    (conceptSet.has('机器视觉') || conceptSet.has('传感器') || /视觉/.test(fullText) || /传感/.test(fullText))
  ) {
    score += 3
    reasons.push('协同·机器人+感知 +3.0')
  }

  // --- Phase 4: clamp ---
  const final = Math.max(1, Math.min(99, score))
  if (final !== score) {
    reasons.push(`裁剪 ${score.toFixed(1)} -> ${final.toFixed(1)}`)
  }

  return { rawScore: Number(final.toFixed(1)), reasons }
}

function stableUnitSeed(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function normalizeAiScoreByRank(stocks: StockPoint[]): StockPoint[] {
  if (stocks.length === 0) return stocks
  if (stocks.length === 1) {
    return stocks.map((stock) => ({
      ...stock,
      aiScore: 50,
      aiExplain: [...(stock.aiExplain ?? []), '全市场分位映射 P50.0 -> 50.0'],
    }))
  }

  const ranked = [...stocks].sort((a, b) => {
    const rawDelta = (a.aiRawScore ?? a.aiScore) - (b.aiRawScore ?? b.aiScore)
    if (Math.abs(rawDelta) > 1e-9) return rawDelta

    const jitterA = stableUnitSeed(`${a.ticker}|${a.name}|${a.industry}`)
    const jitterB = stableUnitSeed(`${b.ticker}|${b.name}|${b.industry}`)
    return jitterA - jitterB
  })

  const mapped = new Map<string, number>()
  ranked.forEach((stock, index) => {
    const p = index / (ranked.length - 1)
    const stretched = Math.pow(p, 0.78)
    mapped.set(stock.id, stretched * 100)
  })

  return stocks.map((stock) => {
    const score = mapped.get(stock.id) ?? 50
    const percentile = score
    return {
      ...stock,
      aiScore: Number(score.toFixed(1)),
      aiExplain: [...(stock.aiExplain ?? []), `全市场分位映射 P${percentile.toFixed(1)} -> ${score.toFixed(1)}`],
    }
  })
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, left: number, right: number): void {
  ctx.save()
  ctx.font = '12px Segoe UI, sans-serif'
  const width = ctx.measureText(text).width + 14
  const boxX = Math.max(left + 4, Math.min(right - width - 4, x + 10))
  const boxY = Math.max(8, y - 32)
  ctx.fillStyle = 'rgba(8,12,16,0.9)'
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.lineWidth = 1
  ctx.fillRect(boxX, boxY, width, 22)
  ctx.strokeRect(boxX, boxY, width, 22)
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fillText(text, boxX + 7, boxY + 15)
  ctx.restore()
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [historyPayload, setHistoryPayload] = useState<HistoryPayload | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [period, setPeriod] = useState<Period>('12M')
  const [metric, setMetric] = useState<Metric>('pct')
  const [legendView, setLegendView] = useState<LegendView>('grouped')
  const [query, setQuery] = useState('')
  const [industryFilter, setIndustryFilter] = useState('全部行业')
  const [capFilter, setCapFilter] = useState<CapFilter>(0)
  const [minAiScore, setMinAiScore] = useState(0)
  const [hovered, setHovered] = useState<StockPoint | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeDateIndex, setActiveDateIndex] = useState<number | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/data/market-data.json', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/data/market-history.json', { cache: 'no-store' }).then((response) => response.json()),
    ])
      .then(([snapshot, history]: [Payload, HistoryPayload]) => {
        setPayload(snapshot)
        setHistoryPayload(history)
      })
      .catch(() => {
        setPayload(null)
        setHistoryPayload(null)
      })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect()
      setCanvasSize((current) => {
        if (current.width === rect.width && current.height === rect.height) return current
        return { width: rect.width, height: rect.height }
      })
    }

    syncSize()

    const resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(canvas)
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement)
    }
    window.addEventListener('resize', syncSize)

    return () => {
      window.removeEventListener('resize', syncSize)
      resizeObserver.disconnect()
    }
  }, [])

  const trimmedHistoryByTicker = useMemo(() => {
    const map = new Map<string, HistoryPoint[]>()
    historyPayload?.stocks.forEach((item) => {
      map.set(item.ticker, item.history.slice(-MAX_LOOKBACK_DAYS))
    })
    return map
  }, [historyPayload])

  const dateList = useMemo(() => {
    if (!historyPayload || historyPayload.stocks.length === 0) return []

    const histories = historyPayload.stocks
      .map((item) => item.history.slice(-MAX_LOOKBACK_DAYS))
      .filter((history) => history.length > 0)
    if (!histories.length) return []

    const counter = new Map<string, number>()
    // Per-date 12M coverage: how many stocks have ≥250 days history before this date
    const coverage12M = new Map<string, number>()
    histories.forEach((history) => {
      history.forEach((item) => {
        counter.set(item.date, (counter.get(item.date) ?? 0) + 1)
      })
      // For 12M coverage: find the earliest index where 250+ days are available
      if (history.length >= 250) {
        const startIdx = 250  // need 250 days before to compute 12M
        for (let i = startIdx; i < history.length; i++) {
          const date = history[i].date
          coverage12M.set(date, (coverage12M.get(date) ?? 0) + 1)
        }
      }
    })

    const total = histories.length

    // Helper: trim dates with insufficient 12M coverage
    const trim12M = (dates: string[]): string[] => {
      const minCount = Math.ceil(total * MIN_12M_COVERAGE)
      return dates.filter((date) => (coverage12M.get(date) ?? 0) >= minCount)
    }

    for (const ratio of PLAYBACK_COVERAGE_TARGETS) {
      const threshold = Math.ceil(total * ratio)
      let dates = [...counter.entries()]
        .filter(([, count]) => count >= threshold)
        .map(([date]) => date)
        .sort((a, b) => a.localeCompare(b))

      dates = trim12M(dates)
      if (dates.length >= 200) return dates
    }

    let dates = [...counter.keys()].sort((a, b) => a.localeCompare(b))
    return trim12M(dates)
  }, [historyPayload])

  useEffect(() => {
    if (!dateList.length) return
    setActiveDateIndex((prev) => {
      if (prev !== null && prev < dateList.length) return prev
      return dateList.length - 1
    })
  }, [dateList])

  const activeDate = activeDateIndex !== null && dateList[activeDateIndex] ? dateList[activeDateIndex] : null

  const historyByTicker = useMemo(() => {
    const map = new Map<string, HistoryStock>()
    historyPayload?.stocks.forEach((item) => {
      map.set(item.ticker, item)
    })
    return map
  }, [historyPayload])

  const effectiveStocks = useMemo(() => {
    if (!payload) return []

    const scored = payload.stocks.map((stock) => {
      // AI score is date-independent — prefer backend pre-computed values.
      const hasBackendAi = stock.aiRawScore !== undefined && stock.aiExplain && stock.aiExplain.length > 0
      const aiRawScore = hasBackendAi ? stock.aiRawScore! : inferAiScoreBreakdown(stock.industry, stock.name, stock.conceptTags).rawScore
      const aiExplain = hasBackendAi ? stock.aiExplain! : inferAiScoreBreakdown(stock.industry, stock.name, stock.conceptTags).reasons

      if (!activeDate) {
        return {
          ...stock,
          aiRawScore,
          aiScore: aiRawScore,
          aiExplain,
        }
      }

      const hs = historyByTicker.get(stock.ticker)
      const trimmedHistory = trimmedHistoryByTicker.get(stock.ticker) ?? hs?.history ?? []
      if (trimmedHistory.length === 0) {
        return {
          ...stock,
          aiRawScore,
          aiScore: aiRawScore,
          aiExplain,
        }
      }

      const idx = activeDate ? findHistoryIndexByDate(trimmedHistory, activeDate) : trimmedHistory.length - 1
      if (idx < 0) {
        return {
          ...stock,
          aiRawScore,
          aiScore: aiRawScore,
          aiExplain,
        }
      }
      const at = trimmedHistory[idx]
      const latest = trimmedHistory[trimmedHistory.length - 1]
      if (!at || !latest || latest.close <= 0) {
        return {
          ...stock,
          aiRawScore,
          aiScore: aiRawScore,
          aiExplain,
        }
      }

      const marketCap = stock.marketCap * (at.close / latest.close)
      const returns: Record<Period, number | null> = {
        '1W': calcReturn(trimmedHistory, idx, PERIOD_TO_DAYS['1W']),
        '1M': calcReturn(trimmedHistory, idx, PERIOD_TO_DAYS['1M']),
        '3M': calcReturn(trimmedHistory, idx, PERIOD_TO_DAYS['3M']),
        '6M': calcReturn(trimmedHistory, idx, PERIOD_TO_DAYS['6M']),
        '12M': calcReturn(trimmedHistory, idx, PERIOD_TO_DAYS['12M']),
      }
      const weeklyMovePct = returns['1W'] != null ? returns['1W'] * 100 : 0
      const growth: Record<Period, number | null> = {
        '1W': returns['1W'] != null ? marketCap * returns['1W'] : null,
        '1M': returns['1M'] != null ? marketCap * returns['1M'] : null,
        '3M': returns['3M'] != null ? marketCap * returns['3M'] : null,
        '6M': returns['6M'] != null ? marketCap * returns['6M'] : null,
        '12M': returns['12M'] != null ? marketCap * returns['12M'] : null,
      }

      return {
        ...stock,
        marketCap,
        weeklyMovePct,
        growth,
        returns,
        aiRawScore,
        aiScore: aiRawScore,
        aiExplain,
      }
    })

    return normalizeAiScoreByRank(scored)
  }, [activeDate, activeDateIndex, historyByTicker, payload, trimmedHistoryByTicker])

  const tradableStocks = useMemo(() => effectiveStocks, [effectiveStocks])

  const filteredStocks = useMemo(() => {
    return tradableStocks.filter((stock) => {
      if (industryFilter !== '全部行业' && stock.industry !== industryFilter && resolveBroadIndustry(stock.industry) !== industryFilter) return false
      if (stock.marketCap < capFilter) return false
      if (stock.aiScore < minAiScore) return false
      return true
    })
  }, [capFilter, industryFilter, minAiScore, tradableStocks])

  const industryOptions = useMemo(() => {
    if (!tradableStocks.length) return ['全部行业']

    if (legendView === 'grouped') {
      const groups = [...new Set(tradableStocks.map((stock) => resolveBroadIndustry(stock.industry)))] as BroadIndustry[]
      const orderedGroups = [...groups].sort((a, b) => industryAiRelevance(b) - industryAiRelevance(a))
      return ['全部行业', ...orderedGroups]
    }

    const items = [...new Set(tradableStocks.map((stock) => stock.industry))]
      .sort((a, b) => {
        const scoreDelta = industryAiRelevance(b) - industryAiRelevance(a)
        if (Math.abs(scoreDelta) > 1e-6) return scoreDelta
        return a.localeCompare(b, 'zh-CN')
      })
    return ['全部行业', ...items]
  }, [legendView, tradableStocks])

    useEffect(() => {
      if (industryFilter === '全部行业') return
      const allowed = new Set(industryOptions)
      if (!allowed.has(industryFilter as BroadIndustry) && !allowed.has(industryFilter)) {
        setIndustryFilter('全部行业')
      }
    }, [industryFilter, industryOptions])

  const queryMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return filteredStocks.filter((stock) => {
      const bag = `${stock.ticker} ${stock.name} ${stock.industry}`.toLowerCase()
      return bag.includes(q)
    })
  }, [filteredStocks, query])

  const suggestions = useMemo(() => queryMatches.slice(0, 10), [queryMatches])

  const topMarketCapIds = useMemo(() => {
    return [...tradableStocks]
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 10)
      .map((stock) => stock.id)
  }, [tradableStocks])

  const spotlightIds = useMemo(() => {
    if (selectedId) return new Set([selectedId])
    if (queryMatches.length > 0) return new Set(queryMatches.map((stock) => stock.id))
    return new Set<string>()
  }, [queryMatches, selectedId])

  const selectedStock = useMemo(() => tradableStocks.find((stock) => stock.id === selectedId) ?? null, [selectedId, tradableStocks])
  const detailStock = hovered ?? selectedStock ?? queryMatches[0] ?? null

  useEffect(() => {
    if (selectedId && !tradableStocks.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
    if (hovered && !tradableStocks.some((item) => item.id === hovered.id)) {
      setHovered(null)
    }
  }, [hovered, selectedId, tradableStocks])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || tradableStocks.length === 0 || canvasSize.width <= 0 || canvasSize.height <= 0) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(rect.width * dpr)
    canvas.height = Math.floor(rect.height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const left = 64
    const right = rect.width - 20
    const top = 22
    const bottom = rect.height - 42
    const width = right - left
    const height = bottom - top

    const values = tradableStocks
      .map((stock) => (metric === 'pct' ? stock.returns[period] : stock.growth[period]))
      .filter((v): v is number => v != null)
      .map((v) => (metric === 'pct' ? v * 100 : v))
    const constant = metric === 'pct' ? 2 : 5e8
    const transformed = values.map((value) => symlog(value, constant))
    const min = Math.min(...transformed, -1)
    const max = Math.max(...transformed, 1)
    const bound = Math.max(Math.abs(min), Math.abs(max))

    ctx.fillStyle = '#0f1412'
    ctx.fillRect(0, 0, rect.width, rect.height)

    const horizontalTicks = [-1, -0.5, 0, 0.5, 1]
    const verticalTicks = [0, 20, 40, 60, 80, 100]

    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    horizontalTicks.forEach((tick) => {
      const y = top + ((1 - (tick + 1) / 2) * height)
      ctx.beginPath()
      ctx.moveTo(left, y)
      ctx.lineTo(right, y)
      ctx.stroke()
    })
    verticalTicks.forEach((tick) => {
      const x = left + (tick / 100) * width
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x, bottom)
      ctx.stroke()
    })

    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.beginPath()
    ctx.moveTo(left, top)
    ctx.lineTo(left, bottom)
    ctx.lineTo(right, bottom)
    ctx.stroke()

    if (min < 0 && max > 0) {
      const zeroY = bottom - ((bound + symlog(0, constant)) / (bound * 2)) * height
      ctx.strokeStyle = 'rgba(139,218,151,0.45)'
      ctx.beginPath()
      ctx.moveTo(left, zeroY)
      ctx.lineTo(right, zeroY)
      ctx.stroke()
    }

    ctx.fillStyle = 'rgba(255,255,255,0.66)'
    ctx.font = '12px Segoe UI, sans-serif'
    ctx.fillText('AI相关性得分', left + width / 2 - 30, rect.height - 10)
    verticalTicks.forEach((tick) => {
      const x = left + (tick / 100) * width
      ctx.fillText(String(tick), x - 7, bottom + 18)
    })
    horizontalTicks.forEach((tick) => {
      const y = top + ((1 - (tick + 1) / 2) * height)
      const value = inverseSymlog(tick * bound, constant)
      const label = metric === 'pct' ? `${value.toFixed(1)}%` : formatCap(value)
      ctx.fillText(label, 6, y + 4)
    })
    ctx.save()
    ctx.translate(14, top + height / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(metric === 'pct' ? `${period} 区间涨跌幅(%)` : `${period} 市值变化(元)`, 0, 0)
    ctx.restore()

    const points: Array<{ x: number; y: number; stock: StockPoint; size: number }> = []
    const matchedIds = new Set(filteredStocks.map((stock) => stock.id))
    const ordered = [...tradableStocks].sort((a, b) => {
      const aMatch = matchedIds.has(a.id) ? 1 : 0
      const bMatch = matchedIds.has(b.id) ? 1 : 0
      if (aMatch !== bMatch) return aMatch - bMatch
      const aSpot = spotlightIds.has(a.id) ? 1 : 0
      const bSpot = spotlightIds.has(b.id) ? 1 : 0
      return aSpot - bSpot
    })

    ordered.forEach((stock) => {
      const x = left + (stock.aiScore / 100) * width
      const rawVal = metric === 'pct' ? stock.returns[period] : stock.growth[period]
      if (rawVal == null) return
      const raw = metric === 'pct' ? rawVal * 100 : rawVal
      const y = bottom - ((symlog(raw, constant) + bound) / (bound * 2)) * height
      const size = Math.min(13, Math.max(3, 2 + Math.sqrt(stock.marketCap / 1e9)))
      const angle = Math.PI / 2 - (Math.max(-16, Math.min(16, stock.weeklyMovePct)) / 16) * 1.25

      const triangle = [
        { x: 0, y: -size * 1.15 },
        { x: -size * 0.78, y: size * 0.85 },
        { x: size * 0.78, y: size * 0.85 },
      ].map((point) => {
        const sin = Math.sin(angle)
        const cos = Math.cos(angle)
        return {
          x: x + point.x * cos - point.y * sin,
          y: y + point.x * sin + point.y * cos,
        }
      })

      const inSpotlight = spotlightIds.size === 0 || spotlightIds.has(stock.id)
      const inFiltered = matchedIds.has(stock.id)
      const isHovered = hovered?.id === stock.id
      const isSelected = selectedId === stock.id

      ctx.beginPath()
      ctx.moveTo(triangle[0].x, triangle[0].y)
      ctx.lineTo(triangle[1].x, triangle[1].y)
      ctx.lineTo(triangle[2].x, triangle[2].y)
      ctx.closePath()
      ctx.fillStyle = colorForIndustry(stock.industry)
      if (!inFiltered) {
        ctx.globalAlpha = isHovered ? 0.6 : 0.14
      } else {
        ctx.globalAlpha = isHovered ? 1 : inSpotlight ? 0.92 : 0.18
      }
      ctx.fill()

      if (isSelected || isHovered) {
        ctx.strokeStyle = 'rgba(255,255,255,0.96)'
        ctx.lineWidth = isSelected ? 1.8 : 1.2
        ctx.stroke()
      }

      ctx.globalAlpha = 1
      points.push({ x, y, stock, size })
    })

    const activeStock = hovered ?? selectedStock ?? queryMatches[0] ?? null
    const labelIds = new Set<string>(topMarketCapIds)
    if (activeStock) labelIds.add(activeStock.id)

    const labelPoints = points.filter((item) => labelIds.has(item.stock.id)).sort((a, b) => b.stock.marketCap - a.stock.marketCap)

    labelPoints.forEach((point) => {
      const isActive = activeStock?.id === point.stock.id
      const label = `${point.stock.ticker} ${point.stock.name}`
      ctx.save()
      ctx.globalAlpha = isActive ? 1 : 0.95
      drawLabel(ctx, point.x, point.y, label, left, right)
      ctx.restore()
    })

    if (activeStock) {
      const point = points.find((item) => item.stock.id === activeStock.id)
      if (point) {
        ctx.strokeStyle = 'rgba(255,255,255,0.32)'
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(point.x, top)
        ctx.lineTo(point.x, bottom)
        ctx.moveTo(left, point.y)
        ctx.lineTo(right, point.y)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    const pickStock = (mx: number, my: number) => {
      let best: StockPoint | null = null
      let bestDist = Infinity
      points.forEach((point) => {
        const dx = point.x - mx
        const dy = point.y - my
        const dist = dx * dx + dy * dy
        const maxDist = (point.size + 8) * (point.size + 8)
        if (dist < maxDist && dist < bestDist) {
          bestDist = dist
          best = point.stock
        }
      })
      return best
    }

    const onMove = (event: MouseEvent) => {
      const box = canvas.getBoundingClientRect()
      setHovered(pickStock(event.clientX - box.left, event.clientY - box.top))
    }

    const onClick = (event: MouseEvent) => {
      const box = canvas.getBoundingClientRect()
      const picked = pickStock(event.clientX - box.left, event.clientY - box.top) as unknown
      if (!picked || typeof picked !== 'object' || !('id' in picked) || !('name' in picked)) {
        setSelectedId(null)
      } else {
        const stock = picked as StockPoint
        setSelectedId((current) => (current === stock.id ? null : stock.id))
        setQuery(stock.name)
      }
    }

    const onLeave = () => setHovered(null)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('mouseleave', onLeave)
    return () => {
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mouseleave', onLeave)
    }
  }, [canvasSize.height, canvasSize.width, filteredStocks, hovered, metric, period, queryMatches, selectedId, selectedStock, spotlightIds, tradableStocks])

  const detailedIndustryStats = useMemo(() => {
    const map = new Map<string, { count: number; cap: number }>()
    tradableStocks.forEach((stock) => {
      const prev = map.get(stock.industry) ?? { count: 0, cap: 0 }
      prev.count += 1
      prev.cap += stock.marketCap
      map.set(stock.industry, prev)
    })
    return [...map.entries()].sort((a, b) => {
      const scoreDelta = industryAiRelevance(b[0]) - industryAiRelevance(a[0])
      if (Math.abs(scoreDelta) > 1e-6) return scoreDelta
      return b[1].cap - a[1].cap
    })
  }, [tradableStocks])

  const groupedIndustryStats = useMemo(() => {
    const map = new Map<BroadIndustry, { count: number; cap: number; details: Map<string, { count: number; cap: number }> }>()

    tradableStocks.forEach((stock) => {
      const broad = resolveBroadIndustry(stock.industry)
      const prev = map.get(broad) ?? { count: 0, cap: 0, details: new Map<string, { count: number; cap: number }>() }
      prev.count += 1
      prev.cap += stock.marketCap

      const detail = prev.details.get(stock.industry) ?? { count: 0, cap: 0 }
      detail.count += 1
      detail.cap += stock.marketCap
      prev.details.set(stock.industry, detail)
      map.set(broad, prev)
    })

    return BROAD_INDUSTRY_ORDER.map((label) => {
      const stat = map.get(label)
      if (!stat) return null
      return {
        label,
        count: stat.count,
        cap: stat.cap,
        details: [...stat.details.entries()].sort((a, b) => b[1].cap - a[1].cap),
      }
    })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => industryAiRelevance(b.label) - industryAiRelevance(a.label))
  }, [tradableStocks])

  const techSubgroupStats = useMemo(() => {
    const techGroup = groupedIndustryStats.find((item) => item.label === '科技')
    if (!techGroup) return []

    const merged = new Map<string, { count: number; cap: number }>()
    techGroup.details.forEach(([industry, stat]) => {
      const label = formatTechSubgroupLabel(industry)
      const prev = merged.get(label) ?? { count: 0, cap: 0 }
      prev.count += stat.count
      prev.cap += stat.cap
      merged.set(label, prev)
    })

    return [...merged.entries()].sort((a, b) => b[1].cap - a[1].cap)
  }, [groupedIndustryStats])

  return (
    <main className="layout">
      <header className="topbar">
        <div>
          <h1>A股 AI 市场地图</h1>
          <p>{payload ? `${payload.meta.market} · ${activeDate ?? payload.meta.updatedAt}` : '正在加载数据...'}</p>
        </div>

        <div className="controls">
          <div className="searchBox">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedId(null)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
              placeholder="搜索代码 / 名称 / 行业"
            />
            {showSuggestions && query.trim() && suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => {
                        setQuery(item.name)
                        setSelectedId(item.id)
                        setShowSuggestions(false)
                      }}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.ticker}</span>
                      <small>{item.industry}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <select value={industryFilter} onChange={(event) => setIndustryFilter(event.target.value)}>
            {industryOptions.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </select>

          <select value={String(capFilter)} onChange={(event) => setCapFilter(Number(event.target.value) as CapFilter)}>
            {CAP_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <label className="rangeControl">
            <span>AI相关性下限 {minAiScore}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={minAiScore}
              onChange={(event) => setMinAiScore(Number(event.target.value))}
            />
          </label>

          <button
            className="ghostButton"
            onClick={() => {
              setIndustryFilter('全部行业')
              setCapFilter(0)
              setMinAiScore(0)
              setQuery('')
              setSelectedId(null)
              if (dateList.length > 0) setActiveDateIndex(dateList.length - 1)
            }}
          >
            重置筛选
          </button>

          <div className="switch">
            {PERIODS.map((item) => (
              <button key={item} className={period === item ? 'active' : ''} onClick={() => setPeriod(item)}>
                {item}
              </button>
            ))}
          </div>

          <div className="switch">
            <button className={metric === 'pct' ? 'active' : ''} onClick={() => setMetric('pct')}>%</button>
            <button className={metric === 'cny' ? 'active' : ''} onClick={() => setMetric('cny')}>人民币</button>
          </div>
        </div>

        <div className="summaryBar">
          <span>当前展示 {filteredStocks.length} / {tradableStocks.length} 只</span>
          <span>搜索命中 {query ? queryMatches.length : filteredStocks.length} 只</span>
          <span>行业: {industryFilter}</span>
          <span>市值门槛: {CAP_FILTERS.find((item) => item.value === capFilter)?.label ?? '全部市值'}</span>
          <span>AI相关性下限: {minAiScore}</span>
          <span>观察日期: {activeDate ?? payload?.meta.updatedAt ?? '--'}</span>
          <span>聚焦: {selectedId ? '已选中个股' : query ? '搜索高亮' : '无'}</span>
        </div>
      </header>

      <section className="content">
        <div className="chartWrap">
          <canvas ref={canvasRef} />
          {dateList.length > 0 && activeDateIndex !== null && (
            <div className="dateSliderWrap">
              <div className="dateSliderHead">
                <div>
                  <strong>日期回看</strong>
                  <small>高覆盖区间，起点不是全历史最早日</small>
                </div>
                <span>{activeDate}</span>
              </div>
              <input
                type="range"
                min={0}
                max={dateList.length - 1}
                step={1}
                value={activeDateIndex}
                onChange={(event) => setActiveDateIndex(Number(event.target.value))}
              />
              <div className="dateTicks">
                <span>{dateList[0]}</span>
                <span>{dateList[Math.floor((dateList.length - 1) / 2)]}</span>
                <span>{dateList[dateList.length - 1]}</span>
              </div>
            </div>
          )}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>个股详情</h3>
            {!detailStock && <p>将鼠标移动到三角标记上查看详情，点击可锁定选中。</p>}
            {detailStock && (
              <dl>
                <div><dt>证券代码</dt><dd>{detailStock.ticker}</dd></div>
                <div><dt>证券名称</dt><dd>{detailStock.name}</dd></div>
                <div><dt>所属行业</dt><dd>{detailStock.industry}</dd></div>
                <div><dt>AI相关性分</dt><dd>{detailStock.aiScore.toFixed(1)}</dd></div>
                <div className="aiExplainRow">
                  <dt>相关性依据</dt>
                  <dd>
                    <ul className="aiExplainList">
                      {(detailStock.aiExplain && detailStock.aiExplain.length ? detailStock.aiExplain : ['行业先验']).slice(0, 6).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div><dt>总市值</dt><dd>{formatCap(detailStock.marketCap)}</dd></div>
                <div><dt>近1周涨跌</dt><dd>{formatPct(detailStock.weeklyMovePct)}</dd></div>
                  <div><dt>{period}涨跌幅</dt><dd>{detailStock.returns[period] != null ? formatPct((detailStock.returns[period] as number) * 100) : '--'}</dd></div>
              </dl>
            )}
          </div>

          <div className="panel">
              <div className="legendHeader">
                <div>
                  <h3>行业图例</h3>
                  <p>{legendView === 'grouped' ? '默认显示大类与热门类，科技支持更细拆分' : '完整细分视图'}</p>
                </div>
                <div className="switch legendSwitch">
                  <button className={legendView === 'grouped' ? 'active' : ''} onClick={() => { setLegendView('grouped'); setIndustryFilter('全部行业') }}>大类</button>
                  <button className={legendView === 'detailed' ? 'active' : ''} onClick={() => { setLegendView('detailed'); setIndustryFilter('全部行业') }}>细分</button>
                </div>
              </div>

              <div className="legendScroll">
                {legendView === 'grouped' ? (
                  <ul className="legend groupedLegend">
                    {groupedIndustryStats.map((group) => (
                      <li key={group.label}>
                        <button
                          className={`legendButton ${industryFilter === group.label ? 'active' : ''}`}
                          onClick={() => setIndustryFilter((current) => (current === group.label ? '全部行业' : group.label))}
                        >
                          <span className="dot" style={{ background: colorForIndustry(group.label) }}></span>
                          <span>{group.label}</span>
                          <strong>{group.count} / {formatCap(group.cap)}</strong>
                        </button>

                        {group.details.length > 0 && (
                          <div className="techDetailChips">
                            {(group.label === '科技' ? techSubgroupStats : group.details).slice(0, 6).map((item) => {
                              const label = group.label === '科技' ? (item as [string, { count: number; cap: number }])[0] : (item as [string, { count: number; cap: number }])[0]
                              const stat = group.label === '科技'
                                ? (item as [string, { count: number; cap: number }])[1]
                                : (item as [string, { count: number; cap: number }])[1]
                              return (
                              <span key={label} className="techChip">
                                <span>{label}</span>
                                <small>{stat.count}</small>
                              </span>
                              )
                            })}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="legend">
                    {detailedIndustryStats.map(([industry, stat]) => (
                      <li key={industry}>
                        <button
                          className={`legendButton ${industryFilter === industry ? 'active' : ''}`}
                          onClick={() => setIndustryFilter((current) => (current === industry ? '全部行业' : industry))}
                        >
                          <span className="dot" style={{ background: colorForIndustry(industry) }}></span>
                          <span>{industry}</span>
                          <strong>{stat.count} / {formatCap(stat.cap)}</strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
