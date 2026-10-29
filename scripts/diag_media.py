#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断图片/视频/音频模型的原始计费字段（只读，不写库）。

用途：确认各源对非 token 计价模型（Seedance / Flux / Kling / Veo / Wan 等）
实际返回的字段名和价格单位，再把对应解析补进 collect.py。

运行：
    cd modelprice
    python3 scripts/diag_media.py > /tmp/media_diag.txt 2>&1
然后把 /tmp/media_diag.txt 发回来（或只贴 CI / OR / FW / SF / Wokey 各段）。
"""
import json
import re
import sys

import collect as C


def interesting(s):
    s = (s or "").lower()
    return any(k in s for k in (
        "seedance", "flux", "kling", "veo", "wan-", "hailuo", "sora", "imagen",
        "dall", "midjourney", "runway", "grok-imagine", "video", "image",
        "speech", "tts", "audio",
    ))


def brief(obj, n=1200):
    s = json.dumps(obj, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + " …(截断)"


def ci():
    print("\n" + "=" * 24 + " CheaperInference " + "=" * 24)
    html = C.fetch("https://platform.cheaperinference.com/markets")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    blob = ""
    for c in chunks:
        try:
            blob += json.loads('"' + c + '"')
        except Exception:
            blob += c
    idx = blob.find('"models":[')
    if idx < 0:
        print("未找到 models 数组")
        return
    data = json.loads(C._extract_json_array(blob, idx + len('"models":')))
    hits = [m for m in data
            if interesting(m.get("id")) or interesting(m.get("type")) or interesting(m.get("group"))]
    print(f"总模型 {len(data)}，媒体相关 {len(hits)}")
    keys = sorted({k for m in hits for k in m})
    print("媒体模型出现过的字段:", keys)
    for m in hits[:6]:
        print("-" * 60)
        print(brief(m))
    seed = [m for m in data if "seedance" in (m.get("id") or "").lower()]
    if seed:
        print("\nSeedance 原始对象:")
        for m in seed:
            print("-" * 60)
            print(brief(m, 1800))


def openrouter():
    print("\n" + "=" * 24 + " OpenRouter " + "=" * 24)
    data = json.loads(C.fetch("https://openrouter.ai/api/v1/models"))["data"]
    hits = [m for m in data
            if interesting(m.get("id")) or "image" in str(m.get("architecture", {})).lower()
            or "video" in str(m.get("architecture", {})).lower()]
    print(f"总模型 {len(data)}，媒体相关 {len(hits)}")
    pkeys = sorted({k for m in hits for k in (m.get("pricing") or {})})
    print("pricing 字段:", pkeys)
    for m in hits[:6]:
        print("-" * 60)
        print(brief({k: m.get(k) for k in ("id", "name", "pricing", "architecture")}))


def fireworks():
    print("\n" + "=" * 24 + " Fireworks " + "=" * 24)
    data = json.loads(C.fetch("https://app.fireworks.ai/api/models"))
    hits = [m for m in data
            if interesting(m.get("id")) or interesting(m.get("type"))
            or "image" in str(m.get("type", "")).lower()]
    print(f"总模型 {len(data)}，媒体相关 {len(hits)}")
    print("cost 字段:", sorted({k for m in data for k in ((m.get("cost") or {}).keys())}))
    for m in hits[:6]:
        print("-" * 60)
        print(brief(m))


def siliconflow():
    print("\n" + "=" * 24 + " SiliconFlow " + "=" * 24)
    html = C.fetch("https://www.siliconflow.cn/models")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    blob = ""
    for c in chunks:
        try:
            blob += json.loads('"' + c + '"')
        except Exception:
            blob += c
    idx = blob.find('"data":[{')
    if idx < 0:
        print("未找到 data 数组")
        return
    data = json.loads(C._extract_json_array(blob, idx + len('"data":')))
    print("priceUnit 取值:", sorted({m.get("priceUnit") for m in data}))
    hits = [m for m in data
            if (m.get("priceUnit") or "") != "/ M Tokens" or interesting(m.get("modelName"))]
    print(f"非 token / 媒体相关 {len(hits)}")
    for m in hits[:6]:
        print("-" * 60)
        print(brief(m))


def wokey():
    print("\n" + "=" * 24 + " Wokey " + "=" * 24)
    html = C.fetch("https://wokey.ai/models")
    m = re.search(r'<script id="wokey-models-page-data"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        print("未找到内嵌数据")
        return
    data = json.loads(m.group(1))["data"]
    meters = sorted({s.get("meter") for x in data for s in (x.get("pricing_skus") or [])})
    print("pricing_skus meter 取值:", meters)
    hits = [x for x in data if interesting(x.get("id")) or any(
        interesting(s.get("meter")) for s in (x.get("pricing_skus") or []))]
    print(f"媒体相关 {len(hits)}")
    for x in hits[:6]:
        print("-" * 60)
        print(brief(x))


if __name__ == "__main__":
    for fn in (ci, openrouter, fireworks, siliconflow, wokey):
        try:
            fn()
        except Exception as e:
            print(f"\n[FAIL] {fn.__name__}: {type(e).__name__}: {e}")
