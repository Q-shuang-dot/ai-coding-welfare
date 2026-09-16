/* ============ 追加批次 5：面试实战（手写代码题 / 系统设计 / 高频追问） ============ */

// ---- 手写代码题：面试现场最可能让你写的几段 ----
NOTES.push(
  {
    id: "kb-code-react",
    cat: "手写代码",
    title: "手写 ReAct 循环",
    core: true,
    q: "不用框架，用 50 行实现一个能调工具的 Agent",
    a: `面试高频「白板题」。核心就是 while 循环 + 消息累积 + tool_call_id 对应。
:::code
def run_agent(client, question, tools, tool_impl, max_steps=8):
    msgs = [{"role": "user", "content": question}]
    for step in range(max_steps):
        r = client.chat.completions.create(
            model="gpt-4o", messages=msgs, tools=tools)
        m = r.choices[0].message
        msgs.append(m)                      # 必须把 assistant 原样加回
        if not m.tool_calls:                # 没有工具调用 = 收敛
            return m.content
        for tc in m.tool_calls:             # 可能一次多个，逐个执行
            try:
                args = json.loads(tc.function.arguments)
                result = tool_impl[tc.function.name](**args)
            except Exception as e:
                result = f"工具执行失败: {e}"   # 错误也要回传，让模型自愈
            msgs.append({"role": "tool",
                         "tool_call_id": tc.id,   # 必须对应，错位会报错
                         "content": str(result)})
    return "达到最大步数未收敛"
:::
- 三个必答细节：**assistant 消息要原样 append**、**tool_call_id 必须一一对应**、**max_steps 是硬防护栏**
- 追问「工具报错怎么办」→ 把错误信息当结果回传，模型往往能自己换个参数重试
- 追问「怎么防死循环」→ 除步数外还要查重复调用（同名同参出现 N 次就中断）`,
  },
  {
    id: "kb-code-cosine",
    cat: "手写代码",
    title: "手写余弦相似度与 top-k 检索",
    core: true,
    q: "不用第三方库，实现向量检索",
    a: `问 embedding 必然连着问这个。
:::code
import math

def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:      # 零向量要单独处理，否则除零
        return 0.0
    return dot / (na * nb)

def top_k(query_vec, docs, k=3):
    # docs: [(text, vec), ...]
    scored = [(cosine(query_vec, v), t) for t, v in docs]
    scored.sort(key=lambda x: -x[0])
    return scored[:k]
:::
- 加分点：**如果向量已归一化，余弦 = 点积**，省掉两次开方 → 这是向量库的常见优化
- 追问「几万条够用吗」→ 暴力算 O(n·d)，几千条毫秒级完全够；上万再考虑 HNSW
- 追问「为什么不用欧氏距离」→ 文本 embedding 关心方向不关心模长`,
  },
  {
    id: "kb-code-sse",
    cat: "手写代码",
    title: "手写 SSE 流式解析",
    core: true,
    q: "怎么解析 OpenAI 的流式响应？",
    a: `讲网关必被追问的实操细节。
:::code
def parse_sse(resp):
    buf = ""
    for chunk in resp.iter_content(chunk_size=None):
        buf += chunk.decode("utf-8", "replace")
        while "\\n\\n" in buf:              # 事件以空行分隔
            raw, buf = buf.split("\\n\\n", 1)
            for line in raw.split("\\n"):
                if not line.startswith("data:"):
                    continue               # 跳过注释行/心跳
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    d = json.loads(data)
                except ValueError:
                    continue               # 半包，丢弃这条继续攒
                delta = d["choices"][0].get("delta", {})
                if delta.get("content"):
                    yield delta["content"]
:::
- 三个坑：**必须自己攒缓冲区**（TCP 不保证按事件边界到达）、**~[DONE]~ 不是 JSON**、**空 delta 要跳过**（首包常只有 role）
- 追问「工具调用怎么流式拼」→ ~tool_calls[i].function.arguments~ 是**分片累加**的，要按 index 拼成完整 JSON 再解析`,
  },
  {
    id: "kb-code-retry",
    cat: "手写代码",
    title: "手写指数退避重试",
    core: true,
    q: "429 和 5xx 该怎么重试？",
    a: `:::code
import random, time

def with_retry(fn, max_attempts=4, base=1.0, cap=20.0):
    for attempt in range(max_attempts):
        try:
            return fn()
        except HTTPError as e:
            retryable = e.code == 429 or e.code >= 500
            if not retryable or attempt == max_attempts - 1:
                raise                       # 4xx（除 429）重试无意义
            delay = min(cap, base * (2 ** attempt))
            delay *= 0.5 + random.random()  # 抖动，防惊群
            if e.headers.get("Retry-After"): # 服务端说了就听它的
                delay = float(e.headers["Retry-After"])
            time.sleep(delay)
:::
- 必答点：**只重试 429 和 5xx**（400/401/404 重试纯浪费）、**加随机抖动防惊群**、**优先读 ~Retry-After~ 头**
- 追问「重试和故障转移怎么配合」→ 我的网关是：还有别的上游就直接换家（不等），只有最后一家才值得退避重试`,
  },
  {
    id: "kb-code-tokenbudget",
    cat: "手写代码",
    title: "手写上下文裁剪",
    core: true,
    q: "对话历史超长了怎么截？",
    a: `:::code
def trim(msgs, max_tokens, count):
    # system 永远保留，从最旧的对话往后丢
    system = [m for m in msgs if m["role"] == "system"]
    rest = [m for m in msgs if m["role"] != "system"]
    used = sum(count(m) for m in system)
    kept = []
    for m in reversed(rest):               # 从最新往回收
        c = count(m)
        if used + c > max_tokens:
            break
        used += c
        kept.append(m)
    kept.reverse()
    # 不能以 tool 消息开头，它必须紧跟对应的 assistant
    while kept and kept[0]["role"] == "tool":
        kept.pop(0)
    return system + kept
:::
- 关键坑：**tool 消息不能变成第一条**，否则上游报 "tool_call_id not found"
- 更优方案：丢弃前先让小模型把旧历史压成摘要，插回一条 system
- 追问「为什么不直接按字符数」→ 中文 1 字≈1~1.5 token，英文 1 词≈1.3 token，按字符会算错很多`,
  },
);

// ---- 系统设计：面试第二轮常见题 ----
NOTES.push(
  {
    id: "kb-design-rag",
    cat: "系统设计",
    title: "设计题：企业知识库问答",
    core: true,
    q: "给公司 10 万份文档做问答系统，怎么设计？",
    a: `按这个顺序答，别一上来就说技术栈：
- **先问清需求**：文档类型（PDF/网页/表格）？更新频率？需要权限隔离吗？要引用出处吗？并发多少？延迟要求？
- **离线链路**：解析 → 切块（父子分块：小块检索、大块喂模型）→ embedding → 写向量库 + BM25 索引；**元数据里存权限标签和来源**
- **在线链路**：查询改写（多轮补全为独立问题）→ 混合检索（向量 + BM25）→ **按用户权限过滤**（必须在检索层，不能靠 prompt）→ rerank 取 top-5 → 生成 + 引用编号 → **服务端校验引用真实存在**
- **评测**：黄金集 50~100 条；检索侧看 Recall@k，生成侧看 faithfulness；上线前定基线，每次改动对比
- **成本与性能**：语义缓存挡重复问题；embedding 批量化；prompt caching 复用固定前缀
- 面试点：**权限必须在检索层做**、**引用要服务端校验**，这两点能立刻区分做过和没做过`,
  },
  {
    id: "kb-design-gateway",
    cat: "系统设计",
    title: "设计题：多模型统一网关",
    core: true,
    q: "公司要接 5 家模型供应商，你怎么设计接入层？",
    a: `你的项目正好是这题的答案，按四层讲：
- **协议层**：对外统一 OpenAI 格式；各家差异（~max_completion_tokens~、SSE 格式、tools 支持度）在适配器内消化
- **路由层**：逻辑模型 → 多上游候选；按**能力**（vision/tools）、**健康度**、**成本**、**粘性**排序；这是核心抽象——业务只认 ~model: "fast"~，不认具体厂商
- **韧性层**：故障转移 + 熔断（三态）+ 滑动窗口限流 + 分层超时（连接/首字节/读）；**流式要等首个有效 delta 再提交响应头**
- **观测层**：按上游/模型/天聚合成功率、延迟 P50/P95、token 与成本；响应头回 ~X-Gateway-Upstream~ 便于定位
- 主动提风险：**供应商会静默换模型/剥参数**，所以要有周期性审计
- 面试点：能说出「逻辑模型」这层抽象 + 「首 delta 才提交响应头」，基本就过了`,
  },
  {
    id: "kb-design-eval",
    cat: "系统设计",
    title: "设计题：上线前的质量门禁",
    core: true,
    q: "prompt 改一个字就可能变差，怎么防止线上退化？",
    a: `- **把 prompt 当代码**：进 git、带版本号、每次改动关联一次评测运行
- **三层测试**：单测（格式/字段是否合规）→ 黄金集回归（分数不得低于基线 N%）→ 灰度（小流量对比线上指标）
- **判分方式**：能精确匹配的用规则；开放题 LLM-as-Judge，但要**交换顺序跑两遍消除位置偏差**、给明确 rubric
- **必须有陷阱题**：故意问知识库里没有的东西，看模型是否老实说不知道——这类题最能防「越改越自信」
- **CI 集成**：PR 里自动跑评测并贴分数变化表，人看数字决策
- 面试点：「没有评测的 LLM 系统等于没有测试的代码」+ 具体到「分数不得低于基线」这种可执行门禁`,
  },
);

// ---- 高频追问 ----
NOTES.push(
  {
    id: "kb-ask-tradeoff",
    cat: "面试技巧",
    title: "追问「为什么不用现成方案」",
    core: true,
    q: "面试官问：为什么自己写而不用 LiteLLM / OneAPI？",
    a: `这是陷阱题，答「造轮子有意思」就废了。正确姿势是**承认现成方案更优先，说清你的场景差异**：
- 「生产环境我会先评估 LiteLLM——它协议适配更全、社区维护。我自己写是因为需求很窄：本地单机、零依赖（不想装 pip 包）、要按图片和工具能力做自定义分流，而且我想真正搞懂 SSE 故障转移的边界」
- 再补一句**迁移判断**：「如果要给团队用，我会换成成熟方案，把我这套路由策略以插件形式接进去」
- 面试点：展示的是**技术选型的判断力**，不是动手能力。能主动说出「什么时候该放弃自己的实现」反而加分`,
  },
  {
    id: "kb-ask-scale",
    cat: "面试技巧",
    title: "追问「你的方案能撑多大量」",
    core: true,
    q: "面试官问：这套东西上线能扛多少 QPS？",
    a: `不要吹，要给出**边界 + 瓶颈 + 改造路径**：
- 诚实边界：「我这版是单进程单机，同步阻塞 IO，实测本地开发够用；真上线第一个瓶颈是同步 IO」
- 瓶颈分析：「LLM 请求是长耗时 IO，单线程会被首字节延迟卡死 → 改 asyncio 或多 worker」
- 改造路径：「状态（粘性、熔断、限流窗口）现在在内存，多实例就要挪到 Redis；限流要改成分布式滑动窗口」
- 面试点：**能准确说出自己方案的边界，比号称能扛十万 QPS 可信得多**。面试官问这个通常就是想看你是否清醒`,
  },
  {
    id: "kb-ask-latency",
    cat: "面试技巧",
    title: "追问「延迟怎么优化」",
    core: true,
    q: "用户说 AI 回答太慢，你怎么查怎么优化？",
    a: `拆成四段分别看，别笼统说「优化 prompt」：
- **首 token 延迟（TTFT）**：主要由 prompt 长度和排队决定 → 缩短 prompt、prompt caching、换更快的模型
- **生成速度（TPS）**：由模型大小和 batch 决定 → 换小模型、限制 ~max_tokens~、别让模型输出冗余客套话
- **前置开销**：检索、rerank、embedding → 并行化、加缓存、小模型做 rerank
- **感知延迟**：**开流式**，用户看到字在动就不觉得慢；先返回骨架再补细节
- 量化：先埋点看 P95 卡在哪一段，再动手。**没有分段数据就是瞎猜**
- 面试点：区分「真延迟」和「感知延迟」，说明你考虑过产品体验`,
  },
  {
    id: "kb-ask-nokeys",
    cat: "面试技巧",
    title: "追问「没有生产经验怎么办」",
    core: true,
    q: "面试官说：你这些都是自己玩的项目，没线上流量。",
    a: `别辩解，**承认差距 + 说清可迁移的部分 + 表达补齐意愿**：
- 承认：「对，我没有承接过真实用户流量，缺的是大规模并发下的调优经验和线上事故处置经验」
- 可迁移：「但故障转移、熔断、限流、评测门禁这些设计我是真做过并且踩过坑的——比如流式响应头一旦发出就无法回滚，这个坑不做不会知道」
- 补齐：「我做过的量化收益是成本和可用率，缺的是 P99 和容量规划，这块我需要在真实流量下学」
- 面试点：**坦诚比包装更有说服力**，面试官最怕的是候选人把玩具项目说成生产系统`,
  },
);
