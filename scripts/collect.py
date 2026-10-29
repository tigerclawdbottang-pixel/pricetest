#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent A - 模型价格采集器
从 5 个源抓取全量模型价格，归一化后写入 SQLite 并保存每日快照。
统一单位：USD / 1M tokens
（硅基流动 SiliconFlow 以人民币 ¥/M tokens 计价，按当日汇率折算为 USD）
"""
import json, re, sqlite3, sys, time, os, hashlib
from collections import Counter
from datetime import datetime, timezone, date
import urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB   = os.path.join(ROOT, "data", "prices.db")
RAW  = os.path.join(ROOT, "snapshots")
os.makedirs(RAW, exist_ok=True)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

SOURCES = ["openrouter", "fireworks", "wokey", "cheaperinference", "siliconflow"]

# CNY -> USD 兜底汇率（1 CNY = ? USD），联网取不到时使用
FALLBACK_FX = 0.1408        # ≈ 1 USD = 7.10 CNY
FX_FILE = os.path.join(ROOT, "data", "fx.json")


# ---------------------------------------------------------------- http
def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


# ------------------------------------------------------------ normalize
PROVIDER_PREFIX = re.compile(
    r"^(accounts/fireworks/models/|"
    r"anthropic/|openai/|google/|deepseek/|deepseek-ai/|moonshotai/|z-ai/|zai/|zai-org/|"
    r"qwen/|alibaba/|tongyi-mai/|"
    r"minimax/|minimaxai/|meta-llama/|mistralai/|x-ai/|tencent/|hunyuan/|bytedance/|"
    r"bytedance-seed/|baidu/|01-ai/|nvidia/|microsoft/|cohere/|ai21/|perplexity/|"
    r"openrouter/|inception/|liquid/|nousresearch/|sao10k/|arcee-ai/|"
    r"fireworks/|upstage/|lgai-exaone/|reka/|relace/|switchpoint/|"
    r"aion-labs/|inflection/|morph/|neversleep/|allenai/|scb10x/|"
    r"thedrummer/|cognitivecomputations/|eleutherai/|together/|qwen3/|"
    r"pro/|baai/|chinatel/|wan-ai/|funaudiollm/|inclusionai/|meituan-longcat/|"
    r"stepfun-ai/|paddlepaddle/|xingchenagi/|openmoss/|fnlp/|kwai-kolors/|kolors/)")
DATE_SUFFIX = re.compile(r"[-_](20\d{6}|\d{4}[-]?\d{2}[-]?\d{2}|\d{4})$")


def strip_provider(mid: str) -> str:
    s = mid.strip().lower()
    prev = None
    while prev != s:                       # 可能有双重前缀
        prev = s
        s = PROVIDER_PREFIX.sub("", s)
    return s


def split_version(base: str):
    """返回 (family, version)。如 kimi-k3.1-pro-20261023 -> (kimi-k3.1-pro, 20261023)"""
    m = DATE_SUFFIX.search(base)
    if m:
        return base[:m.start()].strip("-_"), m.group(1).replace("-", "")
    return base, ""


def canonical(mid: str):
    """原始 model_id -> (family, version)"""
    b = strip_provider(mid)
    b = re.sub(r"[/:]+", "-", b)
    b = re.sub(r"[^a-z0-9._\-]+", "-", b).strip("-")
    return split_version(b)


def loose_key(family: str) -> str:
    """
    跨源模糊匹配键。不同源写法差异：
      claude-fable-5-1 / claude-fable-5.1   -> claudefable51
      minimax-m3p1-flash / minimax-m3.1-flash -> minimaxm31flash
      glm-5.3 / glm-5-3                      -> glm53
    规则：数字间的 p 视为小数点，然后抹掉所有非字母数字。
    """
    s = family.lower()
    s = re.sub(r"(\d)p(\d)", r"\1.\2", s)          # 3p1 -> 3.1
    s = re.sub(r"[^a-z0-9]", "", s)                 # 去掉 . - _ 等
    return s


VARIANT_RULES = [
    ("batch",      re.compile(r"(?:^|[:_-])batch$")),
    ("free",       re.compile(r"(?:^|[:_-])free$")),
    ("pro",        re.compile(r"^pro[/:_-]")),      # 硅基流动的 Pro 部署版
    ("highspeed",  re.compile(r"[-_]highspeed$")),
    ("lightning",  re.compile(r"[-_]lightning$")),
    ("fast",       re.compile(r"[-_]fast$")),
    ("e2ee",       re.compile(r"^e2ee[-_]")),
    ("uncensored", re.compile(r"[-_]uncensored$")),
    ("heretic",    re.compile(r"[-_]heretic$")),
]
# 这些变体不计入主价格对比（计费模式/特殊路由，会污染最低价）
EXCLUDE_VARIANTS = {"batch", "free"}


def detect_variant(model_id: str, family: str):
    s = model_id.lower()
    for name, rx in VARIANT_RULES:
        if rx.search(s):
            return name
    return ""


def f(x):
    """安全转 float；None/''/'-1'/非数字 -> None。
    兼容千分位 1,234.56 与欧式小数 0,28（=0.28，不能抹成 028）。"""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        v = float(x)
        return None if v < 0 else v
    s = str(x).strip().replace("$", "").replace("¥", "").replace("￥", "")
    if s in ("", "-", "N/A", "None", "null"):
        return None
    m = re.match(r"-?\d[\d.,]*", s)
    if not m:
        return None
    t = m.group(0)
    if re.fullmatch(r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?", t):
        t = t.replace(",", "")
    elif re.fullmatch(r"-?\d+,\d{1,2}", t):
        t = t.replace(",", ".")
    else:
        t = t.replace(",", "")
    try:
        v = float(t)
    except ValueError:
        return None
    return None if v < 0 else v


def parse_ctx(s):
    """'128K' / '1M' / '128000' -> int"""
    t = str(s if s is not None else "").strip().lower().replace(",", "")
    m = re.match(r"(\d+(?:\.\d+)?)\s*([km])?", t)
    if not m:
        return None
    v = float(m.group(1))
    u = m.group(2)
    if u == "k":
        v *= 1000
    elif u == "m":
        v *= 1_000_000
    return int(v) if v > 0 else None


def cny_to_usd():
    """返回 (rate, src)：1 CNY = rate USD。多级兜底，失败用常量。"""
    # open.er-api.com 给 6 位小数（0.149758），v4 只有 2 位（0.15），故优先前者
    tries = (
        ("https://open.er-api.com/v6/latest/CNY",
         lambda j: (j.get("rates") or {}).get("USD")),
        ("https://api.exchangerate-api.com/v4/latest/CNY",
         lambda j: (j.get("rates") or {}).get("USD")),
    )
    for url, pick in tries:
        try:
            v = f(pick(json.loads(fetch(url, timeout=20))))
            if v and 0.05 < v < 0.5:
                return round(v, 6), url
        except Exception:
            continue
    return FALLBACK_FX, "fallback (1 USD = 7.10 CNY)"


def save_fx(rate, src, day):
    try:
        with open(FX_FILE, "w") as fh:
            json.dump(dict(date=day, cny_per_usd=round(1 / rate, 4) if rate else None,
                           usd_per_cny=rate, source=src,
                           updated=datetime.now(timezone.utc).isoformat(timespec="seconds")),
                      fh, ensure_ascii=False, indent=2)
    except Exception as e:
        print("  警告 fx.json 写入失败:", e, file=sys.stderr)


def pct_discount(final_price, list_price):
    if final_price is None or list_price in (None, 0):
        return None
    if final_price >= list_price:
        return 0.0
    return round((1 - final_price / list_price) * 100, 2)


# ------------------------------------------------------------ 1. OpenRouter
# pricing.prompt/completion 单位是 USD/token（需 *1e6）；pricing.image 是 USD/张，
# 不要乘 1e6。输出模态含 image 的模型把 image 价一并记下来。
def openrouter_row(m):
    p = m.get("pricing") or {}
    inp = f(p.get("prompt")); outp = f(p.get("completion"))
    if inp is not None:  inp *= 1_000_000
    if outp is not None: outp *= 1_000_000
    cr = f(p.get("input_cache_read"));  cw = f(p.get("input_cache_write"))
    if cr is not None: cr *= 1_000_000
    if cw is not None: cw *= 1_000_000
    mods = ((m.get("architecture") or {}).get("output_modalities") or [])
    unit, unit_price = "token", None
    img = f(p.get("image"))
    if "image" in mods and img is not None:
        unit, unit_price = "image", img
    if inp is None and outp is None and unit_price is None:
        return None
    fam, ver = canonical(m.get("id", ""))
    return dict(
        source="openrouter", model_id=m.get("id", ""),
        model_name=m.get("name") or m.get("id", ""),
        family=fam, version=ver,
        provider=(m.get("id", "").split("/")[0] if "/" in m.get("id", "") else ""),
        input=inp, output=outp, cache_read=cr, cache_write=cw,
        list_input=inp, list_output=outp,
        discount=None,
        context=(m.get("context_length") or None),
        modality=(m.get("architecture") or {}).get("modality", ""),
        unit=unit, unit_price=unit_price, list_unit_price=None, unit_discount=None,
    )


def collect_openrouter():
    raw = fetch("https://openrouter.ai/api/v1/models")
    data = json.loads(raw)["data"]
    out = [r for r in (openrouter_row(m) for m in data) if r]
    return out, len(data)


# ------------------------------------------------------------ 2. Fireworks
# token 价：inputTokenPrice 等，USD/1M；图片：unitPrice 或 stepPrice；
# 视频/语音：durationPrice（按秒）。
def fireworks_row(m):
    c = m.get("cost") or {}
    typ = (m.get("type") or "").lower()
    inp = f(c.get("inputTokenPrice"))
    if inp is None:
        inp = f(c.get("inputTokenUncachedPrice"))
    if inp is None or inp == 0:
        tp = f(c.get("tokenPrice"))
        if tp is not None:
            inp = tp
    outp = f(c.get("outputTokenPrice"))
    unit, unit_price = "token", None
    if typ == "image":
        up = f(c.get("unitPrice"))
        if up is None or up == 0:
            sp = f(c.get("stepPrice"))
            if sp is not None and sp > 0:
                up, unit = sp, "step"
            else:
                unit = "image"
        else:
            unit = "image"
        if up is not None:
            unit_price = up
    elif "video" in typ:
        dp = f(c.get("durationPrice"))
        if dp is not None:
            unit, unit_price = "second", dp
    elif typ in ("speech-to-text", "audio", "transcription"):
        dp = f(c.get("durationPrice"))
        if dp is not None:
            unit, unit_price = "second", dp
    if unit != "token":
        if inp == 0:
            inp = None
        if outp == 0:
            outp = None
    if inp is None and outp is None and unit_price is None:
        return None
    mid = m.get("id") or (m.get("name", "").split("/")[-1])
    fam, ver = canonical(mid)
    return dict(
        source="fireworks", model_id=mid,
        model_name=m.get("title") or mid,
        family=fam, version=ver,
        provider=(m.get("provider") or {}).get("name", ""),
        input=inp, output=outp,
        cache_read=f(c.get("inputTokenCachedPrice")), cache_write=None,
        list_input=inp, list_output=outp,
        discount=None,
        context=m.get("contextLength"),
        modality=m.get("type", ""),
        unit=unit, unit_price=unit_price, list_unit_price=None, unit_discount=None,
    )


def collect_fireworks():
    raw = fetch("https://app.fireworks.ai/api/models")
    data = json.loads(raw)
    out = [r for r in (fireworks_row(m) for m in data) if r]
    return out, len(data)


# ------------------------------------------------------------ 3. Wokey
# 页面内嵌 <script id="wokey-models-page-data" type="application/json">
# token 价在 input_tokens/output_tokens；图片价在 output_images SKU。
def wokey_row(mdl):
    skus = {}
    for s in (mdl.get("pricing_skus") or []):
        skus.setdefault(s.get("meter"), []).append(s)

    def best(meter, key="price_usd"):
        vals = [f(s.get(key)) for s in skus.get(meter, []) if f(s.get(key)) is not None]
        return min(vals) if vals else None

    inp, outp = best("input_tokens"), best("output_tokens")
    img = best("output_images")
    mods = ((mdl.get("architecture") or {}).get("output_modalities") or [])
    unit, unit_price = "token", None
    if img is not None and ((not inp and not outp) or "image" in mods):
        unit, unit_price = "image", img
        inp = outp = None
    if inp is None and outp is None and unit_price is None:
        return None
    li = best("input_tokens", "reference_price_usd")
    lo = best("output_tokens", "reference_price_usd")
    fam, ver = canonical(mdl.get("id", ""))
    return dict(
        source="wokey", model_id=mdl.get("id", ""),
        model_name=mdl.get("name") or mdl.get("id", ""),
        family=fam, version=ver,
        provider=mdl.get("owned_by", ""),
        input=inp, output=outp,
        cache_read=best("cache_read_tokens"),
        cache_write=best("cache_write_tokens") or best("cache_write_5m_tokens"),
        list_input=li, list_output=lo,
        discount=(pct_discount(inp, li) if unit == "token" else None),
        context=(mdl.get("architecture") or {}).get("context_length") or None,
        modality=(mdl.get("architecture") or {}).get("modality", ""),
        unit=unit, unit_price=unit_price, list_unit_price=None, unit_discount=None,
    )


def collect_wokey():
    html = fetch("https://wokey.ai/models")
    m = re.search(r'<script id="wokey-models-page-data"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError("wokey: 未找到内嵌数据块")
    data = json.loads(m.group(1))["data"]
    out = [r for r in (wokey_row(mdl) for mdl in data) if r]
    return out, len(data)


# ------------------------------------------------------------ 4. CheaperInference
# Next.js flight payload 里含全量 models 数组
def _extract_json_array(s, start):
    """从 start(指向'[') 开始按括号平衡提取 JSON 数组"""
    depth, i, n = 0, start, len(s)
    in_str, esc = False, False
    while i < n:
        ch = s[i]
        if in_str:
            if esc:          esc = False
            elif ch == "\\":  esc = True
            elif ch == '"':   in_str = False
        else:
            if ch == '"':                 in_str = True
            elif ch in "[{":              depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    return s[start:i + 1]
        i += 1
    return None


def ci_row(m):
    """CheaperInference：token 模型走 input/output；图片/视频走 unitPriceUsd。

    注意：不是所有媒体模型的 unit 都写着 image/video；有的 unit 为 null。
    只要 type 是 image/video 且返回了 unitPriceUsd，就按媒体价处理。
    """
    typ = (m.get("type") or "").strip().lower()
    unit = (m.get("unit") or "").strip().lower()
    up0 = f(m.get("unitPriceUsd"))
    is_media = (unit in ("image", "video", "second")
                or (typ in ("image", "video") and (up0 is not None or bool(m.get("free")))))
    fam, ver = canonical(m.get("id", ""))
    ctx = m.get("contextLength")
    mod = f"{m.get('type','')}/{m.get('group','')}"
    if is_media:
        up = up0
        lup = f(m.get("referenceUnitPriceUsd"))
        disc = f(m.get("discountPercent"))
        if up is None and bool(m.get("free")):
            up = 0.0
        if up is None:
            return None
        if up == 0 and not bool(m.get("free")):
            return None            # 0 通常是“未标价”，不是免费
        if m.get("listPriceKnown") is False:
            lup = None
        if "second" in unit:
            u = "second"
        elif "image" in unit:
            u = "image"
        elif "video" in unit:
            u = "video"
        else:
            u = "video" if typ == "video" else "image"
        return dict(
            source="cheaperinference", model_id=m.get("id", ""),
            model_name=m.get("label") or m.get("id", ""),
            family=fam, version=ver,
            provider=m.get("providerLabel") or "",
            input=None, output=None, cache_read=None, cache_write=None,
            list_input=None, list_output=None, discount=disc,
            context=ctx, modality=mod,
            unit=u, unit_price=up, list_unit_price=lup,
            unit_discount=(disc if disc is not None else pct_discount(up, lup)),
        )
    inp, outp = f(m.get("ourInputPerM")), f(m.get("ourOutputPerM"))
    li, lo = f(m.get("listInputPerM")), f(m.get("listOutputPerM"))
    if inp is None and outp is None:
        return None
    cr_mult = f(m.get("cacheReadInputMultiplier"))
    cw_mult = f(m.get("cacheWriteInputMultiplier"))
    if m.get("listPriceKnown") is False:
        li = lo = None
    return dict(
        source="cheaperinference", model_id=m.get("id", ""),
        model_name=m.get("label") or m.get("id", ""),
        family=fam, version=ver,
        provider=m.get("providerLabel") or "",
        input=inp, output=outp,
        cache_read=(round(inp * cr_mult, 6) if (inp is not None and cr_mult is not None) else None),
        cache_write=(round(inp * cw_mult, 6) if (inp is not None and cw_mult is not None) else None),
        list_input=li, list_output=lo,
        discount=f(m.get("discountPercent")),
        context=ctx, modality=mod,
        unit="token", unit_price=None, list_unit_price=None, unit_discount=None,
    )


def collect_cheaperinference():
    html = fetch("https://platform.cheaperinference.com/markets")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    blob = ""
    for c in chunks:
        try:   blob += json.loads('"' + c + '"')
        except Exception: blob += c
    idx = blob.find('"models":[')
    if idx < 0:
        raise RuntimeError("cheaperinference: 未找到 models 数组")
    arr = _extract_json_array(blob, idx + len('"models":') )
    data = json.loads(arr)
    out = [r for r in (ci_row(m) for m in data) if r]
    return out, len(data)


# ------------------------------------------------------------ 5. SiliconFlow (硅基流动)
# Next.js flight payload 里含 "data":[{modelName, pricing:[{specification:prompt/completion,
# price, unitOfGood:"/ M Tokens"}], currency:"¥"}]，需按汇率折算 USD
# -------------------------------------------------- 硅基流动 · llmpricing
import html as _html

SF_REFER_URL = "https://llmpricing.dev/p/siliconflow-cn/"

def collect_siliconflow_llmpricing():
    """从 llmpricing.dev 抓硅基流动价格——单位已是 USD / M tokens，无需汇率。
    表头：Model | Input | Output | Cache read | Context | Cheapest here?
    """
    html = fetch(SF_REFER_URL)
    i, j = html.find("<table"), html.find("</table>")
    if i < 0 or j < 0:
        raise RuntimeError("llmpricing: 未找到价格表")

    def cellnum(td):
        s = _html.unescape(re.sub(r"<[^>]+>", "", td)).strip().replace(",", "")
        if s in ("", "—", "-", "–"):
            return None
        # $0.075  /  免费 Free  /  0.075
        if re.fullmatch(r"(?i)free", s):
            return 0.0
        m = re.search(r"-?\d+(?:\.\d+)?", s)
        return float(m.group(0)) if m else None

    def celltext(td):
        return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", "", td))).strip()

    out, seen = [], set()
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html[i:j], re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 5:
            continue
        a = re.search(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', tds[0], re.S)
        if not a:
            continue
        atext = _html.unescape(re.sub(r"<[^>]+>", "", a.group(2))).strip()
        if not atext:
            continue
        # <a> 里是展示名（如 "Qwen3 8B"），紧随其后 font-mono 的 span 才是原始 id。
        # 用展示名做模型名更易与 OpenRouter 等源匹配到同一模型。
        raw_id = _mono_or(tds[0], atext)
        name = atext
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        inp  = cellnum(tds[1])
        outp = cellnum(tds[2])
        cac  = cellnum(tds[3])
        ctx = parse_ctx(celltext(tds[4]))
        if inp is None and outp is None:
            continue
        if inp == 0 and outp is None:      # 限免模型：输入输出都不要钱
            outp = 0.0
        fam, ver = canonical(name)
        out.append(dict(
            source="siliconflow", model_id=name, model_name=name,
            family=fam, version=ver, provider=(raw_id.split("/")[0] if "/" in raw_id else ""),
            input=inp, output=outp,
            cache_read=cac, cache_write=None,
            list_input=None, list_output=None, discount=None,
            context=ctx, modality="text",
        ))
    if not out:
        raise RuntimeError("llmpricing: 未解析出任何模型")
    return out, len(out), dict(rate=None, fxsrc="llmpricing.dev (USD 直出)")


def _mono_or(td, fallback):
    """取 Model 单元格里 font-mono 那行的原始模型 id（用于记录 provider）。"""
    for attrs, inner in re.findall(r"<span([^>]*)>(.*?)</span>", td, re.S):
        if "font-mono" in attrs:
            t = re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", "", inner))).strip()
            if t:
                return t
    return fallback


def collect_siliconflow():
    """硅基流动价格以 https://llmpricing.dev/p/siliconflow-cn/ 为准。
    该站收录不到的模型，再用官网数据（人民币计价，按当日汇率折算）补齐。
    参考站失败时降级为「官网数据全量」，而不是让整个源失败。
    """
    ref_rows, ref_n, ref_extra = [], 0, {}
    try:
        ref_rows, ref_n, ref_extra = collect_siliconflow_llmpricing()
    except Exception as e:
        print(f"    siliconflow: 参考站失败，降级为官网数据（{type(e).__name__}: {e}）",
              file=sys.stderr)
    ref_keys = {loose_key(r["family"]) for r in ref_rows}

    cn_rows, cn_n, cn_extra = [], 0, {}
    try:
        cn_raw, cn_n, cn_extra = _collect_siliconflow_cn()
        cn_rows = [r for r in cn_raw if loose_key(r["family"]) not in ref_keys]
    except Exception as e:
        print(f"    siliconflow: 官网补充失败（{type(e).__name__}: {e}）", file=sys.stderr)
        if not ref_rows:
            raise RuntimeError(f"siliconflow: 参考站与官网均失败（{e}）")

    rows = ref_rows + cn_rows
    if not rows:
        raise RuntimeError("siliconflow: 两个来源都没有解析出模型")
    extra = dict(ref_extra)
    extra["ref_n"] = len(ref_rows)
    extra["cn_n"] = len(cn_rows)
    if cn_rows:
        extra["rate"] = cn_extra.get("rate")
        extra["fxsrc"] = (cn_extra.get("fxsrc") or "") + " (仅用于官网补齐部分)"
    return rows, ref_n + cn_n, extra


def siliconflow_cn_row(m, rate):
    """硅基流动官网：/ M Tokens 走 token；/ Image、/ Video、/ M UTF-8 bytes 记录单位价。"""
    pu = (m.get("priceUnit") or "").strip()
    if pu not in ("/ M Tokens", "/ Image", "/ Video", "/ M UTF-8 bytes", ""):
        return None
    if (m.get("status") or "normal") != "normal":
        return None
    mid = m.get("modelName") or m.get("modelId") or ""
    fam, ver = canonical(mid)
    base = dict(
        source="siliconflow", model_id=mid,
        model_name=m.get("DisplayName") or mid.split("/")[-1],
        family=fam, version=ver,
        provider=m.get("mf") or "",
        context=(m.get("contextLen") or None),
        modality=f"{m.get('type','')}/{m.get('subType','')}",
    )
    if pu == "/ M Tokens":
        pr = {p.get("specification"): f(p.get("price"))
              for p in (m.get("pricing") or [])}
        inp, outp = pr.get("prompt"), pr.get("completion")
        if inp is None and outp is None:
            return None
        if inp is not None:  inp = round(inp * rate, 8)
        if outp is not None: outp = round(outp * rate, 8)
        base.update(input=inp, output=outp, cache_read=None, cache_write=None,
                    list_input=None, list_output=None, discount=None,
                    unit="token", unit_price=None, list_unit_price=None, unit_discount=None)
        return base
    price = f(m.get("price"))
    if price is None:
        return None
    cur = (m.get("currency") or "¥").strip()
    if cur in ("¥", "￥", "CNY", "RMB"):
        price = round(price * rate, 8)
    unit = {"/ Image": "image", "/ Video": "video",
            "/ M UTF-8 bytes": "utf8_mb", "": "unknown"}[pu]
    base.update(input=None, output=None, cache_read=None, cache_write=None,
                list_input=None, list_output=None, discount=None,
                unit=unit, unit_price=price, list_unit_price=None, unit_discount=None)
    return base


def _collect_siliconflow_cn():
    """直接读 siliconflow.cn/models 的内嵌数据（人民币计价，按当日汇率折算）。"""
    html = fetch("https://www.siliconflow.cn/models")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    blob = ""
    for c in chunks:
        try:   blob += json.loads('"' + c + '"')
        except Exception: blob += c
    idx = blob.find('"data":[{')
    if idx < 0:
        raise RuntimeError("siliconflow: 未找到 models 数组")
    data = json.loads(_extract_json_array(blob, idx + len('"data":')))
    rate, fxsrc = cny_to_usd()
    out = [r for r in (siliconflow_cn_row(m, rate) for m in data) if r]
    return out, len(data), dict(rate=rate, fxsrc=fxsrc)


COLLECTORS = {
    "openrouter": collect_openrouter,
    "fireworks": collect_fireworks,
    "wokey": collect_wokey,
    "cheaperinference": collect_cheaperinference,
    "siliconflow": collect_siliconflow,
}


# ---------------------------------------------------------------- DB
SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  source TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT,
  family TEXT NOT NULL,
  loose TEXT NOT NULL,
  variant TEXT,
  version TEXT,
  provider TEXT,
  input REAL, output REAL,
  cache_read REAL, cache_write REAL,
  list_input REAL, list_output REAL,
  discount REAL,
  context INTEGER,
  modality TEXT,
  unit TEXT DEFAULT 'token',
  unit_price REAL,
  list_unit_price REAL,
  unit_discount REAL,
  UNIQUE(snapshot_date, source, model_id)
);
CREATE INDEX IF NOT EXISTS ix_prices_family ON prices(family);
CREATE INDEX IF NOT EXISTS ix_prices_loose  ON prices(loose);
CREATE INDEX IF NOT EXISTS ix_prices_date   ON prices(snapshot_date);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT, snapshot_date TEXT, source TEXT,
  status TEXT, raw_count INTEGER, kept INTEGER, message TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at TEXT, snapshot_date TEXT,
  source TEXT, family TEXT, model_id TEXT, field TEXT,
  old_value REAL, new_value REAL, delta_pct REAL, severity TEXT, note TEXT
);
"""


def init_db():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    # 旧库升级：补上计价单位字段（默认 token）
    cols = {r[1] for r in con.execute("PRAGMA table_info(prices)")}
    for name, decl in (
        ("unit", "TEXT DEFAULT 'token'"),
        ("unit_price", "REAL"),
        ("list_unit_price", "REAL"),
        ("unit_discount", "REAL"),
    ):
        if name not in cols:
            con.execute(f"ALTER TABLE prices ADD COLUMN {name} {decl}")
    return con


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    today = date.today().isoformat()
    con = init_db()
    os.makedirs(os.path.join(RAW, today), exist_ok=True)

    all_rows, summary, fxinfo = [], [], None
    for src in SOURCES:
        if only and src != only:
            continue
        t0 = time.time()
        try:
            res = COLLECTORS[src]()
            if len(res) == 3:
                rows, raw_n, extra = res
                if extra and extra.get("rate"):
                    fxinfo = extra
                    print(f"      汇率 1 CNY = {extra['rate']} USD  ({extra['fxsrc']})")
            else:
                rows, raw_n = res
            kept = []
            for r in rows:
                r["snapshot_date"] = today
                r["loose"] = loose_key(r["family"])
                r["variant"] = detect_variant(r["model_id"], r["family"])
                r.setdefault("unit", "token")
                r.setdefault("unit_price", None)
                r.setdefault("list_unit_price", None)
                r.setdefault("unit_discount", None)
                if r["variant"] in EXCLUDE_VARIANTS:
                    continue          # batch/free 是不同计费模式，不参与比价
                kept.append(r)
            rows = kept
            all_rows += rows
            status, msg = "ok", ""
        except Exception as e:
            rows, raw_n = [], 0
            status, msg = "fail", f"{type(e).__name__}: {e}"
            print(f"[FAIL] {src}: {msg}", file=sys.stderr)
        con.execute(
            "INSERT INTO runs(run_at,snapshot_date,source,status,raw_count,kept,message) VALUES(?,?,?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), today, src, status, raw_n, len(rows), msg))
        summary.append(dict(source=src, status=status, raw=raw_n, kept=len(rows),
                            seconds=round(time.time() - t0, 1), message=msg))
        print(f"[{status.upper():4}] {src:18} raw={raw_n:5} kept={len(rows):5} {time.time()-t0:.1f}s {msg}")

    if fxinfo:
        save_fx(fxinfo["rate"], fxinfo["fxsrc"], today)

    # 写库：本次成功的源整源替换。
    # INSERT OR REPLACE 只覆盖同 model_id 的行，上游当天已下架的模型会残留，
    # 导致页面把昨天/早些时候的模型继续展示（曾出现 CI 404 kept 但库中 532 行）。
    ok_sources = [s["source"] for s in summary if s["status"] == "ok"]
    for src in ok_sources:
        con.execute("DELETE FROM prices WHERE snapshot_date=? AND source=?", (today, src))
    for r in all_rows:
        con.execute("""INSERT OR REPLACE INTO prices
          (snapshot_date,source,model_id,model_name,family,loose,variant,version,provider,
           input,output,cache_read,cache_write,list_input,list_output,discount,context,modality,
           unit,unit_price,list_unit_price,unit_discount)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (r["snapshot_date"], r["source"], r["model_id"], r["model_name"], r["family"],
           r["loose"], r["variant"], r["version"], r["provider"], r["input"], r["output"],
           r["cache_read"], r["cache_write"], r["list_input"], r["list_output"],
           r["discount"], r["context"], r["modality"],
           r.get("unit") or "token", r.get("unit_price"),
           r.get("list_unit_price"), r.get("unit_discount")))
    con.commit()

    # 原始快照留档：只替换本次成功的源，失败源/未运行的源保留当天已有数据。
    # （单源运行时也不会把整日快照覆盖成只剩一个源）
    snap_rows, snap_summary = all_rows, summary
    snap_path = os.path.join(RAW, today, "rows.json")
    if os.path.exists(snap_path):
        replace = {s["source"] for s in summary if s["status"] == "ok"}
        attempted = {s["source"] for s in summary}
        try:
            old_rows = json.load(open(snap_path, encoding="utf-8"))
            snap_rows = [r for r in old_rows if r.get("source") not in replace] + all_rows
        except Exception as e:
            print("  警告 旧快照合并失败:", e, file=sys.stderr)
        try:
            old_sum = json.load(open(os.path.join(RAW, today, "summary.json"), encoding="utf-8"))
            snap_summary = [s for s in (old_sum.get("sources") or [])
                            if s.get("source") not in attempted] + summary
        except Exception:
            pass
    with open(snap_path, "w") as fh:
        json.dump(snap_rows, fh, ensure_ascii=False)
    with open(os.path.join(RAW, today, "summary.json"), "w") as fh:
        json.dump(dict(date=today, rows=len(snap_rows), sources=snap_summary),
                  fh, ensure_ascii=False, indent=2)

    print(f"\n合计写入 {len(all_rows)} 条 -> {DB}")
    units = Counter((r.get("unit") or "token") for r in all_rows)
    print(f"计价单位分布: {dict(units)}")
    media_n = sum(1 for r in all_rows if (r.get("unit") or "token") != "token")
    print(f"媒体计价行（图片/视频/语音等）: {media_n}")
    con.close()
    return 0 if all(s["status"] == "ok" for s in summary) else 1


if __name__ == "__main__":
    sys.exit(main())
