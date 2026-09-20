#!/usr/bin/env node
/**
 * 零依赖单测：node scripts/test.mjs
 * 盯的是线上真实踩过的坑——CI 机房 IP 被 Cloudflare 拦时，页面不能退化成「异常 + 无数据」。
 */
import assert from 'node:assert';
import { mergeSnapshot, meaningful } from './lib/merge.mjs';
import { pickPreferred, staleHours, STALE_WARN_HOURS, blankSnapshot, looksFiltered, probeUrl, isHttpsUrl, fetchJson } from './lib/newapi.mjs';
import { creditPlan, usd, breakdown, perDay, auditCredits, usdTotals, othersNote } from './lib/credits.mjs';
import { PANELS, probeSite } from './lib/panels.mjs';
import { diffSite, diffSnapshots, majorOnly, priceLabel } from './lib/diff.mjs';
import { appendSample, compact, uptime, byDay, coverage, EMPTY_HISTORY } from './lib/history.mjs';
import { groupByDay, renderAtom, summarize, icon } from './lib/changelog.mjs';
import { renderSitePage } from './lib/render-site-page.mjs';
import { renderComparePage, renderStatusPage, renderChangelogPage, estimateTurns } from './lib/render-aux-pages.mjs';
import { renderHtml } from './lib/render-html.mjs';
import { renderReadme } from './lib/render-readme.mjs';
import { signupRoute, acceptsNew } from './lib/signup.mjs';
import { telegramText } from './lib/telegram.mjs';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    console.error(`  ✘ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const HOUR = 3_600_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const OLD_GOOD = {
  id: 'agentrouter',
  checkedAt: iso(6 * HOUR),
  apiOk: true,
  pricingOk: true,
  latencyMs: 378,
  error: null,
  systemName: 'Agent Router',
  version: 'init-20260820-c6931bb5',
  registerOpen: true,
  checkinEnabled: null,
  loginMethods: ['GitHub', 'LinuxDO'],
  quotaPerUnit: 500000,
  inviteeBonusUsd: 50,
  inviterBonusUsd: 150,
  announcements: [{ id: 1, date: '2026-08-20', text: '公告' }],
  models: [{ name: 'claude-opus-4-8' }, { name: 'claude-opus-5' }, { name: 'gpt-5.6-sol' }],
  modelsSource: 'public-api',
  signup: { status: 200, ok: true, ms: 300 },
  mirrors: [{ homeUrl: 'https://ps.air-outer.com', online: true }],
  defaults: { claude: 'claude-opus-5', openai: 'gpt-5.6-sol' },
  online: true,
};

/** 模拟 Cloudflare 挑战：HTTP 200 但不是 JSON，于是所有内容字段都是空的 */
const FRESH_BLOCKED = {
  id: 'agentrouter',
  checkedAt: iso(0),
  apiOk: false,
  pricingOk: false,
  latencyMs: 1219,
  error: 'invalid json',
  systemName: null,
  version: null,
  registerOpen: null,
  checkinEnabled: null,
  loginMethods: [],
  quotaPerUnit: null,
  inviteeBonusUsd: null,
  inviterBonusUsd: null,
  announcements: [],
  models: [],
  modelsSource: 'login-required',
  defaults: { claude: null, openai: null },
  signup: { status: 200, ok: true, ms: 412 },
  mirrors: [{ homeUrl: 'https://ps.air-outer.com', online: false }],
};

console.log('mergeSnapshot：接口被拦时保住已知数据');
{
  const m = mergeSnapshot(FRESH_BLOCKED, OLD_GOOD);
  test('站名 / 版本 / 邀请额度 沿用旧值，不会变成 null', () => {
    assert.equal(m.systemName, 'Agent Router');
    assert.equal(m.version, 'init-20260820-c6931bb5');
    assert.equal(m.inviteeBonusUsd, 50);
    assert.equal(m.inviterBonusUsd, 150);
    assert.deepEqual(m.loginMethods, ['GitHub', 'LinuxDO']);
  });
  test('模型清单沿用旧值并标注 cached', () => {
    assert.equal(m.models.length, 3);
    assert.equal(m.modelsSource, 'cached');
  });
  test('默认模型按合并后的清单重算（版本最新的赢）', () => {
    assert.equal(m.defaults.claude, 'claude-opus-5');
    assert.equal(m.defaults.openai, 'gpt-5.6-sol');
  });
  test('注册页 200 → 仍算在线，不显示「异常」', () => {
    assert.equal(m.online, true);
  });
  test('探测元信息用本次的真实结果', () => {
    assert.equal(m.apiOk, false);
    assert.equal(m.error, 'invalid json');
    assert.equal(m.latencyMs, 1219);
    assert.equal(m.checkedAt, FRESH_BLOCKED.checkedAt);
    assert.equal(m.mirrors[0].online, false);
  });
  test('标记 dataStale + staleFrom 指向旧快照时间', () => {
    assert.equal(m.dataStale, true);
    assert.equal(m.staleFrom, OLD_GOOD.checkedAt);
    assert.ok(m.staleFields.includes('systemName') && m.staleFields.includes('models'));
  });
  test('6 小时内的快照不在页面上报警', () => {
    assert.equal(staleHours(m), null);
  });
  test(`超过 ${STALE_WARN_HOURS} 小时才报警，并给出小时数`, () => {
    const long = mergeSnapshot(FRESH_BLOCKED, { ...OLD_GOOD, checkedAt: iso(72 * HOUR) });
    assert.equal(staleHours(long), 72);
  });
}

console.log('mergeSnapshot：其它路径');
test('抓取成功时新值覆盖旧值，且不标 stale', () => {
  const fresh = { ...OLD_GOOD, checkedAt: iso(0), systemName: 'Agent Router 2', inviteeBonusUsd: 30, models: [{ name: 'claude-opus-5' }] };
  const m = mergeSnapshot(fresh, OLD_GOOD);
  assert.equal(m.systemName, 'Agent Router 2');
  assert.equal(m.inviteeBonusUsd, 30);
  assert.equal(m.models.length, 1);
  assert.equal(m.modelsSource, 'public-api');
  assert.equal(m.dataStale, false);
  assert.equal(m.staleFrom, null);
});
test('status 通了但 pricing 被拦：模型沿用旧值，站名用新值', () => {
  const fresh = { ...FRESH_BLOCKED, apiOk: true, error: null, systemName: 'Agent Router', inviteeBonusUsd: 50 };
  const m = mergeSnapshot(fresh, OLD_GOOD);
  assert.equal(m.online, true);
  assert.equal(m.models.length, 3);
  assert.equal(m.modelsSource, 'cached');
  assert.equal(m.dataStale, true);
});
test('首次抓取（没有旧快照）不会因为 old 缺失而炸', () => {
  const m = mergeSnapshot(FRESH_BLOCKED, undefined);
  assert.equal(m.systemName, null);
  assert.equal(m.models.length, 0);
  assert.equal(m.dataStale, false);
  assert.equal(m.defaults.claude, null);
  assert.equal(m.online, true); // 注册页可访问
});
test('注册页也不通 → 如实标记异常', () => {
  const m = mergeSnapshot({ ...FRESH_BLOCKED, signup: { status: 0, ok: false, ms: 20000, error: 'timeout' } }, OLD_GOOD);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});

console.log('mergeSnapshot：区分「被 WAF 拦」和「站点真挂了」');
/** CI 机房 IP 的典型样子：接口和注册页一起吃 403，本机访问同一个域名全是 200 */
const ALL_403 = { ...FRESH_BLOCKED, error: 'HTTP 403', signup: { status: 403, ok: false, ms: 210 } };

test('整站 403 且上次是在线的 → 仍算在线，标 probeBlocked', () => {
  const m = mergeSnapshot(ALL_403, OLD_GOOD);
  assert.equal(m.online, true);
  assert.equal(m.probeBlocked, true);
  assert.equal(m.systemName, 'Agent Router'); // 数据照旧沿用
  assert.equal(m.dataStale, true);
});
test('429 / 503 / 挑战页同样按被拦处理', () => {
  for (const [error, signup] of [
    ['HTTP 429', { status: 429, ok: false, ms: 90 }],
    ['HTTP 503', { status: 503, ok: false, ms: 90 }],
    ['invalid json', { status: 200, ok: false, ms: 90, error: 'invalid json' }],
  ]) {
    const m = mergeSnapshot({ ...ALL_403, error, signup }, OLD_GOOD);
    assert.equal(m.online, true, error);
    assert.equal(m.probeBlocked, true, error);
  }
});
test('超时 / 连不上 / 502 是真下线，不许拿「可能被拦」兜底', () => {
  for (const [error, signup] of [
    ['timeout', { status: 0, ok: false, ms: 20000, error: 'timeout' }],
    ['HTTP 502', { status: 502, ok: false, ms: 90 }],
    ['HTTP 404', { status: 404, ok: false, ms: 90 }],
  ]) {
    const m = mergeSnapshot({ ...ALL_403, error, signup }, OLD_GOOD);
    assert.equal(m.online, false, error);
    assert.equal(m.probeBlocked, false, error);
  }
});
test('接口被拦但注册页超时 → 混着算真下线', () => {
  const m = mergeSnapshot({ ...ALL_403, signup: { status: 0, ok: false, ms: 20000, error: 'timeout' } }, OLD_GOOD);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});
test('旧快照超过 48 小时还是只有 403 → 不再兜底，如实标异常', () => {
  const m = mergeSnapshot(ALL_403, { ...OLD_GOOD, checkedAt: iso(72 * HOUR) });
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});
test('连续被拦：staleFrom 粘在最后一次成功的时间，不跟着 checkedAt 往后跑', () => {
  const once = mergeSnapshot(ALL_403, OLD_GOOD);
  const twice = mergeSnapshot({ ...ALL_403, checkedAt: iso(0) }, once);
  assert.equal(once.staleFrom, OLD_GOOD.checkedAt);
  assert.equal(twice.staleFrom, OLD_GOOD.checkedAt);
  assert.equal(twice.online, true);
});
test('连续被拦超过 48 小时（checkedAt 每次都在刷新）→ 依旧会翻成异常', () => {
  const blockedLong = { ...OLD_GOOD, checkedAt: iso(0), online: true, staleFrom: iso(60 * HOUR), dataStale: true };
  const m = mergeSnapshot(ALL_403, blockedLong);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
  assert.equal(staleHours(m), 60);
});
test('从没成功过的站点被 403 → 没有「上次在线」可沿用，标异常', () => {
  const m = mergeSnapshot(ALL_403, undefined);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});
test('本次探通了就不该标 probeBlocked', () => {
  assert.equal(mergeSnapshot(FRESH_BLOCKED, OLD_GOOD).probeBlocked, false); // 注册页 200
  assert.equal(mergeSnapshot({ ...OLD_GOOD, checkedAt: iso(0) }, OLD_GOOD).probeBlocked, false);
});
test('looksFiltered 只认「服务器答话了但把我们拦了」', () => {
  for (const r of [{ status: 403 }, { status: 429 }, { status: 451 }, { status: 503 }, { status: 200, error: 'invalid json' }]) {
    assert.equal(looksFiltered(r), true, JSON.stringify(r));
  }
  for (const r of [null, { ok: true, status: 200 }, { status: 0, error: 'timeout' }, { status: 502 }, { status: 404 }]) {
    assert.equal(looksFiltered(r), false, JSON.stringify(r));
  }
});

console.log('额度口径 creditPlan');
const AR = { id: 'agentrouter', name: 'AgentRouter', credits: { signup: 100, invite: 50, dailyCheckin: 25, approx: false } };
const JD = { id: 'justdowork', name: 'JustDoWork', credits: { signup: 70, invite: null, dailyCheckin: 22, approx: true } };
const RC = { id: 'rawchat', name: 'RawChat 公益站', credits: { signup: null, invite: null, dailyCheckin: null, dailyQuota: 50 } };

test('AgentRouter：100 注册 + 50 邀请 + 25 签到 = 首日 175', () => {
  const p = creditPlan(AR, OLD_GOOD);
  assert.equal(p.base, 150);
  assert.equal(p.firstDay, 175);
  assert.equal(usd(p.firstDay, p.approx), '$175');
  assert.equal(breakdown(p), '注册 $100 + 本页邀请 $50 + 首签 $25');
});
test('AgentRouter：登记的邀请额度与接口实测 $50 一致', () => {
  const p = creditPlan(AR, OLD_GOOD);
  assert.equal(p.apiInvite, 50);
  assert.equal(p.invite, p.apiInvite);
  assert.deepEqual(auditCredits([AR], { sites: [OLD_GOOD] }), []);
});
test('JustDoWork：70 + 约 22 = 首日约 92，带 ≈ 前缀', () => {
  const p = creditPlan(JD, { id: 'justdowork' });
  assert.equal(p.firstDay, 92);
  assert.equal(usd(p.firstDay, p.approx), '≈$92');
  assert.equal(breakdown(p), '注册 $70 + 首签 ≈$22');
});
test('接口把邀请额度改了 → auditCredits 告警，提醒更新登记值', () => {
  const w = auditCredits([AR], { sites: [{ ...OLD_GOOD, inviteeBonusUsd: 30 }] });
  assert.equal(w.length, 1);
  assert.match(w[0], /登记邀请额度 \$50.*返回 \$30/);
});
test('AgentRouter：签到额度是累积的，措辞是「首签」而不是「重置」', () => {
  const p = creditPlan(AR, OLD_GOOD);
  assert.equal(p.resets, false);
  assert.equal(perDay(p), '$25/天');
});
test('RawChat：每日重置额度池 $50 → 首日 $50，且说明不累积', () => {
  const p = creditPlan(RC, null);
  assert.equal(p.firstDay, 50);
  assert.equal(p.daily, 50);
  assert.equal(p.resets, true);
  assert.equal(p.base, null);
  assert.equal(perDay(p), '$50/天（重置）');
  assert.equal(breakdown(p), '每日额度池 $50（每天重置，不累积）');
});
test('dailyCheckin 与 dailyQuota 同时填 → 按签到算并告警', () => {
  const both = { id: 'both', name: 'Both', credits: { signup: 10, dailyCheckin: 5, dailyQuota: 50 } };
  const p = creditPlan(both, null);
  assert.equal(p.daily, 5);
  assert.equal(p.resets, false);
  assert.match(auditCredits([both], { sites: [] }).join(''), /口径不同/);
});
test('没填 credits 的站点不炸，只告警', () => {
  const p = creditPlan({ id: 'x', name: 'X' }, null);
  assert.equal(p.firstDay, null);
  assert.equal(usd(p.firstDay), null);
  assert.equal(breakdown(p), null);
  assert.equal(perDay(p), null);
  assert.equal(auditCredits([{ id: 'x', name: 'X' }], { sites: [] }).length, 1);
});

console.log('计价单位：积分站不能被当成美元站');
const MX = { id: 'matrix', name: 'Matrix', credits: { signup: null, invite: 600, realNameBonus: 2000, dailyCheckin: null, approx: false, unit: 'point' } };

test('Matrix：600 积分按积分显示，绝不擅自加 $', () => {
  const p = creditPlan(MX, null);
  assert.equal(p.unit, 'point');
  assert.equal(p.firstDay, 2600);
  assert.equal(usd(p.firstDay, p.approx, p.unit), '2600 积分');
  assert.equal(breakdown(p), '本页邀请 600 积分 + 实名认证 2000 积分');
  assert.equal(perDay(p), null); // 没有签到、也没有每日额度池
});
test('sources 数出首日额度由几笔钱凑成，只有一笔时页面不重复说构成', () => {
  assert.equal(creditPlan(AR, OLD_GOOD).sources, 3);
  assert.equal(creditPlan(JD, null).sources, 2);
  assert.equal(creditPlan(RC, null).sources, 1);
  assert.equal(creditPlan(MX, null).sources, 2);
  assert.equal(creditPlan({ id: 'x', name: 'X' }, null).sources, 0);
});
test('跨站合计只算美元站，积分站单独说一句', () => {
  const plans = [creditPlan(AR, OLD_GOOD), creditPlan(JD, null), creditPlan(RC, null), creditPlan(MX, null)];
  const t = usdTotals(plans);
  assert.equal(t.count, 3);
  assert.equal(t.best, 175);
  assert.equal(t.total, 175 + 92 + 50);
  assert.equal(t.resetting, true);
  assert.equal(t.others.length, 1);
  assert.equal(othersNote(t.others), 'Matrix 另发 2600 积分');
  assert.equal(othersNote([]), null);
});
test('积分站不拿接口的美元邀请额度对账，避免误报', () => {
  assert.deepEqual(auditCredits([MX], { sites: [{ id: 'matrix', inviteeBonusUsd: 30 }] }), []);
});
test('未登记的单位原样后缀显示，并告警提醒补 UNITS', () => {
  const odd = { id: 'odd', name: 'Odd', credits: { signup: 5, unit: 'credit' } };
  assert.equal(usd(5, false, 'credit'), '5 credit');
  assert.match(auditCredits([odd], { sites: [] }).join(''), /不在已知单位/);
});
/** DoCode 的「刀」是站内计价单位：面板 price=0.02（1 元 = 50 刀），和 ¥7.3 ≈ $1 的站差两个数量级 */
const DC = { id: 'docode', name: 'DoCode', credits: { signup: 50, invite: 250, dailyCheckin: null, approx: false, unit: 'site-usd' } };

test('站内刀按「站内刀」显示，不加 $、不并进美元合计', () => {
  const p = creditPlan(DC, null);
  assert.equal(p.firstDay, 300);
  assert.equal(usd(p.firstDay, p.approx, p.unit), '300 站内刀');
  assert.equal(breakdown(p), '注册 50 站内刀 + 本页邀请 250 站内刀');
  const t = usdTotals([creditPlan(AR, OLD_GOOD), creditPlan(DC, null)]);
  assert.equal(t.count, 1);
  assert.equal(t.total, 175); // 300 站内刀不许加进来
  assert.equal(othersNote(t.others), 'DoCode 另发 300 站内刀');
  assert.deepEqual(auditCredits([DC], { sites: [] }), []); // 已登记的单位不该告警
});
test('新收录事件按站点自己的单位写额度，不硬拼 $', () => {
  const [ev] = diffSnapshots({ sites: [] }, { generatedAt: iso(0), sites: [{ id: 'docode' }] }, [DC]);
  assert.equal(ev.text, '新收录 DoCode：注册送 50 站内刀，邀请再加 250 站内刀');
});

console.log('vibe-code 面板（Codex 公益站，接口不是 New API）');
/** 2026-08-21 从 new.sharedchat.cc 实测抓到的返回体 */
const VC_SITE = { id: 'rawchat', panel: 'vibecode', statusApi: 'https://new.sharedchat.cc/frontend-api/getConfig' };
const VC_CONFIG = {
  code: 1,
  msg: 'success',
  data: { siteName: 'RawChat公益站', siteType: 'codex', isAuth: false, isAuthClaude: false, isAuthCodex: true, isAuthGemini: false },
};
const VC_LOGIN = {
  code: 1,
  msg: 'success',
  data: {
    notice: '  每日 0 点重置额度  ',
    isEnableRegister: true,
    isEnableMailRegister: true,
    isEnableGitHubLogin: false,
    isEnableLinuxDoLogin: false,
    siteName: 'RawChat公益站',
    backendVersion: '1.0.0.0',
  },
};
const vcFetch = (map) => async (url) => map[String(url)] ?? { ok: false, error: 'unreachable' };
const VC_OK = vcFetch({
  'https://new.sharedchat.cc/frontend-api/getConfig': { ok: true, status: 200, ms: 587, json: VC_CONFIG },
  'https://new.sharedchat.cc/frontend-api/getLoginConfig': { ok: true, status: 200, ms: 431, json: VC_LOGIN },
});
const VC_CLOSED = { ok: true, status: 200, ms: 300, json: { code: 0, msg: '该接口未接入公益站独立网关，旧转发链路已关闭', data: null } };

// 探测本身是异步的，先在顶层 await 出结果，断言保持同步，测试运行器就不用管 Promise
const vcGood = await probeSite(VC_SITE, VC_OK);
const vcClosed = await probeSite(VC_SITE, vcFetch({
  'https://new.sharedchat.cc/frontend-api/getConfig': VC_CLOSED,
  'https://new.sharedchat.cc/frontend-api/getLoginConfig': VC_CLOSED,
}));
const vcUnreachable = await probeSite(VC_SITE, vcFetch({}));

test('站名 / 版本 / 注册开关 / 登录方式 / 已开放服务 都取到了', () => {
  assert.equal(vcGood.apiOk, true);
  assert.equal(vcGood.error, null);
  assert.equal(vcGood.systemName, 'RawChat公益站');
  assert.equal(vcGood.version, '1.0.0.0');
  assert.equal(vcGood.registerOpen, true);
  assert.deepEqual(vcGood.loginMethods, ['邮箱']);
  assert.deepEqual(vcGood.services, ['Codex']);
  assert.equal(vcGood.latencyMs, 587);
});
test('站内公告取自 notice，模型清单为空且标注需登录', () => {
  assert.deepEqual(vcGood.announcements, [{ id: null, date: null, text: '每日 0 点重置额度' }]);
  assert.deepEqual(vcGood.models, []);
  assert.equal(vcGood.modelsSource, 'login-required');
});
test('快照字段集合与 New API 面板完全一致（否则 merge 会漏字段）', () => {
  assert.deepEqual(Object.keys(vcGood).sort(), Object.keys(blankSnapshot(VC_SITE, {})).sort());
});
test('HTTP 200 但 code=0（接口未开放）→ 不当数据用，如实报错', () => {
  assert.equal(vcClosed.apiOk, false);
  assert.match(vcClosed.error, /旧转发链路已关闭/);
  assert.equal(vcClosed.systemName, null);
  assert.deepEqual(vcClosed.services, []);
});
test('vibe-code 接口被拦时，也走同一套字段级合并保住旧数据', () => {
  const m = mergeSnapshot({ ...vcUnreachable, signup: { status: 200, ok: true, ms: 210 } }, vcGood);
  assert.equal(m.online, true);
  assert.equal(m.systemName, 'RawChat公益站');
  assert.deepEqual(m.services, ['Codex']);
  assert.equal(m.dataStale, true);
});
test('panel 缺省是 newapi，未知 panel 直接报错而不是静默出空页', () => {
  assert.equal(PANELS.newapi.name, 'probeNewApi');
  assert.equal(PANELS.vibecode.name, 'probeVibeCode');
  assert.equal(PANELS.matrix.name, 'probeMatrix');
  assert.throws(() => probeSite({ id: 'z', panel: 'nope' }), /未知的面板类型/);
});

console.log('matrix 面板（公开接口只有一个健康检查，其余一律不猜）');
/** 2026-08-26 从 matrix.mzsjai.com/api/health 实测抓到的返回体 */
const MX_SITE = { id: 'matrix', panel: 'matrix', statusApi: 'https://matrix.mzsjai.com/api/health' };
const MX_HEALTH = { status: 'ok', timestamp: '2026-08-26T11:19:00.504Z' };
const mxFetch = (res) => async (url) => (String(url) === MX_SITE.statusApi ? res : { ok: false, error: 'unreachable' });

const mxGood = await probeSite(MX_SITE, mxFetch({ ok: true, status: 200, ms: 264, json: MX_HEALTH }));
const mxDegraded = await probeSite(MX_SITE, mxFetch({ ok: true, status: 200, ms: 311, json: { status: 'degraded' } }));
const mxNoField = await probeSite(MX_SITE, mxFetch({ ok: true, status: 200, ms: 120, json: { hello: 1 } }));
const mxDown = await probeSite(MX_SITE, mxFetch({ ok: false, status: 0, ms: 20_000, error: 'timeout' }));

test('health 返回 status=ok → apiOk，延迟如实记录', () => {
  assert.equal(mxGood.apiOk, true);
  assert.equal(mxGood.error, null);
  assert.equal(mxGood.latencyMs, 264);
});
test('接口给不出的字段一律留空，不从 sites.json 倒灌假装是探测结果', () => {
  assert.equal(mxGood.systemName, null);
  assert.equal(mxGood.version, null);
  assert.equal(mxGood.registerOpen, null);
  assert.equal(mxGood.checkinEnabled, null);
  assert.equal(mxGood.inviteeBonusUsd, null);
  assert.deepEqual(mxGood.loginMethods, []);
  assert.deepEqual(mxGood.models, []);
  assert.equal(mxGood.modelsSource, 'login-required');
  assert.equal(mxGood.pricingOk, false);
});
test('后端自报 degraded / 缺 status 字段 → 不当在线用，原因写进 error', () => {
  assert.equal(mxDegraded.apiOk, false);
  assert.match(mxDegraded.error, /degraded/);
  assert.equal(mxNoField.apiOk, false);
  assert.match(mxNoField.error, /没有 status 字段/);
});
test('连不上就是连不上，错误原样带出来', () => {
  assert.equal(mxDown.apiOk, false);
  assert.equal(mxDown.error, 'timeout');
  assert.equal(mxDown.latencyMs, 20_000);
});
test('matrix 快照字段集合与 New API 面板完全一致（否则 merge 会漏字段）', () => {
  assert.deepEqual(Object.keys(mxGood).sort(), Object.keys(blankSnapshot(MX_SITE, {})).sort());
});
test('health 挂了但注册页 200 → 页面仍算在线，不误报异常', () => {
  const m = mergeSnapshot({ ...mxDown, signup: { status: 200, ok: true, ms: 180 } }, mxGood);
  assert.equal(m.online, true);
  assert.equal(m.apiOk, false);
  assert.equal(m.error, 'timeout');
});

/**
 * relay 面板探针假数据：这里不需要真实域名，rlFetch 只认 RL_SITE.statusApi；
 * 用例覆盖 401/200/500/超时/403 五种分支。
 */
const RL_SITE = { id: 'relay-fixture', panel: 'relay', statusApi: 'https://relay-fixture.test/api/status' };
const rlFetch = (res) => async (url) => (String(url) === RL_SITE.statusApi ? res : { status: 0, ok: false, error: 'unreachable' });

const rlKeyRequired = await probeSite(RL_SITE, rlFetch({ status: 401, ok: false, ms: 233, attempts: 1 }));
const rlOpen = await probeSite(RL_SITE, rlFetch({ status: 200, ok: true, ms: 180, attempts: 1 }));
const rl500 = await probeSite(RL_SITE, rlFetch({ status: 500, ok: false, ms: 90, attempts: 1 }));
const rlDown = await probeSite(RL_SITE, rlFetch({ status: 0, ok: false, ms: 20_000, error: 'timeout', attempts: 3 }));
const rlBlocked = await probeSite(RL_SITE, rlFetch({ status: 403, ok: false, ms: 140, attempts: 1 }));

test('401 是中转口的预期答案，算活着而不是算失败', () => {
  assert.equal(rlKeyRequired.apiOk, true);
  assert.equal(rlKeyRequired.error, null);
  assert.equal(rlKeyRequired.latencyMs, 233);
  assert.equal(rlOpen.apiOk, true);
});
test('relay 探到的东西只有「活着 + 延迟」，其余字段一律留空', () => {
  assert.equal(rlKeyRequired.systemName, null);
  assert.equal(rlKeyRequired.version, null);
  assert.equal(rlKeyRequired.registerOpen, null);
  assert.equal(rlKeyRequired.checkinEnabled, null);
  assert.equal(rlKeyRequired.inviteeBonusUsd, null);
  assert.deepEqual(rlKeyRequired.models, []);
  assert.equal(rlKeyRequired.modelsSource, 'login-required');
  assert.equal(rlKeyRequired.pricingOk, false);
});
test('500 / 超时如实报错，403 留给 merge 判「被 WAF 拦」而不是在这里吞掉', () => {
  assert.equal(rl500.apiOk, false);
  assert.equal(rl500.error, 'HTTP 500');
  assert.equal(rlDown.apiOk, false);
  assert.equal(rlDown.error, 'timeout');
  assert.equal(rlBlocked.apiOk, false);
  assert.equal(rlBlocked.error, 'HTTP 403');
  assert.equal(looksFiltered({ ok: false, status: 403 }), true);
});
test('relay 快照字段集合与 New API 面板完全一致（否则 merge 会漏字段）', () => {
  assert.deepEqual(Object.keys(rlKeyRequired).sort(), Object.keys(blankSnapshot(RL_SITE, {})).sort());
});
test('panel 注册表里有 relay，缺省仍是 newapi', () => {
  assert.equal(PANELS.relay.name, 'probeRelay');
});

console.log('tabitoken：按次计费的 New API 站（model_price，不是倍率）');
/**
 * 2026-08-30 从 tabitoken.com 实测抓到的返回体（status 只留探测会读的字段）。
 * 这个站是「按次计费」的典型：quota_type=1 + model_price，model_ratio 与 completion_ratio 全是 0，
 * 倍率照抄接口就等于在页面上写「免费」，所以这里把 fixedPrice 钉死。
 */
const TB_SITE = {
  id: 'tabitoken',
  name: 'TaBiAI',
  panel: 'newapi',
  statusApi: 'https://tabitoken.com/api/status',
  pricingApi: 'https://tabitoken.com/api/pricing',
  credits: { signup: 100, invite: 20, dailyCheckin: null, approx: false },
};
const TB_STATUS = {
  success: true,
  data: {
    system_name: 'TaBiAI',
    version: 'init-20260817-f880a343',
    register_enabled: true,
    password_register_enabled: false,
    password_login_enabled: true,
    github_oauth: true,
    linuxdo_oauth: false,
    discord_oauth: false,
    telegram_oauth: false,
    wechat_login: false,
    oidc_enabled: false,
    passkey_login: false,
    checkin_enabled: true,
    quota_per_unit: 500000,
    turnstile_check: true,
    price: 7.3,
    announcements: [],
  },
};
const tbModel = (name, price) => ({
  model_name: name,
  quota_type: 1,
  model_ratio: 0,
  model_price: price,
  completion_ratio: 0,
  enable_groups: ['vip', 'default'],
  supported_endpoint_types: ['anthropic', 'openai'],
});
const TB_PRICING = {
  success: true,
  data: [
    tbModel('claude-opus-5-thinking', 0.8),
    tbModel('claude-opus-5', 0.8),
    tbModel('claude-opus-4-8', 0.5),
    tbModel('claude-opus-4-8-thinking', 0.5),
  ],
};
const tb = await probeSite(
  TB_SITE,
  vcFetch({
    'https://tabitoken.com/api/status': { ok: true, status: 200, ms: 431, json: TB_STATUS },
    'https://tabitoken.com/api/pricing': { ok: true, status: 200, ms: 288, json: TB_PRICING },
  }),
);

test('站名 / 版本 / 签到开关 / 登录方式 都按接口原样取到', () => {
  assert.equal(tb.apiOk, true);
  assert.equal(tb.pricingOk, true);
  assert.equal(tb.systemName, 'TaBiAI');
  assert.equal(tb.version, 'init-20260817-f880a343');
  assert.equal(tb.registerOpen, true);
  assert.equal(tb.passwordRegister, false); // 只能 GitHub 授权注册
  assert.equal(tb.checkinEnabled, true);
  assert.deepEqual(tb.loginMethods, ['GitHub', '账号密码']);
  assert.equal(tb.quotaPerUnit, 500000);
  assert.equal(tb.latencyMs, 431);
});
test('接口没给 quota_for_invitee → 邀请额度留 null，不拿 sites.json 的 $20 冒充探测值', () => {
  assert.equal(tb.inviteeBonusUsd, null);
  assert.equal(tb.inviterBonusUsd, null);
  assert.equal(creditPlan(TB_SITE, tb).apiInvite, null);
  assert.deepEqual(auditCredits([TB_SITE], { sites: [tb] }), []); // 拿不到实测值就不该报「不一致」
});
test('注册 $100 + 本页邀请 $20 = 首日 $120，签到金额未公示所以不进合计', () => {
  const p = creditPlan(TB_SITE, tb);
  assert.equal(p.firstDay, 120);
  assert.equal(usd(p.firstDay, p.approx), '$120');
  assert.equal(breakdown(p), '注册 $100 + 本页邀请 $20');
  assert.equal(p.daily, null);
  assert.equal(perDay(p), null);
});
test('4 个模型都是按次计价：fixedPrice 有值，per-1M 单价一律 null', () => {
  assert.equal(tb.models.length, 4);
  const byName = new Map(tb.models.map((m) => [m.name, m]));
  assert.deepEqual([...byName.keys()], ['claude-opus-4-8', 'claude-opus-4-8-thinking', 'claude-opus-5', 'claude-opus-5-thinking']);
  for (const [name, price] of [
    ['claude-opus-5', 0.8],
    ['claude-opus-5-thinking', 0.8],
    ['claude-opus-4-8', 0.5],
    ['claude-opus-4-8-thinking', 0.5],
  ]) {
    const m = byName.get(name);
    assert.equal(m.fixedPrice, price, name);
    assert.equal(m.inputPerMTok, null, name); // ratio 0 换算出的 $0 是假的，必须留空
    assert.equal(m.outputPerMTok, null, name);
    assert.equal(m.ratio, 0, name);
    assert.deepEqual(m.protocols, ['anthropic', 'openai'], name);
    assert.deepEqual(m.groups, ['vip', 'default'], name);
  }
});
test('示例配置的默认模型取版本最新的 opus-5，两个协议都不许退回字母序第一个', () => {
  assert.equal(tb.defaults.claude, 'claude-opus-5');
  // 全站只有 claude-*，OpenAI 协议没有 gpt 系可挑；兜底若用 models[0] 会得到 claude-opus-4-8
  assert.equal(tb.defaults.openai, 'claude-opus-5');
});
test('tabitoken 快照字段集合与面板骨架完全一致', () => {
  assert.deepEqual(Object.keys(tb).sort(), Object.keys(blankSnapshot(TB_SITE, {})).sort());
});

// 只有 /api/pricing 吃了 403（机房 IP 的常见样子），status 照常通
const tbPricingBlocked = await probeSite(
  TB_SITE,
  vcFetch({
    'https://tabitoken.com/api/status': { ok: true, status: 200, ms: 402, json: TB_STATUS },
    'https://tabitoken.com/api/pricing': { ok: false, status: 403, ms: 190, error: 'HTTP 403' },
  }),
);
const TB_OLD = { ...tb, checkedAt: iso(6 * HOUR), online: true, signup: { status: 200, ok: true, ms: 240 } };
const tbMerged = mergeSnapshot({ ...tbPricingBlocked, signup: { status: 200, ok: true, ms: 260 } }, TB_OLD);

test('pricing 被拦时，按次价格沿用旧快照而不是变成空表', () => {
  assert.equal(tbMerged.models.length, 4);
  assert.equal(tbMerged.models[0].name, 'claude-opus-4-8');
  assert.equal(tbMerged.models[0].fixedPrice, 0.5);
  assert.equal(tbMerged.modelsSource, 'cached');
  assert.equal(tbMerged.online, true);
  assert.equal(tbMerged.dataStale, true);
  assert.equal(tbMerged.staleFrom, TB_OLD.checkedAt);
});
test('合并后重算默认模型，仍然是 opus-5（merge 的兜底也不许退回字母序）', () => {
  assert.equal(tbMerged.defaults.claude, 'claude-opus-5');
  assert.equal(tbMerged.defaults.openai, 'claude-opus-5');
});

console.log('工具函数');
test('meaningful 认得空值', () => {
  for (const v of [null, undefined, '', '   ', [], {}, { a: null }]) assert.equal(meaningful(v), false, JSON.stringify(v));
  for (const v of [0, false, 'x', [1], { a: 1 }]) assert.equal(meaningful(v), true, JSON.stringify(v));
});
test('pickPreferred 按数字段比大小，不是字典序', () => {
  const ms = [{ name: 'claude-opus-4-8' }, { name: 'claude-opus-5' }, { name: 'claude-sonnet-4-5' }];
  assert.equal(pickPreferred(ms, /^claude/i), 'claude-opus-5');
  assert.equal(pickPreferred([], /^claude/i), null);
});

// Node 14 兼容：probeUrl 调用链里会用到 AbortSignal / Headers
if (typeof globalThis.AbortSignal === 'undefined') {
  globalThis.AbortSignal = class AbortSignal {
    constructor() { this.aborted = false; }
    static timeout() { return { aborted: false }; }
  };
}
if (typeof globalThis.Headers === 'undefined') {
  globalThis.Headers = function Headers() { return {}; };
}
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: new globalThis.Headers(), url: '' });
}
console.log('注册页探测（online 有一半靠它，不能被网络抖动带偏）');
// 前两次连接层面失败、第三次才通：本机与 CI 都见过，注册页不该因此判成 HTTP 0
let flakyCalls = 0;
const flakyProbe = await probeUrl('https://example.test/sign-up', {
  backoffMs: 0,
  fetchImpl: async () => {
    flakyCalls += 1;
    if (flakyCalls < 3) throw new Error('connect EADDRNOTAVAIL 198.18.0.5:443');
    return { status: 200, ok: true };
  },
});
// 服务器答话了就是答话了：403 是 looksFiltered 判「被拦而非下线」的依据，不许被重试抹掉
let blockedCalls = 0;
const blockedProbe = await probeUrl('https://example.test/sign-up', {
  backoffMs: 0,
  fetchImpl: async () => {
    blockedCalls += 1;
    return { status: 403, ok: false };
  },
});
let deadCalls = 0;
const deadProbe = await probeUrl('https://example.test/sign-up', {
  backoffMs: 0,
  fetchImpl: async () => {
    deadCalls += 1;
    throw new Error('getaddrinfo ENOTFOUND example.test');
  },
});
const emptyProbe = await probeUrl(null);

test('连接抖动会重试，第三次通了就算通', () => {
  assert.equal(flakyProbe.status, 200);
  assert.equal(flakyProbe.ok, true);
  assert.equal(flakyProbe.attempts, 3);
  assert.equal(flakyCalls, 3);
});
test('HTTP 403 原样返回且不重试，WAF 判定才不会被抹掉', () => {
  assert.equal(blockedProbe.status, 403);
  assert.equal(blockedProbe.ok, false);
  assert.equal(blockedCalls, 1);
  assert.equal(looksFiltered(blockedProbe), true);
});
test('真连不上才报 HTTP 0，且把重试次数用完', () => {
  assert.equal(deadProbe.status, 0);
  assert.equal(deadProbe.ok, false);
  assert.match(deadProbe.error, /ENOTFOUND/);
  assert.equal(deadCalls, 3);
});
test('没有 URL 就不探测', () => {
  // test() 是同步的，异步断言得在外面 await 好再进来
  assert.equal(emptyProbe, null);
});

// ──────────────────────────────────────────────────────────────────────
// 变动日志 / 历史 / 多页渲染
// ──────────────────────────────────────────────────────────────────────

/** 一份最小可用的快照，只带 diff 会看的字段 */
const snap = (over = {}) => ({
  id: 'agentrouter',
  online: true,
  probeBlocked: false,
  registerOpen: true,
  checkinEnabled: true,
  inviteeBonusUsd: 50,
  inviterBonusUsd: 50,
  models: [{ name: 'claude-opus-5', ratio: 1, inputPerMTok: 2, outputPerMTok: 10, protocols: ['Anthropic'] }],
  announcements: [],
  latencyMs: 300,
  checkedAt: iso(0),
  ...over,
});
const SITES_FIXTURE = [{ id: 'agentrouter', name: 'AgentRouter', credits: { signup: 100, invite: 50, dailyCheckin: 25 } }];
const D = (prev, next) => diffSite({ prev, next, site: SITES_FIXTURE[0], at: iso(0) });
const types = (events) => events.map((e) => e.type);

console.log('diff：只报会影响「值不值得注册」的变动');

test('每 6 小时都在动的字段不产生事件（延迟 / 探测时间 / 版本）', () => {
  assert.deepEqual(types(D(snap(), snap({ latencyMs: 999, checkedAt: iso(0), version: 'x' }))), []);
});
test('本次探测被 WAF 拦下时不报掉线：online 是沿用值，不是观测值', () => {
  assert.deepEqual(types(D(snap({ online: true }), snap({ online: false, probeBlocked: true }))), []);
});
test('上次被拦、这次探通了 → 如实报掉线，否则日志里会只有恢复没有掉线', () => {
  const prev = snap({ online: true, probeBlocked: true });
  const next = snap({ online: false, probeBlocked: false });
  assert.deepEqual(types(D(prev, next)), ['offline']);
});
test('掉线与恢复成对出现', () => {
  assert.deepEqual(types(D(snap({ online: false }), snap({ online: true }))), ['online']);
});
test('邀请注册额度变化算 major，邀请他人的奖励只算 minor', () => {
  const e1 = D(snap(), snap({ inviteeBonusUsd: 20 }));
  const e2 = D(snap(), snap({ inviterBonusUsd: 20 }));
  assert.equal(e1[0].type, 'invite_change');
  assert.equal(e1[0].severity, 'major');
  assert.equal(e2[0].type, 'inviter_change');
  assert.equal(e2[0].severity, 'minor');
});
test('接口没给邀请额度（null）不报「$50 → $null」这种假变动', () => {
  assert.deepEqual(types(D(snap(), snap({ inviteeBonusUsd: null }))), []);
});

test('模型上下线与价格变化都要认，按次计费的价格用「/ 次」口径', () => {
  const added = D(snap(), snap({ models: [...snap().models, { name: 'glm-5.3', ratio: 1 }] }));
  const gone = D(snap(), snap({ models: [] }));
  const priced = D(snap(), snap({ models: [{ name: 'claude-opus-5', inputPerMTok: 8, outputPerMTok: 40 }] }));
  assert.deepEqual(types(added), ['models_added']);
  assert.deepEqual(types(gone), ['models_removed']);
  assert.deepEqual(types(priced), ['price_change']);
  assert.match(priced[0].text, /\$2 入 \/ \$10 出（每 1M） → \$8 入 \/ \$40 出（每 1M）/);
  assert.equal(priceLabel({ fixedPrice: 0.3 }), '$0.3 / 次');
});
test('模型一次上十几个时标题不爆：超过 4 个折成「等 N 个」', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, ratio: 1 }));
  const e = D(snap({ models: [] }), snap({ models: many }));
  assert.match(e[0].text, /等 6 个/);
});
test('老公告不重复报，新公告截断到 140 字', () => {
  const old = { id: 1, text: '旧公告' };
  const long = { id: 2, text: '啊'.repeat(300) };
  assert.deepEqual(types(D(snap({ announcements: [old] }), snap({ announcements: [old] }))), []);
  const e = D(snap({ announcements: [old] }), snap({ announcements: [old, long] }));
  assert.deepEqual(types(e), ['announcement']);
  assert.ok(e[0].text.length <= 140 + 'AgentRouter 发了公告：'.length);
});
test('新站按 sites.json 的额度口径记一条收录事件，移除站点也记一条', () => {
  const added = diffSnapshots({ sites: [] }, { generatedAt: iso(0), sites: [snap()] }, SITES_FIXTURE);
  assert.deepEqual(types(added), ['site_added']);
  assert.equal(added[0].text, '新收录 AgentRouter：注册送 $100，邀请再加 $50，每日签到 $25');
  const removed = diffSnapshots({ sites: [snap()] }, { generatedAt: iso(0), sites: [] }, SITES_FIXTURE);
  assert.deepEqual(types(removed), ['site_removed']);
});
test('majorOnly 只放行值得发 Release 的类型', () => {
  const mixed = [...D(snap(), snap({ inviterBonusUsd: 20 })), ...D(snap(), snap({ inviteeBonusUsd: 20 }))];
  assert.deepEqual(types(majorOnly(mixed)), ['invite_change']);
});

console.log('history：可用性时间序列');

const DAY = 24 * HOUR;
const liveAt = (msAgo, over = {}) => ({
  generatedAt: iso(msAgo),
  sites: [{ id: 'agentrouter', online: true, probeBlocked: false, models: [{ name: 'm' }], latencyMs: 300, ...over }],
});
/** 6 小时一个点，攒 n 个 */
const seed = (n, over = () => ({})) => {
  let h = EMPTY_HISTORY;
  for (let i = n - 1; i >= 0; i -= 1) h = appendSample(h, liveAt(i * 6 * HOUR, over(i))).history;
  return h;
};

test('样本只留判断可用性必需的字段，被拦要如实标注', () => {
  const s = compact(liveAt(0, { online: true, probeBlocked: true }));
  assert.deepEqual(Object.keys(s.sites.agentrouter).sort(), ['blocked', 'latency', 'models', 'up']);
  assert.equal(s.sites.agentrouter.blocked, true);
});
test('同一个 generatedAt 只留一条：CI 重跑不该在历史里留重复点', () => {
  // 时间戳只取一次：liveAt(0) 调两次会差 1ms，那测的就不是「同一个 generatedAt」了，
  // 恰好跨过毫秒边界时这条会随机挂（实测约 5% 的运行），CI 的自动刷新会跟着变红
  const sample = liveAt(0);
  const one = appendSample(EMPTY_HISTORY, sample);
  const again = appendSample(one.history, sample);
  assert.equal(one.added, true);
  assert.equal(again.added, false);
  assert.equal(again.history.samples.length, 1);
});
test('样本按时间升序存，且按上限截断', () => {
  const h = seed(5);
  const ats = h.samples.map((s) => s.at);
  assert.deepEqual(ats, [...ats].sort());
  assert.equal(appendSample(seed(3), liveAt(0), { limit: 2 }).history.samples.length, 2);
});
test('样本不足一天（< 4 个点）时不给可用性百分比，页面据此说「样本还不够」', () => {
  assert.equal(uptime(seed(3), 'agentrouter', 7).enough, false);
  assert.equal(uptime(seed(8), 'agentrouter', 7).enough, true);
  assert.equal(uptime(seed(8), 'agentrouter', 7).percent, 100);
});
test('被拦的样本单独计数，不从在线数里扣', () => {
  const h = seed(8, (i) => (i < 2 ? { probeBlocked: true } : {}));
  const u = uptime(h, 'agentrouter', 7);
  assert.equal(u.blocked, 2);
  assert.equal(u.up, 8);
});
test('没有样本的那天 total = 0，状态页画成空档而不是掉线', () => {
  const days = byDay(appendSample(EMPTY_HISTORY, liveAt(3 * DAY)).history, 'agentrouter', 7);
  assert.equal(days.length, 7);
  assert.equal(days.filter((d) => d.total === 0).length, 6);
  assert.equal(days.filter((d) => d.total > 0)[0].ratio, 1);
});
test('没这个站的历史时不报错，返回空口径', () => {
  const u = uptime(seed(8), 'not-exists', 7);
  assert.deepEqual([u.total, u.ratio, u.percent, u.enough], [0, null, null, false]);
  assert.deepEqual(coverage(EMPTY_HISTORY), { samples: 0, from: null, to: null, days: 0 });
});

console.log('changelog / Atom：订阅出口');

const META = {
  title: 'AI 福利站 · Claude Code / Codex 免费额度白嫖导航',
  tagline: '免费额度合集',
  keywords: ['claude code'],
  repoUrl: 'https://github.com/Q-shuang-dot/ai-coding-welfare',
  pagesUrl: 'https://q-shuang-dot.github.io/ai-coding-welfare/',
};
const EVENTS = [
  { at: '2026-08-30T08:56:00.000Z', siteId: 'rawchat', type: 'online', severity: 'major', text: 'RawChat 恢复在线' },
  { at: '2026-08-26T11:42:00.000Z', siteId: 'agentrouter', type: 'price_change', severity: 'major', text: '价格变了 <b>' },
];
const GROUPS = groupByDay(EVENTS);

test('按天分组：天倒序、天内也倒序', () => {
  assert.deepEqual(GROUPS.map((g) => g.date), ['2026-08-30', '2026-08-26']);
  assert.deepEqual(GROUPS[0].events.map((e) => e.siteId), ['rawchat']);
  assert.equal(GROUPS[0].updated, '2026-08-30T08:56:00.000Z');
});
test('Atom 一天一条 entry，不是一条事件一条推送（6 小时一次会淹掉订阅者）', () => {
  const xml = renderAtom({ meta: META, groups: GROUPS, updated: EVENTS[0].at });
  assert.equal(xml.match(/<entry>/g).length, 2);
  assert.match(xml, /<title>2026-08-30 · 1 项变动<\/title>/);
  assert.match(xml, /<id>tag:q-shuang-dot\.github\.io,2026-08-30:changelog<\/id>/);
});
test('Atom 正文里的 HTML 必须转义，否则 feed 是坏的 XML', () => {
  const xml = renderAtom({ meta: META, groups: GROUPS, updated: EVENTS[1].at });
  assert.ok(!/<b>/.test(xml));
  assert.match(xml, /&lt;b&gt;/);
});
test('空日志也能生成合法 feed', () => {
  const xml = renderAtom({ meta: META, groups: [], updated: null });
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.ok(!/<entry>/.test(xml));
});
test('Release 标题一句话概括，多条时带「另有 N 项」', () => {
  assert.equal(summarize([EVENTS[0]]), 'RawChat 恢复在线');
  assert.match(summarize(EVENTS), /（另有 1 项变动）$/);
  assert.equal(summarize([]), '没有变动');
  assert.equal(icon('offline'), '🔴');
  assert.equal(icon('unknown_type'), '·');
});

console.log('落地页：按次 vs 按量折算、结构化数据、转义');

const SITE = {
  id: 'demo',
  name: 'Demo 站',
  subtitle: '注册送额度的示例站',
  signupUrl: 'https://demo.test/register?aff=abc',
  recommended: true,
  tags: ['GitHub 登录'],
  credits: { signup: 100, invite: 20 },
  endpoints: { anthropic: 'https://demo.test', openai: 'https://demo.test/v1' },
  highlights: ['额度大方'],
  caveats: ['规则随时变'],
};
const FIXED_SNAP = {
  id: 'demo',
  online: true,
  probeBlocked: false,
  checkedAt: iso(0),
  models: [
    { name: 'claude-opus-5', fixedPrice: 0.3, protocols: ['Anthropic'] },
    { name: 'claude-haiku', fixedPrice: 0.1, protocols: ['Anthropic'] },
  ],
  defaults: { claude: 'claude-opus-5', openai: 'gpt-5.6' },
};
const TOKEN_SNAP = {
  ...FIXED_SNAP,
  models: [{ name: 'claude-opus-5', ratio: 1, inputPerMTok: 2, outputPerMTok: 10, protocols: ['Anthropic'] }],
};
const LIVE = { generatedAt: iso(0), sites: [FIXED_SNAP] };
const HIST = seed(8);
/** 把页面里的所有 JSON-LD 抠出来解析：坏掉的结构化数据在浏览器里是静默失效的 */
const jsonLd = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('按次计费用站内单价折算，按量计费按 15k 入 / 2k 出折算，两者落到同一个单位', () => {
  const fixed = estimateTurns(SITE, FIXED_SNAP);
  const token = estimateTurns(SITE, TOKEN_SNAP);
  // 首日 $120：按次挑最便宜的 $0.1 → 1200 次；按量 (2×15000 + 10×2000)/1M = $0.05 → 2400 次
  assert.deepEqual([fixed.billing, fixed.per, fixed.turns], ['按次', 0.1, 1200]);
  assert.deepEqual([token.billing, token.per, token.turns], ['按量', 0.05, 2400]);
});
test('积分站没有公开换算，不参与折算（宁可留空也不编数字）', () => {
  assert.equal(estimateTurns({ ...SITE, credits: { invite: 600, unit: 'point' } }, TOKEN_SNAP), null);
  assert.equal(estimateTurns(SITE, { ...FIXED_SNAP, models: [] }), null);
});

test('每一页的 JSON-LD 都必须是合法 JSON，且带面包屑', () => {
  const pages = [
    renderSitePage({ meta: META, site: SITE, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] }),
    renderComparePage({ meta: META, sites: [SITE], live: LIVE, css: '' }),
    renderStatusPage({ meta: META, sites: [SITE], live: LIVE, css: '', history: HIST }),
    renderChangelogPage({ meta: META, groups: GROUPS, live: LIVE, css: '' }),
    renderHtml({ meta: META, sites: [SITE], live: LIVE, css: '', groups: GROUPS, history: HIST }),
  ];
  for (const html of pages) {
    const blobs = jsonLd(html);
    assert.ok(blobs.length, 'JSON-LD 缺失');
    assert.match(html, /<link rel="canonical"/);
    assert.match(html, /rel="alternate" type="application\/atom\+xml"/);
  }
  const types = jsonLd(pages[0])[0].map((x) => x['@type']);
  assert.deepEqual(types, ['BreadcrumbList', 'FAQPage']);
});
test('数据里的 HTML / 引号不许原样进页面（sites.json 是手工维护的，迟早会有尖括号）', () => {
  const evil = { ...SITE, name: '<img src=x onerror=alert(1)>', subtitle: '带"引号"的副标题' };
  const html = renderSitePage({ meta: META, site: evil, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] });
  assert.ok(!/<img src=x/.test(html));
  assert.match(html, /&lt;img src=x/);
});
test('JSON-LD 里的 </script> 要被打断，否则脚本块提前闭合、整页结构化数据失效', () => {
  const evil = { ...SITE, subtitle: '收工 </script><script>alert(1)</script>' };
  const html = renderSitePage({ meta: META, site: evil, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] });
  const ld = html.slice(html.indexOf('application/ld+json'), html.indexOf('</script>', html.indexOf('application/ld+json')));
  assert.ok(!ld.includes('</script>'));
  assert.equal(jsonLd(html).length, 1);
});
test('站点详情页给得出可复制的两套配置，Anthropic 的 Base URL 不带 /v1', () => {
  const html = renderSitePage({ meta: META, site: SITE, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] });
  assert.match(html, /export ANTHROPIC_BASE_URL=https:\/\/demo\.test\n/);
  assert.match(html, /ANTHROPIC_MODEL=claude-opus-5/);
  // config.toml 是写在 HTML 里的，引号已经被转义成 &quot;，这里按渲染后的样子断言
  assert.match(html, /base_url = &quot;https:\/\/demo\.test\/v1&quot;/);
  assert.match(html, /wire_api = &quot;chat&quot;/);
  assert.equal(html.match(/<button class="copy"/g).length, 2);
});
test('状态页把「没样本」和「掉线」画成两种格子', () => {
  const sparse = appendSample(EMPTY_HISTORY, liveAt(2 * DAY, { id: 'demo' })).history;
  const html = renderStatusPage({ meta: META, sites: [SITE], live: LIVE, css: '', history: sparse });
  assert.match(html, /class="bar nodata"/);
});
test('首页把 6 个站点写进 ItemList，每项指向自己的详情页', () => {
  const html = renderHtml({ meta: META, sites: [SITE], live: LIVE, css: '', groups: GROUPS, history: HIST });
  const list = jsonLd(html)[0].find((x) => x['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, 1);
  assert.equal(list.itemListElement[0].url, `${META.pagesUrl}sites/demo/`);
  assert.match(html, /href="sites\/demo\/"/);
});

console.log('停注：站点还在跑但不收新用户，页面不许继续吆喝额度');

const SHUT_SNAP = { ...FIXED_SNAP, registerOpen: false, passwordRegister: false, loginMethods: ['GitHub'] };
const OAUTH_SNAP = { ...FIXED_SNAP, registerOpen: true, passwordRegister: false, loginMethods: ['GitHub', '账号密码'] };
const OPEN_SNAP = { ...FIXED_SNAP, registerOpen: true, passwordRegister: true, loginMethods: ['GitHub', '账号密码'] };

test('总闸关了是「暂停注册」，只关邮箱注册是「仅 GitHub 注册」，两者不能混为一谈', () => {
  assert.equal(signupRoute(SHUT_SNAP).state, 'closed');
  assert.equal(signupRoute(OAUTH_SNAP).state, 'oauth');
  assert.equal(signupRoute(OAUTH_SNAP).short, '仅 GitHub 注册');
  assert.equal(signupRoute(OPEN_SNAP).state, 'open');
  // 账号密码不是 OAuth 通道，不能出现在「仅 X 注册」里
  assert.deepEqual(signupRoute(OAUTH_SNAP).oauth, ['GitHub']);
});
test('接口没给 register_enabled（旧版面板）就什么都不声称', () => {
  const r = signupRoute(FIXED_SNAP);
  assert.deepEqual([r.state, r.short, r.note], ['unknown', null, null]);
  assert.equal(acceptsNew(FIXED_SNAP), true, '拿不到字段不等于停注');
  assert.equal(acceptsNew(SHUT_SNAP), false);
});
test('停注的站点不算进「全注册能拿多少」，否则是虚报', () => {
  const shutLive = { generatedAt: iso(0), sites: [{ ...SHUT_SNAP, id: 'demo' }] };
  const openLive = { generatedAt: iso(0), sites: [{ ...OPEN_SNAP, id: 'demo' }] };
  const shutHtml = renderHtml({ meta: META, sites: [SITE], live: shutLive, css: '', groups: [], history: HIST });
  const openHtml = renderHtml({ meta: META, sites: [SITE], live: openLive, css: '', groups: [], history: HIST });
  assert.match(openHtml, /首日最高 <b>\$120<\/b>/);
  assert.doesNotMatch(shutHtml, /首日最高/, '唯一的站停注了，就不该再有「首日最高」这个数');
  assert.match(shutHtml, /可注册 <b>0\/1<\/b>/);
  // 卡片留在页面上（老用户还用得着），但额度划掉、主按钮降级
  assert.match(shutHtml, /class="row[^"]*shut"/);
  assert.match(shutHtml, /<b class="struck">\$120<\/b>/);
  assert.doesNotMatch(shutHtml, /免费注册 Demo 站/);
});
test('停注的站不参与「最耐用」排序，README 里额度划掉、状态写停注', () => {
  const shutLive = { generatedAt: iso(0), sites: [{ ...SHUT_SNAP, id: 'demo' }] };
  const cmp = renderComparePage({ meta: META, sites: [SITE], live: shutLive, css: '' });
  assert.doesNotMatch(cmp, /最耐用 <b>/, '唯一候选停注了就没有「最划算」的答案');
  assert.match(cmp, /<tr class="shut">/);
  const md = renderReadme({ meta: META, sites: [SITE], live: shutLive, groups: [], history: HIST });
  assert.match(md, /🟡 停注/);
  assert.match(md, /~~\$120~~/);
  assert.match(md, /已停注 · 仍可打开/);
  assert.doesNotMatch(md, /全注册一遍/, '没有还收人的站时不该给合计');
});
test('邀请码要手填的站才出「邀请码」列，且写清 — 不等于没有邀请额度', () => {
  const live = { generatedAt: iso(0), sites: [{ id: 'demo', online: true, registerOpen: true }] };
  const plain = renderReadme({ meta: META, sites: [SITE], live, groups: [], history: HIST });
  assert.doesNotMatch(plain, /\| 邀请码 \|/, '没有站需要手填时不该多出一个空列');

  const coded = { ...SITE, inviteCode: 'zMRe' };
  const md = renderReadme({ meta: META, sites: [coded], live, groups: [], history: HIST });
  assert.match(md, /\| 模型 \| 注册 \| 邀请码 \|/, '邀请码列排在最后');
  assert.match(md, /`zMRe` \|$/m);
  assert.match(md, /注册表单里有一栏要\*\*自己填\*\*/);
  // 表头、分隔行、数据行的列数必须一致，否则 GitHub 上整张表会散架
  const [head, sep, row] = md.split('\n').filter((l) => l.startsWith('| ')).slice(0, 3);
  const cols = (l) => l.split('|').length;
  assert.equal(cols(head), cols(sep));
  assert.equal(cols(head), cols(row));
});
test('停注变动进日志时带上接口口径，别让人以为是我们猜的', () => {
  const [ev] = D({ ...snap(), registerOpen: true }, { ...snap(), registerOpen: false });
  assert.equal(ev.type, 'register_closed');
  assert.match(ev.text, /register_enabled=false/);
  assert.match(ev.text, /老用户不受影响/);
  assert.equal(ev.severity, 'major', '停注必须能触发 Release / 推送');
});

console.log('安全：出网协议与 Telegram 转义（issue #3 的安全报告）');
let blockedFetchCalls = 0;
const httpJson = await fetchJson('http://example.test/api/status');
const fileProbe = await probeUrl('file:///etc/passwd', {
  fetchImpl: async () => {
    blockedFetchCalls += 1;
    return { status: 200, ok: true };
  },
});

test('sites.json 里的 URL 只允许 https，file: / http: / 垃圾串一律不出网', () => {
  assert.equal(isHttpsUrl('https://example.test/a'), true);
  assert.equal(isHttpsUrl('http://example.test/a'), false);
  assert.equal(isHttpsUrl('file:///etc/passwd'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl('//example.test/a'), false);
  assert.equal(isHttpsUrl(''), false);
  assert.equal(isHttpsUrl(null), false);
});
test('非 https 在 fetchJson / probeUrl 里就被挡下，根本不发请求', () => {
  assert.equal(httpJson.ok, false);
  assert.match(httpJson.error, /https/);
  assert.equal(fileProbe.ok, false);
  assert.equal(blockedFetchCalls, 0, '被挡住的 URL 不该真的发出去');
});
test('Telegram 正文把双引号也转义掉，别让人从 href="…" 里逃出去', () => {
  const t = telegramText({
    meta: { title: 'T', pagesUrl: 'https://ok.test/', repoUrl: 'https://ok.test/r" onmouseover="x' },
    events: [],
  });
  assert.match(t, /&quot; onmouseover=&quot;x/, '引号必须变成实体');
  assert.ok(!t.includes('" onmouseover="'), '属性值里不许留活引号');
  assert.equal((t.match(/<a href="/g) ?? []).length, 2, '还是两个链接，没被撑出第三个属性');
});
test('Telegram 正文里的 < > & 照常转义，且不多转 &apos;（Telegram 不认这个实体）', () => {
  const t = telegramText({
    meta: { title: 'A & B', pagesUrl: 'https://ok.test/', repoUrl: 'https://ok.test/r' },
    events: [{ type: 'site_added', text: `<b>x</b> & it's` }],
    icon: () => '🆕',
  });
  assert.match(t, /A &amp; B/);
  assert.match(t, /&lt;b&gt;x&lt;\/b&gt; &amp; it's/);
  assert.ok(!t.includes('&apos;'));
});
test('超过 12 条折成「另有 N 项」，6 小时一次不该把频道刷满', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ type: 'online', text: `e${i}` }));
  const t = telegramText({
    meta: { title: 'T', pagesUrl: 'https://ok.test/', repoUrl: 'https://ok.test/r' },
    events: many,
    icon: () => '🟢',
  });
  assert.match(t, /另有 3 项/);
  assert.equal((t.match(/^🟢 e\d+$/gm) ?? []).length, 12);
});

console.log(`\n${process.exitCode ? '✘ 有用例失败' : `✔ 全部通过（${passed} 项）`}`);
