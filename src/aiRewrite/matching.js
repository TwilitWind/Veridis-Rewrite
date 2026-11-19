/*
 * 负责 AI 规则匹配器编译、来源范围匹配、匹配区间的 Program 回退
 * 转换，以及改写项构造。它不发起 AI 请求、不拥有生成/任务状态、
 * 不改写消息，也不持久化聊天数据。
 */


// AI 改写始终覆盖整条消息。净化器的范围模式
//（protect / cleanse-inside）是唯一保留的范围限制，并且
// 在 collectAiMatches / collectEditableRanges 内部生效。

// 聚合出口：实现已按依赖拓扑拆分到同目录的分块文件，对外接口保持不变。
export { collectAiScopeSegments, getAiScopeRequestText, compileAiMatchers, collectAiMatches, getOccurrenceProgramFallbackText, applyAiProgramFallbackMatches } from './matching/matching-00-compile.js';
export { buildRewriteItems, resolveRewriteTrackedRanges, materializeProjectedRewriteItems, countMatchedAiRules, extractCurrentAiRewriteScope } from './matching/matching-01-items.js';
