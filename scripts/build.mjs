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
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderReadme } from './lib/render-readme.mjs';
import { renderHtml } from './lib/render-html.mjs';
import { renderSitePage } from './lib/render-site-page.mjs';
import { renderComparePage, renderStatusPage, renderChangelogPage } from './lib/render-aux-pages.mjs';
import { groupByDay, renderAtom } from './lib/changelog.mjs';
import { EMPTY_HISTORY } from './lib/history.mjs';
import { auditCredits } from './lib/credits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(ROOT, ...s);
const readJson = async (rel, fallback) => {
  try {
    return JSON.parse(await readFile(p(rel), 'utf8'));
  } catch {
    return fallback;
  }
};

const { meta, sites } = JSON.parse(await readFile(p('data', 'sites.json'), 'utf8'));
if (!sites.length) throw new Error('data/sites.json 里没有任何站点');

const live = await readJson('data/live.json', { generatedAt: null, sites: [] });
if (!live.generatedAt) console.warn('⚠ 找不到 data/live.json，先跑 `npm run refresh` 才有实时数据，本次按空数据生成。');
const history = await readJson('data/history.json', EMPTY_HISTORY);
const changelog = await readJson('data/changelog.json', { events: [] });
const groups = groupByDay(changelog.events ?? []);

// 额度是手工登记的，站点改政策时不会自己变；和接口实测值对不上就提醒一声
for (const w of auditCredits(sites, live)) console.warn(`⚠ ${w}`);

await writeFile(p('README.md'), renderReadme({ meta, sites, live, groups, history }), 'utf8');

// 样式内联进 HTML：每一页都变成单文件，直接丢给别人打开、或转发到社群都不会掉样式
const css = await readFile(p('docs', 'assets', 'style.css'), 'utf8');
const byId = new Map((live.sites ?? []).map((s) => [s.id, s]));
for (const s of sites) {
  if (s.panel === 'local' && !byId.has(s.id)) {
    try {
      const snap = JSON.parse(await readFile(p('data', 'static-snaps', `${s.id}.json`), 'utf8'));
      byId.set(s.id, snap);
    } catch {
      // keep undefined if no snapshot exists
    }
  }
}

const write = async (rel, content) => {
  await mkdir(path.dirname(p('docs', rel)), { recursive: true });
  await writeFile(p('docs', rel), content, 'utf8');
};

await write('index.html', renderHtml({ meta, sites, live, css, groups, history }));
await write('.nojekyll', '');

for (const site of sites) {
  await write(
    `sites/${site.id}/index.html`,
    renderSitePage({
      meta,
      site,
      snap: byId.get(site.id),
      live,
      css,
      history,
      siblings: sites.filter((s) => s.id !== site.id).map(({ id, name, subtitle }) => ({ id, name, subtitle })),
    }),
  );
}

await write('compare/index.html', renderComparePage({ meta, sites, live, css }));
await write('status/index.html', renderStatusPage({ meta, sites, live, css, history }));
await write('changelog/index.html', renderChangelogPage({ meta, groups, live, css }));
await write('feed.xml', renderAtom({ meta, groups, updated: changelog.updatedAt ?? live.generatedAt }));

// 落地页要被搜到才有推广价值：robots + 把每一页都写进 sitemap
const base = meta.pagesUrl?.replace(/\/?$/, '/') ?? '';
const day = (live.generatedAt ?? new Date().toISOString()).slice(0, 10);
const urls = [
  { loc: base, freq: 'daily', pri: '1.0' },
  { loc: `${base}compare/`, freq: 'weekly', pri: '0.8' },
  { loc: `${base}status/`, freq: 'daily', pri: '0.7' },
  { loc: `${base}changelog/`, freq: 'daily', pri: '0.7' },
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

console.log(`✔ README.md 已生成（${sites.length} 个站点）`);
console.log(`✔ docs/ 已生成 ${urls.length} 个页面 + feed.xml + sitemap.xml`);
