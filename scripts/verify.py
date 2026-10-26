#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent C — 每日复核
1) 比对当日采集价与前一日快照，发现价格异动
2) 校验 Agent B 发布价(data.json) 与 Agent A 采集价(DB) 是否一致
3) 校验数据自洽性：折扣率 / 缓存价合理性 / 源采集量骤降
4) 生成报告 + 待联网核对清单，写入 alerts 表与 reports/
"""
import json, os, sqlite3, sys
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "prices.db")
DATA = os.path.join(ROOT, "web", "data.json")
REPORTS = os.path.join(ROOT, "reports")
os.makedirs(REPORTS, exist_ok=True)

SRC_LABEL = {"openrouter": "OpenRouter", "fireworks": "Fireworks",
             "wokey": "Wokey", "cheaperinference": "CheaperInference",
             "siliconflow": "硅基流动 SiliconFlow"}
# 异动阈值：相对变化 >30% 或 绝对变化 > 0.5 USD/M，视为显著
REL_T, ABS_T = 0.30, 0.5


def pct(old, new):
    if old in (None, 0) or new is None:
        return None
    return (new - old) / old


def main():
    if not os.path.exists(DB):
        print("无数据库", file=sys.stderr); return 1
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    c = con.cursor()
    dates = [r[0] for r in c.execute("SELECT DISTINCT snapshot_date FROM prices ORDER BY snapshot_date")]
    today = dates[-1]
    prev = dates[-2] if len(dates) >= 2 else None

    alerts = []     # dicts: level, kind, source, model, field, old, new, msg

    # ---------- 1. 日环比异动 ----------
    if prev:
        cur = {(r["source"], r["model_id"]): r for r in
               c.execute("SELECT * FROM prices WHERE snapshot_date=?", (today,))}
        old = {(r["source"], r["model_id"]): r for r in
               c.execute("SELECT * FROM prices WHERE snapshot_date=?", (prev,))}
        for k, r in cur.items():
            o = old.get(k)
            if not o:
                alerts.append(dict(level="info", kind="新增", source=r["source"],
                                   model=r["model_id"], field="", old=None, new=None,
                                   msg="新上架模型"))
                continue
            for fld in ("input", "output", "cache_read"):
                a, b = o[fld], r[fld]
                if a is None or b is None:
                    if (a is None) != (b is None):
                        alerts.append(dict(level="warn", kind="字段缺失", source=r["source"],
                                           model=r["model_id"], field=fld, old=a, new=b,
                                           msg=f"{fld} 由 {'有' if a is not None else '无'} 变为 {'有' if b is not None else '无'}"))
                    continue
                p = pct(a, b)
                if p is None:
                    continue
                if abs(p) >= REL_T or abs(b - a) >= ABS_T:
                    alerts.append(dict(level="high" if abs(p) >= 0.6 else "warn",
                                       kind="价格异动", source=r["source"], model=r["model_id"],
                                       field=fld, old=a, new=b,
                                       msg=f"{fld} {a} → {b} ({p*100:+.1f}%)"))
        gone = set(old) - set(cur)
        for k in list(gone)[:200]:
            alerts.append(dict(level="info", kind="下架", source=k[0], model=k[1],
                               field="", old=None, new=None, msg="模型不再出现"))
    else:
        alerts.append(dict(level="info", kind="基线", source="", model="", field="",
                           old=None, new=None, msg=f"首个快照 {today}，无历史可比对"))

    # ---------- 2. 发布价 vs 采集价一致性 ----------
    pub_issues = 0
    if os.path.exists(DATA):
        data = json.load(open(DATA, encoding="utf-8"))
        dbmap = {}
        for r in c.execute("SELECT source,loose,input,output FROM prices WHERE snapshot_date=?", (today,)):
            dbmap.setdefault((r["source"], r["loose"]), []).append((r["input"], r["output"]))
        for m in data["models"]:
            for sid, p in m["prices"].items():
                vals = dbmap.get((sid, m["loose"]))
                if not vals:
                    pub_issues += 1
                    alerts.append(dict(level="high", kind="发布不一致", source=sid, model=m["loose"],
                                       field="", old=None, new=None,
                                       msg="页面有价但库中无对应记录"))
                    continue
                def close(a, b):
                    if a is None or b is None: return False
                    return abs(a - b) <= 1e-9 or abs(a - b) / max(abs(a), 1e-12) < 1e-6
                if p["input"] is not None and not any(close(v[0], p["input"]) for v in vals):
                    pub_issues += 1
                    alerts.append(dict(level="high", kind="发布不一致", source=sid, model=m["loose"],
                                       field="input", old=p["input"],
                                       new=min((v[0] for v in vals if v[0] is not None), default=None),
                                       msg="页面发布价与采集价不一致"))
        if data.get("latest") != today:
            pub_issues += 1
            alerts.append(dict(level="high", kind="发布过期", source="", model="", field="",
                               old=data.get("latest"), new=today,
                               msg="data.json 未包含今日快照，需重新 build"))

    # ---------- 3. 数据自洽性 ----------
    for r in c.execute("SELECT * FROM prices WHERE snapshot_date=?", (today,)):
        li, inp, dis = r["list_input"], r["input"], r["discount"]
        if li and inp is not None and dis is not None:
            calc = (1 - inp / li) * 100 if li else None
            if calc is not None and abs(calc - dis) > 1.5 and li > 0:
                alerts.append(dict(level="warn", kind="折扣不自洽", source=r["source"],
                                   model=r["model_id"], field="discount", old=dis, new=round(calc, 2),
                                   msg=f"标注折扣 {dis}% 但按官方价算应为 {calc:.1f}%"))
        if r["cache_read"] is not None and r["input"] is not None and r["cache_read"] > r["input"] * 1.001:
            alerts.append(dict(level="warn", kind="缓存价异常", source=r["source"],
                               model=r["model_id"], field="cache_read", old=r["input"], new=r["cache_read"],
                               msg="缓存命中价高于输入价，通常不合理"))

    # ---------- 3.5 官网价格检查 ----------
    off_all = {}
    for p in (os.path.join(ROOT, "data", "official_prices.json"),
              os.path.join(ROOT, "data", "official_auto.json")):
        if not os.path.exists(p):
            continue
        try:
            j = json.load(open(p, encoding="utf-8"))
            off_all.update(j.get("prices") or {})
        except Exception as e:
            alerts.append(dict(level="warn", kind="官网价读取失败", source="", model=os.path.basename(p),
                               field="", old=None, new=None, msg=str(e)))
    today_d = datetime.now().date()
    stale = []
    for k, v in off_all.items():
        ck = v.get("checked")
        if not ck:
            continue
        try:
            d = datetime.strptime(str(ck)[:10], "%Y-%m-%d").date()
        except Exception:
            continue
        if (today_d - d).days > 30:
            stale.append((k, str(ck)[:10], (today_d - d).days))
    if stale:
        alerts.append(dict(level="warn", kind="官网价过期", source="", model=f"{len(stale)} 个模型",
                           field="checked", old=None, new=None,
                           msg="官网价超过 30 天未核对：" + "、".join(f"{k}({d})" for k, d, _ in stale[:8])
                               + ("…" if len(stale) > 8 else "")))
    # 源价显著高于官网价（聚合市场通常应低于或等于官网价）
    over = []
    for k, v in off_all.items():
        oi = v.get("input")
        if oi is None:
            continue
        for r in c.execute("SELECT source,model_id,input FROM prices WHERE snapshot_date=? AND loose=?",
                           (today, k)):
            if r["input"] is None:
                continue
            if r["input"] > oi * 1.5:
                over.append((k, r["source"], round(r["input"], 4), round(oi, 4)))
    for k, s, pv, ov in over[:12]:
        alerts.append(dict(level="warn", kind="源价高于官网价", source=s, model=k, field="input",
                           old=ov, new=pv, msg=f"{s} 输入价 {pv} 高于官网价 {ov}（+{(pv/ov-1)*100:.0f}%）"))

    # ---------- 4. 采集量骤降 / 源失败 ----------
    for r in c.execute("SELECT * FROM runs WHERE snapshot_date=?", (today,)):
        if r["status"] != "ok":
            alerts.append(dict(level="high", kind="采集失败", source=r["source"], model="", field="",
                               old=None, new=None, msg=r["message"] or "采集失败"))
    if prev:
        for s in SRC_LABEL:
            n1 = c.execute("SELECT COUNT(*) FROM prices WHERE snapshot_date=? AND source=?", (today, s)).fetchone()[0]
            n0 = c.execute("SELECT COUNT(*) FROM prices WHERE snapshot_date=? AND source=?", (prev, s)).fetchone()[0]
            if n0 and n1 < n0 * 0.7:
                alerts.append(dict(level="high", kind="采集量骤降", source=s, model="", field="",
                                   old=n0, new=n1, msg=f"模型数由 {n0} 降至 {n1}（-{100*(n0-n1)/n0:.0f}%）"))

    # ---------- 4.5 库行数 vs 最新一次采集 ----------
    # 同日重跑时 INSERT OR REPLACE 不会删除已下架模型；这里能发现「库比 kept 多」的残留。
    for r in c.execute("""SELECT source, kept FROM runs WHERE id IN
                          (SELECT MAX(id) FROM runs WHERE snapshot_date=? GROUP BY source)""",
                       (today,)):
        n = c.execute("SELECT COUNT(*) FROM prices WHERE snapshot_date=? AND source=?",
                      (today, r["source"])).fetchone()[0]
        if r["kept"] is not None and n != r["kept"]:
            alerts.append(dict(level="high", kind="库行数不一致", source=r["source"], model="",
                               field="", old=r["kept"], new=n,
                               msg=f"最新一次采集 kept={r['kept']}，但库中当日 {n} 行（疑似同日重跑残留）"))

    # ---------- 落库 ----------
    now = datetime.now().isoformat(timespec="seconds")
    con.execute("DELETE FROM alerts WHERE snapshot_date=?", (today,))   # 同日重跑不重复堆积
    for a in alerts:
        dp = None
        if a["old"] not in (None,) and a["new"] not in (None,) and isinstance(a["old"], (int, float)) \
                and isinstance(a["new"], (int, float)) and a["old"]:
            dp = round((a["new"] - a["old"]) / a["old"] * 100, 2)
        con.execute("""INSERT INTO alerts(detected_at,snapshot_date,source,family,model_id,field,
                       old_value,new_value,delta_pct,severity,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (now, today, a["source"], a["model"], a["model"], a["field"],
                     a["old"] if isinstance(a["old"], (int, float)) else None,
                     a["new"] if isinstance(a["new"], (int, float)) else None,
                     dp, a["level"], a["msg"]))
    con.commit()

    # ---------- 报告 ----------
    hi = [a for a in alerts if a["level"] == "high"]
    wn = [a for a in alerts if a["level"] == "warn"]
    inf = [a for a in alerts if a["level"] == "info"]
    L = []
    L.append(f"# 模型价格每日复核报告 — {today}\n")
    L.append(f"生成时间：{now}　|　快照日期：{today}" + (f"（对比基准：{prev}）" if prev else "（首个快照）"))
    L.append(f"\n## 结论\n\n- 高优先级 **{len(hi)}** 项 / 警告 **{len(wn)}** 项 / 信息 **{len(inf)}** 项")
    L.append(f"- 发布价与采集价一致性问题：**{pub_issues}** 项")
    L.append("- " + ("**需要人工/联网核对**：见下方「待核对清单」" if hi else "未发现需要核对的重大差异"))

    def dump(title, items, limit=40):
        if not items:
            return f"\n## {title}\n\n无。\n"
        s = f"\n## {title}（{len(items)} 项）\n\n| 级别 | 类型 | 源 | 模型 | 说明 |\n|---|---|---|---|---|\n"
        for a in items[:limit]:
            s += f"| {a['level']} | {a['kind']} | {SRC_LABEL.get(a['source'], a['source'])} | `{a['model']}` | {a['msg']} |\n"
        if len(items) > limit:
            s += f"\n_（仅显示前 {limit} 项，共 {len(items)} 项）_\n"
        return s
    L.append(dump("高优先级差异（需联网核对）", hi))
    L.append(dump("警告", wn))
    L.append(dump("信息", inf, 15))

    todo = hi[:20]
    L.append("\n## 待核对清单\n")
    if todo:
        L.append("对以下条目，搜索官网/官方定价页确认真实价格：\n")
        for i, a in enumerate(todo, 1):
            L.append(f"{i}. **{SRC_LABEL.get(a['source'], a['source'])}** `{a['model']}` — {a['msg']}")
    else:
        L.append("无。\n")

    rpt = os.path.join(REPORTS, f"{today}.md")
    open(rpt, "w", encoding="utf-8").write("\n".join(L))
    with open(os.path.join(REPORTS, "latest.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))
    con.close()

    print(f"[Agent C] {today}: 高 {len(hi)} / 警 {len(wn)} / 信息 {len(inf)}；报告 {rpt}")
    for a in hi[:12]:
        print(f"   [HIGH] {SRC_LABEL.get(a['source'],a['source']):16} {a['model'][:38]:38} {a['msg']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
