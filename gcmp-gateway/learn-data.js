/* AI 工程学习栏目的全部内容。改这个文件即可增删知识点，页面刷新就生效。
   正文迷你 Markdown：## 标题 / - 列表 / > 提示 / **粗体** / ~行内代码~ / :::code 代码块 ::: */

const PLAN = [];
const NOTES = [];
const STORIES = [];
const QUESTIONS = [];
const JDMAP = [];
const RESOURCES = [];

// ============================== 学习计划 ==============================

PLAN.push(
  {
    id: "w1",
    week: "第 1-2 周",
    title: "给网关做语义缓存",
    why: "一个功能把 RAG 的核心技术全走一遍：embedding、向量相似度、阈值调优、缓存失效。做完既省你自己的钱，又是面试主线故事。",
    output: "网关新增 semantic cache 层，管理页能看到命中率，能说出「月成本降了多少」。",
    tasks: [
      {
        id: "w1t1",
        title: "搞懂 embedding 是什么",
        detail: "找一个能出 embedding 的上游（智谱 embedding-3 便宜），把 10 句话转成向量，算两两余弦相似度，肉眼确认「意思接近的分数高」。不要跳过这一步直接抄代码。",
        note: "kb-embedding",
      },
      {
        id: "w1t2",
        title: "选向量存储",
        detail: "先用内存里的 numpy 数组暴力算，几千条以内完全够。等到确实慢了再换 Chroma 或 sqlite-vec。别一上来碰 Milvus。",
        note: "kb-vectordb",
      },
      {
        id: "w1t3",
        title: "实现缓存读写",
        detail: "请求进来 → 取最后一条 user 消息做 embedding → 查最相似的历史问题 → 超过阈值就直接返回缓存的回答，否则打上游、成功后写缓存。",
        note: "kb-semcache",
      },
      {
        id: "w1t4",
        title: "调阈值（最关键的一步）",
        detail: "准备 20 组「该命中」和 20 组「不该命中」的问题对，扫 0.80~0.98 找准确率最高的点。记下这条曲线，面试会问你怎么定的。",
        note: "kb-threshold",
      },
      {
        id: "w1t5",
        title: "处理失效与边界",
        detail: "带图片的请求不缓存；带 tools 的不缓存；temperature 高的不缓存；给缓存加 TTL。这些边界条件就是面试里的「你踩了什么坑」。",
        note: "kb-cache-invalid",
      },
      {
        id: "w1t6",
        title: "量化收益",
        detail: "在管理页统计面板加命中率和「省下的 token 数」。有数字的项目和没数字的项目，面试评价差一个档。",
      },
    ],
  },
  {
    id: "w3",
    week: "第 3 周",
    title: "Function Calling 兼容层",
    why: "你的 13 家上游能力不齐。给不支持 tools 的上游做降级模拟，做完你就不是「听说过 Function Calling」，而是「我实现过兼容层」。",
    output: "网关对客户端统一暴露 tools 能力，底层上游不支持时自动用 prompt 模拟。",
    tasks: [
      {
        id: "w3t1",
        title: "先摸清哪家支持 tools",
        detail: "给每家上游发一个带 tools 的最小请求，记录：正常返回 tool_calls / 报 400 / 直接当普通文本忽略。第三种最危险，静默失败。",
        note: "kb-funccall",
      },
      {
        id: "w3t2",
        title: "写降级路径",
        detail: "把 tools 定义序列化进 system prompt，要求模型只输出 JSON，再把结果解析回标准 tool_calls 结构塞进响应。",
        note: "kb-tool-fallback",
      },
      {
        id: "w3t3",
        title: "扛住模型不听话",
        detail: "模型会吐 markdown 代码块包裹的 JSON、会多说一句话、会漏字段。写容错解析 + 重试一次 + 最终失败退回纯文本。",
        note: "kb-structured-output",
      },
      {
        id: "w3t4",
        title: "config 加 supportsTools 声明",
        detail: "上游配置加字段，路由时优先选原生支持的，模拟路径只作兜底。这个设计思路和你已有的 vision 字段一模一样。",
      },
    ],
  },
  {
    id: "w4",
    week: "第 4 周",
    title: "自动化质量评测",
    why: "直接对应 JD 里的「模型评测体系」。也回答一个必问题：你换了模型怎么知道效果没变差。",
    output: "一条命令跑完全部上游，输出质量+延迟+成本三维排序表。",
    tasks: [
      {
        id: "w4t1",
        title: "建评测集",
        detail: "30~50 道题，覆盖你真实用途：改代码、读中文表格、长文本总结、工具调用。每题写好参考答案或判分标准。",
        note: "kb-eval",
      },
      {
        id: "w4t2",
        title: "选打分方式",
        detail: "能精确匹配的用规则打分；开放题用 LLM-as-judge（拿 opus-5 当裁判）。必须知道 judge 本身有偏好偏差，这是面试加分点。",
        note: "kb-llm-judge",
      },
      {
        id: "w4t3",
        title: "扩展 audit_routes.py",
        detail: "你已经有连通性和延迟审计了，加上质量分和单位成本，产出一张能直接指导 config 路由顺序的表。",
      },
      {
        id: "w4t4",
        title: "跑一次全量并按结果调路由",
        detail: "让数据来决定 route 顺序，而不是感觉。这个动作本身就是面试故事：从拍脑袋到数据驱动。",
      },
    ],
  },
  {
    id: "w5",
    week: "第 5 周",
    title: "真正写一个 Agent",
    why: "前四周都在模型下面做基础设施，这周必须往上做一次应用层，补齐「AI 全栈」的最后一块。",
    output: "一个多步 Agent：给它一个任务，它自己决定调哪些工具、循环几轮、什么时候停。",
    tasks: [
      {
        id: "w5t1",
        title: "手写一遍 ReAct 循环",
        detail: "先不用框架。while 循环 + 工具字典 + 消息历史，50 行搞定。理解了再上框架，否则框架只是黑盒。",
        note: "kb-react",
      },
      {
        id: "w5t2",
        title: "跑通 LangGraph 官方 tutorial",
        detail: "重点理解三件事：State 是什么、节点之间怎么传、条件边怎么决定下一步。别贪多，跑通 tutorial 就够。",
        note: "kb-langgraph",
      },
      {
        id: "w5t3",
        title: "做一个对你有用的 Agent",
        detail: "建议：上游巡检 Agent。工具 = 查健康、发测试请求、查余额、读统计。任务 = 「找出今天表现最差的上游并说明原因」。用自己的网关当后端。",
      },
      {
        id: "w5t4",
        title: "加上防护栏",
        detail: "最大步数、总 token 上限、单工具超时、重复调用检测。面试必问「Agent 死循环怎么办」，你要有实现过的答案。",
        note: "kb-agent-guard",
      },
    ],
  },
  {
    id: "w6",
    week: "第 6 周",
    title: "简历与面试冲刺",
    why: "东西做完了不等于讲得出来。这周把技术资产翻译成招聘方听得懂的语言。",
    output: "一份改好的简历 + 三个能讲 5 分钟的项目故事 + 八股全过一遍。",
    tasks: [
      { id: "w6t1", title: "按 JD 关键词重写简历", detail: "去「面试准备 → JD 翻译」那一栏，逐条把你的经历映射成 JD 里的词。同一件事，措辞不同命中率差很远。" },
      { id: "w6t2", title: "三个故事各练到能讲 5 分钟", detail: "去「面试准备 → 项目故事」，按 STAR 结构口头讲一遍并录音，听回放会发现自己讲得多乱。" },
      { id: "w6t3", title: "八股刷两轮", detail: "用「知识库 → 抽卡复习」模式，先自己答再看答案。第一轮找出不会的，第二轮只刷不会的。" },
      { id: "w6t4", title: "准备反问问题", detail: "问团队目前的 AI 系统卡在哪、评测怎么做、有没有线上流量。会反问的候选人显著加分。" },
      { id: "w6t5", title: "投递分级", detail: "先投 2 家不太想去的练手，再投目标公司。面试是练出来的，别拿最想去的公司当第一场。" },
    ],
  },
);

// ============================== 资源 ==============================

RESOURCES.push(
  { cat: "必读", title: "Building Effective Agents（Anthropic）", url: "https://www.anthropic.com/engineering/building-effective-agents", note: "全网关于 Agent 最不玄学的一篇。先读这个再碰任何框架。" },
  { cat: "必读", title: "LangGraph 官方教程", url: "https://langchain-ai.github.io/langgraph/tutorials/introduction/", note: "只跑 tutorial，不看 API 文档。" },
  { cat: "必读", title: "OpenAI Function Calling 文档", url: "https://platform.openai.com/docs/guides/function-calling", note: "tool_calls 的字段结构是事实标准，你的兼容层要对齐它。" },
  { cat: "理论", title: "The Illustrated Transformer", url: "https://jalammar.github.io/illustrated-transformer/", note: "看图理解 Attention，比看公式快。" },
  { cat: "理论", title: "Prompt Engineering Guide", url: "https://www.promptingguide.ai/zh", note: "有中文版，当字典查，别通读。" },
  { cat: "RAG", title: "Chroma 文档", url: "https://docs.trychroma.com/", note: "本地向量库首选，pip 装完就能用。" },
  { cat: "RAG", title: "pgvector", url: "https://github.com/pgvector/pgvector", note: "如果团队已有 Postgres，面试说这个比说 Milvus 更显工程感。" },
  { cat: "评测", title: "Ragas", url: "https://docs.ragas.io/", note: "RAG 评测指标的事实标准，至少要知道 faithfulness 和 context recall 怎么算。" },
  { cat: "找活", title: "本地部署与推理：vLLM", url: "https://docs.vllm.ai/", note: "JD 高频词。不必精通，但要知道 PagedAttention 和 continuous batching 解决什么问题。" },
);
