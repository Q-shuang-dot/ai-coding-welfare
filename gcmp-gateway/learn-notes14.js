/* ============ 追加批次 15：按 5 份真实 JD 原词补充对照表 ============
   学习计划见 learn-plan2.js（p1~p6），本文件只补 JDMAP。 */

JDMAP.push(
  { jd: "熟悉异步编程", your: "网关上游调用改为 httpx.AsyncClient + gather + Semaphore 限流；踩过同步库卡死事件循环、gather 异常吞没的坑。", level: "核心" },
  { jd: "文档解析、切片优化", your: "PDF 判文字层分流 OCR、双栏按坐标排序、Word 用标题层级切块、Excel 转 markdown 表格、合并单元格填充。", level: "核心" },
  { jd: "向量化、索引构建及召回策略优化", your: "批量 embedding + hash 去重；HNSW 的 ef 调参配召回评测集；父子分块 + 混合检索 + rerank 的召回率对比数据。", level: "核心" },
  { jd: "向量数据库使用经验（Milvus/Chroma/FAISS/Qdrant）", your: "从 Chroma 起步迁移到 Qdrant/Milvus 的实际对比；能给出 100 万条 1024 维约 6~8GB 常驻内存的估算。", level: "核心" },
  { jd: "主流 Agent 框架（LangChain/LangGraph/Dify/AutoGen）", your: "同一任务用手写、LangGraph、Dify 三种实现并对比适用边界；LangGraph 的 checkpointer 做中断恢复。", level: "核心" },
  { jd: "Agent Runtime / Tool Calling / Skill / Memory", your: "Framework 管怎么写、Runtime 管怎么跑；Skill = tool + prompt + 流程 + 校验；Memory 三层含冲突覆盖与遗忘策略。", level: "核心" },
  { jd: "Multi-Agent 通信、协作与竞争机制", your: "Supervisor 模式实现流水线协作 + 明确仲裁规则 + 全局轮数与 token 护栏 + 单/多 Agent 成本对比数据。", level: "核心" },
  { jd: "MCP 协议标准", your: "自建 MCP server 暴露工具并接入客户端；能讲清 MCP 与 Function Calling 的分层关系。", level: "加分" },
  { jd: "FastAPI 封装标准化 AI 接口", your: "pydantic 定契约、lifespan 复用 AsyncClient、StreamingResponse 做 SSE 并解决 Nginx 缓冲吃掉增量的问题。", level: "核心" },
  { jd: "Docker 容器打包、单机服务部署", your: "多阶段构建 + 依赖分层 + 模型不进镜像 + key 走环境变量 + HEALTHCHECK；compose 一键起网关与依赖。", level: "核心" },
  { jd: "私有化交付、版本迭代、灰度发布", your: "离线依赖包 + 镜像 tar + 升级回滚方案；用网关路由做小流量灰度并对比成功率/延迟/成本。", level: "核心" },
  { jd: "了解 vLLM 推理加速", your: "本地跑 vLLM 接入网关当上游，能说清 PagedAttention 与 continuous batching 解决什么问题及显存估算。", level: "加分" },
  { jd: "知识图谱原理及运用", your: "能说清向量检索答不了多跳才是图谱的价值；成本高所以先用元数据过滤拿部分收益。", level: "加分" },
  { jd: "解决模型幻觉、检索不准、问答跑偏", your: "排查顺序：先看解析文本 → 再看检索结果 → 最后看 prompt；引用编号 + 服务端校验把幻觉变成可程序检验。", level: "核心" },
  { jd: "复杂业务问题拆解为 AI 可执行步骤", your: "四步法：明确产出物 → 倒推信息 → 判断每步谁做（规则能做的绝不给模型）→ 设计失败路径。", level: "核心" },
  { jd: "判断什么时候 AI 不适合回答", your: "精确计算走 SQL、合规结论只汇总不定论、无依据明确说不知道、实时数据走接口。", level: "核心" },
  { jd: "AI-Native 开发 / AI Coding 工具", your: "架构与接口我定、实现交给 AI、小步验证；审代码盯错误处理被简化、编造 API、过度封装。", level: "加分" },
  { jd: "沉淀可复用组件、统一团队开发标准", your: "网关的 vision/noTools 能力标记、audit_routes 审计脚本、项目约定规则文件；学习中心 120+ 知识点带结论行。", level: "加分" },
  { jd: "多轮对话 / 工作流设计经验", your: "多轮 RAG 的查询改写（把「那它的价格呢」重写成自包含问题）；workflow 与 Agent 的选择判断。", level: "核心" },
  { jd: "表格 / 非结构化业务资料处理", your: "分块带表头、合并单元格填充、问答型走 RAG 与计算型走 Text2SQL 的分流判断。", level: "核心" },
);
