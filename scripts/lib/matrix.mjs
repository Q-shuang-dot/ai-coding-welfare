/**
 * 抓取 Matrix（matrix.mzsjai.com）这类「统一 API 网关 + 开源应用商店」站点的公开信息。
 *
 * 这个站不是 New API 系：/api/status、/api/pricing、/api/models 一律 404，
 * 模型清单在 /app/models 由前端登录后拉取，网关地址（Base URL）只在控制台的
 * Key 详情页下发。2026-08-26 实测，公开可读的 JSON 只有一个健康检查：
 *   GET /api/health  ——  {"status":"ok","timestamp":"2026-08-26T11:19:00.504Z"}
 *
 * 所以这里只据实回答一件事：站点还活着吗、多久答话。额度是站内公示（增长页写明
 * 邀请 600 / 实名 2000 积分），只能手工登记在 sites.json 的 credits 里；
 * 模型清单与 Base URL 公开接口拿不到，一律不猜——页面上写「登录后台查看」。
 */
import { blankSnapshot, fetchJson } from './newapi.mjs';

/**
 * 健康检查的成功口径：HTTP 200 且 status 字段是 ok。
 * 后端自己报故障（status=degraded 之类）时不能当「在线」用，如实写进 error。
 */
export function healthState(res) {
  if (!res?.ok) return { ok: false, error: res?.error ?? 'unreachable' };
  const status = String(res.json?.status ?? '').toLowerCase();
  if (status === 'ok') return { ok: true, error: null };
  return { ok: false, error: status ? `健康检查返回 ${status}` : '健康检查没有 status 字段' };
}

/** get 可注入，单测直接喂真实接口的返回体，不联网 */
export async function probeMatrix(site, get = fetchJson) {
  const res = await get(site.statusApi);
  const { ok, error } = healthState(res);

  // 字段集合必须与 blankSnapshot 完全一致（merge.mjs 与渲染器按字段取数）。
  // 站名、登录方式、注册开关都不是这个接口能给的，宁可留 null 也不从 sites.json
  // 倒灌进来假装是探测结果——live.json 只放真的探到的东西。
  return blankSnapshot(site, {
    apiOk: ok,
    pricingOk: false,
    latencyMs: res?.ms ?? null,
    error,
  });
}
