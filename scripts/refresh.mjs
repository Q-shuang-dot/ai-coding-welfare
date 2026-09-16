#!/usr/bin/env node
/**
 * 拉取所有站点的实时状态，写入 data/live.json。
 *   node scripts/refresh.mjs
 * 网络不通时保留上一次的 live.json，不会把仓库刷成空数据。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchJson, probeUrl } from './lib/newapi.mjs';
import { probeSite } from './lib/panels.mjs';
import { mergeSnapshot } from './lib/merge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITES = path.join(ROOT, 'data', 'sites.json');
const LIVE = path.join(ROOT, 'data', 'live.json');

async function loadPrevious() {
  try {
    return JSON.parse(await readFile(LIVE, 'utf8'));
  } catch {
    return null;
  }
}

const { sites } = JSON.parse(await readFile(SITES, 'utf8'));
const previous = await loadPrevious();

const snapshots = await Promise.all(
  sites.map(async (site) => {
    const [snap, signup] = await Promise.all([probeSite(site), probeUrl(site.signupUrl)]);
    const mirrors = await Promise.all(
      (site.mirrors ?? []).map(async (m) => ({
        homeUrl: m.homeUrl,
        online: (await fetchJson(`${m.homeUrl.replace(/\/$/, '')}/api/status`)).ok,
      })),
    );
    return { ...snap, signup, mirrors };
  }),
);

// 字段级合并：抓失败的字段沿用上一次的值，避免一次 Cloudflare 挑战把页面刷空（逻辑见 lib/merge.mjs）
const merged = snapshots.map((fresh) => mergeSnapshot(fresh, previous?.sites?.find((s) => s.id === fresh.id)));

const out = {
  generatedAt: new Date().toISOString(),
  sites: merged,
};

await writeFile(LIVE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

for (const s of merged) {
  const bonus = s.inviteeBonusUsd ? `新用户 $${s.inviteeBonusUsd}` : '邀请额度未公开';
  const signup = s.signup ? `注册页 HTTP ${s.signup.status}` : '注册页未检查';
  const stale = s.dataStale ? `  ⚠ 沿用 ${String(s.staleFrom).slice(0, 16)} 的 ${s.staleFields.length} 个字段（${s.error ?? 'api 未响应'}）` : '';
  console.log(
    `${s.online ? (s.probeBlocked ? 'WAF ' : 'OK  ') : 'DOWN'} ${s.id.padEnd(12)} ${String(s.systemName ?? '-').padEnd(14)} ` +
      `${bonus.padEnd(18)} 模型 ${String(s.models.length).padStart(2)} 项  ${signup}${stale}`,
  );
}
console.log(`\n已写入 ${path.relative(ROOT, LIVE)}`);
