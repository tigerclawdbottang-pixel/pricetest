#!/bin/bash
# 每日流水线：Agent A 采集 → Agent B 重新发布 → Agent C 复核
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 自动探测 Python 3（不硬编码路径，便于在他机 / CI 上运行）
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else echo "未找到 python3"; exit 1; fi
LOG="$ROOT/data/daily.log"

{
  echo "=================== $(date '+%F %T') ==================="
  echo "--- Agent A: 采集 ---"
  "$PY" "$ROOT/scripts/collect.py"
  echo "--- Agent A2: 采集模型官网价格 ---"
  "$PY" "$ROOT/scripts/fetch_official.py"
  echo "--- Agent B: 重新生成页面 ---"
  "$PY" "$ROOT/scripts/build_site.py"
  echo "--- Agent C: 复核 ---"
  "$PY" "$ROOT/scripts/verify.py"
  echo "--- 完成 ---"
} >> "$LOG" 2>&1

tail -40 "$LOG"
