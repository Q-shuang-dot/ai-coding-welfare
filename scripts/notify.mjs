#!/usr/bin/env node
/**
 * 把这一批重要变动推到 Telegram 频道。
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=@your_channel node scripts/notify.mjs
 *
 * 没配环境变量就安静退出——这一步是可选的，不能因为没配 secret 就把 CI 弄红。
 * 只推 major 事件（.tmp/notify.json 由 scripts/history.mjs 产出），
 * 6 小时一次的小抖动不该进推送，否则频道会被自己刷成噪音。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { icon } from './lib/changelog.mjs';
import { telegramText } from './lib/telegram.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;

if (!token || !chat) {
  console.log('· 没有配 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID，跳过推送。');
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(await readFile(path.join(ROOT, '.tmp', 'notify.json'), 'utf8'));
} catch {
  console.log('· 本次没有重要变动（没有 .tmp/notify.json），跳过推送。');
  process.exit(0);
}

const { meta } = JSON.parse(await readFile(path.join(ROOT, 'data', 'sites.json'), 'utf8'));
const events = payload.events ?? [];
if (!events.length) process.exit(0);

const text = telegramText({ meta, events, icon });

// token 只出现在 URL 里，任何情况下都不要把它 console.log 出来
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    chat_id: chat,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }),
});

if (!res.ok) {
  // Telegram 的报错体里不含 token，可以安全打出来
  console.error(`✘ 推送失败：HTTP ${res.status} ${await res.text().catch(() => '')}`);
  process.exitCode = 1;
} else {
  console.log(`✔ 已推送 ${events.length} 条变动到 Telegram。`);
}
