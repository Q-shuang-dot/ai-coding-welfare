/**
 * 展示文案的语言包。
 *
 * 中文是主版本，模板里的中文原先直接写死在渲染器里；加英文版时最怕的是「两个渲染器各写一套」——
 * 改一处忘一处，两版内容就开始漂移。所以面向读者的字串统一收到这里，渲染器只负责取词和拼装。
 *
 * 约定：
 *   - zh 是默认语言，取词拼出来的结果与重构前逐字节一致（README.md 的回归对照）
 *   - 函数式词条接收参数、返回拼好的整句；中英文语序不同，不靠占位符硬套
 *   - 站点自身的文案（卖点 / 注意事项 / 公告）不是模板，是数据，走 sites.json 的 en 覆盖块
 */

/** 面板抓回来的登录方式枚举，只用于展示，不参与逻辑判断 */
const LOGIN_METHODS = {
  zh: {},
  en: { 账号密码: 'Email + password' },
};

/** 计价单位的显示方式；未登记的单位原样后缀显示，绝不擅自加 $ */
const UNITS = {
  zh: {
    usd: { prefix: '$', suffix: '' },
    point: { prefix: '', suffix: ' 积分' },
    'site-usd': { prefix: '', suffix: ' 站内刀' },
    free: { prefix: '', suffix: '' },
  },
  en: {
    usd: { prefix: '$', suffix: '' },
    point: { prefix: '', suffix: ' pts' },
    'site-usd': { prefix: '', suffix: ' site-USD' },
    free: { prefix: '', suffix: '' },
  },
};

const en = {
  meta: {
    title: 'Free Claude Code / Codex credits, tracked',
    tagline:
      'A tracker for relay and community services that hand out free Claude Code / Codex / Cursor quota — daily check-ins included',
  },

  common: { unknown: 'unknown' },

  langSwitch: '<p align="center"><a href="README.md"><b>中文</b></a></p>',

  badges: {
    sites: (n) => ({ label: 'Tracked services', msg: `${n}`, color: 'blue' }),
    online: (up, total, all) => ({ label: 'Online', msg: `${up}/${total}`, color: all ? 'brightgreen' : 'orange' }),
    open: (n, total) => ({ label: 'Accepting signups', msg: `${n}/${total}`, color: 'yellow' }),
    best: (v) => ({ label: 'Best first day', msg: `$${v}`, color: 'success' }),
    updated: (t) => ({ label: 'Data updated', msg: t, color: 'informational' }),
  },

  hero: {
    quickTitle: '🚀 Get started in a minute',
    note: '> Both tables below point to third-party services. This repo only aggregates information.',
  },

  table: {
    headers: ['Service', 'Status', 'First day', 'How it adds up', 'After that', 'Protocols', 'Models', 'Sign up', 'Invite code'],
    stateOnline: '🟢 Online',
    stateShut: '🟡 Closed',
    stateDown: '🔴 Unreachable',
    free: 'Free',
    announced: 'Posted on site',
    freeGroup: 'Free tier, zero cost',
    checkinYes: 'Daily check-in',
    checkinNo: 'No check-in',
    modelsKnown: (n) => `${n} listed`,
    modelsLogin: 'Sign in to see',
    signupDefault: 'Configure in console',
    ctaRegister: 'Sign up →',
    ctaClosed: 'Closed · open anyway →',
    ctaOauth: (m) => `${m} sign up →`,
    signupSuffix: 'sign up',
  },

  callouts: {
    firstDay: (time) =>
      `> "First day" = signup bonus + invite bonus from this page + whatever check-in pays out on day one (services with a daily reset pool count a single day's pool). Models, prices and status are scraped from each service's public API. Last update: \`${time}\`.`,
    inviteCode: (list) =>
      `> Services with a code in the "Invite code" column (${list}) require **typing the code yourself** in the signup form. Miss it and you only get the base signup bonus — it cannot be added afterwards. A dash means the invite bonus travels inside the link and needs no typing.`,
    totals: (scope, total, resetting, extra) =>
      `> Signing up for ${scope} gets you roughly **$${total}** on day one${
        resetting ? ' (daily reset pools refill the next day but never accumulate)' : ''
      }${
        extra
          ? `; ${extra} — each service prices in its own unit with no published USD conversion, so those are left out of this total`
          : ''
      }.`,
    scope: (n) => `all ${n} USD-priced services that still accept new users`,
    scopeAll: (n) => `all ${n} services that still accept new users`,
    closed: (names, pages) =>
      `> 🟡 ${names} report \`register_enabled=false\` — new accounts can no longer sign up there. Their credits are struck through and excluded from the total above. The services themselves are still running and existing users are unaffected; any reopening shows up in the [changelog](${pages}changelog/).`,
    stale: (n) =>
      `> 🟡 ${n} services have not returned fresh API data for over 48 hours. Details show the last successful snapshot; online status reflects whether the signup page actually loads.`,
  },

  quickstart: {
    lead: '**Just want to use Claude Code right now?** Three steps:',
    steps: [
      'Open a signup link from the table above and log in however that service allows (GitHub / email). Credits are attached to the invite link — stripping it usually costs you the bonus.',
      'In the dashboard, create a key under "Tokens / API Keys".',
      "Run the helper script below, or copy the environment variables from that service's section.",
    ],
    bashComment: '# Interactively writes Claude Code environment variables (macOS / Linux)',
    psComment: '# Windows PowerShell',
  },

  section: {
    details: '📚 Service details',
    recommended: ' 🔥 Top pick',
    why: '**Why sign up**',
    howMuch: '**How much you get**',
    live: '**Live data** (scraped from public APIs)',
    mirrors: '**Mirrors / alternate entry points**',
    mirrorSep: ': ',
    mirrorFallback: 'Alternate domain',
    mirrorSignup: 'Sign up via the mirror',
    models: '**Available models**',
    requirements: '**Signup requirements**',
    requirementsNone: '- No special requirements',
    setup: '**Client setup**',
    setupFallback: '> Sign in to your dashboard to find the connection details.',
    consoleLink: (url) => `Console: <${url}>`,
    signupBadge: 'Sign up',
    signupAlt: (name) => `Sign up for ${name}`,
    earnMore: '**How to keep earning credits**',
    caveats: '**⚠️ Read before use**',
    community: '**Official channels**',
    announcements: '<details><summary><b>Latest announcements</b> (synced automatically)</summary>',
    announcementsNote: (pages) =>
      `> Announcements are published in Chinese only and are not machine translated here. See the [Chinese README](${pages}) or the service dashboard.`,
    noModelTable:
      '> This service does not publish a model list; sign in to see available models and their pricing.',
    modelNoteFixed:
      'Rows marked "per call" are billed per request regardless of token usage; everything else uses ratio 1 ≈ $2 / 1M tokens. Always confirm against in-site pricing.',
    modelNoteToken:
      'Ratio 1 ≈ $2 / 1M tokens; output price = ratio × completion ratio × $2. Always confirm against in-site pricing.',
  },

  modelsTable: {
    headers: ['Model', 'Ratio', 'Input / 1M tokens', 'Output / 1M tokens', 'Protocols'],
    perCall: 'per call',
    perCallPrice: (v) => `**$${v} / call**`,
  },

  setup: {
    claudeSummary:
      '<details open><summary><b>Claude Code</b> (Anthropic-compatible; Base URL without <code>/v1</code>)</summary>',
    claudeKey: 'YOUR_API_KEY',
    codexSummary:
      '<details><summary><b>Codex CLI</b> (OpenAI-compatible; goes into <code>~/.codex/config.toml</code>)</summary>',
    genericSummary: '<details><summary><b>OpenAI SDK / Cherry Studio / Cursor and other generic clients</b></summary>',
    genericNote: (oai) =>
      `Generic clients need two fields: **Base URL** = \`${oai}\`, **API Key** = the key you created in the dashboard.`,
    genericKey: 'YOUR_API_KEY',
    verifySummary: '<details><summary><b>Connectivity self-test</b></summary>',
    verifyPrompt: 'reply OK only',
    pickModel: '<sign in to see available model names>',
  },

  credit: {
    signup: (v) => `- Signup bonus: **${v}**`,
    invite: (v, verified) => `- Extra via this page's invite link: **${v}**${verified ? ' (matches the service API)' : ''}`,
    dailyCheckin: (v) => `- Daily check-in: **${v}/day** (what keeps the free tier alive)`,
    dailyPool: (v) =>
      `- Daily quota pool: **${v}/day** (resets every day, unused credit does not accumulate, no check-in needed)`,
    firstDay: (v, detail) => `- First day total: **${v}**${detail ? ` (${detail})` : ''}`,
    breakdownSignup: (v) => `signup ${v}`,
    breakdownInvite: (v) => `this page's invite ${v}`,
    breakdownRealName: (v) => `ID verification ${v}`,
    breakdownCheckin: (v) => `first check-in ${v}`,
    breakdownPool: (v) => `daily pool ${v}`,
    poolSuffix: ' (resets daily, does not accumulate)',
    perDay: (v, resets) => `${v}/day${resets ? ' (resets)' : ''}`,
    free: 'Free',
    othersItem: (name, v) => `${name} separately credits ${v}`,
    othersJoin: ', ',
  },

  live: {
    stale: (hours, from) => `⚠ No fresh API data for ${hours} hours; the info below is a snapshot from \`${from}\``,
    blockedFrom: (from) =>
      `ℹ️ This probe was blocked by the service WAF (common for GitHub Actions IP ranges; home connections are unaffected). Status and details below come from the last successful snapshot at \`${from}\``,
    systemName: (v) => `Panel name: **${v}**`,
    version: (v) => `Panel version: \`${v}\``,
    services: (v) => `Services offered: ${v}`,
    inviterBonus: (v) => `Referral bonus: **$${v}**`,
    checkin: (v) => `Daily check-in: ${v}`,
    registerOpen: (v, note) => `Open signups: ${v}${note ? ` (${note})` : ''}`,
    loginMethods: (v) => `Login methods: ${v}`,
    githubAge: (days) => `GitHub account must be at least **${days} days** old`,
    latency: (ms) => `API latency: ${ms} ms`,
    yes: '✅',
    no: '❌',
    unknown: '—',
    none: '_No live data yet_',
  },

  signup: {
    closedShort: 'Signups paused',
    closedNote:
      'The service API reports new signups are closed, so registration will likely fail right now. Existing users are unaffected.',
    oauthShort: (list) => `${list} only`,
    oauthNote: (list) =>
      `The service turned off email/password signup, so you have to create the account with ${list} (a common anti-abuse measure).`,
    openShort: 'Open',
  },

  changes: {
    title: '🔔 Credit changes get announced here',
    intro: (samples, days) =>
      `CI probes every service every 6 hours and diffs each field against the previous snapshot${
        samples ? `; ${samples} samples covering about ${days} days so far` : ''
      }. Credit adjustments, outages and recoveries, models added or removed, and price changes are all recorded automatically:`,
    watch:
      '- Click **Watch → Custom → Releases** at the top of the repo and GitHub emails you when something important changes',
    noteZhOnly:
      'The event log below is written in Chinese and is not machine translated here. Full record: [CHANGELOG.md](CHANGELOG.md).',
  },

  tail: {
    filesTitle: '🧰 What is in this repo',
    filesHeaders: ['File', 'Purpose'],
    files: [
      ['[`data/sites.json`](data/sites.json)', 'Single source of truth: service info and promo links'],
      ['[`data/live.json`](data/live.json)', 'Scraped live snapshot (credits / models / status)'],
      ['[`data/history.json`](data/history.json)', 'Uptime time series, one sample every 6 hours'],
      ['[`data/changelog.json`](data/changelog.json)', 'Change events produced by diffing snapshots'],
      ['[`scripts/refresh.mjs`](scripts/refresh.mjs)', 'Scrapes the public APIs'],
      ['[`scripts/lib/merge.mjs`](scripts/lib/merge.mjs)', 'Falls back to the previous snapshot when a scrape fails, so pages never go blank'],
      ['[`scripts/lib/credits.mjs`](scripts/lib/credits.mjs)', 'Credit math: signup + invite + check-in = first day'],
      ['[`scripts/lib/diff.mjs`](scripts/lib/diff.mjs)', 'Diffs two snapshots and keeps only changes that affect "is it worth signing up?"'],
      ['[`scripts/history.mjs`](scripts/history.mjs)', 'Archives history and generates CHANGELOG / releases / promo material'],
      ['[`scripts/build.mjs`](scripts/build.mjs)', 'Regenerates the README and the whole docs/ site from data'],
      ['[`scripts/notify.mjs`](scripts/notify.mjs)', 'Pushes important changes to Telegram (skipped when no secret is configured)'],
      ['[`scripts/check.mjs`](scripts/check.mjs)', 'Link and service health check; CI alerts on dead links'],
      ['[`scripts/test.mjs`](scripts/test.mjs)', 'Unit tests for merge logic and credit math (zero deps, `npm test`)'],
      ['[`scripts/quickstart.sh`](scripts/quickstart.sh) / [`.ps1`](scripts/quickstart.ps1)', 'Interactively configures Claude Code environment variables'],
    ],
    runTitle: 'Run it locally:',
    runComments: [
      '# unit tests (offline)',
      '# scrape fresh data',
      '# archive history + generate the changelog',
      '# regenerate README + docs/',
      '# check whether links are still alive',
    ],
    groupTitle: '💬 Community chat',
    groupAlt: 'QQ group QR code — GCMP welfare services, 1125690737',
    groupDesc:
      'QQ group: <b>1125690737</b> (GCMP) · A Chinese-language group — scan or search the number to join for service updates and signup tips.',
  },

  faq: {
    title: '❓ FAQ',
    items: [
      [
        'Why is my balance still $0 after signing up?',
        'Community services usually settle credits at login, so **log out and log back in once** — that normally makes them appear. A briefly shown $0 is a frontend display issue; refresh again in a moment.',
      ],
      [
        'Claude Code returns 401 / Unauthorized?',
        "Check in this order: does the Base URL mistakenly include `/v1` (do not add it for the Anthropic protocol), is the key copied in full, is the model name on the service's list, and is your client one it supports.",
      ],
      [
        'Requests come back 400 content blocked?',
        'Some services only allow Chinese / English / French / German / Russian. Prompts mixing in other languages get blocked upstream — retry in another language.',
      ],
      [
        'I am signed in to Claude Pro / Max — will this conflict?',
        'Yes. Environment variables take priority over subscription login. To switch back to the official subscription, `unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL` and open a new terminal.',
      ],
    ],
  },

  contribute: {
    title: '🤝 Suggest a new service',
    intro: 'Found a community or relay service worth listing? Two ways:',
    issue: (url) => `- Open an [Issue](${url}) and fill in the form`,
    pr: '- Or send a PR: add an entry to `data/sites.json`, run `npm run refresh && npm run build`, then commit',
    criteria:
      'Criteria: **credits are genuinely free**, signup is not an endless chain, and the service exposes a public API that can be probed.',
  },

  disclaimer: {
    title: '⚠️ Disclaimer',
    items: [
      '- The signup links on this page are **invite links**: both sides receive credits from the service, and they do not change your signup flow or how much you get.',
      '- This repo only aggregates information and is **not affiliated with any of these services**. No fees are collected and no availability is promised. Community services can change rules, rate-limit, or shut down at any time.',
      '- Do not hand production keys, private data, or company code to relay services of unknown origin; use official APIs for anything important.',
      '- Follow each service and upstream provider terms of use. Bulk registration, traffic farming, and reselling credits are prohibited — bans are on you.',
      '- Credits / models / prices on this page are scraped automatically and only reflect the moment they were captured. **Always treat in-site pricing as the source of truth.**',
    ],
  },

  footer: {
    star: '<b>Found this useful? Give it a ⭐ Star</b> — the page updates automatically when the services change.',
    keywords: (kws) => `<sub>Keywords: ${kws}</sub>`,
    generated:
      '<!-- This file is generated by scripts/build.mjs — edit data/sites.json or scripts/lib/render-readme.mjs instead -->',
  },
};

const zh = {
  meta: {
    title: 'AI 福利站 · Claude Code / Codex 免费额度白嫖导航',
    tagline: '免费额度 · 白嫖 Claude Code / Codex / Cursor 的中转与公益站合集 · 每日签到领福利',
  },

  common: { unknown: '未知' },

  langSwitch: '<p align="center"><a href="README.en.md"><b>English</b></a></p>',

  badges: {
    sites: (n) => ({ label: '收录福利站', msg: `${n} 个`, color: 'blue' }),
    online: (up, total, all) => ({ label: '在线', msg: `${up}/${total}`, color: all ? 'brightgreen' : 'orange' }),
    open: (n, total) => ({ label: '可注册', msg: `${n}/${total}`, color: 'yellow' }),
    best: (v) => ({ label: '首日可得', msg: `最高 $${v}`, color: 'success' }),
    updated: (t) => ({ label: '数据更新', msg: t, color: 'informational' }),
  },

  hero: {
    quickTitle: '🚀 一分钟上车（福利站）',
    note: '> 下面两张表都是第三方站点，本仓库只做信息聚合。',
  },

  table: {
    headers: ['站点', '状态', '首日可得', '额度构成', '之后每天', '兼容协议', '模型', '注册', '邀请码'],
    stateOnline: '🟢 在线',
    stateShut: '🟡 停注',
    stateDown: '🔴 异常',
    free: '免费',
    announced: '站内公示',
    freeGroup: '白嫖分组免费',
    checkinYes: '支持签到',
    checkinNo: '无签到',
    modelsKnown: (n) => `${n} 个可查`,
    modelsLogin: '需登录查看',
    signupDefault: '登录后台配置',
    ctaRegister: '点此注册 →',
    ctaClosed: '已停注 · 仍可打开 →',
    ctaOauth: (m) => `${m} 注册 →`,
    signupSuffix: '注册',
  },

  callouts: {
    firstDay: (time) =>
      `> 「首日可得」= 注册基础额度 + 本页邀请链接额度 + 当天能领的签到额度（每日重置额度池的站点按一天的池子算）；模型、价格、在线状态由脚本抓取站点公开接口自动生成，最后更新：\`${time}\`。`,
    inviteCode: (list) =>
      `> 「邀请码」列写了码的站（${list}），注册表单里有一栏要**自己填**，漏填就只拿得到注册基础额度、事后补不上；其余站写 — 是因为邀请额度由链接自带，不用手打。`,
    totals: (scope, total, resetting, extra) =>
      `> ${scope}全注册一遍，第一天手上大约有 **$${total}** 额度可用${
        resetting ? '（其中每日重置的额度池次日会回满，但不累积）' : ''
      }${extra ? `；${extra}，都是各站自己的计价单位、与美元没有公开换算，未计入这个合计` : ''}。`,
    scope: (n) => `${n} 个按美元计价、且还收新用户的站`,
    scopeAll: (n) => `${n} 个还收新用户的站`,
    closed: (names, pages) =>
      `> 🟡 ${names} 的接口自报已关闭新用户注册（\`register_enabled=false\`），表里额度已划掉、也没算进上面的合计；站点本身还在跑，老用户不受影响，重新开放会记进[变动日志](${pages}changelog/)。`,
    stale: (n) =>
      `> 🟡 有 ${n} 个站点已超过 48 小时没抓到接口数据，其明细为上一次成功抓取的快照；在线状态按注册页实际可访问性判断。`,
  },

  quickstart: {
    lead: '**只想快点用上 Claude Code？** 三步：',
    steps: [
      '点上表的注册链接 → 按站点支持的方式登录（GitHub / 邮箱），额度是按邀请链接发放的，别走裸链',
      '后台「令牌 / API Keys」新建一个 Key',
      '跑一键脚本，或手抄下面对应站点的环境变量',
    ],
    bashComment: '# 交互式写好 Claude Code 的环境变量（macOS / Linux）',
    psComment: '# Windows PowerShell',
  },

  section: {
    details: '📚 福利站详情',
    recommended: ' 🔥 首推',
    why: '**为什么值得注册**',
    howMuch: '**能拿多少额度**',
    live: '**实时数据**（自动抓取站点公开接口）',
    mirrors: '**镜像 / 备用入口**',
    mirrorSep: '：',
    mirrorFallback: '备用域名',
    mirrorSignup: '从备用域名注册',
    models: '**当前可用模型**',
    requirements: '**注册要求**',
    requirementsNone: '- 无特殊限制',
    setup: '**接入配置**',
    setupFallback: '> 注册登录后在站内后台查看接入方式。',
    consoleLink: (url) => `控制台入口：<${url}>`,
    signupBadge: '立即注册',
    signupAlt: (name) => `注册 ${name}`,
    earnMore: '**如何继续拿额度**',
    caveats: '**⚠️ 使用前必读**',
    community: '**官方渠道**',
    announcements: '<details><summary><b>站点最新公告</b>（自动同步）</summary>',
    announcementsNote: () => null,
    noModelTable: '> 该站模型清单需登录后台查看，注册后在「模型价格」页确认。',
    modelNoteFixed: '标「按次」的模型按请求次数计费，与 tokens 用量无关；其余倍率 1 ≈ $2 / 1M tokens。以站内实时价格为准。',
    modelNoteToken: '倍率 1 ≈ $2 / 1M tokens，输出价 = 倍率 × 补全倍率 × $2；以站内实时价格为准。',
  },

  modelsTable: {
    headers: ['模型', '倍率', '输入 / 1M tokens', '输出 / 1M tokens', '协议'],
    perCall: '按次',
    perCallPrice: (v) => `**$${v} / 次**`,
  },

  setup: {
    claudeSummary: '<details open><summary><b>Claude Code</b>（Anthropic 兼容，Base URL 不带 <code>/v1</code>）</summary>',
    claudeKey: '你在站点后台创建的 Key',
    codexSummary: '<details><summary><b>Codex CLI</b>（OpenAI 兼容，写入 <code>~/.codex/config.toml</code>）</summary>',
    genericSummary: '<details><summary><b>OpenAI SDK / Cherry Studio / Cursor 等通用客户端</b></summary>',
    genericNote: (oai) => `通用客户端只需填两项：**Base URL** = \`${oai}\`，**API Key** = 站点后台创建的 Key。`,
    genericKey: '你的 Key',
    verifySummary: '<details><summary><b>连通性自测</b></summary>',
    verifyPrompt: '只回复 OK',
    pickModel: '<登录后台查看可用模型名>',
  },

  credit: {
    signup: (v) => `- 注册即送：**${v}**`,
    invite: (v, verified) => `- 从本页邀请链接注册额外：**${v}**${verified ? '（站点接口实测一致）' : ''}`,
    dailyCheckin: (v) => `- 每日签到：**${v}/天**（长期续命的关键）`,
    dailyPool: (v) => `- 每日额度池：**${v}/天**（每天重置，当天用不完不累积，也不用签到）`,
    firstDay: (v, detail) => `- 首日合计：**${v}**${detail ? `　（${detail}）` : ''}`,
    breakdownSignup: (v) => `注册 ${v}`,
    breakdownInvite: (v) => `本页邀请 ${v}`,
    breakdownRealName: (v) => `实名认证 ${v}`,
    breakdownCheckin: (v) => `首签 ${v}`,
    breakdownPool: (v) => `每日额度池 ${v}`,
    poolSuffix: '（每天重置，不累积）',
    perDay: (v, resets) => `${v}/天${resets ? '（重置）' : ''}`,
    free: '免费',
    othersItem: (name, v) => `${name} 另发 ${v}`,
    othersJoin: '，',
  },

  live: {
    stale: (hours, from) => `⚠ 接口已连续 ${hours} 小时没抓到新数据，下列信息为 \`${from}\` 的快照`,
    blockedFrom: (from) =>
      `ℹ️ 本次自动探测被站点 WAF 拦下（GitHub Actions 机房 IP 常见，家宽访问不受影响），状态与下列信息沿用 \`${from}\` 的成功快照`,
    systemName: (v) => `站点名称：**${v}**`,
    version: (v) => `面板版本：\`${v}\``,
    services: (v) => `已开放服务：${v}`,
    inviterBonus: (v) => `邀请他人可得：**$${v}**`,
    checkin: (v) => `每日签到：${v}`,
    registerOpen: (v, note) => `开放注册：${v}${note ? `（${note}）` : ''}`,
    loginMethods: (v) => `登录方式：${v}`,
    githubAge: (days) => `GitHub 账号需满 **${days} 天**`,
    latency: (ms) => `接口延迟：${ms} ms`,
    yes: '✅',
    no: '❌',
    unknown: '—',
    none: '_暂无实时数据_',
  },

  signup: {
    closedShort: '暂停注册',
    closedNote: '站点接口自报已关闭新用户注册，现在点进去大概注册不上；已注册的老用户不受影响。',
    oauthShort: (list) => `仅 ${list} 注册`,
    oauthNote: (list) => `站点关掉了邮箱密码注册，得用 ${list} 登录建号（防批量注册的常规做法）。`,
    openShort: '开放注册',
  },

  changes: {
    title: '🔔 额度变了，这里会通知你',
    intro: (samples, days) =>
      `CI 每 6 小时抓一次各站接口，与上一次快照逐字段比对${
        samples ? `，目前已攒下 ${samples} 个样本、覆盖约 ${days} 天` : ''
      }。额度调整、掉线与恢复、模型上下线、价格变动都会自动记一条：`,
    watch: '- 点仓库右上角 **Watch → Custom → Releases**：有重要变动时 GitHub 直接发邮件',
    noteZhOnly: null,
  },

  tail: {
    filesTitle: '🧰 仓库里有什么',
    filesHeaders: ['文件', '作用'],
    files: [
      ['[`data/sites.json`](data/sites.json)', '唯一数据源：站点信息与推广链接'],
      ['[`data/live.json`](data/live.json)', '自动抓取的实时快照（额度 / 模型 / 在线状态）'],
      ['[`data/history.json`](data/history.json)', '每 6 小时一个样本的可用性时间序列'],
      ['[`data/changelog.json`](data/changelog.json)', '快照比对出来的变动事件流'],
      ['[`scripts/refresh.mjs`](scripts/refresh.mjs)', '抓取站点公开接口'],
      ['[`scripts/lib/merge.mjs`](scripts/lib/merge.mjs)', '抓取失败时沿用上次快照，页面不会被刷空'],
      ['[`scripts/lib/credits.mjs`](scripts/lib/credits.mjs)', '额度口径：注册 + 邀请 + 签到 = 首日可得'],
      ['[`scripts/lib/diff.mjs`](scripts/lib/diff.mjs)', '比对两份快照，只挑「影响值不值得注册」的变动'],
      ['[`scripts/history.mjs`](scripts/history.mjs)', '归档历史 + 生成 CHANGELOG / Release / 推送素材'],
      ['[`scripts/build.mjs`](scripts/build.mjs)', '用数据重新生成 README 与 docs/ 全站'],
      ['[`scripts/notify.mjs`](scripts/notify.mjs)', '重要变动推到 Telegram（没配 secret 就跳过）'],
      ['[`scripts/check.mjs`](scripts/check.mjs)', '链接与站点健康检查，失效即 CI 报警'],
      ['[`scripts/test.mjs`](scripts/test.mjs)', '合并逻辑与额度口径的单测（零依赖，`npm test`）'],
      ['[`scripts/quickstart.sh`](scripts/quickstart.sh) / [`.ps1`](scripts/quickstart.ps1)', '交互式配置 Claude Code 环境变量'],
    ],
    runTitle: '本地跑一遍：',
    runComments: ['# 单测（不联网）', '# 抓最新数据', '# 归档历史 + 生成变动日志', '# 重新生成 README + docs/', '# 校验链接是否还活着'],
    groupTitle: '💬 交流群',
    groupAlt: 'QQ 群二维码 GCMP-福利站 1125690737',
    groupDesc: 'QQ 群：<b>1125690737</b>（GCMP-福利站） · 扫码或搜群号加入，第一时间获取站点变动与上车技巧。',
  },

  faq: {
    title: '❓ 常见问题',
    items: [
      [
        '注册完为什么看不到额度？',
        '公益站的额度多在登录时结算，**退出登录再重新登录一次**通常就会到账；余额偶尔显示 $0 是前端展示问题，稍后刷新即可。',
      ],
      [
        'Claude Code 报 401 / Unauthorized？',
        '按顺序排查：Base URL 是否误加了 `/v1`（Anthropic 协议不要加）、Key 是否复制完整、模型名是否在站内可用清单里、当前客户端是否属于该站支持的客户端。',
      ],
      [
        '请求返回 400 content blocked？',
        '部分站点只放行中 / 英 / 法 / 德 / 俄，提示词里混入其它语言会被上游拦截，换语言重试即可。',
      ],
      [
        '之前登录过 Claude Pro / Max，切过来会冲突吗？',
        '会。环境变量优先级高于订阅登录，想切回官方订阅就 `unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL` 后重开终端。',
      ],
    ],
  },

  contribute: {
    title: '🤝 收录新的福利站',
    intro: '发现好用的公益站 / 中转站？两种方式：',
    issue: (url) => `- 提 [Issue](${url}) 填个表单，我来收录`,
    pr: '- 或者直接 PR：往 `data/sites.json` 加一条，跑 `npm run refresh && npm run build` 后提交',
    criteria: '收录标准：**能免费拿到额度**、注册流程不套娃、站点公开接口可探测。',
  },

  disclaimer: {
    title: '⚠️ 免责声明',
    items: [
      '- 本页注册链接为**邀请链接**，通过它注册双方都会获得站点发放的额度；不影响你的注册流程与额度多少。',
      '- 本仓库只做信息聚合，**与各站点无隶属关系**，不代收费用、不承诺可用性。公益站随时可能改规则、限速或关站。',
      '- 请勿把生产密钥、隐私数据、企业代码丢给来源不明的中转服务；重要项目请用官方 API。',
      '- 请遵守各站点与上游模型服务商的使用条款，禁止批量注册、刷量、转售额度等行为，封号自负。',
      '- 页面上的额度 / 模型 / 价格由脚本自动抓取，仅代表抓取那一刻的状态，**一切以站内实时公示为准**。',
    ],
  },

  footer: {
    star: '<b>觉得有用点个 ⭐ Star</b>，福利站有变动时这里会自动更新。',
    keywords: (kws) => `<sub>关键词：${kws}</sub>`,
    generated: '<!-- 本文件由 scripts/build.mjs 自动生成，请修改 data/sites.json 或 scripts/lib/render-readme.mjs -->',
  },
};

const PACKS = { zh, en };

/** 支持的语言；顺序即 README 的产出顺序（第一个是主版本） */
export const LANGS = Object.keys(PACKS);

export const DEFAULT_LANG = LANGS[0];

/**
 * 取某一语言的语言包。未知语言回落到默认语言，别让 README 生成在半路炸掉——
 * 生成物坏掉比少一条翻译严重得多。
 */
export function pack(lang = DEFAULT_LANG) {
  return PACKS[lang] ?? PACKS[DEFAULT_LANG];
}

/** 目标语言下 README 的文件名；中文是主 README.md，其余加后缀 */
export const readmeFile = (lang = DEFAULT_LANG) => (lang === DEFAULT_LANG ? 'README.md' : `README.${lang}.md`);

/** 计价单位的显示方式；未登记的单位原样后缀显示，绝不擅自加 $ */
export function unitStyle(unit, lang = DEFAULT_LANG) {
  const table = UNITS[lang] ?? UNITS[DEFAULT_LANG];
  return table[unit] ?? { prefix: '', suffix: ` ${unit}` };
}

/** 面板返回的登录方式名：已知的转到目标语言，未知的原样显示（宁可显示中文也不编英文） */
export const loginMethod = (m, lang = DEFAULT_LANG) => LOGIN_METHODS[lang]?.[m] ?? m;

const LIST_FIELDS = ['highlights', 'earnMore', 'caveats', 'community'];

/**
 * 站点文案的取词口。
 *
 * 卖点 / 注意事项这些是**数据**不是模板：它们随站点变、随公告变，只能手工维护在 sites.json 里。
 * 英文版通过每个站的 `en` 覆盖块提供；没写翻译的字段一律返回 null / 空数组，
 * 渲染器跳过该段落——宁可英文版少一段，也不让中文长段落在英文版里突兀地冒出来。
 */
export function siteCopy(site, lang = DEFAULT_LANG) {
  const own = site ?? {};
  if (lang === DEFAULT_LANG) {
    return {
      name: own.name ?? '',
      subtitle: own.subtitle ?? null,
      modelsNote: own.modelsNote ?? null,
      setup: own.setup ?? null,
      register: own.register ?? null,
      ...Object.fromEntries(LIST_FIELDS.map((f) => [f, own[f] ?? []])),
    };
  }

  const t = own.en ?? {};
  const reg = own.register ?? {};
  const treg = t.register ?? {};
  const setup = own.setup ?? {};
  const tsetup = t.setup ?? {};
  const setupMissing = !tsetup.note && !tsetup.steps?.length;

  return {
    // 站名多数本来就是拉丁字母，没给翻译就用原名，别把整段标题留空
    name: t.name ?? own.name ?? '',
    subtitle: t.subtitle ?? null,
    modelsNote: t.modelsNote ?? null,
    // setup 是「去哪领 Base URL」的操作指引，翻不了就别装作有：宁可不给，也不能给中文步骤
    setup: setupMissing ? null : { ...setup, ...tsetup },
    register: treg.methods || treg.requirements ? { ...reg, ...treg } : null,
    ...Object.fromEntries(LIST_FIELDS.map((f) => [f, t[f] ?? []])),
  };
}
