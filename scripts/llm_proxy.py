#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
上传识别的本地 LLM 代理（零第三方依赖）

作用：页面「AI 补识别」不直接连厂商 API，而是连本机这个小服务，由它转发请求。
好处：
  1. 绕开浏览器 CORS（多数厂商 API 不允许 file:// / 跨域直连）
  2. API Key 只留在本机进程里，不写入浏览器、不会随页面导出泄漏
  3. 同一套 OpenAI 兼容协议，换厂商只需改命令行参数

用法：
  python3 scripts/llm_proxy.py --provider siliconflow --key sk-xxx
  python3 scripts/llm_proxy.py --endpoint https://api.deepseek.com/v1/chat/completions \
                               --key sk-xxx --model deepseek-chat --port 8787

浏览器端只需在「AI 设置」里选「本地代理」，地址填 http://127.0.0.1:8787/extract
"""
import argparse, json, os, sys, urllib.request, urllib.error

PROVIDERS = {
    "siliconflow": ("https://api.siliconflow.cn/v1/chat/completions",
                    "deepseek-ai/DeepSeek-V4.1-Flash"),
    "deepseek":    ("https://api.deepseek.com/v1/chat/completions", "deepseek-chat"),
    "openai":      ("https://api.openai.com/v1/chat/completions", "gpt-4o-mini"),
    "zhipu":       ("https://open.bigmodel.cn/api/paas/v4/chat/completions", "glm-4-flash"),
    "moonshot":    ("https://api.moonshot.cn/v1/chat/completions", "moonshot-v1-8k"),
    "qwen":        ("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                    "qwen-plus"),
    "openrouter":  ("https://openrouter.ai/api/v1/chat/completions",
                    "deepseek/deepseek-v4-flash"),
}


def main():
    ap = argparse.ArgumentParser(description="本地 LLM 代理（用于上传文件的 AI 补识别）")
    ap.add_argument("--provider", default="", help="预设厂商：" + "/".join(PROVIDERS))
    ap.add_argument("--endpoint", default="", help="OpenAI 兼容的 chat/completions 地址")
    ap.add_argument("--model", default="", help="模型名（覆盖 provider 默认值）")
    ap.add_argument("--key", default=os.environ.get("LLM_KEY", ""), help="API Key")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--timeout", type=int, default=120)
    args = ap.parse_args()

    if args.provider:
        if args.provider not in PROVIDERS:
            sys.exit(f"未知 provider: {args.provider}，可选: {list(PROVIDERS)}")
        ep, mdl = PROVIDERS[args.provider]
    else:
        ep, mdl = "", ""
    endpoint = args.endpoint or ep
    model = args.model or mdl
    if not endpoint:
        sys.exit("必须指定 --provider 或 --endpoint")
    key = args.key or os.environ.get("LLM_API_KEY", "")
    if not key:
        sys.exit("缺少 API Key：用 --key sk-xxx 或设置环境变量 LLM_KEY")

    print(f"[llm_proxy] 监听 http://127.0.0.1:{args.port}")
    print(f"[llm_proxy] 转发到 {endpoint}")
    print(f"[llm_proxy] 默认模型 {model}")
    print("[llm_proxy] Ctrl+C 退出")

    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass                      # 静默，避免刷屏

        def _origin_ok(self):
            """只服务本机页面：file://（Origin: null）、127.0.0.1、localhost。
            否则任意网页都能驱动这个代理消耗你的 Key。"""
            o = self.headers.get("Origin")
            return (not o) or o == "null" or o.startswith(
                ("http://127.0.0.1", "http://localhost", "http://[::1]"))

        def _cors(self):
            o = self.headers.get("Origin")
            self.send_header("Access-Control-Allow-Origin",
                             o if (o and self._origin_ok()) else "null")
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

        def _json(self, obj, code=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not self._origin_ok():
                return self._json(dict(error="origin not allowed"), 403)
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self.path.startswith("/health"):
                self._json(dict(ok=True, endpoint=endpoint, model=model))
            else:
                self._json(dict(error="用 POST /extract"), 404)

        def do_POST(self):
            if not self._origin_ok():
                return self._json(dict(error="origin not allowed"), 403)
            if not self.path.startswith("/extract"):
                return self._json(dict(error="not found"), 404)
            try:
                n = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(n).decode("utf-8"))
            except Exception as e:
                return self._json(dict(error=f"请求体解析失败: {e}"), 400)

            payload = {
                "model": req.get("model") or model,
                "messages": req.get("messages") or [],
                "temperature": req.get("temperature", 0),
                "stream": False,
            }
            if req.get("max_tokens"):
                payload["max_tokens"] = req["max_tokens"]
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
            extra = req.get("extra_headers") or {}
            if isinstance(extra, dict):
                headers.update({str(k): str(v) for k, v in extra.items()})
            try:
                r = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
                with urllib.request.urlopen(r, timeout=args.timeout) as resp:
                    txt = resp.read().decode("utf-8", errors="ignore")
                j = json.loads(txt)
                content = ((j.get("choices") or [{}])[0].get("message") or {}).get("content")
                if content is None:
                    content = (j.get("choices") or [{}])[0].get("text", "")
                usage = j.get("usage") or {}
                self._json(dict(content=content, usage=usage, model=payload["model"]))
            except urllib.error.HTTPError as e:
                self._json(dict(error=f"上游 {e.code}: {e.read().decode('utf-8', 'ignore')[:500]}"), 502)
            except Exception as e:
                self._json(dict(error=f"{type(e).__name__}: {e}"), 502)

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), H)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[llm_proxy] 已停止")


if __name__ == "__main__":
    main()
