import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const dataDir = path.join(projectRoot, 'public', 'data')
const snapshotFile = path.join(dataDir, 'market-data.json')
const historyFile = path.join(dataDir, 'market-history.json')
const universeFile = path.join(__dirname, 'a-share-universe.json')

const HISTORY_WINDOW = 600
const PERIOD_TO_DAYS = {
  '1W': 5,
  '1M': 20,
  '3M': 60,
  '6M': 120,
  '12M': 250,
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function parseTicker(ticker) {
  const [code, exchange] = ticker.split('.')
  if (!code || !exchange) return null
  const market = exchange.toUpperCase() === 'SH' ? '1' : '0'
  return { code, market, secid: `${market}.${code}` }
}

function parseNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function computeAiScore({ industry, name, conceptTags }) {
  const reasons = []
  let score = 18

  // -------------------------------------------------------------------
  // Phase 1 – structured concept matching (same whitelist as Python/TS)
  // -------------------------------------------------------------------
  const AI_CONCEPT_WEIGHTS = {
    // T0: 强AI核心 (18–20)
    '人工智能': 20, 'AIGC概念': 18, 'DeepSeek概念': 18, '中国AI 50': 20,
    '多模态AI': 17, '智谱AI': 17, 'ChatGPT概念': 16, 'AI应用': 16,
    'AI智能体': 16, 'AI语料': 15,
    // T1: 算力基础设施 (14–16)
    '数据中心(AIDC)': 16, '东数西算(算力)': 15, '算力租赁': 15,
    '共封装光学(CPO)': 14, '液冷服务器': 13, '铜缆高速连接': 12,
    '云计算': 12, '国资云': 11,
    // T2: 芯片与半导体 (11–14)
    '芯片概念': 14, '存储芯片': 13, '英伟达概念': 13, '华为昇腾': 14,
    '华为海思概念股': 12, '第三代半导体': 12, '国家大基金持股': 11,
    '先进封装': 11, '光刻机': 11, '中芯国际概念': 10,
    'MCU芯片': 10, '汽车芯片': 10, 'PCB概念': 10, '光刻胶': 10,
    // T3: AI硬件与机器人 (8–14)
    '人形机器人': 14, '机器人概念': 12, '机器视觉': 10,
    'AI眼镜': 12, 'AI PC': 11, 'AI手机': 11, '传感器': 8,
    '智能穿戴': 8, '减速器': 7, '智能音箱': 6, '工业母机': 7,
    // T4: 软件与数据 (8–13)
    '华为盘古': 13, 'MLOps概念': 11, '数据要素': 11, '数据安全': 10,
    '信创': 10, '数字经济': 10, '华为鲲鹏': 10, '国产操作系统': 9,
    '鸿蒙概念': 9, '网络安全': 9, '数据确权': 9, '华为欧拉': 8,
    '数字孪生': 8, '时空大数据': 8, 'ERP概念': 7, '云办公': 6, '数字水印': 6,
    // T5: AI应用场景 (5–12)
    'AI视频': 12, '量子科技': 10, '脑机接口': 9, '无人驾驶': 9,
    '语音技术': 8, '智能座舱': 8, '虚拟数字人': 8, '车联网(车路协同)': 7,
    '人脸识别': 7, '元宇宙': 7, '虚拟现实': 7, 'MR(混合现实)': 7,
    '空间计算': 7, '工业互联网': 7, '军工信息化': 7, '智能医疗': 6,
    '低空经济': 6, '新型工业化': 6, '星闪概念': 6, '毫米波雷达': 6,
    '卫星导航': 6, '6G概念': 6, '商业航天': 5, '飞行汽车(eVTOL)': 5,
    '智慧城市': 5, '智能家居': 5, '智能物流': 5, '智能电网': 5,
    '智慧政务': 5, '安防': 5, '5G': 5,
    // T6: 泛科技周边 (3–5)
    '物联网': 5, 'F5G概念': 5, '光纤概念': 5, '消费电子概念': 4,
    '汽车电子': 4, 'WiFi 6': 4, 'MicroLED概念': 4, '数字货币': 4,
    '区块链': 4, 'Web3.0': 4, 'NFT概念': 3, 'MiniLED': 3,
    'OLED': 3, '柔性屏(折叠屏)': 3, '无线耳机': 3, '电子纸': 3,
  }

  function conceptTier(w) {
    if (w >= 18) return 0
    if (w >= 14) return 1
    if (w >= 11) return 2
    if (w >= 8) return 3
    if (w >= 7) return 4
    if (w >= 5) return 5
    return 6
  }

  const TIER_MAX = { 0: 42, 1: 30, 2: 28, 3: 24, 4: 24, 5: 22, 6: 12 }

  const conceptParts = (conceptTags || '').replace(/｜/g, '|').split('|').map((s) => s.trim()).filter(Boolean)
  const matchedConcepts = []
  for (const part of conceptParts) {
    const w = AI_CONCEPT_WEIGHTS[part]
    if (w !== undefined) {
      matchedConcepts.push({ name: part, weight: w, tier: conceptTier(w) })
    }
  }

  if (matchedConcepts.length > 0) {
    const tierTotals = {}
    for (const mc of matchedConcepts) {
      const cap = TIER_MAX[mc.tier] ?? 20
      const current = tierTotals[mc.tier] ?? 0
      const effective = current < cap ? Math.min(mc.weight, cap - current) : 0
      if (effective > 0) {
        tierTotals[mc.tier] = (tierTotals[mc.tier] ?? 0) + effective
        score += effective
        reasons.push(`概念·${mc.name} +${effective.toFixed(1)}`)
      }
    }
    const conceptTotal = Object.values(tierTotals).reduce((a, b) => a + b, 0)
    reasons.unshift(`概念匹配 ${matchedConcepts.length}个 累计+${conceptTotal.toFixed(1)}`)
  } else {
    reasons.unshift('概念匹配 无AI概念命中 +0.0')
  }

  // -------------------------------------------------------------------
  // Phase 2 – text keyword fine-tuning (reduced weights)
  // -------------------------------------------------------------------
  const text = `${industry || ''} ${name || ''}`.toLowerCase()

  const textPositives = [
    ['人工智能', 3], ['大模型', 3], ['算力', 3], ['芯片', 3],
    ['半导体', 3], ['gpu', 3], ['机器人', 2], ['机器视觉', 2],
    ['算法', 2], ['机器学习', 2], ['ai', 2], ['aigc', 2],
    ['数据中心', 2], ['云计算', 2], ['自动驾驶', 2], ['边缘计算', 2],
    ['光模块', 2], ['cpo', 2], ['智能制造', 1.5], ['信息化', 1],
  ]

  const textNegatives = [
    ['房地产', 10], ['地产', 8], ['银行', 8], ['保险', 8],
    ['煤炭', 8], ['石油', 7], ['燃气', 7], ['养殖', 7],
    ['白酒', 7], ['农业', 6], ['食品', 4], ['电力', 4],
    ['公用事业', 5], ['钢铁', 4],
  ]

  let textBonus = 0
  const textHits = []

  for (const [keyword, weight] of textPositives) {
    if (text.includes(keyword)) {
      textBonus += weight
      textHits.push(`${keyword}+${weight.toFixed(1)}`)
    }
  }
  for (const [keyword, weight] of textNegatives) {
    if (text.includes(keyword)) {
      textBonus -= weight
      textHits.push(`${keyword}-${weight.toFixed(1)}`)
    }
  }

  if (textHits.length > 0) {
    score += textBonus
    reasons.push(`关键词微调 ${textHits.slice(0, 6).join(', ')} = ${textBonus > 0 ? '+' : ''}${textBonus.toFixed(1)}`)
  }

  // -------------------------------------------------------------------
  // Phase 3 – synergy bonuses
  // -------------------------------------------------------------------
  const conceptSet = new Set(matchedConcepts.map((mc) => mc.name))
  if (
    (text.includes('算力') || conceptSet.has('数据中心(AIDC)') || conceptSet.has('液冷服务器')) &&
    (text.includes('芯片') || conceptSet.has('芯片概念') || text.includes('半导体'))
  ) {
    score += 4
    reasons.push('协同·算力+芯片 +4.0')
  }

  if (
    (text.includes('机器人') || conceptSet.has('人形机器人') || conceptSet.has('机器人概念')) &&
    (conceptSet.has('机器视觉') || conceptSet.has('传感器') || text.includes('视觉') || text.includes('传感'))
  ) {
    score += 3
    reasons.push('协同·机器人+感知 +3.0')
  }

  // -------------------------------------------------------------------
  // Phase 4 – clamp
  // -------------------------------------------------------------------
  const final = clamp(score, 1, 99)
  if (final !== score) {
    reasons.push(`裁剪 ${score.toFixed(1)} -> ${final.toFixed(1)}`)
  }

  return { score: Number(final.toFixed(1)), reasons }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://quote.eastmoney.com/',
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

async function fetchQuotes(secids) {
  if (secids.length === 0) return new Map()
  const fields = 'f12,f14,f3,f8,f20,f100'
  const api = `http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secids.join(',')}`
  const json = await fetchJson(api)
  const diff = json?.data?.diff ?? []
  const map = new Map()
  for (const item of diff) {
    const code = String(item.f12 ?? '')
    if (!code) continue
    map.set(code, {
      name: String(item.f14 ?? '').trim(),
      weeklyMovePct: parseNumber(item.f3),
      turnoverRate: parseNumber(item.f8),
      marketCap: parseNumber(item.f20),
      industry: String(item.f100 ?? '其他').trim() || '其他',
    })
  }
  return map
}

async function fetchDailyKlines(secid) {
  const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
  const api = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=650&end=20500101&fields2=${fields2}`
  const json = await fetchJson(api)
  const rows = json?.data?.klines ?? []
  return rows
    .map((row) => {
      const cells = String(row).split(',')
      return {
        date: cells[0],
        open: parseNumber(cells[1]),
        close: parseNumber(cells[2]),
        high: parseNumber(cells[3]),
        low: parseNumber(cells[4]),
        amount: parseNumber(cells[5]),
        volume: parseNumber(cells[6]),
      }
    })
    .filter((item) => item.close > 0)
}

function calcReturn(history, days) {
  if (history.length <= days) return null
  const latest = history[history.length - 1].close
  const prev = history[history.length - 1 - days].close
  if (!latest || !prev) return null
  return latest / prev - 1
}

function calcGrowthByCap(marketCap, ret) {
  if (ret == null || !marketCap || !Number.isFinite(marketCap)) return null
  return marketCap * ret
}

async function run() {
  const startedAt = new Date().toISOString()
  console.log(`[data:update] start ${startedAt}`)

  await mkdir(dataDir, { recursive: true })

  const universe = await readJson(universeFile, [])
  const validTickers = universe.filter((ticker) => typeof ticker === 'string' && parseTicker(ticker))
  if (validTickers.length === 0) {
    throw new Error('No tickers found in scripts/a-share-universe.json')
  }

  const existingHistory = await readJson(historyFile, { stocks: [] })
  const oldByTicker = new Map((existingHistory.stocks ?? []).map((item) => [item.ticker, item]))

  const secids = validTickers.map((ticker) => parseTicker(ticker).secid)
  const quoteMap = await fetchQuotes(secids)

  const stocks = []
  for (const ticker of validTickers) {
    const parsed = parseTicker(ticker)
    if (!parsed) continue

    try {
      const klines = await fetchDailyKlines(parsed.secid)
      const history = klines.slice(-HISTORY_WINDOW)
      if (history.length < 260) {
        continue
      }

      const quote = quoteMap.get(parsed.code)
      const old = oldByTicker.get(ticker)
      const industry = quote?.industry || old?.industry || '其他'
      const name = quote?.name || old?.name || ticker
      const marketCap = quote?.marketCap || parseNumber(old?.marketCap)
      const oneWeekRet = calcReturn(history, PERIOD_TO_DAYS['1W'])
      const weeklyMovePct = quote?.weeklyMovePct ?? (oneWeekRet != null ? oneWeekRet * 100 : 0)

      const returns = {
        '1W': calcReturn(history, PERIOD_TO_DAYS['1W']),
        '1M': calcReturn(history, PERIOD_TO_DAYS['1M']),
        '3M': calcReturn(history, PERIOD_TO_DAYS['3M']),
        '6M': calcReturn(history, PERIOD_TO_DAYS['6M']),
        '12M': calcReturn(history, PERIOD_TO_DAYS['12M']),
      }

      const growth = {
        '1W': calcGrowthByCap(marketCap, returns['1W']),
        '1M': calcGrowthByCap(marketCap, returns['1M']),
        '3M': calcGrowthByCap(marketCap, returns['3M']),
        '6M': calcGrowthByCap(marketCap, returns['6M']),
        '12M': calcGrowthByCap(marketCap, returns['12M']),
      }

      const conceptTags = old?.conceptTags || ''
      const aiResult = computeAiScore({ industry, name, conceptTags })

      stocks.push({
        id: ticker,
        ticker,
        name,
        industry,
        aiScore: aiResult.score,
        aiRawScore: aiResult.score,
        aiExplain: aiResult.reasons,
        conceptTags,
        marketCap,
        weeklyMovePct,
        growth,
        returns,
        history,
      })

      await sleep(30)
    } catch (error) {
      console.warn(`[data:update] skip ${ticker}: ${String(error)}`)
    }
  }

  if (stocks.length === 0) {
    const hasSnapshot = !!(await readJson(snapshotFile, null))
    if (hasSnapshot) {
      console.warn('[data:update] no new stock fetched, keep old snapshot')
      return
    }
    throw new Error('Fetch failed and no existing market-data.json available')
  }

  const now = new Date().toISOString().slice(0, 10)
  const snapshot = {
    meta: {
      market: 'A股真实样本池',
      updatedAt: now,
      note: `启动时自动更新，保留最近${HISTORY_WINDOW}个交易日窗口`,
      source: 'Eastmoney 公共行情接口',
      sampleSize: stocks.length,
    },
    stocks: stocks.map((item) => ({
      id: item.id,
      ticker: item.ticker,
      name: item.name,
      industry: item.industry,
      aiScore: Number(item.aiScore.toFixed(2)),
      aiRawScore: Number(item.aiScore.toFixed(2)),
      aiExplain: item.aiExplain || [],
      conceptTags: item.conceptTags || '',
      marketCap: item.marketCap,
      weeklyMovePct: Number(item.weeklyMovePct.toFixed(4)),
      growth: {
        '1W': item.growth['1W'] != null ? Number(item.growth['1W'].toFixed(2)) : null,
        '1M': item.growth['1M'] != null ? Number(item.growth['1M'].toFixed(2)) : null,
        '3M': item.growth['3M'] != null ? Number(item.growth['3M'].toFixed(2)) : null,
        '6M': item.growth['6M'] != null ? Number(item.growth['6M'].toFixed(2)) : null,
        '12M': item.growth['12M'] != null ? Number(item.growth['12M'].toFixed(2)) : null,
      },
      returns: {
        '1W': item.returns['1W'] != null ? Number(item.returns['1W'].toFixed(6)) : null,
        '1M': item.returns['1M'] != null ? Number(item.returns['1M'].toFixed(6)) : null,
        '3M': item.returns['3M'] != null ? Number(item.returns['3M'].toFixed(6)) : null,
        '6M': item.returns['6M'] != null ? Number(item.returns['6M'].toFixed(6)) : null,
        '12M': item.returns['12M'] != null ? Number(item.returns['12M'].toFixed(6)) : null,
      },
    })),
  }

  const historyPayload = {
    meta: {
      market: 'A股真实样本池',
      updatedAt: now,
      window: HISTORY_WINDOW,
      source: 'Eastmoney 公共行情接口',
      sampleSize: stocks.length,
    },
    stocks: stocks.map((item) => ({
      id: item.id,
      ticker: item.ticker,
      name: item.name,
      industry: item.industry,
      marketCap: item.marketCap,
      history: item.history,
    })),
  }

  await writeFile(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await writeFile(historyFile, `${JSON.stringify(historyPayload, null, 2)}\n`, 'utf8')
  console.log(`[data:update] done, stocks=${stocks.length}, historyWindow=${HISTORY_WINDOW}`)
}

run().catch(async (error) => {
  console.warn(`[data:update] failed: ${String(error)}`)
  try {
    const fallback = await readJson(snapshotFile, null)
    if (fallback?.stocks?.length) {
      console.warn('[data:update] use existing snapshot and continue')
      process.exitCode = 0
      return
    }
  } catch {
    // ignore fallback parse failure
  }
  process.exitCode = 0
})
