# 模型价格每日复核报告 — 2026-11-02

生成时间：2026-11-03T10:59:16　|　快照日期：2026-11-02（对比基准：2026-10-27）

## 结论

- 高优先级 **46** 项 / 警告 **188** 项 / 信息 **360** 项
- 发布价与采集价一致性问题：**1** 项
- **需要人工/联网核对**：见下方「待核对清单」

## 高优先级差异（需联网核对）（46 项）

| 级别 | 类型 | 源 | 模型 | 说明 |
|---|---|---|---|---|
| high | 价格异动 | OpenRouter | `~deepseek/deepseek-flash-latest` | input 0.02 → 0.035 (+75.0%) |
| high | 价格异动 | OpenRouter | `~deepseek/deepseek-flash-latest` | output 0.02197 → 0.5 (+2175.8%) |
| high | 价格异动 | OpenRouter | `deepseek/deepseek-v4.1-flash` | input 0.14 → 0.045 (-67.9%) |
| high | 价格异动 | OpenRouter | `z-ai/glm-5.3-flash` | input 0.15 → 0.0285 (-81.0%) |
| high | 价格异动 | OpenRouter | `z-ai/glm-5.3-flash` | output 0.5 → 0.0923 (-81.5%) |
| high | 价格异动 | OpenRouter | `~z-ai/glm-latest` | output 4.3843 → 1.4 (-68.1%) |
| high | 价格异动 | OpenRouter | `z-ai/glm-5.3` | output 1.4 → 3.5999999999999996 (+157.1%) |
| high | 价格异动 | OpenRouter | `deepseek/deepseek-v4-pro-0813` | input 1.32 → 0.11499999999999999 (-91.3%) |
| high | 价格异动 | OpenRouter | `deepseek/deepseek-v4-pro-0813` | cache_read 0.044 → 0.11 (+150.0%) |
| high | 价格异动 | OpenRouter | `~deepseek/deepseek-v4-flash-latest` | output 0.1568 → 0.3 (+91.3%) |
| high | 价格异动 | OpenRouter | `z-ai/glm-5.2` | input 0.0341 → 0.006 (-82.4%) |
| high | 价格异动 | OpenRouter | `z-ai/glm-5.2` | cache_read 0.032999999999999995 → 0.005 (-84.8%) |
| high | 价格异动 | OpenRouter | `~moonshotai/kimi-latest` | cache_read 0.19 → 0.07475000000000001 (-60.7%) |
| high | 价格异动 | OpenRouter | `deepseek/deepseek-v4-pro` | input 0.9552599999999999 → 1.5999999999999999 (+67.5%) |
| high | 价格异动 | OpenRouter | `deepseek/deepseek-v4-pro` | output 1.9105199999999998 → 3.1999999999999997 (+67.5%) |
| high | 价格异动 | OpenRouter | `deepseek/deepseek-v4-pro` | cache_read 0.07960500000000001 → 0.135 (+69.6%) |
| high | 价格异动 | OpenRouter | `deepseek/deepseek-v3.2` | cache_read 0.028 → 0.13 (+364.3%) |
| high | 价格异动 | OpenRouter | `openai/gpt-oss-120b` | input 0.15 → 0.024 (-84.0%) |
| high | 价格异动 | OpenRouter | `openai/gpt-oss-120b` | output 0.6 → 0.08900000000000001 (-85.2%) |
| high | 价格异动 | OpenRouter | `openai/gpt-oss-120b` | cache_read 0.075 → 0.022 (-70.7%) |
| high | 价格异动 | OpenRouter | `openai/gpt-oss-20b` | input 0.018 → 0.03 (+66.7%) |
| high | 价格异动 | OpenRouter | `openai/gpt-oss-20b` | cache_read 0.009 → 0.03 (+233.3%) |
| high | 价格异动 | OpenRouter | `google/gemma-3-4b-it` | output 0.049999999999999996 → 0.09999999999999999 (+100.0%) |
| high | 价格异动 | Wokey | `deepseek-flash` | input 0.21 → 0.075 (-64.3%) |
| high | 价格异动 | Wokey | `deepseek-flash` | output 0.84 → 0.3 (-64.3%) |
| high | 价格异动 | Wokey | `deepseek-flash` | cache_read 0.0042 → 0.0015 (-64.3%) |
| high | 价格异动 | CheaperInference | `beam` | input 0.009965326006918638 → 0.11922037979369403 (+1096.4%) |
| high | 价格异动 | CheaperInference | `beam` | output 0.039328376328858175 → 0.4768813215701736 (+1112.6%) |
| high | 价格异动 | CheaperInference | `beam` | cache_read 0.009486 → 0.11922 (+1156.8%) |
| high | 价格异动 | CheaperInference | `gemma-3-27b-it` | input 0.052 → 0.091 (+75.0%) |
| high | 价格异动 | CheaperInference | `gemma-3-27b-it` | cache_read 0.026 → 0.091 (+250.0%) |
| high | 价格异动 | CheaperInference | `gemma-4-31b-it` | input 0.091 → 0.1625 (+78.6%) |
| high | 价格异动 | CheaperInference | `gemma-4-31b-it` | output 0.26 → 0.4875 (+87.5%) |
| high | 价格异动 | CheaperInference | `gemma-4-31b-it` | cache_read 0.065 → 0.1625 (+150.0%) |
| high | 价格异动 | CheaperInference | `glm-4.7-flash` | input 0.0455 → 0.0845 (+85.7%) |
| high | 价格异动 | CheaperInference | `glm-4.7-flash` | cache_read 0.0455 → 0.0845 (+85.7%) |
| high | 价格异动 | CheaperInference | `gpt-6-luna-decisions` | cache_read 0.065 → 0.0077 (-88.2%) |
| high | 价格异动 | CheaperInference | `glm-4.7` | input 0.33 → 0.605 (+83.3%) |
| high | 价格异动 | CheaperInference | `glm-4.7` | output 1.21 → 2.2825 (+88.6%) |
| high | 价格异动 | CheaperInference | `glm-4.7` | cache_read 0.0605 → 0.605 (+900.0%) |

_（仅显示前 40 项，共 46 项）_


## 警告（188 项）

| 级别 | 类型 | 源 | 模型 | 说明 |
|---|---|---|---|---|
| warn | 价格异动 | OpenRouter | `deepseek/deepseek-v4.1-flash-1017` | input 0.3 → 0.15 (-50.0%) |
| warn | 价格异动 | OpenRouter | `deepseek/deepseek-v4.1-flash-1017` | output 1.2 → 0.6 (-50.0%) |
| warn | 价格异动 | OpenRouter | `deepseek/deepseek-v4.1-flash-1017` | cache_read 0.006 → 0.003 (-50.0%) |
| warn | 价格异动 | OpenRouter | `mistralai/mistral-large-4-0` | input 1.3599999999999999 → 0.7 (-48.5%) |
| warn | 价格异动 | OpenRouter | `mistralai/mistral-large-4-0` | output 4.18 → 2.0999999999999996 (-49.8%) |
| warn | 价格异动 | OpenRouter | `mistralai/mistral-large-4-0` | cache_read 0.14 → 0.07 (-50.0%) |
| warn | 价格异动 | OpenRouter | `~deepseek/deepseek-pro-latest` | input 0.2381 → 0.1035 (-56.5%) |
| warn | 价格异动 | OpenRouter | `~deepseek/deepseek-pro-latest` | cache_read 0.24 → 0.09999999999999999 (-58.3%) |
| warn | 价格异动 | OpenRouter | `~deepseek/deepseek-flash-latest` | cache_read 0.008476 → 0.005 (-41.0%) |
| warn | 价格异动 | OpenRouter | `deepseek/deepseek-v4.1-flash` | cache_read 0.004200000000000001 → 0.006 (+42.9%) |
| warn | 价格异动 | OpenRouter | `ibm-granite/granite-4.2-8b` | output 0.25 → 0.15 (-40.0%) |
| warn | 价格异动 | OpenRouter | `~z-ai/glm-flash-latest` | input 0.041299999999999996 → 0.0285 (-31.0%) |
| warn | 价格异动 | OpenRouter | `qwen/qwen3.8-27b` | output 2.5 → 1.875 (-25.0%) |
| warn | 价格异动 | OpenRouter | `qwen/qwen3.8-27b` | cache_read 0.09 → 0.0375 (-58.3%) |
| warn | 价格异动 | OpenRouter | `moonshotai/kimi-k3` | output 20.0 → 15.0 (-25.0%) |
| warn | 价格异动 | OpenRouter | `~moonshotai/kimi-latest` | output 8.940000000000001 → 7.15 (-20.0%) |
| warn | 价格异动 | OpenRouter | `qwen/qwen3.6-35b-a3b` | cache_read 0.049999999999999996 → 0.024999999999999998 (-50.0%) |
| warn | 价格异动 | OpenRouter | `qwen/qwen3.6-27b` | input 0.32 → 0.44999999999999996 (+40.6%) |
| warn | 价格异动 | OpenRouter | `deepseek/deepseek-v4-flash` | input 0.14 → 0.091 (-35.0%) |
| warn | 价格异动 | OpenRouter | `deepseek/deepseek-v4-flash` | output 0.28 → 0.182 (-35.0%) |
| warn | 价格异动 | OpenRouter | `deepseek/deepseek-v4-flash` | cache_read 0.028 → 0.0182 (-35.0%) |
| warn | 价格异动 | OpenRouter | `z-ai/glm-5.1` | input 0.966 → 1.4 (+44.9%) |
| warn | 价格异动 | OpenRouter | `z-ai/glm-5.1` | output 3.036 → 4.4 (+44.9%) |
| warn | 价格异动 | OpenRouter | `z-ai/glm-5.1` | cache_read 0.1794 → 0.26 (+44.9%) |
| warn | 字段缺失 | OpenRouter | `nvidia/nemotron-3-nano-30b-a3b` | cache_read 由 无 变为 有 |
| warn | 字段缺失 | OpenRouter | `nousresearch/hermes-4-405b` | cache_read 由 无 变为 有 |
| warn | 价格异动 | OpenRouter | `openai/gpt-oss-20b` | output 0.09 → 0.13 (+44.4%) |
| warn | 字段缺失 | OpenRouter | `qwen/qwen3-30b-a3b-instruct-2507` | cache_read 由 无 变为 有 |
| warn | 字段缺失 | OpenRouter | `google/gemma-3-4b-it` | cache_read 由 有 变为 无 |
| warn | 价格异动 | Wokey | `MiniMax-M3` | input 0.09 → 0.135 (+50.0%) |
| warn | 价格异动 | Wokey | `MiniMax-M3` | output 0.36 → 0.54 (+50.0%) |
| warn | 价格异动 | Wokey | `MiniMax-M3` | cache_read 0.018 → 0.027 (+50.0%) |
| warn | 价格异动 | CheaperInference | `claude-fable-5.1` | input 6.9770791 → 7.9803718 (+14.4%) |
| warn | 价格异动 | CheaperInference | `claude-fable-5.1` | output 34.8853955 → 39.901859 (+14.4%) |
| warn | 价格异动 | CheaperInference | `claude-opus-5` | input 4.205639 → 3.54758905 (-15.6%) |
| warn | 价格异动 | CheaperInference | `claude-opus-5` | output 21.028195 → 17.73794525 (-15.6%) |
| warn | 价格异动 | CheaperInference | `claude-opus-5.5` | input 3.3495678 → 2.74924888 (-17.9%) |
| warn | 价格异动 | CheaperInference | `claude-opus-5.5` | output 16.747839 → 13.7462444 (-17.9%) |
| warn | 价格异动 | CheaperInference | `claude-sonnet-5.5` | output 6.6998915 → 8.4096843 (+25.5%) |
| warn | 价格异动 | CheaperInference | `claude-sonnet-5.5` | cache_read 0.133998 → 0.084097 (-37.2%) |

_（仅显示前 40 项，共 188 项）_


## 信息（360 项）

| 级别 | 类型 | 源 | 模型 | 说明 |
|---|---|---|---|---|
| info | 新增 | OpenRouter | `particle-ai/particle-1` | 新上架模型 |
| info | 新增 | OpenRouter | `prism-ml/ternary-bonsai-2-9b` | 新上架模型 |
| info | 新增 | Fireworks | `ultramarine-1-flash-us` | 新上架模型 |
| info | 新增 | Wokey | `gemini-3.8-flash` | 新上架模型 |
| info | 新增 | 硅基流动 SiliconFlow | `GLM-5.3-Flash` | 新上架模型 |
| info | 新增 | 硅基流动 SiliconFlow | `GLM-4.5V` | 新上架模型 |
| info | 新增 | 硅基流动 SiliconFlow | `Qwen3.8 27B` | 新上架模型 |
| info | 新增 | 硅基流动 SiliconFlow | `Qwen3.6 27B` | 新上架模型 |
| info | 新增 | 硅基流动 SiliconFlow | `GLM-5.3` | 新上架模型 |
| info | 新增 | Venice AI | `abliteration-abliterated-model-large-flash` | 新上架模型 |
| info | 新增 | Venice AI | `abliteration-abliterated-model-large-v2` | 新上架模型 |
| info | 新增 | Venice AI | `aion-labs-aion-3-0` | 新上架模型 |
| info | 新增 | Venice AI | `aion-labs-aion-3-0-mini` | 新上架模型 |
| info | 新增 | Venice AI | `aion-labs-aion-3-5` | 新上架模型 |
| info | 新增 | Venice AI | `aion-labs-aion-3-5-mini` | 新上架模型 |

_（仅显示前 15 项，共 360 项）_


## 待核对清单

对以下条目，搜索官网/官方定价页确认真实价格：

1. **OpenRouter** `~deepseek/deepseek-flash-latest` — input 0.02 → 0.035 (+75.0%)
2. **OpenRouter** `~deepseek/deepseek-flash-latest` — output 0.02197 → 0.5 (+2175.8%)
3. **OpenRouter** `deepseek/deepseek-v4.1-flash` — input 0.14 → 0.045 (-67.9%)
4. **OpenRouter** `z-ai/glm-5.3-flash` — input 0.15 → 0.0285 (-81.0%)
5. **OpenRouter** `z-ai/glm-5.3-flash` — output 0.5 → 0.0923 (-81.5%)
6. **OpenRouter** `~z-ai/glm-latest` — output 4.3843 → 1.4 (-68.1%)
7. **OpenRouter** `z-ai/glm-5.3` — output 1.4 → 3.5999999999999996 (+157.1%)
8. **OpenRouter** `deepseek/deepseek-v4-pro-0813` — input 1.32 → 0.11499999999999999 (-91.3%)
9. **OpenRouter** `deepseek/deepseek-v4-pro-0813` — cache_read 0.044 → 0.11 (+150.0%)
10. **OpenRouter** `~deepseek/deepseek-v4-flash-latest` — output 0.1568 → 0.3 (+91.3%)
11. **OpenRouter** `z-ai/glm-5.2` — input 0.0341 → 0.006 (-82.4%)
12. **OpenRouter** `z-ai/glm-5.2` — cache_read 0.032999999999999995 → 0.005 (-84.8%)
13. **OpenRouter** `~moonshotai/kimi-latest` — cache_read 0.19 → 0.07475000000000001 (-60.7%)
14. **OpenRouter** `deepseek/deepseek-v4-pro` — input 0.9552599999999999 → 1.5999999999999999 (+67.5%)
15. **OpenRouter** `deepseek/deepseek-v4-pro` — output 1.9105199999999998 → 3.1999999999999997 (+67.5%)
16. **OpenRouter** `deepseek/deepseek-v4-pro` — cache_read 0.07960500000000001 → 0.135 (+69.6%)
17. **OpenRouter** `deepseek/deepseek-v3.2` — cache_read 0.028 → 0.13 (+364.3%)
18. **OpenRouter** `openai/gpt-oss-120b` — input 0.15 → 0.024 (-84.0%)
19. **OpenRouter** `openai/gpt-oss-120b` — output 0.6 → 0.08900000000000001 (-85.2%)
20. **OpenRouter** `openai/gpt-oss-120b` — cache_read 0.075 → 0.022 (-70.7%)