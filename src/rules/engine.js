
// 最终 Program 与临时流式替换的负责人；调用方负责改写与持久化。

// 聚合出口：实现已按依赖拓扑拆分到同目录的分块文件，对外接口保持不变。
export { buildTargetLiteralPattern, buildSimpleTargetPattern, compileProcessors, buildProcessors, pickReplacement, resolveProcessorReplacement, getProcessorHitSources } from './engine/engine-00-patterns.js';
export { applyCompiledReplacementsWithTrackedRanges, applyScopedCompiledReplacementsWithTrackedRanges, applyScopedCompiledReplacements, applyStreamingProgram, applyCompiledReplacements, countProcessorMatches, countScopedProcessorMatches, applyScopedReplacementsWithTrackedRanges, applyScopedReplacements, collectRuleHits } from './engine/engine-01-replace.js';
