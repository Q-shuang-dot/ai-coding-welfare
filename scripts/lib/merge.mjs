/**
 * 把「这一次的探测结果」和「上一次的快照」合成一条站点数据。
 *
 * 为什么需要它：公益站前面普遍挂 Cloudflare，CI 的机房 IP 偶发拿到挑战页，
 * 一次失败就会把 systemName / 邀请额度 / 模型清单全清成 null，
 * 页面随即退化成「🔴 异常 + 登录后台查看」。这里做字段级合并：
 *   - 探测元信息（时间、延迟、错误）永远用新值
 *   - 内容字段只在「这次真的探到了」时才覆盖旧值
 *   - online 以注册页可访问性为准：接口被拦不等于站点挂了
 *   - 整站都把机房 IP 拦掉（403 / 429 / 挑战页）时，沿用上一次的在线判定，
 *     并标 probeBlocked；但只在上次成功探测还新鲜（48 小时内）时这么做，
 *     否则就如实标异常——不能拿「可能是被拦」永久掩盖真的关站
 *   - staleFrom 是粘性的：连续失败时不跟着 checkedAt 往后跑，
 *     它回答的是「页面上这些内容最晚是什么时候抓到的」
 */
import { pickPreferred, looksFiltered, STALE_WARN_HOURS } from './newapi.mjs';

/** 探测结果本身，必须反映这一次的真实情况，不能沿用旧值 */
export const FRESH_ALWAYS = new Set([
  'id',
  'checkedAt',
  'apiOk',
  'pricingOk',
  'latencyMs',
  'error',
  'signup',
  'mirrors',
]);

/** 值是否「有内容」：null / '' / [] / 全空对象都算没抓到 */
export function meaningful(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'object') return Object.values(v).some(meaningful);
  return true;
}

/** fetchJson 把 HTTP 错误写成 `HTTP 403`，这里还原出状态码好判断是不是被过滤 */
const statusFromError = (error) => Number(/^HTTP (\d{3})$/.exec(error ?? '')?.[1]) || null;

/**
 * 这一次的失败看起来是「被拦」而不是「站点挂了」吗。
 * 要求所有失败的探测都是被过滤的样子——只要有一个是超时 / 连不上 / 502，
 * 那就是真有问题，不能拿「大概是被拦了」糊过去。
 */
export function probeFiltered(fresh) {
  const api = { ok: fresh.apiOk, status: statusFromError(fresh.error) ?? 200, error: fresh.error };
  const failures = [api, fresh.signup].filter((r) => r && !r.ok);
  return failures.length > 0 && failures.every(looksFiltered);
}

const hoursSince = (iso) => {
  const t = new Date(iso ?? '').getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : Infinity;
};

export function mergeSnapshot(fresh, old) {
  const out = { ...(old ?? {}) };
  const reused = [];

  for (const [k, v] of Object.entries(fresh)) {
    if (FRESH_ALWAYS.has(k) || meaningful(v) || !meaningful(old?.[k])) out[k] = v;
    else reused.push(k);
  }

  // 模型清单是页面主体内容，沿用旧数据时如实标注来源
  if (reused.includes('models')) out.modelsSource = 'cached';
  // 默认模型名按「最终生效的模型清单」重算，否则示例配置会退化成占位符。
  // 兜底与 probeNewApi 保持一致：走 pickPreferred 挑版本最新的，不能用 models[0]（字母序会挑到旧型号）
  out.defaults = {
    claude: pickPreferred(out.models, /^claude/i),
    openai: pickPreferred(out.models, /^(gpt|o\d|glm|deepseek|qwen|kimi)/i) ?? pickPreferred(out.models, /./) ?? null,
  };

  const answered = Boolean(fresh.apiOk || fresh.signup?.ok);
  // 「这些内容最晚是什么时候抓到的」——沿用旧值时保持粘性，
  // 否则每跑一次 checkedAt 都会往后走，连续失败也永远显示「刚刚更新」，
  // 48 小时的报警和下面的兜底判断就都失效了。
  const dataFrom = old?.staleFrom ?? old?.checkedAt ?? null;
  // 接口和注册页同时把我们拦了（CI 机房 IP 的常态）：站点大概率是好的，
  // 沿用上次的在线判定并标注本次被拦；上次成功探测超过 48 小时就不再兜底
  out.probeBlocked =
    !answered && probeFiltered(fresh) && old?.online === true && hoursSince(dataFrom) <= STALE_WARN_HOURS;
  out.online = answered || out.probeBlocked;
  out.dataStale = reused.length > 0;
  out.staleFrom = reused.length ? dataFrom : null;
  out.staleFields = reused;
  return out;
}
