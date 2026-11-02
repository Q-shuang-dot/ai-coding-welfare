import { esc } from './layout.mjs';

/**
 * 交流群：群号、二维码都从 meta.community 读，不写死在模板里。
 * 群里发的是站点变动和上车技巧，和收录的站点本身无关，所以单独成模块。
 */
export function communityReadme(meta, copy) {
  const group = meta.community;
  if (!group) return [];
  const name = group.name ? `（${group.name}）` : '';
  return [
    '> [!TIP]',
    `> **💬 ${copy.title} · ${copy.groupLabel}：${group.qqGroup}${name}**`,
    '>',
    `> ${copy.text}`,
    '>',
    group.joinUrl
      ? `> **[${copy.join} →](${group.joinUrl})** · [${copy.qr}](docs/${group.qrPath})`
      : `> ${copy.hint} · [${copy.qr}](docs/${group.qrPath})`,
    '',
  ];
}

export function communityBanner(meta, copy, base = '') {
  const group = meta.community;
  if (!group) return '';
  const qr = `${base}${group.qrPath}`;
  const title = group.name ? `${copy.title} · ${group.name}` : copy.title;
  return `<aside class="community-banner" aria-label="${esc(copy.title)}">
      <div class="community-copy">
        <p class="community-title">💬 ${esc(title)}</p>
        <p class="community-description">${esc(copy.text)}</p>
        <p class="community-group">${esc(copy.groupLabel)} <strong>${esc(group.qqGroup)}</strong></p>
        <div class="community-actions">
          ${
            group.joinUrl
              ? `<a class="btn community-join" href="${esc(group.joinUrl)}" target="_blank" rel="noopener noreferrer">${esc(copy.join)} ↗</a>`
              : ''
          }
          <span>${esc(copy.hint)}</span>
        </div>
      </div>
      <a class="community-qr" href="${esc(qr)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(copy.qr)}">
        <img src="${esc(qr)}" width="128" height="128" alt="${esc(copy.qr)}" loading="lazy">
      </a>
    </aside>`;
}
