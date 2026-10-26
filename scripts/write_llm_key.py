#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 LLM_KEY 环境变量写成 data/llm_key.json，供 build_site.py 内置进页面。

- 用于 GitHub Actions / 本地临时构建，避免把明文 Key 提交到 git。
- 没有 LLM_KEY 时删除该文件 → build_site 生成无密钥版本。
- 可选 LLM_PROVIDER / LLM_ENDPOINT / LLM_MODEL 覆盖默认 DeepSeek 配置。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "llm_key.json")

key = (os.environ.get("LLM_KEY") or "").strip()
if not key:
    try:
        os.remove(OUT)
    except FileNotFoundError:
        pass
    print("未设置 LLM_KEY：生成无密钥版本")
    sys.exit(0)

doc = {
    "provider": (os.environ.get("LLM_PROVIDER") or "deepseek").strip(),
    "endpoint": (os.environ.get("LLM_ENDPOINT")
                 or "https://api.deepseek.com/v1/chat/completions").strip(),
    "model": (os.environ.get("LLM_MODEL") or "deepseek-chat").strip(),
    "mode": "direct",
    "key": key,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, indent=2)
os.chmod(OUT, 0o600)
print(f"已写入 {OUT}（{doc['provider']} / {doc['model']}）")
