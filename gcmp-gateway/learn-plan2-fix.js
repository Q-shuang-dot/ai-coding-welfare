/* ============ 追加批次 16：修正 learn-plan2.js 里指向不存在知识点的 note 引用 ============
   p1~p6 写在 learn-plan2.js 时先占了 id，实际知识卡建在 notes10~13 用了别的命名。
   这里做一次映射修正，避免任务卡片点开跳不到对应知识点。 */

(function fixPlanNoteRefs() {
  const MAP = {
    "kb-doc-pdf": "kb-doc-parse",
    "kb-doc-image": "kb-doc-multimodal",
    "kb-doc-meta": "kb-doc-pipeline",
    "kb-milvus-deploy": "kb-vdb-ops",
    "kb-index-tuning": "kb-vdb-index",
    "kb-vector-filter": "kb-doc-pipeline",
    "kb-vector-ops": "kb-vdb-scale",
    "kb-langgraph-deep": "kb-langgraph",
    "kb-dify": "kb-agent-frameworks",
    "kb-mcp-impl": "kb-mcp",
    "kb-framework-choice": "kb-agent-frameworks",
    "kb-multiagent-arch": "kb-multiagent-comm",
    "kb-agent-comm": "kb-multiagent-comm",
    "kb-memory-impl": "kb-agent-memory-impl",
    "kb-req-breakdown": "kb-biz-decompose",
    "kb-when-not-ai": "kb-biz-decompose",
  };
  for (const week of PLAN) {
    for (const t of week.tasks) {
      if (t.note && MAP[t.note]) t.note = MAP[t.note];
    }
  }
})();
