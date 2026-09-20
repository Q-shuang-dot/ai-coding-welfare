#!/usr/bin/env node
/**
 * 新增平台：填好 data/new-site.mjs 后跑这个脚本，自动并入 data/sites.json。
 *   node scripts/add.mjs
 *
 * 设计原则：用户只填 4 个必填项（id / name / signupUrl / subtitle），
 * 其余字段全部从注册链接的域名推导（homeUrl / statusApi / endpoints），
 * 探测不到的留空，交给 `npm run refresh` 从站点公开接口自动补全。
 */
import {
  loadTemplate,
  validateTemplate,
  deriveFields,
  appendEntry,
  formatImportResult,
  SiteEntryError,
} from './lib/site-entry.mjs';

try {
  const template = await loadTemplate();
  const signupUrl = validateTemplate(template);
  const { entry, inviteCode, statusApi, base } = deriveFields(signupUrl, template);
  const { warns } = await appendEntry(entry, template.id);
  console.log(formatImportResult(entry, inviteCode, statusApi, base, warns));
} catch (error) {
  if (error instanceof SiteEntryError) {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  }
  throw error;
}
