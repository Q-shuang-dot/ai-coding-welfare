/**
 * 对外只读 API：把页面已经在用的数据，按稳定字段再吐一份 JSON。
 *
 * 为什么值得做：这个仓库的护城河是「持续抓取 + 人工核对过的结构化数据」，
 * 只给自己页面用太浪费；别的导航站 / 脚本 / bot 来接，天然会带外链。
 * 字段一旦发布就不要随便改，只能加字段、升 version。
 */
import { esc, pageShell } from './layout.mjs';
import { uptime } from './history.mjs';

const pageUrl = (meta, path = '') => `${String(meta.pagesUrl ?? '').replace(/\/?$/, '/')}${path}`;

export function sitesApi({ meta, sites, live }) {
  return {
    version: 1,
    generatedAt: live?.generatedAt ?? null,
    source: meta.repoUrl,
    license: 'MIT',
    count: sites.length,
    sites: sites.map((s) => ({
      id: s.id,
      name: s.name,
      subtitle: s.subtitle,
      paid: s.paid === true,
      recommended: s.recommended === true,
      tags: s.tags ?? [],
      highlights: s.highlights ?? [],
      credits: s.credits ?? {},
      endpoints: s.endpoints ?? {},
      signupUrl: s.signupUrl,
      homeUrl: s.homeUrl,
      docsUrl: s.docsUrl ?? null,
      inviteCode: s.inviteCode ?? null,
      register: s.register ?? null,
      earnMore: s.earnMore ?? [],
      caveats: s.caveats ?? [],
      remarks: s.remarks ?? null,
      faq: s.faq ?? [],
      reviewedAt: s.reviewedAt ?? null,
      page: pageUrl(meta, `sites/${s.id}/`),
    })),
  };
}

export function statusApi({ meta, sites, live, history }) {
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  return {
    version: 1,
    generatedAt: live?.generatedAt ?? null,
    source: meta.repoUrl,
    sites: sites.map((s) => {
      const snap = byId.get(s.id) ?? {};
      const u = uptime(history, s.id, 7);
      return {
        id: s.id,
        name: s.name,
        online: Boolean(snap.online),
        probeBlocked: snap.probeBlocked === true,
        latencyMs: snap.latencyMs ?? null,
        models: snap.models?.length ?? 0,
        checkedAt: snap.checkedAt ?? null,
        uptime7d: u.enough ? u.percent : null,
        samples: u.total,
        page: pageUrl(meta, `sites/${s.id}/`),
      };
    }),
  };
}

export function renderApiPage({ meta, css, live }) {
  const base = pageUrl(meta);
  const body = `  <header class="hero">
    <p class="crumb"><a href="../">${esc(meta.title)}</a> › 开放 API</p>
    <h1>开放 API</h1>
    <p class="sub">站点清单和在线状态都是结构化数据，脚本、bot、别的导航站可以直接读，不用爬页面。</p>
    <div class="pills">
      <span class="pill">版本 <b>v1</b></span>
      <span class="pill">每 6 小时更新</span>
      <span class="pill">CORS <b>允许所有来源</b></span>
    </div>
  </header>

  <section><h2>两个端点</h2>
    <div class="rows">
      <div class="row"><div class="status"><a href="sites.json"><code>/api/sites.json</code></a></div><div class="meta">在架站点、额度、协议、邀请码、备注与 FAQ</div></div>
      <div class="row"><div class="status"><a href="status.json"><code>/api/status.json</code></a></div><div class="meta">在线状态、延迟、模型数量、7 天可用率</div></div>
    </div>
    <p class="hint">两个文件都由 <code>npm run build</code> 从 <code>data/sites.json</code> 和 <code>data/live.json</code> 生成，随站点每 6 小时刷新一次。</p>
  </section>

  <section><h2>直接用</h2>
    <p class="hint">GitHub Pages 会返回 <code>Access-Control-Allow-Origin: *</code>，浏览器里可以直接跨域 <code>fetch</code>：</p>
    <pre><code>const res = await fetch('${base}api/sites.json');
const { version, generatedAt, sites } = await res.json();

for (const site of sites) {
  console.log(site.name, site.credits, site.endpoints);
}</code></pre>
  </section>

  <section><h2>字段说明</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>字段</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><code>version</code></td><td>接口版本，目前固定为 <code>1</code>；只加字段不改结构</td></tr>
        <tr><td><code>generatedAt</code></td><td>这份数据对应的抓取时间（ISO 8601）</td></tr>
        <tr><td><code>sites[].id</code></td><td>稳定标识，可用来拼接详情页 <code>page</code></td></tr>
        <tr><td><code>credits</code></td><td>额度结构：<code>signup</code> / <code>invite</code> / <code>dailyCheckin</code> / <code>unit</code>；<code>unit</code> 缺省为美元</td></tr>
        <tr><td><code>endpoints</code></td><td>可用的协议端点，如 <code>anthropic</code>、<code>openai</code></td></tr>
        <tr><td><code>paid</code></td><td><code>true</code> 表示付费中转站，赠送额度用完要充值</td></tr>
        <tr><td><code>uptime7d</code></td><td>最近 7 天可用率百分比；样本不足时为 <code>null</code></td></tr>
      </tbody>
    </table></div>
  </section>

  <section><h2>使用约定</h2>
    <ul class="hl">
      <li>数据以 <b>MIT</b> 协议提供，转载或二次分发请保留 <a href="${esc(meta.repoUrl)}">仓库链接</a>。</li>
      <li>额度以站方公示和人工登记为主，可能有延迟；做重要决策前请以站内实时页面为准。</li>
      <li>请勿高频轮询：数据每 6 小时才更新一次，缓存 10 分钟再读就够。</li>
      <li>发现字段缺失或想加字段，去 <a href="${esc(meta.repoUrl)}/issues">Issue 区</a> 提。</li>
    </ul>
  </section>`;

  return pageShell({
    meta,
    css,
    live,
    base: '../',
    current: null,
    title: `开放 API — ${meta.title}`,
    desc: 'AI 福利站的公开只读 JSON API：站点清单、额度、协议、邀请码与在线状态，每 6 小时更新，支持跨域读取。',
    canonical: `${base}api/`,
    body,
  });
}
