/**
 * 从两份 live.json 快照里提取「用户真会关心的变动」。
 *
 * 为什么不做通用 deep diff：快照里一半字段每 6 小时都在动（checkedAt / latencyMs /
 * version / 探测错误），全量 diff 出来的 99% 是噪声，日志一噪声化就没人订阅了。
 * 这里只认会改变「值不值得注册」的字段：在线、注册开关、签到、邀请额度、
 * 模型清单与价格，外加站点自己发的公告。
 *
 * 两条防误报规则，和 merge.mjs 是同一个教训：
 *   - 探测被 WAF 拦下（probeBlocked）那一次的 online 是沿用的旧值，不据此报在线变化——
 *     机房 IP 被拦不等于站点掉线，报了就是天天喊狼来了，真掉线时也没人信了
 *   - 内容字段沿用旧值时两边本来就相等，不会产生事件，不需要额外判断
 */
import { usd, DEFAULT_UNIT } from './credits.mjs';

/**
 * 数字字段取值。
 * 注意 Number(null) === 0：接口这次没给邀请额度（null）时若当成 0，就会报出
 * 「邀请额度 $50 → $0」再「$0 → $50」这种纯属误报的一对事件——回填历史时真踩过。
 * 拿不到值就是拿不到值，返回 null 让调用方跳过。
 */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 值得发 Release / 推送通知的事件类型；其余只进日志页 */
export const MAJOR = new Set([
  'site_added',
  'site_removed',
  'offline',
  'online',
  'invite_change',
  'register_closed',
  'register_open',
  'checkin_on',
  'checkin_off',
  'models_added',
  'models_removed',
  'price_change',
]);

/** 按次计费的模型没有倍率，价格口径和 render-* 保持一致，别在日志里换一套说法 */
export function priceLabel(m) {
  if (!m) return '—';
  if (m.fixedPrice != null) return `$${m.fixedPrice} / 次`;
  const hasTok = m.inputPerMTok != null || m.outputPerMTok != null;
  if (hasTok) return `$${m.inputPerMTok ?? '—'} 入 / $${m.outputPerMTok ?? '—'} 出（每 1M）`;
  return m.ratio != null ? `倍率 ${m.ratio}` : '—';
}

const priceKey = (m) => [m?.fixedPrice ?? '', m?.inputPerMTok ?? '', m?.outputPerMTok ?? '', m?.ratio ?? ''].join('|');

/** 模型一次上下线十几个是常态，全列出来标题就爆了 */
const listNames = (names, cap = 4) =>
  names.length <= cap ? names.join('、') : `${names.slice(0, cap).join('、')} 等 ${names.length} 个`;

const modelMap = (snap) => new Map((snap?.models ?? []).map((m) => [m.name, m]));

/** 单个站点前后两次快照的差异 */
export function diffSite({ prev, next, site, at }) {
  const events = [];
  if (!prev || !next) return events;

  const siteId = next.id ?? prev.id;
  const siteName = site?.name ?? siteId;
  const push = (type, text) =>
    events.push({ at, siteId, siteName, type, text, severity: MAJOR.has(type) ? 'major' : 'minor' });

  // 在线状态：只有「本次探测真的跑通了」才敢报翻转。
  // probeBlocked 时 online 是 merge.mjs 沿用的旧值、不是观测值，拿它报事件就是喊狼来了；
  // 反过来，上一次被拦、这一次探通了，那这一次的结果是可信的，该报——否则会出现
  // 「恢复在线」三次却一次掉线都没有的日志，读起来像 bug。
  if (next.probeBlocked !== true && Boolean(prev.online) !== Boolean(next.online)) {
    if (next.online) push('online', `${siteName} 恢复在线`);
    else push('offline', `${siteName} 探测不到了：注册页与公开接口都没响应`);
  }

  // 注册开关是订阅者最在意的一条：停注意味着页面上那个「首日可得 $120」对新人已经不成立。
  // 措辞里带上接口口径，免得被当成我们自己猜的（判定逻辑见 lib/signup.mjs）
  if (prev.registerOpen === true && next.registerOpen === false) {
    push('register_closed', `${siteName} 关闭了新用户注册（接口 register_enabled=false，老用户不受影响）`);
  }
  if (prev.registerOpen === false && next.registerOpen === true) push('register_open', `${siteName} 重新开放注册`);

  if (prev.checkinEnabled === false && next.checkinEnabled === true) push('checkin_on', `${siteName} 开启了每日签到`);
  if (prev.checkinEnabled === true && next.checkinEnabled === false) push('checkin_off', `${siteName} 关闭了每日签到`);

  const invA = num(prev.inviteeBonusUsd);
  const invB = num(next.inviteeBonusUsd);
  if (invA != null && invB != null && invA !== invB) {
    push('invite_change', `${siteName} 邀请注册额度 $${invA} → $${invB}`);
  }

  const irA = num(prev.inviterBonusUsd);
  const irB = num(next.inviterBonusUsd);
  if (irA != null && irB != null && irA !== irB) {
    push('inviter_change', `${siteName} 邀请他人的奖励 $${irA} → $${irB}`);
  }

  const A = modelMap(prev);
  const B = modelMap(next);
  const added = [...B.keys()].filter((k) => !A.has(k));
  const removed = [...A.keys()].filter((k) => !B.has(k));
  if (added.length) push('models_added', `${siteName} 上线模型：${listNames(added)}`);
  if (removed.length) push('models_removed', `${siteName} 下线模型：${listNames(removed)}`);
  for (const [name, m] of B) {
    const old = A.get(name);
    if (old && priceKey(old) !== priceKey(m)) {
      push('price_change', `${siteName} ${name} 价格 ${priceLabel(old)} → ${priceLabel(m)}`);
    }
  }

  const seen = new Set((prev.announcements ?? []).map((a) => String(a.id ?? a.text)));
  for (const a of next.announcements ?? []) {
    if (seen.has(String(a.id ?? a.text))) continue;
    const text = String(a.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (text) push('announcement', `${siteName} 发了公告：${text}`);
  }

  return events;
}

/**
 * 两份完整快照之间的全部变动。
 * sites 传 data/sites.json 的 sites 数组，只用来取展示名与新站的额度口径。
 */
export function diffSnapshots(prevLive, nextLive, sites = []) {
  const at = nextLive?.generatedAt ?? new Date().toISOString();
  const meta = new Map(sites.map((s) => [s.id, s]));
  const A = new Map((prevLive?.sites ?? []).map((s) => [s.id, s]));
  const B = new Map((nextLive?.sites ?? []).map((s) => [s.id, s]));
  const events = [];

  for (const [id, next] of B) {
    const site = meta.get(id);
    if (!A.has(id)) {
      const c = site?.credits ?? {};
      // 单位一律走 credits.mjs 的 usd()：站内积分、站内刀都不是美元，这里自己拼 $ 就会写出假数字
      const amount = (n) => usd(n, false, c.unit ?? DEFAULT_UNIT);
      const bits = [
        c.signup ? `注册送 ${amount(c.signup)}` : null,
        c.invite ? `邀请再加 ${amount(c.invite)}` : null,
        c.dailyCheckin ? `每日签到 ${amount(c.dailyCheckin)}` : null,
        c.dailyQuota ? `每日额度池 ${amount(c.dailyQuota)}` : null,
      ].filter(Boolean);
      events.push({
        at,
        siteId: id,
        siteName: site?.name ?? id,
        type: 'site_added',
        severity: 'major',
        text: `新收录 ${site?.name ?? id}${bits.length ? `：${bits.join('，')}` : ''}`,
      });
      continue;
    }
    events.push(...diffSite({ prev: A.get(id), next, site, at }));
  }

  for (const [id] of A) {
    if (B.has(id)) continue;
    events.push({
      at,
      siteId: id,
      siteName: meta.get(id)?.name ?? id,
      type: 'site_removed',
      severity: 'major',
      text: `移除收录 ${meta.get(id)?.name ?? id}`,
    });
  }

  return events;
}

export const majorOnly = (events) => events.filter((e) => e.severity === 'major');
