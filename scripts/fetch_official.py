#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent A2 — 模型「官网价格」采集器

职责：从各模型厂商的官方定价页抓取官方价格（USD / M token），
      与人工维护的 data/official_prices.json 合并后写入 data/official_auto.json。

优先级（在 build_site.py 中生效）：
  1. 人工维护 official_prices.json（带核对日期与来源 URL，最权威）
  2. 本脚本自动抓取 official_auto.json
  3. 以上都没有 → 回退到 OpenRouter 发布价（标注 src=openrouter）

用法：
  python3 scripts/fetch_official.py            # 抓取全部厂商
  python3 scripts/fetch_official.py deepseek   # 只抓指定厂商
"""
import os, re, sys, json, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, "data", "official_auto.json")
MANUAL_JSON = os.path.join(ROOT, "data", "official_prices.json")
SNAP_DIR = os.path.join(ROOT, "snapshots", "official")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")

# 人民币 → 美元汇率（用于 MiniMax 这类以 CNY 标价的厂商）
# 优先读 collect.py 当天写入的 data/fx.json，缺失时回退 7.10
FX_FILE = os.path.join(ROOT, "data", "fx.json")
CNY_PER_USD = 7.10


def load_cny_rate():
    try:
        v = float((json.load(open(FX_FILE, encoding="utf-8")) or {}).get("cny_per_usd"))
        if 5 < v < 10:
            return v
    except Exception:
        pass
    return 7.10


def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,es;q=0.7",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def html_to_lines(h):
    """HTML → 干净文本行（保留表格单元格边界）"""
    t = re.sub(r"<(script|style|nav|svg|head)[^>]*>.*?</\1>", "", h, flags=re.S | re.I)
    t = re.sub(r"<(tr|/tr|td|/td|th|/th|br|/p|/div|/li|/h\d)[^>]*>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = (t.replace("&nbsp;", " ").replace("&amp;", "&")
          .replace("&#36;", "$").replace("&quot;", '"').replace("&#39;", "'"))
    t = re.sub(r"&#\d+;", "", t)
    lines = [re.sub(r"\s+", " ", x).strip() for x in t.split("\n")]
    return [x for x in lines if x]


def num(s):
    """从 '$1.25' / 'US$10' / '0,28' / '¥8.36' 中取数值。
    0,28 是欧式小数（=0.28），不能按千分位抹成 028。"""
    if s is None:
        return None
    t = str(s).replace("$", "").replace("¥", "").replace("￥", "").strip()
    m = re.search(r"-?\d[\d.,]*", t)
    if not m:
        return None
    x = m.group(0)
    if re.fullmatch(r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?", x):
        x = x.replace(",", "")
    elif re.fullmatch(r"-?\d+,\d{1,2}", x):
        x = x.replace(",", ".")
    else:
        x = x.replace(",", "")
    try:
        return float(x)
    except ValueError:
        return None


def loose(s):
    """与 collect.py 保持一致的模糊匹配键"""
    s = s.lower()
    s = re.sub(r"(\d)p(\d)", r"\1.\2", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


# ---------------------------------------------------------------- Anthropic
def parse_anthropic(h):
    """platform.claude.com 定价表：模型名 / 输入 / 输出 / 缓存写 / 缓存写1h / 缓存命中"""
    out = {}
    lines = html_to_lines(h)
    pat = re.compile(r"^Claude\s+(.+?)$")
    for i, ln in enumerate(lines):
        m = pat.match(ln)
        if not m:
            continue
        name = m.group(1).strip()
        # 取后面 8 行里出现的所有金额
        vals = []
        for x in lines[i + 1:i + 12]:
            if x.startswith("Claude ") or x.startswith("US$") and len(vals) >= 5:
                break
            for tok in re.findall(r"(?:US)?\$?\s?(\d+(?:\.\d+)?)\s*/?\s*MTok", x):
                vals.append(float(tok))
            if not vals:  # 兼容「$10」无 MTok 后缀
                for tok in re.findall(r"(?:US)?\$\s?(\d+(?:\.\d+)?)", x):
                    vals.append(float(tok))
            if len(vals) >= 5:
                break
        if len(vals) < 2:
            continue
        out[loose("claude " + name)] = {
            "vendor": "Anthropic", "model": "Claude " + name,
            "input": vals[0], "output": vals[1],
            "cache_read": vals[4] if len(vals) > 4 else None,
            "cache_write": vals[2] if len(vals) > 2 else None,
        }
    return out


# ----------------------------------------------------------------- DeepSeek
def parse_deepseek(h):
    """api-docs.deepseek.com：PEAK 价为标准价（OFF-PEAK 是半价）"""
    t = re.sub(r"<[^>]+>", "|", re.sub(r"<script.*?</script>", "", h, flags=re.S))
    t = re.sub(r"\|+", "|", t)
    flat = re.sub(r"\s+", " ", t)
    # 表格列顺序：deepseek-flash | deepseek-v4-pro
    def grab(label):
        i = flat.find(label)
        if i < 0:
            return []
        return [num(x) for x in re.findall(r"\$(\d+(?:\.\d+)?)", flat[i:i + 260])]

    cache_hit = grab("1M INPUT TOKENS|(CACHE HIT)")
    cache_miss = grab("1M INPUT TOKENS|(CACHE MISS)")
    outp = grab("1M OUTPUT TOKENS")
    # 每档取 PEAK（第 4 个匹配：off-peak/peak × 2 列）
    def peak(v):
        return v[3] if len(v) >= 4 else (v[-1] if v else None)

    res = {}
    specs = [("deepseek-v4.1-flash", "DeepSeek V4.1 Flash"), ("deepseek-v4-pro", "DeepSeek V4 Pro")]
    for idx, (key, disp) in enumerate(specs):
        def col(v):
            # 两列：flash, pro；每列有 off-peak/peak 两个数
            if len(v) >= 4:
                return v[1 + idx * 2] if idx == 0 else v[3]
            return v[idx] if len(v) > idx else None
        res[loose(key)] = {
            "vendor": "DeepSeek", "model": disp,
            "input": col(cache_miss), "output": col(outp),
            "cache_read": col(cache_hit), "cache_write": None,
        }
    # 保险：若解析异常（None），标记为不可用
    return {k: v for k, v in res.items() if v["input"] is not None}


# --------------------------------------------------------------------- Z.AI
def parse_zai(h):
    """docs.z.ai GLM 定价表：Model / Input / Cached Input / Storage / Output"""
    out = {}
    lines = html_to_lines(h)
    for i, ln in enumerate(lines):
        m = re.match(r"^(GLM[-\w.]*)$", ln)
        if not m:
            continue
        name = m.group(1)
        vals = []
        for x in lines[i + 1:i + 6]:
            v = re.match(r"^\$(\d+(?:\.\d+)?)$", x)
            if v:
                vals.append(float(v.group(1)))
            if len(vals) >= 3:
                break
        if len(vals) >= 2:
            out[loose(name)] = {
                "vendor": "Z.ai", "model": name,
                "input": vals[0], "output": vals[-1],
                "cache_read": vals[1] if len(vals) > 2 else None,
                "cache_write": None,
            }
    return out


# ----------------------------------------------------------------- Moonshot
def parse_moonshot(h):
    """platform.moonshot.cn Kimi 定价（CNY/MTok）→ 转 USD"""
    out = {}
    lines = html_to_lines(h)
    for i, ln in enumerate(lines):
        m = re.match(r"^(Kimi[-\s]?K[\d.]+(?:\s+\w+)?|K[\d.]+[-\s]?\w*)$", ln)
        if not m:
            continue
        name = m.group(1).strip()
        vals = []
        for x in lines[i + 1:i + 10]:
            v = re.match(r"^\$?(\d+(?:\.\d+)?)$", x)
            if v:
                vals.append(float(v.group(1)))
            if len(vals) >= 3:
                break
        if len(vals) >= 2:
            # Moonshot 中文站多为人民币标价
            unit = 1.0 if any("美元" in x or "USD" in x for x in lines[i:i + 10]) else CNY_PER_USD
            out[loose(name)] = {
                "vendor": "Moonshot", "model": name,
                "input": round(vals[0] / unit, 6),
                "output": round(vals[1] / unit, 6),
                "cache_read": round(vals[2] / unit, 6) if len(vals) > 2 else None,
                "cache_write": None,
            }
    return out


# ------------------------------------------------------------------ MiniMax
def parse_minimax(h):
    """platform.minimaxi.com：人民币 / 百万 tokens → 转 USD"""
    out = {}
    lines = html_to_lines(h)
    for i, ln in enumerate(lines):
        m = re.match(r"^(MiniMax[-\w.]*|M[\d.]+[-\w]*)$", ln)
        if not m:
            continue
        name = m.group(1)
        vals = []
        for x in lines[i + 1:i + 8]:
            v = re.match(r"^(\d+(?:\.\d+)?)$", x)
            if v:
                vals.append(float(v.group(1)))
            if len(vals) >= 3:
                break
        if len(vals) >= 2 and "模型" not in name:
            out[loose(name)] = {
                "vendor": "MiniMax", "model": name,
                "input": round(vals[0] / CNY_PER_USD, 6),
                "output": round(vals[1] / CNY_PER_USD, 6),
                "cache_read": round(vals[2] / CNY_PER_USD, 6) if len(vals) > 2 else None,
                "cache_write": None,
            }
    return out


SOURCES = {
    "anthropic": ("https://platform.claude.com/docs/es/about-claude/pricing",
                  parse_anthropic, "Anthropic"),
    "deepseek": ("https://api-docs.deepseek.com/quick_start/pricing",
                 parse_deepseek, "DeepSeek"),
    "zai": ("https://docs.z.ai/guides/overview/pricing", parse_zai, "Z.ai"),
    "moonshot": ("https://platform.moonshot.cn/docs/pricing/chat", parse_moonshot, "Moonshot"),
    "minimax": ("https://platform.minimaxi.com/document/price", parse_minimax, "MiniMax"),
}


def main():
    only = sys.argv[1:] or list(SOURCES)
    today = time.strftime("%Y-%m-%d")
    os.makedirs(SNAP_DIR, exist_ok=True)
    global CNY_PER_USD
    CNY_PER_USD = load_cny_rate()
    result = {}
    report = []

    for key in only:
        if key not in SOURCES:
            continue
        url, parser, vendor = SOURCES[key]
        try:
            h = http_get(url)
            with open(os.path.join(SNAP_DIR, f"{key}_{today}.html"), "w") as fh:
                fh.write(h)
            got = parser(h)
            for k, v in got.items():
                v["url"] = url
                v["src"] = "official"
                v["checked"] = today
                v["vendor"] = vendor
                result[k] = v
            if got:
                report.append(f"  {vendor:12} 官方页解析 {len(got):3} 个模型")
            else:
                report.append(f"  {vendor:12} 官方页未解析到表格（SPA/区域限制），依赖人工维护表")
        except Exception as e:
            report.append(f"  {vendor:12} 失败  {type(e).__name__}: {e}")

    n_auto = len(result)          # 合并人工表之前，纯自动解析的条数

    # 合并人工维护表（人工优先）
    manual = {}
    if os.path.exists(MANUAL_JSON):
        try:
            manual = json.load(open(MANUAL_JSON, encoding="utf-8")).get("prices", {})
        except Exception as e:
            print("  人工表读取失败:", e)
    for k, v in manual.items():
        result[k] = v

    payload = {
        "updated": today,
        "cny_per_usd": CNY_PER_USD,
        "n_auto": n_auto,
        "n_manual": len(manual),
        "prices": result,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print("=== 官网价格采集 ===")
    for r in report:
        print(r)
    print(f"  自动解析 {payload['n_auto']} 条 + 人工维护 {payload['n_manual']} 条 "
          f"= 官网价合计 {len(result)} 条 → {OUT_JSON}")


if __name__ == "__main__":
    main()
