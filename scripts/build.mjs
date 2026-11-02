#!/usr/bin/env node
/**
 * 用 data/*.json 重新生成 README.md 与整个 docs/ 站点。
 *   node scripts/build.mjs
 *
 * 页面清单（都是生成物，不要手改）：
 *   docs/index.html            总览
 *   docs/sites/<id>/index.html 每站一页，吃「站名 + 邀请码 / 怎么配」这类长尾词
 *   docs/compare/index.html    按次 vs 按量折算横评
 *   docs/status/index.html     可用性历史
 *   docs/changelog/index.html  变动日志
 *   docs/feed.xml              Atom 订阅
 *   README.md                  中文（主版本）
 *   README.en.md               英文（模板全翻，站点文案取 sites.json 的 en 块）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderReadme } from './lib/render-readme.mjs';
import { LANGS, readmeFile } from './lib/i18n.mjs';
import { renderHtml } from './lib/render-html.mjs';
import { renderSitePage } from './lib/render-site-page.mjs';
import { renderComparePage, renderStatusPage, renderChangelogPage } from './lib/render-aux-pages.mjs';
import { groupByDay, renderAtom } from './lib/changelog.mjs';
import { EMPTY_HISTORY } from './lib/history.mjs';
import { auditCredits } from './lib/credits.mjs';
import { activeSites, archivedSites } from './lib/archived.mjs';
import { pageShell } from './lib/layout.mjs';
import { renderApiPage, sitesApi, statusApi } from './lib/api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(ROOT, ...s);
const readJson = async (rel, fallback) => {
  try {
    return JSON.parse(await readFile(p(rel), 'utf8'));
  } catch {
    return fallback;
  }
};

const { meta, sites: allSites } = JSON.parse(await readFile(p('data', 'sites.json'), 'utf8'));
// 归档站只出现在「历史区」和它自己的说明页：不进总表、不算合计、不占 sitemap
const sites = activeSites(allSites);
const archived = archivedSites(allSites);
if (!sites.length) throw new Error('data/sites.json 里没有任何在架站点');

const live = await readJson('data/live.json', { generatedAt: null, sites: [] });
if (!live.generatedAt) console.warn('⚠ 找不到 data/live.json，先跑 `npm run refresh` 才有实时数据，本次按空数据生成。');
const history = await readJson('data/history.json', EMPTY_HISTORY);
const changelog = await readJson('data/changelog.json', { events: [] });
const groups = groupByDay(changelog.events ?? []);

// 额度是手工登记的，站点改政策时不会自己变；和接口实测值对不上就提醒一声
for (const w of auditCredits(sites, live)) console.warn(`⚠ ${w}`);

// 每个语言产出一份 README：中文是主版本（README.md），其余是 README.<lang>.md。
// 站点没写 en 覆盖块时对应段落会跳过、不会退化成中文，所以无翻译也照样出文件。
for (const lang of LANGS) {
  await writeFile(p(readmeFile(lang)), renderReadme({ meta, sites, live, groups, history, lang, archived }), 'utf8');
  console.log(`✔ ${readmeFile(lang)} 已生成（${sites.length} 个在架 + ${archived.length} 个归档）`);
}

// 样式内联进 HTML：每一页都变成单文件，直接丢给别人打开、或转发到社群都不会掉样式
const css = await readFile(p('docs', 'assets', 'style.css'), 'utf8');
const byId = new Map((live.sites ?? []).map((s) => [s.id, s]));

const write = async (rel, content) => {
  await mkdir(path.dirname(p('docs', rel)), { recursive: true });
  await writeFile(p('docs', rel), content, 'utf8');
};

const siteBase = meta.pagesUrl?.replace(/\/?$/, '/') ?? '/';

await write('index.html', renderHtml({ meta, sites, live, css, groups, history, archived }));
await write('.nojekyll', '');

// GitHub Pages 的默认 404 太生硬：给条回首页 / 看状态页的路，别让从群里点进来的访客直接关掉
await write(
  '404.html',
  pageShell({
    meta,
    css,
    live,
    base: siteBase,
    title: `页面不存在 — ${meta.title}`,
    desc: '这个页面不存在，可能链接写错了，或者站点已经归档。回首页看全部福利站。',
    canonical: `${siteBase}404.html`,
    body: `  <header class="hero">
    <p class="crumb"><a href="${siteBase}">${meta.title}</a> › 404</p>
    <h1>404 · 这个页面不存在</h1>
    <p class="sub">链接可能写错了，或者这个站点已经归档。</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="${siteBase}">回首页看全部站点</a>
      <a class="btn btn-ghost" href="${siteBase}status/">看站点可用性</a>
    </div>
  </header>
  <section><h2>可能想找</h2>
    <ul class="hl">
      <li><a href="${siteBase}compare/">中转站折算对比</a></li>
      <li><a href="${siteBase}changelog/">最近的变动记录</a></li>
      <li><a href="${meta.repoUrl}/issues">Issue 区 · 投稿与反馈</a></li>
    </ul>
  </section>`,
  }),
);

for (const site of [...sites, ...archived]) {
  await write(
    `sites/${site.id}/index.html`,
    renderSitePage({
      meta,
      site,
      snap: byId.get(site.id),
      live,
      css,
      history,
      events: changelog.events ?? [],
      siblings: sites.filter((s) => s.id !== site.id).map(({ id, name, subtitle }) => ({ id, name, subtitle })),
    }),
  );
}

await write('compare/index.html', renderComparePage({ meta, sites, live, css }));
await write('status/index.html', renderStatusPage({ meta, sites, live, css, history }));
await write('changelog/index.html', renderChangelogPage({ meta, sites: allSites, groups, live, css }));
await write('feed.xml', renderAtom({ meta, groups, updated: changelog.updatedAt ?? live.generatedAt }));

// 对外只读 API：页面自己用同一份数据，额外吐两个稳定 JSON 给脚本 / 别的导航站
await write('api/sites.json', `${JSON.stringify(sitesApi({ meta, sites, live }), null, 2)}\n`);
await write('api/status.json', `${JSON.stringify(statusApi({ meta, sites, live, history }), null, 2)}\n`);
await write('api/index.html', renderApiPage({ meta, css, live }));

// 落地页要被搜到才有推广价值：robots + 把每一页都写进 sitemap
const base = siteBase;
const day = (live.generatedAt ?? new Date().toISOString()).slice(0, 10);
const urls = [
  { loc: base, freq: 'daily', pri: '1.0' },
  { loc: `${base}compare/`, freq: 'weekly', pri: '0.8' },
  { loc: `${base}status/`, freq: 'daily', pri: '0.7' },
  { loc: `${base}changelog/`, freq: 'daily', pri: '0.7' },
  { loc: `${base}api/`, freq: 'weekly', pri: '0.5' },
  ...sites.map((s) => ({ loc: `${base}sites/${s.id}/`, freq: 'daily', pri: '0.9' })),
];

await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
await write(
  'sitemap.xml',
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `  <url><loc>${u.loc}</loc><lastmod>${day}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`,
    ),
    '</urlset>',
    '',
  ].join('\n'),
);

if (/USERNAME/.test(`${meta.repoUrl}${meta.pagesUrl}`)) {
  console.warn('⚠ data/sites.json 的 meta.repoUrl / meta.pagesUrl 还是占位的 USERNAME，推到 GitHub 前记得改成你的用户名。');
}

console.log(`✔ docs/ 已生成 ${urls.length} 个页面 + feed.xml + sitemap.xml`);
