#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""媒体计价解析测试：图片/视频按 unitPriceUsd / unit / priceUnit / output_images 等取值。"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("collect", os.path.join(ROOT, "scripts", "collect.py"))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)

pass_n = fail_n = 0


def ok(name, cond, extra=""):
    global pass_n, fail_n
    print(("  PASS " if cond else "  FAIL ") + name + (("  → " + str(extra)) if extra else ""))
    if cond:
        pass_n += 1
    else:
        fail_n += 1


print("=== CheaperInference ===")
ci_video = {"id": "seedance-2.0", "label": "seedance-2.0", "providerLabel": "ByteDance",
            "type": "video", "group": "video", "ourInputPerM": 0, "ourOutputPerM": 0,
            "listPriceKnown": False, "unitPriceUsd": 0.5, "referenceUnitPriceUsd": 1.0,
            "unit": "video", "discountPercent": 50, "free": False, "contextLength": None}
r = C.ci_row(ci_video)
ok("Seedance 视频按 unitPriceUsd 计价", r and r["unit"] == "video" and r["unit_price"] == 0.5, r and (r["unit"], r["unit_price"]))
ok("视频不再把 0 当 token 价", r and r["input"] is None and r["output"] is None)
ok("参考价/折扣保留", r and r["list_unit_price"] is None and r["unit_discount"] == 50)

ci_img = {"id": "flux-1.1", "label": "flux-1.1", "providerLabel": "Venice AI",
          "type": "image", "group": "image", "ourInputPerM": 0, "ourOutputPerM": 0,
          "listPriceKnown": True, "unitPriceUsd": 0.026, "referenceUnitPriceUsd": 0.04,
          "unit": "image", "discountPercent": 35, "free": False, "contextLength": None}
r = C.ci_row(ci_img)
ok("Flux 图片 $0.026/张", r and r["unit"] == "image" and abs(r["unit_price"] - 0.026) < 1e-9)
ok("原价 $0.04 与 35% 折扣", r and r["list_unit_price"] == 0.04 and r["unit_discount"] == 35)

ci_tok = {"id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro", "providerLabel": "DeepSeek",
          "type": "text", "group": "text", "ourInputPerM": 1.32, "ourOutputPerM": 3.96,
          "listInputPerM": 1.32, "listOutputPerM": 3.96, "listPriceKnown": True,
          "unitPriceUsd": None, "unit": None, "discountPercent": None, "free": False,
          "contextLength": 128000}
r = C.ci_row(ci_tok)
ok("token 模型保持原口径", r and r["unit"] == "token" and r["input"] == 1.32 and r["output"] == 3.96,
   r and (r["unit"], r["input"], r["output"]))

ci_unit_null = dict(ci_video, unit=None, unitPriceUsd=0.35)
r = C.ci_row(ci_unit_null)
ok("unit 为空但 type=video 且有 unitPriceUsd → 按视频价", r and r["unit"] == "video" and r["unit_price"] == 0.35,
   r and (r["unit"], r["unit_price"]))
ci_zero = dict(ci_video, unitPriceUsd=0, free=False)
ok("媒体价为 0 且 free=false → 视为未标价（丢弃）", C.ci_row(ci_zero) is None)

print("\n=== SiliconFlow ===")
sf_img = {"modelName": "Qwen/Qwen-Image", "DisplayName": "Qwen-Image", "mf": "Qwen",
          "type": "image", "subType": "text-to-image", "priceUnit": "/ Image",
          "price": "0.3", "currency": "¥", "status": "normal", "contextLen": 0}
r = C.siliconflow_cn_row(sf_img, 0.149758)
ok("¥0.3/张 → USD", r and r["unit"] == "image" and abs(r["unit_price"] - 0.3 * 0.149758) < 1e-9,
   r and r["unit_price"])

sf_vid = {"modelName": "Wan-AI/Wan2.2-T2V-A14B", "DisplayName": "Wan2.2-T2V-A14B", "mf": "Wan",
          "type": "video", "subType": "text-to-video", "priceUnit": "/ Video",
          "price": "2", "currency": "¥", "status": "normal", "contextLen": 0}
r = C.siliconflow_cn_row(sf_vid, 0.149758)
ok("¥2/条视频 → USD", r and r["unit"] == "video" and abs(r["unit_price"] - 2 * 0.149758) < 1e-9,
   r and r["unit_price"])

sf_tok = {"modelName": "deepseek-ai/DeepSeek-V4-Pro", "DisplayName": "DeepSeek V4 Pro", "mf": "deepseek-ai",
          "type": "text", "subType": "chat", "priceUnit": "/ M Tokens", "price": "0",
          "currency": "¥", "status": "normal", "contextLen": 128000,
          "pricing": [{"specification": "prompt", "price": "4"},
                      {"specification": "completion", "price": "12"}]}
r = C.siliconflow_cn_row(sf_tok, 0.149758)
ok("token 模型仍按 / M Tokens 折算", r and r["unit"] == "token" and r["input"] == 0.599032,
   r and (r["input"], r["output"]))

print("\n=== Wokey / OpenRouter / Fireworks ===")
wk = {"id": "gpt-image-2.5", "name": "GPT Image 2.5", "owned_by": "openai",
      "architecture": {"modality": "text+image->image", "output_modalities": ["text", "image"]},
      "pricing_skus": [{"meter": "output_images", "unit": "image", "quantity": 1,
                        "price_usd": "0.010000"}]}
r = C.wokey_row(wk)
ok("Wokey output_images → $0.01/张", r and r["unit"] == "image" and r["unit_price"] == 0.01,
   r and (r["unit"], r["unit_price"]))

orm = {"id": "google/gemini-3-pro-image", "name": "Gemini 3 Pro Image",
       "pricing": {"prompt": "0.000002", "completion": "0.000012", "image": "0.04"},
       "architecture": {"modality": "text+image->text+image", "output_modalities": ["text", "image"]},
       "context_length": 65536}
r = C.openrouter_row(orm)
ok("OpenRouter pricing.image → $0.04/张", r and r["unit"] == "image" and r["unit_price"] == 0.04,
   r and (r["unit"], r["unit_price"]))
ok("token 价仍在（每百万）", r and r["input"] == 2.0 and r["output"] == 12.0)

fwm = {"id": "flux-kontext-pro", "title": "FLUX.1 Kontext Pro", "type": "image",
       "provider": {"name": "Black Forest Labs"}, "cost": {"unitPrice": 0.003}, "contextLength": 0}
r = C.fireworks_row(fwm)
ok("Fireworks unitPrice → $0.003/张", r and r["unit"] == "image" and r["unit_price"] == 0.003,
   r and (r["unit"], r["unit_price"]))

print(f"\n结果: {'✅ 全部通过' if not fail_n else '❌ ' + str(fail_n) + ' 项失败'}  ({pass_n} passed, {fail_n} failed)")
sys.exit(1 if fail_n else 0)
