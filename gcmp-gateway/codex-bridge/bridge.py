# -*- coding: utf-8 -*-
"""Codex Bridge —— 把本地 codex CLI（上游 sharedchat）包装成 OpenAI /v1/chat/completions 接口。
GCMP 的 compatibleModels 直接指向 http://127.0.0.1:15731/v1 即可在 Copilot Chat 里使用。
"""
import json
import os
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

CODEX = os.path.join(os.path.expanduser("~"), ".codex-bin", "codex.exe")
WORKDIR = os.path.join(tempfile.gettempdir(), "codex-bridge-wd")
PORT = 15731
MODEL_DEFAULT = "gpt-5.6-terra"
# sharedchat 同一时间只允许一个会话，串行化调用
LOCK = threading.Lock()

os.makedirs(WORKDIR, exist_ok=True)


def messages_to_prompt(messages):
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if isinstance(content, list):
            content = "\n".join(
                c.get("text", "") for c in content if isinstance(c, dict)
            )
        if not content:
            continue
        content = str(content)
        if role == "system":
            parts.append("[系统设定]\n" + content)
        elif role == "assistant":
            parts.append("[之前的助手回复]\n" + content)
        elif role == "tool":
            parts.append("[工具返回]\n" + content)
        else:
            parts.append(content)
    return "\n\n".join(parts)


def run_codex(prompt, model):
    cmd = [
        CODEX, "exec", "--json", "--skip-git-repo-check",
        "--sandbox", "read-only", "-C", WORKDIR, "-",
    ]
    if model:
        cmd += ["-c", 'model="%s"' % model]
    # stdin 传 prompt，避开 Windows 命令行 32K 字符限制
    with LOCK:
        p = subprocess.run(
            cmd, input=prompt.encode("utf-8"),
            capture_output=True, timeout=600,
        )
    out = p.stdout.decode("utf-8", errors="replace")
    text = ""
    err = ""
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get("type") == "item.completed":
            item = ev.get("item") or {}
            if item.get("type") == "agent_message":
                text = item.get("text", "")
            elif item.get("type") == "error":
                # 忽略 code-mode host 缺失之类的非致命错误
                msg = item.get("message", "")
                if "code" not in msg.lower() and "mode" not in msg.lower():
                    err = msg
    if not text:
        raise RuntimeError(err or out[-800:] or "codex 无输出")
    return text


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            self._send_json(200, {
                "object": "list",
                "data": [
                    {"id": "gpt-5.6-terra", "object": "model", "owned_by": "sharedchat"},
                ],
            })
        else:
            self._send_json(200, {"status": "ok"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._send_json(400, {"error": {"message": "bad json"}})
            return
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._send_json(404, {"error": {"message": "not found"}})
            return

        model = body.get("model") or MODEL_DEFAULT
        prompt = messages_to_prompt(body.get("messages") or [])
        full_prompt = (
            "请直接以文本回答下面用户的请求。"
            "不要读写文件、不要执行任何命令，只输出回答内容本身：\n\n" + prompt
        )
        stream = bool(body.get("stream"))
        rid = "chatcmpl-bridge-" + uuid.uuid4().hex[:12]
        created = int(time.time())

        if not stream:
            try:
                text = run_codex(full_prompt, model)
            except Exception as e:
                self._send_json(502, {"error": {"message": str(e)[:500]}})
                return
            self._send_json(200, {
                "id": rid, "object": "chat.completion",
                "created": created, "model": model,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            })
            return

        # SSE 流式：先发首包保活，等 codex 完成后分块推送
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        def chunk(delta, finish=None):
            obj = {
                "id": rid, "object": "chat.completion.chunk",
                "created": created, "model": model,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            return ("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8")

        try:
            self.wfile.write(chunk({"role": "assistant", "content": ""}))
            self.wfile.flush()
            text = run_codex(full_prompt, model)
            step = 1800
            for i in range(0, len(text), step):
                self.wfile.write(chunk({"content": text[i:i + step]}))
                self.wfile.flush()
            self.wfile.write(chunk({}, finish="stop"))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except Exception as e:
            try:
                self.wfile.write(chunk({"content": "\n[bridge error] " + str(e)[:300]}))
                self.wfile.write(chunk({}, finish="stop"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except Exception:
                pass


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("codex-bridge listening on http://127.0.0.1:%d/v1" % PORT, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
