# -*- coding: utf-8 -*-
"""列出每个上游当前 /models 返回的模型，并标出 config 里路由引用了但该上游已不提供的模型。

用法:
  python tools/list_models.py                 # 所有未禁用上游
  python tools/list_models.py seekai anymodel # 指定上游
"""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gateway as gw  # noqa: E402


def fetch_models(up, timeout=25):
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
               "Authorization": "Bearer " + (up.get("apiKey") or "")}
    headers.update(up.get("headers") or {})
    req = urllib.request.Request(up["baseUrl"].rstrip("/") + "/models",
                                 headers=headers, method="GET")
    opener = gw.make_opener(up)
    try:
        with opener.open(req, timeout=timeout) as r:
            j = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode('utf-8','replace')[:80]}"
    except Exception as e:
        return None, f"{type(e).__name__}: {str(e)[:80]}"
    ids = [m.get("id") for m in (j.get("data") or []) if m.get("id")]
    return sorted(ids), None


def main():
    cfg = gw.load_config()
    ups = cfg.get("upstreams") or {}
    # 收集每个上游被路由引用的模型
    routed = {}
    for m in cfg.get("models", []):
        for e in (m.get("route") or []):
            routed.setdefault(e["upstream"], set()).add(e["model"])

    only = sys.argv[1:]
    names = [u for u in ups if (not only or u in only) and not ups[u].get("disabled")]
    for name in names:
        up = ups[name]
        ids, err = fetch_models(up)
        refs = routed.get(name, set())
        print(f"\n=== {name}  ({up['baseUrl']}) ===")
        if err:
            print(f"  ❌ /models 失败: {err}")
            if refs:
                print(f"  路由引用: {', '.join(sorted(refs))}（无法核对）")
            continue
        print(f"  共 {len(ids)} 个: {', '.join(ids) if ids else '(空)'}")
        missing = sorted(r for r in refs if ids and r not in ids)
        if missing:
            print(f"  ⚠ 路由引用但列表里没有: {', '.join(missing)}")
        elif refs:
            print(f"  ✓ 路由引用的 {len(refs)} 个都在列表里")
    return 0


if __name__ == "__main__":
    sys.exit(main())
