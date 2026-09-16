/* 追加：统一题库分类并关联项目实战案例。 */
(function addGatewayCaseStudies() {
  const taxonomy = {
    q1: ['大模型基础', 'kb-hallucination'],
    q2: ['大模型基础', 'kb-attention'],
    q3: ['RAG', 'kb-rag-vs-ft'],
    q4: ['RAG', 'kb-rag-pipeline'],
    q5: ['微调与评测', 'kb-eval'],
    q6: ['工程与推理', 'kb-sse'],
    q7: ['工程与推理', 'kb-circuit'],
    q8: ['工程与推理', 'kb-ratelimit'],
    q9: ['工程与推理', 'kb-model-swap'],
    q10: ['Agent 与工具', 'kb-agent-guard'],
    q11: ['Agent 与工具', 'kb-funccall'],
    q12: ['Agent 与工具', 'kb-langgraph'],
    q13: ['工程与推理', 'kb-capability-routing'],
    q14: ['工程与推理', 'kb-gateway'],
    q15: ['工程与推理', 'kb-failover'],
    q16: ['RAG', 'kb-embedding'],
    q17: ['工程与推理', 'kb-vllm'],
    q18: ['RAG', 'kb-context'],
    q19: ['Multi-Agent', 'kb-multiagent'],
    q20: ['工程与推理', 'kb-capability-routing'],
    q21: ['安全', 'kb-sec-dns'],
    q22: ['面试技巧', 'kb-ask-back'],
    q25: ['微调与评测', 'kb-vendor-audit'],
    q26: ['工程与推理', 'kb-dead-route'],
    q27: ['工程与推理', 'kb-capability-routing'],
    q28: ['工程与推理', 'kb-agent-tool-cost'],
    q29: ['工程与推理', 'kb-dead-route'],
    q30: ['微调与评测', 'kb-eval-real-task'],
    q31: ['安全', 'kb-sec-render'],
    q32: ['工程与推理', 'kb-state-merge'],
    q33: ['大模型基础', 'kb-positional'],
    q34: ['大模型基础', 'kb-gqa'],
    q35: ['大模型基础', 'kb-tokenizer-trap'],
    q36: ['场景排障', 'kb-tri-slow'],
    q37: ['场景排障', 'kb-tri-wrong'],
    q38: ['场景排障', 'kb-tri-cost'],
    q39: ['场景排障', 'kb-tri-flaky'],
    q40: ['手写代码', 'kb-code-toolstream'],
    q41: ['开场与收尾', 'kb-intro-30s'],
    q42: ['开场与收尾', 'kb-why-switch'],
    q43: ['开场与收尾', 'kb-hr-round'],
    q44: ['开场与收尾', 'kb-hr-round'],
    q45: ['开场与收尾', 'kb-story-elevator'],
    q46: ['大模型基础', 'kb-attention'],
    q47: ['大模型基础', 'kb-attention'],
    q48: ['大模型基础', 'kb-steps'],
    q49: ['大模型基础', 'kb-steps'],
    q50: ['大模型基础', 'kb-thinking-model'],
    q51: ['RAG', 'kb-chunking'],
    q52: ['RAG', 'kb-query-rewrite'],
    q53: ['RAG', 'kb-rag-pipeline'],
    q54: ['RAG', 'kb-citation'],
    q55: ['RAG', 'kb-rerank'],
    q56: ['Agent 与工具', 'kb-agent-memory-impl'],
    q57: ['Agent 与工具', 'kb-mcp'],
    q58: ['Agent 与工具', 'kb-agent-guard'],
    q59: ['Agent 与工具', 'kb-observability'],
    q60: ['Agent 与工具', 'kb-react'],
    q61: ['微调与评测', 'kb-eval'],
    q62: ['微调与评测', 'kb-eval-metrics'],
    q63: ['微调与评测', 'kb-observability'],
    q64: ['安全', 'kb-prompt-injection'],
    q65: ['安全', 'kb-sec-posture'],
    q66: ['安全', 'kb-sec-posture'],
    q67: ['工程与推理', 'kb-cost'],
    q68: ['异步与后端', 'kb-async-basics'],
    q69: ['工程与推理', 'kb-prompts-as-code'],
    q70: ['工程与推理', 'kb-structured-output'],
    q71: ['工程与推理', 'kb-model-selection'],
    q72: ['系统设计', 'kb-design-gateway'],
    q73: ['异步与后端', 'kb-async-basics'],
    q74: ['异步与后端', 'kb-async-traps'],
    q75: ['异步与后端', 'kb-fastapi-llm'],
    q76: ['异步与后端', 'kb-async-backend'],
    q77: ['异步与后端', 'kb-docker-ai'],
    q78: ['异步与后端', 'kb-private-deploy'],
    q79: ['文档与知识库', 'kb-doc-parse'],
    q80: ['文档与知识库', 'kb-doc-table'],
    q81: ['文档与知识库', 'kb-doc-multimodal'],
    q82: ['文档与知识库', 'kb-doc-pipeline'],
    q83: ['文档与知识库', 'kb-doc-quality'],
    q84: ['文档与知识库', 'kb-kg-basics'],
    q85: ['向量库运维', 'kb-vdb-ops'],
    q86: ['向量库运维', 'kb-vdb-index'],
    q87: ['向量库运维', 'kb-vdb-scale'],
    q88: ['Agent 框架', 'kb-agent-frameworks'],
    q89: ['Agent 框架', 'kb-agent-runtime'],
    q90: ['Agent 框架', 'kb-context-eng'],
    q91: ['Multi-Agent', 'kb-multiagent-comm'],
    q92: ['Agent 与工具', 'kb-agent-skill'],
    q93: ['Agent 与工具', 'kb-agent-memory-impl'],
    q94: ['业务落地', 'kb-biz-decompose'],
    q95: ['业务落地', 'kb-biz-decompose'],
    q96: ['业务落地', 'kb-biz-rollout'],
    q97: ['业务落地', 'kb-ai-native-dev'],
  };

  const cases = [
    {
      id: 'kb-case-failover', cat: '项目实战', core: true,
      title: '多上游故障转移：让单点故障对调用方透明',
      q: '如何把多家不稳定的模型中转站封装成稳定的统一接口？',
      a: '## 背景与约束\n- 同一个逻辑模型需要接多家上游；上游会出现 429、超时、SSL 断连、余额不足和模型下架。\n- 客户端只看到一个 OpenAI 兼容接口，不能感知底层切换。\n\n## 技术决策\n- 每个逻辑模型维护有序 route 列表，失败时尝试下一条；连续失败的路由进入冷却，冷却后只放一次试探。\n- 流式响应必须读到第一个有内容的 delta 后才提交 HTTP 200，否则无法切换备用上游。\n\n## 可量化结果\n- 7 个逻辑模型均有兜底；单上游失败时客户端不需要改代码。\n- 通过 X-Gateway-Upstream 和 X-Gateway-Model 跟踪实际命中路由。\n\n## 面试追问\n- 流式为什么不能连上上游就立即回 200？因为 HTTP 响应已提交，后续失败无法回滚到备用路由。',
      qs: ['q98'],
    },
    {
      id: 'kb-case-notools', cat: '项目实战', core: true,
      title: 'noTools 路由：保留低价纯对话，隔离工具静默失败',
      q: '上游 HTTP 200 却静默丢掉 tools 参数，如何既避免 Agent 失败又不浪费低价容量？',
      a: '## 背景与约束\n- 部分上游表面兼容 OpenAI 协议，但会剥掉 tools；模型返回普通文本，HTTP 仍是 200。\n\n## 问题定位\n- 用同一请求分别带和不带 tools，比对 prompt_tokens；真正转发工具定义时输入 token 会显著增加。\n\n## 技术决策\n- 给路由声明 noTools: true。请求带 tools 或旧版 functions 时先跳过这些路由；纯对话仍可作为低价兜底。\n- 若所有路由都被排除，记录警告后回退，避免配置失误直接拒绝请求。\n\n## 可量化结果\n- 带 tools 的请求只命中真正支持 Function Calling 的上游；纯对话仍保留低成本容量。',
      qs: ['q99'],
    },
    {
      id: 'kb-case-waf', cat: '项目实战', core: true,
      title: 'WAF 路径兼容：从 403 定位到可用旧端点',
      q: '当 /models 可用但 /chat/completions 被 Cloudflare 403 拦截时，怎样定位并兼容？',
      a: '## 背景与约束\n- justwoker 的 /models 正常，但 /chat/completions 对多种 User-Agent、浏览器伪装和请求头持续返回 Cloudflare 403。\n\n## 问题定位\n- 对 User-Agent、代理、流式和非流式、多个路径做最小请求矩阵。只有路径变为 /completions 后成功，结论收敛为路径级 WAF。\n\n## 技术决策\n- 新增可选 chatPath；默认仍使用 /chat/completions，特殊上游改为 /completions。\n- 真实路由、管理页测试和临时测试配置都使用同一端点解析。\n\n## 可量化结果\n- 旧端点可完成文本、流式与工具调用；后续同类问题只需调配置，不改调用方。',
      qs: ['q100'],
    },
    {
      id: 'kb-case-audit', cat: '项目实战', core: true,
      title: '上游能力审计：用真实请求代替供应商声明',
      q: '怎样持续验证上游是否真的支持模型、视觉和工具调用能力？',
      a: '## 背景与约束\n- 上游宣传、模型列表和实际能力经常不一致；可能静默换模型、忽略图片或剥掉 tools。\n\n## 技术决策\n- 每条路由发送最小真实请求，记录成功率、延迟、响应模型、token 与错误摘要。\n- 数字点阵图验证视觉，单函数调用验证 tools，响应 model 字段用于发现静默换模型。\n\n## 实施要点\n- 审计结果同时服务于路由排序和人工排障；日志中不记录密钥。\n\n## 可量化结果\n- 隔离了余额不足、失效 key、不可用模型前缀和工具被剥离等问题，让路由顺序有数据依据。',
      qs: ['q101'],
    },
  ];

  const questions = [
    { id: 'q98', cat: '项目实战', note: 'kb-case-failover', q: '你的多上游故障转移在流式响应中如何避免把错误暴露给客户端？', a: '关键是延迟提交响应头。SSE 一旦向客户端写出 HTTP 200 和响应头，就不能再切到另一家上游；所以先读取上游事件，确认拿到了第一个有内容的 delta 后，才开始转发。上游在此之前 429、超时、断连或返回空内容时，可以直接尝试下一条 route。路由再配合熔断和限流，连续失败的上游会被暂时跳过。' },
    { id: 'q99', cat: '项目实战', note: 'kb-case-notools', q: '你如何证明某个上游没有真正支持 Function Calling？为什么不用 HTTP 状态码判断？', a: 'HTTP 200 只说明请求被接收，不能说明 tools 被传到模型。我用带和不带 tools 的对照观察 prompt_tokens 差值：原生转发工具定义会显著增加输入 token；差值接近 0 时，中转层很可能直接剥掉了参数。再检查是否返回标准 tool_calls，并把结果沉淀为 noTools 路由字段。' },
    { id: 'q100', cat: '项目实战', note: 'kb-case-waf', q: '遇到 Cloudflare 403 时，你如何判断是请求头问题还是路径级 WAF？', a: '先做控制变量实验，不直接猜 UA。保持请求体和 key 不变，测试默认、浏览器、CLI、无 UA，以及流式和非流式；如果同一路径全部 403，说明请求头不是主要变量。再只替换 API 路径；当 /chat/completions 持续失败而 /completions 成功时，结论就是路径级拦截。修复应配置 chatPath，而不是长期伪造浏览器。' },
    { id: 'q101', cat: '项目实战', note: 'kb-case-audit', q: '供应商说支持某模型、视觉和工具调用，你如何在接入前验证？', a: '不只看 /models 或文档，而是按能力发最小真实请求：文本请求测基础可用性和延迟；单函数定义检查是否真的返回 tool_calls；数字点阵图验证视觉；响应 model 字段核对是否发生静默换模型。记录成功率、延迟、token 和错误摘要，为路由顺序提供依据。' },
  ];

  const stories = [
    {
      id: 's6', title: '按请求能力分流，解决 tools 的静默失败', tag: '协议兼容 / 成本优化',
      situation: '部分低价上游返回 HTTP 200，却悄悄丢掉 tools 参数，Agent 无法调用工具；直接禁用又会损失纯对话的低价容量。',
      task: '让带 tools 的请求只走真正支持 Function Calling 的路由，同时保留不支持 tools 的上游承接纯对话。',
      action: '- 用带和不带 tools 的最小请求比对 prompt_tokens，建立可重复能力判据\n- 在路由条目新增 noTools 声明，检测到 tools 或 functions 时自动过滤\n- 过滤后没有候选路由则记录警告并回退\n- 保持所有结果仍是 OpenAI 兼容的标准 tool_calls',
      result: 'Agent 请求不再命中会静默丢 tools 的上游；纯对话仍可使用低成本容量，实现按请求能力而不是按模型名路由。',
      key: 'HTTP 200 不是功能成功；需要用请求对照、token 和返回结构三类证据验证能力。',
    },
    {
      id: 's7', title: '从 Cloudflare 403 追到路径级兼容方案', tag: '系统排障 / 协议兼容',
      situation: '一个上游能列出模型，却在标准 /chat/completions 路径上持续返回 Cloudflare 403，管理页测试和真实调用都受影响。',
      task: '在不依赖脆弱浏览器伪装的前提下，确认根因并实现可维护的兼容。',
      action: '- 对多个 User-Agent、代理、流式参数和路径进行控制变量测试\n- 发现只有 /chat/completions 被拦截，兼容旧协议的 /completions 可完成调用\n- 将端点抽象为上游配置 chatPath\n- 同步修复真实路由、管理页测试和临时测试配置的解析边界',
      result: '上游重新可用，管理页可选择并保存端点；同类 WAF 问题只需调整配置，不需要修改调用方。',
      key: '控制变量结果指向路径级 WAF：UA 怎么换都失败，只有路径改变结果。',
    },
  ];

  for (const item of cases) if (!NOTES.some(n => n.id === item.id)) NOTES.push(item);
  for (const item of questions) if (!QUESTIONS.some(q => q.id === item.id)) QUESTIONS.push(item);
  for (const item of stories) if (!STORIES.some(s => s.id === item.id)) STORIES.push(item);

  const knownNotes = new Set(NOTES.map(n => n.id));
  for (const q of QUESTIONS) {
    const map = taxonomy[q.id];
    if (!map) continue;
    q.cat = map[0];
    if (knownNotes.has(map[1])) q.note = map[1];
  }
  const links = {};
  for (const q of QUESTIONS) {
    if (!q.note) continue;
    if (!links[q.note]) links[q.note] = [];
    links[q.note].push(q.id);
  }
  for (const n of NOTES) if (links[n.id]) n.qs = links[n.id];
})();
