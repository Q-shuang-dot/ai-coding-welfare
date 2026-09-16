/**
 * 探测「没有公开面板接口」的站点：自研网关（CheapCodex）与任务制积分站（NOFX）都归这里。
 *
 * 这两类站都没有 /api/status 可读，而且 robots.txt 明写着不让碰面板接口：
 *   CheapCodex: Allow 根目录，Disallow /admin、/api、/auth、/dashboard、/keys、/usage …
 *   NOFX:       Allow 根目录，Disallow /api/，以及各语言前缀下的 dashboard、tasks、models、settings …
 * 所以 statusApi 这里填的不是「状态接口」，而是 robots 放行、能代表站点活着的任意一个 URL：
 *   CheapCodex → /v1/models，不带 key 必然回 401
 *     {"code":"API_KEY_REQUIRED","message":"API key is required in Authorization header (Bearer scheme), x-api-key header, or x-goog-api-key header"}
 *     能回这一句就说明网关进程活着、路由也在——401 在这里不是失败，是存活证据。
 *   NOFX → 落地页，它的中转地址只在登录后的「接入文档」里下发，公开面拿不到，
 *     那就只探落地页，据实回答「还活着吗、多久答话」。
 *
 * 除此之外什么都读不到：站名、面板版本、模型清单、额度一律留 null。这些是站内公示，
 * 只能手工登记在 sites.json 的 credits / modelsNote 里，绝不从 sites.json 倒灌进
 * live.json 假装是探测结果——参考 lib/matrix.mjs 里同样的分寸。
 *
 * 用 probeUrl 而不是 fetchJson 是故意的：fetchJson 把非 2xx 当失败，会为一个
 * 预期之内的 401 连打三次（还带 1.5s / 3s 退避）；probeUrl 只在连接层异常时重试，
 * 服务器一答话就返回。每 6 小时探一次的东西，没有理由一次敲三下人家的门。
 */
import { blankSnapshot, probeUrl } from './newapi.mjs';

/**
 * 中转口的存活口径：
 *   2xx        —— 活着（有的站点 /v1/models 允许匿名读）
 *   401        —— 活着且要鉴权，这是不带 key 时的预期答案
 *   其它 / 异常 —— 如实报错，交给 merge.mjs 判断是「被拦」还是真下线
 */
export function relayState(res) {
  if (res?.ok) return { ok: true, error: null };
  if (Number(res?.status) === 401) return { ok: true, error: null };
  const status = Number(res?.status);
  return { ok: false, error: res?.error ?? (status ? `HTTP ${status}` : 'unreachable') };
}

/** get 可注入，单测直接喂真实响应的形状，不联网 */
export async function probeRelay(site, get = probeUrl) {
  const res = await get(site.statusApi);
  const { ok, error } = relayState(res);

  // 字段集合必须与 blankSnapshot 完全一致（merge.mjs 与渲染器按字段取数）
  return blankSnapshot(site, {
    apiOk: ok,
    pricingOk: false,
    latencyMs: res?.ms ?? null,
    error,
  });
}
