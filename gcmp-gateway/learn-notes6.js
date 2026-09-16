/* ============ 追加批次 6：面试官必挖的深水区（八股细节 / 场景排障 / 更多手写题） ============ */

// ---- 大模型基础：容易被追问到答不上来的细节 ----
NOTES.push(
  {
    id: "kb-positional",
    cat: "大模型基础",
    title: "位置编码与 RoPE",
    core: true,
    q: "Attention 本身没有顺序概念，模型怎么知道词序？",
    a: `- 自注意力是**排列不变**的：打乱输入顺序，注意力算出来一样 → 必须额外注入位置信息
- 演进：绝对位置编码（正弦/可学习）→ **RoPE（旋转位置编码）**，用旋转矩阵把相对位置编进 Q/K
- RoPE 为什么主流：只依赖**相对距离**，天然支持外推；这也是「长上下文扩展」能做的基础
- 长度外推手段：位置插值（PI）、NTK-aware scaling、YaRN —— **训练时 8k，推理硬拉到 128k 会掉点**，需要额外微调
- 面试点：能把「1M 上下文不等于 1M 都好用」和位置编码外推挂上钩，比只说 Lost in the Middle 深一层`,
  },
  {
    id: "kb-gqa",
    cat: "大模型基础",
    title: "MHA / MQA / GQA",
    core: true,
    q: "为什么现在的模型都用 GQA？",
    a: `- MHA（多头）：每个头有自己的 K/V → KV Cache 最大
- MQA（多查询）：所有头**共享一组 K/V** → Cache 小很多，但质量掉
- **GQA（分组查询）**：分成 N 组，组内共享 K/V → 折中，主流选择（Llama 系、多数新模型）
- 为什么重要：**KV Cache 大小直接决定长上下文能不能跑**，GQA 是让 128k 上下文可行的关键工程手段之一
- 面试点：问 KV Cache 时主动带出 GQA，说明你知道「显存瓶颈是怎么被解决的」`,
  },
  {
    id: "kb-repetition",
    cat: "大模型基础",
    title: "重复惩罚与退化",
    core: true,
    q: "模型开始反复说同一句话，怎么治？",
    a: `- 成因：贪心/低温采样下容易进入**高概率循环**（自我强化）
- 参数：~frequency_penalty~（按出现次数递增惩罚）、~presence_penalty~（出现过就惩罚一次）、~repetition_penalty~（部分实现独有）
- 别乱调大：设太高会让模型**刻意避开正确用词**，代码和专有名词场景尤其明显
- 更常见的真实原因：**prompt 里有矛盾指令** 或 max_tokens 太大让它硬凑
- 面试点：先怀疑 prompt 和采样配置，而不是第一反应「换模型」`,
  },
  {
    id: "kb-tokenizer-trap",
    cat: "大模型基础",
    title: "Tokenizer 的实际坑",
    core: true,
    q: "为什么模型数不清单词里有几个字母？",
    a: `- 模型看到的是 token 不是字符，~strawberry~ 可能被切成 2~3 个 token → **数字母、反转字符串这类任务天然不擅长**
- 其他连带影响：
  - **JSON/代码里的缩进和引号**会占掉意外多的 token
  - 中文一个字 ≈ 1~1.5 token，同样信息量中文比英文贵
  - 罕见词/乱码被切成一堆单字节 token，成本暴涨
- 工程结论：截断必须按 token 算（用 tiktoken 或上游 tokenizer），**按字符截会算错**
- 面试点：这题常以「模型为什么这么笨」的形式出现，答对说明你理解模型的输入表示`,
  },
);

// ---- 场景排障：面试官最爱问「线上出问题了你怎么查」 ----
NOTES.push(
  {
    id: "kb-tri-slow",
    cat: "场景排障",
    title: "排障：模型突然变慢",
    core: true,
    q: "昨天 2 秒今天 20 秒，你怎么定位？",
    a: `按**先分段再归因**的顺序，不要瞎猜：
- **分段**：确认慢在哪一段——排队/首 token（TTFT）/生成（TPS）/前置检索。没有分段埋点就先补埋点
- **看输入是否变长**：prompt 变长 → prefill 变慢；常见诱因是历史没裁剪、检索 top-k 调大、工具定义变多
- **看是否换了后端**：核对响应体 ~model~ 字段；中转站可能悄悄切到更慢/量化的实例
- **看是否命中限流排队**：429 重试和排队等待会被算进总时长，日志要区分「等待」和「生成」
- **看缓存命中率**：prompt caching 失效（前缀变了）会让 TTFT 突然翻倍
- 面试点：能说出「prefill 慢 vs decode 慢」的区分，以及「prompt 前缀变了会导致缓存失效」，就很专业`,
  },
  {
    id: "kb-tri-wrong",
    cat: "场景排障",
    title: "排障：RAG 答错了",
    core: true,
    q: "用户说答案不对，你第一步查什么？",
    a: `**先分清是检索问题还是生成问题**，这是整个 RAG 排障的分水岭：
- 第一步：把这次的**检索结果打出来看**。正确答案在不在 top-k 里？
- 不在（召回失败）→ 查切块是否把答案切断、embedding 是否适配领域、是否需要混合检索或查询改写
- 在但没用上（生成失败）→ 查 prompt 是否强调「仅依据检索结果」、答案是否在中间位置被忽略（Lost in the Middle）、是否需要 rerank 把它提到前面
- 都对但答案还是错 → 检查**文档本身是不是过期或矛盾**（这类问题最多，且不是技术问题）
- 兜底机制：引用编号 + 服务端校验，让「答错」变成「说不知道」
- 面试点：**先看检索结果**这个动作，能立刻区分做过 RAG 和只看过教程`,
  },
  {
    id: "kb-tri-cost",
    cat: "场景排障",
    title: "排障：账单突然翻倍",
    core: true,
    q: "这个月成本涨了 3 倍，怎么归因？",
    a: `- **先按维度拆**：按模型/上游/接口/用户拆开看，只看总数永远找不到原因
- 高频真凶（都踩过或见过）：
  - **路由把请求打到贵模型上**（如带图判断写错，历史贴过一次图后每轮都走视觉模型）
  - **历史没裁剪**，对话越长每轮输入越贵（成本随轮次平方增长）
  - **工具定义膨胀**，agent 每轮重发几万 token
  - 重试风暴：失败重试没有上限或没有抖动
  - 缓存失效：prompt 前缀里插了时间戳之类的变量，导致 prompt caching 全部 miss
- 防复发：**在网关侧记录每次调用的 token 和估算成本**，做日维度看板 + 异常告警
- 面试点：能说出「成本要在网关侧归因」而不是「等账单出来看」，说明你做过成本治理`,
  },
  {
    id: "kb-tri-flaky",
    cat: "场景排障",
    title: "排障：同样的输入结果不稳定",
    core: true,
    q: "temperature=0 了还是每次不一样，怎么解释？",
    a: `- ~temperature=0~ 只是取 argmax，**不等于完全确定**：
  - 批量推理时 batch 组成不同 → 浮点累加顺序不同 → 极小概率翻转 top-1
  - MoE 模型的专家路由可能受 batch 影响
  - 上游做了**负载均衡到不同实例/不同量化版本**
  - 有的 API 对 ~temperature=0~ 会钳位成极小正值
- 排查动作：核对响应体 ~model~ 字段、固定 ~seed~（若上游支持）、看 ~system_fingerprint~ 是否变化
- 工程应对：**不要依赖输出逐字相同**，评测判分要按语义或结构化字段比对
- 面试点：能说出「浮点累加顺序」和「上游可能多实例」，比只答「temperature=0 就确定了」高一档`,
  },
);

// ---- 手写代码补充 ----
NOTES.push(
  {
    id: "kb-code-toolstream",
    cat: "手写代码",
    title: "手写流式 tool_calls 拼接",
    core: true,
    q: "流式返回的工具调用参数是碎的，怎么拼？",
    a: `讲完 SSE 解析必被追问的下一题。
:::code
def collect_tool_calls(chunks):
    acc = {}                                # index -> 累积中的 tool_call
    for d in chunks:
        delta = d["choices"][0].get("delta", {})
        for tc in delta.get("tool_calls") or []:
            i = tc["index"]                 # 按 index 归组，不是按 id
            slot = acc.setdefault(i, {"id": None, "name": "", "args": ""})
            if tc.get("id"):                # id 和 name 通常只在首片出现
                slot["id"] = tc["id"]
            fn = tc.get("function") or {}
            if fn.get("name"):
                slot["name"] += fn["name"]
            if fn.get("arguments"):         # arguments 是逐字符累加的
                slot["args"] += fn["arguments"]
    out = []
    for i in sorted(acc):
        s = acc[i]
        out.append({"id": s["id"], "name": s["name"],
                    "args": json.loads(s["args"] or "{}")})
    return out
:::
- 三个坑：**按 ~index~ 归组**（id 只在首片给）、**~arguments~ 是字符串拼接**（中途不是合法 JSON，别急着 parse）、**必须等流结束再 ~json.loads~**
- 追问「为什么不能边收边解析」→ 中途的 ~{"cit~ 不是合法 JSON，解析必然失败`,
  },
  {
    id: "kb-code-semcache",
    cat: "手写代码",
    title: "手写语义缓存",
    core: true,
    q: "把语义缓存写出来，要考虑哪些边界？",
    a: `你六周计划的第一个产出，面试主线故事。
:::code
class SemanticCache:
    def __init__(self, embed, threshold=0.92, ttl=3600):
        self.embed, self.th, self.ttl = embed, threshold, ttl
        self.items = []                     # [(vec, answer, expire_at)]

    def _key(self, req):
        # 只用最后一条 user 消息做 key，历史不参与
        for m in reversed(req["messages"]):
            if m["role"] == "user" and isinstance(m["content"], str):
                return m["content"]
        return None

    def get(self, req):
        if not self._cacheable(req):
            return None
        text = self._key(req)
        if not text:
            return None
        v = self.embed(text)
        now = time.time()
        self.items = [x for x in self.items if x[2] > now]   # 顺手清过期
        best, score = None, 0.0
        for vec, ans, _ in self.items:
            s = cosine(v, vec)
            if s > score:
                best, score = ans, s
        return best if score >= self.th else None

    def put(self, req, answer):
        if not self._cacheable(req):
            return
        text = self._key(req)
        if text:
            self.items.append((self.embed(text), answer,
                               time.time() + self.ttl))

    @staticmethod
    def _cacheable(req):
        # 这四条边界就是面试里的「你踩了什么坑」
        if req.get("tools"):                    # 工具调用结果依赖实时数据
            return False
        if req.get("temperature", 0) > 0.3:     # 要求多样性的不该复用
            return False
        if req.get("stream") and False:         # 流式可缓存，但要能合成 SSE 回放
            return False
        for m in req["messages"]:               # 带图的不缓存
            if isinstance(m.get("content"), list):
                return False
        return True
:::
- 阈值怎么定：准备 20 组「该命中」+ 20 组「不该命中」，扫 0.80~0.98 找准确率最高点，**记住这条曲线**
- 必答边界：**带 tools 不缓存、高 temperature 不缓存、带图不缓存、必须有 TTL**
- 追问「否定句怎么办」→ 「Python 怎么读文件」和「Python 怎么**不**读文件」余弦很高但答案相反，这是语义缓存的固有风险，要靠阈值调高 + 关键词兜底`,
  },
  {
    id: "kb-code-ratelimit",
    cat: "手写代码",
    title: "手写滑动窗口限流",
    core: true,
    q: "为什么不用固定窗口？代码怎么写？",
    a: `:::code
from collections import deque
import threading, time

class SlidingWindow:
    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.hits = deque()                 # 存时间戳，天然有序
        self.lock = threading.Lock()

    def allow(self, max_wait=0.0):
        deadline = time.time() + max_wait
        while True:
            with self.lock:
                now = time.time()
                while self.hits and now - self.hits[0] >= self.window:
                    self.hits.popleft()     # 滑出窗口的丢掉
                if len(self.hits) < self.limit:
                    self.hits.append(now)
                    return True
                # 最早那次滑出窗口还要等多久
                wait = self.window - (now - self.hits[0])
            if max_wait <= 0 or time.time() + wait > deadline:
                return False                # 不等，让调用方换下一家
            time.sleep(min(wait, 0.25))
:::
- 为什么不用固定窗口：**边界突变**——窗口结束前用满配额，下一秒刷新又能用满，瞬时流量可达配额两倍
- 用 deque 的原因：只需在两端操作，O(1) 出队
- 设计要点：~max_wait=0~ 表示「不排队，直接换上游」；只有最后一家候选才值得等
- 追问「多实例怎么办」→ 内存版只对单进程有效；分布式要用 Redis（ZSET 存时间戳 + Lua 保证原子）`,
  },
);

// ---- 面试 Q&A 补充 ----
QUESTIONS.push(
  {
    id: "q33",
    cat: "理论",
    q: "自注意力没有顺序概念，模型怎么知道词序？",
    a: "自注意力是**排列不变**的，必须额外注入位置信息。演进路线是绝对位置编码（正弦/可学习）到 **RoPE 旋转位置编码**——用旋转矩阵把相对位置编进 Q/K，只依赖相对距离，天然支持外推。长度外推手段有位置插值、NTK-aware scaling、YaRN，但**训练时 8k 硬拉到 128k 会掉点**，需要额外微调。这也解释了为什么「1M 上下文」不等于 1M 都好用。",
  },
  {
    id: "q34",
    cat: "理论",
    q: "MHA、MQA、GQA 有什么区别，为什么现在都用 GQA？",
    a: "区别在 K/V 的共享程度：MHA 每个头独立 K/V，Cache 最大；MQA 所有头共享一组，Cache 最小但质量掉；**GQA 分组共享**是折中，现在主流。为什么重要——**KV Cache 大小直接决定长上下文能不能跑**，GQA 是让 128k 上下文在可接受显存下可行的关键工程手段。",
  },
  {
    id: "q35",
    cat: "理论",
    q: "为什么模型数不清 strawberry 里有几个 r？",
    a: "因为模型看到的是 **token 不是字符**，strawberry 被切成 2~3 个 token，字母级信息在输入表示里就丢了。同理它不擅长反转字符串。连带影响：JSON 缩进和引号占掉意外多的 token；中文一个字约 1~1.5 token，同样信息量比英文贵；罕见词被切成一堆单字节 token 导致成本暴涨。工程结论是**截断必须按 token 算，按字符会算错**。",
  },
  {
    id: "q36",
    cat: "工程",
    q: "线上模型昨天 2 秒今天 20 秒，你怎么定位？",
    a: "**先分段再归因**。分段确认慢在排队、首 token、生成还是前置检索——没有埋点就先补埋点。然后依次查：输入是否变长（历史没裁剪、top-k 调大、工具定义变多导致 prefill 变慢）；是否被换了后端（核对响应体 model 字段）；是否命中限流排队（日志要区分「等待」和「生成」）；**prompt caching 是否失效**（前缀变了会让 TTFT 突然翻倍）。关键是能区分 prefill 慢和 decode 慢。",
  },
  {
    id: "q37",
    cat: "RAG",
    q: "用户说 RAG 答案不对，你第一步做什么？",
    a: "**把这次的检索结果打出来看**——先分清是检索问题还是生成问题，这是 RAG 排障的分水岭。正确答案不在 top-k 里就是召回失败，查切块是否切断答案、embedding 是否适配领域、要不要混合检索或查询改写；在里面但没用上就是生成失败，查 prompt 是否强调「仅依据检索结果」、是否被 Lost in the Middle 忽略、要不要 rerank 提前。都对还错就要看**文档本身是否过期或矛盾**——这类最多且不是技术问题。",
  },
  {
    id: "q38",
    cat: "工程",
    q: "这个月 API 账单涨了 3 倍，怎么归因？",
    a: "先按模型/上游/接口/用户拆维度，只看总数找不到原因。高频真凶：路由把请求打到贵模型（比如带图判断写错，历史贴过一次图后每轮都走视觉模型——我真踩过）；历史没裁剪导致成本随轮次平方增长；agent 工具定义每轮重发几万 token；重试风暴没有上限或抖动；prompt 前缀插了时间戳导致 caching 全 miss。防复发要**在网关侧记录每次调用的 token 和估算成本**，做日维度看板加异常告警。",
  },
  {
    id: "q39",
    cat: "工程",
    q: "temperature=0 了为什么结果还不稳定？",
    a: "temperature=0 只是取 argmax，不等于完全确定。原因可能是：批量推理时 batch 组成不同导致浮点累加顺序不同，极小概率翻转 top-1；MoE 的专家路由受 batch 影响；上游负载均衡到不同实例或不同量化版本；有的 API 会把 0 钳位成极小正值。排查动作是核对 model 字段、固定 seed、看 system_fingerprint 是否变化。工程上**不要依赖输出逐字相同**，评测判分要按语义或结构化字段比对。",
  },
  {
    id: "q40",
    cat: "Agent",
    q: "流式返回的 tool_calls 参数是碎的，怎么拼？",
    a: "按 **index 归组**而不是按 id——id 和 name 通常只在首片出现，后续片只有 arguments。arguments 是**逐字符累加的字符串**，中途的 ~{\"cit~ 不是合法 JSON，所以**必须等流结束再 json.loads**。实现上用一个 dict 以 index 为键累积，收完流后按 index 排序输出。",
  },
);

// ---- JD 对照补充 ----
JDMAP.push(
  { jd: "性能优化 / 延迟治理", your: "分段埋点区分 TTFT 与 TPS；识别 prompt caching 失效导致首 token 翻倍；prefill 与 decode 分别归因。", level: "核心" },
  { jd: "线上问题定位", your: "四类排障预案：突然变慢、RAG 答错、账单翻倍、结果不稳定，每类都有分层归因顺序。", level: "核心" },
  { jd: "推理引擎原理", your: "能说清 KV Cache 与 GQA 的关系、RoPE 与长度外推、量化取舍，理解显存瓶颈怎么被解决。", level: "加分" },
  { jd: "分布式限流", your: "手写滑动窗口（deque + 锁），知道固定窗口的边界突变问题，以及多实例要迁 Redis ZSET + Lua。", level: "加分" },
);
