#!/usr/bin/env node
/**
 * 健康检查：确认每个站点的首页、注册（邀请）链接、状态接口都还活着。
 *   node scripts/check.mjs
 * 注册链接挂掉时以非 0 退出，让 CI 直接报警——推广页最怕的就是死链。
 *
 * 例外：403 / 429 / 503 这类「服务器答话了但把我们拦了」的响应不算死链。
 * GitHub Actions 的机房 IP 常被公益站的 WAF 拦，家宽访问同一个链接一切正常，
 * 拿它报警只会天天误报，所以单独计一类「被拦」，只提示不失败。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { looksFiltered, isHttpsUrl } from './lib/newapi.mjs';
import { activeSites } from './lib/archived.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sites: allSites } = JSON.parse(await readFile(path.join(ROOT, 'data', 'sites.json'), 'utf8'));
const sites = activeSites(allSites);
const archivedCount = allSites.length - sites.length;

// 连续 48 小时没有一次成功探测（且至少攒了 8 个失败点）的站：当成已知异常，不再每天重复报同一条死链。
// 数据来自 history.json，站点恢复后下一次巡检会自动回到正常判定。
const history = JSON.parse(await readFile(path.join(ROOT, 'data', 'history.json'), 'utf8'));
const KNOWN_DOWN_HOURS = 48;
const knownDown = new Set();
for (const s of sites) {
  const rows = (history.samples ?? [])
    .map((x) => ({ at: x.at, r: x.sites?.[s.id] }))
    .filter((x) => x.r);
  const lastUp = rows.filter((x) => x.r.up).at(-1)?.at;
  const since = lastUp ? Date.now() - new Date(lastUp).getTime() : Number.POSITIVE_INFINITY;
  const failsSince = rows.filter((x) => !x.r.up && (!lastUp || x.at > lastUp)).length;
  if (since >= KNOWN_DOWN_HOURS * 3_600_000 && failsSince >= 8) knownDown.add(s.id);
}

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

async function probe(url) {
  const t = Date.now();
  // 和 lib/newapi.mjs 同一条口径：sites.json 里的 URL 只允许 https。
  if (!isHttpsUrl(url)) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - t,
      error: typeof fetch === 'function' ? '只允许 https 出网' : '只允许 https 出网; 当前 Node 版本过低，未联网探测',
      skipped: true,
    };
  }

  if (typeof fetch !== 'function') {
    return { ok: false, status: 0, ms: Date.now() - t, error: '当前 Node 版本过低，未联网探测', skipped: true };
  }

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'ai-coding-welfare/1.0 health-check' },
      signal: AbortSignal.timeout(20_000),
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - t };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t, error: String(err.message || err) };
  }
}

const targets = [];
for (const s of sites) {
  targets.push({ id: s.id, site: s.name, kind: '注册链接', url: s.signupUrl, critical: true });
  targets.push({ id: s.id, site: s.name, kind: '站点首页', url: s.homeUrl, critical: true });
  // relay 面板的 statusApi 是个「要鉴权的中转口」，不带 key 回 401 才是正常的（见 lib/relay.mjs）。
  // 不把这一类算进告警，否则每次 check 都固定挂一条噪音，久了就没人看告警了。
  if (s.statusApi) {
    targets.push({
      id: s.id,
      site: s.name,
      kind: '状态接口',
      url: s.statusApi,
      critical: false,
      expect401: s.panel === 'relay',
    });
  }
  if (s.docsUrl) targets.push({ id: s.id, site: s.name, kind: '文档', url: s.docsUrl, critical: false });
  for (const m of s.mirrors ?? []) {
    targets.push({ id: s.id, site: s.name, kind: '备用注册', url: m.signupUrl, critical: false });
  }
}

const results = await Promise.all(
  targets.map(async (t) => {
    let res = await probe(t.url);
    // 关键链接失败先重试一次：偶尔的 TLS/超时抖动不该直接开一条 Issue
    if (!res.ok && !res.skipped && t.critical) {
      await new Promise((r) => setTimeout(r, 1200));
      const again = await probe(t.url);
      if (again.ok) res = { ...again, retried: true };
    }
    return { ...t, res };
  }),
);

let failed = 0;
let warned = 0;
let blocked = 0;
let knownCount = 0;
for (const r of results) {
  const needsKey = r.expect401 && r.res.status === 401;
  const alive = r.res.ok || needsKey;
  const filtered = !alive && looksFiltered(r.res);
  const skipped = r.res.skipped && !r.res.ok;
  const known = !alive && !skipped && knownDown.has(r.id);
  const mark = alive ? '✔' : skipped ? '⊘' : filtered ? '≡' : known ? '⚰' : r.critical ? '✖' : '!';
  if (!alive && !skipped) {
    if (filtered) blocked += 1;
    else if (known) knownCount += 1;
    else if (r.critical) failed += 1;
    else warned += 1;
  }
  console.log(
    `${mark} ${r.site.padEnd(13)} ${r.kind.padEnd(10)} HTTP ${String(r.res.status).padEnd(4)} ` +
      `${String(r.res.ms).padStart(5)}ms  ${r.url}${r.res.error ? `  (${r.res.error})` : ''}` +
      `${needsKey ? '  ← 中转口要鉴权，401 是预期答案' : ''}` +
      `${filtered ? '  ← 被 WAF 拦（本机 IP 的问题，不算死链）' : ''}` +
      `${known ? `  ← 已连续 48 小时无成功探测，按已知异常处理` : ''}` +
      `${r.res.retried ? '  ← 首次失败，重试后恢复' : ''}`,
  );
}

console.log(`\n共 ${results.length} 项：失败 ${failed}，告警 ${warned}，被拦 ${blocked}，已知异常 ${knownCount}`);
if (knownDown.size) console.log(`⚰ ${knownDown.size} 个站点已连续 48 小时探测失败，不再每天重复报警`);
if (archivedCount) console.log(`⚰ ${archivedCount} 个已归档（停用）的站点跳过检查`);
if (blocked) {
  console.log('被拦的链接请换个网络（非机房 IP）复核一次，站点通常是好的。');
}
if (failed) {
  console.error('\n关键链接不可用，请核对 data/sites.json 里的推广链接是否已失效或换域名。');
  process.exit(1);
}

