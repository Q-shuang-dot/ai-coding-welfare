/* ============ 追加批次 11：Python 异步 / FastAPI / 部署 —— JD 硬要求缺口 ============ */

NOTES.push(
  {
    id: "kb-async-basics",
    cat: "异步与后端",
    title: "async/await 到底省了什么",
    core: true,
    q: "协程和线程什么区别？为什么 LLM 应用必须用异步？",
    a: `- LLM 请求是**长耗时 IO**（几秒到几十秒），绝大部分时间在等网络。同步写法这段时间线程干瞪眼
- 协程是**用户态**的协作式切换：遇到 ~await~ 主动让出控制权，事件循环去跑别的任务。没有内核态上下文切换，开销远小于线程
- 线程是抢占式、由 OS 调度，切换要陷入内核；且 Python 有 GIL，多线程做不了 CPU 并行
- 结论：**IO 密集用协程，CPU 密集用多进程**，多线程在 Python 里的位置很窄
:::code
# 串行：总耗时 = 各家之和
for up in upstreams:
    r = requests.post(up, json=body)      # 每次阻塞 3 秒

# 并发：总耗时 ≈ 最慢的那家
async with httpx.AsyncClient() as c:
    tasks = [c.post(up, json=body) for up in upstreams]
    results = await asyncio.gather(*tasks, return_exceptions=True)
:::
- 面试点：能说出「协程是用户态协作式切换，省的是内核态上下文切换开销」+「GIL 让多线程做不了 CPU 并行」，比只说「异步更快」高一档`,
  },
  {
    id: "kb-async-traps",
    cat: "异步与后端",
    title: "异步的三个必踩坑",
    core: true,
    q: "异步代码写错了会怎样？",
    a: `- **坑一：在 async 里调同步阻塞库** —— ~requests.post~、~time.sleep~、同步 DB 驱动会**卡死整个事件循环**，所有协程一起挂
  - 解法：换异步库（httpx / aiohttp / asyncpg），实在没有就 ~await loop.run_in_executor(None, fn)~ 丢线程池
- **坑二：不限并发** —— ~gather~ 一次放 500 个请求出去，上游直接 429 或把你 IP 封了
  - 解法：~Semaphore~ 控制在流量，通常 5~20
- **坑三：异常处理** —— ~gather~ 默认一个失败就取消其余任务
  - 解法：~return_exceptions=True~ 全部收回来再逐个判断
:::code
sem = asyncio.Semaphore(10)

async def fetch(client, url, body):
    async with sem:                        # 限流
        try:
            r = await client.post(url, json=body, timeout=30)
            return r.json()
        except Exception as e:
            return {"error": str(e)}       # 自己吞掉，别炸掉 gather
:::
- 补一个隐蔽坑：**async 函数忘了 await 不报错**，只是返回一个协程对象什么都没发生。开 ~asyncio.run(..., debug=True)~ 或用 lint 规则防
- 面试点：说出「同步阻塞库会卡死事件循环」这一条就够证明你真写过异步，而不是照抄示例`,
  },
  {
    id: "kb-fastapi-llm",
    cat: "异步与后端",
    title: "FastAPI 封装 LLM 接口",
    core: true,
    q: "用 FastAPI 做 AI 服务，关键点有哪些？",
    a: `- **pydantic 定义契约**：请求响应都用 model，自动校验 + 自动生成 OpenAPI 文档，前端能直接对接
- **依赖注入管客户端**：~httpx.AsyncClient~ 应用启动时建、关闭时释放，不要每个请求新建（TCP 握手很贵）
- **流式必须用 StreamingResponse**：~media_type="text/event-stream"~，且要**关掉 Nginx 缓冲**（~X-Accel-Buffering: no~）否则前端收不到增量
- **全局异常处理**：上游报错要转成对客户端友好的结构，别把 traceback 吐出去
:::code
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = httpx.AsyncClient(timeout=60)   # 启动时建
    yield
    await app.state.client.aclose()                    # 关闭时释放

app = FastAPI(lifespan=lifespan)

class ChatReq(BaseModel):
    message: str
    stream: bool = False

@app.post("/chat/stream")
async def chat_stream(req: ChatReq):
    async def gen():
        async for chunk in call_llm_stream(req.message):
            yield f"data: {json.dumps({'delta': chunk})}\\n\\n"
        yield "data: [DONE]\\n\\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"X-Accel-Buffering": "no"})
:::
- 面试点：**「AsyncClient 要复用不能每次新建」+「Nginx 缓冲会吃掉 SSE」**，这两个是真部署过才知道的细节`,
  },
  {
    id: "kb-async-backend",
    cat: "异步与后端",
    title: "AI 应用的后端配套",
    core: true,
    q: "JD 要求「数据库、缓存、消息队列」，在 AI 应用里各干什么？",
    a: `- **数据库**（Postgres/MySQL）：会话历史、用户配置、审计日志、Agent 任务状态。**用异步驱动**（asyncpg / aiomysql），否则前面的异步全白做
- **缓存**（Redis）：三个用途——精确缓存（相同 prompt 直接返回）、限流计数器（分布式滑动窗口用 ZSET + Lua 保原子）、任务状态和分布式锁
- **消息队列**（Celery/RQ/Kafka）：长任务异步化。**文档解析入库、批量 embedding 这类几分钟的活绝不能放在 HTTP 请求里**，要提交任务返回 task_id，前端轮询或 WebSocket 推进度
- 典型架构：FastAPI 接请求 → 短任务直接 await → 长任务丢队列 → worker 处理 → 状态写 Redis → 前端查进度
- 面试点：能说出「文档解析要走队列不能同步做」，说明你考虑过真实的用户体验和超时限制`,
  },
  {
    id: "kb-docker-ai",
    cat: "异步与后端",
    title: "Docker 打包 AI 应用",
    core: true,
    q: "AI 应用的镜像怎么打？有什么特殊的？",
    a: `- **多阶段构建**：builder 阶段装编译依赖，运行阶段只 copy 装好的包。AI 项目依赖很重（torch 几个 G），不分阶段镜像会爆
- **依赖分层**：先 ~COPY requirements.txt~ 再 ~pip install~，最后才 copy 代码 —— 改代码不会让依赖层缓存失效
- **模型文件不进镜像**：用 volume 挂载或启动时下载，否则镜像几十 G 没法传
- **配置走环境变量**：API key 绝不能写进镜像（会留在层历史里）
- **健康检查**：~HEALTHCHECK~ 指向 /health，编排器才知道服务真的起来了
:::code
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
ENV PATH=/root/.local/bin:$PATH
HEALTHCHECK --interval=30s CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--workers", "4"]
:::
- 面试点：**「模型文件不进镜像」+「key 不进镜像层」**这两条一说，就知道你真打过包`,
  },
  {
    id: "kb-private-deploy",
    cat: "异步与后端",
    title: "私有化交付的现实约束",
    core: true,
    q: "客户要求私有化部署，你要提前问清什么？",
    a: `- **有没有外网**：无外网意味着模型必须私有部署（vLLM + 开源模型）或走客户内网代理；pip 依赖要提前打成离线包
- **国产化要求**：有的客户要求信创环境（麒麟 OS、鲲鹏/飞腾 CPU），x86 镜像跑不了，要多架构构建
- **GPU 资源**：有没有卡、什么卡、显存多大，直接决定能跑多大的模型；没卡就只能上小模型或量化版
- **数据不能出域**：日志、向量库、缓存全都得在客户机房内，包括你的监控上报
- **升级方案**：怎么不停机升级、数据怎么迁移、出问题怎么回滚。**先想好升级再交付第一版**
- 交付物清单：镜像包 / 离线依赖 / docker-compose / 初始化脚本 / 部署文档 / 升级文档 / 排障手册
- 面试点：能主动问「有没有外网、有没有 GPU」，说明你交付过而不只是本地跑过`,
  },
);

// ---- 对应面试题 ----
QUESTIONS.push(
  {
    id: "q73",
    cat: "工程",
    q: "为什么 AI 应用后端必须用异步？协程和线程什么区别？",
    a: "LLM 请求是长耗时 IO，几秒到几十秒都在等网络，同步写法这段时间线程完全空转，并发一上来就被打爆。协程是**用户态协作式切换**——遇到 await 主动让出，事件循环去跑别的任务，没有内核态上下文切换开销；线程是抢占式由 OS 调度，切换要陷入内核，而且 Python 有 GIL，多线程做不了 CPU 并行。结论是**IO 密集用协程、CPU 密集用多进程**。",
  },
  {
    id: "q74",
    cat: "工程",
    q: "异步代码最容易踩的坑是什么？",
    a: "**在 async 函数里调同步阻塞库**——requests、time.sleep、同步 DB 驱动会卡死整个事件循环，所有协程一起挂。解法是换异步库（httpx/aiohttp/asyncpg），没有就用 run_in_executor 丢线程池。另外两个：不限并发（gather 一次放几百个请求出去直接 429，要用 Semaphore）、异常处理（gather 默认一个失败取消其余，要 return_exceptions=True）。还有个隐蔽的：**忘了 await 不报错**，只返回一个协程对象什么都没发生。",
  },
  {
    id: "q75",
    cat: "工程",
    q: "用 FastAPI 做流式 AI 接口，有什么坑？",
    a: "两个真部署过才知道的：① **httpx.AsyncClient 要复用**，在 lifespan 里建、关闭时释放，每个请求新建的话 TCP 握手开销很大；② **Nginx 默认会缓冲响应**，SSE 会被攒着不发，前端看不到增量输出，必须设 ~X-Accel-Buffering: no~ 或关掉 proxy_buffering。另外 pydantic 定义请求响应模型能自动出 OpenAPI 文档，前端直接对接。",
  },
  {
    id: "q76",
    cat: "工程",
    q: "文档解析入库这种长任务，你怎么处理？",
    a: "**绝对不能放在 HTTP 请求里同步做**——几百页 PDF 解析加 embedding 要几分钟，网关和浏览器都会超时。做法是提交任务立即返回 task_id，丢到消息队列（Celery/RQ）由 worker 处理，状态和进度写 Redis，前端轮询或 WebSocket 推进度。这样还能做失败重试和断点续传。这题考的是有没有真正交付过 AI 应用。",
  },
  {
    id: "q77",
    cat: "工程",
    q: "AI 应用的 Docker 镜像怎么打包？",
    a: "四个要点：**多阶段构建**（AI 依赖很重，torch 几个 G，不分阶段镜像会爆）；**依赖分层**（先 COPY requirements.txt 再 install，最后 copy 代码，改代码不失效依赖缓存）；**模型文件不进镜像**（用 volume 挂载或启动时下载，否则几十 G 没法传）；**key 不进镜像**（会留在层历史里，走环境变量）。再加 HEALTHCHECK 让编排器知道服务真起来了。",
  },
  {
    id: "q78",
    cat: "工程",
    q: "客户要私有化部署，你会先问什么？",
    a: "四个决定方案的问题：**有没有外网**（无外网就得私有部署模型 + 离线依赖包）、**有没有 GPU 和什么卡**（决定能跑多大模型，没卡只能小模型或量化）、**有没有国产化要求**（信创环境要多架构构建）、**数据能不能出域**（日志和监控上报也算）。然后必须先想好升级方案再交付第一版——怎么不停机升级、数据怎么迁、怎么回滚。",
  },
);
