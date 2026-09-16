/**
 * 「新用户现在能不能注册」的统一口径。
 *
 * New API 的 /api/status 有两个开关，混着用会把页面写错方向：
 *   register_enabled           —— 总闸。关掉就是不收新用户（OAuth 建号在上游同样走这个判断）
 *   password_register_enabled  —— 只管邮箱 / 密码那张表单。很多站关掉它、只留 GitHub，是防批量注册的常规操作
 *
 * 为什么要专门抽出来：本页链接是邀请链接，两种错都很贵。
 *   - 站点停注了还挂「点此注册 · 首日 $120」→ 用户点进去发现注册不了，下次不会再信这个站点表
 *   - 只是关了邮箱注册就写成「已关闭注册」→ 明明能用 GitHub 进，白劝退一个人
 * 所以四种状态分开说，接口没给字段（AgentRouter 那种旧版面板）就什么都不声称。
 */

/** 账号密码是「登录方式」里唯一不算 OAuth 的一项，注册通道要把它排掉 */
const PASSWORD = '账号密码';

export function signupRoute(snap) {
  const open = snap?.registerOpen;
  const oauth = (snap?.loginMethods ?? []).filter((m) => m !== PASSWORD);

  if (open === false) {
    return {
      state: 'closed',
      short: '暂停注册',
      // 上游把 OAuth 建号也挂在总闸下，所以这里不承诺「GitHub 还能进」，只说明观测到什么
      note: '站点接口自报已关闭新用户注册，现在点进去大概注册不上；已注册的老用户不受影响。',
      oauth,
    };
  }

  if (open === true && snap?.passwordRegister === false && oauth.length) {
    return {
      state: 'oauth',
      short: `仅 ${oauth.join(' / ')} 注册`,
      note: `站点关掉了邮箱密码注册，得用 ${oauth.join(' / ')} 登录建号（防批量注册的常规做法）。`,
      oauth,
    };
  }

  if (open === true) return { state: 'open', short: '开放注册', note: null, oauth };
  return { state: 'unknown', short: null, note: null, oauth };
}

/** 停注的站点不该算进「全注册能拿多少」——那句话是对新用户说的 */
export const acceptsNew = (snap) => signupRoute(snap).state !== 'closed';
