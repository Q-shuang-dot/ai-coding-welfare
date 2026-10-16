/**
 * 额度口径的唯一出处。
 *
 * 站点接口只暴露「邀请额度」（quota_for_invitee），注册基础额度和签到额度是站内公示、
 * 接口拿不到，只能登记在 data/sites.json 的 credits 里。页面上要展示的是用户实际关心的
 * 「首日能拿多少」= 注册 + 邀请 + 首次签到，所以统一在这里算，避免三个渲染器各写一套。
 *
 * 两种「每天」是不一样的东西，必须分开登记：
 *   dailyCheckin —— 签到领的额度，领了就存着，越签越多（AgentRouter / JustDoWork）
 *   dailyQuota   —— 每天重置的额度池，当天用不完清零、不累积（RawChat 这类 Codex 公益站）
 * 首日拿到手的都是这个数，但「之后每天」的措辞不能混，否则等于夸大额度。
 *
 * 计价单位也不是只有美元：Matrix 这类平台发的是站内积分，积分与美元的换算关系
 * 站方没公开，所以只能按各站自己的单位显示，跨站合计（首日最高 / 全注册约多少）
 * 一律只算美元站，见 usdTotals——把积分和美元加在一起就是编数字。
 * 同理，DoCode 这类站虽然也写「刀」，但它的刀是站内计价单位（充值比例 1 元 = 50 刀），
 * 和按 ¥7.3 ≈ $1 发额度的站不是一个量级，登记成 site-usd 一样排除在合计之外。
 */
import { pack, unitStyle, DEFAULT_LANG } from './i18n.mjs';

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

export const DEFAULT_UNIT = 'usd';

export const KNOWN_UNITS = ['usd', 'point', 'site-usd', 'free'];

export function creditPlan(site, snap) {
  const c = site?.credits ?? {};
  const signup = num(c.signup);
  const invite = num(c.invite);
  const realNameBonus = num(c.realNameBonus);
  const checkin = num(c.dailyCheckin);
  const pool = num(c.dailyQuota);
  const approx = Boolean(c.approx);
  const unit = c.unit ?? DEFAULT_UNIT;
  const free = Boolean(c.free);

  // 一个站点只会是「签到累积」或「每日重置」中的一种；两个都填时以签到为准，交给 auditCredits 告警
  const daily = checkin ?? pool;
  const resets = checkin == null && pool != null;

  let firstDay, firstUnit, sources, base;
  if (free) {
    firstDay = 0;
    firstUnit = 'free';
    sources = 1;
    base = null;
  } else {
    const parts = [signup, invite].filter((n) => n != null);
    base = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
    firstDay = base != null || daily != null ? (base ?? 0) + (realNameBonus ?? 0) + (daily ?? 0) : null;
    firstUnit = unit;
    sources = [signup, invite, realNameBonus, daily].filter((n) => n != null).length;
  }

  return {
    name: site?.name ?? null,
    unit: firstUnit,
    signup,
    invite,
    realNameBonus,
    daily,
    resets,
    approx,
    base,
    sources,
    firstDay,
    // 接口实测的邀请额度，用来和登记值对账（build 时不一致会告警）
    apiInvite: snap?.inviteeBonusUsd ?? null,
    inviter: snap?.inviterBonusUsd ?? null,
  };
}

/** $175 / ≈$92 / 600 积分 / 免费 */
export function usd(n, approx = false, unit = DEFAULT_UNIT, lang = DEFAULT_LANG) {
  if (n == null) return null;
  if (unit === 'free') return pack(lang).credit.free;
  const { prefix, suffix } = unitStyle(unit, lang);
  return `${approx ? '≈' : ''}${prefix}${n}${suffix}`;
}

/** 「之后每天」列：签到是往账户里加，额度池是每天重置回同一个数 */
export function perDay(plan, lang = DEFAULT_LANG) {
  if (plan.daily == null) return null;
  return pack(lang).credit.perDay(usd(plan.daily, plan.approx, plan.unit, lang), plan.resets);
}

/** 「注册 $100 + 本页邀请 $50 + 首签 $25」／「每日额度池 $50（每天重置，不累积）」 */
export function breakdown(plan, lang = DEFAULT_LANG) {
  const t = pack(lang).credit;
  const items = [
    plan.signup != null ? t.breakdownSignup(usd(plan.signup, false, plan.unit, lang)) : null,
    plan.invite != null ? t.breakdownInvite(usd(plan.invite, false, plan.unit, lang)) : null,
    plan.realNameBonus != null ? t.breakdownRealName(usd(plan.realNameBonus, false, plan.unit, lang)) : null,
    plan.daily != null
      ? (plan.resets ? t.breakdownPool : t.breakdownCheckin)(usd(plan.daily, plan.approx, plan.unit, lang))
      : null,
  ].filter(Boolean);
  if (items.length > 1) return items.join(' + ');
  if (items.length !== 1) return null;
  // 只有一项时也要把这一项说清楚：额度池的关键信息是「不累积」，
  // 只有邀请额度的站点则要让人看见「这笔钱全靠邀请链接」，比留个「—」有用
  return plan.resets ? `${items[0]}${t.poolSuffix}` : items[0];
}

/**
 * 跨站合计：只统计以美元公示额度的站点。
 * 积分站单独列在 others 里，由渲染器按自己的单位另说一句，
 * 绝不把 600 积分和 $175 加成 $775。
 */
export function usdTotals(plans) {
  const inUsd = plans.filter((p) => p.unit === DEFAULT_UNIT);
  return {
    count: inUsd.length,
    best: Math.max(0, ...inUsd.map((p) => p.firstDay ?? 0)),
    total: inUsd.reduce((sum, p) => sum + (p.firstDay ?? 0), 0),
    resetting: inUsd.some((p) => p.resets),
    others: plans.filter((p) => p.unit !== DEFAULT_UNIT && p.firstDay != null),
  };
}

/** 「Matrix 另发 600 积分」——合计里装不下的单位，如实单独说一句 */
export function othersNote(others, lang = DEFAULT_LANG, nameOf = (p) => p.name) {
  if (!others?.length) return null;
  const t = pack(lang).credit;
  return others
    .map((p) => t.othersItem(nameOf(p) ?? pack(lang).common.unknown, usd(p.firstDay, p.approx, p.unit, lang)))
    .join(t.othersJoin);
}

/** 登记值与接口实测值不一致时提醒维护者更新，别让页面上的数字烂掉 */
export function auditCredits(sites, live) {
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  const warns = [];
  for (const site of sites) {
    const plan = creditPlan(site, byId.get(site.id));
    // 接口实测值是美元口径（New API 的 quota_for_invitee），只能和美元站对账
    if (plan.unit === DEFAULT_UNIT && plan.invite != null && plan.apiInvite != null && plan.invite !== plan.apiInvite) {
      warns.push(
        `${site.name}：sites.json 登记邀请额度 ${usd(plan.invite)}，但站点接口现在返回 ${usd(plan.apiInvite)}`,
      );
    }
    if (!KNOWN_UNITS.includes(plan.unit)) {
      warns.push(`${site.name}：credits.unit = ${plan.unit} 不在已知单位（${KNOWN_UNITS.join(' / ')}）里，页面会原样显示单位名`);
    }
    if (site.credits?.dailyCheckin && site.credits?.dailyQuota) {
      warns.push(`${site.name}：dailyCheckin 与 dailyQuota 同时填了，两者口径不同，请只留一个`);
    }
    if (plan.firstDay == null) warns.push(`${site.name}：credits 没填，页面只能显示「站内公示」`);
  }
  return warns;
}
