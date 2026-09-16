/** 变动日志的三种出口：CHANGELOG.md、docs/changelog/ 的正文、docs/feed.xml（Atom）。 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const ICON = {
  site_added: '🆕',
  site_removed: '🗑️',
  online: '🟢',
  offline: '🔴',
  invite_change: '💰',
  inviter_change: '💰',
  register_closed: '🚫',
  register_open: '✅',
  checkin_on: '📅',
  checkin_off: '📅',
  models_added: '➕',
  models_removed: '➖',
  price_change: '🏷️',
  announcement: '📢',
};

export const icon = (type) => ICON[type] ?? '·';

const hhmm = (iso) => {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
};

/** 事件按天分组，最新的一天在前 */
export function groupByDay(events = []) {
  const map = new Map();
  for (const e of events) {
    const day = String(e.at ?? '').slice(0, 10) || '未知日期';
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(e);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({
      date,
      events: list.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))),
      updated: list.reduce((max, e) => (String(e.at) > String(max) ? e.at : max), list[0]?.at),
    }));
}

/** 一句话概括这批变动，用作 Release 标题与推送首行 */
export function summarize(events = []) {
  if (!events.length) return '没有变动';
  const head = events[0].text;
  return events.length === 1 ? head : `${head}（另有 ${events.length - 1} 项变动）`;
}

/** CHANGELOG.md：给 GitHub 上直接看，也是 Release notes 的素材 */
export function renderChangelogMd({ meta, groups, limitDays = 60 }) {
  const lines = [
    '# 变动日志',
    '',
    `${meta.title}的自动变动记录：站点上下线、额度调整、模型与价格变化，由 CI 每 6 小时对比一次快照生成。`,
    '',
    `订阅方式：[Atom feed](${meta.pagesUrl}feed.xml) · [Watch → Custom → Releases](${meta.repoUrl}/watchers) · 网页版 [变动日志](${meta.pagesUrl}changelog/)`,
    '',
    '> 只记录会影响「值不值得注册」的字段。探测被站点 WAF 拦下时不记在线状态变化，避免机房 IP 被拦被误报成掉线。',
    '',
  ];
  for (const g of groups.slice(0, limitDays)) {
    lines.push(`## ${g.date}`, '');
    for (const e of g.events) {
      lines.push(`- ${icon(e.type)} ${e.text}${hhmm(e.at) ? ` <sub>${hhmm(e.at)}</sub>` : ''}`);
    }
    lines.push('');
  }
  if (!groups.length) lines.push('_还没有记录到变动。_', '');
  lines.push('<!-- 本文件由 scripts/history.mjs 自动生成，请勿手改 -->');
  return lines.join('\n');
}

/** Release notes：只放这一批 major 事件，标题另出 */
export function renderReleaseNotes({ meta, events, live }) {
  const lines = [
    ...events.map((e) => `- ${icon(e.type)} ${e.text}`),
    '',
    `数据快照：\`${live?.generatedAt ?? '未知'}\``,
    '',
    `完整列表 → [变动日志](${meta.pagesUrl}changelog/) · 订阅 → [Atom](${meta.pagesUrl}feed.xml)`,
    '',
    `站点总览与一键配置 → ${meta.repoUrl}`,
  ];
  return lines.join('\n');
}

/** Atom：一天一条摘要，而不是一条事件一条推送，否则订阅者会被 6 小时一次的小改动淹掉 */
export function renderAtom({ meta, groups, updated, limit = 40 }) {
  const home = meta.pagesUrl;
  const host = home.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const entries = groups.slice(0, limit).map((g) => {
    const body = `<ul>${g.events.map((e) => `<li>${esc(`${icon(e.type)} ${e.text}`)}</li>`).join('')}</ul>`;
    return [
      '  <entry>',
      `    <title>${esc(`${g.date} · ${g.events.length} 项变动`)}</title>`,
      `    <link href="${esc(`${home}changelog/#${g.date}`)}"/>`,
      `    <id>tag:${esc(host)},${g.date}:changelog</id>`,
      `    <updated>${esc(new Date(g.updated ?? `${g.date}T00:00:00Z`).toISOString())}</updated>`,
      `    <summary>${esc(summarize(g.events))}</summary>`,
      `    <content type="html">${esc(body)}</content>`,
      '  </entry>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${esc(meta.title)} · 变动日志</title>`,
    `  <subtitle>${esc('公益站上下线、额度调整、模型与价格变化，每 6 小时自动比对')}</subtitle>`,
    `  <link rel="self" href="${esc(`${home}feed.xml`)}"/>`,
    `  <link href="${esc(home)}"/>`,
    `  <id>${esc(home)}</id>`,
    `  <updated>${esc(new Date(updated ?? Date.now()).toISOString())}</updated>`,
    `  <author><name>${esc(meta.title)}</name></author>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}
