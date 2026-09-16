# -*- coding: utf-8 -*-
"""统一接入中心测试：纯函数单测 + 网关在线冒烟。

用法: python tools/test_unified.py
在线冒烟依赖本机 15900 网关在运行（/v1/messages 等路径）。
"""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gateway as g

BASE = "http://127.0.0.1:15900"


def test_alias():
    cfg = {"models": [{"id": "sonnet-5"}, {"id": "opus-5"}],
           "alias": {"claude-sonnet-4-5": "sonnet-5"}}
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
              {"type": "image", "source": {"type": "base64",
                                           "media_type": "image/png", "data": "AAAA"}}]},
             {"role": "assistant", "content": [{"type": "tool_use", "id": "t1",
               "name": "f", "input": {"x": 1}}]},
             {"role": "user", "content": [{"type": "tool_result",
               "tool_use_id": "t1", "content": "ok"}]}]}
    o = g.anthropic_to_openai(an)
    assert o["messages"][0]["role"] == "system"
    assert o["messages"][0]["content"] == "你是助手"
    assert o["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert o["messages"][2]["tool_calls"][0]["function"]["name"] == "f"
    assert o["messages"][3]["role"] == "tool" and o["messages"][3]["content"] == "ok"
    assert o["max_tokens"] == 128
    assert o.get("tools") is None  # 未传 tools 不生成空数组


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
    assert a["content"][0]["type"] == "text" and a["content"][0]["text"] == "hi"
    assert a["content"][1]["type"] == "tool_use" and a["content"][1]["input"] == {"x": 1}
    assert a["usage"]["input_tokens"] == 10 and a["usage"]["output_tokens"] == 5


def test_anthropic_sse():
    msg = g.openai_to_anthropic({"id": "x", "choices": [{"message": {"content": "你好"},
        "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 2}},
        "claude-sonnet-4-5")
    evs = list(g.anthropic_sse_events(msg))
    names = [e[0] for e in evs]
    assert names[0] == "message_start" and names[-1] == "message_stop"
    assert "content_block_delta" in names and "message_delta" in names
    assert any(d.get("delta", {}).get("type") == "text_delta" for _, d in evs)


def live_anthropic(stream=False):
    body = json.dumps({"model": "claude-sonnet-4-5", "max_tokens": 64,
                       "stream": stream,
                       "messages": [{"role": "user", "content": "只回复两个字：收到"}]}).encode()
    req = urllib.request.Request(BASE + "/v1/messages", data=body,
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=120)
    raw = resp.read().decode("utf-8", "replace")
    return resp.status, raw


def live_openai_alias():
    body = json.dumps({"model": "claude-sonnet-4-5", "max_tokens": 64,
                       "messages": [{"role": "user", "content": "只回复两个字：收到"}]}).encode()
    req = urllib.request.Request(BASE + "/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=120)
    j = json.loads(resp.read())
    return resp.status, (j.get("choices") or [{}])[0].get("message", {}).get("content", "")


def live_models_has_alias():
    j = json.loads(urllib.request.urlopen(BASE + "/v1/models", timeout=30).read())
    return any(m["id"] == "claude-sonnet-4-5" for m in j.get("data", []))


if __name__ == "__main__":
    for fn in (test_alias, test_access, test_anthropic_to_openai,
               test_openai_to_anthropic, test_anthropic_sse):
        fn()
        print("PASS", fn.__name__)
    print("单测全部通过")

    # 在线冒烟（需要网关在跑）
    try:
        st, raw = live_anthropic(stream=False)
        j = json.loads(raw)
        assert st == 200 and j.get("type") == "message" and j.get("content"), raw[:200]
        print("PASS live /v1/messages 非流式:", str(j.get("content"))[:40])
    except Exception as e:
        print("FAIL live /v1/messages 非流式:", e)
        sys.exit(1)
    try:
        st, raw = live_anthropic(stream=True)
        assert st == 200 and "event: message_start" in raw and "event: message_stop" in raw, raw[:200]
        print("PASS live /v1/messages 流式")
    except Exception as e:
        print("FAIL live /v1/messages 流式:", e)
        sys.exit(1)
    try:
        st, content = live_openai_alias()
        assert st == 200 and content, "空回复"
        print("PASS live /v1/chat/completions 别名:", content[:20])
    except Exception as e:
        print("FAIL live /v1/chat/completions 别名:", e)
        sys.exit(1)
    try:
        assert live_models_has_alias()
        print("PASS live /v1/models 含别名")
    except Exception as e:
        print("FAIL live /v1/models 含别名:", e)
        sys.exit(1)
    print("在线冒烟全部通过")
