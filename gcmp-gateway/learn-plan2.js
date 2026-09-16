/* ============ 追加批次 10：对准大连 AI 应用/Agent 岗 JD 的学习计划 ============
   现有 w1~w6 围绕网关（w3~w6 已完成，是真实资产）。这里新增 p1~p6 六个阶段，
   补齐 5 份 JD 的硬交集缺口：异步/文档解析/向量库运维/框架/部署/业务落地。 */

PLAN.push(
  {
    id: "p1",
    week: "阶段 1（约 1 周）",
    title: "Python 异步与 FastAPI 服务化",
    why: "5 份 JD 里 4 份明确写「熟悉异步编程」，3 份要 FastAPI/API 服务。LLM 调用是长耗时 IO，同步写法在并发下必然被打爆——这是 AI 应用后端的第一道门槛，也是你网关目前最大的短板（单进程同步）。",
    output: "把 GCMP 网关改成 asyncio 版本，用 FastAPI 重写路由层，压测对比同步版的并发吞吐，有数字。",
    tasks: [
      {
        id: "p1t1",
        title: "搞懂 async/await 到底省了什么",
        detail: "写两个脚本对比：同步串行请求 10 个上游 vs asyncio.gather 并发请求。亲眼看到耗时从 N×t 变成 max(t)。别跳过这步直接抄框架代码，不然被追问「协程和线程什么区别」会卡住。",
        note: "kb-async-basics",
      },
      {
        id: "p1t2",
        title: "掌握异步的三个坑",
        detail: "① 在 async 函数里调用同步阻塞库（requests、time.sleep）会卡死整个事件循环，要用 httpx/aiohttp 或 run_in_executor；② 并发数要用 Semaphore 限制，否则上游直接 429；③ 异常要用 gather(return_exceptions=True) 收集，否则一个失败全盘取消。",
        note: "kb-async-traps",
      },
      {
        id: "p1t3",
        title: "用 FastAPI 封一个标准 AI 接口",
        detail: "实现 POST /chat（非流式）+ /chat/stream（SSE 流式）。重点：pydantic 定义请求响应模型、依赖注入管理客户端、StreamingResponse 返回 SSE、全局异常处理器。JD 里「用 FastAPI 封装标准化 AI 接口」就是这个。",
        note: "kb-fastapi-llm",
      },
      {
        id: "p1t4",
        title: "把网关改成异步并压测",
        detail: "httpx.AsyncClient 替换 urllib，故障转移逻辑改 await。用 20 并发压一轮，对比改造前后的吞吐和 P95。这个数字就是面试时「你的方案能撑多大量」的答案。",
      },
    ],
  },
  {
    id: "p2",
    week: "阶段 2（约 1.5 周）",
    title: "文档解析与图文混合知识库",
    why: "熵基那份 JD 直接点名「PDF、Word、Excel、图纸、图片类文档解析入库，图文混合知识库问答」。这是最具体、最能拉开差距的活，而你现在一条相关知识都没有。多数候选人只会 txt 切块，能处理真实业务文档的很少。",
    output: "一个能吃 PDF/Word/Excel/扫描件的解析入库流水线，表格和图片不丢，检索能定位到页码。",
    tasks: [
      {
        id: "p2t1",
        title: "PDF 解析：先分清「有文字层」和「扫描件」",
        detail: "pymupdf(fitz) 提文字快且能拿到坐标和页码；纯扫描件必须走 OCR（PaddleOCR 中文效果好）。写一个 detect 函数：抽几页看文字长度，低于阈值就判定为扫描件走 OCR 分支。这个分流判断是面试细节点。",
        note: "kb-doc-pdf",
      },
      {
        id: "p2t2",
        title: "表格不能当普通文本切",
        detail: "表格被按字符切断后模型完全没法用。做法：用 pdfplumber/camelot 单独抽表格 → 转成 markdown 表格或 CSV 整块存 → 附上表名和上下文说明。Excel 直接 pandas 读，每个 sheet 一块，保留表头。",
        note: "kb-doc-table",
      },
      {
        id: "p2t3",
        title: "图片和图纸走多模态",
        detail: "文档里的图片先抽出来，用视觉模型生成文字描述（caption）存进索引，检索命中后把原图一起给模型。你的网关正好有按图片自动路由的能力，直接复用。图纸类要注意：视觉模型对细小文字识别差，必须实测。",
        note: "kb-doc-image",
      },
      {
        id: "p2t4",
        title: "元数据设计与可溯源",
        detail: "每个 chunk 存：来源文件、页码、块类型（正文/表格/图片描述）、更新时间、权限标签。检索结果要能回答「这句话在哪个文件第几页」——JD 里「图文混合知识库问答优化」的可信度就靠这个。",
        note: "kb-doc-meta",
      },
      {
        id: "p2t5",
        title: "跑一遍真实文档并记录失败案例",
        detail: "找 10 份真实的 PDF/Word（合同、手册、报表都要有），跑完统计：哪些解析失败、表格错位、OCR 识别错。这份失败清单就是面试里「你踩过什么坑」的素材，比说「我会用 LangChain 的 loader」有用得多。",
      },
    ],
  },
  {
    id: "p3",
    week: "阶段 3（约 1 周）",
    title: "向量库实战：部署、索引、调优",
    why: "4 份 JD 要求向量库使用经验，熵基那份具体到「Milvus/FAISS 单机部署、索引配置、参数调优、冷热数据分层」。只知道「向量库是存向量的」远远不够，要能说出索引参数怎么影响召回率和延迟。",
    output: "Milvus 单机部署跑通 + FAISS 本地索引对比 + 一张「索引参数 vs 召回率 vs 延迟」的实测表。",
    tasks: [
      {
        id: "p3t1",
        title: "Docker 起一个 Milvus 单机",
        detail: "用官方 docker-compose 起 Milvus standalone，建 collection、定义 schema（含标量字段用于权限过滤）、插入数据、建索引、查询。重点理解 collection/partition/index 三层概念，以及为什么要先 load 到内存才能搜。",
        note: "kb-milvus-deploy",
      },
      {
        id: "p3t2",
        title: "索引类型与参数实测",
        detail: "对同一批数据分别建 FLAT（暴力，100% 召回做基线）、IVF_FLAT（调 nlist/nprobe）、HNSW（调 M/efConstruction/ef），记录每种的召回率、查询延迟、建索引时间、内存占用。**这张表就是「参数调优」的证据**。",
        note: "kb-index-tuning",
      },
      {
        id: "p3t3",
        title: "标量过滤与权限隔离",
        detail: "在 Milvus 里用 expr 做标量过滤（如 dept == 'finance'），验证权限外的文档确实检索不到。理解「先过滤再搜」和「先搜再过滤」的性能差异——这是 RAG 权限控制落地的关键。",
        note: "kb-vector-filter",
      },
      {
        id: "p3t4",
        title: "增量更新与冷热分层",
        detail: "文档更新了怎么办（删旧 chunk 插新的，用 doc_id 关联）、软删除怎么处理、历史数据怎么归档。冷热分层的朴素做法：热数据放内存索引，冷数据放磁盘或不 load，按访问频率迁移。",
        note: "kb-vector-ops",
      },
    ],
  },
  {
    id: "p4",
    week: "阶段 4（约 1.5 周）",
    title: "主流 Agent 框架：LangGraph + Dify",
    why: "5 份 JD 全部要求至少一种主流框架。你手写过 ReAct 是好事（能说清原理），但 JD 明确点名 LangChain/LangGraph/Dify/AutoGen/CrewAI——**没用过框架，简历第一轮就被筛**。学框架的目的不是崇拜它，是能对比出取舍。",
    output: "同一个业务需求用三种方式实现：手写、LangGraph、Dify 拖拉，写出三者的取舍对比。",
    tasks: [
      {
        id: "p4t1",
        title: "LangGraph：把手写 ReAct 迁过去",
        detail: "用 StateGraph 重写你已经手写过的那个 Agent。重点搞懂：State 用 TypedDict 定义、add_node/add_edge、conditional_edge 做分支、checkpointer 做状态持久化和断点续跑。有手写经验打底，学起来会很快。",
        note: "kb-langgraph-deep",
      },
      {
        id: "p4t2",
        title: "Dify：私有化部署跑通一个知识库应用",
        detail: "docker-compose 起 Dify，接上你的网关当模型供应商（正好验证 OpenAI 兼容性），建知识库上传文档，配一个带工具的 Agent，发布成 API。JD 里「Dify 私有化上线全流程」就是这个。",
        note: "kb-dify",
      },
      {
        id: "p4t3",
        title: "MCP：写一个自己的 MCP server",
        detail: "两份 JD 要求「熟悉 MCP 协议标准」。用官方 SDK 写一个暴露 2~3 个工具的 server（比如查你网关的统计数据），在 Claude Desktop 或 VS Code 里接上验证。理解 tools/resources/prompts 三种原语的区别。",
        note: "kb-mcp-impl",
      },
      {
        id: "p4t4",
        title: "写出框架取舍对比",
        detail: "三个维度对比：开发速度、可控性、调试难度。结论要具体，比如「Dify 适合业务人员配置和快速验证，LangGraph 适合有复杂状态流转的场景，手写适合流程固定且要极致控制的场景」。这就是「技术选型」能力的证据。",
        note: "kb-framework-choice",
      },
    ],
  },
  {
    id: "p5",
    week: "阶段 5（约 1 周）",
    title: "Multi-Agent 与 Memory 工程",
    why: "3 份 JD 要求多智能体架构设计，2 份点名 Memory/Context Engineering。信华信那份还要求「Skill 设计、工具封装、Context 设计」——这是从「会调 API」到「会设计 Agent 系统」的分水岭。",
    output: "一个多 Agent 协作的实际应用（建议：网关巡检团队），有 Supervisor 调度和共享 Memory。",
    tasks: [
      {
        id: "p5t1",
        title: "Supervisor 模式实现",
        detail: "一个 Supervisor 负责拆解任务和分派，多个专职 Agent（查健康的、发测试请求的、算成本的）各管一块。用 LangGraph 实现，重点是 Supervisor 怎么判断任务完成、怎么处理子 Agent 失败。",
        note: "kb-multiagent-arch",
      },
      {
        id: "p5t2",
        title: "Agent 间通信与状态共享",
        detail: "三种方式：共享 State（最简单，LangGraph 天然支持）、消息传递（子 Agent 结果写回 Supervisor）、黑板模式（共享存储）。踩坑点：**子 Agent 的输出要结构化**，否则 Supervisor 没法可靠解析。",
        note: "kb-agent-comm",
      },
      {
        id: "p5t3",
        title: "Memory 三层落地",
        detail: "短期（当前对话，带裁剪和摘要）、长期（关键事实抽取存向量库，按需检索）、工作记忆（任务中间状态）。实现一个 extract_facts 函数：对话结束后让小模型抽出值得长期记的事实存起来。",
        note: "kb-memory-impl",
      },
      {
        id: "p5t4",
        title: "Context Engineering：把上下文当资源管",
        detail: "信华信 JD 直接写了 Context Engineering。核心是：每一轮该给模型看什么、不该看什么。实践：动态组装 context（system + 相关记忆 + 检索结果 + 最近历史 + 工具定义），并给每部分设 token 预算。",
        note: "kb-context-eng",
      },
    ],
  },
  {
    id: "p6",
    week: "阶段 6（约 1 周）",
    title: "交付与业务落地",
    why: "3 份 JD 要求 Docker 部署、私有化交付、灰度发布；两份把「业务拆解能力」列为核心差异点，其中一份原话是「能判断什么时候 AI 不适合回答」。这是从「做出来」到「能交付」的最后一段，也是最容易被忽略的。",
    output: "一个能一键部署的 AI 应用（Docker Compose）+ 一份需求拆解文档模板。",
    tasks: [
      {
        id: "p6t1",
        title: "Docker 打包与 Compose 编排",
        detail: "把 FastAPI 服务 + 向量库 + Dify 编排成一套 compose。重点：多阶段构建减小镜像、环境变量管理配置、健康检查、数据卷持久化。JD 里「Docker 容器打包、单机服务部署」就是这个。",
        note: "kb-docker-ai",
      },
      {
        id: "p6t2",
        title: "私有化交付要考虑什么",
        detail: "客户环境往往无外网（模型要私有部署或走内网代理）、有国产化要求、要提供离线安装包、要能升级不丢数据。写一份部署清单和升级方案。这是 To B 岗位的加分项。",
        note: "kb-private-deploy",
      },
      {
        id: "p6t3",
        title: "需求拆解方法论",
        detail: "拿一个真实业务需求（比如「财务想让 AI 回答报销政策问题」）走一遍：明确用户是谁 → 现在怎么做的 → 什么叫做对了 → 数据在哪 → **哪些情况 AI 不该回答**（政策边界、金额判定要人工）→ 最小可用版本是什么。产出一页拆解文档。",
        note: "kb-req-breakdown",
      },
      {
        id: "p6t4",
        title: "写一份「什么时候不该用 AI」清单",
        detail: "有份 JD 把这个列为核心差异点。清单示例：需要 100% 准确的计算（用代码）、有明确规则的判断（用规则引擎）、需要审计追责的决策（人工）、数据量小到能穷举的（查表）。能主动说出 AI 的边界，比吹能力更显专业。",
        note: "kb-when-not-ai",
      },
    ],
  },
);
