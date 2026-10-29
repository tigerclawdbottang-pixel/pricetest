#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent B 数据层：从 SQLite 生成前端使用的 data.json
- 按 loose key 跨源聚合（每源取 input 最低的可用版本作代表价，版本明细完整保留）
- 计算每模型的 min/max 用于红绿着色
- 输出历史序列供走势图使用
"""
import base64, json, os, re, sqlite3, sys
from collections import defaultdict
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB   = os.path.join(ROOT, "data", "prices.db")
OUT  = os.path.join(ROOT, "web", "data.json")
MANUAL_JSON = os.path.join(ROOT, "data", "official_prices.json")   # 人工维护（最优先）
AUTO_JSON   = os.path.join(ROOT, "data", "official_auto.json")     # 自动抓取（次优先）

# 官网价格来源优先级：人工维护 > 自动抓取 > OpenRouter 兜底
OFFICIAL = {}
OFFICIAL_META = {"updated": None, "auto_updated": None, "n_manual": 0, "n_auto": 0}


KEY_JSON = os.path.join(ROOT, "data", "llm_key.json")
_KEY_SALT = b"modelprice-v1"


def _xor_obf(s: str) -> str:
    """可逆混淆：XOR + base64。目的只是让明文密钥不出现在 HTML 源码里。"""
    raw = s.encode("utf-8")
    out = bytes(b ^ _KEY_SALT[i % len(_KEY_SALT)] for i, b in enumerate(raw))
    return base64.b64encode(out).decode("ascii")


def obf_key():
    """读取 data/llm_key.json → 返回 {provider, endpoint, model, mode, k, mask} 或 None"""
    if not os.path.exists(KEY_JSON):
        return None
    try:
        j = json.load(open(KEY_JSON, encoding="utf-8"))
    except Exception as e:
        print("  警告 llm_key.json 读取失败:", e, file=sys.stderr)
        return None
    k = (j.get("key") or "").strip()
    if not k or len(k) < 8:
        return None
    return dict(
        provider=j.get("provider") or "",
        endpoint=j.get("endpoint") or "",
        model=j.get("model") or "",
        mode=j.get("mode") or "direct",
        k=_xor_obf(k),
        mask=mask_key(k),
    )


def mask_key(k: str) -> str:
    if len(k) <= 10:
        return k[:2] + "***"
    return f"{k[:6]}{'•' * 8}{k[-4:]}"


def load_official():
    manual, auto = {}, {}
    if os.path.exists(MANUAL_JSON):
        try:
            j = json.load(open(MANUAL_JSON, encoding="utf-8"))
            manual = j.get("prices", {})
            OFFICIAL_META["updated"] = (j.get("meta") or {}).get("updated")
        except Exception as e:
            print("  警告 official_prices.json 读取失败:", e, file=sys.stderr)
    if os.path.exists(AUTO_JSON):
        try:
            j = json.load(open(AUTO_JSON, encoding="utf-8"))
            auto = {k: v for k, v in (j.get("prices") or {}).items()
                    if v.get("src") == "official"}
            OFFICIAL_META["auto_updated"] = j.get("updated")
        except Exception as e:
            print("  警告 official_auto.json 读取失败:", e, file=sys.stderr)
    OFFICIAL_META["n_manual"] = len(manual)
    OFFICIAL_META["n_auto"] = len(auto)
    merged = dict(auto)
    merged.update(manual)          # 人工覆盖自动
    OFFICIAL.update(merged)

SOURCES = [
    {"id": "openrouter",       "label": "OpenRouter",        "url": "https://openrouter.ai/models",
     "color": "#7C6CF6", "note": "聚合市场价（基准源，模型命名以它为准）"},
    {"id": "fireworks",        "label": "Fireworks AI",      "url": "https://fireworks.ai/models",
     "color": "#F97316", "note": "自托管推理，含缓存读价格"},
    {"id": "wokey",            "label": "Wokey",             "url": "https://wokey.ai/models",
     "color": "#22C55E", "note": "折扣路由，提供官方参考价与折扣率"},
    {"id": "cheaperinference", "label": "CheaperInference",  "url": "https://www.cheaperinference.com/#models",
     "color": "#06B6D4", "note": "批量议价市场，折扣力度最大"},
    {"id": "siliconflow",     "label": "硅基流动 SiliconFlow", "url": "https://www.siliconflow.cn/models",
     "color": "#EC4899", "note": "国内云，人民币计价按当日汇率折算 USD"},
]

FX_FILE = os.path.join(ROOT, "data", "fx.json")
FX = {}


def load_fx():
    """人民币 -> 美元汇率（硅基流动折算用）"""
    if os.path.exists(FX_FILE):
        try:
            FX.update(json.load(open(FX_FILE, encoding="utf-8")))
        except Exception as e:
            print("  警告 fx.json 读取失败:", e, file=sys.stderr)
    if FX.get("cny_per_usd"):
        for s in SOURCES:
            if s["id"] == "siliconflow":
                s["note"] = (f"国内云，人民币计价；按 1 USD = {FX['cny_per_usd']} CNY 折算"
                             f"（{FX.get('date', '')}）")

# 关注清单：用户指定的国际 + 中国主力模型（loose key -> 显示名）
WATCH = [
    ("intl", "Claude 系列", [
        ("claudefable51",   "Claude Fable 5.1"),
        ("claudefable5",    "Claude Fable 5"),
        ("claudehaiku55",   "Claude Haiku 5.5"),
        ("claudehaiku45",   "Claude Haiku 4.5"),
        ("claudeopus55",    "Claude Opus 5.5"),
        ("claudeopus5",     "Claude Opus 5"),
        ("claudesonnet5",   "Claude Sonnet 5"),
    ]),
    ("intl", "Gemini 全系列", []),      # 前缀 gemini 自动
    ("intl", "GPT 全系列",   []),       # 前缀 gpt 自动
    ("cn",   "DeepSeek", [
        ("deepseekv41flash", "DeepSeek V4.1 Flash"),
        ("deepseekv4pro",    "DeepSeek V4 Pro"),
    ]),
    ("cn",   "Kimi", [
        ("kimik3",      "KIMI K3"),
        ("kimik31pro",  "KIMI K3.1 Pro"),
    ]),
    ("cn",   "GLM (智谱)", [
        ("glm53",       "GLM 5.3"),
        ("glm53flash",  "GLM 5.3 Flash"),
    ]),
    ("cn",   "Qwen (通义)", [
        ("qwen38max",   "Qwen 3.8 MAX"),
    ]),
    ("cn",   "MiniMax", [
        ("minimaxm2",       "MiniMax M2"),
        ("minimaxm31flash", "MiniMax M3.1 Flash"),
    ]),
]
WATCH_KEYS = {k for _, _, items in WATCH for k, _ in items}

VENDOR_RULES = [
    ("claude",   "Anthropic"), ("gemini", "Google"), ("gpt", "OpenAI"), ("o1", "OpenAI"),
    ("o3", "OpenAI"), ("o4", "OpenAI"), ("deepseek", "DeepSeek"), ("kimi", "Moonshot"),
    ("glm", "Z.ai (智谱)"), ("qwen", "Alibaba (通义)"), ("minimax", "MiniMax"),
    ("grok", "xAI"), ("llama", "Meta"), ("mistral", "Mistral"), ("doubao", "字节跳动"),
    ("hunyuan", "腾讯"), ("ernie", "百度"), ("command", "Cohere"), ("hy4", "腾讯"),
]
CN_VENDORS = {"DeepSeek", "Moonshot", "Z.ai (智谱)", "Alibaba (通义)", "MiniMax", "字节跳动", "腾讯", "百度"}

KIND_RULES = [
    ("embedding", "向量"), ("rerank", "重排序"), ("whisper", "语音识别"),
    ("transcription", "语音识别"), ("tts", "语音合成"), ("speech", "语音合成"),
    ("audio", "音频"),
    ("image", "图像生成"), ("dall", "图像生成"), ("imagen", "图像生成"),
    ("sdxl", "图像生成"), ("flux", "图像生成"),
    ("video", "视频"), ("sora", "视频"), ("veo", "视频"), ("kling", "视频"),
    ("seedance", "视频"), ("runway", "视频"),
    ("moderation", "审核"),
]


def vendor_of(loose: str) -> str:
    for pre, v in VENDOR_RULES:
        if loose.startswith(pre):
            return v
    return "其他"


# 各源 provider 原始写法 -> 规范厂商名（只在 vendor_of 认不出时兜底）
VENDOR_DISPLAY = {
    "openai": "OpenAI", "anthropic": "Anthropic", "google": "Google",
    "deepseek": "DeepSeek", "deepseek ai": "DeepSeek", "deepseek-ai": "DeepSeek",
    "qwen": "Alibaba (通义)", "alibaba": "Alibaba (通义)", "tongyi": "Alibaba (通义)",
    "z.ai": "Z.ai (智谱)", "z-ai": "Z.ai (智谱)", "zai": "Z.ai (智谱)", "zhipu": "Z.ai (智谱)",
    "moonshot": "Moonshot", "moonshotai": "Moonshot", "moonshot ai": "Moonshot",
    "minimax": "MiniMax", "minimaxai": "MiniMax",
    "x-ai": "xAI", "xai": "xAI", "meta": "Meta Llama", "meta-llama": "Meta Llama",
    "mistralai": "Mistral AI", "mistral": "Mistral AI",
    "bytedance": "字节跳动", "bytedance-seed": "字节跳动",
    "tencent": "腾讯", "baidu": "百度", "nvidia": "NVIDIA",
}


def kind_of(loose: str, modality: str) -> str:
    """按「输出模态」判类型：text+image->text 仍算文本模型，避免把多模态文本模型
    误判成图像生成（说明书默认视图只显示文本模型，误判会让 GPT/Gemini 消失）。"""
    m = (modality or "").lower()
    for kw, k in KIND_RULES:
        if kw in loose:
            return k
    if "embedding" in m or "retrieval" in m:
        return "向量"
    if "rerank" in m:
        return "重排序"
    if "transcription" in m:
        return "语音识别"
    if "speech" in m:
        return "语音合成"
    out = m.split("->")[-1] if "->" in m else m
    if "video" in out:
        return "视频"
    if "image" in out:
        return "图像生成"
    if "audio" in out:
        return "音频"
    if "text" in out:
        return "文本"
    for kw, k in KIND_RULES:          # 兜底：无方向信息时再看一次模态串
        if kw in m:
            return k
    return "文本"


def r6(x):
    return None if x is None else round(float(x), 8)   # 保留足够精度，避免与库中值产生伪差异


def gv(row, key, default=None):
    """兼容旧库：列不存在时返回默认值。"""
    try:
        return row[key]
    except (IndexError, KeyError):
        return default


def tokenkey(s):
    """语序不敏感的匹配键：拆分 token 后排序拼接。
    解决 `Claude-5-fable`（上传）与 `claude-fable-5`（站内）这类语序差异。
    必须与 web/parsers.js 的 TKEY() 保持一致。"""
    s = re.sub(r"(\d)p(\d)", r"\1.\2", str(s).lower())
    s = re.sub(r"[/:：]+", " ", s)
    toks = [t for t in re.split(r"[^a-z0-9.]+", s) if t]
    return "|".join(sorted(toks))


def main():
    load_official()
    load_fx()
    if not os.path.exists(DB):
        print("DB 不存在，请先运行 collect.py", file=sys.stderr)
        return 1
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    c = con.cursor()

    dates = [r[0] for r in c.execute("SELECT DISTINCT snapshot_date FROM prices ORDER BY snapshot_date")]
    if not dates:
        print("无数据", file=sys.stderr)
        return 1
    latest = dates[-1]

    # ---------- 最新版本：按 loose 聚合 ----------
    rows = c.execute("""SELECT * FROM prices WHERE snapshot_date=? ORDER BY loose, source, input""", (latest,)).fetchall()
    groups = defaultdict(lambda: {"by_source": {}, "names": {}, "vendors": {}, "modality": "", "alias": set()})
    for r in rows:
        g = groups[r["loose"]]
        g["names"].setdefault(r["source"], r["model_name"] or r["model_id"])
        # 收集全部别名（各源 model_id / family / 显示名），供上传文件做模糊匹配
        for a in (r["model_id"], r["family"], r["model_name"]):
            if a:
                g["alias"].add(str(a))
        g["vendors"][r["provider"] or vendor_of(r["loose"])] = 1
        if r["modality"]:
            g["modality"] = r["modality"]
        src = r["source"]
        cur = g["by_source"].get(src)
        rec = dict(
            model_id=r["model_id"], name=r["model_name"], family=r["family"],
            version=r["version"] or "", variant=r["variant"] or "",
            input=r6(r["input"]), output=r6(r["output"]),
            cache_read=r6(r["cache_read"]), cache_write=r6(r["cache_write"]),
            list_input=r6(r["list_input"]), list_output=r6(r["list_output"]),
            discount=r6(r["discount"]), context=r["context"],
            unit=gv(r, "unit", "token") or "token",
            unit_price=r6(gv(r, "unit_price")),
            list_unit_price=r6(gv(r, "list_unit_price")),
            unit_discount=r6(gv(r, "unit_discount")),
        )
        if cur is None:
            g["by_source"][src] = {"best": rec, "versions": [rec]}
        else:
            g["by_source"][src]["versions"].append(rec)
            # 代表价 = input 最低的可用版本（input 都为空则比 output）
            def key(x):
                return (x["input"] if x["input"] is not None else 1e18)
            if key(rec) < key(cur["best"]):
                g["by_source"][src]["best"] = rec

    models = []
    for loose, g in groups.items():
        by_src = g["by_source"]
        if not by_src:
            continue
        # 主显示名：优先 OpenRouter 命名（用户要求：标注不清以 OpenRouter 为准）
        disp = (g["names"].get("openrouter") or g["names"].get("wokey")
                or g["names"].get("fireworks") or g["names"].get("cheaperinference")
                or g["names"].get("siliconflow") or loose)
        disp = re.sub(r"^[^:]{1,24}:\s*", "", disp).strip()   # 去掉 "DeepSeek: " 这类前缀
        vendor = vendor_of(loose)
        if vendor == "其他":
            for v in g["vendors"]:
                if v and v != "其他":
                    vendor = VENDOR_DISPLAY.get(str(v).strip().lower(), str(v).strip())
                    break
        prices = {}
        vals_in, vals_out = [], []
        kind = kind_of(loose, g["modality"])
        for s in ("openrouter", "fireworks", "wokey", "cheaperinference", "siliconflow"):
            if s not in by_src:
                continue
            b = by_src[s]["best"]
            # 旧数据兼容：媒体模型的 token 价若是 0（实际是按张/秒计价），不要当免费
            if kind != "文本" and (b.get("unit") or "token") == "token" \
                    and b["input"] == 0 and b["output"] in (0, None):
                b = dict(b, input=None, output=None)
                by_src[s]["best"] = b
            prices[s] = dict(b, versions=by_src[s]["versions"])
            if b["input"] is not None:  vals_in.append(b["input"])
            if b["output"] is not None: vals_out.append(b["output"])
        nver = sum(len(v["versions"]) for v in by_src.values())
        has_media = any((it.get("unit") or "token") != "token" and it.get("unit_price") is not None
                        for p in prices.values() for it in (p.get("versions") or [p]))

        # ---- 模型官网价格：官方 > 自动抓取 > OpenRouter 兜底 ----
        off = OFFICIAL.get(loose)
        if off and off.get("input") is not None:
            official = dict(
                input=r6(off.get("input")), output=r6(off.get("output")),
                cache_read=r6(off.get("cache_read")), cache_write=r6(off.get("cache_write")),
                src="official", model=off.get("model") or disp,
                url=off.get("url"), checked=off.get("checked"), note=off.get("note"),
            )
        elif "openrouter" in prices:
            b = prices["openrouter"]
            official = dict(
                input=b["input"], output=b["output"],
                cache_read=b.get("cache_read"), cache_write=b.get("cache_write"),
                src="openrouter", model=b.get("name") or disp,
                url="https://openrouter.ai/models", checked=latest,
                note="未检索到厂商官网价，采用 OpenRouter 发布价",
            )
        else:
            official = None

        # 语序不敏感的匹配键集合（来自显示名 + 各源别名）
        keys = {tokenkey(disp)}
        for a in g["alias"]:
            k = tokenkey(a)
            if k:
                keys.add(k)

        models.append(dict(
            loose=loose, name=disp, vendor=vendor,
            keys=sorted(keys),
            region="cn" if vendor in CN_VENDORS else "intl",
            kind=kind,
            sources=list(prices.keys()), n_src=len(prices), n_ver=nver,
            prices=prices, official=official,
            has_media=has_media,
            min_input=(min(vals_in) if vals_in else None),
            max_input=(max(vals_in) if vals_in else None),
            min_output=(min(vals_out) if vals_out else None),
            max_output=(max(vals_out) if vals_out else None),
            watch=(loose in WATCH_KEYS),
        ))

    models.sort(key=lambda m: (not m["watch"], -m["n_src"], m["loose"]))

    # ---------- 媒体价格（按张/秒/步/… 计价，独立于 token） ----------
    media_map = {}
    for m in models:
        for sid, p in m["prices"].items():
            for it in (p.get("versions") or [p]):
                u = it.get("unit") or "token"
                if u == "token" or it.get("unit_price") is None:
                    continue
                key = (m["loose"], sid, u)
                rec = dict(
                    loose=m["loose"], name=m["name"], vendor=m["vendor"], kind=m["kind"],
                    source=sid, unit=u, price=r6(it.get("unit_price")),
                    list_price=r6(it.get("list_unit_price")), discount=r6(it.get("unit_discount")),
                    model_id=it.get("model_id"), context=it.get("context"),
                    version=it.get("version") or "",
                )
                cur = media_map.get(key)
                if cur is None or (rec["price"] is not None
                                   and (cur["price"] is None or rec["price"] < cur["price"])):
                    media_map[key] = rec
    media = sorted(media_map.values(),
                   key=lambda x: (x["name"].lower(), x["unit"],
                                  x["price"] if x["price"] is not None else 1e18))

    # ---------- 历史序列 ----------
    hist_rows = c.execute(
        "SELECT snapshot_date, source, loose, input, output, cache_read, list_input FROM prices "
        "WHERE snapshot_date>=? ORDER BY snapshot_date", (dates[max(0, len(dates) - 120)],)).fetchall()
    hist_daily = defaultdict(lambda: defaultdict(dict))       # date -> source -> loose -> price
    for r in hist_rows:
        d = hist_daily[r["snapshot_date"]][r["source"]]
        prev = d.get(r["loose"])
        cur = r["input"] if r["input"] is not None else None
        if prev is None or (cur is not None and cur < prev):
            d[r["loose"]] = cur
    history = {
        "dates": sorted(hist_daily.keys()),
        "series": {d: {s: dict(v) for s, v in srcs.items()} for d, srcs in hist_daily.items()},
    }

    # 每个源只取当天最后一次运行的记录（同日重复运行时会积累多条 runs）
    runs = [dict(r) for r in c.execute(
        "SELECT source,status,raw_count,kept,message,run_at FROM runs r "
        "WHERE snapshot_date=? AND id=(SELECT MAX(id) FROM runs r2 "
        "WHERE r2.source=r.source AND r2.snapshot_date=r.snapshot_date)", (latest,))]

    payload = dict(
        generated=datetime.now().isoformat(timespec="seconds"),
        latest=latest, dates=dates,
        sources=SOURCES, fx=FX,
        watch=[dict(region=reg, group=grp, items=[dict(loose=k, name=n) for k, n in items])
               for reg, grp, items in WATCH],
        models=models,
        media=media,
        history=history,
        runs=runs,
        stats=dict(total=len(models), media=len(media), by_source={
            r["source"]: r["n"] for r in c.execute(
                "SELECT source,COUNT(*) n FROM prices WHERE snapshot_date=? GROUP BY source", (latest,))}),
        official_meta=dict(
            OFFICIAL_META,
            n_official=sum(1 for m in models if m["official"] and m["official"]["src"] == "official"),
            n_fallback=sum(1 for m in models if m["official"] and m["official"]["src"] == "openrouter"),
            n_none=sum(1 for m in models if not m["official"]),
        ),
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    # ---- 打包成自包含 index.html（双击即可离线打开）----
    W = os.path.dirname(OUT)
    tpl = open(os.path.join(W, "template.html"), encoding="utf-8").read()
    css = open(os.path.join(W, "style.css"), encoding="utf-8").read()
    js = (open(os.path.join(W, "parsers.js"), encoding="utf-8").read() + "\n"
          + open(os.path.join(W, "llm.js"), encoding="utf-8").read() + "\n"
          + open(os.path.join(W, "app.js"), encoding="utf-8").read())
    data_js = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</script>", r"<\/script>")
    # ---- 内置 AI 密钥（可选）----
    # 存在 data/llm_key.json 时把密钥混淆后写进页面，打开即可直接用 AI 功能。
    # 混淆只是为了让明文不出现在源码里（防止被 grep / 顺手复制到别处），不构成安全边界：
    # 拿到这个 HTML 的人依然可以调用它。所以 llm_key.json 不入库、也不进 GitHub 包，
    # 公开版本请用 MODELPRICE_EMBED_KEY=0 生成。
    builtin = obf_key() if os.environ.get("MODELPRICE_EMBED_KEY", "1") != "0" else None
    if builtin:
        print(f"  内置 AI 密钥：{builtin['mask']}（{builtin['provider']} / {builtin['model']}）")
    else:
        print("  内置 AI 密钥：无（未配置 data/llm_key.json 或已用 MODELPRICE_EMBED_KEY=0 关闭）")
    key_js = json.dumps(builtin, ensure_ascii=False, separators=(",", ":")) if builtin else "null"

    # 不能用 str.replace：JS/CSS 里的 "$'"、"$&" 会被当成反向引用展开，导致 HTML 尾部被灌进脚本
    def sub_once(s, token, val):
        i = s.find(token)
        return s if i < 0 else s[:i] + val + s[i + len(token):]

    html = tpl
    for token, val in (("/*__CSS__*/", css), ("/*__JS__*/", js),
                       ("/*__DATA__*/", data_js),
                       # 连着 null 一起替换，否则会留下多余的 "null;"
                       ("/*__BUILTIN_KEY__*/ null", key_js)):
        html = sub_once(html, token, val)
    idx = os.path.join(W, "index.html")
    with open(idx, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"生成 {idx}  {os.path.getsize(idx)/1024:.0f} KB (自包含)")

    kb = os.path.getsize(OUT) / 1024
    print(f"生成 {OUT}  {kb:.0f} KB")
    print(f"  模型组 {len(models)} | 日期 {len(dates)} | 关注 {len(WATCH_KEYS)}")
    print(f"  各源条数: {payload['stats']['by_source']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
