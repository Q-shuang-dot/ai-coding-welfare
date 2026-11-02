import { esc } from './layout.mjs';

/**
 * 交流群：群号、二维码都从 meta.community 读，不写死在模板里。
 * 群里发的是站点变动和上车技巧，和收录的站点本身无关，所以单独成模块。
 *
 * README 里放在文末，且默认不推“入群”：没有 joinUrl 时只留一句可选的说明，
 * 不再贴二维码。想强制引导入群的配置仍可提供 joinUrl。
 */
export function communityReadme(meta, copy) {
  const group = meta.community;
  if (!group) return [];
  const name = group.name ? `（${group.name}）` : '';
  const lines = [
    '> [!TIP]',
    `> **💬 ${copy.title} · ${copy.groupLabel}${copy.groupSep ?? '：'}${group.qqGroup}${name}**`,
    '>',
    `> ${copy.text}`,
  ];
  if (group.joinUrl) {
    lines.push('>', `> **[${copy.join} →](${group.joinUrl})** · [${copy.qr}](docs/${group.qrPath})`);
  } else if (copy.hint) {
    lines.push('>', `> ${copy.hint}`);
  }
  return [...lines, ''];
}

export function communityBanner(meta, copy, base = '') {
  const group = meta.community;
  if (!group) return '';
  // 没有显式 joinUrl 时把群当作可选信息：只留群号，不摆二维码催人进群
  const qr = group.joinUrl ? `${base}${group.qrPath}` : '';
  const title = group.name ? `${copy.title} · ${group.name}` : copy.title;
  const qrBlock = qr
    ? `
      <a class="community-qr" href="${esc(qr)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(copy.qr)}">
        <img src="${esc(qr)}" width="96" height="96" alt="${esc(copy.qr)}" loading="lazy">
      </a>`
    : '';
  return `<aside class="community-banner" aria-label="${esc(copy.title)}">
      <div class="community-copy">
        <p class="community-title">💬 ${esc(title)}</p>
        <p class="community-line">
          <span class="community-group">${esc(copy.groupLabel)} <strong>${esc(group.qqGroup)}</strong></span>
          ${
            group.joinUrl
              ? `<a class="community-join" href="${esc(group.joinUrl)}" target="_blank" rel="noopener noreferrer">${esc(copy.join)} ↗</a>`
              : ''
          }
          <span class="community-hint">${esc(copy.hint)}</span>
        </p>
      </div>${qrBlock}
    </aside>`;
}
