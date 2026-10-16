/** 生成 README：全部内容由 data/sites.json + data/live.json 渲染，请勿手改 README。 */
import { staleHours } from './newapi.mjs';
import { creditPlan, usd, breakdown, perDay, usdTotals, othersNote } from './credits.mjs';
import { signupRoute, acceptsNew } from './signup.mjs';
import { icon } from './changelog.mjs';
import { coverage } from './history.mjs';
import { pack, siteCopy, loginMethod, DEFAULT_LANG } from './i18n.mjs';

/** shields.io 转义：- → --，_ → __，其余走 URI 编码 */
const shield = (s) => encodeURIComponent(String(s).replace(/-/g, '--').replace(/_/g, '__'));
const B = (label, msg, color) => `https://img.shields.io/badge/${shield(label)}-${shield(msg)}-${color}`;

/** 徽章词条返回 { label, msg, color }，这里拼成 shields.io 的一行 <img> */
const badge = (spec) => `  <img src="${B(spec.label, spec.msg, spec.color)}" alt="${spec.label}">`;

/** 站外链接一律写原始 <a>：markdown 链接的 target 会被 GitHub 丢掉，点了就从 README 跳走 */
const ext = (text, href) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

/**
 * 镜像入口的标签是数据（「大陆备用域名」「直连美国」…），英文版走 mirrors[i].labelEn。
 * 没写 labelEn 就退回通用的「备用域名」，绝不把中文标签原样塞进英文版。
 */
const mirrorLabel = (m, lang) =>
  lang === DEFAULT_LANG
    ? (m.label ?? pack(lang).section.mirrorFallback)
    : (m.labelEn ?? pack(lang).section.mirrorFallback);

function fmtDate(iso, lang = DEFAULT_LANG) {
  if (!iso) return pack(lang).common.unknown;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return pack(lang).common.unknown;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** 挑一个用于示例配置的 Claude 模型名 */
function claudeModel(snap, t) {
  return snap?.defaults?.claude ?? t.setup.pickModel;
}

/** 挑一个用于示例配置的 OpenAI 协议模型名 */
function openaiModel(snap, t) {
  return snap?.defaults?.openai ?? t.setup.pickModel;
}

function overviewTable(sites, liveById, lang) {
  const t = pack(lang).table;
  // 多数站的邀请额度是邀请链接自己带的，用户不用手打；只有个别站（DoCode）注册表单里
  // 有一栏「邀请码」要自己填，漏填就只拿注册额度。没有任何站需要手填时不出这一列。
  const hasCode = sites.some((s) => s.inviteCode);
  const rows = sites.map((s) => {
    const l = liveById.get(s.id) ?? {};
    const copy = siteCopy(s, lang);
    const plan = creditPlan(s, l);
    const route = signupRoute(l, lang);
    // 「在线」和「收不收新用户」是两件事：站点活得好好的但停注了，对新用户就是死路，
    // 状态栏必须说出来，否则下面那个「首日可得 $120」是在骗人点链接
    const state = l.online ? (route.state === 'closed' ? t.stateShut : t.stateOnline) : t.stateDown;
    const first =
      plan.unit === 'free'
        ? t.free
        : plan.firstDay != null
          ? route.state === 'closed'
            ? `~~${usd(plan.firstDay, plan.approx, plan.unit, lang)}~~`
            : `**${usd(plan.firstDay, plan.approx, plan.unit, lang)}**`
          : t.announced;
    const detail = plan.unit === 'free' ? t.freeGroup : (breakdown(plan, lang) ?? '—');
    const checkin =
      perDay(plan, lang) ??
      (l.checkinEnabled ? t.checkinYes : l.checkinEnabled === false ? t.checkinNo : '—');
    const models = l.models?.length
      ? t.modelsKnown(l.models.length)
      : l.services?.length
        ? l.services.map((x) => loginMethod(x, lang)).join(' / ')
        : t.modelsLogin;
    const proto =
      [s.endpoints?.anthropic && 'Anthropic', s.endpoints?.openai && 'OpenAI'].filter(Boolean).join(' + ') ||
      copy.setup?.client ||
      t.signupDefault;
    const cta =
      route.state === 'closed'
        ? ext(t.ctaClosed, s.signupUrl)
        : route.state === 'oauth'
          ? ext(t.ctaOauth(route.oauth[0]), s.signupUrl)
          : ext(t.ctaRegister, s.signupUrl);
    const code = s.inviteCode ? ` \`${s.inviteCode}\` |` : ' — |';
    return (
      `| **${copy.name}**${s.recommended ? ' 🔥' : ''} | ${state} | ${first} | ${detail} | ${checkin} | ${proto} | ${models} | ${cta} |` +
      (hasCode ? code : '')
    );
  });
  return [
    `| ${t.headers.slice(0, hasCode ? 9 : 8).join(' | ')} |`,
    `| :-- | :--: | :--: | :-- | :--: | :--: | :--: | :--: |${hasCode ? ' :--: |' : ''}`,
    ...rows,
  ].join('\n');
}

function modelTable(snap, lang) {
  if (!snap?.models?.length) return null;
  const t = pack(lang).modelsTable;
  const rows = snap.models.map((m) => {
    // 按次计费的模型（New API 的 model_price）没有倍率概念，倍率栏照抄接口的 0 会被读成「免费」，
    // 真正有用的是每次多少钱，所以这类模型把价格放到输入列、倍率列写「按次」。
    const fixed = m.fixedPrice != null;
    const ratio = fixed ? t.perCall : (m.ratio ?? '—');
    const inp = fixed ? t.perCallPrice(m.fixedPrice) : m.inputPerMTok != null ? `$${m.inputPerMTok}` : '—';
    const out = fixed ? '—' : m.outputPerMTok != null ? `$${m.outputPerMTok}` : '—';
    return `| \`${m.name}\` | ${ratio} | ${inp} | ${out} | ${(m.protocols ?? []).join(' / ') || '—'} |`;
  });
  return [`| ${t.headers.join(' | ')} |`, '| :-- | :--: | :--: | :--: | :--: |', ...rows].join('\n');
}

/**
 * 面板自己报的名字（systemName）是抓来的中文，英文版里跳过——
 * 名字短但读者看不懂，硬留着不如不显示；想核对就去看中文版或站点本身。
 */
const cjk = (s) => /[\u4e00-\u9fff]/.test(String(s ?? ''));

function liveFacts(snap, lang) {
  const t = pack(lang).live;
  if (!snap) return t.none;
  const yes = (v) => (v === true ? t.yes : v === false ? t.no : t.unknown);
  const items = [
    staleHours(snap) ? t.stale(staleHours(snap), fmtDate(snap.staleFrom, lang)) : null,
    snap.probeBlocked ? t.blockedFrom(fmtDate(snap.staleFrom ?? snap.checkedAt, lang)) : null,
    // 站名 / 版本不是每种面板都拿得到（Matrix 只有一个健康检查），拿不到就别摆一行「—」占位
    snap.systemName && (lang === DEFAULT_LANG || !cjk(snap.systemName)) ? t.systemName(snap.systemName) : null,
    snap.version ? t.version(snap.version) : null,
    snap.services?.length ? t.services(snap.services.map((x) => loginMethod(x, lang)).join(' / ')) : null,
    snap.inviterBonusUsd ? t.inviterBonus(snap.inviterBonusUsd) : null,
    snap.checkinEnabled != null ? t.checkin(yes(snap.checkinEnabled)) : null,
    snap.registerOpen != null ? t.registerOpen(yes(snap.registerOpen), signupRoute(snap, lang).note) : null,
    snap.loginMethods?.length
      ? t.loginMethods(snap.loginMethods.map((x) => loginMethod(x, lang)).join(' / '))
      : null,
    snap.githubMinAccountAgeDays ? t.githubAge(snap.githubMinAccountAgeDays) : null,
    snap.latencyMs != null ? t.latency(snap.latencyMs) : null,
  ].filter(Boolean);
  return items.map((x) => `- ${x}`).join('\n');
}

/** 额度明细：接口只给邀请额度，注册基础额度与签到额度来自 sites.json 登记 */
function creditFacts(site, snap, lang) {
  const t = pack(lang).credit;
  const p = creditPlan(site, snap);
  if (p.firstDay == null) return null;
  const detail = breakdown(p, lang);
  return [
    p.signup != null ? t.signup(usd(p.signup, false, p.unit, lang)) : null,
    p.invite != null ? t.invite(usd(p.invite, false, p.unit, lang), p.apiInvite === p.invite) : null,
    p.daily == null
      ? null
      : p.resets
        ? t.dailyPool(usd(p.daily, p.approx, p.unit, lang))
        : t.dailyCheckin(usd(p.daily, p.approx, p.unit, lang)),
    t.firstDay(usd(p.firstDay, p.approx, p.unit, lang), p.sources > 1 && detail ? detail : null),
  ]
    .filter(Boolean)
    .join('\n');
}

function siteSection(site, snap, lang, meta) {
  const t = pack(lang).section;
  const copy = siteCopy(site, lang);
  const cm = claudeModel(snap, pack(lang));
  const om = openaiModel(snap, pack(lang));
  const models = modelTable(snap, lang);
  const mirror = (site.mirrors ?? [])
    .map((m) => `- ${mirrorLabel(m, lang)}${t.mirrorSep}<${m.homeUrl}> · ${ext(t.mirrorSignup, m.signupUrl)}`)
    .join('\n');

  const parts = [
    `### ${snap?.online ? '🟢' : '🔴'} ${copy.name}${site.recommended ? t.recommended : ''}`,
    '',
    // 没写英文副标题就整行不出现，别留一个空的引用块
    ...(copy.subtitle ? [`> ${copy.subtitle}`, ''] : []),
    ext(`<img src="${B(t.signupBadge, copy.name, 'brightgreen?style=for-the-badge')}" alt="${t.signupAlt(copy.name)}">`, site.signupUrl),
    '',
    t.why,
    '',
    copy.highlights.map((h) => `- ${h}`).join('\n'),
    ...(creditFacts(site, snap, lang) ? ['', t.howMuch, '', creditFacts(site, snap, lang)] : []),
    '',
    t.live,
    '',
    liveFacts(snap, lang),
  ];

  if (mirror) parts.push('', t.mirrors, '', mirror);

  // 模型表来自接口、与语言无关；拿不到时优先用站点自己写的说明，英文版没翻就退到通用说法
  if (models) {
    const fixedAny = (snap?.models ?? []).some((m) => m.fixedPrice != null);
    parts.push('', t.models, '', models, '', `<sub>${fixedAny ? t.modelNoteFixed : t.modelNoteToken}</sub>`);
  } else if (copy.modelsNote) {
    parts.push('', `> ${copy.modelsNote}`);
  } else if (lang !== DEFAULT_LANG) {
    parts.push('', t.noModelTable);
  } else {
    parts.push('', `> ${t.modelsLoginFallback}`);
  }

  parts.push(
    '',
    t.requirements,
    '',
    [...(copy.register?.requirements ?? []).map((r) => `- ${r}`)].join('\n') || t.requirementsNone,
    '',
    t.setup,
    '',
    accessBlock(site, cm, om, lang, copy),
  );

  if (copy.earnMore?.length) parts.push('', t.earnMore, '', copy.earnMore.map((x) => `- ${x}`).join('\n'));
  if (copy.caveats?.length) parts.push('', t.caveats, '', copy.caveats.map((x) => `- ${x}`).join('\n'));
  if (copy.community?.length) parts.push('', t.community, '', copy.community.map((x) => `- ${x}`).join('\n'));

  // 公告是站方发的中文原文，翻了就是编内容；英文版只给一句说明指路
  const ann = lang === DEFAULT_LANG ? (snap?.announcements ?? []).slice(0, 3) : [];
  if (ann.length) {
    parts.push('', t.announcements, '');
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
function accessBlock(site, claude, openai, lang, copy) {
  if (site.endpoints?.anthropic || site.endpoints?.openai) return codeBlocks(site, claude, openai, lang, copy.name);

  const s = copy.setup ?? {};
  const t = pack(lang).section;
  const out = [];
  if (s.note) out.push(`> ${s.note}`, '');
  if (s.steps?.length) out.push(s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  if (s.dashboardUrl) out.push('', t.consoleLink(s.dashboardUrl));
  return out.join('\n') || t.setupFallback;
}

function codeBlocks(site, claude, openai, lang, name) {
  const t = pack(lang).setup;
  const anth = site.endpoints?.anthropic;
  const oai = site.endpoints?.openai;
  const out = [];

  if (anth) {
    out.push(
      t.claudeSummary,
      '',
      `${F}bash`,
      '# macOS / Linux',
      `export ANTHROPIC_BASE_URL=${anth}`,
      `export ANTHROPIC_AUTH_TOKEN=${t.claudeKey}`,
      `export ANTHROPIC_MODEL=${claude}`,
      'npm install -g @anthropic-ai/claude-code@latest && claude',
      F,
      '',
      `${F}powershell`,
      '# Windows PowerShell',
      `$env:ANTHROPIC_BASE_URL = "${anth}"`,
      `$env:ANTHROPIC_AUTH_TOKEN = "${t.claudeKey}"`,
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
      t.codexSummary,
      '',
      `${F}toml`,
      `model = "${openai}"`,
      `model_provider = "${site.id}"`,
      '',
      `[model_providers.${site.id}]`,
      `name = "${name}"`,
      `base_url = "${oai}"`,
      `env_key = "${site.id.toUpperCase()}_API_KEY"`,
      'wire_api = "chat"',
      F,
      '',
      '</details>',
      '',
      t.genericSummary,
      '',
      `${F}python`,
      'from openai import OpenAI',
      '',
      `client = OpenAI(api_key="${t.genericKey}", base_url="${oai}")`,
      `resp = client.chat.completions.create(model="${openai}", messages=[{"role": "user", "content": "ping"}])`,
      'print(resp.choices[0].message.content)',
      F,
      '',
      t.genericNote(oai),
      '',
      '</details>',
      '',
      t.verifySummary,
      '',
      `${F}bash`,
      `curl -s ${oai}/chat/completions \\`,
      '  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\',
      `  -d '{"model":"${openai}","messages":[{"role":"user","content":"${t.verifyPrompt}"}]}'`,
      F,
      '',
      '</details>',
    );
  }
  return out.join('\n');
}

export function renderReadme({ meta, sites, live, groups = [], history, lang = DEFAULT_LANG }) {
  const t = pack(lang);
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  const welfare = sites;
  const onlineCount = welfare.filter((s) => byId.get(s.id)?.online).length;
  const staleCount = welfare.filter((s) => staleHours(byId.get(s.id))).length;
  // 「全注册一遍能拿多少」这句话是对新用户说的，把停注的站点算进去就是虚报额度（详见 lib/signup.mjs）
  const openSites = welfare.filter((s) => acceptsNew(byId.get(s.id)));
  const closedSites = welfare.filter((s) => !acceptsNew(byId.get(s.id)));
  const plans = openSites.map((s) => creditPlan(s, byId.get(s.id)));
  // 合计只算美元站：积分与美元没有公开换算，混着加就是编数字（详见 lib/credits.mjs）
  const { count: usdCount, best, total, resetting, others } = usdTotals(plans);
  const codeSites = welfare.filter((s) => s.inviteCode);
  // 站点名走 en.name 覆盖：多数站名本来就是拉丁字母，中文名（如「年华 API」）得给个英文写法
  const nameOf = (s) => siteCopy(s, lang).name;
  // othersNote 拿的是 creditPlan 的结果，只有 name 字段，回查一次拿到目标语言的站名
  const byName = new Map(welfare.map((s) => [s.name, s]));
  const extra = othersNote(others, lang, (p) => (p.name ? nameOf(byName.get(p.name) ?? { name: p.name }) : null));
  const scope = others.length ? t.callouts.scope(usdCount) : t.callouts.scopeAll(openSites.length);
  const pages = (meta.pagesUrl ?? '').replace(/\/?$/, '/');
  const sep = lang === DEFAULT_LANG ? '、' : ', ';

  const head = [
    `<h1 align="center">${lang === DEFAULT_LANG ? meta.title : (meta.titleEn ?? meta.title)}</h1>`,
    '',
    `<p align="center">${lang === DEFAULT_LANG ? meta.tagline : (meta.taglineEn ?? meta.tagline)}</p>`,
    '',
    // 切换链接紧贴标题：读者第一眼就要看见另一版在哪，别埋在页脚
    t.langSwitch,
    '',
    '<p align="center">',    badge(t.badges.sites(welfare.length)),
    badge(t.badges.online(onlineCount, welfare.length, onlineCount === welfare.length)),
    closedSites.length ? badge(t.badges.open(openSites.length, welfare.length)) : null,
    best > 0 ? badge(t.badges.best(best)) : null,
    badge(t.badges.updated(fmtDate(live?.generatedAt, lang).replace(/:/g, '.'))),
    '</p>',
    '',
    '<p align="center">',
    welfare.map((s) => `  <a href="${s.signupUrl}"><b>${nameOf(s)} ${t.table.signupSuffix}</b></a>`).join(' ·\n'),
    '</p>',
    '',
    '---',
    '',
    `## ${t.hero.quickTitle}`,
    '',
    t.hero.note,
    '',
    overviewTable(welfare, byId, lang),
    '',
    t.callouts.firstDay(fmtDate(live?.generatedAt, lang)),
    codeSites.length ? '>' : null,
    // 「—」不等于没有邀请额度，只是不用手打；这一句不写清楚，读者会以为那些站白嫖不到邀请额度
    codeSites.length
      ? t.callouts.inviteCode(codeSites.map((s) => `${nameOf(s)} \`${s.inviteCode}\``).join(sep))
      : null,
    total > 0 ? '>' : null,
    total > 0 ? t.callouts.totals(scope, total, resetting, extra) : null,
    closedSites.length ? '>' : null,
    closedSites.length ? t.callouts.closed(closedSites.map((s) => `**${nameOf(s)}**`).join(sep), pages) : null,
    staleCount > 0 ? '>' : null,
    staleCount > 0 ? t.callouts.stale(staleCount) : null,
    '',
    t.quickstart.lead,
    '',
    `1. ${t.quickstart.steps[0]}`,
    `2. ${t.quickstart.steps[1]}`,
    `3. ${t.quickstart.steps[2]}`,
    '',
    `${F}bash`,
    t.quickstart.bashComment,
    'bash scripts/quickstart.sh',
    F,
    '',
    `${F}powershell`,
    t.quickstart.psComment,
    'powershell -ExecutionPolicy Bypass -File scripts/quickstart.ps1',
    F,
    '',
    `## ${t.section.details}`,
    '',
  ];

  const body = welfare.map((s) => siteSection(s, byId.get(s.id), lang, meta)).join('\n\n---\n\n');
  return [
    head.filter((l) => l !== null).join('\n'),
    body,
    changesBlock({ groups, history, pages, lang }),
    tail(meta, sites, live, lang),
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
function changesBlock({ groups, history, pages, lang }) {
  const t = pack(lang).changes;
  const events = groups.flatMap((g) => g.events).slice(0, 6);
  const cov = coverage(history ?? { samples: [] });
  const lines = ['---', '', `## ${t.title}`, '', t.intro(cov.samples, cov.days), '', t.watch];
  // 事件文本是抓来的中文公告原文，机器翻出来就是编内容；英文版给一句说明指路
  if (lang === DEFAULT_LANG && events.length) {
    lines.push(
      '',
      '最近几条：',
      '',
      ...events.map((e) => `- \`${String(e.at ?? '').slice(0, 10)}\` ${icon(e.type)} ${e.text}`),
      '',
      '完整记录见 [CHANGELOG.md](CHANGELOG.md)。',
    );
  } else if (t.noteZhOnly) {
    lines.push('', t.noteZhOnly);
  }
  return lines.join('\n');
}

function tail(meta, sites, live, lang) {
  const t = pack(lang).tail;
  const faq = pack(lang).faq;
  const foot = pack(lang).footer;
  const contribute = pack(lang).contribute;
  const disclaimer = pack(lang).disclaimer;
  return [
    '---',
    '',
    `## ${t.filesTitle}`,
    '',
    `| ${t.filesHeaders[0]} | ${t.filesHeaders[1]} |`,
    '| :-- | :-- |',
    ...t.files.map(([a, b]) => `| ${a} | ${b} |`),
    '',
    t.runTitle,
    '',
    `${F}bash`,
    `npm test          ${t.runComments[0]}`,
    `npm run refresh   ${t.runComments[1]}`,
    `npm run history   ${t.runComments[2]}`,
    `npm run build     ${t.runComments[3]}`,
    `npm run check     ${t.runComments[4]}`,
    F,
    '',
    `## ${faq.title}`,
    '',
    ...faq.items.flatMap(([q, a]) => [`<details><summary><b>${q}</b></summary>`, '', a, '', '</details>', '']),
    `## ${contribute.title}`,
    '',
    contribute.intro,
    '',
    contribute.issue(`${meta.repoUrl}/issues/new?template=new-site.yml`),
    contribute.pr,
    '',
    contribute.criteria,
    '',
    `## ${disclaimer.title}`,
    '',
    ...disclaimer.items,
    '',
    `## ${t.groupTitle}`,
    '',
    '<p align="center">',
    `  <img src="docs/assets/qq-group.jpg" width="260" alt="${t.groupAlt}">`,
    '</p>',
    '',
    `<p align="center">${t.groupDesc}</p>`,
    '',
    '---',
    '',
    `<p align="center">${foot.star}</p>`,
    '',
    foot.keywords(
      (lang === DEFAULT_LANG ? (meta.keywords ?? []) : (meta.keywordsEn ?? meta.keywords ?? [])).join(' · '),
    ),
    '',
    foot.generated,
  ].join('\n');
}
