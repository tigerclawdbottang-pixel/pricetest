#!/bin/bash
# 生成适合直接 push 到 GitHub 的打包文件（解压后即仓库根目录）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
D=$(date +%Y-%m-%d)
mkdir -p dist

# 清理运行期临时文件，避免混进仓库
rm -f data/_probe*.json data/_*.json
find . -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

ZIP="dist/modelprice-github-$D.zip"
rm -f "$ZIP"

# ---- 关键：GitHub 包必须是「无密钥」版本 ----
# 用 MODELPRICE_EMBED_KEY=0 重新生成 index.html（不含内置密钥），
# 打包完成后再重建本地含密钥版本，两边互不影响。
PY="${PYTHON:-python3}"
MODELPRICE_EMBED_KEY=0 $PY scripts/build_site.py >/dev/null

zip -q -r "$ZIP" \
  README.md DEPLOY.md package.json LICENSE .gitignore \
  .github/workflows/pages.yml \
  web/index.html web/data.json web/app.js web/parsers.js web/llm.js web/style.css web/template.html \
  data/official_prices.json data/official_auto.json data/fx.json data/llm_key.example.json \
  scripts/collect.py scripts/fetch_official.py scripts/build_site.py scripts/verify.py scripts/write_llm_key.py \
  scripts/run_daily.sh scripts/make_dist.sh scripts/make_github.sh \
  scripts/smoke.js scripts/test_parsers.js scripts/test_official_col.js scripts/test_upload_match.js scripts/test_llm.js scripts/test_upload_tier.js scripts/test_ai_e2e.js scripts/test_media.py scripts/diag_media.py scripts/llm_proxy.py scripts/start_ai.command \
  scripts/fixtures/test.xlsx scripts/fixtures/test.docx \
  reports/latest.md \
  -x "*.DS_Store" "dist/*" "snapshots/*" "node_modules/*" \
  2>/dev/null || true

# 恢复本地含密钥版本
$PY scripts/build_site.py >/dev/null

# 双重保险：确认包里没有密钥（明文 sk-，或混淆后的 BUILTIN_KEY 对象）
if unzip -p "$ZIP" web/index.html 2>/dev/null | grep -qE 'sk-[A-Za-z0-9]{20,}|const BUILTIN_KEY = \{'; then
  echo "❌ 检测到包内可能含密钥，终止！请检查 data/llm_key.json 是否被误打包" >&2
  exit 1
fi
echo "✅ 已确认包内无明文密钥"

echo "=== GitHub 版打包完成 ==="
ls -lh "$ZIP" | awk '{print "  "$5"\t"$9}'
echo
echo "内容清单："
unzip -l "$ZIP" | awk 'NR>3 && NF>=4 {print "  "$4}' | grep -v '^  *$' | sed '/^  ----/d'
echo
echo "上传方式："
echo "  1) 在 GitHub 新建空仓库（不要勾 README / .gitignore / LICENSE）"
echo "  2) 解压本包，进入目录"
echo "  3) git init && git add . && git add -f web/index.html && git commit -m 'init' \\"
echo "     && git remote add origin <你的仓库地址> && git push -u origin main"
echo "     （web/index.html 是生成物、默认被 .gitignore 忽略；本包内的是已剥离密钥的版本，"
echo "       用 -f 显式加入，避免把本地带密钥版本误提交）"
echo "  4) 推荐：Settings → Pages → Source = GitHub Actions，然后 Actions → Build & Deploy Price Site → Run"
echo "     团队测试要页面自带 AI：在 Actions Secret 里加 MODELPRICE_LLM_KEY，详见 DEPLOY.md"
