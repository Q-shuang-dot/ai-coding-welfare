# GCMP Gateway

A local, OpenAI-compatible aggregation gateway. It maps a handful of short "logical model" names onto a priority list of third-party API relays and fails over automatically, so any OpenAI-compatible client (VS Code GCMP extension, Codex, Claude Code, SDKs) only ever sees a few stable model names.

Pure Python 3 standard library, no third-party dependencies.

> Full documentation is in [README.md](README.md) (Chinese).

## Why

- Relay providers are flaky: quotas run out, groups get disabled, streams break mid-flight
- Registering every provider separately floods your model picker with dozens of entries
- Some upstreams hang on streaming — mark them `noStream` and the gateway fetches non-streaming and synthesizes SSE for the client

## Quick start

```bat
copy config.example.json config.json
:: edit config.json and fill in each upstream's apiKey
start-gateway.bat
```

Then:

- API: `http://127.0.0.1:15800/v1`
- Admin UI: `http://127.0.0.1:15800/admin/`
- Stop: `stop-gateway.bat`

Or run `python gateway.py` in the foreground to watch live logs.

The listen port is read from `config.json`, so you can change it freely. If `config.json` is missing, the gateway exits with an instruction to copy it from `config.example.json`.

## Minimal config

```jsonc
{
  "listen": { "host": "127.0.0.1", "port": 15800 },
  "upstreams": {
    "example": {
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-REPLACE_ME"
    }
  },
  "models": [
    {
      "id": "deepseek",
      "name": "DeepSeek-V4",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192,
      "route": [
        { "upstream": "example", "model": "deepseek-v4-flash" }
      ]
    }
  ]
}
```

Requests for `model: "deepseek"` are tried against each `route` entry in order; the first success wins. Editing `config.json` hot-reloads it — only `gateway.py` changes need a restart. See [README.md](README.md) for the full option list (timeouts, pricing, sticky routing, rate limits, health checks, protocol adapters, …).

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness probe |
| GET | `/v1/models` | OpenAI-compatible model list |
| POST | `/v1/chat/completions` | Chat completions, supports `stream` |
| GET | `/admin/` | Admin UI |

Successful responses carry `X-Gateway-Upstream` and `X-Gateway-Model` headers identifying which upstream actually served the request.

## Security notes

- `config.json` holds plaintext API keys and is excluded via `.gitignore`. **Delete it (and `stats.json`) before copying or zipping this folder for someone else** — `.gitignore` does not stop a manual copy. Recipients should copy `config.example.json` and fill in their own keys.
- Admin endpoints only accept local requests: the `Host` header must be an IP or `localhost`. Accessing the admin UI through a domain returns 403 to prevent DNS-rebinding key theft.
- Do **not** set `listen.host` to `0.0.0.0` unless you accept that anyone on your LAN can then modify your config.
- `config.example.json` contains only `sk-REPLACE_ME` placeholders.

## License

MIT
