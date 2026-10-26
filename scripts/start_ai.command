#!/bin/bash
# 双击即可启动 AI 补识别：自动拉起本地代理 + 打开比较页面。
# 密钥保存在 ~/.modelprice_llm_key（权限 600），不在项目目录里，不会被 git 提交或打进 HTML。
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
KEY_FILE="$HOME/.modelprice_llm_key"
PORT=8787

# 找 python
PY=""
for p in python3 python; do
  if command -v "$p" >/dev/null 2>&1; then PY="$p"; break; fi
done
if [ -z "$PY" ]; then
  echo "❌ 没找到 python3。请先安装 Python 3 再重试。"
  read -r -p "按回车关闭…"
  exit 1
fi

# 首次运行：让用户输入并保存密钥（不在屏幕上回显）
if [ ! -s "$KEY_FILE" ]; then
  echo "┌─ 首次使用 ─────────────────────────────────────────┐"
  echo "│ 请输入 DeepSeek API Key（屏幕上不会显示）：        │"
  echo "│ 它会存到 $KEY_FILE（仅你可读）│"
  echo "└────────────────────────────────────────────────────┘"
  read -r -s KEY
  if [ -z "$KEY" ]; then
    echo "❌ 没有输入密钥，退出。"
    read -r -p "按回车关闭…"
    exit 1
  fi
  printf '%s' "$KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "✅ 已保存密钥到 $KEY_FILE"
fi
KEY="$(cat "$KEY_FILE")"

# 代理已在跑就复用；否则拉起
if curl -s -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "✅ 代理已在运行（端口 $PORT）"
else
  echo "🚀 启动本地代理…"
  # 用环境变量传 Key（代理支持 LLM_KEY），避免明文出现在 ps 的命令行参数里
  LLM_KEY="$KEY" nohup "$PY" "$ROOT/scripts/llm_proxy.py" --provider deepseek \
        --port "$PORT" > /tmp/modelprice_proxy.log 2>&1 &
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if curl -s -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  done
fi

if curl -s -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "✅ 代理就绪：$(curl -s -m 3 http://127.0.0.1:$PORT/health)"
else
  echo "❌ 代理启动失败，查看日志：/tmp/modelprice_proxy.log"
  tail -5 /tmp/modelprice_proxy.log 2>/dev/null
  read -r -p "按回车关闭…"
  exit 1
fi

echo "🌐 打开比较页面…"
if [ -f "$ROOT/dist/model价格比较-$(date +%F).html" ]; then
  open "$ROOT/dist/model价格比较-$(date +%F).html"
else
  open "$ROOT/web/index.html"
fi

echo ""
echo "──────────────────────────────────────────────"
echo "代理正在后台运行。用完想停掉，在任意终端执行："
echo "  pkill -f llm_proxy.py"
echo "换密钥：编辑 $KEY_FILE"
echo "本窗口可以关掉，代理不会停。"
read -r -p "按回车关闭本窗口…"
