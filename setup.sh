#!/usr/bin/env bash
set -euo pipefail

echo
echo "============================================"
echo "  A股 AI 市场地图 — 一键环境配置"
echo "============================================"
echo

# Step 1: check Python
echo "[1/4] 检查 Python..."
if ! command -v python3 &>/dev/null; then
    echo "  [错误] 未找到 Python，请先安装 Python 3.10+"
    exit 1
fi
echo "  $(python3 --version) ✓"

# Step 2: create venv
echo
echo "[2/4] 配置虚拟环境..."
if [ -f .venv/bin/python ]; then
    echo "  虚拟环境已存在，跳过创建"
else
    echo "  正在创建 .venv ..."
    python3 -m venv .venv
    echo "  虚拟环境创建完成 ✓"
fi

# Step 3: install Python deps
echo
echo "[3/4] 安装 Python 依赖..."
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt
echo "  Python 依赖安装完成 ✓"

# Step 4: install Node deps
echo
echo "[4/4] 安装 Node.js 依赖..."
if ! command -v node &>/dev/null; then
    echo "  [跳过] 未找到 Node.js，前端开发环境跳过"
    echo "  如需本地开发，请安装 Node.js: https://nodejs.org/"
else
    npm install || echo "  [警告] npm install 失败，可稍后重试"
    echo "  Node.js 依赖安装完成 ✓"
fi

# Done
echo
echo "============================================"
echo "  配置完成！"
echo
echo "  拉取最新数据:"
echo "    .venv/bin/python scripts/update-a-share-data.py"
echo
echo "  启动开发服务器:"
echo "    npx vite"
echo
echo "  构建部署包:"
echo "    npx vite build"
echo "============================================"
echo
