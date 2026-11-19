// 负责普通消息的就绪/调度、请求编排、待定/最终净化、
// 重试/取消、状态 UI，以及接受/回退的路由；任务检查、匹配、
// 单次请求传输、响应解析与最终组合/提交均委托出去。

// 聚合出口：实现已按依赖拓扑拆分到同目录的 runtime-*.js，对外接口保持不变。
export { cancelAiRewriteTask, getActiveAiRewriteBranchKeyForMessage, isLiveAiRewriteTargetMessage, hasInvalidAiRewriteTarget } from './runtime/runtime-00-ui.js';
export { buildAiRewriteTaskCheck } from './runtime/runtime-01-apply.js';
export { scheduleAiRewriteForMessage } from './runtime/runtime-02-task.js';
export { markAiRewriteFinalCleanseReady, validateAiRewriteMessageTarget, handleAiRewriteGenerationStarted, resetAiRewriteRuntimeState, requestManualAiRewriteForMessage } from './runtime/runtime-03-lifecycle.js';
