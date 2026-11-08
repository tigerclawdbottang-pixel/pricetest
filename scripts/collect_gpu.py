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

# 采集日志 gpu_raw_posts 的字段：它是社媒线索的权威源（最新、direct_url 为真实平台结构、
# 带 topic / 首次最近采集时间 / 完整原始载荷）。旧 gpu_social_leads 表作为回退。
RAW_POST_COLS = ("id", "url", "platform", "poster_name", "post_text", "topic",
                 "posted_at", "fetched_at", "is_offer", "first_seen_at", "last_seen_at",
                 "raw_json_data")


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


def _leads_from_raw_posts(con):
    """从采集日志 gpu_raw_posts 重建社媒供给线索。

    采集日志把每条帖（含非供给）都落了库，direct_url 是真实平台结构（非旧
    social.example.com），并带 topic / 首次最近采集时间 / 完整原始载荷。
    这里只保留 is_offer=True 的供给帖，并从 raw_json_data.extraction 还原
    extractor 提取结果，字段名对齐 gpu.js 的期望。

    返回 None 表示表不存在或没有供给帖，调用方应回退到旧 gpu_social_leads 表。
    """
    have = {r[1] for r in con.execute("PRAGMA table_info(gpu_raw_posts)")}
    if not have:
        return None
    rows = _rows(con, "gpu_raw_posts", RAW_POST_COLS, "posted_at DESC")
    leads = []
    for r in rows:
        if not r.get("is_offer"):
            continue
        ex = {}
        raw = r.get("raw_json_data")
        if raw:
            try:
                parsed = json.loads(raw) if isinstance(raw, str) else raw
                ex = parsed.get("extraction") or {}
            except (ValueError, TypeError):
                ex = {}
        leads.append({
            "id": r.get("id"),
            "source_platform": r.get("platform"),
            "poster_name": r.get("poster_name"),
            "post_text": r.get("post_text"),
            "extracted_gpu_model": ex.get("gpu_model"),
            "extracted_gpu_count": ex.get("gpu_count"),
            "extracted_price_desc": ex.get("price_per_hour"),
            "contact_info": ex.get("contact"),
            "direct_url": r.get("url"),
            "raw_json_data": raw,
            "topic": r.get("topic"),
            "posted_at": _iso(r.get("posted_at")),
            "fetched_at": _iso(r.get("fetched_at")),
            "first_seen_at": _iso(r.get("first_seen_at")),
            "last_seen_at": _iso(r.get("last_seen_at")),
        })
    return leads if leads else None


def main():
    db = os.environ.get("GPU_RADAR_DB") or DEFAULT_DB
    if not os.path.exists(db):
        print(f"  跳过 GPU：未找到数据库 {db}", file=sys.stderr)
        print("           可用 GPU_RADAR_DB 指定路径", file=sys.stderr)
        return 0

    con = sqlite3.connect(db)
    try:
        listings = _rows(con, "gpu_standard_listings", LISTING_COLS, "price_per_hour ASC")
        # 优先从采集日志 gpu_raw_posts 重建（最新、真实 URL、含采集时间/原始载荷）；
        # 表不存在或没有供给帖时回退到旧 gpu_social_leads 表。
        leads = _leads_from_raw_posts(con)
        if leads is None:
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
    # 重建出的线索没有 created_at，回退用 last_seen_at / posted_at 作为「最近线索」时间
    created = [r.get("created_at") or r.get("last_seen_at") or r.get("posted_at")
               for r in leads
               if (r.get("created_at") or r.get("last_seen_at") or r.get("posted_at"))]

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
