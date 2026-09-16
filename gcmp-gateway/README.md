# GCMP Gateway

本地 OpenAI 兼容聚合网关。把多个第三方中转供应商聚合成少量「逻辑模型」，按优先级自动故障转移，供 VS Code 的 GCMP 插件（或任何 OpenAI 兼容客户端）调用。

纯 Python 3 标准库实现，无第三方依赖。

## 解决的问题

- 供应商可用性波动大（额度耗尽、分组禁用、SSL 断流），单独配置每个供应商的话模型选择器会塞满几十个条目
- 网关把「opus-5」这类逻辑名映射到一串上游，第一个失败就自动换下一个，客户端只看到 7 个模型
- 部分上游流式会挂起 → 用 `noStream` 标记，网关改用非流式请求并自行合成 SSE 返回给客户端

## 快速开始

```bat
copy config.example.json config.json
:: 编辑 config.json，填入各上游的 apiKey
start-gateway.bat
```

启动后：

- 网关地址 `http://127.0.0.1:15800/v1`
- 管理页面 `http://127.0.0.1:15800/admin/`
- 停止：`stop-gateway.bat`

也可以直接运行 `python gateway.py`（前台，能看到实时日志）。

## 客户端配置（VS Code GCMP）

在 `settings.json` 的 `gcmp.compatibleModels` 里为每个逻辑模型加一条：

```jsonc
{
  "id": "gw-opus-5",
  "name": "Opus-5 (Gateway)",
  "provider": "gateway",
  "baseUrl": "http://127.0.0.1:15800/v1",
  "model": "opus-5",
  "sdkMode": "openai-sse",
  "proxy": "noproxy"
}
```

`proxy: "noproxy"` 必须加，否则请求会被系统代理拦掉。

## 配置说明

```jsonc
{
  "listen": { "host": "127.0.0.1", "port": 15800 },
  "proxy": "http://127.0.0.1:7897",     // 上游默认走的代理，null 表示直连
  "timeouts": { "connect": 25, "open": 90, "read": 300 },
  "health": { "interval": 30 },          // 后台健康检查周期（秒），0 关闭
  "breaker": {                           // 路由级熔断
    "enabled": true,
    "threshold": 3,                      // 连续失败几次后熔断该路由
    "cooldown": 300                      // 熔断多少秒后半开放行一次试探
  },

  "upstreams": {
    "示例上游": {
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-xxx",
      "site": "https://example.com/usercenter",  // 可选，签到入口链接；留空则取 baseUrl 域名根
      "headers": { "User-Agent": "..." },  // 可选，部分上游校验 UA
      "noProxy": true,                      // 可选，本机或国内上游不走代理
      "pricing": {                          // 可选，用于成本估算；不填则统计里显示「未知」
        "type": "per_token",                // per_call = 按次，per_token = 按 token
        "in": 2,                            // 输入价，美元/百万 token
        "out": 6,                           // 输出价，美元/百万 token
        "cachedIn": 0.2,                    // 可选，命中缓存的输入价，缺省按 in 的 10%
        "models": {                         // 可选，同上游各模型价格不同时覆盖
          "claude-opus-5": { "in": 8, "out": 40 }
        }
      }
    },
    "按次计费的上游": {
      "baseUrl": "https://percall.example/v1",
      "apiKey": "sk-xxx",
      "pricing": { "type": "per_call", "price": 0.3 }   // 每次调用固定 $0.3，与 token 量无关
    }
  },

  "models": [
    {
      "id": "opus-5",                 // 客户端请求用的模型名
      "name": "Opus-5",
      "maxInputTokens": 200000,
      "maxOutputTokens": 16384,
      "route": [                      // 按顺序尝试，成功即止
        { "upstream": "示例上游", "model": "claude-opus-5" },
        { "upstream": "备用上游", "model": "claude-opus-5", "noStream": true, "timeout": 180 }
      ]
    },
    {
      "id": "deepseek",
      "sticky": false,                // 关掉粘性：每次都从 route 第一条开始，
      "route": [ /* ... */ ]          // 保证便宜的上游永远是首选（默认 true）
    }
  ],

  "bridge": {
    "enabled": true,                       // 网关启动时自动拉起 codex-bridge
    "script": "codex-bridge\\bridge.py",   // 相对路径基于项目根目录
    "port": 15731                          // 端口已在监听时不重复启动
  }
}
```

`config.json` 保存后自动热加载，不用重启。改 `gateway.py` 必须重启进程。

## 管理页面

- 上游卡片：增删改 baseUrl / apiKey / User-Agent / noProxy / 限流 / 计费方式，单独测试连通性，「💰 查余额」按 one-api 约定查 `/dashboard/billing/subscription` 与 `/usage`
- 顶部「签到入口」：把各上游站点列成可点的链接，新标签打开，方便去公益站签到。默认从 baseUrl 推导域名根，如果签到页不在根路径（比如智谱在 `/usercenter`），在上游卡片的「站点地址」里填完整 URL 即可，会存进 `config.json` 的 `site` 字段
- 模型卡片：编辑路由顺序（↑↓）、非流式开关、单条超时；「⚡ 测试该模型」会走完整故障转移链路，结果里显示 `【实际上游 / 上游模型名】` 并高亮命中的路由行
- 「🔍 深度审计」对**每条**路由各发一次真实最小请求，把「通 / 不通 / 换后端」直接标在路由表上。健康检查只 GET `/models`，证明不了这个模型还在架上、余额是否够用，死路由只有等前面全挂时才会暴露；审计能提前发现。同一上游的条目串行执行以避开并发限制，被多个模型共用的路由只测一次
- 审计会真实消耗配额。想先做零成本排查，可以只比对各上游 `/models` 返回的模型清单与 `route` 里的模型名——`GET /models` 各家都免费，能查出「模型已下架」「密钥失效」「上游欠费」这三类死路由，剩下的才交给深度审计
- 模型卡片的「粘性上游」勾选框对应 `sticky` 字段，取消勾选后该模型严格按路由表顺序尝试（成本敏感的模型建议关掉）
- 路由表「优先」列的 ★ 表示当前粘性上游
- 「调用统计」分区按路由列出调用次数、成功率、延迟、token 用量、**缓存命中率**和**累计花费**。花费按上游的 `pricing` 换算，没配价格的显示「未知」而不是猜一个数
- 底部显示最近的网关日志

保存配置时会自动备份成 `config.json.bak`。

## 故障转移行为

- 逐条尝试路由，上一条失败就换下一条。判定为失败的情况：连接错误、非 2xx、响应体含 error、**HTTP 200 但内容为空**（`hcnsec/auto` 这类上游、以及思考模型把 `max_tokens` 全烧在 reasoning 上都会这样）
- 流式请求会先读到「首个可见 delta」再向客户端发响应头，所以空流也能转移
- 上次成功的上游会被记住（粘性），下次优先尝试；给模型加 `"sticky": false` 可关掉，让它每次都严格按 `route` 顺序来（用于「首选便宜上游、贵的只作兜底」的场景）
- 遇到 429 延迟 3 秒重试一次
- 连续失败 `breaker.threshold` 次的路由会被熔断，`cooldown` 秒内直接跳过，不再浪费时间试探；冷却结束后半开放行一次，再失败立刻重新熔断。429 不计入熔断（那是配额问题不是路由坏了）
- 如果一个逻辑模型的所有路由都被熔断，网关会忽略熔断状态照常尝试，不会直接摆烂返回 502
- 后台每 `health.interval` 秒并发探测所有上游的 `/models`（不消耗 chat 配额），失败的上游在路由排序里靠后。失败原因取自 `/models` 而非回退用的 `/health`——绝大多数中转站没有 `/v1/health`（一律 404），否则「欠费 403」「密钥失效 401」这类关键原因会被 404 盖掉
- 响应头一旦发给客户端就不再转移，避免协议流被截断成两半
- 全部上游失败返回 502，响应体带各上游的失败原因

## 响应头标识

每个成功响应都带：

```
X-Gateway-Upstream: tabitoken
X-Gateway-Model: claude-opus-5
X-Gateway-Served-Model: nvidia/nemotron-3-ultra-550b-a55b   # 仅在上游偷换后端时出现
```

流式和非流式路径都有，用来确认实际是哪个供应商响应的。

第三个头是防中转站掺假用的：有些站点 `/models` 里列着 `DeepSeek-V4-Pro`，实际把请求转给了别的便宜模型。网关比对响应体的 `model` 字段，不一致就打日志警告并加上这个头（版本后缀、大小写、厂商前缀差异不算）。

## 调用统计

管理页的「调用统计」面板按路由列出调用次数、成功率、平均/最慢延迟、累计 token、实际返回的模型、熔断状态。数据每 2 分钟落盘到 `stats.json`（已在 `.gitignore` 中），进程退出时也会存一次，重启后继续累计。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查，返回模型数 |
| GET | `/v1/models` | OpenAI 兼容模型列表 |
| POST | `/v1/chat/completions` | 聊天补全，支持 `stream` |
| GET | `/admin/` | 管理页面 |
| GET | `/admin/api/config` | 当前配置（密钥已脱敏）+ 粘性/健康/熔断/统计 + 日志 |
| POST | `/admin/api/config` | 保存配置 |
| POST | `/admin/api/test` | 测试单个上游 |
| POST | `/admin/api/balance` | 查询单个上游余额 |
| POST | `/admin/api/stats` | 清空调用统计与熔断状态 |

管理接口只接受来自本机的请求：会校验 `Host` 头必须是 IP 或 `localhost`，用域名访问一律 403，防止网页通过 DNS rebinding 读走你的密钥。需要放行别的主机名就写进 `admin.allowHosts`。

`/admin/api/config` 返回的 `apiKey` 是脱敏形式（`sk-abc••••••1234`）。管理页保存时把脱敏值原样回传即表示「不修改」，网关会自动还原成真实密钥；想换密钥就直接覆盖成新的完整值。

即便如此也不要把 `listen.host` 改成 `0.0.0.0`——脱敏只挡住了读取，局域网里任何人都还能改你的配置。

## 测试

```bat
python tools\test_gateway.py    :: 纯函数单测，不需要网关在运行
python tools\test_failover.py   :: 起假上游 + 真 Handler，验证故障转移/熔断/统计
python tools\smoke.py           :: 对运行中的网关跑 7 个逻辑模型冒烟（--stream 测流式）
```

## 安全

- `config.json` 含明文密钥，已在 `.gitignore` 中排除。提交前确认没有把它加进版本库
- `config.example.json` 里的 key 全部是 `sk-REPLACE_ME` 占位符
