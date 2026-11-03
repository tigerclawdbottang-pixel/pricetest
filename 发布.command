#!/bin/bash
# 一键发布到 GitHub Pages —— 双击运行即可
# 做的事：清锁 → 提交全部改动 → 推送 → 打不开就提示强制推送 → 打开 Actions 页面
cd "$(dirname "$0")" || exit 1

pause() { read -n 1 -s -r -p "按任意键关闭…"; echo; }

echo "=================================="
echo "  发布 modelprice"
echo "=================================="
echo

# 沙箱/异常退出可能留下锁文件，先清掉
rm -f .git/index.lock

echo "== 将要提交的改动 =="
git status --short
echo

if [ -z "$(git status --porcelain)" ]; then
  echo "没有需要提交的改动，直接推送看看。"
else
  MSG="update: $(date '+%Y-%m-%d %H:%M')"
  echo "== 提交：$MSG =="
  git add -A
  if ! git commit -m "$MSG"; then
    echo "提交失败，已停止。"
    pause; exit 1
  fi
  echo
fi

echo "== 推送到 origin/main =="
if git push origin main; then
  echo "推送成功。"
else
  echo
  echo "直接推送被拒绝 —— 远程历史与本地不连续（本项目常见情况）。"
  read -r -p "改为强制推送？会覆盖远程历史 [y/N] " ans
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    git tag "backup-$(date +%Y%m%d-%H%M)" origin/main 2>/dev/null
    if git push origin main --force; then
      echo "强制推送成功。"
    else
      echo "强制推送也失败了，把上面报错发给 Claude。"
      pause; exit 1
    fi
  else
    echo "已取消推送。"
    pause; exit 1
  fi
fi

echo
echo "接下来：等 Actions 变绿，然后 Cmd+Shift+R 强刷线上页面。"
open "https://github.com/tigerclawdbottang-pixel/pricetest/actions"
pause
