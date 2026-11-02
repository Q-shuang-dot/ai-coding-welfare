/**
 * 归档站点（已挂掉 / 长期下线 / 应维护者要求下架）的统一口径。
 *
 * 「停注」和「归档」是两回事，页面必须分开说：
 *   停注（lib/signup.mjs）—— 站点还活着，只是不收新用户；
 *   归档（这里）        —— 维护者确认不可用，人工移出推荐列表；不是自动探测判定。
 *
 * 归档站的处理原则：
 *   - 不进主列表、不算任何「首日可得 / 全注册约」合计，死了的站不许再吆喝额度；
 *   - 移到 README / 落地页底部的「历史区」，留名 + 归档日期 + 原因，
 *     这是仓库的诚实记录：曾收录过、后来死了，比悄悄删掉更有信息量；
 *   - refresh / check 不再探测它，CI 不为一个死站天天报警；
 *   - 旧详情页保留，但改成 noindex 的归档说明页，不再展示过期注册链接和配置。
 *
 * data/sites.json 里的登记方式：
 *   "archived": { "at": "2026-11-02", "reason": "……" }
 * at 是归档日期；reason 记录归档依据，不能仅凭一次 WAF 403 就断言域名失效。
 */

export const isArchived = (site) => Boolean(site?.archived);

/** 主列表 = 未归档的站点 */
export const activeSites = (sites) => (sites ?? []).filter((s) => !isArchived(s));

/** 历史区 = 已归档的站点，按归档日期倒序，最近下线的排前面 */
export const archivedSites = (sites) =>
  (sites ?? [])
    .filter(isArchived)
    .sort((a, b) => String(b.archived?.at ?? '').localeCompare(String(a.archived?.at ?? '')));

/** 历史区条目的展示日期：没填 at 就不显示日期，别编一个 */
export const archivedAt = (site) => site?.archived?.at || null;
export const archivedReason = (site) => site?.archived?.reason || '站点已不可用';
