
let CFG = null, STICKY = {}, BREAKER = {}, STATS = {}, AUDIT = {}, SKILLS = [];
let LAN_IPS = [], LISTEN_HOST = "127.0.0.1";
const THEME_KEY = "gcmp-admin-theme";
const NAV_KEY = "gcmp-admin-nav";

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function applyTheme(theme) {
  const safeTheme = ["dark", "light", "aurora"].includes(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", safeTheme);
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === safeTheme);
  });
  localStorage.setItem(THEME_KEY, safeTheme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
  });
}

/* ---------- 左侧分类切换 ---------- */
function showSection(id) {
  const target = document.getElementById(id) ? id : "sec-overview";
  document.querySelectorAll(".sec").forEach(s => s.classList.toggle("active", s.id === target));
  document.querySelectorAll(".navlink").forEach(b => b.classList.toggle("active", b.dataset.sec === target));
  localStorage.setItem(NAV_KEY, target);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initNav() {
  document.querySelectorAll(".navlink").forEach(btn => {
    btn.addEventListener("click", () => showSection(btn.dataset.sec));
  });
  showSection(localStorage.getItem(NAV_KEY) || "sec-overview");
  syncBarHeight();
  new ResizeObserver(syncBarHeight).observe(document.querySelector(".topbar"));
}

// 顶栏会换行，高度不固定，侧栏 sticky 的吸附位置要跟着它走
function syncBarHeight() {
  const h = document.querySelector(".topbar").getBoundingClientRect().height;
  document.documentElement.style.setProperty("--bar-h", Math.round(h) + "px");
}

// 签到站地址：优先用 site 字段，否则取 baseUrl 的域名根；只允许 http(s) 以防 javascript: 注入
function siteOf(up) {
  const raw = (up.site || up.baseUrl || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : "https://" + raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return up.site ? u.href : u.origin + "/";
  } catch { return ""; }
}

function toast(msg, ok = true) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast " + (ok ? "ok" : "err");
  setTimeout(() => t.className = "toast", 2600);
}

async function loadAll() {
  try {
    const r = await fetch("/admin/api/config");
    const j = await r.json();
    CFG = j.config; STICKY = j.sticky || {}; BREAKER = j.breaker || {}; STATS = j.stats || {};
    SKILLS = Array.isArray(j.skills) ? j.skills : [];
    LAN_IPS = j.lanIps || []; LISTEN_HOST = j.listenHost || "127.0.0.1";
    document.getElementById("status").className = "badge ok";
    document.getElementById("status").textContent = `运行中 · ${Object.keys(CFG.upstreams).length} 上游 · ${CFG.models.length} 模型`;
    document.getElementById("endpoint").textContent =
      `${location.hostname}:${location.port}${(CFG.listen||{}).port === +location.port ? "" : " (端口已改,需重启网关)"}`;
    document.getElementById("g-proxy").value = CFG.proxy || "";
    document.getElementById("g-open").value = (CFG.timeouts || {}).open ?? 90;
    document.getElementById("g-read").value = (CFG.timeouts || {}).read ?? 300;
    document.getElementById("nav-up").textContent = Object.keys(CFG.upstreams).length;
    document.getElementById("nav-m").textContent = CFG.models.length;
    document.getElementById("nav-skills").textContent = SKILLS.length;
    renderUpstreams(); renderModels(); renderSkills(); renderBridge(j.bridge); renderStats();
    renderAccess();
    applyAudit();   // 保留上一次审计结果，避免刷新后状态列全变回「待测」
  } catch (e) {
    const s = document.getElementById("status");
    s.className = "badge err"; s.textContent = "网关未响应";
  }
}

/* ---------- 调用统计 / 熔断 ---------- */
function renderStats() {
  const box = document.getElementById("stats");
  const rows = Object.entries(STATS).sort((a, b) => b[1].calls - a[1].calls);
  const totCalls = rows.reduce((s, [, v]) => s + v.calls, 0);
  const totOk = rows.reduce((s, [, v]) => s + (v.ok || 0), 0);
  const totIn = rows.reduce((s, [, v]) => s + (v.prompt_tokens || 0), 0);
  const totOut = rows.reduce((s, [, v]) => s + (v.completion_tokens || 0), 0);
  const totCached = rows.reduce((s, [, v]) => s + (v.cached_tokens || 0), 0);
  const totCost = rows.reduce((s, [, v]) => s + (v.cost || 0), 0);
  const unknown = rows.filter(([, v]) => v.ok && v.cost == null).length;
  document.getElementById("stats-sum").textContent =
    totCalls ? `共 ${rows.length} 条路由` : "暂无数据";

  if (!rows.length) {
    box.innerHTML = `<div class="muted" style="padding:8px">网关重启后还没有请求经过</div>`;
    return;
  }

  const rate = totCalls ? Math.round(totOk / totCalls * 100) : 0;
  const cards = [
    { n: fmtNum(totCalls), l: "总调用", s: `${rows.length} 条路由` },
    { n: rate + "%", l: "总成功率", s: `${totCalls - totOk} 次失败`,
      cls: rate >= 90 ? "ok-text" : rate >= 50 ? "warn-text" : "err-text" },
    { n: fmtNum(totIn), l: "输入 token", s: totCached ? `缓存命中 ${fmtNum(totCached)}` : "无缓存命中" },
    { n: fmtNum(totOut), l: "输出 token" },
    { n: "$" + totCost.toFixed(2), l: "已知花费", s: unknown ? `${unknown} 条未配价格` : "全部已配价格" },
  ];

  box.innerHTML = `
    <div class="stat-cards">
      ${cards.map(c => `<div class="box">
        <div class="n ${c.cls || ""}">${c.n}</div>
        <div class="l">${c.l}</div>
        <div class="s">${c.s || "&nbsp;"}</div>
      </div>`).join("")}
    </div>
    <table class="stats">
      <colgroup>
        <col class="c-route"><col class="c-calls"><col class="c-rate"><col class="c-lat">
        <col class="c-tok"><col class="c-hit"><col class="c-cost"><col class="c-served"><col class="c-brk">
      </colgroup>
      <thead><tr>
        <th>路由</th><th class="num">调用</th><th>成功率</th><th>延迟 均/最慢</th>
        <th class="num">Token 入/出</th><th class="mid">缓存命中</th><th class="num">花费</th>
        <th class="mid">实际模型</th><th class="mid">熔断</th>
      </tr></thead>
      <tbody>
      ${rows.map(([k, v]) => {
        const r = v.calls ? Math.round(v.ok / v.calls * 100) : 0;
        const b = BREAKER[k];
        const brk = b && b.cooldown_left
          ? `<span class="route-status err" title="${esc(b.reason)}">冷却 ${b.cooldown_left}s</span>`
          : (b && b.fails ? `<span class="route-status wait" title="${esc(b.reason)}">失败 ${b.fails}</span>`
                          : `<span class="muted">—</span>`);
        const slash = k.indexOf("/");
        const up = slash > 0 ? k.slice(0, slash) : k;
        const asked = slash > 0 ? k.slice(slash + 1) : "";
        const served = modelMismatch(asked, v.served)
          ? `<span class="route-status err" title="请求 ${esc(asked)}，实际返回 ${esc(v.served)}">已换</span>`
          : `<span class="muted">一致</span>`;
        const hit = v.prompt_tokens && v.cached_tokens
          ? `${Math.round(v.cached_tokens / v.prompt_tokens * 100)}%`
          : `<span class="muted">—</span>`;
        const cost = v.cost != null
          ? `<span class="mono" title="每次均摊 $${(v.cost / Math.max(v.ok, 1)).toFixed(4)}">$${v.cost.toFixed(2)}</span>`
          : `<span class="muted" title="该上游未配 pricing">未知</span>`;
        return `<tr>
          <td><div class="rk" title="${esc(k)}"><b>${esc(up)}</b><span>${esc(asked) || "—"}</span></div></td>
          <td class="num mono">${v.calls}</td>
          <td class="${r >= 90 ? "ok-text" : r >= 50 ? "warn-text" : "err-text"}">
            <div class="two-line"><span>${r}%</span>${v.fail ? `<em>${v.fail} 失败</em>` : ""}</div></td>
          <td><div class="two-line mono"><span>${v.avg_latency}s</span><em>最慢 ${v.latency_max}s</em></div></td>
          <td class="num mono"><div class="two-line"><span>${fmtNum(v.prompt_tokens)}</span><em>${fmtNum(v.completion_tokens)}</em></div></td>
          <td class="mid">${hit}</td>
          <td class="num">${cost}</td>
          <td class="mid">${served}</td>
          <td class="mid">${brk}</td>
        </tr>`;
      }).join("")}
      </tbody>
    </table>`;
}

function fmtNum(n) {
  n = +n || 0;
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
}

/* 与网关 model_mismatch() 保持一致：归一化后互为子串就算同一个模型，
   避免 "qwen/qwen3.8-27b" vs "Qwen3.8-27B" 这类前缀/大小写差异误报 */
function modelMismatch(asked, served) {
  if (!asked || !served) return false;
  const a = asked.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const b = served.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!a || !b) return false;
  return !a.includes(b) && !b.includes(a);
}

async function resetStats() {
  if (!confirm("清空调用统计与熔断状态？")) return;
  const r = await fetch("/admin/api/stats", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: "{}" });
  toast((await r.json()).ok ? "已清空统计" : "清空失败", r.ok);
  loadAll();
}

/* ---------- 上游 ---------- */
function renderUpstreams() {
  const wrap = document.getElementById("upstreams");
  document.getElementById("up-count").textContent = Object.keys(CFG.upstreams).length;
  wrap.innerHTML = "";
  for (const [name, up] of Object.entries(CFG.upstreams)) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="subpan">
        <span class="pan-title"><span class="ico">🔌</span>连接</span>
        <div class="fld"><label>名称（路由引用用）</label>
          <input data-k="name" value="${esc(name)}" spellcheck="false"></div>
        <div class="fld"><label>Base URL</label>
          <input class="mono" data-k="baseUrl" value="${esc(up.baseUrl)}" spellcheck="false"></div>
        <div class="fld"><label title="默认走 /chat/completions；该路径被 Cloudflare 等 WAF 封禁的站点（如 justwoker）换旧端点 /completions 可绕过">聊天端点（WAF 封禁时换旧端点）</label>
          <select class="mono" data-k="chatPath">
            <option value="" ${!up.chatPath ? "selected" : ""}>默认 /chat/completions</option>
            <option value="/completions" ${up.chatPath === "/completions" ? "selected" : ""}>旧端点 /completions</option>
            ${up.chatPath && up.chatPath !== "/completions"
              ? `<option value="${esc(up.chatPath)}" selected>${esc(up.chatPath)}</option>` : ""}
          </select></div>
        <div class="fld"><label>站点地址（签到用，留空则按 Base URL 推导）</label>
          <div class="key-row">
            <input data-k="site" placeholder="${esc(siteOf(up))}" value="${esc(up.site || "")}" spellcheck="false">
            <a class="site-open" href="${esc(siteOf(up))}" target="_blank" rel="noopener noreferrer"
               title="打开站点签到">🔗</a>
          </div></div>
      </div>
      <div class="subpan">
        <span class="pan-title"><span class="ico">🔑</span>认证与网络</span>
        <div class="fld"><label>API Key（已脱敏，留原样即保持不变）</label>
          <div class="key-row">
            <input class="mono" data-k="apiKey" type="password" value="${esc(up.apiKey || "")}" spellcheck="false">
            <button class="key-btn" onclick="toggleKey(this)" title="显示密钥">👁</button>
          </div></div>
        <div class="fld"><label>User-Agent（可选，部分上游有客户端白名单）</label>
          <div class="ua-row">
            <input data-k="ua" value="${esc((up.headers||{})["User-Agent"] || "")}" spellcheck="false">
            <label class="chip" title="直连，不走全局代理"><input type="checkbox" data-k="noProxy" ${up.noProxy ? "checked" : ""}>noProxy</label>
          </div></div>
      </div>
      <div class="subpan">
        <span class="pan-title"><span class="ico">🧮</span>配额与计费</span>
        <div class="g2">
          <div class="fld"><label title="限流窗口内最多请求次数，留空 = 不限">请求上限（留空=不限）</label>
            <input data-k="rlLimit" type="number" min="1" placeholder="如 5"
              value="${(up.rateLimit || {}).limit ?? ""}"></div>
          <div class="fld"><label title="限流窗口时长，与请求上限配套">时间窗口（秒）</label>
            <input data-k="rlWindow" type="number" min="1" placeholder="60"
              value="${(up.rateLimit || {}).window ?? ""}"></div>
        </div>
        <div class="g3">
          <div class="fld"><label>计费方式</label>
            <select data-k="pType">
              <option value="" ${!up.pricing ? "selected" : ""}>未知</option>
              <option value="per_call" ${up.pricing?.type === "per_call" ? "selected" : ""}>按次</option>
              <option value="per_token" ${up.pricing?.type === "per_token" ? "selected" : ""}>按 token</option>
            </select></div>
          <div class="fld"><label>${up.pricing?.type === "per_token" ? "输入价" : "单价"}</label>
            <input data-k="pA" type="number" step="0.0001" min="0" placeholder="如 0.3"
              value="${up.pricing?.type === "per_token" ? (up.pricing.in ?? "") : (up.pricing?.price ?? "")}"></div>
          <div class="fld"><label>输出价</label>
            <input data-k="pB" type="number" step="0.0001" min="0" placeholder="按 token 时填"
              ${up.pricing?.type === "per_token" ? "" : "disabled"}
              value="${up.pricing?.out ?? ""}"></div>
        </div>
      </div>
      <div class="testacts">
        <div class="trow">
          <input class="test-model mono" placeholder="测试用模型名，可手输或从下拉选" value="${esc(localStorage.getItem("t:" + name) || "")}">
          <button class="primary" onclick="testUp(this)">⚡ 测试上游</button>
        </div>
        <div class="trow">
          <select class="up-models mono" disabled title="点「📋 获取模型列表」拉取该上游的模型，选中即填入上方模型名并直接测试">
            <option value="">— 模型列表（未获取）—</option>
          </select>
          <button onclick="fetchModels(this)">📋 获取模型列表</button>
        </div>
      </div>
      <div class="footbar">
        <button class="soft" onclick="queryBalance(this, false)">💰 查余额</button>
        <button class="danger" onclick="delUpstream(this)">删除该上游</button>
      </div>
      <div class="result" data-role="result"></div>`;
    card.querySelectorAll("[data-k]").forEach(el => el.addEventListener("change", () => applyUpstream(card, name)));
    // 模型列表下拉：选中即填入测试模型名并直接测
    card.querySelector(".up-models").addEventListener("change", () => {
      const ms = card.querySelector(".up-models");
      if (!ms.value) { return; }
      const input = card.querySelector(".test-model");
      input.value = ms.value;
      localStorage.setItem("t:" + name, ms.value);
      const btn = [...card.querySelectorAll("button")].find(b => b.textContent.includes("测试上游"));
      if (btn) { testUp(btn); }
    });
    // 切换计费方式后标签文案要跟着变，只能整卡重绘
    card.querySelector('[data-k="pType"]').addEventListener("change", () => renderUpstreams());
    const nameInput = card.querySelector('[data-k="name"]');
    nameInput.addEventListener("change", () => {
      const newName = nameInput.value.trim();
      if (!newName || newName === name) { return; }
      if (CFG.upstreams[newName]) { toast("该名称已存在", false); nameInput.value = name; return; }
      CFG.upstreams[newName] = CFG.upstreams[name]; delete CFG.upstreams[name];
      CFG.models.forEach(m => (m.route || []).forEach(r => { if (r.upstream === name) r.upstream = newName; }));
      renderUpstreams(); renderModels();
    });
    wrap.appendChild(card);
  }
  renderSiteLinks();
}

// 顶部签到入口：本机地址(127.0.0.1/localhost)不是公益站，不列出
function renderSiteLinks() {
  const box = document.getElementById("site-links");
  const items = Object.entries(CFG.upstreams)
    .map(([name, up]) => [name, siteOf(up)])
    .filter(([, url]) => url && !/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(url));
  box.innerHTML = items.length
    ? items.map(([name, url]) =>
        `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(name)}</a>`).join("")
    : `<span class="muted">暂无可打开的站点</span>`;
}

/* ---------- codex 桥接 ---------- */
function renderBridge(b) {
  if (!b) return;
  CFG.bridge = Object.assign({}, CFG.bridge, { enabled: b.enabled, port: b.port });
  document.getElementById("bridge-auto").checked = b.enabled;
  const badge = document.getElementById("bridge-badge");
  badge.className = "badge " + (b.running ? "ok" : "err");
  badge.textContent = b.running ? `运行中 · 端口 ${b.port}` : "未运行";
  document.getElementById("bridge-info").textContent = b.running && !b.managed
    ? "当前这个桥是外部启动的，网关的「停止」按钮管不到它，需用 stop-bridge.bat"
    : "sharedchat 上游依赖它，开关状态保存在 config.json";
}

async function toggleBridgeAuto() {
  const on = document.getElementById("bridge-auto").checked;
  CFG.bridge = Object.assign({}, CFG.bridge, { enabled: on });
  await saveConfig();
  if (on) await bridgeAction("start");
}

async function bridgeAction(action) {
  const btn = document.getElementById(action === "start" ? "btn-bridge-start" : "btn-bridge-stop");
  const old = btn.textContent; btn.disabled = true; btn.textContent = "…";
  try {
    const r = await fetch("/admin/api/bridge", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json();
    renderBridge(j.bridge);
    toast((action === "start" ? "启动桥接: " : "停止桥接: ") + j.message, j.ok);
  } catch (e) {
    toast("请求失败: " + e.message, false);
  } finally { btn.disabled = false; btn.textContent = old; }
}

function applyUpstream(card, name) {
  const up = CFG.upstreams[name]; if (!up) return;
  const g = k => card.querySelector(`[data-k="${k}"]`);
  up.baseUrl = g("baseUrl").value.trim();
  up.apiKey = g("apiKey").value.trim();
  up.noProxy = g("noProxy").checked;
  const chatPath = g("chatPath").value;
  if (chatPath) up.chatPath = chatPath; else delete up.chatPath;
  const site = g("site").value.trim();
  if (site) up.site = site; else delete up.site;
  card.querySelector(".site-open").href = siteOf(up) || "#";
  g("site").placeholder = siteOf({ baseUrl: up.baseUrl });
  renderSiteLinks();
  const ua = g("ua").value.trim();
  if (ua) { up.headers = { ...(up.headers || {}), "User-Agent": ua }; }
  else if (up.headers) { delete up.headers["User-Agent"]; if (!Object.keys(up.headers).length) delete up.headers; }
  const rlLimit = +g("rlLimit").value;
  if (rlLimit > 0) up.rateLimit = { limit: rlLimit, window: +g("rlWindow").value || 60 };
  else delete up.rateLimit;
  applyPricing(up, g);
}

// pricing 的 models 子表（各模型单独定价）只能在 config.json 里手写，这里只改默认值
function applyPricing(up, g) {
  const type = g("pType").value;
  const a = parseFloat(g("pA").value), b = parseFloat(g("pB").value);
  g("pB").disabled = type !== "per_token";
  if (!type) { delete up.pricing; return; }
  const sub = up.pricing?.models;
  if (type === "per_call") {
    up.pricing = Number.isFinite(a) ? { type: "per_call", price: a } : undefined;
  } else {
    up.pricing = (Number.isFinite(a) || Number.isFinite(b))
      ? { type: "per_token", in: Number.isFinite(a) ? a : 0, out: Number.isFinite(b) ? b : 0 }
      : undefined;
  }
  if (!up.pricing) delete up.pricing;
  else if (sub) up.pricing.models = sub;
}

function addUpstream() {
  let i = 1, name = "new-upstream";
  while (CFG.upstreams[name]) name = `new-upstream-${++i}`;
  CFG.upstreams[name] = { baseUrl: "https://", apiKey: "" };
  renderUpstreams();
  document.querySelector(`#upstreams input[data-k="name"][value="${name}"]`)?.focus();
}
function delUpstream(btn) {
  const name = btn.closest(".card").querySelector('[data-k="name"]').value.trim();
  const used = CFG.models.filter(m => (m.route || []).some(r => r.upstream === name));
  if (used.length && !confirm(`模型 ${used.map(m => m.id).join(", ")} 的路由仍在使用该上游，删除后其路由将失效。继续？`)) return;
  delete CFG.upstreams[name];
  CFG.models.forEach(m => m.route = (m.route || []).filter(r => r.upstream !== name));
  renderUpstreams(); renderModels();
}
function toggleKey(btn) {
  const inp = btn.closest(".card").querySelector('[data-k="apiKey"]');
  inp.type = inp.type === "password" ? "text" : "password";
  const show = inp.type === "text";
  btn.textContent = show ? "🙈" : "👁";
  btn.title = show ? "隐藏密钥" : "显示密钥";
}

/* ---------- 获取上游模型列表 ---------- */
async function fetchModels(btn) {
  const card = btn.closest(".card");
  const name = card.querySelector('[data-k="name"]').value.trim();
  const up = CFG.upstreams[name];
  if (!up) { toast("上游不存在", false); return; }
  applyUpstream(card, name);
  if (!up.baseUrl) { toast("请先填 Base URL", false); return; }
  const sel = card.querySelector(".up-models");
  const res = card.querySelector(".result");
  btn.disabled = true;
  res.className = "result wait"; res.textContent = "获取模型列表中…（最长 25 秒）";
  try {
    const r = await fetch("/admin/api/models", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, baseUrl: up.baseUrl, apiKey: up.apiKey,
        headers: up.headers, noProxy: up.noProxy, chatPath: up.chatPath }) });
    const j = await r.json();
    if (j.ok) {
      sel.innerHTML = '<option value="">— 选择模型以直接测试（' + j.count + ' 个）—</option>' +
        j.models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
      sel.disabled = false;
      res.className = "result ok";
      res.textContent = `✅ 获取到 ${j.count} 个模型（${j.latency}s），选一个即直接测试`;
    } else {
      sel.innerHTML = '<option value="">— 获取失败 —</option>';
      sel.disabled = true;
      res.className = "result err";
      res.textContent = "❌ " + (j.error || "未知错误");
    }
  } catch (e) {
    sel.disabled = true;
    res.className = "result err"; res.textContent = "❌ " + e.message;
  }
  btn.disabled = false;
}

async function testUp(btn) {
  const card = btn.closest(".card");
  const name = card.querySelector('[data-k="name"]').value.trim();
  const up = CFG.upstreams[name];
  applyUpstream(card, name);
  const model = card.querySelector(".test-model").value.trim();
  if (!model) { toast("请填写测试用模型名", false); return; }
  localStorage.setItem("t:" + name, model);
  const res = card.querySelector(".result");
  res.className = "result wait"; res.textContent = "测试中…（最长 60 秒）";
  btn.disabled = true;
  try {
    const r = await fetch("/admin/api/test", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, model, baseUrl: up.baseUrl, apiKey: up.apiKey,
        headers: up.headers, noProxy: up.noProxy, chatPath: up.chatPath }) });
    const j = await r.json();
    res.className = "result " + (j.ok ? "ok" : "err");
    res.textContent = j.ok ? `✅ ${j.latency}s · ${j.snippet}` : `❌ ${j.latency}s · ${j.error}`;
  } catch (e) {
    res.className = "result err"; res.textContent = "❌ " + e.message;
  }
  btn.disabled = false;
}

/* ---------- 余额 ---------- */
function fmtBal(j) {
  if (!j.ok) return `❌ ${j.error}`;
  if (j.unlimited) return `♾️ 不限额 · 已用 $${(j.used ?? 0).toFixed(2)}`;
  return `💰 剩余 $${j.remaining.toFixed(2)} / 总额 $${j.total.toFixed(2)} · 已用 $${(j.used ?? 0).toFixed(2)}`;
}

async function queryBalance(btn, quiet) {
  const card = btn.closest(".card");
  const name = card.querySelector('[data-k="name"]').value.trim();
  const up = CFG.upstreams[name];
  if (!up) { if (!quiet) toast("上游不存在", false); return null; }
  applyUpstream(card, name);
  const res = card.querySelector(".result");
  res.className = "result wait"; res.textContent = "查询余额中…";
  if (btn) btn.disabled = true;
  let j = null;
  try {
    const r = await fetch("/admin/api/balance", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, baseUrl: up.baseUrl, apiKey: up.apiKey,
        headers: up.headers, noProxy: up.noProxy, chatPath: up.chatPath }) });
    j = await r.json();
    res.className = "result " + (j.ok ? "ok" : "err");
    res.textContent = fmtBal(j);
  } catch (e) {
    res.className = "result err"; res.textContent = "❌ " + e.message;
  }
  if (btn) btn.disabled = false;
  return j;
}

async function queryAllBalances() {
  const btn = document.getElementById("btn-bal-all");
  btn.disabled = true; btn.textContent = "查询中…";
  const cards = [...document.querySelectorAll("#upstreams .card")];
  // 串行查询避免同时打太多请求
  for (const c of cards) {
    const b = [...c.querySelectorAll("button")].find(x => x.textContent.includes("查余额"));
    await queryBalance(b, true);
  }
  btn.disabled = false; btn.textContent = "💰 查询全部余额";
}

/* ---------- 模型 ---------- */
function renderSkills() {
  const wrap = document.getElementById("skills");
  document.getElementById("skill-count").textContent = `${SKILLS.length} 个可用`;
  if (!SKILLS.length) {
    wrap.innerHTML = `<div class="card muted">未发现有效 Skill，请检查项目的 .github/skills 目录。</div>`;
    return;
  }
  wrap.innerHTML = SKILLS.map(skill => {
    const models = CFG.models.filter(m => (m.skills || []).includes(skill.name)).map(m => m.id);
    return `<div class="card skill-card">
      <div class="skill-name">${esc(skill.display_name || skill.name)}</div>
      <div class="skill-id"><span>机器标识：</span><span class="mono">${esc(skill.name)}</span></div>
      <div class="skill-intro">${esc(skill.display_description || skill.description || "无备注介绍")}</div>
      <div class="skill-meta">
        <div class="skill-path mono">.github/skills/${esc(skill.name)}/SKILL.md · ${Math.ceil((skill.size || 0) / 1024)} KB</div>
        <div class="skill-hint">${models.length
          ? `已绑定：${models.map(m => `<span class="chip">${esc(m)}</span>`).join("")}`
          : "尚未绑定任何逻辑模型"}</div>
      </div>
    </div>`;
  }).join("");
}

function renderModels() {
  const wrap = document.getElementById("models");
  document.getElementById("m-count").textContent = CFG.models.length;
  wrap.innerHTML = "";
  for (const m of CFG.models) {
    const card = document.createElement("div");
    card.className = "card";
    const upOpts = Object.keys(CFG.upstreams);
    let rows = (m.route || []).map((r, i) => `
      <tr>
        <td>${i === 0 ? "主" : i + 1}${m.sticky !== false && STICKY[m.id] === r.upstream ? ' <span class="sticky-mark" title="当前粘性上游">★</span>' : ""}</td>
        <td><div style="display:flex;gap:4px;align-items:center">
          <select data-i="${i}" data-f="upstream" style="flex:1;min-width:0">
            ${upOpts.map(u => `<option value="${esc(u)}" ${u === r.upstream ? "selected" : ""}>${esc(u)}</option>`).join("")}
          </select>
          <button class="icon-btn" onclick="topRoute(this)" title="置顶：直接把这个供应商放到第 1 位">置顶</button>
        </div></td>
        <td><input data-i="${i}" data-f="model" value="${esc(r.model)}" spellcheck="false"></td>
        <td style="width:86px; text-align:center"><select data-i="${i}" data-f="vision" style="width:100%">
          <option value="" ${r.vision === undefined ? "selected" : ""}>通用</option>
          <option value="1" ${r.vision === true ? "selected" : ""}>仅图片</option>
          <option value="0" ${r.vision === false ? "selected" : ""}>不接图</option>
        </select></td>
        <td style="width:64px; text-align:center; white-space:nowrap"><label style="margin:0; cursor:pointer"
          title="勾选=该上游会静默丢弃 tools 参数，带工具调用的请求会绕开它">
          <input type="checkbox" data-i="${i}" data-f="noTools" ${r.noTools ? "checked" : ""} style="width:auto"></label></td>
        <td style="width:64px; text-align:center; white-space:nowrap"><label style="margin:0; cursor:pointer">
          <input type="checkbox" data-i="${i}" data-f="noStream" ${r.noStream ? "checked" : ""} style="width:auto"></label></td>
        <td style="width:70px"><input class="tm mono" data-i="${i}" data-f="timeout" type="number"
          placeholder="秒" value="${r.timeout || ""}"></td>
        <td style="width:200px; white-space:nowrap">
          <div class="route-status-inline">
            <button class="icon-btn" data-route-test onclick="testRoute(this)" title="单独测试该路由">测试</button>
            <span class="route-status wait" data-status="${i}" onclick="testRoute(this.closest('tr').querySelector('[data-route-test]'))" title="单独测试该路由">待测</span>
            <span class="route-summary" data-summary="${i}">未测试</span>
          </div>
        </td>
        <td class="route-insight">${routeInsight(r)}</td>
        <td style="width:86px; white-space:nowrap; text-align:center">
          <button class="icon-btn" onclick="moveRoute(this,-1)" title="上移">↑</button>
          <button class="icon-btn" onclick="moveRoute(this,1)" title="下移">↓</button>
          <button class="icon-btn danger" onclick="delRoute(this)" title="删除">✕</button>
        </td>
      </tr>`).join("");
    if (!rows) rows = `<tr><td colspan="10" class="muted" style="padding:10px">暂无路由，请添加</td></tr>`;
    const prefUp = m.sticky !== false && STICKY[m.id] ? STICKY[m.id]
      : (m.route || [])[0] ? (m.route[0].upstream || "") : "";
    const prefOpts = [...new Set((m.route || []).map(r => r.upstream).filter(Boolean))];
    card.innerHTML = `
      <div class="row"><div><label>模型 ID（GCMP 里填的名称）</label>
        <input class="mono" data-f="id" value="${esc(m.id)}" spellcheck="false"></div>
        <div><label>显示名</label><input data-f="name" value="${esc(m.name || "")}"></div>
        <div style="flex:0 0 92px"><label>&nbsp;</label>
        <button class="danger" onclick="delModel(this)">删除</button></div></div>
      <div class="row"><div><label>最大输入 Token</label>
        <input type="number" data-f="maxInputTokens" value="${m.maxInputTokens ?? 200000}"></div>
        <div><label>最大输出 Token</label>
        <input type="number" data-f="maxOutputTokens" value="${m.maxOutputTokens ?? 16384}"></div>
        <div style="flex:0 0 150px"><label>首选上游</label>
          <select data-f="preferred" onchange="setPreferred(this)" title="把该供应商置为首选（移到路由表第 1 位并开启粘性）">
            <option value="">（按下表顺序）</option>
            ${prefOpts.map(u => `<option value="${esc(u)}" ${u === prefUp ? "selected" : ""}>${esc(u)}</option>`).join("")}
          </select></div>
        <div style="flex:0 0 190px"><label>粘性上游</label>
        <label style="margin:0; cursor:pointer; display:flex; align-items:center; gap:6px">
          <input type="checkbox" data-f="sticky" ${m.sticky === false ? "" : "checked"} style="width:auto">
          <span class="muted" style="font-size:12px">关闭=严格按下表顺序</span></label></div></div>
      <div><label>自动注入 Skills</label>
        <div class="skill-picks">
          ${SKILLS.length ? SKILLS.map(skill => `<label title="${esc(skill.display_description || skill.description || skill.name)}">
            <input type="checkbox" data-skill="${esc(skill.name)}" ${(m.skills || []).includes(skill.name) ? "checked" : ""}>
            <span>${esc(skill.display_name || skill.name)}</span></label>`).join("")
            : `<span class="muted">未发现可用 Skill</span>`}
        </div></div>
      <div class="routes-scroll"><table class="routes">
          <tr><th>优先</th><th>上游</th><th>上游模型名</th><th>图片</th><th>无工具</th><th>非流式</th><th>超时</th><th>状态</th><th>近期 / 建议</th><th>排序</th></tr>
          ${rows}
        </table></div>
      <div class="actions">
        <button onclick="addRoute(this)">＋ 添加路由</button>
        <button class="primary" onclick="testModel(this)">⚡ 测试该模型</button>
      </div>
      <div class="result" data-role="result"></div>`;
    card.querySelectorAll("[data-f]").forEach(el => el.addEventListener("change", () => {
      const f = el.dataset.f;
      if (["id", "name"].includes(f)) m[f] = el.value.trim();
      else if (["maxInputTokens", "maxOutputTokens"].includes(f)) m[f] = +el.value || undefined;
      else if (f === "sticky") { if (el.checked) delete m.sticky; else m.sticky = false; }
      if (f === "id") renderModels();
    }));
    card.querySelectorAll("table [data-i]").forEach(el => el.addEventListener("change", () => {
      const r = m.route[+el.dataset.i], f = el.dataset.f;
      if (f === "timeout") r.timeout = +el.value || undefined;
      else if (f === "noStream") r.noStream = el.checked;
      else if (f === "noTools") { if (el.checked) r.noTools = true; else delete r.noTools; }
      else if (f === "vision") { if (el.value === "") delete r.vision; else r.vision = el.value === "1"; }
      else r[f] = f === "model" ? el.value.trim() : el.value;
    }));
    card.querySelectorAll("[data-skill]").forEach(el => el.addEventListener("change", () => {
      const selected = new Set(Array.isArray(m.skills) ? m.skills : []);
      if (el.checked) selected.add(el.dataset.skill); else selected.delete(el.dataset.skill);
      if (selected.size) m.skills = [...selected]; else delete m.skills;
      renderSkills();
    }));
    wrap.appendChild(card);
  }
}

function routeInsight(route) {
  const key = `${route.upstream}/${route.model}`;
  const stat = STATS[key] || {};
  const audit = AUDIT[key] || {};
  const breaker = BREAKER[key];
  const up = CFG.upstreams[route.upstream] || {};
  const calls = Number(stat.recent_calls || 0);
  const rate = Number(stat.recent_success_rate || 0);
  const latency = Number(stat.recent_avg_latency || 0);
  const cost = Number(stat.recent_cost || 0);
  const metrics = calls
    ? `近 ${calls} 次：${rate}% · ${latency}s · $${cost.toFixed(3)}`
    : "近期暂无调用样本";
  let advice = "样本不足，继续观察", level = "";
  if (breaker && breaker.cooldown_left) {
    advice = `熔断中，建议下移或禁用`; level = "err";
  } else if (audit.swapped) {
    advice = "实际模型被替换，不要放主路由"; level = "err";
  } else if (calls >= 3 && rate < 80) {
    advice = `近期失败率高，建议下移`; level = "err";
  } else if (audit.tools && audit.tools.suggest_no_tools) {
    advice = "工具调用失败，建议标记 noTools"; level = "warn";
  } else if (!up.pricing) {
    advice = "未配置 pricing，建议补齐"; level = "warn";
  } else if (calls >= 5 && rate >= 95 && latency <= 5) {
    advice = "稳定且低延迟，建议置顶"; level = "ok";
  }
  return `<span class="metric" title="${esc(key)}">${esc(metrics)}</span>`
    + `<span class="advice ${level}">${esc(advice)}</span>`;
}

function addModel() {
  CFG.models.push({ id: "new-model", name: "New Model", maxInputTokens: 200000,
    maxOutputTokens: 16384, route: [] });
  renderModels();
}
function delModel(btn) {
  const id = btn.closest(".card").querySelector('[data-f="id"]').value;
  if (!confirm(`删除模型 ${id}？`)) return;
  CFG.models = CFG.models.filter(m => m.id !== id);
  renderModels();
}
function addRoute(btn) {
  const card = btn.closest(".card");
  const id = card.querySelector('[data-f="id"]').value;
  const m = CFG.models.find(x => x.id === id);
  const firstUp = Object.keys(CFG.upstreams)[0] || "";
  m.route.push({ upstream: firstUp, model: "" });
  renderModels();
}
function delRoute(btn) {
  const card = btn.closest(".card");
  const id = card.querySelector('[data-f="id"]').value;
  const m = CFG.models.find(x => x.id === id);
  const i = btn.closest("tr").rowIndex - 1;
  m.route.splice(i, 1); renderModels();
}
function moveRoute(btn, dir) {
  const card = btn.closest(".card");
  const id = card.querySelector('[data-f="id"]').value;
  const m = CFG.models.find(x => x.id === id);
  const i = btn.closest("tr").rowIndex - 1, j = i + dir;
  if (j < 0 || j >= m.route.length) return;
  [m.route[i], m.route[j]] = [m.route[j], m.route[i]];
  renderModels();
}
function topRoute(btn) {
  const card = btn.closest(".card");
  const id = card.querySelector('[data-f="id"]').value;
  const m = CFG.models.find(x => x.id === id);
  const i = btn.closest("tr").rowIndex - 1;
  if (i <= 0) return;
  m.route.unshift(m.route.splice(i, 1)[0]);
  renderModels();
}
function setPreferred(sel) {
  const card = sel.closest(".card");
  const id = card.querySelector('[data-f="id"]').value;
  const m = CFG.models.find(x => x.id === id);
  const up = sel.value;
  if (!up) { m.sticky = false; renderModels(); return; }
  const i = (m.route || []).findIndex(r => r.upstream === up);
  if (i > 0) m.route.unshift(m.route.splice(i, 1)[0]);
  m.sticky = true;
  renderModels();
}

async function testModel(btn) {
  const card = btn.closest(".card");
  const id = card.querySelector('[data-f="id"]').value.trim();
  if (!CFG.models.find(x => x.id === id)) { toast("请先保存模型 ID", false); return; }
  const res = card.querySelector(".result");
  res.className = "result wait"; res.textContent = "测试中…（按优先级逐个尝试，可能较慢）";
  btn.disabled = true;
  const t0 = Date.now();
  try {
    const r = await fetch("/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: id, max_tokens: 512,
        messages: [{ role: "user", content: "只回复两个字：收到" }] }) });
    const txt = await r.text();
    const upName = r.headers.get("X-Gateway-Upstream");
    const upModel = r.headers.get("X-Gateway-Model");
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    let out;
    try {
      const j = JSON.parse(txt);
      out = j.choices?.[0]?.message?.content ?? txt.slice(0, 160);
    } catch { out = txt.slice(0, 160); }
    res.className = "result " + (r.ok ? "ok" : "err");
    const via = upName ? `【${upName} / ${upModel}】` : "";
    res.textContent = (r.ok ? "✅ " : "❌ ") + `${via} ${secs}s · ${out}`;
    if (r.ok && upName) { highlightRoute(card, upName); }
  } catch (e) {
    res.className = "result err"; res.textContent = "❌ " + e.message;
  }
  btn.disabled = false;
}

async function testRoute(btn) {
  const card = btn.closest(".card");
  const id = card.querySelector('[data-f="id"]').value.trim();
  const m = CFG.models.find(x => x.id === id);
  const tr = btn.closest("tr");
  const routeIdx = Number(tr.querySelector('[data-i]').dataset.i);
  const route = m && m.route && m.route[routeIdx];
  if (!route) { toast("找不到该路由配置", false); return; }
  const up = CFG.upstreams[route.upstream];
  if (!up) { toast(`上游 ${route.upstream} 不存在`, false); return; }

  const statusEl = tr.querySelector('.route-status');
  const summaryEl = tr.querySelector('.route-summary');
  statusEl.className = 'route-status wait';
  statusEl.textContent = '测试中';
  summaryEl.textContent = '请求中...';
  btn.disabled = true;

  try {
    const r = await fetch("/admin/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: route.upstream, model: route.model, baseUrl: up.baseUrl, apiKey: up.apiKey,
        headers: up.headers, noProxy: up.noProxy, chatPath: up.chatPath })
    });
    const j = await r.json();
    const ok = !!j.ok;
    const latency = Number.isFinite(j.latency) ? `${j.latency}s` : '未知';
    const summary = j.ok ? (j.snippet || 'OK') : (j.error || '请求失败');

    statusEl.className = `route-status ${ok ? 'ok' : 'err'}`;
    statusEl.textContent = ok ? '通' : '不通';
    summaryEl.textContent = `${latency} · ${summary}`;
    statusEl.title = summaryEl.textContent;

    toast(ok ? `${route.upstream}/${route.model} 可用` : `${route.upstream}/${route.model} 失败`, ok);
  } catch (e) {
    statusEl.className = 'route-status err';
    statusEl.textContent = '不通';
    summaryEl.textContent = `失败 · ${e.message}`;
    statusEl.title = summaryEl.textContent;
    toast(`${route.upstream}/${route.model} 测试失败`, false);
  } finally {
    btn.disabled = false;
  }
}

/* 深度审计：健康检查只 GET /models，证明不了模型还在架上、余额够不够、
   有没有被静默换后端。这里对每条路由发一次真实最小请求，结果回填到路由表。 */
async function auditRoutes() {
  const btn = document.getElementById("btn-audit");
  const sum = document.getElementById("audit-sum");
  const total = CFG.models.reduce((s, m) => s + (m.route || []).length, 0);
  const withTools = document.getElementById("audit-tools").checked;
  btn.disabled = true;
  btn.textContent = "审计中…";
  sum.style.display = "";
  sum.textContent = `正在逐条实测 ${total} 条路由（同一上游串行以避开并发限制）${withTools ? "，并验证工具调用" : ""}，请稍候…`;
  try {
    const r = await fetch("/admin/api/audit", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tools: withTools }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "审计失败");
    AUDIT = j.routes || {};
    renderModels();
    applyAudit();
    const s = j.summary || {};
    const dead = Object.entries(AUDIT).filter(([, v]) => !v.ok).map(([k]) => k);
    sum.innerHTML = `审计完成：<b>${s.ok}/${s.total}</b> 条可用`
      + (s.swapped ? ` · <span class="err-text">${s.swapped} 条被静默换后端</span>` : "")
      + (s.tools_checked && s.no_tools ? ` · <span class="warn-text">${s.no_tools} 条建议 noTools</span>` : "")
      + (dead.length ? `<br>失效：<span class="mono">${dead.map(esc).join("、")}</span>` : "");
    toast(`审计完成：${s.ok}/${s.total} 条路由可用`, dead.length === 0);
  } catch (e) {
    sum.textContent = "审计失败：" + e.message;
    toast("审计失败", false);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 深度审计";
  }
}

// 把审计结果写回路由表的状态列（renderModels 之后调用）
function applyAudit() {
  if (!Object.keys(AUDIT).length) return;
  document.querySelectorAll("#models .card").forEach(card => {
    const id = card.querySelector('[data-f="id"]').value.trim();
    const m = CFG.models.find(x => x.id === id);
    if (!m) return;
    card.querySelectorAll("tr").forEach(tr => {
      const cell = tr.querySelector("[data-i]");
      if (!cell) return;
      const r = (m.route || [])[Number(cell.dataset.i)];
      const res = r && AUDIT[`${r.upstream}/${r.model}`];
      if (!res) return;
      const st = tr.querySelector(".route-status");
      const sm = tr.querySelector(".route-summary");
      if (!st || !sm) return;
      st.className = `route-status ${res.ok ? "ok" : "err"}`;
      const toolIssue = (res.tools || {}).suggest_no_tools;
      st.textContent = res.ok ? (res.swapped ? "换后端" : toolIssue ? "无工具" : "通") : "不通";
      sm.textContent = `${res.latency}s · ` +
        (res.ok ? (res.swapped ? `实际 ${res.served}` : toolIssue
          ? `建议 noTools${res.tools.error ? `：${res.tools.error}` : ""}`
          : (res.snippet || "OK")) : (res.error || "失败"));
      st.title = sm.textContent;
    });
  });
}

// 在路由表里高亮实际响应的那一行
function highlightRoute(card, upName) {
  card.querySelectorAll("table.routes tr").forEach(tr => tr.classList.remove("hit"));
  const sel = [...card.querySelectorAll('table.routes select[data-f="upstream"]')]
    .find(s => s.value === upName);
  if (sel) sel.closest("tr").classList.add("hit");
}

/* ---------- 统一接入 ---------- */
function copyText(id) {
  const el = document.getElementById(id);
  const txt = el.value ?? el.textContent ?? "";
  const done = () => toast("已复制 ✅");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
  } else fallbackCopy(txt, done);
}
function fallbackCopy(txt, done) {
  const ta = document.createElement("textarea");
  ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch { toast("复制失败", false); }
  ta.remove();
}

function renderAccess() {
  const port = (CFG.listen || {}).port || 15800;
  const hosts = ["127.0.0.1"].concat(LAN_IPS.filter(ip => ip && ip !== "127.0.0.1"));
  const isOpen = LISTEN_HOST === "0.0.0.0";
  const badge = document.getElementById("access-badge");
  badge.className = "badge " + (isOpen ? "ok" : "warn");
  badge.textContent = isOpen ? "局域网开放" : "仅本机";
  const urls = document.getElementById("access-urls");
  urls.innerHTML = hosts.map(h =>
    `<span class="url-chip">http://<span class="mono">${esc(h)}:${port}</span>
      <button class="icon-btn" onclick="copyTextRaw('http://${esc(h)}:${port}')" title="复制地址">复制</button></span>`).join("");
  const keyEl = document.getElementById("access-key");
  keyEl.value = (CFG.access || {}).apiKey || "（未启用）";
  const target = document.getElementById("access-alias-target");
  const alias = CFG.alias || {};
  const aliasName = document.getElementById("access-alias-name").value;
  const cur = alias[aliasName] || CFG.models[0]?.id || "";
  target.innerHTML = CFG.models.map(m =>
    `<option value="${esc(m.id)}" ${m.id === cur ? "selected" : ""}>${esc(m.name || m.id)} (${esc(m.id)})</option>`).join("") ||
    `<option value="">无模型</option>`;
  // 一键接入 GPT 客户端：默认选健康模型（gpt-5.6 优先），避免选到 claude 系死路由
  const cm = document.getElementById("codex-model");
  if (cm && CFG.models && CFG.models.length) {
    const ids = CFG.models.map(m => m.id);
    const defaultPick = ids.includes("gpt-5.6") ? "gpt-5.6"
      : (ids.includes("deepseek") ? "deepseek" : ids[0]);
    cm.innerHTML = CFG.models.map(m =>
      `<option value="${esc(m.id)}" ${m.id === defaultPick ? "selected" : ""}>${esc(m.name || m.id)} (${esc(m.id)})</option>`).join("");
    const hint = document.getElementById("codex-hint");
    if (hint && !hint.textContent.includes("已配置"))
      hint.textContent = `写 responses 协议 → 桌面端/CLI 走 ${defaultPick}`;
  }
  document.getElementById("access-hint").textContent = isOpen
    ? "第三方平台填局域网地址 + 统一模型名 + 上面的接入密钥即可接入，不用把上游 Token 给别人。"
    : `当前仅本机可访问。要开放给局域网，请把 listen.host 改为 0.0.0.0 并重启网关（打开方式：config.json → 重启 start-gateway.bat）。`;
  const cfgOpenAI = `# OpenAI 兼容（VS Code / 各类 SDK）
base_url = http://127.0.0.1:${port}/v1
api_key = ${keyEl.value}
model = ${aliasName}`;
  const cfgAnthropic = `# Anthropic（Claude Code / Claude 桌面端）
export ANTHROPIC_BASE_URL=http://127.0.0.1:${port}
export ANTHROPIC_AUTH_TOKEN=${keyEl.value}
export ANTHROPIC_MODEL=${aliasName}`;
  document.getElementById("access-configs").innerHTML = `
    <div>
      <div class="cfg-head"><span>OpenAI 兼容</span><button onclick="copyTextRaw(this.closest('div').nextElementSibling.innerText)">复制</button></div>
      <pre id="cfg-openai">${esc(cfgOpenAI)}</pre>
    </div>
    <div>
      <div class="cfg-head"><span>Anthropic / Claude</span><button onclick="copyTextRaw(this.closest('div').nextElementSibling.innerText)">复制</button></div>
      <pre id="cfg-anthropic">${esc(cfgAnthropic)}</pre>
    </div>`;
}
function copyTextRaw(txt) {
  const done = () => toast("已复制 ✅");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
  } else fallbackCopy(txt, done);
}
function onAliasTarget() {
  const aliasName = document.getElementById("access-alias-name").value;
  const t = document.getElementById("access-alias-target").value;
  CFG.alias = Object.assign({}, CFG.alias, { [aliasName]: t });
  renderAccess();  // 刷新复制块里的模型名
}
async function rotateAccessKey() {
  const btn = event.target;
  btn.disabled = true;
  try {
    const r = await fetch("/admin/api/access", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (j.ok) {
      CFG.access = Object.assign({}, CFG.access, { enabled: true, apiKey: j.apiKey });
      document.getElementById("access-key").value = j.apiKey;
      renderAccess();
      toast("已生成新密钥，别忘了保存配置 ✅");
    } else toast("生成失败: " + j.error, false);
  } catch (e) { toast("生成失败: " + e.message, false); }
  btn.disabled = false;
}

/* ---------- 一键接入 GPT 客户端（ChatGPT 桌面端 / Codex CLI） ---------- */
async function writeCodexConfig(btn) {
  const model = (document.getElementById("codex-model") || {}).value || "";
  const mlabel = model ? `（${model}）` : "（默认）";
  if (!confirm(`将写入 ~/.codex/config.toml + auth.json 指向本网关\n模型: ${mlabel}\n\n⚠️ ChatGPT 桌面端 与 Codex CLI 共用该文件\n原文件会先备份为 .bak-gcmp，可随时还原\n\n继续？`)) return;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "配置中…";
  try {
    const r = await fetch("/admin/api/write-codex", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
    const j = await r.json();
    if (j.ok) {
      document.getElementById("codex-hint").textContent =
        `已配置 provider=${j.provider} · wire_api=responses · model=${j.model}${j.desktopOk ? "" : "（桌面端可能需重启）"}`;
      toast(`已接入 ✅ 模型 ${j.model}\n桌面端/ChatGPT 与 codex CLI 下次启动即走网关`);
    } else toast("配置失败: " + (j.error || ""), false);
  } catch (e) { toast("配置失败: " + e.message, false); }
  btn.disabled = false;
  btn.textContent = old;
}

/* ---------- 保存 ---------- */
async function saveConfig() {
  CFG.proxy = document.getElementById("g-proxy").value.trim() || null;
  CFG.timeouts = { connect: (CFG.timeouts || {}).connect ?? 25,
    open: +document.getElementById("g-open").value || 90,
    read: +document.getElementById("g-read").value || 300 };
  const keyEl = document.getElementById("access-key");
  if (keyEl) {
    const key = keyEl.value.trim();
    CFG.access = Object.assign({}, CFG.access || {}, { enabled: !!key, apiKey: key });
  }
  const aliasName = document.getElementById("access-alias-name");
  const aliasTarget = document.getElementById("access-alias-target");
  if (aliasName && aliasTarget) {
    CFG.alias = Object.assign({}, CFG.alias || {}, { [aliasName.value]: aliasTarget.value });
  }
  const clean = JSON.parse(JSON.stringify(CFG, (k, v) => v === undefined ? undefined : v));
  const btn = document.getElementById("btn-save");
  btn.disabled = true;
  try {
    const r = await fetch("/admin/api/config", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean) });
    const j = await r.json();
    if (j.ok) { toast("已保存并热加载 ✅"); await loadAll(); }
    else toast("保存失败: " + j.error, false);
  } catch (e) { toast("保存失败: " + e.message, false); }
  btn.disabled = false;
}

/* ---------- 同步到 VS Code ---------- */
async function syncToVSCode() {
  const btn = document.getElementById("btn-sync");
  btn.disabled = true;
  btn.textContent = "同步中…";
  try {
    // 先获取差异状态
    const r = await fetch("/admin/api/vscode-status", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: CFG.models }) });
    const j = await r.json();
    if (!j.ok) { toast("同步失败：" + j.error, false); return; }
    // 如果有额外模型，提示用户
    if (j.extra && j.extra.length > 0) {
      const msg = `检测到以下模型已不存在于网关配置，是否删除？\n\n${j.extra.join("\n")}`;
      if (!confirm(msg)) {
        toast("已取消同步");
        return;
      }
    }
    // 执行同步（带删除多余模型）
    const r2 = await fetch("/admin/api/sync-vscode", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: CFG.models, removeExtra: true }) });
    const j2 = await r2.json();
    if (j2.ok) {
      let msg = `已同步 ${j2.added} 个新模型到 VS Code ✅`;
      if (j2.removed) msg += `\n已删除 ${j2.removed} 个多余模型`;
      toast(msg);
    } else {
      toast("同步失败：" + j2.error, false);
    }
  } catch (e) {
    toast("同步失败：" + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 同步到 VS Code";
  }
}

/* ---------- 日志轮询 ---------- */
async function pollLogs() {
  try {
    const j = await (await fetch("/admin/api/config")).json();
    const lines = (j.logs || []).slice().reverse();  // 最新的在最上面，省得每次滚到底
    document.getElementById("logs").textContent = lines.join("\n") || "暂无日志";
    if (CFG) {
      renderBridge(j.bridge);
      BREAKER = j.breaker || {}; STATS = j.stats || {};
      renderStats();
    }
  } catch {}
}

initTheme();
initNav();
loadAll();
pollLogs();
setInterval(pollLogs, 5000);
