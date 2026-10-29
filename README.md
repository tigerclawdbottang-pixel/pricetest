# 模型价格比较平台

对比 **OpenRouter / Fireworks / Wokey / CheaperInference / 硅基流动 SiliconFlow** 五个源的 LLM 价格，单位统一为 **USD / 百万 tokens**。

## 快速开始

**只想看结果**：打开 `web/index.html`（自包含单文件，双击即可，无需联网、无需服务器）。
> `web/index.html` 是生成物，已被 `.gitignore` 排除（避免带内置密钥的版本被误提交）；如果打开时文件不存在，先跑一次 `bash scripts/run_daily.sh` 生成。

**部署到 GitHub Pages（团队测试版，页面内置 AI，打开即用）**：见 [DEPLOY.md](DEPLOY.md)。

**想自己采集最新价**（需要 Python 3.9+，零第三方依赖）：

```bash
bash scripts/run_daily.sh
```

首次运行会创建 `data/prices.db` 与当日快照，并重新生成 `web/index.html`。

如需每天自动跑，在本机加一条 cron（脚本已不依赖任何绝对路径）：

```bash
0 9 * * * bash /path/to/modelprice/scripts/run_daily.sh
```

## 三个 Agent

| Agent | 职责 | 入口 |
|---|---|---|
| **A 采集** | 抓五源全量模型价格 → SQLite + 每日快照 | `scripts/collect.py` |
| **A2 官网价** | 抓各厂商官方定价页 → `official_auto.json` | `scripts/fetch_official.py` |
| **B 发布** | 生成比较页面（列表/图表/走势/上传比对） | `scripts/build_site.py` |
| **C 核对** | 日环比异动、发布价一致性、官网价自洽性校验 | `scripts/verify.py` |

日常由 cron 驱动：09:00 跑 A + A2 + B + C（`run_daily.sh` 串行执行，见上方 cron 示例）。

## 采集细节

| 源 | 数据入口 | 特点 |
|---|---|---|
| OpenRouter | `openrouter.ai/api/v1/models` | 官方 API，字段名以它为准 |
| Fireworks | `app.fireworks.ai/api/models` | 含缓存读价格 |
| Wokey | 页面内嵌 JSON (`wokey-models-page-data`) | 含官方参考价与折扣率 |
| CheaperInference | Next.js flight payload | 含官方原价、折后价、折扣百分比 |
| 硅基流动 SiliconFlow | `llmpricing.dev/p/siliconflow-cn/`（主）+ 官网 payload（补齐） | **价格以 llmpricing.dev 为准**（美元直出，含缓存价与上下文长度）；该站没收录的模型再用官网数据补，官网部分按当日汇率折算 |

采集到的字段：`input` `output` `cache_read`(命中缓存) `cache_write`(缓存创建) `list_input/output`(官方原价) `discount`(折扣%)。
每个模型的**每个版本**都单独保留（展开行内「版本明细」可看）。

> **汇率**：仅硅基流动「官网补齐部分」以 CNY 计价，采集时自动取当日汇率（`open.er-api.com`，失败回退 `exchangerate-api.com`，再失败用 1 USD = 7.10 CNY），
> 写入 `data/fx.json` 并在页面「数据源」页与源说明中标注所用汇率。

### 跨源匹配

各源命名不一致（`claude-fable-5-1` / `claude-fable-5.1`、`minimax-m3p1-flash` / `minimax-m3.1-flash`），
统一用模糊键匹配：数字间的 `p` 视为小数点，再抹掉所有分隔符。
已排除 `:batch` / `:free` 等非标准计费变体，避免污染最低价。

### 模型官网价格（新增列）

页面在「模型」列后新增 **模型官网价格** 列，取值优先级：

1. **厂商官方定价页** —— `data/official_prices.json`（人工维护，带官方 URL 与核对日期）
   + `scripts/fetch_official.py` 自动抓取（DeepSeek / Z.AI-GLM / Moonshot / MiniMax 等）
2. **OpenRouter 发布价兜底** —— 检索不到官网价时回退，单元格标注 `OR` 角标，
   悬停可看到完整说明（输入/输出/缓存命中/来源链接/核对日期）

| 厂商 | 来源 | 采集方式 |
|---|---|---|
| Anthropic Claude | `platform.claude.com/docs/en/about-claude/pricing` | 人工维护（文档页有区域限制） |
| OpenAI GPT | `openai.com/api-priority-processing` | 人工维护（文档页 403） |
| Google Gemini | `ai.google.dev/gemini-api/docs/pricing` | 人工维护 |
| 阿里 Qwen | 百炼控制台 / DashScope 计费文档 | 人工维护（CNY 按 7.1 折算 USD） |
| Moonshot Kimi | `kimi.com/resources/kimi-k3-1-pro-pricing` | 人工维护（定价页为 SPA） |
| DeepSeek | `api-docs.deepseek.com/quick_start/pricing` | **自动抓取** |
| Z.AI GLM | `docs.z.ai/guides/overview/pricing` | **自动抓取** |
| MiniMax | `platform.minimaxi.com/document/price` | **自动抓取**（CNY 折算） |

官网价是**基准参考**，不参与五源之间的最高（红）/最低（绿）着色。
`data/official_prices.json` 中每条记录带 `checked` 日期，超过 30 天未核对时 Agent C 会告警。

## 页面功能

1. **总览对比** — 选指标（输入/输出/缓存命中/缓存写入/折扣），最低价绿色、最高价红色；点行展开全指标与全部版本。
2. **单独选模型** — 点击任意行即锁定该模型，下方柱状图与汇总卡片同步切换。
3. **柱状图** — 五源价格对比（自绘 SVG，零依赖）。
4. **关注模型** — 国际：Claude / Gemini / GPT 全系列；国产：DeepSeek、Kimi、GLM、Qwen、MiniMax。
5. **价格走势** — 选源 + 选模型，看历史价格曲线（需累积 ≥2 天快照）。
6. **上传比对** — 拖入 `.xlsx/.xlsm/.docx/.csv`，**无需固定格式**，自动识别模型名与价格列；
   支持**按 token 区间展开**（同一模型拆多档报价的表，如 `0<Token≤128K` / `Token>272K`，
   每档单独比价）；表内有「目录价 + N 折」时按最低渠道折扣折算实际售价。
   高于本站最低价的单元格以**黄色高亮**标出，并给出「你的报价 vs 本站最低/最高」比较曲线；
   右侧**价格分析面板**自动生成逐模型中文分析（比最低价高/低多少、相对刊例价几折、议价建议），
   只列主模型（同家族小版本自动归并），可一键复制，也可点「AI 解读」生成自然语言报告。
   也可直接粘贴表格文本兜底。识别不到时可选用**大模型补识别**（见下节）。
7. **导出 CSV** — 当前筛选结果。
8. **AI 完整读取** — 上传后自动把整张工作表（含表头、目录价/折后价、按张/秒/条单位）交给模型读结构，
   返回模型名、规格、价格与单位；**汇率、折扣、比价仍由本地代码计算**。可在上传区关闭自动读取。
   图像/视频报价会与站内 `media` 同单位比较，不混进 token 最低价。

> **图像 / 视频**：Seedance / Kling / Veo / Flux / Wan 等生成模型按张/秒/步计价，在独立的「图像 / 视频」标签页展示，
> 不与 token 单价混比；采集不到的显示 `—`，不会当成免费。AI 完整读取上传报价时，媒体价格按张/秒/条同单位比较。

## 上传识别：规则引擎 + 大模型兜底

两层设计 + 整表读取：

| 层 | 谁做 | 覆盖 | 代价 |
|---|---|---|---|
| 规则引擎 | 页面内 JS（离线） | 规范 token 表；秒级出结果 | 免费、即时、离线 |
| AI 完整读取 | 大模型（默认自动，可关闭） | 整张工作表：合并表头、两套价格列、按分辨率/规格拆行、按张/秒/条计价 | 按行消耗 token |
| AI 补识别 | 大模型（可选，旧按钮） | 规则漏掉的行 | 少量 token |

AI 完整读取仍然坚持：**只读表、不做数学**；数字必须出现在原行，找不回就丢弃；
模型名匹配不上站内模型会标「未收录」；返回结果打 **AI** 角标，低置信度可复核。

AI 只做「选择题」，不做「填空题」：每行先由本地检索出 top-12 候选模型塞进 prompt，
大模型只能从候选里挑，**返回名字不在候选内的直接丢弃**（防幻觉）；
**汇率与单位折算由本地代码计算**，大模型只负责读出原文数字和单位（`¥/1M`、`USD per 1K` 等）。

### 怎么用

推荐走**本地代理**（密钥不进浏览器、不随页面导出，也绕开 CORS）。

### 方式一：内置密钥，双击即用（已配置）

把密钥写进 `data/llm_key.json`（参照 `data/llm_key.example.json`，该文件已被
`.gitignore` 排除、不会进 git 也不会进 GitHub 包），然后重新生成页面：

```bash
python3 scripts/build_site.py
```

生成的 `index.html` 会**自动带密钥**，双击打开就能直接用 AI 功能，不用代理、不用设置。
页面里的密钥经过 XOR+base64 混淆（grep 搜不到明文），UI 中始终以 `sk-3a0••••••••2eef`
这样的遮罩显示。DeepSeek 官方 API 允许 `file://` 页面直连（已验证返回
`access-control-allow-origin: null`），因此本地单文件场景无需任何中转。

> ⚠️ **混淆不是加密**：拿到这份 HTML 的人同样能调用这个 key。所以：
> - 对外分享单文件版前想清楚（或先换 key）；
> - **push 到 GitHub 前必须用 `bash scripts/make_github.sh` 打包** —— 它会用
>   `MODELPRICE_EMBED_KEY=0` 重新生成无密钥版本并做泄露自检；
> - 想换密钥：改 `data/llm_key.json` 后重新跑一次 `build_site.py` 即可。

### 方式二：本地代理（密钥完全不落页面）

```bash
python3 scripts/llm_proxy.py --provider deepseek --key sk-你的密钥
# 支持 deepseek / siliconflow / openai / zhipu / moonshot / qwen / openrouter / --endpoint 自定义
```

或在 macOS 上双击 `scripts/start_ai.command`：自动拉起代理 + 打开页面（密钥存
`~/.modelprice_llm_key`，权限 600，不在项目目录里）。停止代理：`pkill -f llm_proxy.py`。

- 默认模型均选各家的便宜快模型（如 `deepseek-chat`），单次补几十行通常不到一分钱。
- 每次调用会显示 `tokens ↓/↑`，方便估成本。
- AI 补出来的行会打 **AI** 角标（低置信度显示 `AI?`），价格带单位标签，鼠标悬停可看
  「原表值 → 折算过程 → 来自第几行 → 置信度」，便于人工复核。
- 成本和稳妥性都可控：默认只补未识别的行，可选「AI 重跑全部行」；单次上限 300 行。

## 目录

```
modelprice/
├── web/
│   ├── index.html      ← 成品页面（自包含，双击打开）
│   ├── data.json       ← 前端数据
│   ├── template.html / style.css / app.js / parsers.js / llm.js  ← 源码
├── data/prices.db      ← SQLite 主库（prices / runs / alerts）
├── snapshots/<日期>/   ← 每日原始快照
├── reports/            ← Agent C 每日复核报告
└── scripts/
    ├── collect.py      Agent A
    ├── build_site.py   Agent B
    ├── verify.py       Agent C
    ├── run_daily.sh    每日流水线
    ├── llm_proxy.py    上传「AI 补识别」的本地代理（可选）
    └── smoke.js / test_parsers.js / test_llm.js / test_ai_e2e.js   测试
```

## 测试

测试依赖 jsdom（页面 DOM 冒烟），先安装：

```bash
npm install
export NODE_PATH="$(pwd)/node_modules"
```

然后：

```bash
node scripts/test_parsers.js      # xlsx/docx/csv 解析 + 智能识别（仓库自带 fixtures）
node scripts/test_llm.js          # AI 逻辑（假 fetch，不花钱）
python3 scripts/test_media.py     # 图片/视频/语音媒体计价解析
node scripts/test_upload_tier.js  # 区间展开 + 分析面板
node scripts/test_official_col.js # 官网价格列专项
node scripts/smoke.js             # 页面 DOM 冒烟
node scripts/test_upload_match.js # 真实 AI Hub 文件（需 /tmp/aihub.xlsx，缺失自动跳过）
node scripts/test_ai_e2e.js       # 真实 LLM（需本地代理或内置密钥，缺失自动跳过）
```

也可以用 `npm test` 跑前四套（不需要外部文件/Key）。

## 已知限制

- **历史走势**需要每日快照累积，首日只有 1 个数据点，曲线从第 2 天起才有意义。
- OpenRouter / Fireworks 不提供"官方原价"，其 `discount` 为空，折扣列仅 Wokey 与 CheaperInference 有值。
- 硅基流动：主参考源 `llmpricing.dev` 收录约 36 个主力模型（含缓存价/上下文），其余约 40 个长尾模型来自官网补充（无缓存价）；部分限免模型价格为 0，会显示为最低价。
- 价格随上游变动，下单前请以官网为准。
- 上传比对支持 token 与媒体两种口径；媒体列（按张/秒/条）需要 AI 完整读取，规则引擎只解析 token。完整读取需要 Key/网络，整张工作表会发送给模型；可在上传区关闭自动读取。
