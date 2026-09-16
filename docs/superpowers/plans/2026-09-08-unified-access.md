# GCMP 统一接入中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让第三方客户端（OpenAI 兼容 + Anthropic/Claude）只填一个网关地址与统一模型名 `claude-sonnet-4-5` 即可接入；上游切换全部在管理页完成，真实上游 Token 不外发。

**Architecture:** gateway.py 增加 `/v1/messages`（Anthropic ⇄ 内部 OpenAI 格式转换，内部恒走非流式 + 自行合成 Anthropic SSE）、统一别名解析（alias → 逻辑模型）、非本机来源接入密钥校验（access.apiKey，本机免密）。admin.html 总览新增「统一接入」卡片（局域网地址/密钥/别名映射/两套现成配置复制块），逻辑模型卡片新增「首选上游」下拉。config.json 新增 `access` 与 `alias` 顶层段。

**Tech Stack:** 纯 Python 3.13 stdlib + 原生 JS（无新依赖），复用现有 ThreadingHTTPServer、_route_order、_attempt 故障转移。

---

### Task 1: gateway.py 纯函数（可单测）

**Files:**
- Modify: `d:\个人项目\GCMP\gateway.py`（在 `has_tools` 附近追加）

- [ ] **Step 1: 写失败测试** `d:\个人项目\GCMP\tools\test_unified.py`

```python
# -*- coding: utf-8 -*-
"""统一接入中心测试：纯函数单测 + 网关在线冒烟。"""
import json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gateway as g
BASE = "http://127.0.0.1:15900"

def test_alias():
    cfg = {"models": [{"id": "sonnet-5"}], "alias": {"claude-sonnet-4-5": "sonnet-5"}}
    assert g.resolve_model("claude-sonnet-4-5", cfg) == "sonnet-5"
    assert g.resolve_model("opus-5", cfg) == "opus-5"
    assert g.resolve_model("nope", cfg) is None

def test_access():
    cfg = {"access": {"enabled": True, "apiKey": "gcmp-test"}}
    assert g.access_allowed("192.168.1.5", {"Authorization": "Bearer gcmp-test"}, cfg)
    assert not g.access_allowed("192.168.1.5", {"Authorization": "Bearer bad"}, cfg)
    assert g.access_allowed("192.168.1.5", {"x-api-key": "gcmp-test"}, cfg)
    assert g.access_allowed("127.0.0.1", {}, cfg)          # 本机免密
    assert g.access_allowed("::1", {}, cfg)
    assert g.access_allowed("192.168.1.5", {}, {"access": {"enabled": False}})

def test_anthropic_to_openai():
    an = {"model": "claude-sonnet-4-5", "max_tokens": 128,
          "system": [{"type": "text", "text": "你是助手"}],
          "messages": [{"role": "user", "content": [
              {"type": "text", "text": "看图"},
              {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}}]},
             {"role": "assistant", "content": [{"type": "tool_use", "id": "t1",
               "name": "f", "input": {"x": 1}}]},
             {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}]}
    o = g.anthropic_to_openai(an)
    assert o["messages"][0]["role"] == "system"
    assert o["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert o["messages"][2]["tool_calls"][0]["function"]["name"] == "f"
    assert o["messages"][3]["role"] == "tool" and o["messages"][3]["content"] == "ok"
    assert o["max_tokens"] == 128

def test_openai_to_anthropic():
    oj = {"id": "chatcmpl-abc", "model": "claude-opus-5",
          "choices": [{"message": {"role": "assistant", "content": "hi",
                        "tool_calls": [{"id": "c1", "type": "function",
                          "function": {"name": "f", "arguments": '{"x":1}'}}]},
                       "finish_reason": "tool_calls"}],
          "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
    a = g.openai_to_anthropic(oj, "claude-sonnet-4-5")
    assert a["type"] == "message" and a["model"] == "claude-sonnet-4-5"
    assert a["stop_reason"] == "tool_use"
    assert a["content"][1]["type"] == "tool_use" and a["content"][1]["input"] == {"x": 1}
    assert a["usage"]["input_tokens"] == 10

def test_anthropic_sse():
    msg = g.openai_to_anthropic({"id": "x", "choices": [{"message": {"content": "你好"},
        "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 2}}, "claude-sonnet-4-5")
    evs = list(g.anthropic_sse_events(msg))
    names = [e[0] for e in evs]
    assert names[0] == "message_start" and names[-1] == "message_stop"
    assert "content_block_delta" in names and "message_delta" in names

if __name__ == "__main__":
    for fn in (test_alias, test_access, test_anthropic_to_openai,
               test_openai_to_anthropic, test_anthropic_sse):
        fn(); print("PASS", fn.__name__)
    print("全部单测通过")
```

- [ ] **Step 2: 运行确认失败**

Run: `python tools/test_unified.py` → 期望 ImportError: cannot import name 'resolve_model'

- [ ] **Step 3: 实现纯函数**（gateway.py 顶部 `import secrets`，`has_tools` 之后追加）

```python
def resolve_model(wanted, cfg):
    """统一别名 → 逻辑模型 id；非别名原样返回。不存在返回 None。"""
    alias = cfg.get("alias") or {}
    if isinstance(alias, dict) and wanted in alias:
        return alias[wanted]
    return wanted


def access_allowed(client_ip, headers, cfg):
    """非本机来源必须带 access.apiKey（Bearer 或 x-api-key）；本机免密。"""
    acc = cfg.get("access") or {}
    if not acc.get("enabled"):
        return True
    if client_ip in ("127.0.0.1", "::1"):
        return True
    want = acc.get("apiKey") or ""
    ah = headers.get("Authorization") or headers.get("authorization") or ""
    got = ah[7:].strip() if ah.startswith("Bearer ") else ""
    if not got:
        got = headers.get("x-api-key") or headers.get("X-Api-Key") or ""
    return bool(want) and got == want


def lan_ips():
    """本机局域网 IPv4 列表（UDP 探测 + 主机名解析兜底）。"""
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    return ips


def anthropic_to_openai(an):
    """Anthropic /v1/messages 请求 → 内部 OpenAI chat 格式。"""
    sys_blocks = an.get("system")
    if isinstance(sys_blocks, str):
        sys_text = sys_blocks
    elif isinstance(sys_blocks, list):
        sys_text = "\n".join(b.get("text", "") for b in sys_blocks
                             if isinstance(b, dict) and b.get("text"))
    else:
        sys_text = ""
    msgs = []
    for m in an.get("messages") or []:
        role, content = m.get("role"), m.get("content")
        blocks = content if isinstance(content, list) else [{"type": "text", "text": content}]
        if role == "assistant":
            texts, tool_calls = [], []
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    try:
                        args = json.dumps(b.get("input") or {}, ensure_ascii=False)
                    except Exception:
                        args = "{}"
                    tool_calls.append({"id": b.get("id", ""), "type": "function",
                                       "function": {"name": b.get("name", ""),
                                                    "arguments": args}})
                elif b.get("text"):
                    texts.append(b["text"])
            if tool_calls:
                msgs.append({"role": "assistant",
                             "content": "".join(texts) or None,
                             "tool_calls": tool_calls})
            elif texts:
                msgs.append({"role": "assistant", "content": "".join(texts)})
        elif role == "user":
            parts, tool_results = [], []
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                t = b.get("type")
                if t == "text" and b.get("text"):
                    parts.append({"type": "text", "text": b["text"]})
                elif t == "image":
                    src = b.get("source") or {}
                    if src.get("type") == "base64":
                        media = src.get("media_type") or "image/png"
                        parts.append({"type": "image_url", "image_url":
                                      {"url": f"data:{media};base64,{src.get('data', '')}"}})
                    elif src.get("type") == "url":
                        parts.append({"type": "image_url",
                                      "image_url": {"url": src.get("url", "")}})
                elif t == "tool_result":
                    rc = b.get("content")
                    if isinstance(rc, list):
                        rc = "\n".join(x.get("text", "") for x in rc
                                       if isinstance(x, dict))
                    tool_results.append({"role": "tool",
                                         "tool_call_id": b.get("tool_use_id", ""),
                                         "content": str(rc or "")})
            if parts:
                msgs.append({"role": "user",
                             "content": parts if len(parts) > 1 else parts[0]})
            msgs.extend(tool_results)
    if sys_text:
        msgs.insert(0, {"role": "system", "content": sys_text})
    oreq = {"messages": msgs}
    tools = an.get("tools")
    if isinstance(tools, list) and tools:
        oreq["tools"] = [{"type": "function", "function": {
            "name": t.get("name", ""), "description": t.get("description", ""),
            "parameters": t.get("input_schema", {"type": "object"})}}
            for t in tools]
    for k in ("max_tokens", "temperature", "top_p", "top_k"):
        if an.get(k) is not None:
            oreq[k] = an[k]
    return oreq


def openai_to_anthropic(oj, req_model):
    """内部 OpenAI 非流式响应 → Anthropic message 对象。"""
    choice = (oj.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = []
    if msg.get("content"):
        content.append({"type": "text", "text": msg["content"]})
    for tc in msg.get("tool_calls") or []:
        fn = tc.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except Exception:
            args = {}
        content.append({"type": "tool_use", "id": tc.get("id", ""),
                        "name": fn.get("name", ""), "input": args})
    stop_map = {"stop": "end_turn", "length": "max_tokens",
                "tool_calls": "tool_use", "function_call": "tool_use"}
    usage = oj.get("usage") or {}
    return {"id": "msg_" + str(oj.get("id") or "gcmp"),
            "type": "message", "role": "assistant", "model": req_model,
            "content": content,
            "stop_reason": stop_map.get(choice.get("finish_reason"), "end_turn"),
            "stop_sequence": None,
            "usage": {"input_tokens": int(usage.get("prompt_tokens") or 0),
                      "output_tokens": int(usage.get("completion_tokens") or 0)}}


def anthropic_sse_events(an_msg):
    """把完整 message 转成 Anthropic SSE 事件序列（[(event, dict)]）。"""
    yield ("message_start", {"type": "message_start",
                             "message": {**an_msg, "content": []}})
    for i, block in enumerate(an_msg.get("content") or []):
        yield ("content_block_start", {"type": "content_block_start", "index": i,
                                       "content_block": block})
        if block.get("type") == "text":
            text = block.get("text") or ""
            step = max(len(text) // 40, 12)
            pieces = [text[j:j + step] for j in range(0, len(text), step)] or [""]
            for p in pieces:
                yield ("content_block_delta", {"type": "content_block_delta", "index": i,
                                               "delta": {"type": "text_delta", "text": p}})
        elif block.get("type") == "tool_use":
            try:
                raw = json.dumps(block.get("input") or {}, ensure_ascii=False)
            except Exception:
                raw = "{}"
            yield ("content_block_delta", {"type": "content_block_delta", "index": i,
                                           "delta": {"type": "input_json_delta",
                                                     "partial_json": raw}})
        yield ("content_block_stop", {"type": "content_block_stop", "index": i})
    yield ("message_delta", {"type": "message_delta",
                             "delta": {"stop_reason": an_msg.get("stop_reason"),
                                       "stop_sequence": None},
                             "usage": {"output_tokens":
                                       (an_msg.get("usage") or {}).get("output_tokens") or 0}})
    yield ("message_stop", {"type": "message_stop"})
```

- [ ] **Step 4: 运行通过**

Run: `python tools/test_unified.py` → 期望全部 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway.py tools/test_unified.py
git commit -m "feat(unified): 统一接入纯函数（别名/密钥/Anthropic 转换）"
```

### Task 2: gateway.py 故障转移 capture 模式

**Files:**
- Modify: `d:\个人项目\GCMP\gateway.py`（`_attempt` / `_pump_plain`）

- [ ] **Step 1: `_attempt` 增加 `capture=False` 参数**，并把 capture 传给 `_pump_plain`；成功后返回 `(True, j)`（capture 时）
- [ ] **Step 2: `_pump_plain` 增加 `capture=False`**：成功路径若 capture，跳过 `_commit_headers/_write_chunk`，直接 `return True, j`（其余 stats/breaker/_note_served 不变）
- [ ] **Step 3: 现有 `do_POST` chat 路径不用改**（capture=False 时 `_attempt` 仍返回 `True`/`False`，行为不变）
- [ ] **Step 4: 回归**：`python tools/smoke.py`（网关重启后）→ 期望全绿
- [ ] **Step 5: Commit**

### Task 3: 路由与鉴权接入

**Files:**
- Modify: `d:\个人项目\GCMP\gateway.py`

- [ ] **Step 1: `do_POST` 分派**：路径为 `/v1/messages` 时走 `_handle_anthropic`；`/chat/completions` 与 `/v1/chat/completions` 保留原逻辑但先过 `access_allowed`；未知路径 404 不变
- [ ] **Step 2: `_handle_anthropic`**（Handler 方法，复用 `_route_order`/`_attempt(capture=True)`）：

```python
def _handle_anthropic(self, cfg, raw_req):
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
        ok, captured = self._attempt(up, entry, routed_req, False, errors,
                                     allow_wait=(i == len(order) - 1), capture=True)
        if ok:
            if mdef.get("sticky") is not False:
                with STICKY_LOCK:
                    STICKY[mdef["id"]] = entry["upstream"]
            log(f"anthropic {wanted} -> {logical} <- {entry['upstream']}/{entry['model']} "
                f"OK {time.time() - self._route_t0:.1f}s"
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
```

- [ ] **Step 3: chat 路径别名**：do_POST 里 `wanted` 先过 `resolve_model`；`/v1/models` 的 data 追加 alias 键
- [ ] **Step 4: `/v1/models` 与 chat 路径加 `access_allowed`**（401 时回 OpenAI 错误格式）
- [ ] **Step 5: `/admin/api/config` 响应追加 `lanIps` 与 `listenHost`**；新增 `POST /admin/api/access`（`{"action":"rotate"}` → `secrets.token_hex(12)` 生成 `gcmp-` 前缀密钥，写 config.json 并热加载）
- [ ] **Step 6: 单测/冒烟**：`python tools/test_unified.py` + 重启网关后 `python tools/smoke.py`
- [ ] **Step 7: Commit**

### Task 4: 配置文件

**Files:**
- Modify: `d:\个人项目\GCMP\config.example.json`、`d:\个人项目\GCMP\config.json`

- [ ] **Step 1: example 追加**（listen 下方注释说明 0.0.0.0 供局域网）：

```json
"access": { "enabled": true, "apiKey": "gcmp-local-REPLACE_ME" },
"alias": { "claude-sonnet-4-5": "sonnet-5" },
```

- [ ] **Step 2: config.json 同步**（apiKey 用随机生成的本地密钥；alias 指向现有逻辑模型）
- [ ] **Step 3: JSON 校验**：`python -m json.tool config.json > $null` → 退出码 0
- [ ] **Step 4: Commit**

### Task 5: 管理页「统一接入」卡片 + 首选上游

**Files:**
- Modify: `d:\个人项目\GCMP\admin.html`

- [ ] **Step 1: 总览新增「统一接入」卡片**（放在 codex 桥接之前）：网关地址（lanIps 展示+复制）、接入密钥（显示/复制/重新生成→`/admin/api/access` rotate）、统一模型名 `claude-sonnet-4-5` → 逻辑模型下拉（改 `CFG.alias`）、OpenAI/Anthropic 两套配置复制块
- [ ] **Step 2: `saveConfig` 读写 `CFG.access`/`CFG.alias`**（卡片输入 onchange 直接改内存，随保存提交）
- [ ] **Step 3: 模型卡片新增「首选上游」下拉**（options=路由去重的上游，onchange → 移到首位 + `sticky=true` + `renderModels()`）
- [ ] **Step 4: 复制按钮**（`navigator.clipboard` + textarea 兜底）
- [ ] **Step 5: 手动验证**：刷新管理页 → 总览显示局域网地址/密钥；切换统一模型与首选上游 → 保存 → 重新加载仍在
- [ ] **Step 6: Commit**

### Task 6: 端到端验证

- [ ] **Step 1: 重启网关**（listen.host 改 0.0.0.0 需重启）：`start-gateway.bat` 逻辑（先停 15900 再启）
- [ ] **Step 2: 运行全部测试**：`python tools/test_unified.py`（单测+在线冒烟：`/v1/messages` 非流式/流式、`/v1/chat/completions` 用别名、`/v1/models` 含别名、LAN IP 无密钥 401）
- [ ] **Step 3: 浏览器验证管理页新卡片与首选上游切换**
- [ ] **Step 4: Commit + 汇报**
