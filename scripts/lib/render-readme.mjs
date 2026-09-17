/** 生成 README.md：全部内容由 data/sites.json + data/live.json 渲染，请勿手改 README。 */
import { staleHours } from './newapi.mjs';
import { creditPlan, usd, breakdown, perDay, usdTotals, othersNote } from './credits.mjs';
import { signupRoute, acceptsNew } from './signup.mjs';
import { icon } from './changelog.mjs';
import { coverage } from './history.mjs';

const GCMP_README_SNAP = {
  online: true,
  models: [
    { name: 'opus-5', fixedPrice: null, ratio: '—', inputPerMTok: null, outputPerMTok: null, protocols: ['OpenAI', 'Responses', 'Anthropic'] },
    { name: 'opus-4-8', fixedPrice: null, ratio: '—', inputPerMTok: null, outputPerMTok: null, protocols: ['OpenAI', 'Responses', 'Anthropic'] },
    { name: 'sonnet-5', fixedPrice: null, ratio: '—', inputPerMTok: null, outputPerMTok: null, protocols: ['OpenAI', 'Responses', 'Anthropic'] },
    { name: 'gpt-5.6', fixedPrice: null, ratio: '—', inputPerMTok: null, outputPerMTok: null, protocols: ['OpenAI', 'Responses'] },
    { name: 'glm-5.3', fixedPrice: null, ratio: '—', inputPerMTok: null, outputPerMTok: null, protocols: ['OpenAI', 'Responses', 'Anthropic'] },
    { name: 'deepseek', fixedPrice: null, ratio: '—', inputPerMTok: null, outputPerMTok: null, protocols: ['OpenAI', 'Responses', 'Anthropic'] },
    { name: 'cheap', fixedPrice: null, ratio: '—', inputPerMTok: null, outputPerMTok: null, protocols: ['OpenAI', 'Responses', 'Anthropic'] },
  ],
  defaults: { claude: 'glm-5.3', openai: 'glm-5.3' },
};

/** shields.io 转义：- → --，_ → __，其余走 URI 编码 */
const shield = (s) => encodeURIComponent(String(s).replace(/-/g, '--').replace(/_/g, '__'));
const B = (label, msg, color) => `https://img.shields.io/badge/${shield(label)}-${shield(msg)}-${color}`;

const yes = (v) => (v === true ? '✅' : v === false ? '❌' : '—');

function fmtDate(iso) {
  if (!iso) return '未知';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** 挑一个用于示例配置的 Claude 模型名 */
function claudeModel(snap) {
  return snap?.defaults?.claude ?? '<登录后台查看可用模型名>';
}

/** 挑一个用于示例配置的 OpenAI 协议模型名 */
function openaiModel(snap) {
  return snap?.defaults?.openai ?? '<登录后台查看可用模型名>';
}

function overviewTable(sites, liveById) {
  // 多数站的邀请额度是邀请链接自己带的，用户不用手打；只有个别站（DoCode）注册表单里
  // 有一栏「邀请码」要自己填，漏填就只拿注册额度。没有任何站需要手填时不出这一列。
  const hasCode = sites.some((s) => s.inviteCode);
  const rows = sites.map((s) => {
    const l = liveById.get(s.id) ?? {};
    const plan = creditPlan(s, l);
    const route = signupRoute(l);
    // 「在线」和「收不收新用户」是两件事：站点活得好好的但停注了，对新用户就是死路，
    // 状态栏必须说出来，否则下面那个「首日可得 $120」是在骗人点链接
    const state = l.online ? (route.state === 'closed' ? '🟡 停注' : '🟢 在线') : '🔴 异常';
    const first =
      plan.firstDay != null
        ? route.state === 'closed'
          ? `~~${usd(plan.firstDay, plan.approx, plan.unit)}~~`
          : `**${usd(plan.firstDay, plan.approx, plan.unit)}**`
        : '站内公示';
    const detail = breakdown(plan) ?? '—';
    const checkin =
      perDay(plan) ??
      (l.checkinEnabled
        ? '支持签到'
        : l.checkinEnabled === false
          ? '无签到'
          : '—');
    const models = l.models?.length ? `${l.models.length} 个可查` : l.services?.length ? l.services.join(' / ') : '需登录查看';
    const proto =
      [s.endpoints?.anthropic && 'Anthropic', s.endpoints?.openai && 'OpenAI'].filter(Boolean).join(' + ') ||
      s.setup?.client ||
      '登录后台配置';
    const cta =
      route.state === 'closed'
        ? `[已停注 · 仍可打开 →](${s.signupUrl})`
        : route.state === 'oauth'
          ? `[${route.oauth[0]} 注册 →](${s.signupUrl})`
          : `[点此注册 →](${s.signupUrl})`;
    const code = s.inviteCode ? ` \`${s.inviteCode}\` |` : ' — |';
    return (
      `| **${s.name}**${s.recommended ? ' 🔥' : ''} | ${state} | ${first} | ${detail} | ${checkin} | ${proto} | ${models} | ${cta} |` +
      (hasCode ? code : '')
    );
  });
  return [
    `| 站点 | 状态 | 首日可得 | 额度构成 | 之后每天 | 兼容协议 | 模型 | 注册 |${hasCode ? ' 邀请码 |' : ''}`,
    `| :-- | :--: | :--: | :-- | :--: | :--: | :--: | :--: |${hasCode ? ' :--: |' : ''}`,
    ...rows,
  ].join('\n');
}

function modelTable(snap) {
  if (!snap?.models?.length) return null;
  const rows = snap.models.map((m) => {
    // 按次计费的模型（New API 的 model_price）没有倍率概念，倍率栏照抄接口的 0 会被读成「免费」，
    // 真正有用的是每次多少钱，所以这类模型把价格放到输入列、倍率列写「按次」。
    const fixed = m.fixedPrice != null;
    const ratio = fixed ? '按次' : (m.ratio ?? '—');
    const inp = fixed ? `**$${m.fixedPrice} / 次**` : m.inputPerMTok != null ? `$${m.inputPerMTok}` : '—';
    const out = fixed ? '—' : m.outputPerMTok != null ? `$${m.outputPerMTok}` : '—';
    return `| \`${m.name}\` | ${ratio} | ${inp} | ${out} | ${(m.protocols ?? []).join(' / ') || '—'} |`;
  });
  return [
    '| 模型 | 倍率 | 输入 / 1M tokens | 输出 / 1M tokens | 协议 |',
    '| :-- | :--: | :--: | :--: | :--: |',
    ...rows,
  ].join('\n');
}

function liveFacts(snap) {
  if (!snap) return '_暂无实时数据_';
  const items = [
    staleHours(snap) ? `⚠ 接口已连续 ${staleHours(snap)} 小时没抓到新数据，下列信息为 \`${fmtDate(snap.staleFrom)}\` 的快照` : null,
    snap.probeBlocked ? `ℹ️ 本次自动探测被站点 WAF 拦下（GitHub Actions 机房 IP 常见，家宽访问不受影响），状态与下列信息沿用 \`${fmtDate(snap.staleFrom ?? snap.checkedAt)}\` 的成功快照` : null,
    // 站名 / 版本不是每种面板都拿得到（Matrix 只有一个健康检查），拿不到就别摆一行「—」占位
    snap.systemName ? `站点名称：**${snap.systemName}**` : null,
    snap.version ? `面板版本：\`${snap.version}\`` : null,
    snap.services?.length ? `已开放服务：${snap.services.join(' / ')}` : null,
    snap.inviterBonusUsd ? `邀请他人可得：**$${snap.inviterBonusUsd}**` : null,
    snap.checkinEnabled != null ? `每日签到：${yes(snap.checkinEnabled)}` : null,
    snap.registerOpen != null ? `开放注册：${yes(snap.registerOpen)}${signupRoute(snap).note ? `（${signupRoute(snap).note}）` : ''}` : null,
    snap.loginMethods?.length ? `登录方式：${snap.loginMethods.join(' / ')}` : null,
    snap.githubMinAccountAgeDays ? `GitHub 账号需满 **${snap.githubMinAccountAgeDays} 天**` : null,
    snap.latencyMs != null ? `接口延迟：${snap.latencyMs} ms` : null,
  ].filter(Boolean);
  return items.map((t) => `- ${t}`).join('\n');
}

/** 额度明细：接口只给邀请额度，注册基础额度与签到额度来自 sites.json 登记 */
function creditFacts(site, snap) {
  const p = creditPlan(site, snap);
  if (p.firstDay == null) return null;
  const detail = breakdown(p);
  return [
    p.signup != null ? `- 注册即送：**${usd(p.signup, false, p.unit)}**` : null,
    p.invite != null
      ? `- 从本页邀请链接注册额外：**${usd(p.invite, false, p.unit)}**${p.apiInvite === p.invite ? '（站点接口实测一致）' : ''}`
      : null,
    p.daily == null
      ? null
      : p.resets
        ? `- 每日额度池：**${usd(p.daily, p.approx, p.unit)}/天**（每天重置，当天用不完不累积，也不用签到）`
        : `- 每日签到：**${usd(p.daily, p.approx, p.unit)}/天**（长期续命的关键）`,
    `- 首日合计：**${usd(p.firstDay, p.approx, p.unit)}**${p.sources > 1 && detail ? `　（${detail}）` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function siteSection(site, snap) {
  const cm = claudeModel(snap);
  const om = openaiModel(snap);
  const models = modelTable(snap);
  const mirror = (site.mirrors ?? [])
    .map((m) => `- ${m.label ?? '备用域名'}：<${m.homeUrl}> · [从备用域名注册](${m.signupUrl})`)
    .join('\n');

  const parts = [
    `### ${snap?.online ? '🟢' : '🔴'} ${site.name}${site.recommended ? ' 🔥 首推' : ''}`,
    '',
    `> ${site.subtitle}`,
    '',
    `<a href="${site.signupUrl}"><img src="${B('立即注册', site.name, 'brightgreen?style=for-the-badge')}" alt="注册 ${site.name}"></a>`,
    '',
    `**为什么值得注册**`,
    '',
    site.highlights.map((h) => `- ${h}`).join('\n'),
    ...(creditFacts(site, snap) ? ['', '**能拿多少额度**', '', creditFacts(site, snap)] : []),
    '',
    '**实时数据**（自动抓取站点公开接口）',
    '',
    liveFacts(snap),
  ];

  if (mirror) parts.push('', '**镜像 / 备用入口**', '', mirror);
  if (models) {
    const fixedAny = (snap?.models ?? []).some((m) => m.fixedPrice != null);
    const note = fixedAny
      ? '标「按次」的模型按请求次数计费，与 tokens 用量无关；其余倍率 1 ≈ $2 / 1M tokens。以站内实时价格为准。'
      : '倍率 1 ≈ $2 / 1M tokens，输出价 = 倍率 × 补全倍率 × $2；以站内实时价格为准。';
    parts.push('', '**当前可用模型**', '', models, '', `<sub>${note}</sub>`);
  } else parts.push('', `> ${site.modelsNote ?? '该站模型清单需登录后台查看，注册后在「模型价格」页确认。'}`);

  parts.push(
    '',
    '**注册要求**',
    '',
    [...(site.register?.requirements ?? []).map((r) => `- ${r}`)].join('\n') || '- 无特殊限制',
    '',
    '**接入配置**',
    '',
    accessBlock(site, cm, om),
  );

  if (site.earnMore?.length) parts.push('', '**如何继续拿额度**', '', site.earnMore.map((t) => `- ${t}`).join('\n'));
  if (site.caveats?.length) parts.push('', '**⚠️ 使用前必读**', '', site.caveats.map((t) => `- ${t}`).join('\n'));
  if (site.community?.length) parts.push('', '**官方渠道**', '', site.community.map((t) => `- ${t}`).join('\n'));

  const ann = (snap?.announcements ?? []).slice(0, 3);
  if (ann.length) {
    parts.push('', '<details><summary><b>站点最新公告</b>（自动同步）</summary>', '');
    parts.push(ann.map((a) => `- ${a.date ? `\`${a.date}\` ` : ''}${a.text}`).join('\n'));
    parts.push('', '</details>');
  }
  return parts.join('\n');
}

const F = '```';

/**
 * 有公开 Base URL 的站点直接给可抄的配置；
 * Codex 号池那类站点的 Base URL 与 Key 是后台登录后才下发的，只能写清楚去哪儿领，
 * 硬编一个猜出来的地址比不写更糟。
 */
function accessBlock(site, claude, openai) {
  if (site.endpoints?.anthropic || site.endpoints?.openai) return codeBlocks(site, claude, openai);

  const s = site.setup ?? {};
  const out = [];
  if (s.note) out.push(`> ${s.note}`, '');
  if (s.steps?.length) out.push(s.steps.map((t, i) => `${i + 1}. ${t}`).join('\n'));
  if (s.dashboardUrl) out.push('', `控制台入口：<${s.dashboardUrl}>`);
  return out.join('\n') || '> 注册登录后在站内后台查看接入方式。';
}

function codeBlocks(site, claude, openai) {
  const anth = site.endpoints?.anthropic;
  const oai = site.endpoints?.openai;
  const out = [];

  if (anth) {
    out.push(
      '<details open><summary><b>Claude Code</b>（Anthropic 兼容，Base URL 不带 <code>/v1</code>）</summary>',
      '',
      `${F}bash`,
      '# macOS / Linux',
      `export ANTHROPIC_BASE_URL=${anth}`,
      'export ANTHROPIC_AUTH_TOKEN=你在站点后台创建的 Key',
      `export ANTHROPIC_MODEL=${claude}`,
      'npm install -g @anthropic-ai/claude-code@latest && claude',
      F,
      '',
      `${F}powershell`,
      '# Windows PowerShell',
      `$env:ANTHROPIC_BASE_URL = "${anth}"`,
      '$env:ANTHROPIC_AUTH_TOKEN = "你在站点后台创建的 Key"',
      `$env:ANTHROPIC_MODEL = "${claude}"`,
      'claude',
      F,
      '',
      '</details>',
      '',
    );
  }

  if (oai) {
    out.push(
      '<details><summary><b>Codex CLI</b>（OpenAI 兼容，写入 <code>~/.codex/config.toml</code>）</summary>',
      '',
      `${F}toml`,
      `model = "${openai}"`,
      `model_provider = "${site.id}"`,
      '',
      `[model_providers.${site.id}]`,
      `name = "${site.name}"`,
      `base_url = "${oai}"`,
      `env_key = "${site.id.toUpperCase()}_API_KEY"`,
      'wire_api = "chat"',
      F,
      '',
      '</details>',
      '',
      '<details><summary><b>OpenAI SDK / Cherry Studio / Cursor 等通用客户端</b></summary>',
      '',
      `${F}python`,
      'from openai import OpenAI',
      '',
      `client = OpenAI(api_key="你的 Key", base_url="${oai}")`,
      `resp = client.chat.completions.create(model="${openai}", messages=[{"role": "user", "content": "ping"}])`,
      'print(resp.choices[0].message.content)',
      F,
      '',
      '通用客户端只需填两项：**Base URL** = `' + oai + '`，**API Key** = 站点后台创建的 Key。',
      '',
      '</details>',
      '',
      '<details><summary><b>连通性自测</b></summary>',
      '',
      `${F}bash`,
      `curl -s ${oai}/chat/completions \\`,
      '  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\',
      `  -d '{"model":"${openai}","messages":[{"role":"user","content":"只回复 OK"}]}'`,
      F,
      '',
      '</details>',
    );
  }
  return out.join('\n');
}

/** sites.json 里 configBlocks 的固定顺序：从「最常用来改配置的客户端」排到「最少用的」 */
const CLIENT_KEYS = ['vscode', 'claudeCode', 'codex', 'openaiSdk'];

/**
 * 「这个仓库有两部分」的分工说明。
 *
 * README 第一屏全是福利站的额度与注册链接时，读者会以为整个仓库就是个导航站，
 * 完全看不到自己那套网关——先把两件事摆平，再各自展开。
 */
function splitBlock({ welfareCount, gatewaySite, pages }) {
  return [
    '---',
    '',
    '## 🧭 这个仓库有两部分',
    '',
    '| 部分 | 是什么 | 入口 |',
    '| :-- | :-- | :-- |',
    `| 🛰 **${gatewaySite.name}** | 跑在你自己机器上的 AI 网关：多个逻辑模型、OpenAI / Anthropic / Responses 三协议全收、上游故障转移、配置热加载 | [部署文档](gcmp-gateway/README.md) · [详情页](${pages}sites/${gatewaySite.id}/) |`,
    `| 🎁 **福利站导航** | ${welfareCount} 个第三方公益站 / 中转站的注册额度与实测状态，CI 每 6 小时自动抓取 | 本文件下面两张表 |`,
    '',
    '> 两件事互不依赖，只用其中一个也行；但把福利站领到的 key 填进网关，就能在一个地址里在 VS Code、Claude Code、Codex 之间换模型，不用各处改配置。',
    '',
  ];
}

/**
 * 仓库的第二部分：自托管网关。
 *
 * 福利站那一整套口径（首日可得 / 邀请码 / 注册链接 / 停注 / 全注册约 $X）对它全是错的——
 * 它不发额度、不能注册、也没有单价，所以从福利站的表里彻底摘出来单独成一章：
 * 定位 → 逻辑模型 → 接入配置 → 部署步骤 → 必读。
 */
function gatewayBlock(site, snap, meta, pages) {
  if (!site) return [];
  const models = snap?.models ?? [];
  const blocks = CLIENT_KEYS.map((k) => site.configBlocks?.[k])
    .filter(Boolean)
    .map((b) => `<details><summary><b>${b.title}</b></summary>\n\n${F}${b.language}\n${b.code}\n${F}\n\n</details>`);
  const steps = site.setup?.steps ?? [];
  const admin = site.setup?.dashboardUrl;

  const out = [
    `## 🛰 我的网关：${site.name}`,
    '',
    `> ${site.subtitle}`,
    '',
    `<a href="gcmp-gateway/README.md"><img src="${B('部署文档', site.name, 'blue?style=for-the-badge')}" alt="${site.name} 部署文档"></a>`,
    '',
    '**它和福利站不是一回事**：福利站是别人开的、你注册领额度；这个网关跑在你自己机器上，不发额度、没有邀请码、也不收你的钱——它把你手上（或上面那些站的）key 汇总成一个地址对外，一个逻辑模型挂多条上游，哪条挂了自动换下一条。',
    '',
    '**为什么值得自托管**',
    '',
    site.highlights.map((h) => `- ${h}`).join('\n'),
    '',
    `**${models.length} 个逻辑模型**（客户端只填逻辑模型名，具体走哪个上游由网关按路由与健康度决定）`,
    '',
    '| 逻辑模型 | 支持的协议 |',
    '| :-- | :-- |',
    ...models.map((m) => `| \`${m.name}\` | ${(m.protocols ?? []).join(' / ') || '—'} |`),
  ];

  if (blocks.length) {
    out.push('', `**接入配置**（把 \`127.0.0.1:${site.setup?.port ?? '15800'}\` 换成你自己的监听地址）`, '', blocks.join('\n'));
  }
  if (steps.length) out.push('', '**部署步骤**', '', steps.map((t, i) => `${i + 1}. ${t}`).join('\n'));
  if (site.caveats?.length) out.push('', '**⚠️ 使用前必读**', '', site.caveats.map((t) => `- ${t}`).join('\n'));

  out.push(
    '',
    '**入口**',
    '',
    [
      '[完整部署文档](gcmp-gateway/README.md)',
      '[英文说明](gcmp-gateway/README.en.md)',
      `[详情页](${pages}sites/${site.id}/)`,
      admin ? `控制台 <${admin}>` : null,
      `[仓库](${meta.repoUrl})`,
    ]
      .filter(Boolean)
      .join(' · '),
    '',
    '---',
    '',
  );

  return out;
}

export function renderReadme({ meta, sites, live, groups = [], history }) {
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  if (!byId.has('gcmp-gateway')) byId.set('gcmp-gateway', GCMP_README_SNAP);
  // 福利站 = 第三方站点；自托管网关（panel=local）单独成章，不进「收录站点 / 在线 / 可注册 / 首日可得」的口径
  const welfare = sites.filter((s) => s.panel !== 'local');
  const gatewaySite = sites.find((s) => s.panel === 'local') ?? null;
  const onlineCount = welfare.filter((s) => byId.get(s.id)?.online).length;
  const staleCount = welfare.filter((s) => staleHours(byId.get(s.id))).length;
  // 「全注册一遍能拿多少」这句话是对新用户说的，把停注的站点算进去就是虚报额度（详见 lib/signup.mjs）
  const openSites = welfare.filter((s) => acceptsNew(byId.get(s.id)));
  const closedSites = welfare.filter((s) => !acceptsNew(byId.get(s.id)));
  const plans = openSites.map((s) => creditPlan(s, byId.get(s.id)));
  // 合计只算美元站：积分与美元没有公开换算，混着加就是编数字（详见 lib/credits.mjs）
  const { count: usdCount, best, total, resetting, others } = usdTotals(plans);
  const codeSites = welfare.filter((s) => s.inviteCode);
  const extra = othersNote(others);
  const scope = others.length ? `${usdCount} 个按美元计价、且还收新用户的站` : `${openSites.length} 个还收新用户的站`;
  const pages = (meta.pagesUrl ?? '').replace(/\/?$/, '/');

  const head = [
    `<h1 align="center">${meta.title}</h1>`,
    '',
    `<p align="center">${meta.tagline}</p>`,
    '',
    '<p align="center">',
    `  <img src="${B('收录福利站', `${welfare.length} 个`, 'blue')}" alt="收录福利站">`,
    `  <img src="${B('在线', `${onlineCount}/${welfare.length}`, onlineCount === welfare.length ? 'brightgreen' : 'orange')}" alt="在线">`,
    closedSites.length
      ? `  <img src="${B('可注册', `${openSites.length}/${welfare.length}`, 'yellow')}" alt="可注册">`
      : null,
    best > 0 ? `  <img src="${B('首日可得', `最高 $${best}`, 'success')}" alt="首日可得">` : null,
    `  <img src="${B('数据更新', fmtDate(live?.generatedAt).replace(/:/g, '.'), 'informational')}" alt="数据更新">`,
    '</p>',
    '',
    '<p align="center">',
    welfare.map((s) => `  <a href="${s.signupUrl}"><b>${s.name} 注册</b></a>`).join(' ·\n'),
    '</p>',
    '',
    `<p align="center"><a href="${pages}compare/">📊 按次 vs 按量折算横评</a> · <a href="${pages}status/">🩺 可用性历史</a> · <a href="${pages}changelog/">🗓 变动日志</a> · <a href="${pages}feed.xml">🔔 Atom 订阅</a></p>`,
    '',
    ...(gatewaySite ? splitBlock({ welfareCount: welfare.length, gatewaySite, pages }) : ['---', '']),
    ...gatewayBlock(gatewaySite, gatewaySite ? byId.get(gatewaySite.id) : null, meta, pages),
    '## 🚀 一分钟上车（福利站）',
    '',
    '> 下面两张表都是第三方站点，本仓库只做信息聚合；自己搭网关看上面那一节。',
    '',
    overviewTable(welfare, byId),
    '',
    `> 「首日可得」= 注册基础额度 + 本页邀请链接额度 + 当天能领的签到额度（每日重置额度池的站点按一天的池子算）；模型、价格、在线状态由脚本抓取站点公开接口自动生成，最后更新：\`${fmtDate(live?.generatedAt)}\`。`,
    codeSites.length ? '>' : null,
    // 「—」不等于没有邀请额度，只是不用手打；这一句不写清楚，读者会以为那些站白嫖不到邀请额度
    codeSites.length
      ? `> 「邀请码」列写了码的站（${codeSites
          .map((s) => `${s.name} \`${s.inviteCode}\``)
          .join('、')}），注册表单里有一栏要**自己填**，漏填就只拿得到注册基础额度、事后补不上；其余站写 — 是因为邀请额度由链接自带，不用手打。`
      : null,
    total > 0 ? '>' : null,
    total > 0
      ? `> ${scope}全注册一遍，第一天手上大约有 **$${total}** 额度可用${resetting ? '（其中每日重置的额度池次日会回满，但不累积）' : ''}${
          extra ? `；${extra}，都是各站自己的计价单位、与美元没有公开换算，未计入这个合计` : ''
        }。`
      : null,
    closedSites.length ? '>' : null,
    closedSites.length
      ? `> 🟡 ${closedSites
          .map((s) => `**${s.name}**`)
          .join('、')} 的接口自报已关闭新用户注册（\`register_enabled=false\`），表里额度已划掉、也没算进上面的合计；站点本身还在跑，老用户不受影响，重新开放会记进[变动日志](${pages}changelog/)。`
      : null,
    staleCount > 0 ? '>' : null,
    staleCount > 0
      ? `> 🟡 有 ${staleCount} 个站点已超过 48 小时没抓到接口数据，其明细为上一次成功抓取的快照；在线状态按注册页实际可访问性判断。`
      : null,
    '',
    '**只想快点用上 Claude Code？** 三步：',
    '',
    `1. 点上表的注册链接 → 按站点支持的方式登录（GitHub / 邮箱），额度是按邀请链接发放的，别走裸链`,
    '2. 后台「令牌 / API Keys」新建一个 Key',
    '3. 跑一键脚本，或手抄下面对应站点的环境变量',
    '',
    `${F}bash`,
    '# 交互式写好 Claude Code 的环境变量（macOS / Linux）',
    'bash scripts/quickstart.sh',
    F,
    '',
    `${F}powershell`,
    '# Windows PowerShell',
    'powershell -ExecutionPolicy Bypass -File scripts/quickstart.ps1',
    F,
    '',
    '## 📚 福利站详情',
    '',
  ];

  const body = welfare.map((s) => siteSection(s, byId.get(s.id))).join('\n\n---\n\n');
  return [
    head.filter((l) => l !== null).join('\n'),
    body,
    changesBlock({ groups, history, pages }),
    tail(meta, sites, live),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 「最近变动 + 怎么订阅」。
 *
 * 导航类仓库最大的问题是没人会来第二次：给出 Watch → Releases 和 Atom 两个出口，
 * 让 CI 主动把变动推到用户面前，而不是等用户回来刷 README。
 */
function changesBlock({ groups, history, pages }) {
  const events = groups.flatMap((g) => g.events).slice(0, 6);
  const cov = coverage(history ?? { samples: [] });
  const lines = [
    '---',
    '',
    '## 🔔 额度变了，这里会通知你',
    '',
    `CI 每 6 小时抓一次各站接口，与上一次快照逐字段比对${
      cov.samples ? `，目前已攒下 ${cov.samples} 个样本、覆盖约 ${cov.days} 天` : ''
    }。额度调整、掉线与恢复、模型上下线、价格变动都会自动记一条：`,
    '',
    '- 点仓库右上角 **Watch → Custom → Releases**：有重要变动时 GitHub 直接发邮件',
    `- 订阅 [Atom feed](${pages}feed.xml)：RSS 阅读器 / Feedly / Telegram 机器人都能读`,
    `- 在线看：[变动日志](${pages}changelog/) · [可用性历史](${pages}status/)`,
  ];
  if (events.length) {
    lines.push(
      '',
      '最近几条：',
      '',
      ...events.map((e) => `- \`${String(e.at ?? '').slice(0, 10)}\` ${icon(e.type)} ${e.text}`),
      '',
      '完整记录见 [CHANGELOG.md](CHANGELOG.md)。',
    );
  }
  return lines.join('\n');
}

function tail(meta, sites, live) {
  return [
    '---',
    '',
    '## 🧰 仓库里有什么',
    '',
    '| 文件 | 作用 |',
    '| :-- | :-- |',
    '| [`data/sites.json`](data/sites.json) | 唯一数据源：站点信息与推广链接 |',
    '| [`data/live.json`](data/live.json) | 自动抓取的实时快照（额度 / 模型 / 在线状态） |',
    '| [`data/history.json`](data/history.json) | 每 6 小时一个样本的可用性时间序列 |',
    '| [`data/changelog.json`](data/changelog.json) | 快照比对出来的变动事件流 |',
    '| [`scripts/refresh.mjs`](scripts/refresh.mjs) | 抓取站点公开接口 |',
    '| [`scripts/lib/merge.mjs`](scripts/lib/merge.mjs) | 抓取失败时沿用上次快照，页面不会被刷空 |',
    '| [`scripts/lib/credits.mjs`](scripts/lib/credits.mjs) | 额度口径：注册 + 邀请 + 签到 = 首日可得 |',
    '| [`scripts/lib/diff.mjs`](scripts/lib/diff.mjs) | 比对两份快照，只挑「影响值不值得注册」的变动 |',
    '| [`scripts/history.mjs`](scripts/history.mjs) | 归档历史 + 生成 CHANGELOG / Release / 推送素材 |',
    '| [`scripts/build.mjs`](scripts/build.mjs) | 用数据重新生成 README 与 docs/ 全站 |',
    '| [`scripts/notify.mjs`](scripts/notify.mjs) | 重要变动推到 Telegram（没配 secret 就跳过） |',
    '| [`scripts/check.mjs`](scripts/check.mjs) | 链接与站点健康检查，失效即 CI 报警 |',
    '| [`scripts/test.mjs`](scripts/test.mjs) | 合并逻辑与额度口径的单测（零依赖，`npm test`） |',
    '| [`scripts/quickstart.sh`](scripts/quickstart.sh) / [`.ps1`](scripts/quickstart.ps1) | 交互式配置 Claude Code 环境变量 |',
    '| [`gcmp-gateway/`](gcmp-gateway/) | 自托管网关本体：单文件 Python 服务 + 本地管理页 + 部署文档，与福利站数据是两件事 |',
    '',
    '本地跑一遍：',
    '',
    `${F}bash`,
    'npm test          # 单测（不联网）',
    'npm run refresh   # 抓最新数据',
    'npm run history   # 归档历史 + 生成变动日志',
    'npm run build     # 重新生成 README + docs/',
    'npm run check     # 校验链接是否还活着',
    F,
    '',
    '## ❓ 常见问题',
    '',
    '<details><summary><b>注册完为什么看不到额度？</b></summary>',
    '',
    '公益站的额度多在登录时结算，**退出登录再重新登录一次**通常就会到账；余额偶尔显示 $0 是前端展示问题，稍后刷新即可。',
    '',
    '</details>',
    '',
    '<details><summary><b>Claude Code 报 401 / Unauthorized？</b></summary>',
    '',
    '按顺序排查：Base URL 是否误加了 `/v1`（Anthropic 协议不要加）、Key 是否复制完整、模型名是否在站内可用清单里、当前客户端是否属于该站支持的客户端。',
    '',
    '</details>',
    '',
    '<details><summary><b>请求返回 400 content blocked？</b></summary>',
    '',
    '部分站点只放行中 / 英 / 法 / 德 / 俄，提示词里混入其它语言会被上游拦截，换语言重试即可。',
    '',
    '</details>',
    '',
    '<details><summary><b>之前登录过 Claude Pro / Max，切过来会冲突吗？</b></summary>',
    '',
    '会。环境变量优先级高于订阅登录，想切回官方订阅就 `unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL` 后重开终端。',
    '',
    '</details>',
    '',
    tailFooter(meta, sites),
  ].join('\n');
}

function tailFooter(meta, sites) {
  return [
    '## 🤝 收录新的福利站',
    '',
    '发现好用的公益站 / 中转站？两种方式：',
    '',
    `- 提 [Issue](${meta.repoUrl}/issues/new?template=new-site.yml) 填个表单，我来收录`,
    '- 或者直接 PR：往 `data/sites.json` 加一条，跑 `npm run refresh && npm run build` 后提交',
    '',
    '收录标准：**能免费拿到额度**、注册流程不套娃、站点公开接口可探测。',
    '',
    '## ⚠️ 免责声明',
    '',
    '- 本页注册链接为**邀请链接**，通过它注册双方都会获得站点发放的额度；不影响你的注册流程与额度多少。',
    '- 本仓库只做信息聚合，**与各站点无隶属关系**，不代收费用、不承诺可用性。公益站随时可能改规则、限速或关站。',
    '- 请勿把生产密钥、隐私数据、企业代码丢给来源不明的中转服务；重要项目请用官方 API。',
    '- 请遵守各站点与上游模型服务商的使用条款，禁止批量注册、刷量、转售额度等行为，封号自负。',
    '- 页面上的额度 / 模型 / 价格由脚本自动抓取，仅代表抓取那一刻的状态，**一切以站内实时公示为准**。',
    '',
    '## 💬 交流群',
    '',
    '<p align="center">',
    '  <img src="docs/assets/qq-group.jpg" width="260" alt="QQ 群二维码 GCMP-福利站 1125690737">',
    '</p>',
    '',
    '<p align="center">QQ 群：<b>1125690737</b>（GCMP-福利站） · 扫码或搜群号加入，第一时间获取站点变动与上车技巧。</p>',
    '',
    '---',
    '',
    `<p align="center"><b>觉得有用点个 ⭐ Star</b>，福利站有变动时这里会自动更新。</p>`,
    '',
    `<sub>关键词：${(meta.keywords ?? []).join(' · ')}</sub>`,
    '',
    `<!-- 本文件由 scripts/build.mjs 自动生成，请修改 data/sites.json 或 scripts/lib/render-readme.mjs -->`,
  ].join('\n');
}
