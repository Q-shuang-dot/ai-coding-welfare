# -*- coding: utf-8 -*-
"""按逻辑模型逐条实测 route 里的每个上游，找出慢的/坏的/被静默换模型的条目。

只测纯文本（vision:true 的条目会带一张 1px 图），直连上游，不经过网关，
所以不受粘性/熔断影响，能看到每条路由自己的真实表现。

用法:
  python tools/audit_routes.py                 # 全部模型
  python tools/audit_routes.py deepseek cheap  # 指定模型
  python tools/audit_routes.py --timeout 60
    python tools/audit_routes.py --tools         # 同时验证 Function Calling
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gateway as gw  # noqa: E402

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="*")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--tools", action="store_true",
                    help="额外验证 Function Calling，并提示建议 noTools 的路由")
    args = ap.parse_args()

    cfg = gw.load_config()
    ups = cfg.get("upstreams") or {}
    models = [m for m in cfg.get("models", [])
              if not args.models or m["id"] in args.models]
    if not models:
        print(f"没找到模型，可用: {', '.join(m['id'] for m in cfg.get('models', []))}")
        return 2

    bad, slow, swapped, no_tools = [], [], [], []
    for m in models:
        print(f"\n{m['id']}  （{len(m.get('route') or [])} 条路由）")
        for i, entry in enumerate(m.get("route") or [], 1):
            up = ups.get(entry["upstream"])
            key = f"{entry['upstream']}/{entry['model']}"
            if not up:
                print(f"  {i}. ❌ {key:52} 上游未定义")
                bad.append((m["id"], key, "上游未定义"))
                continue
            r = gw.audit_route(up, entry, args.timeout, args.tools)
            if not r["ok"]:
                print(f"  {i}. ❌ {key:52} {r['latency']:5.1f}s  {r.get('error') or r.get('snippet')}")
                bad.append((m["id"], key, r.get("error") or r.get("snippet")))
                continue
            notes = []
            if r.get("swapped"):
                notes.append(f"⚠ 实际 {r['served']}")
                swapped.append((m["id"], key, r["served"]))
            tools = r.get("tools") or {}
            if tools.get("suggest_no_tools"):
                detail = tools.get("error") or "未返回 tool_calls"
                notes.append(f"🧰 建议 noTools（{detail}）")
                no_tools.append((m["id"], key, detail))
            elif tools.get("tool_calls"):
                delta = tools.get("prompt_delta")
                notes.append("🧰 tools ✓" + (f" Δin={delta}" if delta is not None else ""))
            if r["latency"] > 20:
                notes.append("🐢 慢")
                slow.append((m["id"], key, round(r["latency"], 1)))
            print(f"  {i}. ✅ {key:52} {r['latency']:5.1f}s  {r['snippet']}"
                  + ("  " + " ".join(notes) if notes else ""))

    print("\n" + "=" * 72)
    if bad:
        print(f"失效路由 {len(bad)} 条（建议从 config.json 剔除或下移）:")
        for mid, key, err in bad:
            print(f"  {mid:10} {key:52} {err}")
    if swapped:
        print(f"被静默换后端 {len(swapped)} 条:")
        for mid, key, served in swapped:
            print(f"  {mid:10} {key:52} → {served}")
    if slow:
        print(f"超过 20s 的慢路由 {len(slow)} 条:")
        for mid, key, sec in slow:
            print(f"  {mid:10} {key:52} {sec}s")
    if no_tools:
        print(f"建议标记 noTools 的路由 {len(no_tools)} 条:")
        for mid, key, detail in no_tools:
            print(f"  {mid:10} {key:52} {detail}")
    if not (bad or swapped or slow or no_tools):
        print("全部路由正常")
    return 0


if __name__ == "__main__":
    sys.exit(main())
