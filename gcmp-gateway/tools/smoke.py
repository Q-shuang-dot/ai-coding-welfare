# -*- coding: utf-8 -*-
"""对运行中的网关做全模型冒烟测试。

用法:
  python tools/smoke.py              # 全部逻辑模型，非流式
  python tools/smoke.py --stream     # 流式
  python tools/smoke.py opus-5 cheap # 只测指定模型
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

GW = "http://127.0.0.1:15900"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PROMPT = "只回复两个字：收到"


def get_models():
    with OPENER.open(GW + "/v1/models", timeout=10) as r:
        return [m["id"] for m in json.load(r)["data"]]


def ask(model, stream, max_tokens, timeout):
    body = json.dumps({
        "model": model, "stream": stream, "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": PROMPT}],
    }).encode()
    req = urllib.request.Request(GW + "/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    t0 = time.time()
    try:
        r = OPENER.open(req, timeout=timeout)
        raw = r.read().decode("utf-8", "replace")
        hdr = r.headers
    except urllib.error.HTTPError as e:
        return {"ok": False, "latency": time.time() - t0,
                "error": f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:160]}"}
    except Exception as e:
        return {"ok": False, "latency": time.time() - t0,
                "error": f"{type(e).__name__}: {str(e)[:120]}"}

    text = ""
    if stream:
        for line in raw.splitlines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                d = json.loads(payload)
            except Exception:
                continue
            for ch in d.get("choices") or []:
                delta = ch.get("delta") or {}
                text += delta.get("content") or ""
    else:
        try:
            d = json.loads(raw)
            msg = ((d.get("choices") or [{}])[0].get("message") or {})
            text = msg.get("content") or msg.get("reasoning_content") or ""
        except Exception:
            text = raw[:160]
    return {
        "ok": bool(text.strip()),
        "latency": time.time() - t0,
        "text": text.strip()[:60] or "(空回复)",
        "upstream": hdr.get("X-Gateway-Upstream", "?"),
        "model": hdr.get("X-Gateway-Model", "?"),
        "swapped": hdr.get("X-Gateway-Served-Model"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="*", help="留空则测全部")
    ap.add_argument("--stream", action="store_true")
    ap.add_argument("--max-tokens", type=int, default=512,
                    help="思考模型给少了会空回复，默认 512")
    ap.add_argument("--timeout", type=int, default=180)
    args = ap.parse_args()

    try:
        available = get_models()
    except Exception as e:
        print(f"网关不可达 {GW}: {e}")
        return 2
    targets = args.models or available
    unknown = [m for m in targets if m not in available]
    if unknown:
        print(f"网关没有这些模型: {', '.join(unknown)}")
        print(f"可用: {', '.join(available)}")
        return 2

    mode = "流式" if args.stream else "非流式"
    print(f"冒烟测试 {len(targets)} 个模型（{mode}, max_tokens={args.max_tokens}）\n")
    failed = []
    for m in targets:
        r = ask(m, args.stream, args.max_tokens, args.timeout)
        if r["ok"]:
            swap = f"  ⚠ 实际模型 {r['swapped']}" if r.get("swapped") else ""
            print(f"  ✅ {m:12} {r['latency']:5.1f}s  [{r['upstream']}/{r['model']}]  "
                  f"{r['text']}{swap}")
        else:
            failed.append(m)
            print(f"  ❌ {m:12} {r['latency']:5.1f}s  {r.get('error') or r.get('text')}")
    print(f"\n{len(targets) - len(failed)}/{len(targets)} 通过"
          + (f"，失败: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
