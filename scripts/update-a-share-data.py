from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import html
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from time import sleep

import akshare as ak
import requests

HISTORY_WINDOW = 600
DEFAULT_BOOTSTRAP_LIMIT = 120
DEFAULT_FETCH_WORKERS = 8
PERIOD_TO_DAYS = {
    "1W": 5,
    "1M": 20,
    "3M": 60,
    "6M": 120,
    "12M": 250,
}

WORKER_CONTEXT: dict[str, Any] = {}
THS_PROFILE_URL = "https://basic.10jqka.com.cn/{code}/"
THS_COMPANY_URL = "https://basic.10jqka.com.cn/{code}/company.html"
THS_PROFILE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://basic.10jqka.com.cn/",
}
THS_SW_INDUSTRY_PATTERN = re.compile(
    r"所属申万行业：</span>\s*<span[^>]*>([^<]+)</span>",
    re.S,
)
THS_MAIN_BUSINESS_PATTERN = re.compile(
    r"主营业务：</span>\s*<span[^>]*class=\"[^\"]*main-bussiness-text[^\"]*\"[^>]*>\s*(?:<a[^>]*>)?([^<]+)",
    re.S,
)
THS_COMPANY_INTRO_PATTERN = re.compile(
    r"公司简介：</strong>\s*<p[^>]*>(.*?)</p>",
    re.S,
)
THS_CONCEPT_ROW_PATTERN = re.compile(
    r'<td class="gnName"[^>]*>(.*?)</td>.*?<div class="tdContent">(.*?)</div>',
    re.S,
)
ROMAN_SUFFIX_PATTERN = re.compile(r"[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$")


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        return float(value)
    except Exception:
        return fallback


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def calc_return(history: list[dict[str, float | str]], days: int) -> float | None:
    if len(history) <= days:
        return None
    latest = to_float(history[-1]["close"])
    prev = to_float(history[-1 - days]["close"])
    if latest <= 0 or prev <= 0:
        return None
    return latest / prev - 1.0


# ---------------------------------------------------------------------------
# AI concept whitelist — tiered weights for structured THS concept matching
# T0: pure AI core  T1: compute infra  T2: chips & silicon
# T3: AI hardware   T4: software & data  T5: application scenarios  T6: broad tech
# ---------------------------------------------------------------------------
AI_CONCEPT_WEIGHTS: dict[str, float] = {
    # --- T0: 强AI核心 (18–20) ---
    "人工智能": 20.0,
    "AIGC概念": 18.0,
    "DeepSeek概念": 18.0,
    "中国AI 50": 20.0,
    "多模态AI": 17.0,
    "智谱AI": 17.0,
    "ChatGPT概念": 16.0,
    "AI应用": 16.0,
    "AI智能体": 16.0,
    "AI语料": 15.0,
    # --- T1: 算力基础设施 (14–16) ---
    "数据中心(AIDC)": 16.0,
    "东数西算(算力)": 15.0,
    "算力租赁": 15.0,
    "共封装光学(CPO)": 14.0,
    "液冷服务器": 13.0,
    "铜缆高速连接": 12.0,
    "云计算": 12.0,
    "国资云": 11.0,
    # --- T2: 芯片与半导体 (11–14) ---
    "芯片概念": 14.0,
    "存储芯片": 13.0,
    "英伟达概念": 13.0,
    "华为昇腾": 14.0,
    "华为海思概念股": 12.0,
    "第三代半导体": 12.0,
    "国家大基金持股": 11.0,
    "先进封装": 11.0,
    "光刻机": 11.0,
    "中芯国际概念": 10.0,
    "MCU芯片": 10.0,
    "汽车芯片": 10.0,
    "PCB概念": 10.0,
    "光刻胶": 10.0,
    # --- T3: AI硬件与机器人 (8–14) ---
    "人形机器人": 14.0,
    "机器人概念": 12.0,
    "机器视觉": 10.0,
    "AI眼镜": 12.0,
    "AI PC": 11.0,
    "AI手机": 11.0,
    "传感器": 8.0,
    "智能穿戴": 8.0,
    "减速器": 7.0,
    "智能音箱": 6.0,
    "工业母机": 7.0,
    # --- T4: 软件与数据 (8–13) ---
    "华为盘古": 13.0,
    "MLOps概念": 11.0,
    "数据要素": 11.0,
    "数据安全": 10.0,
    "信创": 10.0,
    "数字经济": 10.0,
    "华为鲲鹏": 10.0,
    "国产操作系统": 9.0,
    "鸿蒙概念": 9.0,
    "网络安全": 9.0,
    "数据确权": 9.0,
    "华为欧拉": 8.0,
    "数字孪生": 8.0,
    "时空大数据": 8.0,
    "ERP概念": 7.0,
    "云办公": 6.0,
    "数字水印": 6.0,
    # --- T5: AI应用场景 (5–12) ---
    "AI视频": 12.0,
    "量子科技": 10.0,
    "脑机接口": 9.0,
    "无人驾驶": 9.0,
    "语音技术": 8.0,
    "智能座舱": 8.0,
    "虚拟数字人": 8.0,
    "车联网(车路协同)": 7.0,
    "人脸识别": 7.0,
    "元宇宙": 7.0,
    "虚拟现实": 7.0,
    "MR(混合现实)": 7.0,
    "空间计算": 7.0,
    "工业互联网": 7.0,
    "军工信息化": 7.0,
    "智能医疗": 6.0,
    "低空经济": 6.0,
    "新型工业化": 6.0,
    "星闪概念": 6.0,
    "毫米波雷达": 6.0,
    "卫星导航": 6.0,
    "6G概念": 6.0,
    "商业航天": 5.0,
    "飞行汽车(eVTOL)": 5.0,
    "智慧城市": 5.0,
    "智能家居": 5.0,
    "智能物流": 5.0,
    "智能电网": 5.0,
    "智慧政务": 5.0,
    "安防": 5.0,
    "5G": 5.0,
    # --- T6: 泛科技周边 (3–5) ---
    "物联网": 5.0,
    "F5G概念": 5.0,
    "光纤概念": 5.0,
    "消费电子概念": 4.0,
    "汽车电子": 4.0,
    "WiFi 6": 4.0,
    "MicroLED概念": 4.0,
    "数字货币": 4.0,
    "区块链": 4.0,
    "Web3.0": 4.0,
    "NFT概念": 3.0,
    "MiniLED": 3.0,
    "OLED": 3.0,
    "柔性屏(折叠屏)": 3.0,
    "无线耳机": 3.0,
    "电子纸": 3.0,
}
AI_CONCEPT_TIER_MAX: dict[int, float] = {
    # Cap per tier to prevent stacking many weak concepts > one strong one
    0: 42.0,   # T0: at most ~2 strong + 1 medium hit
    1: 30.0,   # T1
    2: 28.0,   # T2
    3: 24.0,   # T3
    4: 24.0,   # T4
    5: 22.0,   # T5
    6: 12.0,   # T6
}
AI_CONCEPT_TIERS: dict[str, int] = {}
for _concept, _weight in AI_CONCEPT_WEIGHTS.items():
    if _weight >= 18:
        AI_CONCEPT_TIERS[_concept] = 0
    elif _weight >= 14:
        AI_CONCEPT_TIERS[_concept] = 1
    elif _weight >= 11:
        AI_CONCEPT_TIERS[_concept] = 2
    elif _weight >= 8:
        AI_CONCEPT_TIERS[_concept] = 3
    elif _weight >= 7:
        AI_CONCEPT_TIERS[_concept] = 4
    elif _weight >= 5:
        AI_CONCEPT_TIERS[_concept] = 5
    else:
        AI_CONCEPT_TIERS[_concept] = 6

# Reduced keyword weights — concepts do the heavy lifting; keywords fine-tune
_AI_TEXT_POSITIVE: dict[str, float] = {
    "人工智能": 3.0, "大模型": 3.0, "算力": 3.0, "芯片": 3.0,
    "半导体": 3.0, "gpu": 3.0, "机器人": 2.0, "机器视觉": 2.0,
    "算法": 2.0, "机器学习": 2.0, "ai": 2.0, "aigc": 2.0,
    "数据中心": 2.0, "云计算": 2.0, "自动驾驶": 2.0, "边缘计算": 2.0,
    "光模块": 2.0, "cpo": 2.0, "智能制造": 1.5, "信息化": 1.0,
}
_AI_TEXT_NEGATIVE: dict[str, float] = {
    "房地产": 10.0, "地产": 8.0, "银行": 8.0, "保险": 8.0,
    "煤炭": 8.0, "石油": 7.0, "燃气": 7.0, "养殖": 7.0,
    "白酒": 7.0, "农业": 6.0, "食品": 4.0, "电力": 4.0,
    "公用事业": 5.0, "钢铁": 4.0,
}


def infer_ai_relevance_score(industry: str) -> float:
    return infer_ai_relevance_score_with_text(industry, "", None)


def infer_ai_relevance_score_with_text(
    industry: str,
    name: str,
    profile: dict[str, Any] | None,
) -> float:
    score, _reasons = _compute_ai_score(industry, name, profile)
    return score


def _compute_ai_score(
    industry: str,
    name: str,
    profile: dict[str, Any] | None,
) -> tuple[float, list[str]]:
    """Concept-first AI scoring with keyword fine-tuning. Returns (score, reasons)."""
    industry_text = str(industry or "")
    name_text = str(name or "")
    profile = profile or {}
    reasons: list[str] = []
    score = 18.0

    # --- Phase 1: structured concept matching ---
    concept_raw = str(
        profile.get("conceptTags")
        or profile.get("conceptNames")
        or profile.get("conceptSummaries")
        or profile.get("所属概念")
        or ""
    )
    matched_concepts: list[tuple[str, float, int]] = []  # (name, weight, tier)
    if concept_raw:
        for part in concept_raw.replace("｜", "|").split("|"):
            concept_name = part.strip()
            if not concept_name:
                continue
            weight = AI_CONCEPT_WEIGHTS.get(concept_name)
            if weight is not None:
                tier = AI_CONCEPT_TIERS.get(concept_name, 6)
                matched_concepts.append((concept_name, weight, tier))

    if matched_concepts:
        tier_totals: dict[int, float] = {}
        for cname, cweight, ctier in matched_concepts:
            cap = AI_CONCEPT_TIER_MAX.get(ctier, 20.0)
            current = tier_totals.get(ctier, 0.0)
            effective = min(cweight, cap - current) if current < cap else 0.0
            if effective > 0:
                tier_totals[ctier] = current + effective
                score += effective
                reasons.append(f"概念·{cname} +{effective:.1f}")

        concept_total = sum(tier_totals.values())
        reasons.insert(1, f"概念匹配 {len(matched_concepts)}个 累计+{concept_total:.1f}")
    else:
        reasons.insert(1, "概念匹配 无AI概念命中 +0.0")

    # --- Phase 2: text keyword fine-tuning ---
    profile_text_parts: list[str] = []
    for key in [
        "mainBusiness", "business", "description", "intro", "summary",
        "公司简介", "主营业务",
    ]:
        value = profile.get(key)
        if isinstance(value, str) and value.strip():
            profile_text_parts.append(value.strip())

    full_text = " ".join([industry_text, name_text, *profile_text_parts]).lower()

    text_bonus = 0.0
    text_hits: list[str] = []
    for keyword, weight in _AI_TEXT_POSITIVE.items():
        if keyword in full_text:
            text_bonus += weight
            text_hits.append(f"{keyword}+{weight:.1f}")

    for keyword, weight in _AI_TEXT_NEGATIVE.items():
        if keyword in full_text:
            text_bonus -= weight
            text_hits.append(f"{keyword}-{weight:.1f}")

    if text_hits:
        score += text_bonus
        reasons.append(f"关键词微调 {', '.join(text_hits[:6])} = {text_bonus:+.1f}")

    # --- Phase 3: synergy bonuses ---
    concept_names_set = {c[0] for c in matched_concepts}
    if ("算力" in full_text or "数据中心(AIDC)" in concept_names_set or "液冷服务器" in concept_names_set) and \
       ("芯片" in full_text or "芯片概念" in concept_names_set or "半导体" in full_text):
        score += 4.0
        reasons.append("协同·算力+芯片 +4.0")

    if ("机器人" in full_text or "人形机器人" in concept_names_set or "机器人概念" in concept_names_set) and \
       ("机器视觉" in concept_names_set or "传感器" in concept_names_set or "视觉" in full_text or "传感" in full_text):
        score += 3.0
        reasons.append("协同·机器人+感知 +3.0")

    # --- Phase 4: clamp ---
    final = clamp(score, 1.0, 99.0)
    if final != score:
        reasons.append(f"裁剪 {score:.1f} -> {final:.1f}")

    return round(final, 2), reasons


def normalize_spot_columns(df):
    mapping = {c: str(c).replace(" ", "") for c in df.columns}
    return df.rename(columns=mapping)


def pick_first_value(row, keys: list[str]) -> Any:
    for key in keys:
        if key in row and row.get(key) is not None:
            value = row.get(key)
            text = str(value).strip()
            if text:
                return text
    return None


def load_local_snapshot_map(repo_root: Path) -> dict[str, dict[str, Any]]:
    snapshot_dir = repo_root / "data" / "market_snapshot"
    if not snapshot_dir.exists():
        return {}

    files = sorted(snapshot_dir.glob("*.json"))
    if not files:
        return {}

    latest = files[-1]
    raw = load_json(latest, {})
    result: dict[str, dict[str, Any]] = {}
    for code, item in raw.items():
        if not isinstance(item, dict):
            continue
        code_key = str(code)[-6:]
        result[code_key] = {
            "name": str(item.get("name", "")).strip(),
            "latest": to_float(item.get("latestPrice")),
            "week_pct": to_float(item.get("changePct")),
            "turnover": to_float(item.get("turnover")),
        }
    return result


def normalize_code_to_ticker(code_raw: str) -> str | None:
    code = str(code_raw).strip().lower()
    if not code:
        return None

    if code.startswith(("sh", "sz", "bj")) and len(code) >= 8:
        market = code[:2]
        num = code[2:]
        suffix = {"sh": "SH", "sz": "SZ", "bj": "BJ"}[market]
        return f"{num}.{suffix}"

    num = code[-6:]
    if len(num) != 6 or not num.isdigit():
        return None

    if num.startswith(("600", "601", "603", "605", "688", "689", "900")):
        return f"{num}.SH"
    if num.startswith(("000", "001", "002", "003", "200", "300", "301")):
        return f"{num}.SZ"
    if num.startswith(("430", "831", "832", "833", "834", "835", "836", "837", "838", "839", "870", "871", "872", "873", "874", "875", "876", "877", "878", "879", "920")):
        return f"{num}.BJ"
    return None


def build_universe(
    spot_df,
    fallback_spot: dict[str, dict[str, Any]],
    seed_tickers: list[str],
    mapped_tickers: list[str],
) -> list[str]:
    tickers: list[str] = []

    if spot_df is not None and len(spot_df) > 0:
        for raw in spot_df["代码"].tolist():
            ticker = normalize_code_to_ticker(str(raw))
            if ticker:
                tickers.append(ticker)
    else:
        for code in fallback_spot:
            ticker = normalize_code_to_ticker(code)
            if ticker:
                tickers.append(ticker)

    tickers.extend(seed_tickers)
    tickers.extend(mapped_tickers)

    seen: set[str] = set()
    result: list[str] = []
    for ticker in tickers:
        if ticker in seen:
            continue
        seen.add(ticker)
        result.append(ticker)
    return result


def load_official_delisted_tickers() -> set[str]:
    delisted: set[str] = set()

    try:
        sh_df = ak.stock_info_sh_delist()
        if sh_df is not None and len(sh_df) > 0 and "公司代码" in sh_df.columns:
            for value in sh_df["公司代码"].tolist():
                code = str(value).strip()[-6:]
                if len(code) == 6 and code.isdigit():
                    delisted.add(f"{code}.SH")
    except Exception as exc:
        print(f"[data:update] 获取上交所退市名单失败: {exc}")

    try:
        sz_df = ak.stock_info_sz_delist()
        if sz_df is not None and len(sz_df) > 0 and "证券代码" in sz_df.columns:
            for value in sz_df["证券代码"].tolist():
                code = str(value).strip()[-6:]
                if len(code) == 6 and code.isdigit():
                    delisted.add(f"{code}.SZ")
    except Exception as exc:
        print(f"[data:update] 获取深交所退市名单失败: {exc}")

    return delisted


def ticker_to_symbol(ticker: str) -> str:
    code, exchange = ticker.split(".")
    prefix = {"SH": "sh", "SZ": "sz", "BJ": "bj"}.get(exchange.upper(), "sz")
    return prefix + code


def normalize_industry_label(value: str) -> str:
    industry = html.unescape(str(value or "")).replace("&nbsp;", " ").strip()
    industry = industry.replace(" ", "")
    industry = ROMAN_SUFFIX_PATTERN.sub("", industry)
    return industry


def normalize_text(value: str) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\u3000", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ：:；;，,")


def safe_decode_response_text(response: requests.Response, encoding: str = "gbk", max_bytes: int = 2_000_000) -> str:
    """Read response content with a byte cap to avoid large-page decode OOM."""
    try:
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                return ""
            chunks.append(chunk)
        if not chunks:
            return ""
        return b"".join(chunks).decode(encoding, errors="replace")
    except MemoryError:
        return ""
    except Exception:
        return ""


def fetch_ths_sw_industry(code: str, timeout: float) -> str | None:
    url = THS_PROFILE_URL.format(code=code)
    try:
        response = requests.get(url, headers=THS_PROFILE_HEADERS, timeout=timeout, stream=True)
    except Exception:
        return None

    if response.status_code != 200:
        response.close()
        return None

    content = safe_decode_response_text(response, encoding="gbk")
    response.close()
    if len(content) < 1000:
        return None

    match = THS_SW_INDUSTRY_PATTERN.search(content)
    if not match:
        return None

    industry = normalize_industry_label(match.group(1))
    return industry or None


def fetch_ths_profile_text(code: str, timeout: float) -> dict[str, str]:
    result: dict[str, str] = {}

    try:
        response = requests.get(THS_PROFILE_URL.format(code=code), headers=THS_PROFILE_HEADERS, timeout=timeout, stream=True)
    except Exception:
        response = None

    if response is not None and response.status_code == 200:
        content = safe_decode_response_text(response, encoding="gbk")
        response.close()
        business_match = THS_MAIN_BUSINESS_PATTERN.search(content)
        if business_match:
            main_business = normalize_text(business_match.group(1))
            if main_business:
                result["mainBusiness"] = main_business
    elif response is not None:
        response.close()

    try:
        company_response = requests.get(THS_COMPANY_URL.format(code=code), headers=THS_PROFILE_HEADERS, timeout=timeout, stream=True)
    except Exception:
        company_response = None

    if company_response is not None and company_response.status_code == 200:
        company_content = safe_decode_response_text(company_response, encoding="gbk")
        company_response.close()
        intro_match = THS_COMPANY_INTRO_PATTERN.search(company_content)
        if intro_match:
            description = normalize_text(intro_match.group(1))
            if description:
                result["description"] = description
    elif company_response is not None:
        company_response.close()

    try:
        concept_response = requests.get(
            f"https://basic.10jqka.com.cn/{code}/concept.html",
            headers=THS_PROFILE_HEADERS,
            timeout=timeout,
            stream=True,
        )
    except Exception:
        concept_response = None

    if concept_response is not None and concept_response.status_code == 200:
        concept_content = safe_decode_response_text(concept_response, encoding="gbk")
        concept_response.close()
        concept_names: list[str] = []
        concept_summaries: list[str] = []

        for name_html, summary_html in THS_CONCEPT_ROW_PATTERN.findall(concept_content):
            concept_name = normalize_text(name_html)
            concept_summary = normalize_text(summary_html)
            if concept_name:
                concept_names.append(concept_name)
            if concept_summary:
                concept_summaries.append(concept_summary)

        if concept_names:
            result["conceptNames"] = " | ".join(concept_names[:12])
            result["conceptTags"] = result["conceptNames"]
        if concept_summaries:
            result["conceptSummaries"] = " | ".join(concept_summaries[:6])
    elif concept_response is not None:
        concept_response.close()

    return result


def enrich_profile_texts_from_ths(
    selected_tickers: list[str],
    profile_dir: Path,
) -> None:
    profile_dir.mkdir(parents=True, exist_ok=True)

    refresh_existing = os.environ.get("THS_PROFILE_TEXT_REFRESH", "0") == "1"
    max_fetch = int(os.environ.get("THS_PROFILE_TEXT_MAX_FETCH", "600"))
    workers = max(1, int(os.environ.get("THS_PROFILE_TEXT_FETCH_WORKERS", "24")))
    request_timeout = float(os.environ.get("THS_PROFILE_TEXT_REQUEST_TIMEOUT", "2.5"))

    targets: list[tuple[str, Path, dict[str, Any]]] = []
    for ticker in selected_tickers:
        if "." not in ticker:
            continue
        code = ticker.split(".")[0]
        profile_path = profile_dir / f"{code}.json"
        profile = load_json(profile_path, {})
        if not isinstance(profile, dict):
            profile = {}
        has_text = bool(str(profile.get("mainBusiness") or "").strip()) and bool(str(profile.get("description") or "").strip())
        if has_text and not refresh_existing:
            continue
        targets.append((ticker, profile_path, profile))

    if max_fetch > 0:
        targets = targets[:max_fetch]

    if not targets:
        print("[data:update] ths profile text fetch skipped (no targets)")
        return

    print(
        f"[data:update] ths profile text fetch targets={len(targets)} workers={workers} "
        f"refresh_existing={refresh_existing} timeout={request_timeout}s"
    )

    success = 0
    failed = 0
    updated = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(fetch_ths_profile_text, ticker.split(".")[0], request_timeout): (ticker, profile_path, profile)
            for ticker, profile_path, profile in targets
        }
        completed = 0
        for future in as_completed(future_map):
            ticker, profile_path, profile = future_map[future]
            completed += 1

            try:
                text_payload = future.result() or {}
            except Exception:
                text_payload = {}

            if text_payload:
                merged = dict(profile)
                merged.setdefault("code", ticker.split(".")[0])
                if text_payload.get("mainBusiness"):
                    merged["mainBusiness"] = text_payload["mainBusiness"]
                if text_payload.get("description"):
                    merged["description"] = text_payload["description"]
                if text_payload.get("conceptNames"):
                    merged["conceptNames"] = text_payload["conceptNames"]
                if text_payload.get("conceptTags"):
                    merged["conceptTags"] = text_payload["conceptTags"]
                if text_payload.get("conceptSummaries"):
                    merged["conceptSummaries"] = text_payload["conceptSummaries"]
                merged["profileTextFetchedAt"] = datetime.now().isoformat(timespec="seconds")
                profile_path.write_text(
                    json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                success += 1
                updated += 1
            else:
                failed += 1

            if completed % 100 == 0 or completed == len(future_map):
                print(
                    f"[data:update] ths profile text progress {completed}/{len(future_map)} "
                    f"updated={updated} success={success} failed={failed}"
                )

    print(f"[data:update] ths profile text done updated={updated} success={success} failed={failed}")


def enrich_industry_map_from_ths(
    selected_tickers: list[str],
    industry_map: dict[str, str],
    industry_map_path: Path,
) -> dict[str, str]:
    refresh_existing = os.environ.get("THS_REFRESH_EXISTING", "1") == "1"
    max_fetch = int(os.environ.get("THS_INDUSTRY_MAX_FETCH", "0"))
    workers = max(1, int(os.environ.get("THS_INDUSTRY_FETCH_WORKERS", "24")))
    request_timeout = float(os.environ.get("THS_INDUSTRY_REQUEST_TIMEOUT", "2.0"))

    to_fetch: list[str] = []
    for ticker in selected_tickers:
        if "." not in ticker:
            continue
        if not refresh_existing and ticker in industry_map:
            continue
        to_fetch.append(ticker)

    if max_fetch > 0:
        to_fetch = to_fetch[:max_fetch]

    if not to_fetch:
        print("[data:update] ths industry fetch skipped (no targets)")
        return industry_map

    print(
        f"[data:update] ths industry fetch targets={len(to_fetch)} workers={workers} "
        f"refresh_existing={refresh_existing} timeout={request_timeout}s"
    )

    updated_map = dict(industry_map)
    success = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(fetch_ths_sw_industry, ticker.split(".")[0], request_timeout): ticker
            for ticker in to_fetch
        }
        completed = 0
        for future in as_completed(future_map):
            ticker = future_map[future]
            completed += 1
            try:
                industry = future.result()
            except Exception:
                industry = None
            if industry:
                updated_map[ticker] = industry
                success += 1
            else:
                failed += 1

            if completed % 100 == 0 or completed == len(future_map):
                print(f"[data:update] ths industry progress {completed}/{len(future_map)} success={success} failed={failed}")

    if success > 0:
        industry_map_path.write_text(
            json.dumps(updated_map, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"[data:update] ths industry updated {success} entries -> {industry_map_path}")
    else:
        print("[data:update] ths industry no new entries")

    return updated_map


def build_cached_snapshot_item(
    ticker: str,
    industry_map: dict[str, str],
    old: dict[str, Any],
    old_snapshot: dict[str, Any],
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    industry = str(industry_map.get(ticker) or old_snapshot.get("industry") or old.get("industry") or "其他")
    name = str(old_snapshot.get("name") or old.get("name") or ticker)
    profile_data = profile or old_snapshot or {}
    ai_score, ai_explain = _compute_ai_score(industry, name, profile_data)
    concept_tags = str(
        profile_data.get("conceptTags")
        or profile_data.get("conceptNames")
        or old_snapshot.get("conceptTags")
        or old_snapshot.get("conceptNames")
        or ""
    )
    return {
        "id": ticker,
        "ticker": ticker,
        "name": name,
        "industry": industry,
        "aiScore": ai_score,
        "aiRawScore": ai_score,
        "aiExplain": ai_explain,
        "conceptTags": concept_tags,
        "marketCap": round(to_float(old_snapshot.get("marketCap") or old.get("marketCap")), 2),
        "weeklyMovePct": round(to_float(old_snapshot.get("weeklyMovePct")), 4),
        "growth": old_snapshot.get("growth") or {k: None for k in PERIOD_TO_DAYS},
        "returns": old_snapshot.get("returns") or {k: None for k in PERIOD_TO_DAYS},
    }


def init_worker_context(context: dict[str, Any]) -> None:
    global WORKER_CONTEXT
    WORKER_CONTEXT = context


def process_ticker_worker(ticker: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    return process_ticker(
        ticker,
        WORKER_CONTEXT["industry_map"],
        WORKER_CONTEXT["existing_by_ticker"],
        WORKER_CONTEXT["existing_snapshot_by_ticker"],
        WORKER_CONTEXT["existing_history_updated_at"],
        WORKER_CONTEXT["spot_map"],
        WORKER_CONTEXT["profile_map"],
        WORKER_CONTEXT["today"],
    )


def process_ticker(
    ticker: str,
    industry_map: dict[str, str],
    existing_by_ticker: dict[str, dict[str, Any]],
    existing_snapshot_by_ticker: dict[str, dict[str, Any]],
    existing_history_updated_at: str,
    spot_map: dict[str, dict[str, Any]],
    profile_map: dict[str, dict[str, Any]],
    today: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    code = ticker.split(".")[0]
    symbol = ticker_to_symbol(ticker)
    old = existing_by_ticker.get(ticker, {})
    old_snapshot = existing_snapshot_by_ticker.get(ticker, {})

    profile = profile_map.get(code, {})

    if old and existing_history_updated_at == today:
        old_history = old.get("history") or []
        if len(old_history) >= 260:
            return build_cached_snapshot_item(ticker, industry_map, old, old_snapshot, profile), old

    try:
        daily_df = ak.stock_zh_a_daily(symbol=symbol, adjust="qfq")
    except Exception:
        if old:
            return build_cached_snapshot_item(ticker, industry_map, old, old_snapshot, profile), old
        return None, None

    if daily_df is None or len(daily_df) < 260:
        if old:
            return build_cached_snapshot_item(ticker, industry_map, old, old_snapshot, profile), old
        return None, None

    daily_df = daily_df.tail(HISTORY_WINDOW).copy()
    history: list[dict[str, Any]] = []
    for _, row in daily_df.iterrows():
        history.append(
            {
                "date": str(row.get("date"))[:10],
                "close": round(to_float(row.get("close")), 4),
                "amount": round(to_float(row.get("amount")), 2),
            }
        )

    returns: dict[str, float | None] = {
        "1W": calc_return(history, PERIOD_TO_DAYS["1W"]),
        "1M": calc_return(history, PERIOD_TO_DAYS["1M"]),
        "3M": calc_return(history, PERIOD_TO_DAYS["3M"]),
        "6M": calc_return(history, PERIOD_TO_DAYS["6M"]),
        "12M": calc_return(history, PERIOD_TO_DAYS["12M"]),
    }

    spot = spot_map.get(code, {})
    latest_close = to_float(history[-1]["close"])
    prev_close = to_float(history[-2]["close"]) if len(history) > 1 else latest_close
    weekly_move_pct = to_float(spot.get("week_pct"), fallback=((latest_close / prev_close - 1) * 100 if prev_close > 0 else 0.0))

    turnover_amount = to_float(spot.get("turnover"), fallback=to_float(history[-1]["amount"]))
    turnover_yi = turnover_amount / 1e8

    outstanding_share = to_float(daily_df.iloc[-1].get("outstanding_share"))
    market_cap = latest_close * outstanding_share if outstanding_share > 0 else to_float(profile.get("marketCap"))

    industry = str(
        spot.get("industry")
        or industry_map.get(ticker)
        or profile.get("industry")
        or old.get("industry")
        or "其他"
    )
    name = str(spot.get("name") or profile.get("name") or old.get("name") or ticker)
    ai_score, ai_explain = _compute_ai_score(industry, name, profile)
    growth: dict[str, float | None] = {k: (market_cap * v if v is not None else None) for k, v in returns.items()}

    concept_tags = str(
        profile.get("conceptTags")
        or profile.get("conceptNames")
        or old_snapshot.get("conceptTags")
        or old_snapshot.get("conceptNames")
        or ""
    )

    snapshot_item = {
        "id": ticker,
        "ticker": ticker,
        "name": name,
        "industry": industry,
        "aiScore": ai_score,
        "aiRawScore": ai_score,
        "aiExplain": ai_explain,
        "conceptTags": concept_tags,
        "marketCap": round(market_cap, 2),
        "weeklyMovePct": round(weekly_move_pct, 4),
        "growth": {k: (round(v, 2) if v is not None else None) for k, v in growth.items()},
        "returns": {k: (round(v, 6) if v is not None else None) for k, v in returns.items()},
    }

    history_item = {
        "id": ticker,
        "ticker": ticker,
        "name": name,
        "industry": industry,
        "marketCap": round(market_cap, 2),
        "history": history,
    }
    return snapshot_item, history_item


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    repo_root = project_root.parent.parent

    data_dir = project_root / "public" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    snapshot_path = data_dir / "market-data.json"
    history_path = data_dir / "market-history.json"
    universe_path = script_dir / "a-share-universe.json"
    industry_map_path = script_dir / "industry-map.json"

    existing_snapshot = load_json(snapshot_path, None)
    existing_history = load_json(history_path, {"stocks": []})
    existing_snapshot_by_ticker = {
        item.get("ticker"): item
        for item in (existing_snapshot or {}).get("stocks", [])
        if isinstance(item, dict) and item.get("ticker")
    }
    existing_history_updated_at = str(existing_history.get("meta", {}).get("updatedAt") or "")
    existing_by_ticker = {
        item.get("ticker"): item
        for item in existing_history.get("stocks", [])
        if isinstance(item, dict) and item.get("ticker")
    }

    seed_tickers = [t for t in load_json(universe_path, []) if isinstance(t, str) and "." in t]
    industry_map = load_json(industry_map_path, {})
    mapped_tickers = [t for t in industry_map if isinstance(t, str) and "." in t]

    fallback_spot = load_local_snapshot_map(repo_root)

    print(f"[data:update] start {datetime.now().isoformat()} seeds={len(seed_tickers)}")

    spot_df = None
    for i in range(3):
        try:
            spot_df = normalize_spot_columns(ak.stock_zh_a_spot())
            break
        except Exception as exc:
            print(f"[data:update] 获取实时行情失败(第{i + 1}次): {exc}")
            sleep(1.2)

    spot_map: dict[str, dict[str, Any]] = {}
    if spot_df is not None and len(spot_df) > 0:
        for _, row in spot_df.iterrows():
            code_raw = str(row.get("代码", ""))
            code = code_raw[-6:] if len(code_raw) >= 6 else code_raw
            if not code:
                continue
            industry_name = pick_first_value(
                row,
                [
                    "所属行业",
                    "行业",
                    "行业名称",
                    "板块",
                    "同花顺行业",
                    "申万行业",
                ],
            )
            spot_map[code] = {
                "name": str(row.get("名称", "")).strip(),
                "latest": to_float(row.get("最新价")),
                "week_pct": to_float(row.get("涨跌幅")),
                "turnover": to_float(row.get("成交额")),
                "industry": str(industry_name).strip() if industry_name else "",
            }

    if spot_map:
        with_industry = sum(1 for item in spot_map.values() if str(item.get("industry") or "").strip())
        print(f"[data:update] spot industry coverage={with_industry}/{len(spot_map)}")

    if not spot_map and fallback_spot:
        spot_map = fallback_spot
        print(f"[data:update] 使用本地快照回退报价，共{len(spot_map)}条")

    tickers = build_universe(spot_df, fallback_spot, seed_tickers, mapped_tickers)

    delisted_tickers = load_official_delisted_tickers()
    if delisted_tickers:
        before = len(tickers)
        tickers = [ticker for ticker in tickers if ticker not in delisted_tickers]
        print(f"[data:update] official delisted filtered={before - len(tickers)} remain={len(tickers)}")

    if not tickers:
        print("[data:update] 股票池为空，跳过更新")
        return 0

    profile_dir = repo_root / "data" / "stock_profile"
    profile_map: dict[str, dict[str, Any]] = {}

    bootstrap_limit = int(os.environ.get("A_SHARE_BOOTSTRAP_LIMIT", str(DEFAULT_BOOTSTRAP_LIMIT)))
    fetch_workers = int(os.environ.get("A_SHARE_FETCH_WORKERS", str(DEFAULT_FETCH_WORKERS)))

    def priority_key(ticker: str) -> tuple[int, float, str]:
        code = ticker.split('.')[0]
        cached = 0 if ticker in existing_by_ticker else 1
        seeded = 0 if ticker in seed_tickers or ticker in mapped_tickers else 1
        turnover = -to_float(spot_map.get(code, {}).get('turnover'))
        return (cached, seeded, turnover, ticker)

    prioritized = sorted(tickers, key=priority_key)
    cached_tickers = [ticker for ticker in prioritized if ticker in existing_by_ticker]
    uncached_tickers = [ticker for ticker in prioritized if ticker not in existing_by_ticker]
    selected_tickers = cached_tickers + uncached_tickers[:bootstrap_limit]
    print(
        f"[data:update] universe={len(tickers)} cached={len(cached_tickers)} "
        f"selected={len(selected_tickers)} bootstrap_limit={bootstrap_limit}"
    )

    industry_map = enrich_industry_map_from_ths(selected_tickers, industry_map, industry_map_path)

    if profile_dir.exists():
        enrich_profile_texts_from_ths(selected_tickers, profile_dir)

    for ticker in selected_tickers:
        code = ticker.split(".")[0]
        profile_map[code] = load_json(profile_dir / f"{code}.json", {})

    stocks_for_snapshot: list[dict[str, Any]] = []
    stocks_for_history: list[dict[str, Any]] = []
    today = datetime.now().strftime("%Y-%m-%d")

    worker_context = {
        "industry_map": industry_map,
        "existing_by_ticker": existing_by_ticker,
        "existing_snapshot_by_ticker": existing_snapshot_by_ticker,
        "existing_history_updated_at": existing_history_updated_at,
        "spot_map": spot_map,
        "profile_map": profile_map,
        "today": today,
    }
    use_process_pool = len(selected_tickers) > 1000
    executor_cls = ProcessPoolExecutor if use_process_pool else ThreadPoolExecutor
    executor_kwargs = {"max_workers": max(1, fetch_workers)}
    if use_process_pool:
        executor_kwargs["initializer"] = init_worker_context
        executor_kwargs["initargs"] = (worker_context,)

    with executor_cls(**executor_kwargs) as executor:
        if use_process_pool:
            future_map = {executor.submit(process_ticker_worker, ticker): ticker for ticker in selected_tickers}
        else:
            future_map = {
                executor.submit(
                    process_ticker,
                    ticker,
                    industry_map,
                    existing_by_ticker,
                    existing_snapshot_by_ticker,
                    existing_history_updated_at,
                    spot_map,
                    profile_map,
                    today,
                ): ticker
                for ticker in selected_tickers
            }
        completed = 0
        for future in as_completed(future_map):
            completed += 1
            snapshot_item, history_item = future.result()
            if snapshot_item and history_item:
                stocks_for_snapshot.append(snapshot_item)
                stocks_for_history.append(history_item)
            if completed % 200 == 0 or completed == len(future_map):
                print(f"[data:update] progress {completed}/{len(future_map)}")

    if not stocks_for_snapshot:
        if existing_snapshot and existing_snapshot.get("stocks"):
            print("[data:update] 没有拉到新数据，保留旧快照")
            return 0
        print("[data:update] 无可用数据，且不存在旧快照")
        return 0

    now = datetime.now().strftime("%Y-%m-%d")
    snapshot_payload = {
        "meta": {
            "market": "A股市场全景",
            "updatedAt": now,
            "note": f"启动时自动更新，保留最近{HISTORY_WINDOW}个交易日窗口",
            "source": "AkShare(stock_zh_a_spot + stock_zh_a_daily)",
            "sampleSize": len(stocks_for_snapshot),
            "universeSize": len(tickers),
            "bootstrapLimit": bootstrap_limit,
        },
        "stocks": stocks_for_snapshot,
    }

    history_payload = {
        "meta": {
            "market": "A股市场全景",
            "updatedAt": now,
            "window": HISTORY_WINDOW,
            "source": "AkShare(stock_zh_a_daily)",
            "sampleSize": len(stocks_for_history),
            "universeSize": len(tickers),
            "bootstrapLimit": bootstrap_limit,
        },
        "stocks": stocks_for_history,
    }

    snapshot_path.write_text(json.dumps(snapshot_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    history_path.write_text(json.dumps(history_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[data:update] done snapshot={len(stocks_for_snapshot)} history={len(stocks_for_history)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
