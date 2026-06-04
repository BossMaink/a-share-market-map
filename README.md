# A-Share AI Market Map（A股 AI 市场地图）

以散点图形式展示全部 A 股在「AI 相关性 × 区间涨跌幅」二维空间中的分布，支持行业筛选、日期回放、个股检索。

## 一键环境配置

### Windows — 双击即可

```
双击 setup.bat        → 自动安装 Python 依赖 + Node 依赖
双击 update-data.bat  → 拉取最新行情数据
```

### Linux / macOS

```bash
bash setup.sh         # 自动安装 Python 依赖 + Node 依赖
```

### 或手动执行

```bash
python -m venv .venv
source .venv/bin/activate   # Linux / macOS
# 或 .venv\Scripts\activate  # Windows
pip install -r requirements.txt
npm install
```

## 快速部署

`dist/` 目录是纯静态站点，放到任意静态服务器即可：

```bash
npx serve dist
# 或
python -m http.server 8080 -d dist
```

部署后访问 `index.html` 即可看到完整交互界面。

## 本地开发

```bash
npm install
npm run dev       # 启动开发服务器 → http://localhost:5173
npm run build     # 构建生产版本到 dist/
```

## 刷新数据

数据产物是 `public/data/market-data.json` 和 `public/data/market-history.json`。
有两种更新方式：

### 方式一：Python 全量更新（推荐，覆盖约 5500 只股票）

```bash
pip install -r requirements.txt
python scripts/update-a-share-data.py
```

数据来源：AkShare（新浪/同花顺行情和 K 线），无需 API Key。

### 方式二：Node.js 轻量更新（覆盖 50 只种子股票）

```bash
npm run data:update
```

`run-update.mjs` 会先尝试 Python 路径，Python 不可用时自动降级到纯 Node.js 更新器（数据来源：东方财富公共接口，无需 API Key）。

### 定时自动更新

```bash
# crontab 示例：每个交易日 18:00 更新（仅 Python 路径）
0 18 * * 1-5 cd /path/to/project && python scripts/update-a-share-data.py
```

## AI 相关性评分

股票 AI 相关度由三层加权计算：

1. **同花顺概念白名单匹配**（107 个 AI 相关概念，6 个层级，权重 3–20）
2. **文本关键词微调**（行业名+股票名，±15 范围）
3. **协同加分**（算力+芯片、机器人+感知）

最终分数裁剪至 1–99，前端展示时做百分位归一化。

## 项目结构

```
a-share-market-map/
├── src/App.tsx                  # 前端可视化
├── scripts/
│   ├── update-a-share-data.py   # Python 全量数据更新
│   ├── update-a-share-data.mjs  # Node.js 轻量数据更新
│   ├── run-update.mjs           # 更新入口（自动选择 Python/Node）
│   └── a-share-universe.json    # 种子股票池
├── public/data/
│   ├── market-data.json         # 当日快照（AI 分数、回报率、市值）
│   └── market-history.json      # 600 日 K 线（支持日期回放）
├── dist/                        # 构建产物（可独立部署）
└── package.json
```

## 数据源

| 更新器 | 数据源 | 覆盖 |
|---|---|---|
| Python (`update-a-share-data.py`) | AkShare → 新浪/同花顺 | ~5500 只 |
| Node.js (`update-a-share-data.mjs`) | 东方财富公开接口 | ~50 只种子股票 |

所有接口均为公开免费 API，无需认证。
