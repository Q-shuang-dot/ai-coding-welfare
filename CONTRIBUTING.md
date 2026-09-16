# 贡献指南

这个仓库只有一条铁律：**README.md 和 docs/index.html 是生成物，不要手改。**
所有内容都来自 `data/sites.json`，改完跑一遍脚本即可。

## 加一个新站点

1. 在 `data/sites.json` 的 `sites` 数组里追加一条：

```jsonc
{
  "id": "example",                       // 唯一标识，会用在 Codex provider 名里
  "name": "Example",
  "subtitle": "一句话卖点",
  "recommended": false,                  // true 会被标成「首推」
  "panel": "newapi",                     // 面板类型，不填即 newapi，另有 vibecode / matrix，见下文
  "credits": {                           // 额度口径，页面上的「首日可得」由它算出来
    "signup": 100,                       // 注册基础额度
    "invite": 50,                        // 通过本仓库邀请链接额外到账，站点接口没有就填 null
    "dailyCheckin": 25,                  // 每日签到额度（累积），没有签到就填 null
    "dailyQuota": null,                  // 每日重置的额度池（不累积），与 dailyCheckin 二选一
    "approx": false,                     // true 时页面显示 ≈，表示站点公示的是约数
    "unit": "usd"                        // 计价单位，不填即 usd；发站内积分的站填 "point"；
                                         // 也写「刀」但充值比例离谱的站（DoCode 1 元 = 50 刀）填 "site-usd"，见下文
  },
  "signupUrl": "https://example.com/register?aff=xxx",
  "inviteCode": "xxx",                   // 只在「注册表单里有一栏邀请码要手填」时写；
                                         // 写了才会在 README 总表末尾出「邀请码」列，没有站需要手填就不出这一列
  "homeUrl": "https://example.com",
  "docsUrl": "https://example.com/docs",
  "statusApi": "https://example.com/api/status",   // New API / One API 系都有
  "pricingApi": "https://example.com/api/pricing", // 需登录就填 null
  "mirrors": [{ "label": "备用域名", "homeUrl": "...", "signupUrl": "..." }],
  "tags": ["公益站", "免费额度"],
  "highlights": ["卖点一", "卖点二"],
  "endpoints": {
    "anthropic": "https://example.com",     // Claude Code 用，末尾不要 /v1
    "openai": "https://example.com/v1"      // Codex / SDK 用
  },
  // endpoints 都是 null（Base URL 要登录后台才下发）时，用 setup 写清怎么接入，
  // 页面会用它替换掉示例配置代码块——不要凭猜测填一个 Base URL 上去
  "setup": {
    "client": "Codex CLI",
    "note": "一句话说明为什么本页不给 Base URL",
    "steps": ["第一步", "第二步"],
    "dashboardUrl": "https://example.com/dashboard"
  },
  "modelsNote": "该站不公示模型清单时，写一句解释替代模型表",
  "register": { "methods": ["GitHub OAuth"], "requirements": ["注意事项"] },
  "earnMore": ["每日签到"],
  "caveats": ["风险提示"],
  "community": []
}
```

2. 重新生成并自检：

```bash
npm test          # 单测：抓取失败时的合并逻辑（不联网）
npm run refresh   # 抓 /api/status 与 /api/pricing，写入 data/live.json
npm run build     # 重新生成 README.md 与 docs/index.html
npm run check     # 确认新链接可访问
```

3. 提交时把 `data/sites.json`、`data/live.json`、`README.md`、`docs/` 一起带上。

## 站点不是 New API 面板怎么办

`panel` 字段选探测方式，路由表在 [`scripts/lib/panels.mjs`](scripts/lib/panels.mjs)：

| panel | 适用站点 | 读的接口 |
| --- | --- | --- |
| `newapi`（默认） | New API / One API 系 | `/api/status` + `/api/pricing` |
| `vibecode` | RawChat 系 Codex 公益站 | `/frontend-api/getConfig` + `/frontend-api/getLoginConfig` |
| `matrix` | Matrix（统一网关 + 应用商店） | `/api/health`（公开的只有这一个，站名 / 模型 / 网关地址都要登录） |
| `relay` | 自研网关 / 任务制积分站（CheapCodex、NOFX） | robots 放行的任意一个「还活着」URL：CheapCodex 探 `/v1/models`（不带 key 回 401 就算活着），NOFX 探 `sitemap.xml`。这两家的 robots.txt 直接禁掉 `/api`，面板接口一律不碰 |

`statusApi` 这个字段名是历史包袱：`relay` 面板下它不必是「状态接口」，填 robots 允许抓、
且能代表站点活着的任意一个 URL 即可，`probeRelay` 只回答「还活着吗、多久答话」。

新增一种面板：在 `scripts/lib/` 下写一个 `probeXxx(site, get = fetchJson)`，
返回值必须是 `blankSnapshot()` 的字段集合（多一个少一个都不行，`merge.mjs` 和渲染器按字段取数），
然后登记到 `PANELS` 里，并在 `scripts/test.mjs` 里贴一份真实返回体做断言——
参考 [`scripts/lib/vibecode.mjs`](scripts/lib/vibecode.mjs)，那里也顺手记下了这类站点
「额度 / Base URL 只有登录后才下发」这一事实，公开接口拿不到的东西一律不猜。
最省的例子是 [`scripts/lib/matrix.mjs`](scripts/lib/matrix.mjs)：那个站公开的只有一个健康检查，
于是探测就只据实回答「还活着吗、多久答话」，其余字段全留 null，绝不把 `sites.json` 里的登记值
倒灌进 `live.json` 假装是探测结果。比它还省的是 [`scripts/lib/relay.mjs`](scripts/lib/relay.mjs)：
连健康检查都没有，只能拿一个 robots 放行的 URL 判存活；它默认注入的是 `probeUrl` 而不是
`fetchJson`，因为 `fetchJson` 会把预期之内的 401 当失败连打三次，每 6 小时探一次的东西
没理由一次敲三下人家的门。

## 改版式 / 改文案

- README 的结构在 [`scripts/lib/render-readme.mjs`](scripts/lib/render-readme.mjs)
- 落地页结构在 [`scripts/lib/render-html.mjs`](scripts/lib/render-html.mjs)，样式在 [`docs/assets/style.css`](docs/assets/style.css)（这个是手写文件，可以直接改）
- 抓取字段的解析在 [`scripts/lib/newapi.mjs`](scripts/lib/newapi.mjs)（同时是各面板共用的底座：`fetchJson` / `blankSnapshot` / `pickPreferred`）
- 额度口径在 [`scripts/lib/credits.mjs`](scripts/lib/credits.mjs)：站点接口只暴露邀请额度，注册基础额度和签到额度是站内公示、只能手工登记在 `credits` 里；`npm run build` 会拿登记值和接口实测值对账，不一致就告警，看到告警就去更新 `data/sites.json`。注意区分两种「每日」——`dailyCheckin` 是签到领到手、会累积；`dailyQuota` 是每天重置的额度池，用不完清零，文案上一律写「重置 / 不累积」，别混着说。还要注意计价单位：`credits.unit` 不填即美元，发站内积分的站（如 Matrix）填 `"point"`，页面会按「600 积分」显示；跨站合计（「首日最高」「全注册约多少」）只统计美元站，积分站单独说一句——积分与美元没有公开换算，加在一起就是编数字。写「刀」但那个刀不是美元的站填 `"site-usd"`（如 DoCode：面板的 `price` 字段是充值比例，多数站 7.3 即 ¥7.3 ≈ $1，它是 0.02 即 1 元 = 50 刀，扣费还要再乘 7~14 倍的站内倍率）——判据就是 `/api/status` 的 `price` 与 `quota_per_unit`，和 7.3 差一个数量级的一律按站内单位登记，页面显示「300 站内刀」并排除在美元合计之外。新增单位要同时补 `credits.mjs` 里的 `UNITS`，否则只会原样后缀显示并在 build 时告警。
- 抓取失败时的降级策略在 [`scripts/lib/merge.mjs`](scripts/lib/merge.mjs)：内容字段沿用上一次成功的快照，`online` 以注册页能否访问为准（接口被 Cloudflare 拦不等于站点挂了）；连注册页也被拦（403 / 429 / 503 / 挑战页）时按「机房 IP 被 WAF 拦」处理——沿用上次的在线判定并标 `probeBlocked`，页面上写明数据是哪次快照的。超时 / 连不上 / 502 这类信号才算真下线；上次成功探测超过 48 小时也不再兜底，如实标异常。改这里请一并跑 `npm test`。

改完同样跑 `npm run build`，把生成物一起提交，CI 才不会又把它刷回去。

## 收录标准

- 能**免费**拿到额度，注册流程不强制付费、不套娃
- 有可探测的公开接口（能自动更新的站点才好长期维护）
- 不收录纯付费中转、需要邀请码倒卖的站点

## 第一次推到 GitHub

1. 把 `data/sites.json` 里 `meta.repoUrl` / `meta.pagesUrl` 换成你自己的用户名，重新 `npm run build`。
2. 建好空仓库后推上去：

```bash
git remote add origin https://github.com/qi-jingjie/gcmp-welfare-temp.git
git branch -M main
git push -u origin main
```

3. 仓库 Settings → Pages → Source 选 **Deploy from a branch**，分支 `main`、目录 `/docs`，保存后落地页就上线了。
4. Settings → Actions → General → Workflow permissions 勾 **Read and write permissions**，否则定时刷新的自动提交会被拒。
5. 仓库简介与 Topics 建议填上 `claude-code`、`codex`、`free-api`、`new-api` 之类的关键词，这是 GitHub 站内搜索的主要抓手。

## 一点分寸

推广页面写实话就够了：额度、门槛、限制照抄站点公示，不夸大、不承诺稳定性。
公益站是别人自掏腰包做的，别引导批量注册和刷额度——把站刷没了大家都用不上。
