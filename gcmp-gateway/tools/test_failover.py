# -*- coding: utf-8 -*-
"""端到端故障转移测试：起假上游 + 真网关，验证空回复/静默换模型/熔断等行为。

用法: python tools/test_failover.py
"""
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gateway as gw  # noqa: E402

HITS = []          # [(上游标签, 是否流式)]
FORWARDED = []     # 假上游收到的请求体
BEHAVIOR = {}      # 上游标签 -> 行为名


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeUpstream(BaseHTTPRequestHandler):
    """按 URL 前缀 /<标签>/v1/... 分派，行为由 BEHAVIOR 决定。"""
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, json.dumps({"data": [{"id": "m"}]}).encode())

    def do_POST(self):
        tag = self.path.strip("/").split("/")[0]
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        HITS.append((tag, bool(req.get("stream"))))
        FORWARDED.append(req)
        mode = BEHAVIOR.get(tag, "ok")
        model = req.get("model", "?")

        if mode == "http500":
            self._send(500, b'{"error":{"message":"boom"}}')
        elif mode == "http429":
            self._send(429, b'{"error":{"message":"rate"}}')
        elif mode == "empty":
            self._send(200, json.dumps({
                "model": model, "choices": [{"message": {"role": "assistant", "content": ""}}]
            }).encode())
        elif mode == "empty_sse":
            self._sse([b'data: {"choices":[{"delta":{}}]}\n\n', b'data: [DONE]\n\n'])
        elif mode == "swap":
            self._send(200, json.dumps({
                "model": "nvidia/nemotron-3-ultra",
                "choices": [{"message": {"role": "assistant", "content": "hi"}}]
            }).encode())
        elif mode == "reasoning_only":
            self._send(200, json.dumps({
                "model": model,
                "choices": [{"message": {"role": "assistant", "content": "",
                                         "reasoning_content": "想了想"}}]
            }).encode())
        elif mode == "sse":
            self._sse([b'data: {"model":"' + model.encode() +
                       b'","choices":[{"delta":{"content":"he"}}]}\n\n',
                       b'data: {"choices":[{"delta":{"content":"llo"}}],'
                       b'"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
                       b'data: [DONE]\n\n'])
        else:
            self._send(200, json.dumps({
                "model": model, "usage": {"prompt_tokens": 7, "completion_tokens": 3},
                "choices": [{"message": {"role": "assistant", "content": "hi from " + tag}}]
            }).encode())

    def _sse(self, events):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        for ev in events:
            self.wfile.write(f"{len(ev):X}\r\n".encode() + ev + b"\r\n")
            self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


class FailoverTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.up_port = free_port()
        cls.gw_port = free_port()
        cls.up = ThreadingHTTPServer(("127.0.0.1", cls.up_port), FakeUpstream)
        cls.up.daemon_threads = True
        threading.Thread(target=cls.up.serve_forever, daemon=True).start()

        base = f"http://127.0.0.1:{cls.up_port}"
        gw.CONFIG = {
            "listen": {"host": "127.0.0.1", "port": cls.gw_port},
            "proxy": None,
            "timeouts": {"open": 10, "read": 10},
            "breaker": {"enabled": True, "threshold": 2, "cooldown": 60},
            "upstreams": {
                "a": {"baseUrl": base + "/a/v1", "noProxy": True},
                "b": {"baseUrl": base + "/b/v1", "noProxy": True},
                "c": {"baseUrl": base + "/c/v1", "noProxy": True},
            },
            "models": [
                {"id": "logical", "route": [{"upstream": "a", "model": "model-a"},
                                            {"upstream": "b", "model": "model-b"},
                                            {"upstream": "c", "model": "model-c"}]},
                {"id": "single", "route": [{"upstream": "a", "model": "model-a"}]},
                {"id": "nosticky", "sticky": False,
                 "route": [{"upstream": "a", "model": "model-a"},
                           {"upstream": "b", "model": "model-b"}]},
                {"id": "nostream", "route": [{"upstream": "a", "model": "model-a",
                                              "noStream": True}]},
            ],
        }
        gw.CONFIG_MTIME = -1  # 阻止 load_config 去读真实 config.json
        gw.load_config = lambda: gw.CONFIG
        cls.srv = ThreadingHTTPServer(("127.0.0.1", cls.gw_port), gw.Handler)
        cls.srv.daemon_threads = True
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.up.shutdown()

    def setUp(self):
        HITS.clear()
        FORWARDED.clear()
        BEHAVIOR.clear()
        gw.STICKY.clear()
        gw.BREAK.clear()
        gw.STATS.clear()
        gw.RATE.clear()
        gw.HEALTH.clear()

    def post(self, model, stream=False, timeout=15):
        body = json.dumps({"model": model, "stream": stream, "max_tokens": 64,
                           "messages": [{"role": "user", "content": "hi"}]}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.gw_port}/v1/chat/completions", data=body,
            headers={"Content-Type": "application/json"}, method="POST")
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            r = op.open(req, timeout=timeout)
            return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def hit_tags(self):
        return [t for t, _ in HITS]

    def reset_ordering(self):
        """清掉健康状态与粘性，让路由回到 config 顺序。失败上游会被标 down 并让
        粘性转移，否则同一条坏路由第二轮根本轮不到，测不出熔断。"""
        gw.HEALTH.clear()
        gw.STICKY.clear()

    # ---------- 空回复必须换上游 ----------
    def test_empty_content_fails_over(self):
        BEHAVIOR["a"] = "empty"
        code, body, hdr = self.post("logical")
        self.assertEqual(code, 200)
        self.assertIn("hi from b", body.decode())
        self.assertEqual(self.hit_tags(), ["a", "b"])
        self.assertEqual(hdr.get("X-Gateway-Upstream"), "b")

    def test_reasoning_only_is_not_empty(self):
        BEHAVIOR["a"] = "reasoning_only"
        code, _, hdr = self.post("logical")
        self.assertEqual(code, 200)
        self.assertEqual(hdr.get("X-Gateway-Upstream"), "a")
        self.assertEqual(self.hit_tags(), ["a"])

    def test_bound_skill_reaches_fake_upstream_once(self):
        original_root = gw.SKILLS_DIR
        model = next(m for m in gw.CONFIG["models"] if m["id"] == "single")
        try:
            with tempfile.TemporaryDirectory() as root:
                folder = os.path.join(root, "test-skill")
                os.makedirs(folder)
                with open(os.path.join(folder, "SKILL.md"), "w", encoding="utf-8") as f:
                    f.write("---\nname: test-skill\ndescription: test\n---\nFollow the injected rule.\n")
                gw.SKILLS_DIR = root
                model["skills"] = ["test-skill"]
                code, _, _ = self.post("single")
        finally:
            gw.SKILLS_DIR = original_root
            model.pop("skills", None)
        self.assertEqual(code, 200)
        messages = FORWARDED[0]["messages"]
        injected = [m for m in messages if "Project skill: test-skill" in str(m.get("content"))]
        self.assertEqual(len(injected), 1)
        self.assertIn("Follow the injected rule.", injected[0]["content"])

    def test_empty_sse_fails_over(self):
        BEHAVIOR["a"] = "empty_sse"
        BEHAVIOR["b"] = "sse"
        code, body, hdr = self.post("logical", stream=True)
        self.assertEqual(code, 200)
        self.assertIn("hello", "".join(
            json.loads(l[5:]).get("choices", [{}])[0].get("delta", {}).get("content", "")
            for l in body.decode().splitlines()
            if l.startswith("data:") and "[DONE]" not in l))
        self.assertEqual(hdr.get("X-Gateway-Upstream"), "b")

    def test_all_empty_returns_502(self):
        for t in "abc":
            BEHAVIOR[t] = "empty"
        code, body, _ = self.post("logical")
        self.assertEqual(code, 502)
        self.assertIn("空回复", body.decode())

    # ---------- 静默换模型 ----------
    def test_silent_model_swap_exposed_in_header(self):
        BEHAVIOR["a"] = "swap"
        code, _, hdr = self.post("logical")
        self.assertEqual(code, 200)  # 仍然返回内容，只是标记出来
        self.assertEqual(hdr.get("X-Gateway-Served-Model"), "nvidia/nemotron-3-ultra")
        self.assertTrue(any("静默替换" in l for l in gw.RECENT_LOGS[-6:]))

    # ---------- 熔断 ----------
    def test_breaker_skips_dead_route(self):
        BEHAVIOR["a"] = "http500"
        for _ in range(2):
            self.reset_ordering()
            self.post("logical")
        self.assertGreater(gw.breaker_open("a/model-a"), 0)
        self.reset_ordering()
        HITS.clear()
        self.post("logical")
        self.assertNotIn("a", self.hit_tags())  # 冷却期内不再白试

    def test_429_does_not_trip_breaker(self):
        BEHAVIOR["a"] = "http429"
        for _ in range(2):
            self.reset_ordering()
            self.post("logical")
        self.assertEqual(gw.breaker_open("a/model-a"), 0)

    def test_429_on_non_last_route_does_not_sleep(self):
        """还有别的上游可试时，429 应立刻换下一家，不能白等 3 秒。"""
        BEHAVIOR["a"] = "http429"
        self.reset_ordering()
        t0 = time.time()
        code, _, hdr = self.post("logical")
        elapsed = time.time() - t0
        self.assertEqual(code, 200)
        self.assertEqual(hdr.get("X-Gateway-Upstream"), "b")
        self.assertLess(elapsed, 2.5, f"429 后不该等待重试，实际耗时 {elapsed:.1f}s")

    def test_429_on_last_route_retries_once(self):
        """最后一条路由 429 时值得等 3 秒重试，因为没有别的选择了。"""
        for t in "abc":
            BEHAVIOR[t] = "http429"
        self.reset_ordering()
        HITS.clear()
        self.post("logical", timeout=25)
        # a、b 各打一次（立刻跳过），c 作为最后一家会重试第二次
        self.assertEqual(self.hit_tags().count("c"), 2)
        self.assertEqual(self.hit_tags().count("a"), 1)

    def test_breaker_ignored_when_all_routes_open(self):
        for t in "abc":
            BEHAVIOR[t] = "http500"
        for _ in range(2):
            self.reset_ordering()
            self.post("logical")
        self.reset_ordering()
        HITS.clear()
        code, _, _ = self.post("logical")
        self.assertEqual(code, 502)
        self.assertTrue(self.hit_tags(), "全员熔断时仍应尝试，不能直接空转")

    def test_success_clears_breaker(self):
        BEHAVIOR["a"] = "http500"
        self.post("logical")
        self.assertEqual(gw.BREAK["a/model-a"]["fails"], 1)
        BEHAVIOR.pop("a")
        self.reset_ordering()
        self.post("logical")
        self.assertNotIn("a/model-a", gw.BREAK)

    # ---------- 统计 ----------
    def test_stats_record_tokens_and_served(self):
        self.post("logical")
        s = gw.stats_snapshot()["a/model-a"]
        self.assertEqual((s["calls"], s["ok"]), (1, 1))
        self.assertEqual(s["prompt_tokens"], 7)
        self.assertEqual(s["served"], "model-a")

    def test_stats_record_stream_tokens(self):
        BEHAVIOR["a"] = "sse"
        self.post("logical", stream=True)
        self.assertEqual(gw.stats_snapshot()["a/model-a"]["completion_tokens"], 2)

    def test_stats_count_failures(self):
        BEHAVIOR["a"] = "http500"
        self.post("logical")
        self.assertEqual(gw.stats_snapshot()["a/model-a"]["fail"], 1)

    # ---------- 合成 SSE ----------
    def test_synthesized_sse_is_chunked_and_valid(self):
        code, body, hdr = self.post("nostream", stream=True)
        self.assertEqual(code, 200)
        self.assertIn("event-stream", hdr.get("Content-Type", ""))
        self.assertFalse(HITS[0][1], "noStream 路由必须向上游发非流式")
        lines = [l for l in body.decode().splitlines() if l.startswith("data:")]
        self.assertEqual(lines[-1], "data: [DONE]")
        text = ""
        finish = None
        for l in lines[:-1]:
            ch = json.loads(l[5:])["choices"][0]
            text += ch["delta"].get("content", "")
            finish = ch.get("finish_reason") or finish
        self.assertEqual(text, "hi from a")
        self.assertEqual(finish, "stop")
        self.assertEqual(json.loads(lines[0][5:])["choices"][0]["delta"]["role"], "assistant")

    def test_nonstream_uses_content_length(self):
        _, _, hdr = self.post("logical")
        self.assertIn("Content-Length", hdr)
        self.assertNotIn("Transfer-Encoding", hdr)

    # ---------- 管理接口防护 ----------
    def test_admin_rejects_foreign_host(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.gw_port}/admin/api/config",
                                     headers={"Host": "evil.example.com"})
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            op.open(req, timeout=5)
        self.assertEqual(ctx.exception.code, 403)

    def test_admin_config_masks_keys(self):
        gw.CONFIG["upstreams"]["a"]["apiKey"] = "sk-supersecretkey1234"
        try:
            op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            raw = op.open(f"http://127.0.0.1:{self.gw_port}/admin/api/config",
                          timeout=5).read().decode()
            self.assertNotIn("supersecret", raw)
            self.assertIn("sk-sup", raw)
        finally:
            gw.CONFIG["upstreams"]["a"].pop("apiKey")

    # ---------- 限流 ----------
    def test_rate_limit_skips_to_next_upstream(self):
        gw.CONFIG["upstreams"]["a"]["rateLimit"] = {"limit": 1, "window": 60}
        try:
            self.post("logical")
            HITS.clear()
            self.post("logical")
            self.assertEqual(self.hit_tags(), ["b"])
        finally:
            gw.CONFIG["upstreams"]["a"].pop("rateLimit")

    def test_single_route_rate_limit_waits(self):
        gw.CONFIG["upstreams"]["a"]["rateLimit"] = {"limit": 1, "window": 1}
        try:
            self.post("single")
            code, _, _ = self.post("single")   # 唯一路由，应排队等而不是报错
            self.assertEqual(code, 200)
        finally:
            gw.CONFIG["upstreams"]["a"].pop("rateLimit")

    # ---------- 粘性 ----------
    def test_sticky_prefers_last_success(self):
        BEHAVIOR["a"] = "http500"
        self.post("logical")
        self.assertEqual(gw.STICKY["logical"], "b")
        BEHAVIOR.pop("a")
        gw.BREAK.clear()
        HITS.clear()
        self.post("logical")
        self.assertEqual(self.hit_tags()[0], "b")

    def test_sticky_false_keeps_config_order(self):
        """sticky:false 的模型：即使上次落在 b，下一轮仍必须先试 a（成本优先）。"""
        BEHAVIOR["a"] = "http500"
        self.post("nosticky")
        self.assertIsNone(gw.STICKY.get("nosticky"))
        BEHAVIOR.pop("a")
        gw.BREAK.clear()
        self.reset_ordering()
        HITS.clear()
        self.post("nosticky")
        self.assertEqual(self.hit_tags(), ["a"])


if __name__ == "__main__":
    gw.log = lambda msg: gw.RECENT_LOGS.append(msg)  # 别把测试日志刷到 stdout
    unittest.main(verbosity=2)
