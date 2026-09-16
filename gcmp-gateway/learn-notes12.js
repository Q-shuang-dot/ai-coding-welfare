/* ============ 追加批次 13：向量库运维 + Agent 框架选型 —— JD 点名的具体技术 ============ */

NOTES.push(
  {
    id: "kb-vdb-ops",
    cat: "向量库运维",
    title: "Milvus / FAISS / Chroma / Qdrant 怎么选",
    core: true,
    q: "JD 点名这几个，各自适合什么场景？",
    a: `- **FAISS**：只是一个**库**不是服务，没有持久化、没有元数据过滤、没有增删改（只能重建）。适合离线实验和百万级以下的只读场景。JD 提它多半是要你懂索引原理
- **Chroma**：轻量、pip 装完就能用、自带持久化和元数据过滤。适合原型和单机中小规模（百万以内）
- **Qdrant**：Rust 写的，单机性能强、元数据过滤是一等公民（filter 和向量检索一起优化）、部署简单。中等规模首选
- **Milvus**：真正的分布式（存算分离、多副本、多种索引）。**代价是组件多**（etcd + MinIO + 多个 microservice），运维成本高。**只有真到千万级以上或要高可用才值得**
- **pgvector**：团队已有 Postgres 就直接用，事务、备份、权限全复用。面试说这个比说 Milvus 更显工程感
- 选型判断：**先问数据量和 QPS，别默认上 Milvus**。「我用 Chroma 起步，规模到了再迁 Qdrant」是成熟答法
- 面试点：能说出「FAISS 是库不是服务，不能增删只能重建」这个具体差异，说明你真用过`,
  },
  {
    id: "kb-vdb-index",
    cat: "向量库运维",
    title: "索引参数怎么调",
    core: true,
    q: "HNSW 和 IVF 的参数分别影响什么？",
    a: `- **HNSW**（图索引，主流）
  - ~M~：每个节点的连接数，越大精度越高但内存和构建时间也涨。常用 16~32
  - ~efConstruction~：建索引时的搜索宽度，越大索引质量越好、构建越慢。常用 100~400
  - ~ef~（查询时）：**这个最关键**，越大召回越高越慢。**线上就靠调它平衡精度和延迟**
  - 特点：召回高、查询快，但**内存占用大**（图结构要常驻）
- **IVF**（倒排+聚类）
  - ~nlist~：聚类数，经验值 ~4*sqrt(N)~
  - ~nprobe~：查询时探测几个簇，越大召回越高越慢
  - 特点：内存省、适合超大规模，但召回不如 HNSW
- **量化**：~IVF_PQ~ / ~HNSW_SQ~ 把向量压缩，显存降但精度掉。**内存不够才用**
- 调参方法：**建一个小规模的召回评测集**（100 个 query + 已知的正确文档），扫 ~ef~ / ~nprobe~ 画召回-延迟曲线，选拐点
- 面试点：说出「**线上主要调查询时的 ef/nprobe**，建索引参数一般定下来就不动」，这是实操经验`,
  },
  {
    id: "kb-vdb-scale",
    cat: "向量库运维",
    title: "向量库的容量与成本估算",
    core: true,
    q: "100 万条文档要多少资源？",
    a: `- 存储估算：**向量大小 = 维度 × 4 字节**（float32）
  - 1024 维 × 4B = 4KB/条 → 100 万条 = 4GB 纯向量
  - HNSW 图结构再加 **50%~100%** → 实际 6~8GB **常驻内存**
  - 原文和元数据另算（通常比向量大）
- 降本手段：**降维**（1024→768 直接省 25%）、**量化**（float32→int8 省 75%，精度掉几个点）、**冷热分层**（热数据在内存、冷数据在磁盘或对象存储）
- embedding 成本：100 万条 × 平均 500 token = 5 亿 token，按便宜的 embedding 模型算也是笔钱。**所以要做 hash 去重，别重复算**
- 增量更新的坑：**HNSW 删除是标记删除**，删多了图会退化，要定期重建（compact）
- 面试点：能张口给出「1024 维 100 万条约 4GB 向量 + 图结构再加一倍」，比说「看情况」强得多`,
  },
  {
    id: "kb-agent-frameworks",
    cat: "Agent 框架",
    title: "LangChain / LangGraph / Dify / Coze 的定位",
    core: true,
    q: "JD 列了一堆框架，它们在什么层次？",
    a: `按抽象层次从低到高：
- **原生 SDK**（OpenAI SDK / Anthropic SDK）：最底层，自己管循环和状态。**优点是完全可控**，我的网关就是这层
- **LangChain**：组件库 + 链式编排。优点是集成多（几百个 loader / vectorstore / tool），缺点是**抽象层太厚、调试困难、版本变动大**。现在多数人只用它的 loader 和 splitter
- **LangGraph**：LangChain 团队的状态机框架。**核心是 State + Node + 条件边**，能表达循环、分支、人工介入。**做复杂 Agent 比 LangChain 的 AgentExecutor 可控得多**
- **LlamaIndex**：偏 RAG，在索引和检索策略上更专精
- **Dify / Coze / FastGPT**：**低代码平台**，拖拽配 workflow、内置知识库和发布能力。适合业务快速上线和非技术同事参与，缺点是复杂逻辑绕不过去、私有化和二次开发受限
- **AutoGen / CrewAI**：多 Agent 协作，前者偏对话式协作，后者偏角色分工
- 选型判断：**能用 workflow 就别上 Agent，能用平台就别自己写**。反过来：需要深度定制、私有化、性能可控时才自己写
- 面试点：能说出「LangChain 抽象太厚现在多数人只用 loader/splitter」这种真实使用感受，比背特性列表可信`,
  },
  {
    id: "kb-agent-runtime",
    cat: "Agent 框架",
    title: "Agent Runtime 是什么",
    core: true,
    q: "JD 说「熟悉 Agent Framework 和 Agent Runtime」，区别在哪？",
    a: `- **Framework**（LangGraph 等）：帮你**写**Agent 逻辑——状态怎么流转、工具怎么声明
- **Runtime**：帮你**跑**Agent——进程/沙箱管理、工具执行隔离、上下文持久化、多会话并发、崩溃恢复、可观测
- 为什么分开：写出来的 Agent 要真跑在生产环境，就得解决「一个用户的 Agent 崩了不能影响别人」「执行了半小时的任务重启后能续上」「工具执行不能碰到宿主机」这些问题
- Runtime 要提供的能力清单：
  - **会话隔离**：每个会话独立的 State 和工具上下文
  - **执行沙箱**：代码执行、文件操作限制在容器内
  - **状态持久化**：checkpoint 到 DB，可恢复可回放
  - **中断与恢复**（human-in-the-loop）：卡在人工审批处能挂起，批完继续
  - **可观测**：每一步的输入输出可追溯
- LangGraph 的 checkpointer + 中断机制就是在做 Runtime 的一部分
- 面试点：**「Framework 管怎么写，Runtime 管怎么跑」**——能一句话说清这个区分，JD 上这条就算过了`,
  },
  {
    id: "kb-context-eng",
    cat: "Agent 框架",
    title: "Context Engineering",
    core: true,
    q: "为什么说 Context Engineering 取代了 Prompt Engineering？",
    a: `- Prompt Engineering 关注**怎么写这一句话**；Context Engineering 关注**在有限的上下文窗口里放什么、放多少、按什么顺序放**
- 要管理的东西：system 指令、工具定义、检索结果、对话历史、中间结果、few-shot 例子 —— 它们在抢同一个窗口
- 核心手段：
  - **分层**：稳定的放最前（system + 工具定义，利于 prompt caching），易变的放后面
  - **压缩**：历史超长时用小模型做摘要而不是硬截断
  - **按需加载**：工具定义按任务裁剪，不要每轮都塞 80 个工具（实测占 25000 token）
  - **位置策略**：重要信息放头尾，避开 Lost in the Middle
  - **卸载**：中间结果存到外部（文件/DB），上下文里只留引用
- 判断标准：**上下文里每一个 token 都应该对当前这一步有用**，塞满不等于效果好
- 面试点：能说出「工具定义按需裁剪」和「稳定内容前置利于缓存」两个具体动作，说明你算过 token 账`,
  },
);

QUESTIONS.push(
  {
    id: "q85",
    cat: "RAG",
    q: "Milvus、FAISS、Chroma、Qdrant 你会怎么选？",
    a: "**FAISS 是库不是服务**——没持久化、没元数据过滤、不能增删只能重建，适合离线实验。**Chroma** 轻量、pip 装完就用，适合原型和百万以内。**Qdrant** 单机性能强、元数据过滤是一等公民，中等规模首选。**Milvus** 是真分布式但组件多（etcd + MinIO + 多个服务），运维成本高，**只有千万级以上或要高可用才值得**。团队已有 Postgres 就直接 pgvector。关键是**先问数据量和 QPS，别默认上 Milvus**。",
  },
  {
    id: "q86",
    cat: "RAG",
    q: "HNSW 的参数怎么调？",
    a: "建索引时 **M**（每节点连接数，16~32）和 **efConstruction**（搜索宽度，100~400）越大质量越好但更慢更占内存；**查询时的 ef 才是线上主要调的**——越大召回越高越慢，靠它平衡精度和延迟。IVF 那边对应的是 nlist（约 4√N）和 nprobe。调参方法是**建一个小召回评测集**（100 个 query + 已知正确文档），扫参数画召回-延迟曲线选拐点。HNSW 召回高查询快但内存占用大，IVF 省内存适合超大规模。",
  },
  {
    id: "q87",
    cat: "RAG",
    q: "100 万条文档的向量库要多少资源？",
    a: "**向量大小 = 维度 × 4 字节**：1024 维 = 4KB/条，100 万条 = 4GB 纯向量；HNSW 图结构再加 50%~100%，所以实际 **6~8GB 常驻内存**，原文和元数据另算。降本手段是降维、量化（float32→int8 省 75%）、冷热分层。还有个坑：**HNSW 删除是标记删除**，删多了图会退化要定期 compact。embedding 成本也要算——100 万条 × 500 token 是 5 亿 token，所以必须做 hash 去重。",
  },
  {
    id: "q88",
    cat: "Agent",
    q: "LangChain、LangGraph、Dify 这些框架怎么选？",
    a: "按抽象层次：**原生 SDK** 完全可控但要自己管循环；**LangChain** 集成多但抽象太厚、调试困难，现在多数人只用它的 loader 和 splitter；**LangGraph** 是状态机（State + Node + 条件边），能表达循环、分支、人工介入，做复杂 Agent 比 AgentExecutor 可控得多；**Dify/Coze** 是低代码平台，适合快速上线和非技术同事参与，但复杂逻辑绕不过去、私有化受限。选型原则是**能用 workflow 就别上 Agent，能用平台就别自己写**，需要深度定制和私有化时才自己写。",
  },
  {
    id: "q89",
    cat: "Agent",
    q: "Agent Framework 和 Agent Runtime 有什么区别？",
    a: "**Framework 管「怎么写」**——状态怎么流转、工具怎么声明；**Runtime 管「怎么跑」**——会话隔离、执行沙箱、状态持久化、中断恢复、可观测。为什么要分：Agent 真跑生产就得解决「一个用户的 Agent 崩了不影响别人」「执行半小时的任务重启后能续上」「工具执行不能碰宿主机」。LangGraph 的 checkpointer 和中断机制就是在做 Runtime 的一部分。",
  },
  {
    id: "q90",
    cat: "Agent",
    q: "什么是 Context Engineering？和 Prompt Engineering 什么关系？",
    a: "Prompt Engineering 关注**怎么写这一句话**，Context Engineering 关注**在有限窗口里放什么、放多少、按什么顺序放**——system 指令、工具定义、检索结果、对话历史、中间结果都在抢同一个窗口。核心手段：**分层**（稳定内容前置利于 prompt caching）、**压缩**（历史用小模型摘要而非硬截断）、**按需加载**（工具定义按任务裁剪，我实测过 80 个工具占 25000 token）、**位置策略**（重要信息放头尾避开 Lost in the Middle）、**卸载**（中间结果存外部只留引用）。判断标准是**每个 token 都应该对当前这步有用**。",
  },
);
