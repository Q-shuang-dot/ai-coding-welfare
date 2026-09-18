# -*- coding: utf-8 -*-
"""GCMP 聚合网关：OpenAI 兼容接口，按逻辑模型做多上游故障转移。

用法: python gateway.py  (配置在同目录 config.json，修改后自动热加载)
接口: GET /v1/models  POST /v1/chat/completions  GET /health
特性: 顺序故障转移、粘性上游、429 单次延迟重试、noStream 上游合成 SSE、
      按请求是否含图片自动分流（route 的 vision 字段）、空回复转移、
      上游静默换模型检测、per-路由熔断、调用统计
"""
import json
import http.client
import os
import re
import secrets
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "config.json")
ADMIN_HTML = os.path.join(BASE, "admin.html")
LEARN_HTML = os.path.join(BASE, "learn.html")
LEARN_PATH = os.path.join(BASE, "learn-progress.json")
SKILLS_DIR = os.path.join(BASE, ".github", "skills")
MAX_SKILL_BYTES = 64 * 1024
MAX_SKILL_PROMPT_BYTES = 128 * 1024
CONFIG_MTIME = 0.0
CONFIG_LOCK = threading.Lock()
STICKY = {}          # 逻辑模型 -> 上次成功的上游名，下次优先
STICKY_LOCK = threading.Lock()
HEALTH = {}          # 上游名 -> {"status","latency","checked_at","error"}
HEALTH_LOCK = threading.Lock()
RECENT_LOGS = []     # 管理页展示用的环形日志
BRIDGE_PROC = None   # 由本进程拉起的 codex-bridge 子进程
RATE = {}            # 上游名 -> [时间戳,...]，per-upstream 令牌窗
RATE_LOCK = threading.Lock()
BREAK = {}           # "上游/模型" -> {"fails","open_until","reason"}，路由级熔断
BREAK_LOCK = threading.Lock()
STATS = {}           # "上游/模型" -> 调用计数/延迟/token 累计
STATS_LOCK = threading.Lock()
STATS_PATH = os.path.join(BASE, "stats.json")

SSL_CTX = ssl.create_default_context()


def _parse_jsonc(content):
    """Parse VS Code JSONC (JSON + comments + trailing commas) into Python dict."""
    out = []
    i, n = 0, len(content)
    in_str = esc = False
    while i < n:
        c = content[i]
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            i += 1
        elif c == '"':
            in_str = True; out.append(c); i += 1
        elif c == '/' and i + 1 < n:
            if content[i + 1] == '/':
                # line comment — skip to end of line
                while i < n and content[i] != '\n':
                    i += 1
            elif content[i + 1] == '*':
                # block comment — skip to */
                i += 2
                while i < n - 1 and not (content[i] == '*' and content[i + 1] == '/'):
                    i += 1
                i += 2
            else:
                out.append(c); i += 1
        else:
            out.append(c); i += 1
    cleaned = ''.join(out)
    # remove trailing commas before } or ]
    cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
    return json.loads(cleaned)


def _parse_toml(content):
    """极简 TOML 解析：只读顶层 key = value 对，忽略 [section] 行。"""
    result = {}
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('['):
            continue
        if '=' not in line:
            continue
        k, _, v = line.partition('=')
        k = k.strip()
        v = v.strip()
        if v.startswith('"') and v.endswith('"'):
            v = v[1:-1]
        elif v.lower() in ('true', 'false'):
            v = v.lower() == 'true'
        else:
            try:
                v = int(v)
            except ValueError:
                try:
                    v = float(v)
                except ValueError:
                    pass
        result[k] = v
    return result


def _jsonc_value_end(content, start):
    """Return the index of the character after a JSON value that begins at *start*,
    or -1 if not found. Handles nested objects/arrays and string literals."""
    depth = 0; i = start; n = len(content); in_str = esc = False
    while i < n:
        c = content[i]
        if in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif c == '"':
            in_str = True
        elif c in '[{':
            depth += 1
        elif c in ']}':
            depth -= 1
            if depth <= 0:
                return i
        i += 1
    return -1


def load_config():
    global CONFIG, CONFIG_MTIME
    m = os.path.getmtime(CONFIG_PATH)
    if m != CONFIG_MTIME or "CONFIG" not in globals():
        with CONFIG_LOCK:
            if m != CONFIG_MTIME or "CONFIG" not in globals():
                # utf-8-sig：兼容记事本/PowerShell 保存时带的 BOM，无 BOM 也能正常读
                with open(CONFIG_PATH, encoding="utf-8-sig") as f:
                    CONFIG = json.load(f)
                CONFIG_MTIME = m
                print(f"[cfg] 已加载配置 ({len(CONFIG.get('models', []))} 个逻辑模型)", flush=True)
    return CONFIG


def upstream_rate_limit(up_name, limit=5, window=60.0, max_wait=0.0):
    """per-upstream 滑动窗口限流。拿不到名额时最多等 max_wait 秒（max_wait=0 即
    立刻放弃、让调用方换下一家上游）。拿到名额返回 True。"""
    deadline = time.time() + max_wait
    notified = False
    while True:
        with RATE_LOCK:
            now = time.time()
            q = RATE.setdefault(up_name, [])
            # 丢弃窗口外的旧记录
            while q and q[0] <= now - window:
                q.pop(0)
            if len(q) < limit:
                q.append(now)
                return True
            free_at = q[0] + window
        if free_at > deadline:
            return False
        if not notified:
            log(f"{up_name} 触及本地限流 {limit}次/{int(window)}秒，排队等 {free_at - now:.1f}s")
            notified = True
        time.sleep(min(free_at - now + 0.05, 2.0))


def rate_limit_block(up_name, limit, window):
    """上游回了真 429 → 把本地窗口填满，本窗口内后续请求直接跳过它换下一家，
    别再拿真实配额去试探。"""
    with RATE_LOCK:
        RATE[up_name] = [time.time()] * max(int(limit), 1)


def breaker_cfg():
    b = (CONFIG.get("breaker") or {}) if "CONFIG" in globals() else {}
    return {
        "enabled": b.get("enabled", True),
        "threshold": int(b.get("threshold") or 3),
        "cooldown": float(b.get("cooldown") or 300),
    }


def breaker_open(key):
    """该路由是否处于熔断冷却期。返回剩余秒数，0 表示可用。"""
    bc = breaker_cfg()
    if not bc["enabled"]:
        return 0
    with BREAK_LOCK:
        st = BREAK.get(key)
        if not st:
            return 0
        left = st.get("open_until", 0) - time.time()
        if left <= 0:
            if st.get("open_until"):
                # 冷却到期 → 半开：只放一次真实请求试探，再失败立刻重新熔断，
                # 不能归零 fails，否则死路由每轮冷却后都要再白试满 threshold 次
                st["open_until"] = 0
                st["fails"] = max(bc["threshold"] - 1, 0)
            return 0
        return left


def breaker_fail(key, reason):
    """记一次失败。连续失败达阈值 → 打开熔断，冷却期内该路由直接跳过。"""
    bc = breaker_cfg()
    if not bc["enabled"]:
        return
    with BREAK_LOCK:
        st = BREAK.setdefault(key, {"fails": 0, "open_until": 0, "reason": ""})
        st["fails"] += 1
        st["reason"] = reason[:120]
        if st["fails"] >= bc["threshold"] and st["open_until"] <= time.time():
            st["open_until"] = time.time() + bc["cooldown"]
            log(f"[熔断] {key} 连续失败 {st['fails']} 次，冷却 {int(bc['cooldown'])}s：{reason[:60]}")


def breaker_ok(key):
    with BREAK_LOCK:
        if key in BREAK:
            BREAK.pop(key)


def breaker_snapshot():
    with BREAK_LOCK:
        return {k: dict(v) for k, v in BREAK.items()}


def breaker_restore(saved, live=None):
    """恢复仍在冷却期内的熔断记录。已过期的不恢复，避免重启后拿旧账
    惩罚一条其实已经恢复的路由。"""
    now = time.time()
    kept = 0
    with BREAK_LOCK:
        for k, v in (saved or {}).items():
            if live is not None and k not in live:
                continue
            if not isinstance(v, dict) or (v.get("open_until") or 0) <= now:
                continue
            BREAK[k] = {"fails": int(v.get("fails") or 0),
                        "open_until": float(v["open_until"]),
                        "reason": str(v.get("reason") or "")[:120]}
            kept += 1
    if kept:
        log(f"[熔断] 已恢复 {kept} 条仍在冷却中的路由")


def cache_tokens(usage):
    """从 usage 里取缓存命中/写入的 token 数，返回 (read, write)。

    各家字段名不同：OpenAI/DeepSeek 系放在 prompt_tokens_details.cached_tokens，
    Anthropic 系用顶层 cache_read_input_tokens。缺失一律按 0。
    """
    if not isinstance(usage, dict):
        return 0, 0
    det = usage.get("prompt_tokens_details")
    det = det if isinstance(det, dict) else {}

    def pick(*names):
        for src in (det, usage):
            for n in names:
                v = src.get(n)
                if isinstance(v, (int, float)) and v > 0:
                    return int(v)
        return 0

    return (pick("cached_tokens", "cache_read_input_tokens"),
            pick("cache_write_tokens", "cache_creation_input_tokens"))


def upstream_pricing(up, model=None):
    """上游的计价配置。缺失或不完整返回 None（表示成本未知，不做估算）。

    per_call:  {"type":"per_call","price":0.3}                每次调用固定价（美元）
    per_token: {"type":"per_token","in":15,"out":75,"cachedIn":1.5}
               单位是「美元 / 每百万 token」，cachedIn 缺省按 in 的 10% 算
    同一上游各模型价格不同时，用 models 子表覆盖默认值：
      {"type":"per_token","in":2,"out":6,"models":{"glm-5.3":{"in":3,"out":12}}}
    """
    p = (up or {}).get("pricing")
    if not isinstance(p, dict):
        return None
    override = (p.get("models") or {}).get(model or "")
    if isinstance(override, dict):
        p = {**p, **override}
    kind = p.get("type")
    if kind == "per_call":
        price = p.get("price")
        return {"type": "per_call", "price": float(price)} if price is not None else None
    if kind == "per_token":
        if p.get("in") is None and p.get("out") is None:
            return None
        pin = float(p.get("in") or 0)
        pout = float(p.get("out") or 0)
        cached = p.get("cachedIn")
        return {"type": "per_token", "in": pin, "out": pout,
                "cachedIn": float(cached) if cached is not None else pin * 0.1}
    return None


def estimate_cost(up, usage, model=None):
    """估算单次调用花费（美元）。上游没配 pricing 就返回 None。"""
    p = upstream_pricing(up, model)
    if not p:
        return None
    if p["type"] == "per_call":
        return p["price"]
    if not isinstance(usage, dict):
        return None
    pin = int(usage.get("prompt_tokens") or 0)
    pout = int(usage.get("completion_tokens") or 0)
    read, _ = cache_tokens(usage)
    # 命中缓存的部分单独用 cachedIn 折价，剩下的按全价
    read = min(read, pin)
    fresh = pin - read
    return (fresh * p["in"] + read * p["cachedIn"] + pout * p["out"]) / 1_000_000


def stats_record(key, ok, latency, usage=None, served=None, cost=None):
    """累计每条路由的调用数据，供管理页成本面板使用。"""
    with STATS_LOCK:
        s = STATS.setdefault(key, {"calls": 0, "ok": 0, "fail": 0, "latency_sum": 0.0,
                                   "latency_max": 0.0, "prompt_tokens": 0,
                                   "completion_tokens": 0, "last_at": 0, "served": ""})
        s["calls"] += 1
        s["ok" if ok else "fail"] += 1
        s["latency_sum"] += latency
        s["latency_max"] = max(s["latency_max"], round(latency, 1))
        s["last_at"] = int(time.time())
        recent = s.setdefault("recent", [])
        recent.append({"ok": bool(ok), "latency": round(latency, 3), "cost": cost})
        if len(recent) > 50:
            del recent[:-50]
        if served:
            s["served"] = served
        if isinstance(usage, dict):
            s["prompt_tokens"] += int(usage.get("prompt_tokens") or 0)
            s["completion_tokens"] += int(usage.get("completion_tokens") or 0)
            read, write = cache_tokens(usage)
            if read:
                s["cached_tokens"] = s.get("cached_tokens", 0) + read
            if write:
                s["cache_write_tokens"] = s.get("cache_write_tokens", 0) + write
        if cost is not None:
            s["cost"] = round(s.get("cost", 0.0) + cost, 6)


def stats_snapshot():
    with STATS_LOCK:
        out = {}
        for k, s in STATS.items():
            recent = s.get("recent") if isinstance(s.get("recent"), list) else []
            recent_ok = sum(1 for x in recent if x.get("ok"))
            recent_cost = sum(float(x.get("cost") or 0) for x in recent)
            recent_latency = sum(float(x.get("latency") or 0) for x in recent)
            out[k] = {**s,
                      "avg_latency": round(s["latency_sum"] / s["calls"], 2)
                      if s["calls"] else 0,
                      "recent_calls": len(recent),
                      "recent_ok": recent_ok,
                      "recent_success_rate": round(recent_ok / len(recent) * 100) if recent else 0,
                      "recent_cost": round(recent_cost, 6),
                      "recent_avg_latency": round(recent_latency / len(recent), 2)
                      if recent else 0}
        return out


def stats_save():
    try:
        tmp = STATS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"saved_at": int(time.time()), "routes": stats_snapshot(),
                       "breaker": breaker_snapshot()},
                      f, ensure_ascii=False, indent=1)
        os.replace(tmp, STATS_PATH)
    except Exception as e:
        log(f"[stats] 保存失败: {e}")


def stats_load(cfg=None):
    """恢复历史统计。config 里已删掉的路由不再载入，否则成本面板会一直把
    早已下线的上游算进总账。"""
    try:
        if not os.path.exists(STATS_PATH):
            return
        with open(STATS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        live = None
        if cfg:
            live = {f"{e['upstream']}/{e['model']}"
                    for m in (cfg.get("models") or []) for e in (m.get("route") or [])}
        dropped = 0
        with STATS_LOCK:
            for k, s in (data.get("routes") or {}).items():
                if live is not None and k not in live:
                    dropped += 1
                    continue
                s.pop("avg_latency", None)
                STATS[k] = s
        log(f"[stats] 已恢复 {len(STATS)} 条路由统计"
            + (f"，跳过 {dropped} 条已下线路由" if dropped else ""))
        breaker_restore(data.get("breaker"), live)
    except Exception as e:
        log(f"[stats] 读取失败: {e}")


def stats_worker(interval=120):
    while True:
        time.sleep(interval)
        stats_save()


_NORM_RE = re.compile(r"[^a-z0-9]+")
_IPV4_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
_SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
KEY_MASK = "\u2022" * 6   # 圆点，真实 key 不会包含，可据此识别掩码回传


def mask_key(k):
    if not k:
        return ""
    return k[:6] + KEY_MASK + k[-4:] if len(k) > 12 else KEY_MASK


def is_masked(k):
    return bool(k) and KEY_MASK in k


def public_config(cfg):
    """给管理页的配置：apiKey 掩码化；保留示例/占位配置以便开箱即用。"""
    keep = []
    for name, up in (cfg.get("upstreams") or {}).items():
        if not isinstance(up, dict):
            continue
        u = dict(up)
        key = (u.get("apiKey") or "").strip()
        if key:
            u["apiKey"] = mask_key(key)
        else:
            u["apiKey"] = u.get("apiKey", "")
        keep.append((name, u))
    ups = {}
    for name, u in keep:
        ups[name] = u
    out = {**cfg, "upstreams": ups}
    acc = dict(cfg.get("access") or {})
    if acc.get("apiKey"):
        acc["apiKey"] = mask_key(acc["apiKey"])
    out["access"] = acc
    return out


def unmask_keys(new_cfg, old_cfg):
    """管理页回传掩码 key 时还原真实 key。按掩码值反查，因此上游改名也不丢 key。"""
    old_ups = old_cfg.get("upstreams") or {}
    lookup = {mask_key(u["apiKey"]): u["apiKey"] for u in old_ups.values() if u.get("apiKey")}
    for name, up in (new_cfg.get("upstreams") or {}).items():
        if is_masked(up.get("apiKey")):
            up["apiKey"] = lookup.get(up["apiKey"]) or (old_ups.get(name) or {}).get("apiKey", "")
    old_acc = old_cfg.get("access") or {}
    new_acc = new_cfg.get("access")
    if isinstance(new_acc, dict) and is_masked(new_acc.get("apiKey")):
        new_acc["apiKey"] = old_acc.get("apiKey", "")
    return new_cfg


def parse_host(raw):
    h = (raw or "").strip()
    if h.startswith("["):                       # [::1]:15800
        end = h.find("]")
        return h[1:end].lower() if end > 0 else ""
    return h.split(":")[0].lower()


def host_allowed(raw, cfg):
    """拒绝用域名访问本网关。

    DNS rebinding：恶意站点把自己的域名重解析到 127.0.0.1，其 JS 就能同源读取
    /admin/api/config 拿走全部密钥。浏览器发出的 Host 是攻击者域名，而直连 IP
    的 Host 永远是 IP，据此即可区分。
    """
    h = parse_host(raw)
    if not h:
        return False
    if h == "localhost" or h in {x.lower() for x in
                                 ((cfg.get("admin") or {}).get("allowHosts") or [])}:
        return True
    return bool(_IPV4_RE.match(h)) or ":" in h


def _skill_record(name, root=None):
    """读取一个受限的项目 Skill；非法路径、链接和无效 frontmatter 一律忽略。"""
    if not isinstance(name, str) or not _SKILL_NAME_RE.fullmatch(name):
        return None
    root = os.path.abspath(root or SKILLS_DIR)
    folder = os.path.join(root, name)
    path = os.path.join(folder, "SKILL.md")
    try:
        if os.path.islink(folder) or os.path.islink(path) or not os.path.isdir(folder):
            return None
        real_root, real_path = os.path.realpath(root), os.path.realpath(path)
        if os.path.commonpath((real_root, real_path)) != real_root:
            return None
        with open(path, "rb") as f:
            raw = f.read(MAX_SKILL_BYTES + 1)
        if not raw or len(raw) > MAX_SKILL_BYTES:
            return None
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        return None
    try:
        end = lines.index("---", 1)
    except ValueError:
        return None
    meta = {}
    for line in lines[1:end]:
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip('"\'')
    if meta.get("name") != name:
        return None
    body = "\n".join(lines[end + 1:]).strip()
    if not body:
        return None
    return {"name": name, "description": meta.get("description", ""),
            "display_name": meta.get("display_name", ""),
            "display_description": meta.get("display_description", ""),
            "size": len(raw), "body": body}


def _skill_records(root=None):
    root = os.path.abspath(root or SKILLS_DIR)
    try:
        names = sorted(entry.name for entry in os.scandir(root)
                       if entry.is_dir(follow_symlinks=False))
    except OSError:
        return {}
    return {name: record for name in names
            if (record := _skill_record(name, root)) is not None}


def skills_snapshot():
    """提供给本机管理页的受限元数据；正文只在实际请求时读取。"""
    return [{key: record[key] for key in
             ("name", "description", "display_name", "display_description", "size")}
            for record in _skill_records().values()]


def apply_model_skills(req, mdef):
    """为模型绑定的 Skills 构造一份带首条系统消息的请求副本。"""
    names = mdef.get("skills") if isinstance(mdef, dict) else None
    if not isinstance(names, list):
        return req
    records, selected, used = _skill_records(), [], set()
    total = 0
    for name in names:
        if not isinstance(name, str) or name in used:
            continue
        record = records.get(name)
        if not record:
            continue
        chunk = f"[Project skill: {name}]\n{record['body']}"
        size = len(chunk.encode("utf-8"))
        if total + size > MAX_SKILL_PROMPT_BYTES:
            break
        selected.append(chunk)
        used.add(name)
        total += size
    if not selected:
        return req
    message = {"role": "system", "content":
               "Project skills selected by the local gateway follow. "
               "Treat them as additional system instructions.\n\n" + "\n\n".join(selected)}
    return {**req, "messages": [message, *(req.get("messages") or [])]}


def model_mismatch(asked, served):
    """上游实际返回的模型是否与请求的不是同一个（中转站静默换后端）。

    只做保守判断：归一化后互为子串就算一致（claude-opus-5 vs
    claude-opus-5-20260101 属于正常的版本后缀）。
    """
    if not asked or not served:
        return False
    a = _NORM_RE.sub("", asked.lower())
    b = _NORM_RE.sub("", served.lower())
    if not a or not b:
        return False
    return a not in b and b not in a


def log(msg):
    line = time.strftime("[%H:%M:%S] ") + msg
    RECENT_LOGS.append(line)
    if len(RECENT_LOGS) > 300:
        del RECENT_LOGS[:150]
    print(line, flush=True)


def bridge_cfg():
    b = (CONFIG.get("bridge") or {}) if "CONFIG" in globals() else {}
    return {
        "enabled": bool(b.get("enabled")),
        "script": b.get("script") or os.path.join("codex-bridge", "bridge.py"),
        "port": int(b.get("port") or 15731),
    }


def bridge_port_busy(port):
    with socket.socket() as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


_BRIDGE_PROBE = {"ts": 0.0, "busy": False}


def bridge_status():
    b = bridge_cfg()
    owned = BRIDGE_PROC is not None and BRIDGE_PROC.poll() is None
    # 探端口最坏要等满 0.4s 超时，管理页每次刷新都调它，缓存 2 秒免得白等
    now = time.time()
    if now - _BRIDGE_PROBE["ts"] > 2:
        _BRIDGE_PROBE["ts"] = now
        _BRIDGE_PROBE["busy"] = bridge_port_busy(b["port"])
    running = owned or _BRIDGE_PROBE["busy"]
    return {"enabled": b["enabled"], "port": b["port"], "running": running,
            "managed": owned, "script": b["script"]}


def bridge_start():
    """拉起 codex-bridge。端口已占用视为已在运行，不重复启动。"""
    global BRIDGE_PROC
    b = bridge_cfg()
    if bridge_port_busy(b["port"]):
        log(f"[bridge] 端口 {b['port']} 已在监听，跳过启动")
        return True, "已在运行"
    script = b["script"]
    if not os.path.isabs(script):
        script = os.path.join(BASE, script)
    if not os.path.exists(script):
        log(f"[bridge] 启动失败: 找不到 {script}")
        return False, f"找不到 {script}"
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    BRIDGE_PROC = subprocess.Popen(
        [sys.executable, script], cwd=os.path.dirname(script),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=flags)
    for _ in range(20):
        time.sleep(0.25)
        if bridge_port_busy(b["port"]):
            log(f"[bridge] 已启动 PID={BRIDGE_PROC.pid} 端口 {b['port']}")
            return True, f"已启动 PID={BRIDGE_PROC.pid}"
    log("[bridge] 启动后 5 秒内未监听端口，可能启动失败")
    return False, "启动后未监听端口"


def bridge_stop():
    """只停本进程拉起的桥；外部手动起的交给 stop-bridge.bat。"""
    global BRIDGE_PROC
    if BRIDGE_PROC is not None and BRIDGE_PROC.poll() is None:
        BRIDGE_PROC.terminate()
        try:
            BRIDGE_PROC.wait(timeout=5)
        except subprocess.TimeoutExpired:
            BRIDGE_PROC.kill()
        log(f"[bridge] 已停止 PID={BRIDGE_PROC.pid}")
        BRIDGE_PROC = None
        return True, "已停止"
    BRIDGE_PROC = None
    if bridge_port_busy(bridge_cfg()["port"]):
        return False, "桥不是本网关启动的，请用 stop-bridge.bat 停止"
    return True, "本来就没在运行"


def make_opener(up):
    """按上游代理策略构建 opener：noProxy 或未配置代理时直连，否则走系统代理"""
    proxy = CONFIG.get("proxy")
    if up.get("noProxy") or not proxy:
        ph = urllib.request.ProxyHandler({})
    else:
        ph = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
    return urllib.request.build_opener(ph)


class _PooledResponse:
    """HTTPResponse 兼容包装；仅在响应完整消费后把连接归还池。"""

    def __init__(self, response, connection, release):
        self._response = response
        self._connection = connection
        self._release = release
        self._finished = False

    def __getattr__(self, name):
        return getattr(self._response, name)

    def _finish_if_complete(self):
        if self._response.isclosed():
            self._finish(not self._response.will_close and self._connection.sock is not None)

    def _finish(self, reusable):
        if self._finished:
            return
        self._finished = True
        self._release(self._connection, reusable)

    def read(self, amount=None):
        try:
            data = self._response.read(amount)
        except Exception:
            self._finish(False)
            raise
        self._finish_if_complete()
        return data

    def read1(self, amount=-1):
        try:
            data = self._response.read1(amount)
        except Exception:
            self._finish(False)
            raise
        self._finish_if_complete()
        return data

    def close(self):
        if self._finished:
            return
        reusable = self._response.isclosed() and not self._response.will_close \
            and self._connection.sock is not None
        try:
            self._response.close()
        finally:
            self._finish(reusable)


class PersistentConnectionPool:
    """按目标和代理隔离的有界连接池；同一连接同一时间只租给一个线程。"""

    def __init__(self, max_size=4, connection_factory=None):
        self.max_size = max(1, int(max_size))
        self._factory = connection_factory or self._new_connection
        self._condition = threading.Condition()
        self._idle = {}
        self._counts = {}

    @staticmethod
    def _spec(up, proxy):
        target = urllib.parse.urlsplit(up["baseUrl"])
        target_port = target.port or 443
        proxy_url = urllib.parse.urlsplit(proxy) if proxy else None
        return (target.hostname, target_port,
                proxy_url.hostname if proxy_url else None,
                proxy_url.port if proxy_url else None)

    @staticmethod
    def _new_connection(spec, timeout):
        target_host, target_port, proxy_host, proxy_port = spec
        if proxy_host:
            connection = http.client.HTTPSConnection(
                proxy_host, proxy_port, timeout=timeout, context=SSL_CTX)
            connection.set_tunnel(target_host, target_port)
            return connection
        return http.client.HTTPSConnection(
            target_host, target_port, timeout=timeout, context=SSL_CTX)

    def _acquire(self, spec, timeout):
        deadline = time.monotonic() + float(timeout)
        create = False
        with self._condition:
            while True:
                idle = self._idle.get(spec)
                if idle:
                    return idle.pop()
                count = self._counts.get(spec, 0)
                if count < self.max_size:
                    self._counts[spec] = count + 1
                    create = True
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("等待可用持久连接超时")
                self._condition.wait(remaining)
        if create:
            try:
                return self._factory(spec, timeout)
            except Exception:
                with self._condition:
                    self._counts[spec] -= 1
                    self._condition.notify()
                raise

    def _release(self, spec, connection, reusable):
        if not reusable:
            try:
                connection.close()
            finally:
                with self._condition:
                    self._counts[spec] -= 1
                    self._condition.notify()
            return
        with self._condition:
            self._idle.setdefault(spec, []).append(connection)
            self._condition.notify()

    def open(self, up, request, timeout, proxy=None):
        spec = self._spec(up, proxy)
        connection = self._acquire(spec, timeout)
        parsed = urllib.parse.urlsplit(request.full_url)
        path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
        headers = dict(request.header_items())
        try:
            connection.timeout = timeout
            if connection.sock is not None and hasattr(connection.sock, "settimeout"):
                connection.sock.settimeout(timeout)
            connection.request(request.get_method(), path, body=request.data, headers=headers)
            response = connection.getresponse()
        except Exception:
            self._release(spec, connection, False)
            raise
        wrapped = _PooledResponse(
            response, connection,
            lambda conn, reusable: self._release(spec, conn, reusable))
        if response.status >= 400:
            raise urllib.error.HTTPError(
                request.full_url, response.status, response.reason, response.headers, wrapped)
        return wrapped


JUSTWOKER_POOL = PersistentConnectionPool(max_size=4)


def open_upstream(up, request, timeout):
    """JustWoker 复用 CONNECT/TCP/TLS；其他上游保持 urllib 原路径。"""
    host = (urllib.parse.urlsplit(up.get("baseUrl") or "").hostname or "").lower()
    if host == "api.justwoker.icu":
        proxy = None if up.get("noProxy") else CONFIG.get("proxy")
        return JUSTWOKER_POOL.open(up, request, timeout, proxy)
    return make_opener(up).open(request, timeout=timeout)


def build_request(up, body_bytes, stream):
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if stream else "application/json",
        "User-Agent": "gcmp-gateway/1.0",
    }
    headers.update(up.get("headers") or {})
    if up.get("protocol") == "anthropic":
        # Anthropic 原生端点：缺 anthropic-version 会被 Cloudflare 403
        headers["anthropic-version"] = "2023-06-01"
        if up.get("apiKey"):
            headers["x-api-key"] = up["apiKey"]
        # baseUrl 已含 /v1，默认端点 /messages
        url = up["baseUrl"].rstrip("/") + (up.get("chatPath") or "/messages")
    else:
        if up.get("apiKey"):
            headers["Authorization"] = "Bearer " + up["apiKey"]
        # 默认 /chat/completions；个别上游该路径被 WAF 封禁时可用 chatPath 覆盖
        url = up["baseUrl"].rstrip("/") + (up.get("chatPath") or "/chat/completions")
    return urllib.request.Request(url, data=body_bytes, headers=headers, method="POST")


def _compact_tool_value(value, description_limit):
    """精简工具 Schema 的提示词开销，不改变工具集合或参数约束。"""
    if isinstance(value, list):
        return [_compact_tool_value(item, description_limit) for item in value]
    if not isinstance(value, dict):
        return value
    compact = {}
    for key, item in value.items():
        if key == "title":
            continue
        if key == "description" and isinstance(item, str):
            item = " ".join(item.split())
            if len(item) > description_limit:
                item = item[:description_limit].rstrip()
        compact[key] = _compact_tool_value(item, description_limit)
    return compact


def _selected_tool_name(body):
    choice = body.get("tool_choice")
    if isinstance(choice, dict):
        function = choice.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            return function["name"]
        if choice.get("type") == "function" and isinstance(choice.get("name"), str):
            return choice["name"]
    choice = body.get("function_call")
    if isinstance(choice, dict) and isinstance(choice.get("name"), str):
        return choice["name"]
    return None


def build_upstream_body(req, entry, stream):
    overrides = entry.get("requestOverrides")
    if not isinstance(overrides, dict):
        overrides = {}
    body = {**req, **overrides, "model": entry["model"], "stream": stream}
    if entry.get("compactTools"):
        limit = entry.get("toolDescriptionLimit", 320)
        if not isinstance(limit, int) or isinstance(limit, bool):
            limit = 320
        limit = max(80, min(limit, 2000))
        selected = _selected_tool_name(body)
        for field in ("tools", "functions"):
            if isinstance(body.get(field), list):
                values = body[field]
                if selected:
                    if field == "tools":
                        matched = [item for item in values if isinstance(item, dict)
                                   and isinstance(item.get("function"), dict)
                                   and item["function"].get("name") == selected]
                    else:
                        matched = [item for item in values if isinstance(item, dict)
                                   and item.get("name") == selected]
                    if matched:
                        values = matched
                body[field] = _compact_tool_value(values, limit)
    return body


def _is_real_image_part(part):
    """part 是否为指向真实图片内容的多模态片段（排除空槽位）"""
    if not isinstance(part, dict):
        return False
    t = part.get("type")
    if t not in ("image_url", "input_image", "image"):
        return False
    if t == "image_url":
        iu = part.get("image_url") or {}
        ref = iu.get("url", "") if isinstance(iu, dict) else str(iu)
    else:
        src = part.get("source") or {}
        ref = (src.get("data", "") if isinstance(src, dict) else "") \
            or part.get("url", "") or part.get("data", "")
    if not isinstance(ref, str):
        return False
    low = ref.strip().lower()
    return (low.startswith("data:image/") or low.startswith("http://")
            or low.startswith("https://") or len(low) > 100)


def has_image(req):
    """本轮提问是否带图片。

    只看最后一条 user 消息：历史里的旧图不算，否则贴过一次图之后每轮纯文字
    提问都会被判成有图，全部落到昂贵的 vision 模型上。
    """
    for msg in reversed(req.get("messages") or []):
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            return False
        return any(_is_real_image_part(p) for p in content)
    return False


def strip_images(req):
    """剥掉所有图片片段，供不支持视觉的上游使用（它们收到图会静默丢弃或报 400）"""
    msgs = []
    dropped = 0
    for msg in req.get("messages") or []:
        content = msg.get("content")
        if not isinstance(content, list):
            msgs.append(msg)
            continue
        kept = [p for p in content if not _is_real_image_part(p)]
        dropped += len(content) - len(kept)
        if not kept:
            kept = [{"type": "text", "text": "[图片已省略]"}]
        msgs.append({**msg, "content": kept})
    if not dropped:
        return req, 0
    return {**req, "messages": msgs}, dropped


def has_tools(req):
    """本次请求是否声明了可调用工具。

    有些中转站（seekai 等接网页版后端的）会静默丢掉 tools 参数，模型回
    「我没有这个工具」，故障转移救不了（不是 HTTP 错误）。带工具的请求
    必须绕开这些上游，判据是响应里 prompt_tokens 明显偏小。
    """
    tools = req.get("tools")
    if isinstance(tools, list) and tools:
        return True
    funcs = req.get("functions")  # 旧版 API
    return isinstance(funcs, list) and bool(funcs)


# ============================ 统一接入中心 ============================
# 第三方客户端只连这一个地址 + 统一模型名（alias），上游切换在管理页做。
# 协议：OpenAI 兼容（原生）+ Anthropic /v1/messages（适配层，内部恒走非流式，
# 由网关合成 Anthropic SSE，避免上游流式差异）。

def resolve_model(mid, cfg):
    """把请求里的模型名解析为内部逻辑模型 id。

    先查 alias（统一接入名），再当原样 id 查。查不到返回 None。
    """
    if not isinstance(mid, str) or not mid:
        return None
    alias = (cfg.get("alias") or {}) if isinstance(cfg, dict) else {}
    if mid in alias:
        return alias[mid]
    for m in (cfg.get("models") or []):
        if m.get("id") == mid:
            return mid
    return None


_LAN_IPS = {"ts": 0.0, "ips": []}


def lan_ips():
    """列出本机局域网 IPv4（用于管理页展示接入地址）。

    getaddrinfo 是阻塞调用，代理/VPN 异常时能卡几十秒，而管理页只发这一个请求，
    卡住就等于整页空白，所以结果缓存 60 秒，查询失败时沿用上一次的值。
    """
    now = time.time()
    if now - _LAN_IPS["ts"] < 60:
        return _LAN_IPS["ips"]
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        out.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        out += [i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None,
                                                    socket.AF_INET)
                if i[4][0] not in out]
    except Exception:
        out = _LAN_IPS["ips"]  # DNS 挂了也别把管理页地址清空
    _LAN_IPS["ts"] = now
    _LAN_IPS["ips"] = out
    return out


def access_allowed(peer, headers, cfg):
    """统一接入鉴权：本机免密；非本机必须带 access.apiKey（Bearer 或 x-api-key）。"""
    acc = (cfg.get("access") or {}) if isinstance(cfg, dict) else {}
    if not acc.get("enabled"):
        return True
    want = acc.get("apiKey") or ""
    if not want:
        return True
    peer = (peer or "").lower()
    if peer in ("127.0.0.1", "::1"):
        return True
    def _pick():
        for h, pre in (("authorization", "bearer "), ("x-api-key", "")):
            v = (headers.get(h) or headers.get(h.title()) or "").strip()
            if v.lower().startswith(pre):
                return v[len(pre):].strip()
            if pre == "" and v:
                return v
        return ""
    got = _pick()
    return bool(got) and secrets.compare_digest(got, want)


def responses_to_openai(body):
    """把 OpenAI Responses API（/v1/responses）请求体转成内部 OpenAI chat 格式。

    支持的 Responses 字段：model / input / instructions / max_output_tokens /
    temperature / top_p / stream / tools(仅 function 类) / tool_choice /
    text.format(json_schema)。input 支持 string、EasyInputMessage、message item、
    function_call、function_call_output；内建工具(mcp/shell/apply_patch/web_search/
    computer 等)无法由普通上游执行，直接丢弃。
    """
    msgs = []
    instructions = body.get("instructions")
    if instructions:
        if isinstance(instructions, list):
            texts = []
            for it in instructions:
                if isinstance(it, str):
                    texts.append(it)
                elif isinstance(it, dict):
                    c = it.get("content")
                    if isinstance(c, str):
                        texts.append(c)
                    elif isinstance(c, list):
                        texts += [p.get("text", "") for p in c if isinstance(p, dict)]
            text = "\n".join(t for t in texts if t)
        elif isinstance(instructions, str):
            text = instructions
        else:
            text = ""
        if text:
            msgs.append({"role": "system", "content": text})

    def _norm_role(r):
        return {"developer": "system"}.get(r, r or "user")

    def _append_content(r, c):
        # c: str 或 Responses content list
        if isinstance(c, str):
            msgs.append({"role": _norm_role(r), "content": c})
            return
        if not isinstance(c, list):
            msgs.append({"role": _norm_role(r), "content": ""})
            return
        texts, images = [], []
        for p in c:
            if not isinstance(p, dict):
                continue
            pt = p.get("type")
            if pt in ("input_text", "output_text", "text") and p.get("text"):
                texts.append({"type": "text", "text": p["text"]})
            elif pt in ("input_image", "image_url", "image"):
                u = p.get("image_url") or p.get("url")
                if isinstance(u, dict):
                    u = u.get("url")
                if u:
                    images.append({"type": "image_url", "image_url": {"url": u}})
            elif pt == "input_file" and p.get("file_url"):
                images.append({"type": "image_url",
                               "image_url": {"url": p["file_url"]}})
        parts = texts + images
        msgs.append({"role": _norm_role(r), "content": parts} if parts
                    else {"role": _norm_role(r), "content": ""})

    inp = body.get("input")
    if isinstance(inp, str):
        msgs.append({"role": "user", "content": inp})
    elif isinstance(inp, list):
        for item in inp:
            if not isinstance(item, dict):
                continue
            typ = item.get("type")
            role = item.get("role")
            content = item.get("content")
            if typ == "function_call":
                msgs.append({"role": "assistant", "content": "",
                             "tool_calls": [{
                                 "id": item.get("call_id") or item.get("id") or "",
                                 "type": "function",
                                 "function": {"name": item.get("name", ""),
                                               "arguments": item.get("arguments") or "{}"}}]})
            elif typ == "function_call_output":
                out = item.get("output")
                if not isinstance(out, str):
                    out = json.dumps(out, ensure_ascii=False) if out is not None else ""
                msgs.append({"role": "tool",
                             "tool_call_id": item.get("call_id") or item.get("id") or "",
                             "content": out})
            elif typ == "message" or (typ in (None,) and role):
                _append_content(role or "user", content)
            elif role in ("user", "assistant", "system", "developer", "tool"):
                # 老式 EasyInputMessage：{role, content}
                if isinstance(content, list) or isinstance(content, dict):
                    _append_content(role, content)
                else:
                    _append_content(role, content if isinstance(content, str) else "")
    out = {"messages": msgs, "stream": bool(body.get("stream"))}
    mt = body.get("max_output_tokens")
    if mt:
        out["max_tokens"] = mt
    for k in ("temperature", "top_p"):
        if body.get(k) is not None:
            out[k] = body[k]
    tools = body.get("tools")
    ot = []
    if isinstance(tools, list):
        for t in tools:
            if not isinstance(t, dict) or t.get("type") != "function":
                continue  # 内建/MCP/shell/apply_patch 等由客户端执行，上游不认识 → 丢
            name = t.get("name")
            if not name:
                continue
            ot.append({"type": "function",
                       "function": {"name": name,
                                    "description": t.get("description") or "",
                                    "parameters": t.get("parameters")
                                    or {"type": "object", "properties": {}}}})
    if ot:
        out["tools"] = ot
        tc = body.get("tool_choice")
        if isinstance(tc, str) and tc in ("none", "auto", "required"):
            out["tool_choice"] = tc
        elif isinstance(tc, dict):
            if tc.get("type") in ("function", "custom"):
                out["tool_choice"] = {"type": "function",
                                       "function": {"name": tc.get("name", "")}}
            elif tc.get("type") == "allowed_tools" and tc.get("mode") in ("auto", "required"):
                out["tool_choice"] = tc["mode"]
    text_cfg = body.get("text")
    fmt = text_cfg.get("format") if isinstance(text_cfg, dict) else None
    if isinstance(fmt, dict) and fmt.get("type") == "json_schema" and fmt.get("schema"):
        out["response_format"] = {"type": "json_schema", "json_schema": {
            "name": fmt.get("name") or "schema", "schema": fmt.get("schema")}}
    return out


def openai_to_responses(j, model):
    """把内部 OpenAI chat 响应体转成 Responses API 响应对象。"""
    choice = ((j.get("choices") or [{}])[0])
    msg = choice.get("message") or {}
    output = []
    text = msg.get("content")
    if isinstance(text, list):
        text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
    if text:
        output.append({"id": "msg_" + os.urandom(8).hex(), "type": "message",
                       "status": "completed", "role": "assistant",
                       "content": [{"type": "output_text", "text": text,
                                     "annotations": []}]})
    for tc in msg.get("tool_calls") or []:
        fn = tc.get("function") or {}
        output.append({"type": "function_call", "id": "fc_" + os.urandom(8).hex(),
                       "call_id": tc.get("id") or "call_" + os.urandom(8).hex(),
                       "name": fn.get("name", ""),
                       "arguments": fn.get("arguments") or "{}",
                       "status": "completed"})
    usage = j.get("usage") or {}
    pt = usage.get("prompt_tokens", 0)
    ct = usage.get("completion_tokens", 0)
    return {"id": "resp_" + os.urandom(8).hex(), "object": "response",
            "created_at": int(time.time()), "status": "completed",
            "error": None, "incomplete_details": None, "instructions": None,
            "max_output_tokens": None, "model": model, "output": output,
            "parallel_tool_calls": True, "previous_response_id": None,
            "reasoning": {"effort": None, "summary": None},
            "service_tier": "default", "store": False, "temperature": None,
            "text": {"format": {"type": "text"}}, "tool_choice": "auto",
            "tools": [], "top_logprobs": 0, "top_p": None,
            "truncation": "disabled",
            "usage": {"input_tokens": pt, "output_tokens": ct,
                       "total_tokens": usage.get("total_tokens", pt + ct),
                       "input_tokens_details": {"cached_tokens": 0},
                       "output_tokens_details": {"reasoning_tokens": 0}},
            "user": None, "metadata": {}}


def responses_sse_events(resp):
    """把 Responses 响应对象拆成标准 SSE 事件序列（供 /v1/responses 流式）。

    事件顺序参考官方：response.created → response.in_progress → 逐 output item
    （message: output_item.added → content_part.added → output_text.delta×N →
    output_text.done → content_part.done → output_item.done；function_call:
    output_item.added → output_item.done）→ response.completed。
    """
    base = {k: resp[k] for k in resp if k != "output"}
    yield ("response.created", {"type": "response.created",
                                "response": {**base, "output": []}})
    yield ("response.in_progress", {"type": "response.in_progress",
                                     "response": {**base, "output": []}})
    out_idx = 0
    for item in resp.get("output") or []:
        iid = item.get("id") or "item_" + os.urandom(8).hex()
        if item.get("type") == "message":
            yield ("response.output_item.added",
                   {"type": "response.output_item.added", "output_index": out_idx,
                    "item": {"id": iid, "type": "message", "status": "in_progress",
                              "role": "assistant", "content": []}})
            for ci, part in enumerate(item.get("content") or []):
                text = (part.get("text") or "") if isinstance(part, dict) else ""
                yield ("response.content_part.added",
                       {"type": "response.content_part.added", "item_id": iid,
                        "output_index": out_idx, "content_index": ci,
                        "part": {"type": "output_text", "text": "", "annotations": []}})
                step = 96
                for off in range(0, len(text), step):
                    yield ("response.output_text.delta",
                           {"type": "response.output_text.delta", "item_id": iid,
                            "output_index": out_idx, "content_index": ci,
                            "delta": text[off:off + step]})
                yield ("response.output_text.done",
                       {"type": "response.output_text.done", "item_id": iid,
                        "output_index": out_idx, "content_index": ci, "text": text})
                yield ("response.content_part.done",
                       {"type": "response.content_part.done", "item_id": iid,
                        "output_index": out_idx, "content_index": ci,
                        "part": {"type": "output_text", "text": text, "annotations": []}})
            yield ("response.output_item.done",
                   {"type": "response.output_item.done", "output_index": out_idx,
                    "item": {**item, "id": iid}})
        else:
            yield ("response.output_item.added",
                   {"type": "response.output_item.added", "output_index": out_idx,
                    "item": {**item, "id": iid, "status": "in_progress"}})
            yield ("response.output_item.done",
                   {"type": "response.output_item.done", "output_index": out_idx,
                    "item": {**item, "id": iid}})
        out_idx += 1
    yield ("response.completed", {"type": "response.completed", "response": resp})


def anthropic_to_openai(body):
    """把 Anthropic /v1/messages 请求体转成内部 OpenAI 兼容格式。

    转换规则：
    - 多段 system → 合成一条 system 消息
    - messages 里的文本数组 / 单字符串 → 字符串
    - image base64 → data URL 交给现有 has_image / strip_images 处理
    - assistant.tool_use → tool_calls；user.tool_result → tool 消息
    - tools（Anthropic 定义）→ OpenAI tools
    """
    msgs = []
    system = body.get("system")
    if isinstance(system, str) and system:
        msgs.append({"role": "system", "content": system})
    elif isinstance(system, list):
        texts = [p.get("text", "") for p in system if isinstance(p, dict)]
        text = "\n".join(t for t in texts if t)
        if text:
            msgs.append({"role": "system", "content": text})
    for m in body.get("messages") or []:
        role = m.get("role")
        content = m.get("content")
        if role == "assistant" and isinstance(content, list):
            tc = []
            txt = []
            for p in content:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "tool_use":
                    tc.append({"id": p.get("id", ""), "type": "function",
                               "function": {"name": p.get("name", ""),
                                            "arguments": json.dumps(p.get("input") or {}, ensure_ascii=False)}})
                elif p.get("type") == "text":
                    txt.append(p.get("text", ""))
            msg = {"role": "assistant"}
            if txt:
                msg["content"] = "\n".join(txt)
            if tc:
                msg["tool_calls"] = tc
                msg.setdefault("content", msg.get("content"))
            msgs.append(msg)
        elif role == "user" and isinstance(content, list):
            parts = []
            for p in content:
                if not isinstance(p, dict):
                    continue
                t = p.get("type")
                if t == "text":
                    if p.get("text"):
                        parts.append({"type": "text", "text": p["text"]})
                elif t == "image":
                    src = p.get("source") or {}
                    if src.get("type") == "base64" and src.get("data"):
                        parts.append({"type": "image_url", "image_url": {
                            "url": "data:%s;base64,%s" % (src.get("media_type", "image/png"), src["data"])}})
                    elif src.get("type") == "url" and src.get("url"):
                        parts.append({"type": "image_url", "image_url": {"url": src["url"]}})
                elif t == "tool_result":
                    rid = p.get("tool_use_id", "")
                    res = p.get("content")
                    if isinstance(res, list):
                        res = "\n".join(x.get("text", "") for x in res if isinstance(x, dict))
                    msgs.append({"role": "tool", "tool_call_id": rid,
                                 "content": res if isinstance(res, str) else json.dumps(res, ensure_ascii=False)})
            msgs.append({"role": "user", "content": parts} if parts else
                        {"role": "user", "content": ""})
        else:
            msgs.append({"role": role, "content": content})
    out = {"messages": msgs, "stream": bool(body.get("stream"))}
    for k in ("model", "max_tokens", "temperature", "top_p",
              "stop_sequences", "presence_penalty", "frequency_penalty"):
        if body.get(k) is not None:
            out[k] = body.get(k)
    tools = body.get("tools")
    if isinstance(tools, list) and tools:
        ot = []
        for t in tools:
            if not isinstance(t, dict):
                continue
            fn = (t.get("function") if isinstance(t, dict) else None) or t
            name = fn.get("name")
            if not name:
                continue
            ot.append({"name": name,
                       "description": fn.get("description") or "",
                       "input_schema": fn.get("parameters") or {"type": "object", "properties": {}}})
        if ot:
            out["tools"] = ot
    return out


def openai_to_anthropic(j, model):
    """把内部 OpenAI 响应体转成 Anthropic message 响应。"""
    choice = ((j.get("choices") or [{}])[0])
    msg = choice.get("message") or {}
    content = []
    if msg.get("content"):
        content.append({"type": "text", "text": msg["content"]})
    for tc in msg.get("tool_calls") or []:
        fn = tc.get("function") or {}
        try:
            inp = json.loads(fn.get("arguments") or "{}")
        except Exception:
            inp = {}
        content.append({"type": "tool_use", "id": tc.get("id", ""),
                        "name": fn.get("name", ""), "input": inp})
    finish = choice.get("finish_reason")
    stop = {"stop": "end_turn", "length": "max_tokens", "tool_calls": "tool_use"}.get(finish or "", "end_turn")
    usage = j.get("usage") or {}
    return {"id": j.get("id", "msg_" + os.urandom(8).hex()),
            "type": "message", "role": "assistant", "model": model,
            "content": content, "stop_reason": stop,
            "stop_sequence": None, "usage": {
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}


def anthropic_sse_events(msg):
    """把 Anthropic message 响应拆成标准 SSE 事件序列（供 /v1/messages 流式）。"""
    model = msg.get("model", "")
    content = msg.get("content") or []
    usage = msg.get("usage") or {}
    yield ("message_start", {"type": "message_start", "message": {
        "id": msg.get("id"), "type": "message", "role": "assistant",
        "model": model, "content": [], "stop_reason": None,
        "stop_sequence": None, "usage": usage}})
    for i, block in enumerate(content):
        yield ("content_block_start", {"type": "content_block_start",
                                       "index": i, "content_block": {
                                           "type": block.get("type", "text"),
                                           "text": block.get("text", "") if block.get("type") == "text" else block}})
        if block.get("type") == "text" and block.get("text"):
            yield ("content_block_delta", {"type": "content_block_delta", "index": i,
                                           "delta": {"type": "text_delta", "text": block["text"]}})
        elif block.get("type") == "tool_use":
            yield ("content_block_delta", {"type": "content_block_delta", "index": i,
                                           "delta": {"type": "input_json_delta",
                                                     "partial_json": json.dumps(block.get("input") or {}, ensure_ascii=False)}})
        yield ("content_block_stop", {"type": "content_block_stop", "index": i})
    yield ("message_delta", {"type": "message_delta",
                             "delta": {"stop_reason": msg.get("stop_reason"), "stop_sequence": None},
                             "usage": {"output_tokens": usage.get("output_tokens", 0)}})
    yield ("message_stop", {"type": "message_stop"})


def openai_messages_to_anthropic(body):
    """把内部 OpenAI chat 请求转成 Anthropic /v1/messages 请求体。

    用于 protocol=anthropic 的上游（其 /chat/completions 被 WAF 封或频繁 400）。
    system 消息并入顶层 system，tool_calls / tool 结果转 tool_use / tool_result 块。
    """
    system_parts = []
    msgs = []
    for m in body.get("messages") or []:
        role = m.get("role")
        content = m.get("content")
        if role == "system":
            if isinstance(content, str) and content:
                system_parts.append(content)
            elif isinstance(content, list):
                system_parts += [p.get("text", "") for p in content
                                 if isinstance(p, dict) and p.get("type") == "text"]
            continue
        if role == "tool":
            msgs.append({"role": "user", "content": [{
                "type": "tool_result", "tool_use_id": m.get("tool_call_id", ""),
                "content": content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)}]})
            continue
        if role == "assistant" and m.get("tool_calls"):
            blocks = []
            if isinstance(content, str) and content:
                blocks.append({"type": "text", "text": content})
            for tc in m["tool_calls"]:
                fn = tc.get("function") or {}
                try:
                    inp = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    inp = {}
                blocks.append({"type": "tool_use", "id": tc.get("id", "toolu_" + os.urandom(6).hex()),
                               "name": fn.get("name", ""), "input": inp})
            msgs.append({"role": "assistant", "content": blocks})
            continue
        # 普通消息：content 可能是 str 或多模态数组
        if isinstance(content, str):
            msgs.append({"role": role, "content": content} if content else
                        {"role": role, "content": [{"type": "text", "text": ""}]})
        elif isinstance(content, list):
            blocks = []
            for p in content:
                if not isinstance(p, dict):
                    continue
                t = p.get("type")
                if t == "text":
                    blocks.append({"type": "text", "text": p.get("text", "")})
                elif t in ("image_url", "input_image", "image"):
                    iu = p.get("image_url") or {}
                    url = iu.get("url") if isinstance(iu, dict) else str(iu)
                    url = url or p.get("url") or ""
                    if url.startswith("data:image/"):
                        head, _, b64 = url.partition(",")
                        media = head[5:].split(";", 1)[0] or "image/png"
                        blocks.append({"type": "image", "source": {
                            "type": "base64", "media_type": media, "data": b64}})
                    elif url:
                        blocks.append({"type": "image", "source": {"type": "url", "url": url}})
            msgs.append({"role": role, "content": blocks or [{"type": "text", "text": ""}]})
        else:
            msgs.append({"role": role, "content": [{"type": "text", "text": ""}]})
    out = {"model": body.get("model"),
           "max_tokens": int(body.get("max_tokens") or body.get("max_completion_tokens") or 4096),
           "messages": msgs, "stream": bool(body.get("stream"))}
    if system_parts:
        out["system"] = "\n\n".join(system_parts)
    for k in ("temperature", "top_p"):
        if body.get(k) is not None:
            out[k] = body[k]
    tools = body.get("tools")
    at = []
    if isinstance(tools, list) and tools:
        for t in tools:
            fn = (t.get("function") if isinstance(t, dict) else None) or t
            name = fn.get("name")
            if not name:
                continue
            at.append({"name": name,
                       "description": fn.get("description") or "",
                       "input_schema": fn.get("parameters") or {"type": "object", "properties": {}}})
    if at:
        out["tools"] = at
        tc = body.get("tool_choice")
        if isinstance(tc, str):
            out["tool_choice"] = {"required": {"type": "any"},
                                  "none": {"type": "none"}}.get(tc, {"type": "auto"})
        elif isinstance(tc, dict) and tc.get("type") == "function":
            out["tool_choice"] = {"type": "tool",
                                  "name": (tc.get("function") or {}).get("name") or tc.get("name", "")}
    return out


def anthropic_json_to_openai(msg):
    """把 Anthropic message 响应转回内部 OpenAI chat 响应（protocol=anthropic 上游用）。"""
    content = msg.get("content") or []
    text_parts = [b.get("text", "") for b in content
                  if isinstance(b, dict) and b.get("type") == "text"]
    tool_calls = []
    for b in content:
        if isinstance(b, dict) and b.get("type") == "tool_use":
            tool_calls.append({"id": b.get("id", "call_" + os.urandom(6).hex()),
                               "type": "function",
                               "function": {"name": b.get("name", ""),
                                            "arguments": json.dumps(b.get("input") or {}, ensure_ascii=False)}})
    reasoning = "".join(b.get("thinking", "") for b in content
                        if isinstance(b, dict) and b.get("type") == "thinking")
    message = {"role": "assistant", "content": "".join(text_parts)}
    if tool_calls:
        message["tool_calls"] = tool_calls
    if reasoning:
        message["reasoning_content"] = reasoning
    stop = msg.get("stop_reason")
    finish = {"end_turn": "stop", "stop_sequence": "stop", "max_tokens": "length",
              "tool_use": "tool_calls", "tool_calls": "tool_calls"}.get(stop or "", "stop")
    usage = msg.get("usage") or {}
    return {"id": msg.get("id") or "chatcmpl-" + os.urandom(8).hex(),
            "object": "chat.completion", "created": int(time.time()),
            "model": msg.get("model"), "choices": [{
                "index": 0, "message": message, "finish_reason": finish}],
            "usage": {"prompt_tokens": usage.get("input_tokens", 0),
                      "completion_tokens": usage.get("output_tokens", 0),
                      "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0)}}


def convert_upstream_request(up, body):
    """内部 OpenAI chat 请求体 -> 该上游协议实际要发的请求体。"""
    if (up or {}).get("protocol") == "anthropic":
        return openai_messages_to_anthropic(body)
    return body


def convert_upstream_response(up, j, model=None):
    """上游响应 JSON -> 内部 OpenAI chat 响应（非对应协议的原样返回）。"""
    if not isinstance(j, dict):
        return j
    if (up or {}).get("protocol") == "anthropic" and j.get("type") == "message":
        return anthropic_json_to_openai(j)
    return j


def iter_anthropic_sse(resp):
    """逐行读取上游 Anthropic SSE，产出 (事件名, data 对象)。"""
    event, data_lines = None, []
    while True:
        line = resp.readline()
        if not line:
            break
        line = line.rstrip(b"\r\n")
        if not line:
            if data_lines:
                yield event, _sse_json(b"\n".join(data_lines))
            event, data_lines = None, []
            continue
        if line.startswith(b"event:"):
            event = line[6:].strip().decode("utf-8", "replace")
        elif line.startswith(b"data:"):
            data_lines.append(line[5:].strip())
        # id:/retry:/注释行直接忽略
    if data_lines:
        yield event, _sse_json(b"\n".join(data_lines))


def _sse_json(raw):
    try:
        j = json.loads(raw)
        return j if isinstance(j, dict) else {}
    except Exception:
        return {}


class AnthropicStreamAssembler:
    """上游 Anthropic SSE → OpenAI 流式 delta，同时累积出完整响应。

    protocol=anthropic 的上游恒以 stream=true 请求：非流式要等整段生成完才吐
    响应头（实测响应头 ≈ 总时长），大上下文必然撞 open 超时；流式则在首字节
    就返回。同一份事件流既能实时转发给流式客户端，也能聚合成非流式 JSON
    （capture 模式给 /v1/messages、/v1/responses 适配层用）。
    """

    def __init__(self, model):
        self.model = model
        self.id = None
        self.text = []
        self.thinking = []
        self.tools = {}
        self.blocks = {}
        self.next_tool = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.stop_reason = None
        self.done = False

    def feed(self, event, data):
        """消费一个 SSE 事件，返回要立刻下发的 OpenAI delta 列表。"""
        kind = (data or {}).get("type") or event or ""
        if kind == "message_start":
            msg = data.get("message") or {}
            self.id = msg.get("id") or self.id
            self.model = msg.get("model") or self.model
            usage = msg.get("usage") or {}
            self.prompt_tokens = int(usage.get("input_tokens") or 0)
            self.completion_tokens = int(usage.get("output_tokens") or 0)
            return []
        if kind == "content_block_start":
            block = data.get("content_block") or {}
            index = int(data.get("index") or 0)
            btype = block.get("type") or "text"
            if btype == "tool_use":
                oi = self.next_tool
                self.next_tool += 1
                self.blocks[index] = ("tool", oi)
                call = {"id": block.get("id") or "call_" + os.urandom(6).hex(),
                        "name": block.get("name") or "", "args": []}
                self.tools[oi] = call
                args = ""
                if block.get("input"):  # 少数上游把整个入参塞在 start 里
                    args = json.dumps(block["input"], ensure_ascii=False)
                    call["args"].append(args)
                return [{"tool_calls": [{"index": oi, "type": "function", "id": call["id"],
                                         "function": {"name": call["name"], "arguments": args}}]}]
            self.blocks[index] = (btype, None)
            seed = block.get("text") if btype == "text" else (
                block.get("thinking") if btype == "thinking" else None)
            return self._accumulate(btype, seed or "")
        if kind == "content_block_delta":
            delta = data.get("delta") or {}
            dtype = delta.get("type")
            if dtype == "text_delta":
                return self._accumulate("text", delta.get("text") or "")
            if dtype == "thinking_delta":
                return self._accumulate("thinking", delta.get("thinking") or "")
            if dtype == "input_json_delta":
                _, oi = self.blocks.get(int(data.get("index") or 0), ("tool", None))
                frag = delta.get("partial_json") or ""
                if oi is None or not frag:
                    return []
                self.tools[oi]["args"].append(frag)
                return [{"tool_calls": [{"index": oi, "function": {"arguments": frag}}]}]
            return []
        if kind == "message_delta":
            delta = data.get("delta") or {}
            if delta.get("stop_reason"):
                self.stop_reason = delta["stop_reason"]
            usage = data.get("usage") or {}
            if usage.get("output_tokens") is not None:
                self.completion_tokens = int(usage.get("output_tokens") or 0)
            if usage.get("input_tokens") is not None:
                self.prompt_tokens = int(usage.get("input_tokens") or 0)
            return []
        if kind == "message_stop":
            self.done = True
        return []

    def _accumulate(self, kind, text):
        if not text or kind not in ("text", "thinking"):
            return []
        if kind == "thinking":
            self.thinking.append(text)
            return [{"reasoning_content": text}]
        self.text.append(text)
        return [{"content": text}]

    @property
    def has_output(self):
        return bool(self.text or self.thinking or self.tools)

    def usage(self):
        return {"prompt_tokens": self.prompt_tokens,
                "completion_tokens": self.completion_tokens,
                "total_tokens": self.prompt_tokens + self.completion_tokens}

    def finish_reason(self):
        if self.tools and self.stop_reason not in ("end_turn", "stop_sequence", "max_tokens"):
            return "tool_calls"
        return {"end_turn": "stop", "stop_sequence": "stop", "max_tokens": "length",
                "tool_use": "tool_calls", "tool_calls": "tool_calls"}.get(
                    self.stop_reason or "", "stop")

    def to_openai(self):
        message = {"role": "assistant", "content": "".join(self.text)}
        if self.thinking:
            message["reasoning_content"] = "".join(self.thinking)
        if self.tools:
            message["tool_calls"] = [
                {"id": call["id"], "type": "function",
                 "function": {"name": call["name"],
                              "arguments": "".join(call["args"]) or "{}"}}
                for _, call in sorted(self.tools.items())]
            if not message["content"].strip():
                message["content"] = None
        return {"id": self.id or "chatcmpl-" + os.urandom(8).hex(),
                "object": "chat.completion", "created": int(time.time()),
                "model": self.model,
                "choices": [{"index": 0, "message": message,
                             "finish_reason": self.finish_reason()}],
                "usage": self.usage()}


def fix_max_completion_tokens(raw_body, resp_text):
    """部分 GPT-5.x 上游只认 max_completion_tokens"""
    if "max_completion_tokens" in (resp_text or ""):
        try:
            body = json.loads(raw_body)
            if "max_tokens" in body:
                body["max_completion_tokens"] = body.pop("max_tokens")
                return json.dumps(body).encode()
        except Exception:
            pass
    return None


def response_text(j):
    """从非流式响应里取出所有可见产出（content / reasoning / 工具调用）。

    只看 content 会误判：思考模型可能只吐 reasoning_content，
    带工具调用的回复 content 本来就是空的。
    """
    parts = []
    for ch in (j.get("choices") or []):
        msg = ch.get("message") or ch.get("delta") or {}
        if not isinstance(msg, dict):
            continue
        c = msg.get("content")
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, list):
            parts += [p.get("text", "") for p in c if isinstance(p, dict)]
        parts.append(msg.get("reasoning_content") or "")
        if msg.get("tool_calls") or msg.get("function_call"):
            parts.append("tool_call")
    return "".join(parts)


def sse_has_event(buf):
    """buf 里是否已有至少一个完整 SSE 事件（兼容 CRLF 行尾的上游）。"""
    return b"\n\n" in buf or b"\r\n\r\n" in buf


def sse_scan(buf):
    """扫一段 SSE 字节流，返回 (可见文本, usage, 上游实际 model)。"""
    text, usage, served = [], None, None
    for raw in buf.split(b"\n"):
        line = raw.strip()
        if not line.startswith(b"data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == b"[DONE]":
            continue
        try:
            j = json.loads(payload)
        except Exception:
            continue  # 被 8192 字节边界截断的半个事件，跳过
        if not isinstance(j, dict):
            continue
        served = served or j.get("model")
        usage = j.get("usage") or usage
        text.append(response_text(j))
    return "".join(text), usage, served


def smooth_sse_event(event, target_parts=6):
    """只拆分单个大文本 delta，工具调用及其他 SSE 事件原样透传。"""
    stripped = event.strip()
    if not stripped.startswith(b"data:"):
        return [event]
    payload = stripped[5:].strip()
    if not payload or payload == b"[DONE]":
        return [event]
    try:
        data = json.loads(payload)
        choices = data.get("choices") or []
        delta = choices[0].get("delta") if len(choices) == 1 else None
        text = delta.get("content") if isinstance(delta, dict) else None
    except Exception:
        return [event]
    if not isinstance(text, str) or len(text) < 48 or len(delta) != 1:
        return [event]
    step = max(1, (len(text) + target_parts - 1) // target_parts)
    parts = []
    for offset in range(0, len(text), step):
        chunk = json.loads(json.dumps(data))
        chunk["choices"][0]["delta"]["content"] = text[offset:offset + step]
        parts.append(b"data: " + json.dumps(chunk, ensure_ascii=False).encode() + b"\n\n")
    return parts


def test_upstream(up, model, prompt, timeout=60):
    """管理页用：同步测试单个上游+模型，返回结果摘要"""
    oai = {
        "model": model, "stream": False, "max_tokens": 64,
        "messages": [{"role": "user", "content": prompt or "只回复两个字：收到"}],
    }
    body = json.dumps(convert_upstream_request(up, oai)).encode()
    t0 = time.time()
    try:
        req = build_request(up, body, False)
        opener = make_opener(up)
        resp = opener.open(req, timeout=timeout)
        data = convert_upstream_response(up, json.loads(resp.read()), model)
        content = ""
        for ch in data.get("choices", []):
            msg = ch.get("message") or {}
            content = msg.get("content") or msg.get("reasoning_content") or ""
            if not content and msg.get("tool_calls"):
                content = "(工具调用)"
            if content:
                break
        return {"ok": True, "latency": round(time.time() - t0, 1),
                "snippet": (content or "(空回复)")[:60]}
    except urllib.error.HTTPError as e:
        try:
            txt = e.read().decode("utf-8", "replace").strip()[:120]
        except Exception:
            txt = ""
        return {"ok": False, "latency": round(time.time() - t0, 1),
                "error": f"HTTP {e.code}: {txt}"}
    except Exception as e:
        return {"ok": False, "latency": round(time.time() - t0, 1),
                "error": f"{type(e).__name__}: {str(e)[:100]}"}


def query_balance(up, timeout=25):
    """管理页用：查上游余额（one-api/new-api 标准 billing 接口）"""
    base = up["baseUrl"].rstrip("/")
    headers = {"User-Agent": "gcmp-gateway/1.0"}
    headers.update(up.get("headers") or {})
    if up.get("apiKey"):
        headers["Authorization"] = "Bearer " + up["apiKey"]

    op = make_opener(up)

    def get_json(path):
        req = urllib.request.Request(base + path, headers=headers)
        resp = op.open(req, timeout=timeout)
        return json.loads(resp.read())

    try:
        sub = get_json("/dashboard/billing/subscription")
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:80]}"}
    total = sub.get("hard_limit_usd") if isinstance(sub, dict) else None
    if total is None:
        return {"ok": False, "error": "该上游不支持余额查询 (无 hard_limit_usd)"}

    used = None
    try:
        usage = get_json("/dashboard/billing/usage")
        u = usage.get("total_usage") if isinstance(usage, dict) else None
        if u is not None:
            used = round(float(u) / 100.0, 4)  # 接口返回单位是美分
    except Exception:
        pass

    unlimited = float(total) > 1_000_000  # one-api 无限额占位值
    return {
        "ok": True,
        "total": float(total),
        "used": used,
        "remaining": round(float(total) - (used or 0), 2),
        "unlimited": unlimited,
    }


def extract_model_ids(d):
    """从各家 /models 响应里尽量抠出模型 id 列表（OpenAI 标准 / 类库 / 映射表）。"""
    def walk(x):
        if isinstance(x, dict):
            for k in ("data", "models", "items", "result"):
                if k in x and isinstance(x[k], (list, dict)):
                    return walk(x[k])
            ids = []
            for k, v in x.items():
                if isinstance(v, list):
                    ids += walk(v)
                elif isinstance(k, str):
                    ids.append(k)
            return ids
        if isinstance(x, list):
            ids = []
            for it in x:
                if isinstance(it, str):
                    ids.append(it)
                elif isinstance(it, dict):
                    m = it.get("id") or it.get("name")
                    if isinstance(m, str):
                        ids.append(m)
            return ids
        return []

    out = []
    for x in walk(d):
        if x and x not in out:
            out.append(x)
    return out


def fetch_upstream_models(up, timeout=25):
    """管理页用：拉取上游 /models 的真实模型清单"""
    base = up["baseUrl"].rstrip("/")
    headers = {"User-Agent": "gcmp-gateway/1.0", "Accept": "application/json"}
    headers.update(up.get("headers") or {})
    if up.get("apiKey"):
        headers["Authorization"] = "Bearer " + up["apiKey"]
    t0 = time.time()
    try:
        req = urllib.request.Request(base + "/models", headers=headers)
        resp = make_opener(up).open(req, timeout=timeout)
        raw = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            txt = e.read().decode("utf-8", "replace").strip()[:120]
        except Exception:
            txt = ""
        return {"ok": False, "error": f"HTTP {e.code}: {txt or '无响应体'}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:100]}"}
    ids = extract_model_ids(raw)
    if not ids:
        return {"ok": False, "error": "该上游未返回模型列表（data 为空或格式不标准）"}
    return {"ok": True, "count": len(ids), "models": ids,
            "latency": round(time.time() - t0, 1)}


def health_should_down(code, txt):
    """5xx 时是否应把整个上游标 down。

    model_not_found 是模型级问题（该模型在平台无渠道），只熔断该路由即可，
    不应把整个上游标 down——同上游的其他模型（如 prefer 首选路由）可能完全正常。
    """
    return code >= 500 and "model_not_found" not in (txt or "")


def mark_health(name, status, error=""):
    """更新健康状态（线程安全），保留 latency/checked_at"""
    with HEALTH_LOCK:
        cur = dict(HEALTH.get(name) or {})
        cur["status"] = status
        cur["checked_at"] = int(time.time())
        if error:
            cur["error"] = error
        else:
            cur.pop("error", None)
        HEALTH[name] = cur


def check_health(up, timeout=8):
    """主动健康检查：GET /models 或 /health，200 即视为在线"""
    t0 = time.time()
    opener = make_opener(up)
    headers = {"User-Agent": "gcmp-gateway/health", "Accept": "application/json"}
    headers.update(up.get("headers") or {})
    if up.get("apiKey"):
        headers["Authorization"] = "Bearer " + up["apiKey"]
    base = up["baseUrl"].rstrip("/")
    last_err = ""
    for path in ("/models", "/health"):
        try:
            req = urllib.request.Request(base + path, headers=headers)
            resp = opener.open(req, timeout=timeout)
            resp.read()
            if resp.status == 200:
                return {"status": "healthy", "latency": round((time.time() - t0) * 1000),
                        "checked_at": int(time.time())}
            last_err = last_err or f"HTTP {resp.status}"
        except urllib.error.HTTPError as e:
            # 保留 /models 的原因：403 欠费 / 401 密钥失效 / 5xx 故障要区分对待，
            # 否则会被 /health 的 404 覆盖成毫无意义的「HTTP 404」
            last_err = last_err or f"HTTP {e.code} {health_err_hint(e)}".strip()
            if e.code != 404:
                break  # 明确的鉴权/欠费/网关错误，再试 /health 是白等一个往返
        except Exception as e:
            last_err = last_err or f"{type(e).__name__}"
            break  # 连接类错误，试哪个路径都一样，无需再试
    return {"status": "down", "latency": round((time.time() - t0) * 1000),
            "checked_at": int(time.time()), "error": last_err}


def health_err_hint(err):
    """从错误响应体里摘一句人能看懂的原因，供管理页显示。"""
    try:
        raw = err.read(400).decode("utf-8", "replace")
    except Exception:
        return ""
    try:
        d = json.loads(raw)
    except Exception:
        return raw.strip().replace("\n", " ")[:60]
    while isinstance(d, dict):
        for k in ("message", "error", "msg", "detail", "code"):
            if k in d:
                d = d[k]
                break
        else:
            return ""
        if isinstance(d, str):
            return d[:60]
    return ""


def check_all_health(cfg, timeout=8):
    """并发检查全部上游。串行 13 家 × 8s 超时最坏会超过检查周期本身。"""
    ups = [(n, u) for n, u in (cfg.get("upstreams") or {}).items() if not u.get("disabled")]
    if not ups:
        return {}
    with ThreadPoolExecutor(max_workers=min(len(ups), 16)) as pool:
        futs = {name: pool.submit(check_health, up, timeout) for name, up in ups}
        result = {}
        for name, fut in futs.items():
            try:
                result[name] = fut.result()
            except Exception as e:
                result[name] = {"status": "down", "latency": 0,
                                "checked_at": int(time.time()),
                                "error": type(e).__name__}
    return result


AUDIT_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwABAQABDQotAAAAAElFTkSuQmCC"


AUDIT_TOOL = {
    "type": "function",
    "function": {
        "name": "gateway_audit_echo",
        "description": "Return the provided value exactly.",
        "parameters": {"type": "object", "properties": {
            "value": {"type": "string"}}, "required": ["value"]},
    },
}


def tool_audit_result(baseline, tool_response):
    """归纳工具审计响应，不保存请求内容或工具参数。"""
    base_usage = baseline.get("usage") if isinstance(baseline, dict) else {}
    tool_usage = tool_response.get("usage") if isinstance(tool_response, dict) else {}
    base_tokens = int((base_usage or {}).get("prompt_tokens") or 0)
    prompt_tokens = int((tool_usage or {}).get("prompt_tokens") or 0)
    tool_calls = any(bool(((choice.get("message") or {}).get("tool_calls")))
                     for choice in (tool_response.get("choices") or [])) \
        if isinstance(tool_response, dict) else False
    delta = prompt_tokens - base_tokens if base_tokens and prompt_tokens else None
    return {"tool_calls": tool_calls, "prompt_tokens": prompt_tokens or None,
            "prompt_delta": delta, "suggest_no_tools": not tool_calls}


def audit_route(up, entry, timeout=60, with_tools=False):
    """对单条路由发一次真实最小请求。GET /models 只能证明站点活着，
    证明不了这个模型还在架上、余额是否够、有没有被静默换后端。"""
    content = "只回复两个字：收到"
    if entry.get("vision"):
        content = [{"type": "text", "text": content},
                   {"type": "image_url",
                    "image_url": {"url": "data:image/png;base64," + AUDIT_PIXEL}}]
    body = json.dumps({
        "model": entry["model"], "stream": False,
        # 思考模型 max_tokens 太小会把额度全烧在 reasoning 上返回空 content
        "max_tokens": 512,
        "messages": [{"role": "user", "content": content}],
    }).encode()
    t0 = time.time()
    try:
        resp = make_opener(up).open(build_request(up, body, False), timeout=timeout)
        j = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")
            detail = str((json.loads(detail).get("error") or {}).get("message") or detail)
        except Exception:
            detail = ""
        return {"ok": False, "latency": round(time.time() - t0, 1),
                "error": f"HTTP {e.code}: {detail[:100]}"}
    except Exception as e:
        return {"ok": False, "latency": round(time.time() - t0, 1),
                "error": f"{type(e).__name__}: {str(e)[:80]}"}
    latency = round(time.time() - t0, 1)
    if isinstance(j, dict) and j.get("error"):
        return {"ok": False, "latency": latency, "error": str(j["error"])[:100]}
    text = response_text(j).strip()
    served = j.get("model") or ""
    result = {"ok": bool(text), "latency": latency,
            "snippet": text[:40] or "(空回复)", "served": served,
            "swapped": model_mismatch(entry["model"], served),
            "error": "" if text else "空回复（HTTP200 但无内容）"}

    if not result["ok"] or not with_tools:
        return result
    tool_body = json.dumps({
        "model": entry["model"], "stream": False, "max_tokens": 128,
        "messages": [{"role": "user", "content":
                      "Call gateway_audit_echo with value audit."}],
        "tools": [AUDIT_TOOL], "tool_choice": {"type": "function",
                                                   "function": {"name": "gateway_audit_echo"}},
    }).encode()
    try:
        resp = make_opener(up).open(build_request(up, tool_body, False), timeout=timeout)
        tool_response = json.loads(resp.read().decode("utf-8", "replace"))
        if isinstance(tool_response, dict) and tool_response.get("error"):
            raise RuntimeError(str(tool_response["error"])[:100])
        result["tools"] = tool_audit_result(j, tool_response)
    except urllib.error.HTTPError as e:
        result["tools"] = {"tool_calls": False, "prompt_tokens": None,
                           "prompt_delta": None, "suggest_no_tools": True,
                           "error": f"HTTP {e.code}"}
    except Exception as e:
        result["tools"] = {"tool_calls": False, "prompt_tokens": None,
                           "prompt_delta": None, "suggest_no_tools": True,
                           "error": f"{type(e).__name__}: {str(e)[:80]}"}
    return result


def audit_all_routes(cfg, model_ids=None, timeout=60, workers=8, with_tools=False):
    """并发实测全部路由。同一上游的条目串行执行，避免触发并发限制。"""
    tasks = {}
    for m in cfg.get("models") or []:
        if model_ids and m["id"] not in model_ids:
            continue
        for entry in m.get("route") or []:
            up = (cfg.get("upstreams") or {}).get(entry["upstream"])
            key = f"{entry['upstream']}/{entry['model']}"
            if not up:
                tasks[key] = {"ok": False, "latency": 0, "error": "上游未定义"}
                continue
            tasks.setdefault(key, None)  # 同一路由被多个模型引用时只测一次

    todo = [(k, v) for k, v in tasks.items() if v is None]
    by_upstream = {}
    for key, _ in todo:
        by_upstream.setdefault(key.split("/", 1)[0], []).append(key)

    ups = cfg.get("upstreams") or {}
    entry_of = {f"{e['upstream']}/{e['model']}": e
                for m in (cfg.get("models") or []) for e in (m.get("route") or [])}

    def run_upstream(name):
        out = {}
        for key in by_upstream[name]:
            out[key] = audit_route(ups[name], entry_of[key], timeout, with_tools)
        return out

    with ThreadPoolExecutor(max_workers=min(len(by_upstream) or 1, workers)) as pool:
        futs = [pool.submit(run_upstream, n) for n in by_upstream]
        for fut in futs:
            try:
                tasks.update(fut.result())
            except Exception as e:
                log(f"[audit] 上游任务异常: {e}")
    return {k: v for k, v in tasks.items() if v is not None}


def health_worker(interval=30):
    """后台线程：周期性对全部上游做主动健康检查"""
    while True:
        try:
            cfg = load_config()
            result = check_all_health(cfg)
            with HEALTH_LOCK:
                HEALTH.update(result)
                for stale in set(HEALTH) - set(result):
                    HEALTH.pop(stale, None)  # 配置里已删掉的上游
        except Exception as e:
            log(f"[health] 检查异常: {e}")
        time.sleep(interval)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _admin_guard(self, cfg):
        """管理接口只允许直连 IP 访问，挡住 DNS rebinding 偷密钥。"""
        if host_allowed(self.headers.get("Host"), cfg):
            return True
        self._json(403, {"ok": False, "error":
                         "拒绝该 Host，请用 http://127.0.0.1:%s/admin/ 访问"
                         % (cfg.get("listen", {}).get("port", 15800))})
        return False

    def _serve_file(self, relpath, content_type):
        """读取并返回 BASE 目录下的静态文件（防止路径穿越）。"""
        try:
            name = os.path.basename(relpath)
            path = os.path.join(BASE, name)
            if not os.path.exists(path):
                raise FileNotFoundError
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self._json(404, {"error": {"message": "not found"}})

    def _learn_get_progress(self):
        try:
            if os.path.exists(LEARN_PATH):
                with open(LEARN_PATH, encoding="utf-8") as f:
                    data = json.load(f)
                self._json(200, data)
            else:
                self._json(200, {})
        except Exception:
            self._json(200, {})

    def _learn_save_progress(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length))
        except Exception:
            self._json(400, {"ok": False, "error": "bad body"})
            return
        if not isinstance(data, dict):
            self._json(400, {"ok": False, "error": "need object"})
            return
        try:
            tmp = LEARN_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, LEARN_PATH)
            self._json(200, {"ok": True})
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)})

    def do_GET(self):
        cfg = load_config()
        path = self.path.split("?")[0].rstrip("/")
        if path.startswith("/admin") and not self._admin_guard(cfg):
            return
        if path.startswith("/learn/api"):
            if not self._admin_guard(cfg):
                return
            if path == "/learn/api/progress":
                self._learn_get_progress()
                return
            self._json(404, {"error": {"message": "not found"}})
            return
        if path in ("/learn", "/learn/"):
            self._serve_file("learn.html", "text/html; charset=utf-8")
            return
        if path.startswith("/learn/") and path.endswith(".js"):
            self._serve_file(path[len("/learn/"):], "application/javascript; charset=utf-8")
            return
        if path in ("/health", "/v1/health"):
            self._json(200, {"ok": True, "models": len(cfg.get("models", []))})
        elif path in ("/models", "/v1/models"):
            if not self._access_guard(cfg):
                return
            now = int(time.time())
            data = [{"id": m["id"], "object": "model", "created": now, "owned_by": "gcmp-gateway"}
                    for m in cfg.get("models", [])]
            for alias_id in (cfg.get("alias") or {}):
                data.append({"id": alias_id, "object": "model", "created": now,
                             "owned_by": "gcmp-alias"})
            self._json(200, {"object": "list", "data": data})
        if path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", "/admin/")
            self.end_headers()
            return
        if path in ("/admin", "/admin/"):
            try:
                with open(ADMIN_HTML, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception:
                self._json(404, {"error": "admin.html missing"})
        elif path == "/admin/api/config":
            with STICKY_LOCK:
                sticky = dict(STICKY)
            with HEALTH_LOCK:
                health = dict(HEALTH)
            with BREAK_LOCK:
                now = time.time()
                breaker = {k: {"fails": v["fails"], "reason": v.get("reason", ""),
                               "cooldown_left": max(0, round(v.get("open_until", 0) - now))}
                           for k, v in BREAK.items()}
            public = public_config(cfg)
            self._json(200, {"config": public, "sticky": sticky, "health": health,
                             "logs": RECENT_LOGS[-80:], "bridge": bridge_status(),
                             "breaker": breaker, "stats": stats_snapshot(),
                             "lanIps": lan_ips(),
                             "listenHost": (cfg.get("listen") or {}).get("host", "127.0.0.1")})
        elif path == "/admin/api/health":
            self._admin_health()
        else:
            self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if path.startswith("/admin"):
            if not self._admin_guard(load_config()):
                return
            if path == "/admin/api/config":
                self._admin_save_config()
                return
            if path == "/admin/api/access":
                self._admin_rotate_access()
                return
            if path == "/admin/api/write-codex":
                self._admin_write_codex()
                return
            if path == "/admin/api/setup-client":
                self._admin_setup_client()
                return
            if path == "/admin/api/test":
                self._admin_test()
                return
            if path == "/admin/api/balance":
                self._admin_balance()
                return
            if path == "/admin/api/models":
                self._admin_models()
                return
            if path == "/admin/api/bridge":
                self._admin_bridge()
                return
            if path == "/admin/api/stats":
                self._admin_reset_stats()
                return
            if path == "/admin/api/audit":
                self._admin_audit()
                return
            if path == "/admin/api/sync-vscode":
                self._admin_sync_vscode()
                return
            if path == "/admin/api/vscode-status":
                self._admin_vscode_status()
                return
        if path.startswith("/learn/api"):
            if not self._admin_guard(load_config()):
                return
            if path == "/learn/api/progress":
                self._learn_save_progress()
                return
            self._json(404, {"error": {"message": "not found"}})
            return
        cfg = load_config()
        if path not in ("/v1/messages", "/v1/responses", "/chat/completions", "/v1/chat/completions"):
            self._json(404, {"error": {"message": "not found"}})
            return
        if not self._access_guard(cfg):
            return
        if path == "/v1/messages":
            try:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                raw_req = json.loads(raw)
            except Exception:
                self._json(400, {"type": "error",
                                 "error": {"type": "invalid_request_error",
                                           "message": "bad request body"}})
                return
            self._handle_anthropic(cfg, raw_req)
            return
        if path == "/v1/responses":
            try:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                raw_req = json.loads(raw)
            except Exception:
                self._json(400, {"error": {"message": "bad request body"}})
                return
            self._handle_responses(cfg, raw_req)
            return
        self._committed = False  # 响应头一旦发出就禁止再故障转移
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            req = json.loads(raw)
        except Exception:
            self._json(400, {"error": {"message": "bad request body"}})
            return

        wanted = req.get("model") or ""
        logical = resolve_model(wanted, cfg)
        mdef = next((m for m in cfg["models"] if m["id"] == logical), None)
        if not mdef:
            self._json(404, {"error": {"message": f"unknown model: {wanted}"}})
            return
        if logical != wanted:
            req = {**req, "model": logical}  # 别名命中：按逻辑模型路由，响应体回真实模型名

        routed_req = apply_model_skills(req, mdef)
        client_stream = bool(req.get("stream"))
        want_vision = has_image(req)
        want_tools = has_tools(req)
        t0 = time.time()
        order = self._route_order(mdef, cfg, want_vision, want_tools)
        if not order:
            self._json(502, {"error": {"message":
                f"{wanted}: 没有可用路由"
                + ("（本次请求含图片）" if want_vision else "")
                + ("（本次请求需要工具调用）" if want_tools else "")}})
            return
        errors = []
        for i, entry in enumerate(order):
            up = cfg["upstreams"][entry["upstream"]]
            ok = self._attempt(up, entry, routed_req, client_stream, errors,
                               allow_wait=(i == len(order) - 1))
            if ok:
                if mdef.get("sticky") is not False:
                    with STICKY_LOCK:
                        STICKY[mdef["id"]] = entry["upstream"]
                log(f"{mdef['id']} <- {entry['upstream']}/{entry['model']} "
                    f"OK {time.time()-t0:.1f}s"
                    + (" (流式)" if client_stream else "")
                    + (" [图片]" if want_vision else "")
                    + (" [工具]" if want_tools else ""))
                return
        log(f"{mdef['id']} 全部 {len(order)} 个上游失败: " + " | ".join(errors[:4]))
        self._json(502, {"error": {"message": "all upstreams failed: " + " | ".join(errors)}})

    def _access_guard(self, cfg):
        """统一接入鉴权：本机免密，非本机需 access.apiKey（Bearer 或 x-api-key）。"""
        peer = (self.client_address or ("", 0))[0]
        if access_allowed(peer, self.headers, cfg):
            return True
        self._json(401, {"error": {"message": "unauthorized: 缺少或错误的接入密钥"}})
        return False

    def _handle_anthropic(self, cfg, raw_req):
        """Anthropic /v1/messages 适配层：内部恒走非流式，成功后再转回 Anthropic 格式。"""
        self._committed = False
        wanted = raw_req.get("model") or ""
        logical = resolve_model(wanted, cfg)
        mdef = next((m for m in cfg["models"] if m["id"] == logical), None)
        if not mdef:
            self._json(404, {"type": "error", "error": {"type": "not_found_error",
                                                        "message": f"unknown model: {wanted}"}})
            return
        an_stream = bool(raw_req.get("stream"))
        oreq = anthropic_to_openai(raw_req)
        oreq["model"] = logical
        routed_req = apply_model_skills(oreq, mdef)
        want_vision, want_tools = has_image(oreq), has_tools(oreq)
        order = self._route_order(mdef, cfg, want_vision, want_tools)
        if not order:
            self._json(502, {"type": "error", "error": {"type": "api_error",
                                                        "message": f"{wanted}: 没有可用路由"}})
            return
        errors = []
        for i, entry in enumerate(order):
            up = cfg["upstreams"][entry["upstream"]]
            res = self._attempt(up, entry, routed_req, False, errors,
                                allow_wait=(i == len(order) - 1), capture=True)
            if res:  # capture 模式成功返回 (True, j)，失败返回 False
                captured = res[1]
                if mdef.get("sticky") is not False:
                    with STICKY_LOCK:
                        STICKY[mdef["id"]] = entry["upstream"]
                log(f"anthropic {wanted} -> {logical} <- {entry['upstream']}/{entry['model']} "
                    f"OK {time.time() - getattr(self, '_route_t0', time.time()):.1f}s"
                    + (" [图片]" if want_vision else "") + (" [工具]" if want_tools else ""))
                an_msg = openai_to_anthropic(captured, wanted)
                if an_stream:
                    self._anthropic_sse(an_msg)
                else:
                    body = json.dumps(an_msg, ensure_ascii=False).encode()
                    self._commit_headers(200, "application/json", len(body))
                    self._write_chunk(body)
                    self._end_chunks()
                return
        log(f"anthropic {wanted} 全部 {len(order)} 个上游失败: " + " | ".join(errors[:4]))
        self._json(502, {"type": "error", "error": {"type": "api_error",
                                                    "message": "all upstreams failed"}})

    def _anthropic_sse(self, an_msg):
        self._commit_headers(200, "text/event-stream")
        for evt, data in anthropic_sse_events(an_msg):
            line = f"event: {evt}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            self._write_chunk(line.encode())
        self._end_chunks()

    def _handle_responses(self, cfg, raw_req):
        """OpenAI Responses API（/v1/responses）适配层：给 Codex Desktop /
        Codex CLI 用。内部恒走非流式 capture，成功后转回 Responses 对象；
        客户端要求流式时由网关合成 Responses SSE（事件流格式与 Anthropic
        适配层同思路，规避上游流式差异）。
        """
        self._committed = False
        wanted = raw_req.get("model") or ""
        logical = resolve_model(wanted, cfg)
        mdef = next((m for m in cfg["models"] if m["id"] == logical), None)
        if not mdef:
            self._json(404, {"error": {"message": f"unknown model: {wanted}"}})
            return
        r_stream = bool(raw_req.get("stream"))
        oreq = responses_to_openai(raw_req)
        oreq["model"] = logical
        routed_req = apply_model_skills(oreq, mdef)
        want_vision, want_tools = has_image(oreq), has_tools(oreq)
        order = self._route_order(mdef, cfg, want_vision, want_tools)
        if not order:
            self._json(502, {"error": {"message":
                f"{wanted}: 没有可用路由"
                + ("（本次请求含图片）" if want_vision else "")
                + ("（本次请求需要工具调用）" if want_tools else "")}})
            return
        errors = []
        for i, entry in enumerate(order):
            up = cfg["upstreams"][entry["upstream"]]
            res = self._attempt(up, entry, routed_req, False, errors,
                                allow_wait=(i == len(order) - 1), capture=True)
            if res:  # capture 成功返回 (True, j)
                captured = res[1]
                if mdef.get("sticky") is not False:
                    with STICKY_LOCK:
                        STICKY[mdef["id"]] = entry["upstream"]
                log(f"responses {wanted} -> {logical} <- {entry['upstream']}/{entry['model']} "
                    f"OK {time.time() - getattr(self, '_route_t0', time.time()):.1f}s"
                    + (" [图片]" if want_vision else "") + (" [工具]" if want_tools else ""))
                rmsg = openai_to_responses(captured, wanted)
                if r_stream:
                    self._responses_sse(rmsg)
                else:
                    body = json.dumps(rmsg, ensure_ascii=False).encode()
                    self._commit_headers(200, "application/json", len(body))
                    self._write_chunk(body)
                    self._end_chunks()
                return
        log(f"responses {wanted} 全部 {len(order)} 个上游失败: " + " | ".join(errors[:4]))
        self._json(502, {"error": {"message": "all upstreams failed"}})

    def _responses_sse(self, rmsg):
        self._commit_headers(200, "text/event-stream")
        for evt, data in responses_sse_events(rmsg):
            line = f"event: {evt}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            self._write_chunk(line.encode())
        self._end_chunks()

    def _admin_write_codex(self):
        """一键配置 GPT 客户端（ChatGPT 桌面端 / Codex CLI 共用 ~/.codex）：
        写入 config.toml（wire_api=responses 指向本网关）+ auth.json。"""
        cfg = load_config()
        acc = cfg.get("access") or {}
        key = acc.get("apiKey", "")
        port = int((cfg.get("listen") or {}).get("port") or 15800)
        base_url = f"http://127.0.0.1:{port}/v1"
        # 读请求体可选 model；未指定时挑健康模型（避开 claude 系全挂的情况）
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln)) if ln else {}
        except Exception:
            body = {}
        models = cfg.get("models") or []
        ids = [m.get("id") for m in models]
        want = body.get("model") if isinstance(body, dict) else None

        def _has_live(m):
            rts = m.get("route") or []
            if not rts:
                return False
            return any(e.get("upstream")
                       and HEALTH.get(e.get("upstream"), {}).get("status") != "down"
                       for e in rts)

        if want in ids:
            default_model = want
        else:
            prefer = [x for x in ("gpt-5.6", "deepseek", "glm-5.3", "cheap") if x in ids]
            hit = next((m for m in models if m.get("id") in prefer and _has_live(m)), None)
            if hit is None:
                hit = next((m for m in models if _has_live(m)), None)
            if hit is None:
                hit = models[0] if models else None
            default_model = (hit or {}).get("id") or "gpt-5.6"
        codex_home = os.path.join(os.path.expanduser("~"), ".codex")
        os.makedirs(codex_home, exist_ok=True)
        # 首次一键配置时备份原文件（重复点击不覆盖备份）
        import shutil
        stamp = time.strftime("%Y%m%d_%H%M%S")
        for fn in ("config.toml", "auth.json"):
            p = os.path.join(codex_home, fn)
            if os.path.exists(p):
                bak = os.path.join(codex_home, f"{fn}.bak-gcmp-{stamp}")
                if not os.path.exists(bak):
                    shutil.copy2(p, bak)
        # 保留现有 model_reasoning_effort / disable_response_storage 等字段
        existing_cfg = {}
        cfg_path = os.path.join(codex_home, "config.toml")
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, encoding="utf-8") as f:
                    existing_cfg = dict(_parse_toml(f.read()) or {})
            except Exception:
                pass
        lines = []
        lines.append(f'model_provider = "gcmp"')
        lines.append(f'model = "{default_model}"')
        re_effort = existing_cfg.get("model_reasoning_effort")
        if re_effort:
            lines.append(f'model_reasoning_effort = "{re_effort}"')
        ds = existing_cfg.get("disable_response_storage")
        if ds is not None:
            lines.append(f'disable_response_storage = {str(ds).lower()}')
        lines.append('')
        lines.append('[model_providers.gcmp]')
        lines.append('name = "GCMP Gateway"')
        lines.append(f'base_url = "{base_url}"')
        lines.append('wire_api = "responses"')
        lines.append('requires_openai_auth = false')
        # 写入 config.toml
        with open(cfg_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        # 写入 auth.json：保留原有字段，替换 OPENAI_API_KEY
        auth_path = os.path.join(codex_home, "auth.json")
        auth = {}
        if os.path.exists(auth_path):
            try:
                with open(auth_path, encoding="utf-8") as f:
                    auth = json.load(f) or {}
            except Exception:
                pass
        # GCMP key 写为 OPENAI_API_KEY（codex 通过 auth.json 读取）
        auth["OPENAI_API_KEY"] = key
        with open(auth_path, "w", encoding="utf-8") as f:
            json.dump(auth, f, ensure_ascii=False, indent=2)
        log(f"[codex] 已写入配置：provider=gcmp model={default_model} key={'*' * 8 + key[-4:]}")
        self._json(200, {"ok": True, "model": default_model, "provider": "gcmp"})

    def _admin_setup_client(self):
        """通用一键配置客户端：openai (Cursor/Codex CLI) / claude (Claude Code) / vscode (Codex 扩展)。"""
        cfg = load_config()
        acc = cfg.get("access") or {}
        key = acc.get("apiKey", "")
        port = int((cfg.get("listen") or {}).get("port") or 15800)
        base_url = f"http://127.0.0.1:{port}/v1"
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln)) if ln else {}
        except Exception:
            body = {}
        kind = body.get("kind", "openai")
        model = body.get("model", "")
        home = os.path.expanduser("~")
        stamp = time.strftime("%Y%m%d_%H%M%S")
        import shutil
        try:
            if kind == "openai":
                if os.name == "nt":
                    ps_profile = os.path.join(os.environ.get("USERPROFILE", home), "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1")
                    os.makedirs(os.path.dirname(ps_profile), exist_ok=True)
                    lines = []
                    if os.path.exists(ps_profile):
                        with open(ps_profile, encoding="utf-8") as f:
                            lines = f.read().splitlines()
                    lines = [l for l in lines if not l.startswith("# GCMP Gateway (openai)")]
                    lines.append("# GCMP Gateway (openai)")
                    lines.append(f'$env:OPENAI_BASE_URL = "{base_url}"')
                    lines.append(f'$env:OPENAI_API_KEY = "{key}"')
                    with open(ps_profile, "w", encoding="utf-8") as f:
                        f.write("\n".join(lines) + "\n")
                    msg = f"已写入 PowerShell Profile\n{ps_profile}"
                else:
                    shell_rc = os.path.join(home, ".zshrc" if os.path.exists(os.path.join(home, ".zshrc")) else ".bashrc")
                    lines = []
                    if os.path.exists(shell_rc):
                        with open(shell_rc, encoding="utf-8") as f:
                            lines = f.read().splitlines()
                    lines = [l for l in lines if not l.startswith("# GCMP Gateway (openai)")]
                    lines.append("# GCMP Gateway (openai)")
                    lines.append(f'export OPENAI_BASE_URL="{base_url}"')
                    lines.append(f'export OPENAI_API_KEY="{key}"')
                    with open(shell_rc, "w", encoding="utf-8") as f:
                        f.write("\n".join(lines) + "\n")
                    msg = f"已写入 {shell_rc}"
                log(f"[openai] 已配置 OPENAI_BASE_URL={base_url}")
                self._json(200, {"ok": True, "msg": msg})
            elif kind == "claude":
                claude_home = os.path.join(home, ".claude")
                os.makedirs(claude_home, exist_ok=True)
                cfg_path = os.path.join(claude_home, "config.json")
                if os.path.exists(cfg_path):
                    bak = os.path.join(claude_home, f"config.json.bak-gcmp-{stamp}")
                    if not os.path.exists(bak):
                        shutil.copy2(cfg_path, bak)
                claude_cfg = {}
                if os.path.exists(cfg_path):
                    try:
                        with open(cfg_path, encoding="utf-8") as f:
                            claude_cfg = json.load(f) or {}
                    except Exception:
                        pass
                models = claude_cfg.get("models", {})
                models["gcmp"] = {"type": "openai", "baseUrl": base_url, "apiKey": key}
                claude_cfg["models"] = models
                with open(cfg_path, "w", encoding="utf-8") as f:
                    json.dump(claude_cfg, f, ensure_ascii=False, indent=2)
                log(f"[claude] 已配置 models.gcmp -> {base_url}")
                self._json(200, {"ok": True, "msg": f"已写入 {cfg_path}"})
            elif kind == "vscode":
                codex_home = os.path.join(home, ".codex")
                os.makedirs(codex_home, exist_ok=True)
                for fn in ("config.toml", "auth.json"):
                    p = os.path.join(codex_home, fn)
                    if os.path.exists(p):
                        bak = os.path.join(codex_home, f"{fn}.bak-gcmp-{stamp}")
                        if not os.path.exists(bak):
                            shutil.copy2(p, bak)
                existing_cfg = {}
                cfg_path = os.path.join(codex_home, "config.toml")
                if os.path.exists(cfg_path):
                    try:
                        with open(cfg_path, encoding="utf-8") as f:
                            existing_cfg = dict(_parse_toml(f.read()) or {})
                    except Exception:
                        pass
                models_cfg = cfg.get("models") or []
                ids = [m.get("id") for m in models_cfg]
                default_model = model if model in ids else (next((m for m in models_cfg if m.get("id") == "gpt-5.6"), None) or {}).get("id") or "gpt-5.6"
                lines = [
                    f'model_provider = "gcmp"',
                    f'model = "{default_model}"',
                ]
                re_effort = existing_cfg.get("model_reasoning_effort")
                if re_effort:
                    lines.append(f'model_reasoning_effort = "{re_effort}"')
                ds = existing_cfg.get("disable_response_storage")
                if ds is not None:
                    lines.append(f'disable_response_storage = {str(ds).lower()}')
                lines += ['', '[model_providers.gcmp]', 'name = "GCMP Gateway"',
                          f'base_url = "{base_url}"', 'wire_api = "responses"', 'requires_openai_auth = false']
                with open(cfg_path, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines) + "\n")
                auth_path = os.path.join(codex_home, "auth.json")
                auth = {}
                if os.path.exists(auth_path):
                    try:
                        with open(auth_path, encoding="utf-8") as f:
                            auth = json.load(f) or {}
                    except Exception:
                        pass
                auth["OPENAI_API_KEY"] = key
                with open(auth_path, "w", encoding="utf-8") as f:
                    json.dump(auth, f, ensure_ascii=False, indent=2)
                log(f"[vscode] 已写入配置：provider=gcmp model={default_model}")
                self._json(200, {"ok": True, "msg": f"已配置 VS Code Codex 扩展 (model={default_model})"})
            else:
                self._json(400, {"ok": False, "error": f"未知客户端类型：{kind}"})
        except Exception as e:
            log(f"[setup-client] 失败：{e}")
            self._json(500, {"ok": False, "error": str(e)})

    def _admin_rotate_access(self):
        """重新生成接入密钥：写 config.json 并热加载。"""
        key = "gcmp-" + secrets.token_hex(12)
        cfg = load_config()
        acc = dict(cfg.get("access") or {})
        acc["enabled"] = True
        acc["apiKey"] = key
        cfg["access"] = acc
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            global CONFIG_MTIME
            CONFIG_MTIME = 0
            log("[admin] 接入密钥已重新生成")
            self._json(200, {"ok": True, "apiKey": key})
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)})

    def _admin_save_config(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            new_cfg = json.loads(self.rfile.read(length))
        except Exception:
            self._json(400, {"ok": False, "error": "请求体不是合法 JSON"})
            return
        if not isinstance(new_cfg, dict) or \
           not isinstance(new_cfg.get("upstreams"), dict) or \
           not isinstance(new_cfg.get("models"), list):
            self._json(400, {"ok": False, "error": "缺少 upstreams/models 结构"})
            return
        for m in new_cfg["models"]:
            if not m.get("id") or not isinstance(m.get("route"), list):
                self._json(400, {"ok": False, "error": f"模型 {m.get('id')} 缺少 id 或 route"})
                return
            skills = m.get("skills")
            if skills is not None and (not isinstance(skills, list) or len(skills) > 32 or
                any(not isinstance(name, str) or not _SKILL_NAME_RE.fullmatch(name)
                    for name in skills)):
                self._json(400, {"ok": False, "error": f"模型 {m.get('id')} 的 skills 无效"})
                return
        # 去除 public_config 添加的排序前缀（如 01_），在验证前处理
        new_cfg = unmask_keys(new_cfg, load_config())
        if isinstance(new_cfg.get("upstreams"), dict):
            clean_upstreams = {}
            for up_name, up_val in new_cfg["upstreams"].items():
                real_name = up_name.split("_", 1)[1] if up_name[:2].isdigit() else up_name
                clean_upstreams[real_name] = up_val
            new_cfg["upstreams"] = clean_upstreams
            for m in new_cfg.get("models", []):
                for r in m.get("route", []):
                    if r.get("upstream") and r["upstream"] not in clean_upstreams:
                        up_val = r["upstream"]
                        orig = up_val.split("_", 1)[1] if up_val[:2].isdigit() else up_val
                        if orig in clean_upstreams:
                            r["upstream"] = orig
        for e in (r for m in new_cfg["models"] for r in m["route"]):
            if e.get("upstream") not in new_cfg["upstreams"]:
                self._json(400, {"ok": False,
                                 "error": f"路由引用了不存在的上游: {e.get('upstream')}"})
                return
        import shutil
        if os.path.exists(CONFIG_PATH):
            shutil.copy2(CONFIG_PATH, CONFIG_PATH + ".bak")
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(new_cfg, f, ensure_ascii=False, indent=2)
        global CONFIG_MTIME
        CONFIG_MTIME = 0
        load_config()  # 立即热加载
        log(f"[admin] 配置已保存：{len(new_cfg['upstreams'])} 上游 / {len(new_cfg['models'])} 模型 (备份 config.json.bak)")
        self._json(200, {"ok": True})

    def _admin_sync_vscode(self):
        """同步逻辑模型到 VS Code settings.json 的 gcmp.compatibleModels"""
        log("[sync-vscode] 开始同步请求")
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length)) if length else {}
        except Exception as e:
            log(f"[sync-vscode] JSON 解析失败：{e}")
            self._json(400, {"ok": False, "error": "请求体不是合法 JSON"})
            return

        models = payload.get("models", [])
        remove_extra = bool(payload.get("removeExtra"))
        if not isinstance(models, list):
            log(f"[sync-vscode] models 不是数组")
            self._json(400, {"ok": False, "error": "models 必须是数组"})
            return

        log(f"[sync-vscode] 收到 {len(models)} 个模型, removeExtra={remove_extra}")

        # VS Code settings.json 路径
        vscode_settings_path = os.path.join(os.getenv("APPDATA", ""), "Code", "User", "settings.json")
        log(f"[sync-vscode] VS Code 配置路径：{vscode_settings_path}")
        if not os.path.exists(vscode_settings_path):
            log(f"[sync-vscode] settings.json 不存在")
            self._json(400, {"ok": False, "error": "未找到 VS Code settings.json"})
            return
        
        try:
            with open(vscode_settings_path, "r", encoding="utf-8") as f:
                content = f.read()
            settings = _parse_jsonc(content)
            log(f"[sync-vscode] 成功读取 settings.json（JSONC 注释 + 拖尾逗号 已清理）")
        except Exception as e:
            log(f"[sync-vscode] 读取 settings.json 失败：{e}")
            self._json(500, {"ok": False, "error": f"读取 settings.json 失败：{e}"})
            return
        
        # 生成 VS Code 兼容模型配置
        compatible_models = []
        for m in models:
            model_id = m.get("id", "")
            if not model_id:
                continue
            
            # 生成 GW 前缀的 ID（点转横杠，与已有规范一致，如 gw-gpt-5-6）
            gw_id = f"gw-{model_id.replace('.', '-')}"
            
            # 构建 capabilities
            capabilities = {"toolCalling": True}
            # 检查是否有视觉路由
            has_vision = any(r.get("vision") is not False for r in m.get("route", []))
            if has_vision:
                capabilities["imageInput"] = True
            
            compatible_models.append({
                "id": gw_id,
                "name": m.get("name", model_id),
                "provider": "gateway",
                "baseUrl": "http://127.0.0.1:15800/v1",
                "model": model_id,
                "sdkMode": "openai-sse",
                "proxy": "noproxy",
                "maxInputTokens": m.get("maxInputTokens", 200000),
                "maxOutputTokens": m.get("maxOutputTokens", 16384),
                "capabilities": capabilities
            })
        
        log(f"[sync-vscode] 生成了 {len(compatible_models)} 个 VS Code 兼容配置")

        # 读取现有配置，对比是否有新增
        existing = settings.get("gcmp.compatibleModels", []) or []
        existing_ids = {m.get("id") for m in existing if isinstance(m, dict)}
        gw_ids = {m["id"] for m in compatible_models}

        log(f"[sync-vscode] 已有 {len(existing)} 个配置，{len(existing_ids)} 个唯一 ID")

        # 删除多余模型
        removed_count = 0
        if remove_extra:
            extra_ids = existing_ids - gw_ids
            for eid in extra_ids:
                log(f"[sync-vscode] 删除多余模型：{eid}")
            existing = [m for m in existing if m.get("id") not in extra_ids]
            removed_count = len(extra_ids)
            existing_ids -= extra_ids

        # 添加新模型
        added_count = 0
        for new_model in compatible_models:
            if new_model["id"] not in existing_ids:
                existing.append(new_model)
                added_count += 1
                log(f"[sync-vscode] 新增模型：{new_model['id']}")

        log(f"[sync-vscode] 准备写入 {added_count} 个新模型，删除 {removed_count} 个多余模型")
        
        # 写回 settings.json — 非破坏性更新：仅替换 gcmp.compatibleModels 值，
        # 保留原文件的所有注释和其它配置
        new_json = json.dumps(existing, ensure_ascii=False, indent=4)
        key_pat = re.compile(r'"gcmp\.compatibleModels"\s*:\s*')
        m = key_pat.search(content)
        if m:
            val_end = _jsonc_value_end(content, m.end())
            if val_end >= 0:
                # 计算键的行缩进，重新缩进多行 JSON 输出
                line_start = content.rfind('\n', 0, m.start()) + 1
                indent = content[line_start:m.start()]
                lines = new_json.split('\n')
                for j in range(1, len(lines)):
                    lines[j] = indent + lines[j]
                new_json = '\n'.join(lines)
                new_content = content[:m.end()] + new_json + content[val_end + 1:]
            else:
                settings["gcmp.compatibleModels"] = existing
                new_content = json.dumps(settings, ensure_ascii=False, indent=4)
        else:
            settings["gcmp.compatibleModels"] = existing
            new_content = json.dumps(settings, ensure_ascii=False, indent=4)
        try:
            with open(vscode_settings_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            log(f"[sync-vscode] 已同步：新增 {added_count} 个，删除 {removed_count} 个")
            extra_ids = existing_ids - gw_ids
            self._json(200, {"ok": True, "added": added_count, "removed": removed_count, "extra": sorted(extra_ids)})
        except Exception as e:
            log(f"[sync-vscode] 写入 settings.json 失败：{e}")
            self._json(500, {"ok": False, "error": f"写入 settings.json 失败：{e}"})

    def _admin_vscode_status(self):
        """只读：比较网关模型与 VS Code settings.json 的 gcmp.compatibleModels 差异"""
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            payload = {}
        models = payload.get("models", [])
        gw_ids = {f"gw-{m.get('id','').replace('.', '-')}" for m in models if m.get("id")}
        vscode_settings_path = os.path.join(os.getenv("APPDATA", ""), "Code", "User", "settings.json")
        if not os.path.exists(vscode_settings_path):
            self._json(400, {"ok": False, "error": "未找到 VS Code settings.json"})
            return
        try:
            with open(vscode_settings_path, "r", encoding="utf-8") as f:
                settings = _parse_jsonc(f.read())
        except Exception as e:
            self._json(500, {"ok": False, "error": f"读取 settings.json 失败：{e}"})
            return
        existing = settings.get("gcmp.compatibleModels", []) or []
        existing_ids = {m.get("id") for m in existing if isinstance(m, dict)}
        missing = sorted(gw_ids - existing_ids)
        extra = sorted(existing_ids - gw_ids)
        log(f"[sync-vscode] 状态：新增 {len(missing)} 个，多余 {len(extra)} 个：{extra}")
        self._json(200, {"ok": True, "missing": missing, "extra": extra})

    def _admin_reset_stats(self):
        with STATS_LOCK:
            STATS.clear()
        with BREAK_LOCK:
            BREAK.clear()
        stats_save()
        log("[admin] 已清空调用统计与熔断状态")
        self._json(200, {"ok": True})

    def _resolve_upstream(self, cfg, payload):
        """管理页发来的上游参数：掩码 key 用配置里的真实 key 补回。"""
        saved = (cfg.get("upstreams") or {}).get(payload.get("name") or "") or {}
        key = payload.get("apiKey") or ""
        if not key or is_masked(key):
            key = saved.get("apiKey", "")
        up = {
            "baseUrl": payload.get("baseUrl") or saved.get("baseUrl") or "",
            "apiKey": key,
            "headers": payload.get("headers") or saved.get("headers") or {},
            "noProxy": bool(payload.get("noProxy") or saved.get("noProxy")),
            "protocol": payload.get("protocol") or saved.get("protocol") or "",
        }
        # 页面没传时回退到 config 里保存的端点，管理页测试才不会走错路径
        chat_path = payload.get("chatPath") or saved.get("chatPath")
        if chat_path:
            up["chatPath"] = chat_path
        return up

    def _admin_bridge(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            self._json(400, {"ok": False, "error": "请求体不是合法 JSON"})
            return
        action = payload.get("action")
        if action not in ("start", "stop"):
            self._json(400, {"ok": False, "error": "action 只能是 start 或 stop"})
            return
        ok, msg = bridge_start() if action == "start" else bridge_stop()
        self._json(200, {"ok": ok, "message": msg, "bridge": bridge_status()})

    def _admin_health(self):
        """手动触发一轮全上游健康检查"""
        cfg = load_config()
        result = check_all_health(cfg)
        with HEALTH_LOCK:
            HEALTH.update(result)
        ok = sum(1 for h in result.values() if h["status"] == "healthy")
        log(f"[admin] 手动健康检查: {ok}/{len(result)} 在线")
        self._json(200, {"ok": True, "health": result})

    def _admin_audit(self):
        """深度审计：对每条路由发一次真实最小请求，查出健康检查看不到的死路由。"""
        cfg = load_config()
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            payload = {}
        ids = payload.get("models") or None
        timeout = int(payload.get("timeout") or 60)
        with_tools = bool(payload.get("tools"))
        log("[admin] 开始深度审计路由（每条发一次真实请求）"
            + ("，含工具调用" if with_tools else ""))
        result = audit_all_routes(cfg, ids, timeout, with_tools=with_tools)
        ok = sum(1 for r in result.values() if r.get("ok"))
        swapped = [k for k, r in result.items() if r.get("swapped")]
        no_tools = [k for k, r in result.items() if (r.get("tools") or {}).get("suggest_no_tools")]
        log(f"[admin] 深度审计完成: {ok}/{len(result)} 条路由可用"
            + (f"，{len(swapped)} 条被静默换后端" if swapped else "")
            + (f"，{len(no_tools)} 条建议 noTools" if with_tools and no_tools else ""))
        self._json(200, {"ok": True, "routes": result,
                         "summary": {"total": len(result), "ok": ok,
                                     "swapped": len(swapped), "no_tools": len(no_tools),
                                     "tools_checked": with_tools}})

    def _admin_test(self):
        cfg = load_config()
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length))
        except Exception:
            self._json(400, {"ok": False, "error": "请求体不是合法 JSON"})
            return
        name = payload.get("name") or "(未命名)"
        up = self._resolve_upstream(cfg, payload)
        if not up["baseUrl"]:
            self._json(400, {"ok": False, "error": "缺少 baseUrl"})
            return
        result = test_upstream(up, payload.get("model") or "",
                               payload.get("prompt"), int(payload.get("timeout") or 60))
        log(f"[admin] 测试 {name}/{payload.get('model')}: "
            + ("OK " + str(result["latency"]) + "s" if result["ok"] else "失败 " + result["error"][:60]))
        self._json(200, result)

    def _admin_balance(self):
        cfg = load_config()
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length))
        except Exception:
            self._json(400, {"ok": False, "error": "请求体不是合法 JSON"})
            return
        up = self._resolve_upstream(cfg, payload)
        if not up.get("baseUrl"):
            self._json(400, {"ok": False, "error": "缺少 baseUrl"})
            return
        self._json(200, query_balance(up))

    def _admin_models(self):
        cfg = load_config()
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length))
        except Exception:
            self._json(400, {"ok": False, "error": "请求体不是合法 JSON"})
            return
        name = payload.get("name") or "(未命名)"
        up = self._resolve_upstream(cfg, payload)
        if not up.get("baseUrl"):
            self._json(400, {"ok": False, "error": "缺少 baseUrl"})
            return
        result = fetch_upstream_models(up)
        log(f"[admin] 模型列表 {name}: " + ("OK " + str(len(result.get("models", []))) + " 个"
            if result["ok"] else "失败 " + result["error"][:60]))
        self._json(200, result)

    def _route_order(self, mdef, cfg, want_vision=False, want_tools=False):
        valid = [e for e in (mdef.get("route") or []) if e.get("upstream") in cfg.get("upstreams", {})]
        # route 的 noTools：该上游会静默丢弃 tools 参数，带工具的请求必须绕开
        if want_tools:
            usable = [e for e in valid if not e.get("noTools")]
            if usable:
                valid = usable
            elif valid:
                log(f"{mdef['id']} 全部路由都不支持工具调用，本次仍尝试（结果可能不含 tool_calls）")
        # route 的 vision 字段：true=图片专用（贵，仅带图请求走）, false=不接受图片, 未设=通用
        group = {}
        if want_vision:
            for e in valid:  # 图片专用优先；vision:false 的上游降级为剥图兜底
                group[id(e)] = 0 if e.get("vision") is True else 1
        else:
            valid = [e for e in valid if e.get("vision") is not True]
        live = [e for e in valid if not breaker_open(f"{e['upstream']}/{e['model']}")]
        if live:
            valid = live  # 全员熔断时忽略熔断，总比直接报错好
        elif valid:
            log(f"{mdef['id']} 全部 {len(valid)} 条路由处于熔断冷却中，本次忽略熔断强行尝试")
        sticky = STICKY.get(mdef["id"]) if mdef.get("sticky") is not False else None
        # 统计感知排序：同一健康度组内按历史表现排（成功率→延迟），
        # 无数据的路由保持配置顺序，样本≥5 且成功率≈0 的死路由沉底。
        # 这样失效路由自动后移，无需每次手工调 config。
        def stats_of(e):
            s = STATS.get(f"{e['upstream']}/{e['model']}")
            if not s or not s.get("calls"):
                return None
            recent = s.get("recent") if isinstance(s.get("recent"), list) else []
            if len(recent) >= 3:
                rate = sum(1 for x in recent if x.get("ok")) / len(recent)
                lat = sum(float(x.get("latency") or 0) for x in recent) / len(recent)
            else:
                rate = s.get("ok", 0) / s.get("calls", 1)
                lat = s.get("latency_sum", 0) / s.get("calls", 1)
            return rate, lat, s.get("calls", 0)

        def rank(e):
            h = HEALTH.get(e["upstream"], {}).get("status", "unknown")
            h_rank = {"healthy": 0, "unknown": 1, "down": 2}.get(h, 1)
            st = stats_of(e)
            if st is None:
                s_rank, rate, lat = 1, 0.0, 0.0   # 无数据：保持配置顺序
            elif st[0] <= 0.02 and st[2] >= 5:    # 死路由沉底
                s_rank, rate, lat = 2, st[0], st[1]
            else:
                s_rank, rate, lat = 0, st[0], st[1]
            # prefer：config 显式标定的首选路由，健康时恒排最前（不被统计排序翻转）；
            # 熔断路由在 sort 前已被 live 过滤剔除，挂掉自动轮到下一家
            prefer = 0 if (e.get("prefer") and h != "down") else 1
            return (prefer, group.get(id(e), 0), h_rank, s_rank,
                    -rate, lat if s_rank == 0 else 0.0,
                    0 if e["upstream"] == sticky else 1)
        valid.sort(key=rank)
        return valid

    def _attempt(self, up, entry, req, client_stream, errors, allow_wait=False, capture=False):
        """尝试单个上游。capture=True 时成功返回 (True, j) 而不是写响应
        （Anthropic 适配层要拿到 JSON 转格式；故障转移逻辑不变）。"""
        tag = entry["upstream"]
        key = f"{tag}/{entry['model']}"
        t_start = time.time()
        rl = up.get("rateLimit") or {}
        window = float(rl.get("window") or 60)
        if rl.get("limit"):
            # 还有别的上游可试就立刻跳过；已是最后一家才排队等名额（好过直接报错）
            wait = float(rl["maxWait"]) if rl.get("maxWait") is not None \
                else (window + 5 if allow_wait else 0)
            if not upstream_rate_limit(tag, int(rl["limit"]), window, wait):
                errors.append(f"{tag}:本地限流({rl['limit']}次/{int(window)}秒)")
                log(f"{tag} 本地限流，跳过该上游")
                return False  # 限流是本地保护，不记熔断失败
        self._served_by = {"upstream": tag, "model": entry["model"]}
        self._route_key = key
        self._route_t0 = t_start
        self._up = up          # 成功后估算成本要用它的 pricing
        # 不支持视觉的路由收到图会静默丢弃或报 400，这里先把图剥掉
        if entry.get("vision") is False:
            req, dropped = strip_images(req)
            if dropped:
                log(f"{tag}/{entry['model']} 不支持图片，已剥离 {dropped} 张图后转发")
        # noStream 上游不支持流式 → 向上游发非流式，成功后合成 SSE 返回客户端
        upstream_stream = client_stream and not entry.get("noStream")
        if up.get("protocol") == "anthropic":
            # 恒走流式：Anthropic 非流式要等整段生成完才返回响应头（实测响应头≈总时长），
            # 大上下文必然撞上 open 超时；流式首字节即返回，转换在网关侧做
            upstream_stream = True
        body_dict = build_upstream_body(req, entry, upstream_stream)
        body_dict = convert_upstream_request(up, body_dict)
        to = CONFIG.get("timeouts", {})
        # open() 等待响应头的超时：慢上游(SeekAI 类 40s+)需要足够余量
        timeout = entry.get("timeout") or to.get("open", 90)
        # 拿到响应头之后每次 read 的超时，防止上游中途卡死把客户端一起挂住
        self._read_timeout = float(entry.get("readTimeout") or to.get("read", 300))
        body_bytes = json.dumps(body_dict).encode()

        resp = None
        for attempt in (1, 2):  # 429 限流时延迟重试一次
            try:
                r = build_request(up, body_bytes, upstream_stream)
                resp = open_upstream(up, r, timeout)
                break
            except urllib.error.HTTPError as e:
                try:
                    txt = e.read().decode("utf-8", "replace")
                except Exception:
                    txt = ""
                fixed = fix_max_completion_tokens(body_bytes, txt)
                if e.code == 400 and fixed is not None:
                    body_bytes = fixed
                    continue
                if e.code == 429 and attempt == 1 and allow_wait:
                    # 还有别的上游可试就别等，直接换下一家；只有最后一家才值得等 3 秒
                    log(f"{tag} 429 限流, 3 秒后重试")
                    time.sleep(3)
                    continue
                if e.code == 429 and rl.get("limit"):
                    rate_limit_block(tag, rl["limit"], window)
                msg = f"HTTP{e.code}:{txt.strip()[:80]}"
                errors.append(f"{tag}:{msg}")
                # model_not_found 是模型级问题，只熔断该路由；其余 5xx 才标上游 down
                if health_should_down(e.code, txt):
                    mark_health(tag, "down", f"HTTP {e.code}")
                # 429 是配额问题不是路由失效，不该把好路由熔断掉
                if e.code != 429:
                    breaker_fail(key, msg)
                stats_record(key, False, time.time() - t_start)
                return False
            except Exception as e:
                msg = f"{type(e).__name__}:{str(e)[:60]}"
                errors.append(f"{tag}:{msg}")
                mark_health(tag, "down", f"{type(e).__name__}")
                breaker_fail(key, msg)
                stats_record(key, False, time.time() - t_start)
                return False

        if resp is None:
            return False
        try:
            ctype = resp.headers.get("Content-Type", "")
            is_sse = "event-stream" in ctype
            if up.get("protocol") == "anthropic":
                if is_sse:
                    return self._pump_anthropic_stream(resp, entry, req, client_stream,
                                                       errors, capture)
                # 上游无视 stream=true 返回整段 JSON，退回非流式处理
                return self._pump_plain(resp, entry, req, client_stream, False,
                                        errors, capture)
            if upstream_stream and is_sse:
                return self._pump_stream(resp, entry, errors)
            return self._pump_plain(resp, entry, req, client_stream, upstream_stream,
                                    errors, capture)
        except (BrokenPipeError, ConnectionResetError):
            self._safe_close(resp)
            return True  # 下游已断开，无需也无法故障转移
        except Exception as e:
            if self._committed:
                self._safe_close(resp)
                return True  # 数据已发给客户端，收尾即可
            msg = f"{type(e).__name__}:{str(e)[:60]}"
            errors.append(f"{tag}:{msg}")
            breaker_fail(key, msg)
            stats_record(key, False, time.time() - t_start)
            self._safe_close(resp)
            return False

    def _safe_close(self, resp):
        try:
            resp.close()
        except Exception:
            pass

    def _apply_read_timeout(self, resp):
        """响应头到手后切换到 read 超时。open 超时要照顾 40s+ 才吐头的慢上游，
        但同样宽松的值套在每次 read 上会让卡死的上游把客户端一起挂住。"""
        seconds = getattr(self, "_read_timeout", 0)
        if not seconds:
            return
        try:
            resp.fp.raw._sock.settimeout(seconds)
        except Exception:
            try:
                resp._connection.sock.settimeout(seconds)
            except Exception:
                pass

    def _commit_headers(self, code, ctype, length=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        if length is None:
            self.send_header("Transfer-Encoding", "chunked")
        else:
            self.send_header("Content-Length", str(length))
        served = getattr(self, "_served_by", None)
        if served:
            self.send_header("X-Gateway-Upstream", served["upstream"])
            self.send_header("X-Gateway-Model", served["model"])
            # 只在真的换了后端时才报，大小写/斜杠前缀差异不算
            if model_mismatch(served["model"], served.get("served")):
                self.send_header("X-Gateway-Served-Model", served["served"])
        self.end_headers()
        self._committed = True
        self._chunked = length is None

    def _write_chunk(self, data):
        if getattr(self, "_chunked", True):
            self.wfile.write(f"{len(data):X}\r\n".encode() + data + b"\r\n")
        else:
            self.wfile.write(data)
        self.wfile.flush()

    def _end_chunks(self):
        if getattr(self, "_chunked", True):
            self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    def _synthesize_sse(self, j, model_name):
        """把非流式 JSON 包装成标准 SSE（noStream 上游用）。

        按小片发送而不是整段一次吐：gpt-5.6 全系走这条路，整段跳出体感很差。
        """
        base = dict(j)
        base["model"] = model_name
        base["object"] = "chat.completion.chunk"
        base.pop("usage", None)
        text = ""
        for ch in base.get("choices", []):
            msg = ch.get("message") or {}
            text = msg.get("content") or ""
            break
        step = max(len(text) // 60, 12)  # 约 60 片，太碎会被 chunk 头淹没
        pieces = [text[i:i + step] for i in range(0, len(text), step)] or [""]

        self._commit_headers(200, "text/event-stream")
        for idx, piece in enumerate(pieces):
            chunk = dict(base)
            chunk["choices"] = [{
                "index": 0,
                "delta": ({"role": "assistant", "content": piece} if idx == 0
                          else {"content": piece}),
                "finish_reason": None,
            }]
            self._write_chunk(b"data: " + json.dumps(chunk, ensure_ascii=False).encode() + b"\n\n")
        tail = dict(base)
        tail["choices"] = [{"index": 0, "delta": {},
                            "finish_reason": (j.get("choices") or [{}])[0].get("finish_reason")
                            or "stop"}]
        if j.get("usage"):
            tail["usage"] = j["usage"]
        self._write_chunk(b"data: " + json.dumps(tail, ensure_ascii=False).encode() + b"\n\n")
        self._write_chunk(b"data: [DONE]\n\n")
        self._end_chunks()

    def _pump_stream(self, resp, entry, errors):
        key = getattr(self, "_route_key", entry["upstream"])
        t0 = getattr(self, "_route_t0", time.time())
        self._apply_read_timeout(resp)
        # 提交响应头之前尽量确认这一路有真实内容：一旦发头就再也不能换上游了。
        # 读到首个可见 delta 就停（正常流几乎无额外延迟），读到 [DONE] 或 EOF
        # 仍然没内容说明这家吐了空流，可以转移。
        first, eof, text, usage, served = b"", False, "", None, None
        while True:
            blk = resp.read1(8192)
            if not blk:
                eof = True
                break
            first += blk
            if not sse_has_event(first):
                if len(first) > 65536:
                    break
                continue
            text, usage, served = sse_scan(first)
            if text.strip() or b"[DONE]" in first or len(first) > 65536:
                break
        probe = first.lstrip()
        if probe.startswith(b"data:") and b'"error"' in probe.split(b"\n")[0]:
            errors.append(f"{entry['upstream']}:SSE错误:{probe[:80]}")
            self._fail_stream(key, t0, resp, f"SSE错误:{probe[:60]}")
            return False
        if not first:
            errors.append(f"{entry['upstream']}:空SSE")
            self._fail_stream(key, t0, resp, "空SSE")
            return False
        if not text.strip() and (eof or b"[DONE]" in first):
            errors.append(f"{entry['upstream']}:流式空回复")
            self._fail_stream(key, t0, resp, "流式空回复")
            return False
        self._note_served(key, entry, served)
        self._commit_headers(200, "text/event-stream")
        pending = bytearray(first)
        while b"\n\n" in pending:
            event, _, remainder = pending.partition(b"\n\n")
            pending = bytearray(remainder)
            for part in smooth_sse_event(event + b"\n\n"):
                self._write_chunk(part)
        tail = first[-8192:]
        while True:
            blk = resp.read1(8192)
            if not blk:
                break
            pending.extend(blk)
            while b"\n\n" in pending:
                event, _, remainder = pending.partition(b"\n\n")
                pending = bytearray(remainder)
                for part in smooth_sse_event(event + b"\n\n"):
                    self._write_chunk(part)
            tail = (tail + blk)[-8192:]
        if pending:
            self._write_chunk(bytes(pending))
        self._end_chunks()
        self._safe_close(resp)
        if not usage:
            _, usage, _ = sse_scan(tail)
        breaker_ok(key)
        stats_record(key, True, time.time() - t0, usage, served,
                     estimate_cost(getattr(self, "_up", None), usage, entry["model"]))
        return True

    def _fail_stream(self, key, t0, resp, reason):
        self._safe_close(resp)
        breaker_fail(key, reason)
        stats_record(key, False, time.time() - t0)

    def _note_served(self, key, entry, served):
        """上游实际给的模型和请求的不一致 → 中转站静默换了后端，必须能看见。"""
        if not served:
            return
        if getattr(self, "_served_by", None):
            self._served_by["served"] = served
        if model_mismatch(entry["model"], served):
            log(f"[警告] {key} 实际返回模型是 {served}，上游可能静默替换了后端")

    def _pump_anthropic_stream(self, resp, entry, req, client_stream, errors, capture):
        """protocol=anthropic 上游：读 Anthropic SSE，实时转 OpenAI 流或聚合成整包。

        上游恒以 stream=true 请求：非流式响应头要等整段生成完才吐，大上下文必撞
        open 超时。提交响应头前先确认这一路真有内容，否则还能换上游。
        """
        key = getattr(self, "_route_key", entry["upstream"])
        t0 = getattr(self, "_route_t0", time.time())
        self._apply_read_timeout(resp)
        model = req.get("model") or entry["model"]
        asm = AnthropicStreamAssembler(entry["model"])
        live = bool(client_stream) and not capture
        pending, committed = [], False
        try:
            for event, data in iter_anthropic_sse(resp):
                deltas = asm.feed(event, data)
                if not live or not deltas:
                    continue
                if committed:
                    self._flush_anthropic_deltas(deltas, asm, model)
                    continue
                pending += deltas
                if asm.has_output:
                    self._commit_headers(200, "text/event-stream")
                    committed = True
                    self._flush_anthropic_deltas(pending, asm, model, with_role=True)
                    pending = []
            if not asm.has_output:
                errors.append(f"{entry['upstream']}:流式空回复")
                breaker_fail(key, "流式空回复")
                stats_record(key, False, time.time() - t0)
                return False
            self._note_served(key, entry, asm.model)
            usage = asm.usage()
            if live:
                tail = {"id": asm.id or "chatcmpl-" + os.urandom(8).hex(),
                        "object": "chat.completion.chunk", "created": int(time.time()),
                        "model": model, "choices": [{"index": 0, "delta": {},
                                                     "finish_reason": asm.finish_reason()}]}
                self._write_chunk(b"data: " + json.dumps(tail, ensure_ascii=False).encode() + b"\n\n")
                self._write_chunk(b"data: [DONE]\n\n")
                result = True
            elif capture:
                result = (True, asm.to_openai())
            else:
                out = json.dumps(asm.to_openai(), ensure_ascii=False).encode()
                self._commit_headers(200, "application/json", len(out))
                self._write_chunk(out)
                self._end_chunks()
                result = True
            breaker_ok(key)
            stats_record(key, True, time.time() - t0, usage, asm.model,
                         estimate_cost(getattr(self, "_up", None), usage, entry["model"]))
            return result
        finally:
            self._safe_close(resp)
            if committed:  # 流中途异常也要收尾，否则客户端会一直等 chunked 结束
                try:
                    self._end_chunks()
                except Exception:
                    pass

    def _flush_anthropic_deltas(self, deltas, asm, model, with_role=False):
        for i, delta in enumerate(deltas):
            if with_role and i == 0:
                delta = {"role": "assistant", **delta}
            chunk = {"id": asm.id or "chatcmpl-" + os.urandom(8).hex(),
                     "object": "chat.completion.chunk", "created": int(time.time()),
                     "model": model,
                     "choices": [{"index": 0, "finish_reason": None, "delta": delta}]}
            self._write_chunk(b"data: " + json.dumps(chunk, ensure_ascii=False).encode() + b"\n\n")

    def _pump_plain(self, resp, entry, req, client_stream, upstream_stream, errors, capture=False):
        key = getattr(self, "_route_key", entry["upstream"])
        t0 = getattr(self, "_route_t0", time.time())
        status = resp.status
        self._apply_read_timeout(resp)
        body = resp.read()
        self._safe_close(resp)
        try:
            j = json.loads(body)
        except Exception:
            if status == 200:
                if capture:
                    errors.append(f"{entry['upstream']}:非JSON:{body[:60]!r}")
                    breaker_fail(key, f"非JSON:{body[:40]!r}")
                    stats_record(key, False, time.time() - t0)
                    return False
                self._commit_headers(200, "application/json", len(body))
                self._write_chunk(body)
                self._end_chunks()
                breaker_ok(key)
                stats_record(key, True, time.time() - t0)
                return True
            errors.append(f"{entry['upstream']}:非JSON:{body[:60]!r}")
            breaker_fail(key, f"非JSON:{body[:40]!r}")
            stats_record(key, False, time.time() - t0)
            return False
        if isinstance(j, dict) and j.get("error"):
            errors.append(f"{entry['upstream']}:错误:{str(j['error'])[:80]}")
            breaker_fail(key, f"错误:{str(j['error'])[:60]}")
            stats_record(key, False, time.time() - t0)
            return False
        converted = convert_upstream_response(getattr(self, "_up", None) or {},
                                             j, entry["model"])
        if converted is not j:
            j = converted
            body = json.dumps(j, ensure_ascii=False).encode()  # 非流式分支发的是 body，必须同步替换
        # 空回复必须换上游：hcnsec/auto、思考模型 max_tokens 烧光都会 200 + 空 content
        if isinstance(j, dict) and not response_text(j).strip():
            errors.append(f"{entry['upstream']}:空回复(HTTP200 无 content)")
            breaker_fail(key, "空回复")
            stats_record(key, False, time.time() - t0)
            return False
        served = j.get("model") if isinstance(j, dict) else None
        self._note_served(key, entry, served)
        if capture:
            breaker_ok(key)
            usage = j.get("usage") if isinstance(j, dict) else None
            stats_record(key, True, time.time() - t0, usage, served,
                         estimate_cost(getattr(self, "_up", None), usage, entry["model"]))
            return True, j
        if client_stream and not upstream_stream:
            self._synthesize_sse(j, req.get("model") or entry["model"])
        else:
            self._commit_headers(200, "application/json", len(body))
            self._write_chunk(body)
            self._end_chunks()
        breaker_ok(key)
        usage = j.get("usage") if isinstance(j, dict) else None
        stats_record(key, True, time.time() - t0, usage, served,
                     estimate_cost(getattr(self, "_up", None), usage, entry["model"]))
        return True


def main():
    if not os.path.exists(CONFIG_PATH):
        print("[FAIL] 未找到 config.json（本目录只有 config.example.json 模板）", flush=True)
        print("       首次使用请复制一份并填入自己的上游密钥后重新启动：", flush=True)
        print("         copy config.example.json config.json", flush=True)
        print("       然后编辑 config.json 里的上游地址与 apiKey，或启动后在管理页修改。", flush=True)
        sys.exit(1)
    try:
        cfg = load_config()
    except json.JSONDecodeError as e:
        print(f"[FAIL] config.json 不是合法 JSON：{e}", flush=True)
        print("       可复制 config.example.json 覆盖后重新填写。", flush=True)
        sys.exit(1)
    host = cfg.get("listen", {}).get("host", "127.0.0.1")
    port = int(cfg.get("listen", {}).get("port", 15800))
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    print(f"GCMP 聚合网关 http://{host}:{port}  (代理={cfg.get('proxy') or '无'})", flush=True)
    for m in cfg.get("models", []):
        ups = " -> ".join(e["upstream"] for e in m.get("route", []))
        print(f"  {m['id']:12} {ups}", flush=True)
    stats_load(cfg)
    hc = float((cfg.get("health") or {}).get("interval") or 30)
    threading.Thread(target=health_worker, args=(hc,), daemon=True).start()
    threading.Thread(target=stats_worker, daemon=True).start()
    print(f"  健康检查每 {int(hc)}s 一轮 · 统计落盘 stats.json", flush=True)
    if bridge_cfg()["enabled"]:
        bridge_start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stats_save()
        bridge_stop()


if __name__ == "__main__":
    main()
