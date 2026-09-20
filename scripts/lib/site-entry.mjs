import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { auditCredits } from './credits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export class SiteEntryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SiteEntryError';
  }
}

export async function loadTemplate() {
  const templatePath = pathToFileURL(path.join(ROOT, 'data', 'new-site.mjs')).href;
  const mod = await import(templatePath);
  return mod.default ?? {};
}

export function validateTemplate(template) {
  if (!template.id || !/^[a-z0-9][a-z0-9-]*$/.test(template.id)) {
    throw new SiteEntryError('id 必填，且只能用小写字母 / 数字 / 连字符（如 mysite）');
  }
  if (!template.name || template.name.includes('填写')) {
    throw new SiteEntryError('name 必填：把模板里的「填写站点名」换成真实站名');
  }
  let signupUrl;
  try {
    signupUrl = new URL(template.signupUrl);
  } catch {
    throw new SiteEntryError('signupUrl 必填：填完整的 https 邀请注册链接（带 aff 参数那个）');
  }
  if (!template.subtitle || template.subtitle.includes('一句话卖点')) {
    throw new SiteEntryError('subtitle 必填：一句话卖点');
  }
  return signupUrl;
}

export function deriveFields(signupUrl, template) {
  const base = `${signupUrl.protocol}//${signupUrl.host}`;
  const homeUrl = base;
  const statusApi = `${base}/api/status`;
  const inviteCode =
    signupUrl.searchParams.get('aff') ??
    signupUrl.searchParams.get('inviteCode') ??
    null;

  const c = template.credits ?? {};
  const credits = {
    signup: c.signup ?? null,
    invite: c.invite ?? null,
    dailyCheckin: c.dailyCheckin ?? null,
    approx: false,
    ...(c.unit ? { unit: c.unit } : {}),
    ...(c.free ? { free: true } : {}),
  };

  const tags = new Set(['New API', '中转站']);
  if (credits.signup != null || credits.invite != null || credits.free) tags.add('免费额度');
  if (credits.dailyCheckin != null) tags.add('每日签到');
  tags.add('Claude Code');
  tags.add('Codex');

  const entry = {
    id: template.id,
    name: template.name,
    subtitle: template.subtitle,
    recommended: false,
    credits,
    signupUrl: template.signupUrl,
    ...(inviteCode ? { inviteCode } : {}),
    homeUrl,
    docsUrl: template.docsUrl ?? null,
    statusApi,
    pricingApi: `${base}/api/pricing`,
    mirrors: template.mirrors ?? [],
    tags: [...tags],
    highlights: template.highlights ?? [],
    endpoints: { anthropic: homeUrl, openai: `${base}/v1` },
    modelsNote: template.modelsNote ?? null,
    register: template.register ?? { methods: [], requirements: [] },
    earnMore: template.earnMore ?? [],
    caveats: template.caveats ?? [],
    community: template.community ?? [],
  };

  return { entry, inviteCode, statusApi, base, credits };
}

export async function appendEntry(entry, templateId) {
  const sitesPath = path.join(ROOT, 'data', 'sites.json');
  const { meta, sites } = JSON.parse(await readFile(sitesPath, 'utf8'));

  if (sites.some((s) => s.id === entry.id)) {
    throw new SiteEntryError(`id ${entry.id} 已存在，换个 id，或直接编辑 data/sites.json 里那条`);
  }

  sites.push(entry);
  await writeFile(sitesPath, `${JSON.stringify({ meta, sites }, null, 2)}\n`, 'utf8');

  const warns = auditCredits(sites, { sites: [] }).filter((w) => w.startsWith(entry.name));
  return { entry, warns };
}

export function formatImportResult(entry, inviteCode, statusApi, base, warns) {
  const lines = [
    `✔ 已把 ${entry.name}（${entry.id}）并入 data/sites.json`,
    `  注册链接   ${entry.signupUrl}`,
    `  状态接口   ${statusApi}（refresh 自动探测）`,
    `  API 端点   ${base}（Anthropic）/ ${base}/v1（OpenAI）`,
  ];
  if (inviteCode) lines.push(`  邀请码     ${inviteCode}（已从链接自动提取）`);
  for (const w of warns) lines.push(`  ⚠ ${w}`);
  lines.push('', '下一步：');
  lines.push('  1. 把 data/new-site.mjs 重置回模板（避免下次误加），或直接删掉里面的内容再填下一个站');
  lines.push('  2. npm run all   （测试 → 探测 → 生成 README / 页面 → 健康检查）');
  lines.push('  3. 额度数字想补的话，登录站点后台「钱包 / 额度」页确认，改 data/sites.json 对应站点的 credits 再 build');
  return lines.join('\n');
}
