#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""威尼斯 / NEAR 两个网关采集器解析逻辑离线回归测试。
用与官网同结构的 markdown/HTML 片段做 fixture（沙箱无法联网），验证列检测 + 行解析。
用法：python3 scripts/test_gateway_parsers.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect as C

pass_n = fail_n = 0
def ok(name, cond, extra=None):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print("  ✓ " + name)
    else:
        fail_n += 1
        print("  ✗ " + name + ("" if extra is None else "   → " + str(extra)[:160]))

VENICE_MD = """# Pricing
Prices per 1M tokens unless noted. All prices in USD.

| Model | ID | Input Price | Output Price | Cache Read | Cache Write | Context | Privacy |
|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 | $0.50 | $0.01 | $0.125 | 1000K | Anonymized |
| Claude Opus 4.5 | `claude-opus-4-5` | $5.00 | $25.00 | $0.50 | $6.25 | 198K | Anonymized |
| Aion 3.5 Mini | `aion-labs-aion-3-5-mini` | $0.875 | $1.75 | $0.225 | - | 262K | Anonymized |
↳ >100K Context | | $0.50 | $2.50 | $0.05 | $0.625 | | |
| Unpriced Placeholder | `some-model` | - | - | - | - | - | - |
"""

NEAR_MD = """## Pricing

| Model | Context | $/M input | $/M output |
|-------|---------|-----------|------------|
| Claude Opus 4.6 * | 200K | $5.00 | $25.00 |
| DeepSeek V3.1 | 128K | $1.05 | $3.10 |
| GPT OSS 120B | 131K | $0.15 | $0.55 |
"""

NEAR_MD2 = """| Model Name | Provider | Input | Output | Cache read | Context | Privacy tier |
|---|---|---|---|---|---|---|
| Claude Sonnet 4.5 | anthropic | $3.00 | $15.50 | $0.30 | 200K | Anonymized |
| GLM 5 | zai-org | $0.85 | $3.30 | $0.085 | 203K | TEE |
"""

print("\n=== Venice markdown ===")
vt = C._md_tables(VENICE_MD)
ok("识别出 1 张表", len(vt) == 1, len(vt))
header, rows = vt[0]
ok("表头 8 列", len(header) == 8, header)
vrows = C._gateway_rows(vt, "venice")
ok("解析出 3 个模型（跳过档位续行）", len(vrows) == 3, [r["model_name"] for r in vrows])
a = vrows[0]
ok("第一个是 claude-haiku-5-5", a["model_id"] == "claude-haiku-5-5", a["model_id"])
ok("  input=0.10", a["input"] == 0.10, a["input"])
ok("  cache_read=0.01", a["cache_read"] == 0.01, a["cache_read"])
ok("  cache_write=0.125", a["cache_write"] == 0.125, a["cache_write"])
ok("  context=1000000", a["context"] == 1000000, a["context"])
b = vrows[1]
ok("Opus cache_write=6.25", b["cache_write"] == 6.25, b["cache_write"])
c = vrows[2]
ok("Aion cache_write=None（-）", c["cache_write"] is None, c["cache_write"])
ok("family 归一（aion-labs-aion-3-5-mini）",
   C.loose_key(c["family"]) == C.loose_key("aion-labs-aion-3-5-mini"), c["family"])

print("\n=== NEAR markdown（简单表头） ===")
nt = C._md_tables(NEAR_MD)
nrows = C._gateway_rows(nt, "nearai")
ok("解析出 3 个模型", len(nrows) == 3, [r["model_name"] for r in nrows])
n0 = nrows[0]
ok("匿名化星号被去掉", n0["model_name"] == "Claude Opus 4.6", n0["model_name"])
ok("  input=5.0 output=25.0", n0["input"] == 5.0 and n0["output"] == 25.0, (n0["input"], n0["output"]))
ok("  context=200000", n0["context"] == 200000, n0["context"])
ok("  family=claude-opus-4.6", n0["family"] == "claude-opus-4.6", n0["family"])

print("\n=== NEAR markdown（带 Provider/Cache read 表头） ===")
n2 = C._gateway_rows(C._md_tables(NEAR_MD2), "nearai")
ok("解析出 2 个模型", len(n2) == 2, [r["model_name"] for r in n2])
g = n2[0]
ok("Sonnet cache_read=0.30", g["cache_read"] == 0.30, g["cache_read"])
ok("  context=200000", g["context"] == 200000, g["context"])

print("\n=== HTML 兜底 ===")
HTML = "<table><thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead><tbody>" \
       "<tr><td>DeepSeek V4 Flash</td><td>$0.17</td><td>$0.35</td></tr></tbody></table>"
ht = C._html_tables(HTML)
ok("识别出 1 张 HTML 表", len(ht) == 1, len(ht))
hr = C._gateway_rows(ht, "nearai")
ok("HTML 解析出 1 个模型 input=0.17", len(hr) == 1 and hr[0]["input"] == 0.17,
   [(r["model_name"], r["input"]) for r in hr])

print(f"\n结果: {'❌ ' + str(fail_n) + ' 项失败' if fail_n else '✅ 全部通过'}  ({pass_n} passed, {fail_n} failed)\n")
sys.exit(1 if fail_n else 0)
