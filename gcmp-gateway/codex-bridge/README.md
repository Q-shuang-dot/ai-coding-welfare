# codex-bridge

把本地 `codex.exe` 包装成 OpenAI 兼容接口，让上游 sharedchat 的 gpt-5.6-terra 能被网关（以及任何 OpenAI 兼容客户端）调用。

监听 `http://127.0.0.1:15731/v1`。

## 为什么需要它

sharedchat 只认真实的 codex 客户端，伪造 HTTP 头无效。所以这里不直接发 HTTP，而是调用 `codex exec` 子进程，由它去完成上游的客户端校验，桥接只负责把 codex 的 JSON 事件流翻译成 OpenAI 格式。

## 前置条件

- `%USERPROFILE%\.codex-bin\codex.exe`（codex 官方二进制，本机是 0.151.0）
- `%USERPROFILE%\.codex\config.toml` 里默认供应商已指向 sharedchat，且 `http_headers` 含 `x-openai-actor-authorization`
- Python 3（标准库即可，无第三方依赖）

## 使用

```bat
start-bridge.bat    :: 启动（已在运行则跳过）
stop-bridge.bat     :: 停止，并清理残留 codex 进程
```

网关的 `config.json` 里 sharedchat 上游指向它：

```jsonc
"sharedchat": {
  "baseUrl": "http://127.0.0.1:15731/v1",
  "noProxy": true
}
```

`noProxy` 必须加，本机地址不能走系统代理。

## 已知限制

- sharedchat 同一时间只允许一个会话，桥接内部用锁串行化所有请求，并发请求会排队
- 残留的 codex 进程会一直持有会话锁，导致后续请求全部失败。`stop-bridge.bat` 会顺手清理；手动处理是 `Get-Process codex | Stop-Process -Force` 然后等约 10 秒
- 流式不是真流式：codex 跑完才分块推送，只有首包是立即发出用于保活
- 单次调用超时 600 秒
