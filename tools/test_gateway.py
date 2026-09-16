# -*- coding: utf-8 -*-
"""gateway.py 纯函数单元测试：python tools/test_gateway.py"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gateway as gw  # noqa: E402

gw.CONFIG = {}


class TestResponseText(unittest.TestCase):
    def test_plain_content(self):
        self.assertEqual(gw.response_text(
            {"choices": [{"message": {"content": "hello"}}]}), "hello")

    def test_empty_content_is_empty(self):
        self.assertEqual(gw.response_text(
            {"choices": [{"message": {"content": ""}}]}).strip(), "")

    def test_reasoning_only_counts_as_output(self):
        # 思考模型 max_tokens 不足时只有 reasoning_content，不该判成空回复
        self.assertTrue(gw.response_text(
            {"choices": [{"message": {"content": "", "reasoning_content": "思考中"}}]}).strip())

    def test_tool_call_counts_as_output(self):
        self.assertTrue(gw.response_text({"choices": [{"message": {
            "content": None, "tool_calls": [{"id": "1"}]}}]}).strip())

    def test_list_content(self):
        self.assertEqual(gw.response_text({"choices": [{"message": {
            "content": [{"type": "text", "text": "ab"}]}}]}), "ab")

    def test_no_choices(self):
        self.assertEqual(gw.response_text({"choices": []}), "")


class TestBuildRequest(unittest.TestCase):
    def test_chat_path_overrides_default_completion_endpoint(self):
        req = gw.build_request({"baseUrl": "https://example.test/v1",
                                "chatPath": "/completions"}, b"{}", False)
        self.assertEqual(req.full_url, "https://example.test/v1/completions")


class _PoolRawResponse:
    def __init__(self, body=b'{"ok":true}', status=200):
        self.body = body
        self.offset = 0
        self.status = status
        self.reason = "OK"
        self.headers = {"Content-Type": "application/json", "Content-Length": str(len(body))}
        self.will_close = False
        self.closed = False

    def read(self, amount=None):
        if amount is None:
            amount = len(self.body) - self.offset
        data = self.body[self.offset:self.offset + amount]
        self.offset += len(data)
        if self.offset >= len(self.body):
            self.closed = True
        return data

    read1 = read

    def isclosed(self):
        return self.closed

    def close(self):
        self.closed = True


class _PoolConnection:
    def __init__(self, fail=False):
        self.fail = fail
        self.closed = False
        self.sock = object()
        self.requests = []
        self.responses = []

    def request(self, method, path, body=None, headers=None):
        self.requests.append((method, path, body, dict(headers or {})))
        if self.fail:
            raise OSError("stale connection")
        self.responses.append(_PoolRawResponse())

    def getresponse(self):
        return self.responses[-1]

    def close(self):
        self.closed = True
        self.sock = None


class TestPersistentConnectionPool(unittest.TestCase):
    def _up(self):
        return {"baseUrl": "https://api.justwoker.icu/v1", "apiKey": "sk-test",
                "chatPath": "/completions"}

    def test_complete_responses_reuse_connection_without_changing_request(self):
        made = []

        def factory(spec, timeout):
            conn = _PoolConnection()
            made.append(conn)
            return conn

        pool = gw.PersistentConnectionPool(max_size=1, connection_factory=factory)
        body = b'{"model":"gpt-5.6-sol","messages":[{"role":"user","content":"hi"}]}'
        request = gw.build_request(self._up(), body, False)
        for _ in range(2):
            response = pool.open(self._up(), request, timeout=1, proxy="http://127.0.0.1:7897")
            self.assertEqual(response.read(), b'{"ok":true}')
            response.close()

        self.assertEqual(len(made), 1)
        method, path, sent_body, headers = made[0].requests[0]
        self.assertEqual((method, path, sent_body), ("POST", "/v1/completions", body))
        self.assertEqual(headers["Authorization"], "Bearer sk-test")

    def test_leased_connection_is_not_shared_between_threads(self):
        made = []

        def factory(spec, timeout):
            conn = _PoolConnection()
            made.append(conn)
            return conn

        pool = gw.PersistentConnectionPool(max_size=1, connection_factory=factory)
        request = gw.build_request(self._up(), b"{}", False)
        first = pool.open(self._up(), request, timeout=1, proxy="http://127.0.0.1:7897")
        acquired = threading.Event()
        result = []

        def second_request():
            result.append(pool.open(self._up(), request, timeout=1,
                                    proxy="http://127.0.0.1:7897"))
            acquired.set()

        worker = threading.Thread(target=second_request)
        worker.start()
        time.sleep(0.05)
        self.assertFalse(acquired.is_set())
        first.read()
        first.close()
        worker.join(1)
        self.assertTrue(acquired.is_set())
        result[0].read()
        result[0].close()
        self.assertEqual(len(made), 1)

    def test_connection_error_discards_connection_and_next_request_rebuilds(self):
        made = []

        def factory(spec, timeout):
            conn = _PoolConnection(fail=not made)
            made.append(conn)
            return conn

        pool = gw.PersistentConnectionPool(max_size=1, connection_factory=factory)
        request = gw.build_request(self._up(), b"{}", False)
        with self.assertRaises(OSError):
            pool.open(self._up(), request, timeout=1, proxy="http://127.0.0.1:7897")
        self.assertTrue(made[0].closed)
        response = pool.open(self._up(), request, timeout=1,
                             proxy="http://127.0.0.1:7897")
        response.read()
        response.close()
        self.assertEqual(len(made), 2)

    def test_incomplete_response_is_discarded(self):
        made = []

        def factory(spec, timeout):
            conn = _PoolConnection()
            made.append(conn)
            return conn

        pool = gw.PersistentConnectionPool(max_size=1, connection_factory=factory)
        request = gw.build_request(self._up(), b"{}", False)
        response = pool.open(self._up(), request, timeout=1,
                             proxy="http://127.0.0.1:7897")
        self.assertEqual(response.read(1), b"{")
        response.close()
        self.assertTrue(made[0].closed)
        second = pool.open(self._up(), request, timeout=1,
                           proxy="http://127.0.0.1:7897")
        second.read()
        second.close()
        self.assertEqual(len(made), 2)

    def test_non_justwoker_uses_existing_opener(self):
        original = gw.make_opener
        sentinel = object()

        class Opener:
            def open(self, request, timeout):
                return sentinel

        gw.make_opener = lambda up: Opener()
        try:
            up = {"baseUrl": "https://example.test/v1"}
            request = gw.build_request(up, b"{}", False)
            self.assertIs(gw.open_upstream(up, request, 1), sentinel)
        finally:
            gw.make_opener = original


class TestSseScan(unittest.TestCase):
    def test_extracts_text_usage_model(self):
        buf = (b'data: {"model":"m1","choices":[{"delta":{"content":"he"}}]}\n\n'
               b'data: {"model":"m1","choices":[{"delta":{"content":"llo"}}],'
               b'"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n'
               b'data: [DONE]\n\n')
        text, usage, served = gw.sse_scan(buf)
        self.assertEqual(text, "hello")
        self.assertEqual(usage["prompt_tokens"], 5)
        self.assertEqual(served, "m1")

    def test_truncated_event_is_skipped(self):
        text, _, _ = gw.sse_scan(b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"cho')
        self.assertEqual(text, "ok")

    def test_empty_stream(self):
        self.assertEqual(gw.sse_scan(b"data: [DONE]\n\n"), ("", None, None))


class TestSseSmoothing(unittest.TestCase):
    def test_large_content_delta_is_split_without_changing_text(self):
        text = "这是一段需要平滑输出的较长文本。" * 8
        event = (b"data: " + json.dumps({"id": "x", "choices": [{"index": 0,
                 "delta": {"content": text}, "finish_reason": None}]},
                 ensure_ascii=False).encode() + b"\n\n")
        parts = gw.smooth_sse_event(event, target_parts=8)
        self.assertGreater(len(parts), 1)
        self.assertEqual("".join(gw.sse_scan(part)[0] for part in parts), text)
        self.assertTrue(all(part.endswith(b"\n\n") for part in parts))

    def test_tool_call_and_done_events_are_unchanged(self):
        tool = (b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
                b'"function":{"arguments":"{\\"x\\":1}"}}]}}]}\n\n')
        done = b"data: [DONE]\n\n"
        self.assertEqual(gw.smooth_sse_event(tool), [tool])
        self.assertEqual(gw.smooth_sse_event(done), [done])

    def test_short_content_delta_is_unchanged(self):
        event = b'data: {"choices":[{"delta":{"content":"short"}}]}\n\n'
        self.assertEqual(gw.smooth_sse_event(event), [event])


class TestModelMismatch(unittest.TestCase):
    def test_version_suffix_is_same_model(self):
        self.assertFalse(gw.model_mismatch("claude-opus-5", "claude-opus-5-20260101"))

    def test_separator_differences_ignored(self):
        self.assertFalse(gw.model_mismatch("GLM-5.3-Flash", "glm_5_3_flash"))

    def test_vendor_prefix_is_same_model(self):
        # matrix 请求 qwen/qwen3.8-27b，响应体回 Qwen3.8-27B（去掉了厂商前缀）
        self.assertFalse(gw.model_mismatch("qwen/qwen3.8-27b", "Qwen3.8-27B"))

    def test_silent_backend_swap_detected(self):
        # hcnsec 请求 DeepSeek-V4-Pro 实际给 nvidia/nemotron
        self.assertTrue(gw.model_mismatch("DeepSeek-V4-Pro",
                                          "nvidia/nemotron-3-ultra-550b-a55b"))

    def test_missing_value_is_not_mismatch(self):
        self.assertFalse(gw.model_mismatch("x", ""))
        self.assertFalse(gw.model_mismatch("", "y"))


class TestBreaker(unittest.TestCase):
    def setUp(self):
        gw.BREAK.clear()
        gw.CONFIG = {"breaker": {"enabled": True, "threshold": 3, "cooldown": 300}}

    def tearDown(self):
        gw.BREAK.clear()
        gw.CONFIG = {}

    def test_opens_after_threshold(self):
        for _ in range(2):
            gw.breaker_fail("up/m", "boom")
        self.assertEqual(gw.breaker_open("up/m"), 0)
        gw.breaker_fail("up/m", "boom")
        self.assertGreater(gw.breaker_open("up/m"), 0)

    def test_success_resets(self):
        for _ in range(3):
            gw.breaker_fail("up/m", "boom")
        gw.breaker_ok("up/m")
        self.assertEqual(gw.breaker_open("up/m"), 0)

    def test_cooldown_expiry_half_opens_then_refails_immediately(self):
        for _ in range(3):
            gw.breaker_fail("up/m", "boom")
        gw.BREAK["up/m"]["open_until"] = 0  # 模拟冷却到期
        self.assertEqual(gw.breaker_open("up/m"), 0)   # 半开，放一次试探
        gw.breaker_fail("up/m", "boom")                # 试探又失败
        self.assertGreater(gw.breaker_open("up/m"), 0)  # 立刻重新熔断，不再白试 3 次

    def test_disabled_never_opens(self):
        gw.CONFIG = {"breaker": {"enabled": False}}
        for _ in range(9):
            gw.breaker_fail("up/m", "boom")
        self.assertEqual(gw.breaker_open("up/m"), 0)


class TestKeyMasking(unittest.TestCase):
    def test_mask_keeps_head_tail(self):
        m = gw.mask_key("sk-abcdefghijklmnop")
        self.assertTrue(m.startswith("sk-abc") and m.endswith("mnop"))
        self.assertNotIn("defghij", m)

    def test_short_key_fully_masked(self):
        self.assertNotIn("abc", gw.mask_key("abc123"))

    def test_public_config_hides_keys(self):
        cfg = {"upstreams": {"a": {"baseUrl": "u", "apiKey": "sk-realsecretvalue123"}},
               "models": []}
        pub = gw.public_config(cfg)
        self.assertNotIn("realsecret", json.dumps(pub))
        self.assertEqual(cfg["upstreams"]["a"]["apiKey"], "sk-realsecretvalue123")

    def test_roundtrip_restores_real_key(self):
        old = {"upstreams": {"a": {"baseUrl": "u", "apiKey": "sk-realsecretvalue123"}}}
        pub = gw.public_config({**old, "models": []})
        restored = gw.unmask_keys(json.loads(json.dumps(pub)), old)
        self.assertEqual(restored["upstreams"]["a"]["apiKey"], "sk-realsecretvalue123")

    def test_rename_keeps_key(self):
        old = {"upstreams": {"a": {"baseUrl": "u", "apiKey": "sk-realsecretvalue123"}}}
        pub = json.loads(json.dumps(gw.public_config({**old, "models": []})))
        pub["upstreams"]["renamed"] = pub["upstreams"].pop("a")
        restored = gw.unmask_keys(pub, old)
        self.assertEqual(restored["upstreams"]["renamed"]["apiKey"], "sk-realsecretvalue123")

    def test_user_typed_new_key_wins(self):
        old = {"upstreams": {"a": {"baseUrl": "u", "apiKey": "sk-old"}}}
        restored = gw.unmask_keys(
            {"upstreams": {"a": {"baseUrl": "u", "apiKey": "sk-brandnew"}}}, old)
        self.assertEqual(restored["upstreams"]["a"]["apiKey"], "sk-brandnew")


class TestHostGuard(unittest.TestCase):
    def test_loopback_allowed(self):
        for h in ("127.0.0.1:15900", "127.0.0.1", "localhost:15900", "[::1]:15900"):
            self.assertTrue(gw.host_allowed(h, {}), h)

    def test_domain_rejected(self):
        # DNS rebinding：攻击者域名解析到 127.0.0.1，Host 仍是域名
        for h in ("evil.example.com:15900", "rebind.attacker.io"):
            self.assertFalse(gw.host_allowed(h, {}), h)

    def test_empty_host_rejected(self):
        self.assertFalse(gw.host_allowed("", {}))
        self.assertFalse(gw.host_allowed(None, {}))

    def test_explicit_allowlist(self):
        cfg = {"admin": {"allowHosts": ["gw.lan"]}}
        self.assertTrue(gw.host_allowed("gw.lan:15900", cfg))


class TestHasImage(unittest.TestCase):
    def test_last_user_message_only(self):
        req = {"messages": [
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]},
            {"role": "assistant", "content": "看到了"},
            {"role": "user", "content": "再问个纯文字问题"}]}
        self.assertFalse(gw.has_image(req))

    def test_current_image_detected(self):
        req = {"messages": [{"role": "user", "content": [
            {"type": "text", "text": "看图"},
            {"type": "image_url", "image_url": {"url": "https://x/y.png"}}]}]}
        self.assertTrue(gw.has_image(req))

    def test_empty_slot_not_image(self):
        req = {"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": ""}}]}]}
        self.assertFalse(gw.has_image(req))


class TestStripImages(unittest.TestCase):
    def test_strips_and_keeps_placeholder(self):
        req = {"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "https://x/y.png"}}]}]}
        out, n = gw.strip_images(req)
        self.assertEqual(n, 1)
        self.assertEqual(out["messages"][0]["content"][0]["type"], "text")
        self.assertEqual(req["messages"][0]["content"][0]["type"], "image_url")

    def test_no_image_returns_same_object(self):
        req = {"messages": [{"role": "user", "content": "文字"}]}
        out, n = gw.strip_images(req)
        self.assertEqual(n, 0)
        self.assertIs(out, req)


class TestModelSkills(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.original_root = gw.SKILLS_DIR
        gw.SKILLS_DIR = self.root.name
        skill_dir = os.path.join(self.root.name, "safe-skill")
        os.makedirs(skill_dir)
        self.skill_path = os.path.join(skill_dir, "SKILL.md")
        with open(self.skill_path, "w", encoding="utf-8") as f:
            f.write(
                "---\nname: safe-skill\ndescription: 安全测试技能\n"
                "display_name: 安全测试\ndisplay_description: 用于验证 Skill 元数据展示\n"
                "---\n\n请遵循这条技能指令。\n"
            )

    def tearDown(self):
        gw.SKILLS_DIR = self.original_root
        self.root.cleanup()

    def test_snapshot_returns_only_validated_metadata(self):
        self.assertEqual(gw.skills_snapshot(), [{
            "name": "safe-skill", "description": "安全测试技能",
            "display_name": "安全测试",
            "display_description": "用于验证 Skill 元数据展示",
            "size": os.path.getsize(self.skill_path),
        }])

    def test_selected_skill_prepends_system_message_without_mutating_request(self):
        req = {"model": "m", "messages": [
            {"role": "system", "content": "客户端指令"},
            {"role": "user", "content": "你好"},
        ]}
        out = gw.apply_model_skills(req, {"skills": ["safe-skill"]})
        self.assertIsNot(out, req)
        self.assertEqual(req["messages"][0]["content"], "客户端指令")
        self.assertEqual(len(req["messages"]), 2)
        self.assertEqual(out["messages"][0]["role"], "system")
        self.assertIn("Project skill: safe-skill", out["messages"][0]["content"])
        self.assertIn("请遵循这条技能指令。", out["messages"][0]["content"])
        self.assertNotIn("description:", out["messages"][0]["content"])
        self.assertEqual(out["messages"][1:], req["messages"])

    def test_unknown_or_unsafe_skill_is_ignored(self):
        req = {"messages": [{"role": "user", "content": "你好"}]}
        for name in ("missing", "../safe-skill", "safe-skill/other"):
            self.assertIs(gw.apply_model_skills(req, {"skills": [name]}), req)


class TestRateLimit(unittest.TestCase):
    def setUp(self):
        gw.RATE.clear()

    def tearDown(self):
        gw.RATE.clear()

    def test_window_allows_limit_then_blocks(self):
        for _ in range(3):
            self.assertTrue(gw.upstream_rate_limit("u", 3, 60, 0))
        self.assertFalse(gw.upstream_rate_limit("u", 3, 60, 0))

    def test_block_fills_window(self):
        gw.rate_limit_block("u", 5, 60)
        self.assertFalse(gw.upstream_rate_limit("u", 5, 60, 0))


class TestCacheTokens(unittest.TestCase):
    def test_openai_style_details(self):
        u = {"prompt_tokens": 1739, "prompt_tokens_details": {"cached_tokens": 1664}}
        self.assertEqual(gw.cache_tokens(u), (1664, 0))

    def test_anthropic_style_top_level(self):
        u = {"cache_read_input_tokens": 900, "cache_creation_input_tokens": 120}
        self.assertEqual(gw.cache_tokens(u), (900, 120))

    def test_zero_fields_mean_no_cache(self):
        u = {"prompt_tokens_details": {"cached_tokens": 0, "cache_read_input_tokens": 0}}
        self.assertEqual(gw.cache_tokens(u), (0, 0))

    def test_missing_usage(self):
        self.assertEqual(gw.cache_tokens(None), (0, 0))
        self.assertEqual(gw.cache_tokens({}), (0, 0))


class TestPricing(unittest.TestCase):
    def test_no_pricing_is_unknown(self):
        self.assertIsNone(gw.upstream_pricing({}))
        self.assertIsNone(gw.estimate_cost({}, {"prompt_tokens": 100}))

    def test_per_call_ignores_tokens(self):
        up = {"pricing": {"type": "per_call", "price": 0.3}}
        self.assertEqual(gw.estimate_cost(up, {"prompt_tokens": 1_000_000}), 0.3)
        self.assertEqual(gw.estimate_cost(up, None), 0.3)

    def test_per_token_matches_measured_cost(self):
        # 实测：agentrouter/glm-5.3 in=1,010,018 out=8 花了 $3.0301
        up = {"pricing": {"type": "per_token", "in": 2, "out": 6,
                          "models": {"glm-5.3": {"in": 3, "out": 12}}}}
        est = gw.estimate_cost(up, {"prompt_tokens": 1_010_018, "completion_tokens": 8},
                               "glm-5.3")
        self.assertAlmostEqual(est, 3.0301, places=2)

    def test_model_override_applies(self):
        up = {"pricing": {"type": "per_token", "in": 2, "out": 6,
                          "models": {"pricey": {"in": 20, "out": 60}}}}
        cheap = gw.estimate_cost(up, {"prompt_tokens": 1_000_000}, "other")
        dear = gw.estimate_cost(up, {"prompt_tokens": 1_000_000}, "pricey")
        self.assertEqual((cheap, dear), (2.0, 20.0))

    def test_cached_input_is_discounted(self):
        up = {"pricing": {"type": "per_token", "in": 10, "out": 0}}
        full = gw.estimate_cost(up, {"prompt_tokens": 1_000_000})
        hit = gw.estimate_cost(up, {"prompt_tokens": 1_000_000,
                                    "prompt_tokens_details": {"cached_tokens": 1_000_000}})
        self.assertEqual(full, 10.0)
        self.assertAlmostEqual(hit, 1.0)  # cachedIn 缺省 = in 的 10%

    def test_cached_over_prompt_is_clamped(self):
        # 上游偶尔会回报 cached > prompt，不能算出负的新鲜 token
        up = {"pricing": {"type": "per_token", "in": 10, "out": 0}}
        est = gw.estimate_cost(up, {"prompt_tokens": 100,
                                    "prompt_tokens_details": {"cached_tokens": 999}})
        self.assertGreater(est, 0)

    def test_incomplete_pricing_is_unknown(self):
        self.assertIsNone(gw.upstream_pricing({"pricing": {"type": "per_call"}}))
        self.assertIsNone(gw.upstream_pricing({"pricing": {"type": "per_token"}}))
        self.assertIsNone(gw.upstream_pricing({"pricing": {"type": "bogus", "price": 1}}))


class TestHealthErrHint(unittest.TestCase):
    """健康检查错误原因摘要：/models 的 403/401 原因不能被 /health 的 404 盖掉"""

    class _Err:
        def __init__(self, body):
            self._body = body.encode() if isinstance(body, str) else body

        def read(self, n=None):
            return self._body[:n] if n else self._body

    def test_new_api_nested_message(self):
        e = self._Err('{"error":{"code":"","message":"Invalid token (request id: 20260903)"}}')
        self.assertIn("Invalid token", gw.health_err_hint(e))

    def test_flat_message(self):
        e = self._Err('{"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}')
        self.assertEqual(gw.health_err_hint(e), "Insufficient account balance")

    def test_plain_text_body(self):
        self.assertEqual(gw.health_err_hint(self._Err("404 page not found")),
                         "404 page not found")

    def test_no_message_field(self):
        self.assertEqual(gw.health_err_hint(self._Err('{"foo":1}')), "")

    def test_unreadable_body(self):
        class Boom:
            def read(self, n=None):
                raise OSError("closed")
        self.assertEqual(gw.health_err_hint(Boom()), "")

    def test_truncates_long_message(self):
        e = self._Err(json.dumps({"message": "x" * 500}))
        self.assertEqual(len(gw.health_err_hint(e)), 60)


class TestAuditRoutes(unittest.TestCase):
    """audit_all_routes 的调度逻辑（不发真实请求，替换掉 audit_route）"""

    def setUp(self):
        self.orig = gw.audit_route
        self.calls = []

        def fake(up, entry, timeout=60, with_tools=False):
            self.calls.append(f"{entry['upstream']}/{entry['model']}")
            return {"ok": True, "latency": 0.1, "snippet": "收到",
                    "served": entry["model"], "swapped": False, "error": ""}

        gw.audit_route = fake

    def tearDown(self):
        gw.audit_route = self.orig

    def _cfg(self):
        return {
            "upstreams": {"a": {"baseUrl": "http://a/v1"}, "b": {"baseUrl": "http://b/v1"}},
            "models": [
                {"id": "m1", "route": [{"upstream": "a", "model": "x"},
                                       {"upstream": "b", "model": "y"}]},
                {"id": "m2", "route": [{"upstream": "a", "model": "x"},
                                       {"upstream": "missing", "model": "z"}]},
            ],
        }

    def test_covers_every_route(self):
        res = gw.audit_all_routes(self._cfg())
        self.assertEqual(set(res), {"a/x", "b/y", "missing/z"})

    def test_shared_route_tested_once(self):
        # a/x 同时被 m1 和 m2 引用，不该重复花配额
        gw.audit_all_routes(self._cfg())
        self.assertEqual(self.calls.count("a/x"), 1)

    def test_undefined_upstream_reported_without_request(self):
        res = gw.audit_all_routes(self._cfg())
        self.assertFalse(res["missing/z"]["ok"])
        self.assertIn("上游未定义", res["missing/z"]["error"])
        self.assertNotIn("missing/z", self.calls)

    def test_model_filter(self):
        res = gw.audit_all_routes(self._cfg(), model_ids=["m1"])
        self.assertEqual(set(res), {"a/x", "b/y"})

    def test_empty_config(self):
        self.assertEqual(gw.audit_all_routes({"upstreams": {}, "models": []}), {})


class TestToolAudit(unittest.TestCase):
    def test_tool_call_and_prompt_delta_are_recorded(self):
        result = gw.tool_audit_result(
            {"usage": {"prompt_tokens": 100}},
            {"usage": {"prompt_tokens": 240}, "choices": [{"message": {
                "tool_calls": [{"id": "call_1", "type": "function"}]}}]})
        self.assertTrue(result["tool_calls"])
        self.assertEqual(result["prompt_tokens"], 240)
        self.assertEqual(result["prompt_delta"], 140)
        self.assertFalse(result["suggest_no_tools"])

    def test_missing_tool_call_suggests_no_tools(self):
        result = gw.tool_audit_result(
            {"usage": {"prompt_tokens": 100}},
            {"usage": {"prompt_tokens": 110}, "choices": [{"message": {"content": "不能调用"}}]})
        self.assertFalse(result["tool_calls"])
        self.assertTrue(result["suggest_no_tools"])


class TestStats(unittest.TestCase):
    def setUp(self):
        gw.STATS.clear()

    def tearDown(self):
        gw.STATS.clear()

    def test_accumulates(self):
        gw.stats_record("u/m", True, 1.0, {"prompt_tokens": 10, "completion_tokens": 4}, "m")
        gw.stats_record("u/m", False, 3.0)
        s = gw.stats_snapshot()["u/m"]
        self.assertEqual((s["calls"], s["ok"], s["fail"]), (2, 1, 1))
        self.assertEqual(s["avg_latency"], 2.0)
        self.assertEqual(s["latency_max"], 3.0)
        self.assertEqual(s["prompt_tokens"], 10)

    def test_accumulates_cost_and_cache(self):
        u = {"prompt_tokens": 100, "completion_tokens": 5,
             "prompt_tokens_details": {"cached_tokens": 80}}
        gw.stats_record("u/m", True, 1.0, u, "m", 0.3)
        gw.stats_record("u/m", True, 1.0, u, "m", 0.3)
        s = gw.stats_snapshot()["u/m"]
        self.assertEqual(s["cost"], 0.6)
        self.assertEqual(s["cached_tokens"], 160)

    def test_cost_absent_when_price_unknown(self):
        gw.stats_record("u/m", True, 1.0, {"prompt_tokens": 10}, "m", None)
        self.assertNotIn("cost", gw.stats_snapshot()["u/m"])

    def test_recent_metrics_keep_only_latest_fifty_calls(self):
        for i in range(55):
            gw.stats_record("u/m", i % 2 == 0, 1.0 + i / 10, cost=0.01)
        s = gw.stats_snapshot()["u/m"]
        self.assertEqual(s["recent_calls"], 50)
        self.assertEqual(s["recent_ok"], 25)
        self.assertEqual(s["recent_success_rate"], 50)
        self.assertEqual(s["recent_cost"], 0.5)
        self.assertAlmostEqual(s["recent_avg_latency"], 3.95)


class TestRouteOrder(unittest.TestCase):
    """_route_order 排序：prefer 首选 + 统计感知 + 熔断过滤"""

    def setUp(self):
        gw.CONFIG = {"breaker": {"enabled": True, "threshold": 3, "cooldown": 300}}
        gw.STATS.clear()
        gw.HEALTH.clear()
        gw.STICKY.clear()
        gw.BREAK.clear()
        self.h = gw.Handler.__new__(gw.Handler)

    def _mdef(self, routes):
        return {"id": "m", "route": routes, "sticky": False}

    def _cfg(self, names):
        return {"upstreams": {n: {"baseUrl": f"https://{n}.x/v1"} for n in names}}

    def _stat(self, key, rate, calls=10):
        gw.STATS[key] = {"calls": calls, "ok": int(calls * rate), "latency_sum": calls,
                         "latency_max": 1, "recent": [{"ok": rate >= 0.5, "latency": 0.1}] * calls}

    def test_prefer_route_first_even_if_stats_worse(self):
        # friend 有 prefer 但统计更差，仍应排最前
        gw.HEALTH["friend"] = {"status": "healthy"}
        gw.HEALTH["terra"] = {"status": "healthy"}
        self._stat("friend/g", 0.5)
        self._stat("terra/t", 0.9)
        mdef = self._mdef([
            {"upstream": "terra", "model": "t"},
            {"upstream": "friend", "model": "g", "prefer": True},
            {"upstream": "any", "model": "a"},
        ])
        order = self.h._route_order(mdef, self._cfg(["terra", "friend", "any"]))
        self.assertEqual([e["upstream"] for e in order],
                         ["friend", "terra", "any"])

    def test_prefer_down_does_not_win(self):
        # prefer 上游 health down 时不再强制排最前
        gw.HEALTH["friend"] = {"status": "down"}
        gw.HEALTH["terra"] = {"status": "healthy"}
        self._stat("friend/g", 0.9)
        self._stat("terra/t", 0.5)
        mdef = self._mdef([
            {"upstream": "friend", "model": "g", "prefer": True},
            {"upstream": "terra", "model": "t"},
        ])
        order = self.h._route_order(mdef, self._cfg(["friend", "terra"]))
        self.assertEqual(order[0]["upstream"], "terra")

    def test_prefer_breaker_removed(self):
        # prefer 路由连续失败触发熔断后，被 live 过滤剔除，轮到下一家
        gw.HEALTH["friend"] = {"status": "healthy"}
        gw.HEALTH["terra"] = {"status": "healthy"}
        mdef = self._mdef([
            {"upstream": "friend", "model": "g", "prefer": True},
            {"upstream": "terra", "model": "t"},
        ])
        cfg = self._cfg(["friend", "terra"])
        for _ in range(3):
            gw.breaker_fail("friend/g", "boom")
        order = self.h._route_order(mdef, cfg)
        self.assertEqual([e["upstream"] for e in order], ["terra"])

    def test_no_prefer_keeps_stats_order(self):
        # 无 prefer 时保持统计排序（成功率降序），回归既有行为
        gw.HEALTH["a"] = {"status": "healthy"}
        gw.HEALTH["b"] = {"status": "healthy"}
        self._stat("a/m", 0.3)
        self._stat("b/m", 0.8)
        mdef = self._mdef([
            {"upstream": "a", "model": "m"},
            {"upstream": "b", "model": "m"},
        ])
        order = self.h._route_order(mdef, self._cfg(["a", "b"]))
        self.assertEqual([e["upstream"] for e in order], ["b", "a"])


class TestHealthShouldDown(unittest.TestCase):
    """health_should_down：model_not_found 是模型级问题，不把整个上游标 down"""

    def test_model_not_found_not_down(self):
        # 平台下架该模型（claude 系 503 model_not_found），同上游其他模型仍可用
        self.assertFalse(gw.health_should_down(
            503, '{"error":{"code":"model_not_found","message":"No available channel"}}'))
        self.assertFalse(gw.health_should_down(502, "model_not_found"))
        self.assertFalse(gw.health_should_down(404, "model_not_found"))

    def test_other_5xx_down(self):
        # 真正的上游故障（网关错误/服务器内部错误）仍标 down
        self.assertTrue(gw.health_should_down(502, "Bad Gateway"))
        self.assertTrue(gw.health_should_down(500, "Internal Server Error"))
        self.assertTrue(gw.health_should_down(503, "Service Unavailable"))

    def test_4xx_not_down(self):
        # 4xx（欠费/密钥失效）不标 down（现有行为：只有 5xx 标 down）
        self.assertFalse(gw.health_should_down(402, "balance"))
        self.assertFalse(gw.health_should_down(401, "invalid token"))
        self.assertFalse(gw.health_should_down(400, "bad request"))


class TestRouteRequestOverrides(unittest.TestCase):
    def test_route_reasoning_effort_overrides_client(self):
        req = {"model": "gpt-5.6", "reasoning_effort": "high", "messages": []}
        entry = {"model": "gpt-5.6-sol", "requestOverrides": {"reasoning_effort": "low"}}
        self.assertEqual(gw.build_upstream_body(req, entry, True), {
            "model": "gpt-5.6-sol", "reasoning_effort": "low", "messages": [], "stream": True,
        })

    def test_route_without_overrides_preserves_request(self):
        req = {"model": "gpt-5.6", "temperature": 0.2, "messages": []}
        entry = {"model": "gpt-5.6-sol"}
        self.assertEqual(gw.build_upstream_body(req, entry, False), {
            "model": "gpt-5.6-sol", "temperature": 0.2, "messages": [], "stream": False,
        })

    def test_invalid_overrides_are_ignored(self):
        req = {"model": "gpt-5.6", "messages": []}
        entry = {"model": "gpt-5.6-sol", "requestOverrides": "bad"}
        self.assertEqual(gw.build_upstream_body(req, entry, True), {
            "model": "gpt-5.6-sol", "messages": [], "stream": True,
        })

    def test_compact_tools_preserves_schema_semantics(self):
        long_description = "  useful   detail  " * 80
        tool = {"type": "function", "function": {
            "name": "read_file", "description": long_description,
            "parameters": {"type": "object", "title": "Read args",
                           "properties": {"path": {"type": "string", "title": "Path",
                                                      "description": long_description,
                                                      "minLength": 1}},
                           "required": ["path"], "additionalProperties": False}}}
        req = {"model": "gpt-5.6", "messages": [], "tools": [tool]}
        entry = {"model": "gpt-5.6-sol", "compactTools": True,
                 "toolDescriptionLimit": 120}
        out = gw.build_upstream_body(req, entry, True)
        compact = out["tools"][0]["function"]
        self.assertEqual(compact["name"], "read_file")
        self.assertEqual(compact["parameters"]["required"], ["path"])
        self.assertFalse(compact["parameters"]["additionalProperties"])
        self.assertEqual(compact["parameters"]["properties"]["path"]["minLength"], 1)
        self.assertNotIn("title", compact["parameters"])
        self.assertNotIn("title", compact["parameters"]["properties"]["path"])
        self.assertLessEqual(len(compact["description"]), 120)
        self.assertLessEqual(len(compact["parameters"]["properties"]["path"]["description"]), 120)
        self.assertEqual(tool["function"]["parameters"]["title"], "Read args")

    def test_compact_tools_handles_legacy_functions(self):
        req = {"model": "gpt-5.6", "messages": [], "functions": [{
            "name": "search", "description": "x" * 500,
            "parameters": {"type": "object", "properties": {}}}]}
        entry = {"model": "gpt-5.6-sol", "compactTools": True}
        out = gw.build_upstream_body(req, entry, False)
        self.assertLessEqual(len(out["functions"][0]["description"]), 320)

    def test_explicit_tool_choice_keeps_only_selected_tool(self):
        tools = [{"type": "function", "function": {"name": name,
                  "description": name, "parameters": {"type": "object"}}}
                 for name in ("read_file", "search", "run_test")]
        req = {"model": "gpt-5.6", "messages": [], "tools": tools,
               "tool_choice": {"type": "function", "function": {"name": "run_test"}}}
        entry = {"model": "gpt-5.6-sol", "compactTools": True}
        out = gw.build_upstream_body(req, entry, True)
        self.assertEqual([t["function"]["name"] for t in out["tools"]], ["run_test"])

    def test_unknown_explicit_tool_choice_preserves_all_tools(self):
        tools = [{"type": "function", "function": {"name": "read_file"}}]
        req = {"model": "gpt-5.6", "messages": [], "tools": tools,
               "tool_choice": {"type": "function", "function": {"name": "missing"}}}
        entry = {"model": "gpt-5.6-sol", "compactTools": True}
        out = gw.build_upstream_body(req, entry, True)
        self.assertEqual(len(out["tools"]), 1)

    def test_tools_unchanged_when_compaction_disabled(self):
        tools = [{"type": "function", "function": {
            "name": "x", "description": "x" * 500,
            "parameters": {"type": "object", "title": "Keep"}}}]
        out = gw.build_upstream_body(
            {"model": "gpt-5.6", "messages": [], "tools": tools},
            {"model": "gpt-5.6-sol"}, True)
        self.assertEqual(out["tools"], tools)


if __name__ == "__main__":
    unittest.main(verbosity=2)
