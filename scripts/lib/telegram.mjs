/**
 * Telegram 推送的正文组装（纯函数，方便单测；发请求的部分留在 scripts/notify.mjs）。
 *
 * 单独抽出来的直接原因是一条安全报告（CodeQL `js/incomplete-html-attribute-sanitization`）：
 * 原来 notify.mjs 里自带一个只转义 `& < >` 的 esc，却把结果塞进 `<a href="…">` 的属性里，
 * 少转义一个双引号就能从属性里逃出去、伪造出一个显示文案与真实 href 不一致的链接。
 * meta.repoUrl / meta.pagesUrl 来自 data/sites.json——那正是外部 PR 能改的文件，
 * 所以这不是纯理论问题。
 *
 * Telegram 的 HTML parse mode 明确要求：不属于标签或实体的 `<`、`>`、`&`、`"` 都要替换。
 * 就按它这四个来，不多转 `'`——Telegram 不认 `&apos;`，多转反而会在消息里显示成字面量。
 */

/** Telegram HTML parse mode 的转义口径：& < > " 四个，一个都不能少 */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 一条推送里最多列几件事，多了就折成「另有 N 项」——6 小时一次，别把频道刷成噪音 */
export const EVENT_LIMIT = 12;

/**
 * 拼出推送正文。icon 由调用方注入（来自 lib/changelog.mjs），
 * 这样这个模块不依赖变动日志那套分类表，单测也不用陪着它一起加载。
 */
export function telegramText({ meta = {}, events = [], icon = () => '', limit = EVENT_LIMIT } = {}) {
  const shown = events.slice(0, limit);
  const rest = events.length - shown.length;
  return [
    `<b>${esc(meta.title)} · 变动</b>`,
    '',
    ...shown.map((e) => `${icon(e.type)} ${esc(e.text)}`),
    rest > 0 ? `… 另有 ${rest} 项` : null,
    '',
    `<a href="${esc(`${meta.pagesUrl}changelog/`)}">完整变动日志</a> · <a href="${esc(meta.repoUrl)}">GitHub</a>`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}
