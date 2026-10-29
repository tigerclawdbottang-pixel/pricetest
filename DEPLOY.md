# 部署到 GitHub Pages（团队测试版，页面内置 AI Key）

目标：把 `modelprice` 推到 GitHub，用 Actions 每天自动采集并发布到 GitHub Pages。
**部署完打开网页就能直接用，包括「AI 补识别 / AI 解读」，不需要另起代理。**

> 当前方案按你的要求：把 Key 内置进页面（XOR + base64 混淆，可被还原）。
> Key 只存在于 **Actions Secret** 和**部署产物**里，不会提交进 git；但 Pages 页面本身是公开的，
> 拿到 URL 的人可以解出 Key。你已设置额度，测试期可接受；测完建议换 Key。

---

## 一、一次性设置（约 3 分钟）

### 1. 推送到 GitHub

在项目根目录（`modelprice/`）：

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
```

`web/index.html`、`data/prices.db`、`data/llm_key.json`、`dist/` 都被 `.gitignore` 排除；
Actions 会在云端重新生成它们，不需要手动提交。

### 2. 添加 Key（Actions Secret）

仓库页面 → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `MODELPRICE_LLM_KEY` | 你的 DeepSeek Key（`sk-...`） |

可选项（不填就用默认 DeepSeek）：

| Name | 默认 |
|---|---|
| `MODELPRICE_LLM_PROVIDER` | `deepseek` |
| `MODELPRICE_LLM_ENDPOINT` | `https://api.deepseek.com/v1/chat/completions` |
| `MODELPRICE_LLM_MODEL` | `deepseek-chat` |

### 3. 打开 Pages（用 Actions 发布）

仓库 → **Settings → Pages → Build and deployment → Source = GitHub Actions**。

### 4. 运行一次

**Actions → Build & Deploy Price Site → Run workflow**（选 `main`）。

跑完后页面地址是：

```
https://<你的账号>.github.io/<仓库名>/
```

打开后「AI 补识别 / AI 解读」应当直接可用；「数据源」页能看到五个源的采集状态。

---

## 二、每天自动更新

`.github/workflows/pages.yml` 已配置：

- **每天 01:00 UTC（= 09:00 香港时间）** 自动跑；
- 推送 `scripts/**`、`web/**`、官网价 JSON 时也会触发；
- 也可以随时手动 `Run workflow`。

每次流程：

```
恢复 prices.db（走势历史）
  → collect.py（五源采集）
  → fetch_official.py（官网价）
  → write_llm_key.py（从 Secret 写 data/llm_key.json）
  → build_site.py（生成带内置 Key 的自包含 index.html）
  → verify.py（日复核）
  → test_parsers.js / test_llm.js
  → 发布 web/index.html 到 Pages
  → 保存 prices.db 回 Actions cache
```

> **走势历史**：`prices.db` 不入库，靠 Actions cache 持久化。每天访问不会过期；
> 如果仓库连续 7 天没有任何运行，cache 可能被清理，走势会从当天重新累积。
> 需要长期稳定历史，建议把流水线放到自己的 VPS（见第五节）。

---

## 三、安全与额度

- 页面里的 Key 经过 XOR+base64 混淆（grep 不到明文），但**不是加密**；F12 / 脚本都能还原。
- Key **不在 git 历史里**：workflow 只在运行器里写 `data/llm_key.json`，构建完即随运行器销毁。
- Pages 站点默认公开；如果仓库是 private，Pages 仍需 GitHub Pro/Team（且站点通常仍公开）。
- 页面已加 `noindex,nofollow` 且发布 `robots.txt`，避免被搜索引擎收录；这不能阻止拿到 URL 的人访问。
- 你已经给 Key 设了额度；建议再加一层：在 DeepSeek 控制台按日限额、测试结束立即轮换。
- 公开传播前，按 README 的「方式一」说明换成无 Key 版本，或直接删除 `MODELPRICE_LLM_KEY` Secret
  后重跑 workflow —— `write_llm_key.py` 会生成无密钥页面。

---

## 四、常见问题

| 现象 | 处理 |
|---|---|
| Actions 里 `collect.py` 部分源失败 | GitHub 运行器的 IP 可能被某些源限流；其余源仍会发布。连续失败时改用 VPS 跑（第五节）。 |
| Actions 报 Pages 权限错误 | 确认 Settings → Pages → Source 已选 **GitHub Actions**，且 workflow 的 `permissions` 含 `pages: write` / `id-token: write`。 |
| 页面打开但 AI 报错 | 先看浏览器 Console：若是 CORS（从 `https://...github.io` 调 DeepSeek 被拦），改用一个服务端中转（Cloudflare Worker / Vercel Function），在页面「AI 设置」里把代理地址指过去；或改用本地代理测试。 |
| 定时任务不跑了 | 公开仓库的 scheduled workflow 在 **60 天无仓库活动**后会被 GitHub 暂停；随便 push 一次或手动 Run 即可恢复。 |
| 想换 Key | 更新 `MODELPRICE_LLM_KEY` Secret，然后手动 Run workflow。 |
| 想换模型/厂商 | 加 `MODELPRICE_LLM_MODEL` / `MODELPRICE_LLM_ENDPOINT` Secret，重跑。 |

---

## 五、后续换正式方案

测试期结束后，推荐按以下任一方式切换：

1. **公开无 AI 版**：删除 `MODELPRICE_LLM_KEY` Secret，重跑；页面只保留规则引擎与分析面板。
2. **服务端中转**：部署 Cloudflare Worker / Vercel Function，Key 放服务端环境变量，
   前端「AI 设置」指向 `https://你的中转/extract`；页面不再含 Key，访客仍可用 AI。
3. **VPS 自托管**：在服务器上挂 cron 跑 `run_daily.sh`，用 Nginx 托管 `web/index.html`；
   `prices.db` 留在服务器上，走势历史最稳，也可在同机跑 `llm_proxy.py` 做中转。

---

## 六、相关文件

- `.github/workflows/pages.yml` — 构建 + 发布 workflow
- `scripts/write_llm_key.py` — 从 `LLM_KEY` 环境变量生成 `data/llm_key.json`
- `scripts/build_site.py` — 把 Key 混淆后注入自包含页面
- `scripts/make_github.sh` — 生成**无密钥**的 GitHub 分发包（给公开仓库用；本 Pages 方案不需要它）
