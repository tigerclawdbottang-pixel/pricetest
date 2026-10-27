#!/bin/bash
# 生成可分发包：单文件版 HTML + 完整项目 zip
# 用法: bash scripts/make_dist.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
D=$(date +%Y-%m-%d)
mkdir -p dist

# 清理探测临时文件
rm -f data/_probe*.json data/_*.json

# ---- 1. 单文件版：双击即开，零依赖 ----
cp web/index.html "dist/model价格比较-$D.html"

# ---- 2. 完整项目版：含采集脚本 / 数据库 / 说明，可自行跑每日更新 ----
ZIP="dist/modelprice-full-$D.zip"
rm -f "$ZIP"
zip -q -r "$ZIP" \
  README.md DEPLOY.md package.json \
  .github/workflows/pages.yml \
  web/index.html web/app.js web/parsers.js web/llm.js web/style.css web/template.html web/data.json \
  data/prices.db data/official_prices.json data/official_auto.json data/fx.json data/llm_key.example.json \
  scripts/collect.py scripts/fetch_official.py scripts/build_site.py scripts/verify.py scripts/write_llm_key.py \
  scripts/run_daily.sh scripts/smoke.js scripts/test_parsers.js scripts/test_official_col.js scripts/test_upload_match.js scripts/test_llm.js scripts/test_upload_tier.js scripts/test_ai_e2e.js scripts/test_media.py scripts/diag_media.py scripts/llm_proxy.py scripts/start_ai.command \
  scripts/fixtures/test.xlsx scripts/fixtures/test.docx \
  reports/latest.md \
  -x "*.DS_Store" "__pycache__/*" \
  2>/dev/null || true
# 注意：data/llm_key.json（真实密钥）刻意不进 full 包 —— full 包可能被转手，
# 内置密钥只存在于本地生成的 index.html / 单文件版里。

echo "=== 分发包已生成 ==="
ls -lh "dist/model价格比较-$D.html" "$ZIP" | awk '{print "  "$5"\t"$9}'
if grep -q 'const BUILTIN_KEY = {' "dist/model价格比较-$D.html" 2>/dev/null; then
  echo
  echo "⚠️  注意：单文件与 full 包本次内置了 AI 密钥（XOR+base64 混淆，可被还原）。"
  echo "    只发给可信的人；公开传播前请先换 Key，或改用本地代理模式。"
fi
echo
echo "发给别人时："
echo "  只想看结果  → 发「model价格比较-$D.html」（单文件，双击/拖进浏览器即可）"
echo "  要自己跑更新 → 发「modelprice-full-$D.zip」（解压后 bash scripts/run_daily.sh）"
