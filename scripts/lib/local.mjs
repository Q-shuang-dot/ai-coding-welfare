/**
 * 本地自托管工具（GCMP Gateway 等）的面板探测。
 *
 * 这类工具跑在用户本机，没有公开接口可探测，数据来自 data/static-snaps/<id>.json。
 * 远端探测一律跳过，保留站点的 setup/configBlocks 给渲染器使用。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankSnapshot } from './newapi.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function readStatic(id) {
  try {
    const raw = await readFile(path.join(ROOT, 'data', 'static-snaps', `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const SNAPSHOT_KEYS = new Set([
  'online',
  'systemName',
  'version',
  'registerOpen',
  'passwordRegister',
  'checkinEnabled',
  'loginMethods',
  'githubMinAccountAgeDays',
  'quotaPerUnit',
  'inviteeBonusUsd',
  'inviterBonusUsd',
  'topupEnabled',
  'services',
  'announcements',
  'models',
  'modelsSource',
  'defaults',
  'latencyMs',
  'error',
]);

function applyStatic(snapshot, staticSnap) {
  for (const key of Object.keys(staticSnap ?? {})) {
    if (!SNAPSHOT_KEYS.has(key)) continue;
    const value = staticSnap[key];
    if (Array.isArray(value)) {
      snapshot[key] = value;
    } else if (value !== undefined) {
      snapshot[key] = value;
    }
  }
}

/** 纯静态快照：基础数据来自 blankSnapshot，动态字段来自 data/static-snaps/<id>.json。 */
export async function probeLocal(site, _get) {
  const staticSnap = await readStatic(site.id);
  const snapshot = blankSnapshot(site, {
    apiOk: true,
    pricingOk: false,
    latencyMs: null,
    error: null,
  });

  snapshot.online = staticSnap?.online ?? true;
  snapshot.modelsSource = staticSnap?.models?.length ? 'public-api' : 'login-required';

  applyStatic(snapshot, staticSnap);
  return snapshot;
}
