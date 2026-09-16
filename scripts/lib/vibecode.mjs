/**
 * 抓取 RawChat 系「vibe-code」面板（new.sharedchat.cc 这类 Codex 公益站）的公开信息。
 *
 * 这类站点不是 New API，/api/status 一律返回「该接口未接入公益站独立网关」，
 * 真正公开可读的只有两个前端接口：
 *   GET /frontend-api/getConfig       —— 站名、开放了哪些服务（Codex / Claude Code / …）
 *   GET /frontend-api/getLoginConfig  —— 注册开关、登录方式、后端版本、站内公告
 *
 * 每日额度、Base URL 和一键安装脚本都要登录后才下发（后台「使用教程」里生成），
 * 公开接口拿不到，这里不做任何猜测——页面上如实写「登录后台领取」。
 */
import { blankSnapshot, fetchJson } from './newapi.mjs';

/** getConfig 里的服务开关 → 页面上展示的服务名 */
const SERVICES = {
  isAuthCodex: 'Codex',
  isAuthClaude: 'Claude Code',
  isAuthClaude2api: 'Claude API',
  isAuthGemini: 'Gemini',
  isAuthGrok: 'Grok',
  isAuthSora: 'Sora',
  isAuthMidjourney: 'Midjourney',
  isAuthImageVideo: '图片 / 视频',
  isEnableFreeChatgpt: '免费 ChatGPT',
};

/** getLoginConfig 里的登录开关 → 登录方式 */
const LOGINS = {
  isEnableMailRegister: '邮箱',
  isEnableGitHubLogin: 'GitHub',
  isEnableGoogleLogin: 'Google',
  isEnableLinuxDoLogin: 'LinuxDO',
  isEnableWechatLogin: '微信',
  isEnableQQLogin: 'QQ',
};

const labels = (dict, data) =>
  Object.entries(dict)
    .filter(([k]) => data?.[k] === true)
    .map(([, label]) => label);

/** 面板用 code=1 表示成功；HTTP 200 + code=0 是「这个接口没开」，不能当数据用 */
const payload = (res) => (res.ok && res.json?.code === 1 ? res.json.data ?? null : null);

/** getConfig 与 getLoginConfig 在同一目录下，只登记前者，后者顺手推出来 */
const sibling = (url, name) => (url ? String(url).replace(/[^/]+$/, name) : null);

/** get 可注入，单测直接喂真实接口的返回体，不联网 */
export async function probeVibeCode(site, get = fetchJson) {
  const [cfgRes, loginRes] = await Promise.all([
    get(site.statusApi),
    get(sibling(site.statusApi, 'getLoginConfig')),
  ]);

  const cfg = payload(cfgRes);
  const login = payload(loginRes);

  const snapshot = blankSnapshot(site, {
    apiOk: Boolean(cfg),
    pricingOk: false,
    latencyMs: cfgRes.ms ?? null,
    error: cfg ? null : cfgRes.error ?? cfgRes.json?.msg ?? '接口未开放',
  });

  Object.assign(snapshot, {
    systemName: cfg?.siteName ?? login?.siteName ?? null,
    version: login?.backendVersion ?? null,
    registerOpen: typeof login?.isEnableRegister === 'boolean' ? login.isEnableRegister : null,
    passwordRegister: typeof login?.isEnableMailRegister === 'boolean' ? login.isEnableMailRegister : null,
    services: labels(SERVICES, cfg),
    loginMethods: labels(LOGINS, login),
    announcements: login?.notice?.trim()
      ? [{ id: null, date: null, text: login.notice.replace(/\s+/g, ' ').trim().slice(0, 220) }]
      : [],
  });

  return snapshot;
}
