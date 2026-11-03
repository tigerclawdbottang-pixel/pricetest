#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GPU 快照导出：把 gpu-radar 的 SQLite 导出成 data/gpu_snapshot.json，
供 build_site.py 合进 Token Market Insight 的静态 payload。

用法：
    python3 scripts/collect_gpu.py
    GPU_RADAR_DB=/path/to/gpu_radar.db python3 scripts/collect_gpu.py

找不到数据库时只打印警告并退出 0（构建照常进行，GPU 栏目显示空状态）。
"""
import json
import os
import sqlite3
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "gpu_snapshot.json")
DEFAULT_DB = os.path.expanduser("~/Documents/TAI/gpu-radar/backend/gpu_radar.db")

LISTING_COLS = ("id", "platform", "instance_id", "gpu_model", "gpu_count", "vram_gb",
                "price_per_hour", "location", "direct_url", "available_stock",
                "created_at", "updated_at")
LEAD_COLS = ("id", "source_platform", "poster_name", "post_text", "extracted_gpu_model",
             "extracted_gpu_count", "extracted_price_desc", "contact_info",
             "direct_url", "raw_json_data", "created_at")


def _iso(v):
    """SQLite 存的是 naive UTC（'2026-11-03 14:22:39.98'），转成 ISO 让前端补 Z。"""
    if not v:
        return v
    s = str(v).replace(" ", "T")
    return s


def _rows(con, table, cols, order):
    have = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
    if not have:
        return []
    sel = [c for c in cols if c in have]
    sql = f"SELECT {', '.join(sel)} FROM {table} ORDER BY {order}"
    out = []
    for r in con.execute(sql):
        d = dict(zip(sel, r))
        for k in ("created_at", "updated_at"):
            if k in d:
                d[k] = _iso(d[k])
        out.append(d)
    return out


def main():
    db = os.environ.get("GPU_RADAR_DB") or DEFAULT_DB
    if not os.path.exists(db):
        print(f"  跳过 GPU：未找到数据库 {db}", file=sys.stderr)
        print("           可用 GPU_RADAR_DB 指定路径", file=sys.stderr)
        return 0

    con = sqlite3.connect(db)
    try:
        listings = _rows(con, "gpu_standard_listings", LISTING_COLS, "price_per_hour ASC")
        leads = _rows(con, "gpu_social_leads", LEAD_COLS, "created_at DESC")
    except sqlite3.DatabaseError as e:
        print(f"  跳过 GPU：数据库读取失败 {e}", file=sys.stderr)
        return 0
    finally:
        con.close()

    if not listings and not leads:
        print("  跳过 GPU：数据库里没有数据（先跑一次后端采集）", file=sys.stderr)
        return 0

    platforms = sorted({r["platform"] for r in listings if r.get("platform")})
    social_platforms = sorted({r["source_platform"] for r in leads if r.get("source_platform")})
    updated = [r.get("updated_at") for r in listings if r.get("updated_at")]
    created = [r.get("created_at") for r in leads if r.get("created_at")]

    payload = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "source_db": db,
        "listings": listings,
        "leads": leads,
        "platforms": platforms,
        "social_platforms": social_platforms,
        "last_collected_at": max(updated) if updated else None,
        "latest_lead_at": max(created) if created else None,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"生成 {OUT}  {os.path.getsize(OUT) / 1024:.0f} KB")
    print(f"  云资源 {len(listings)} 条 / {len(platforms)} 平台 | 社媒线索 {len(leads)} 条 / {len(social_platforms)} 渠道")
    return 0


if __name__ == "__main__":
    sys.exit(main())
